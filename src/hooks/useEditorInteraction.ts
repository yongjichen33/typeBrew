import { useCallback, useRef } from 'react';
import type { EditablePath, ViewTransform, Selection, RubberBand } from '@/lib/editorTypes';
import { collectAllPoints, clonePaths } from '@/lib/svgPathParser';

const HIT_RADIUS_PX = 8;

/** Convert screen (canvas) coordinates to font-space (Y-up). */
function toFontSpace(sx: number, sy: number, vt: ViewTransform): { x: number; y: number } {
  return {
    x: (sx - vt.originX) / vt.scale,
    y: -(sy - vt.originY) / vt.scale,
  };
}

/** Convert font-space coordinates to screen (canvas). */
function toScreen(fx: number, fy: number, vt: ViewTransform): { x: number; y: number } {
  return {
    x: vt.originX + fx * vt.scale,
    y: vt.originY - fy * vt.scale,
  };
}

/** Find the closest point within hit radius (screen pixels). Returns point id or null. */
function hitTest(
  sx: number, sy: number,
  paths: EditablePath[],
  vt: ViewTransform,
): string | null {
  const pts = collectAllPoints(paths);
  const hitSq = (HIT_RADIUS_PX / vt.scale) ** 2;
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

/** Distance from point (px, py) to line segment (x1,y1)-(x2,y2) */
function pointToSegmentDistance(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  
  if (lenSq === 0) {
    return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  }
  
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

/** Distance from point to quadratic Bezier curve (approximated by sampling) */
function pointToQuadDistance(
  px: number, py: number,
  x0: number, y0: number,
  cx: number, cy: number,
  x1: number, y1: number,
  samples: number = 10,
): number {
  let minDist = Infinity;
  
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    // Quadratic Bezier: B(t) = (1-t)²P0 + 2(1-t)tC + t²P1
    const mt = 1 - t;
    const bx = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
    const by = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
    const dist = Math.sqrt((px - bx) ** 2 + (py - by) ** 2);
    if (dist < minDist) minDist = dist;
  }
  
  return minDist;
}

/** Distance from point to cubic Bezier curve (approximated by sampling) */
function pointToCubicDistance(
  px: number, py: number,
  x0: number, y0: number,
  c1x: number, c1y: number,
  c2x: number, c2y: number,
  x1: number, y1: number,
  samples: number = 15,
): number {
  let minDist = Infinity;
  
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    // Cubic Bezier: B(t) = (1-t)³P0 + 3(1-t)²tC1 + 3(1-t)t²C2 + t³P1
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;
    const t2 = t * t;
    const t3 = t2 * t;
    const bx = mt3 * x0 + 3 * mt2 * t * c1x + 3 * mt * t2 * c2x + t3 * x1;
    const by = mt3 * y0 + 3 * mt2 * t * c1y + 3 * mt * t2 * c2y + t3 * y1;
    const dist = Math.sqrt((px - bx) ** 2 + (py - by) ** 2);
    if (dist < minDist) minDist = dist;
  }
  
  return minDist;
}

