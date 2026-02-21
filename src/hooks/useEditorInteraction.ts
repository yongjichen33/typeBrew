import { useCallback, useRef } from 'react';
import type { EditablePath, ViewTransform, Selection, RubberBand } from '@/lib/editorTypes';
import { collectAllPoints } from '@/lib/svgPathParser';

const HIT_RADIUS_PX = 8;

/** Convert screen (canvas) coordinates to font-space (Y-up). */
function toFontSpace(sx: number, sy: number, vt: ViewTransform): { x: number; y: number } {
  return {
    x: (sx - vt.originX) / vt.scale,
    y: -(sy - vt.originY) / vt.scale,
  };
}

/** Find the closest point within hit radius (screen pixels). Returns point id or null. */
function hitTest(
  sx: number, sy: number,
  paths: EditablePath[],
  vt: ViewTransform,
): string | null {
  const pts = collectAllPoints(paths);
  const hitSq = (HIT_RADIUS_PX / vt.scale) ** 2; // in font-space units²
  const fp = toFontSpace(sx, sy, vt);

  let closestId: string | null = null;
  let closestSq = hitSq;

  for (const pt of pts) {
    const dx = pt.x - fp.x;
    const dy = pt.y - fp.y;
    const dsq = dx * dx + dy * dy;
    if (dsq < closestSq) {
      closestSq = dsq;
      closestId = pt.id;
    }
  }

  return closestId;
}

/** Find all point ids inside a rubber-band rect (screen coords). */
function pointsInRect(
  x1: number, y1: number, x2: number, y2: number,
  paths: EditablePath[],
  vt: ViewTransform,
): Set<string> {
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);

  const result = new Set<string>();
  const pts = collectAllPoints(paths);

  for (const pt of pts) {
    const [sx, sy] = [
      vt.originX + pt.x * vt.scale,
      vt.originY - pt.y * vt.scale,
    ];
    if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
      result.add(pt.id);
    }
  }
  return result;
}

interface InteractionParams {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stateRef: React.MutableRefObject<{
    paths: EditablePath[];
    selection: Selection;
    toolMode: string;
    drawPointType: string;
    viewTransform: ViewTransform;
  }>;
  dispatch: (action: unknown) => void;
  setRubberBand: (rb: RubberBand | null) => void;
  setMousePos: (pos: { x: number; y: number } | null) => void;
  setPendingOffCurve: (pos: { x: number; y: number } | null) => void;
  redraw: () => void;
  getCanvasRect: () => DOMRect | null;
}

/** Returns pointer + wheel event handlers to attach to the canvas element. */
export function useEditorInteraction({
  stateRef,
  dispatch,
  setRubberBand,
  setMousePos,
  setPendingOffCurve,
  redraw,
  getCanvasRect,
}: InteractionParams) {
  const dragRef = useRef<{
    type: 'point' | 'canvas';
    startFx: number; startFy: number;
    curFx: number; curFy: number;
    rbStartX: number; rbStartY: number;
  } | null>(null);

  const panRef = useRef<{
    startOriginX: number; startOriginY: number;
    startX: number; startY: number;
  } | null>(null);

  /** Pending off-curve control point (font-space) waiting to be paired with the next on-curve click. */
  const pendingOffCurveRef = useRef<{ x: number; y: number } | null>(null);

  const getEventPos = useCallback((e: PointerEvent | WheelEvent) => {
    const rect = getCanvasRect();
    if (!rect) return { x: e.clientX, y: e.clientY };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, [getCanvasRect]);

  const onPointerDown = useCallback((e: PointerEvent) => {
    const { x, y } = getEventPos(e);
    const { toolMode, drawPointType, paths, viewTransform: vt, selection } = stateRef.current;

    // Middle mouse = pan
    if (e.button === 1) {
      panRef.current = {
        startOriginX: vt.originX, startOriginY: vt.originY,
        startX: x, startY: y,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    // Hand tool = pan
    if (toolMode === 'hand') {
      panRef.current = {
        startOriginX: vt.originX, startOriginY: vt.originY,
        startX: x, startY: y,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    if (toolMode === 'select') {
      const hitId = hitTest(x, y, paths, vt);
      if (hitId) {
        const fp = toFontSpace(x, y, vt);
        dragRef.current = { type: 'point', startFx: fp.x, startFy: fp.y, curFx: fp.x, curFy: fp.y, rbStartX: 0, rbStartY: 0 };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        if (e.shiftKey) {
          dispatch({ type: 'TOGGLE_SELECTION', pointId: hitId });
        } else if (!selection.pointIds.has(hitId)) {
          dispatch({ type: 'SET_SELECTION', pointIds: new Set([hitId]) });
        }
      } else {
        dragRef.current = { type: 'canvas', startFx: 0, startFy: 0, curFx: 0, curFy: 0, rbStartX: x, rbStartY: y };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        if (!e.shiftKey) dispatch({ type: 'SET_SELECTION', pointIds: new Set() });
      }
    } else if (toolMode === 'draw') {
      const fp = toFontSpace(x, y, vt);

      if (drawPointType === 'off-curve') {
        // Buffer this point as a pending control; will be consumed on next on-curve click
        pendingOffCurveRef.current = { x: fp.x, y: fp.y };
        setPendingOffCurve({ x: fp.x, y: fp.y });
        redraw();
        return;
      }

      // on-curve click: consume any pending off-curve to form a Q command
      const pending = pendingOffCurveRef.current;
      const id = `pt-draw-${Date.now()}`;

      if (paths.length === 0) {
        const newPath = {
          id: `path-${Date.now()}`,
          commands: [{ kind: 'M' as const, point: { id, x: fp.x, y: fp.y, type: 'on-curve' as const } }],
        };
        dispatch({ type: 'SET_PATHS', paths: [newPath] });
        pendingOffCurveRef.current = null;
        setPendingOffCurve(null);
      } else {
        const lastPath = paths[paths.length - 1];
        if (pending) {
          // Pending off-curve + this on-curve → quadratic segment
          const ctrlId = `pt-ctrl-${Date.now()}`;
          dispatch({
            type: 'ADD_POINT',
            pathId: lastPath.id,
            command: {
              kind: 'Q' as const,
              ctrl: { id: ctrlId, x: pending.x, y: pending.y, type: 'off-curve-quad' as const },
              point: { id, x: fp.x, y: fp.y, type: 'on-curve' as const },
            },
          });
          pendingOffCurveRef.current = null;
          setPendingOffCurve(null);
        } else {
          dispatch({
            type: 'ADD_POINT',
            pathId: lastPath.id,
            command: { kind: 'L' as const, point: { id, x: fp.x, y: fp.y, type: 'on-curve' as const } },
          });
        }
      }
      redraw();
    }
  }, [stateRef, dispatch, getEventPos, setPendingOffCurve, redraw]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const { x, y } = getEventPos(e);
    const { viewTransform: vt, selection, toolMode } = stateRef.current;

    if (panRef.current) {
      const { startOriginX, startOriginY, startX, startY } = panRef.current;
      dispatch({
        type: 'SET_VIEW_TRANSFORM',
        vt: { ...vt, originX: startOriginX + (x - startX), originY: startOriginY + (y - startY) },
      });
      redraw();
      return;
    }

    setMousePos({ x, y });

    if (!dragRef.current) {
      if (toolMode === 'draw' || toolMode === 'select') redraw();
      return;
    }

    const drag = dragRef.current;

    if (drag.type === 'point' && selection.pointIds.size > 0) {
      const fp = toFontSpace(x, y, vt);
      const deltaX = fp.x - drag.curFx;
      const deltaY = fp.y - drag.curFy;
      drag.curFx = fp.x;
      drag.curFy = fp.y;

      const deltas = new Map<string, { x: number; y: number }>();
      for (const id of selection.pointIds) {
        deltas.set(id, { x: deltaX, y: deltaY });
      }
      dispatch({ type: 'MOVE_POINTS', deltas });
      redraw();
    } else if (drag.type === 'canvas') {
      const rb: RubberBand = { x1: drag.rbStartX, y1: drag.rbStartY, x2: x, y2: y };
      setRubberBand(rb);
      redraw();
    }
  }, [stateRef, dispatch, getEventPos, setRubberBand, setMousePos, redraw]);

  const onPointerUp = useCallback((e: PointerEvent) => {
    const { x, y } = getEventPos(e);
    const { paths, viewTransform: vt, selection } = stateRef.current;

    if (panRef.current) { panRef.current = null; return; }
    if (!dragRef.current) return;
    const drag = dragRef.current;
    dragRef.current = null;

    if (drag.type === 'canvas') {
      const ids = pointsInRect(drag.rbStartX, drag.rbStartY, x, y, paths, vt);
      if (ids.size > 0) {
        if (e.shiftKey) {
          dispatch({ type: 'SET_SELECTION', pointIds: new Set([...selection.pointIds, ...ids]) });
        } else {
          dispatch({ type: 'SET_SELECTION', pointIds: ids });
        }
      }
      setRubberBand(null);
      redraw();
    }
  }, [stateRef, dispatch, getEventPos, setRubberBand, redraw]);

  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const { x, y } = getEventPos(e);
    const { viewTransform: vt } = stateRef.current;
    const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = Math.max(0.05, Math.min(50, vt.scale * zoomFactor));
    const newOriginX = x - (x - vt.originX) * (newScale / vt.scale);
    const newOriginY = y - (y - vt.originY) * (newScale / vt.scale);
    dispatch({ type: 'SET_VIEW_TRANSFORM', vt: { scale: newScale, originX: newOriginX, originY: newOriginY } });
    redraw();
  }, [stateRef, dispatch, getEventPos, redraw]);

  const onPointerLeave = useCallback(() => {
    setMousePos(null);
    redraw();
  }, [setMousePos, redraw]);

  return { onPointerDown, onPointerMove, onPointerUp, onWheel, onPointerLeave };
}