/** Find the closest segment (line or curve) within hit radius. Returns segment id or null. */
function hitTestSegment(
  sx: number, sy: number,
  paths: EditablePath[],
  vt: ViewTransform,
): string | null {
  const hitRadius = HIT_RADIUS_PX;
  let closestId: string | null = null;
  let closestDist = hitRadius;

  for (const path of paths) {
    let lastOnCurve: { id: string; x: number; y: number } | null = null;

    for (const cmd of path.commands) {
      if (cmd.kind === 'M') {
        lastOnCurve = cmd.point;
      } else if (cmd.kind === 'L' && lastOnCurve) {
        const p1 = toScreen(lastOnCurve.x, lastOnCurve.y, vt);
        const p2 = toScreen(cmd.point.x, cmd.point.y, vt);
        
        const dist = pointToSegmentDistance(sx, sy, p1.x, p1.y, p2.x, p2.y);
        if (dist < closestDist) {
          closestDist = dist;
          closestId = `${path.id}:${lastOnCurve.id}:${cmd.point.id}`;
        }
        lastOnCurve = cmd.point;
      } else if (cmd.kind === 'Q' && lastOnCurve) {
        const p0 = toScreen(lastOnCurve.x, lastOnCurve.y, vt);
        const pc = toScreen(cmd.ctrl.x, cmd.ctrl.y, vt);
        const p1 = toScreen(cmd.point.x, cmd.point.y, vt);
        
        const dist = pointToQuadDistance(sx, sy, p0.x, p0.y, pc.x, pc.y, p1.x, p1.y);
        if (dist < closestDist) {
          closestDist = dist;
          closestId = `${path.id}:${lastOnCurve.id}:${cmd.point.id}`;
        }
        lastOnCurve = cmd.point;
      } else if (cmd.kind === 'C' && lastOnCurve) {
        const p0 = toScreen(lastOnCurve.x, lastOnCurve.y, vt);
        const c1 = toScreen(cmd.ctrl1.x, cmd.ctrl1.y, vt);
        const c2 = toScreen(cmd.ctrl2.x, cmd.ctrl2.y, vt);
        const p1 = toScreen(cmd.point.x, cmd.point.y, vt);
        
        const dist = pointToCubicDistance(sx, sy, p0.x, p0.y, c1.x, c1.y, c2.x, c2.y, p1.x, p1.y);
        if (dist < closestDist) {
          closestDist = dist;
          closestId = `${path.id}:${lastOnCurve.id}:${cmd.point.id}`;
        }
        lastOnCurve = cmd.point;
      }
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
    viewTransform: ViewTransform;
    showDirection: boolean;
    showCoordinates: boolean;
    activePathId: string | null;
    isDrawingPath: boolean;
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
    /** Pre-drag snapshot saved once on pointerdown; committed to undo on pointerup. */
    snapshot: EditablePath[] | null;
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
    const { toolMode, paths, viewTransform: vt, selection } = stateRef.current;

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

    // Node tool: select and drag points and segments
    if (toolMode === 'node') {
      // First check for point hit
      const hitPointId = hitTest(x, y, paths, vt);
      
      if (hitPointId) {
        // Point was hit - select/deselect point
        const fp = toFontSpace(x, y, vt);
        dragRef.current = { type: 'point', startFx: fp.x, startFy: fp.y, curFx: fp.x, curFy: fp.y, rbStartX: 0, rbStartY: 0, snapshot: clonePaths(paths) };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        if (e.shiftKey) {
          dispatch({ type: 'TOGGLE_SELECTION', pointId: hitPointId });
        } else if (!selection.pointIds.has(hitPointId)) {
          dispatch({ type: 'SET_SELECTION', pointIds: new Set([hitPointId]) });
        }
      } else {
        // Check for segment hit
        const hitSegmentId = hitTestSegment(x, y, paths, vt);
        
        if (hitSegmentId) {
          // Segment was hit - select/deselect segment
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          if (e.shiftKey) {
            dispatch({ type: 'TOGGLE_SEGMENT_SELECTION', segmentId: hitSegmentId });
          } else if (!selection.segmentIds.has(hitSegmentId)) {
            dispatch({ type: 'SET_SELECTION', pointIds: new Set(), segmentIds: new Set([hitSegmentId]) });
          }
        } else {
          // Nothing hit - start rubber band or clear selection
          dragRef.current = { type: 'canvas', startFx: 0, startFy: 0, curFx: 0, curFy: 0, rbStartX: x, rbStartY: y, snapshot: null };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          if (!e.shiftKey) dispatch({ type: 'CLEAR_SELECTION' });
        }
      }
    }

    // Pen tool: draw bezier curves
    if (toolMode === 'pen') {
      const fp = toFontSpace(x, y, vt);
      const { activePathId, isDrawingPath } = stateRef.current;

      // Check if active path still exists and has points
      const activePath = activePathId ? paths.find(p => p.id === activePathId) : null;
      const canAppend = activePathId && isDrawingPath && activePath && activePath.commands.length > 0;

      if (!canAppend) {
        // Start a new path
        const newPathId = `path-${Date.now()}`;
        const pointId = `pt-${Date.now()}`;
        const newPath = {
          id: newPathId,
          commands: [{ kind: 'M' as const, point: { id: pointId, x: fp.x, y: fp.y, type: 'on-curve' as const } }],
        };
        dispatch({ type: 'START_NEW_PATH', path: newPath });
      } else {
        // Add point to existing path
        const pointId = `pt-${Date.now()}`;
        const pending = pendingOffCurveRef.current;

        if (pending) {
          // Create cubic curve with pending control point
          const ctrl1Id = `pt-ctrl1-${Date.now()}`;
          const ctrl2Id = `pt-ctrl2-${Date.now()}`;
          dispatch({
            type: 'APPEND_TO_ACTIVE_PATH',
            command: {
              kind: 'C' as const,
              ctrl1: { id: ctrl1Id, x: pending.x, y: pending.y, type: 'off-curve-cubic' as const },
              ctrl2: { id: ctrl2Id, x: fp.x, y: fp.y, type: 'off-curve-cubic' as const },
              point: { id: pointId, x: fp.x, y: fp.y, type: 'on-curve' as const },
            },
          });
          pendingOffCurveRef.current = null;
          setPendingOffCurve(null);
        } else {
          // Create line
          dispatch({
            type: 'APPEND_TO_ACTIVE_PATH',
            command: { kind: 'L' as const, point: { id: pointId, x: fp.x, y: fp.y, type: 'on-curve' as const } },
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
      dispatch({ type: 'MOVE_POINTS_LIVE', deltas });
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

    if (drag.type === 'point') {
      // Only commit if the point actually moved
      if (drag.snapshot && (drag.curFx !== drag.startFx || drag.curFy !== drag.startFy)) {
        dispatch({ type: 'COMMIT_MOVE', snapshot: drag.snapshot });
      }
    } else if (drag.type === 'canvas') {
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
