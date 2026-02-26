import { useCallback, useRef } from 'react';
import type { EditablePath, ViewTransform, Selection, RubberBand, Layer } from '@/lib/editorTypes';
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

export type TransformHandle = 
  | 'tl' | 'tr' | 'bl' | 'br' 
  | 'tm' | 'bm' | 'lm' | 'rm' 
  | 'rotate' | 'move'
  | null;

export interface SelectionBBox {
  minX: number; minY: number; maxX: number; maxY: number;
}

export function computeSelectionBBox(
  paths: EditablePath[],
  selection: Selection,
): SelectionBBox | null {
  const selectedPoints: Array<{ x: number; y: number }> = [];

  for (const path of paths) {
    let lastOnCurve: { id: string; x: number; y: number } | null = null;
    let firstOnCurve: { id: string; x: number; y: number } | null = null;
    const isClosed = path.commands[path.commands.length - 1]?.kind === 'Z';

    for (const cmd of path.commands) {
      if (cmd.kind === 'M') {
        if (selection.pointIds.has(cmd.point.id)) {
          selectedPoints.push(cmd.point);
        }
        lastOnCurve = cmd.point;
        firstOnCurve = cmd.point;
      } else if (cmd.kind === 'L' && lastOnCurve) {
        const segmentId = `${path.id}:${lastOnCurve.id}:${cmd.point.id}`;
        if (selection.segmentIds.has(segmentId)) {
          selectedPoints.push(lastOnCurve);
          selectedPoints.push(cmd.point);
        } else if (selection.pointIds.has(cmd.point.id)) {
          selectedPoints.push(cmd.point);
        }
        lastOnCurve = cmd.point;
      } else if (cmd.kind === 'Q' && lastOnCurve) {
        const segmentId = `${path.id}:${lastOnCurve.id}:${cmd.point.id}`;
        if (selection.segmentIds.has(segmentId)) {
          selectedPoints.push(lastOnCurve);
          selectedPoints.push(cmd.ctrl);
          selectedPoints.push(cmd.point);
        } else {
          if (selection.pointIds.has(cmd.ctrl.id)) selectedPoints.push(cmd.ctrl);
          if (selection.pointIds.has(cmd.point.id)) selectedPoints.push(cmd.point);
        }
        lastOnCurve = cmd.point;
      } else if (cmd.kind === 'C' && lastOnCurve) {
        const segmentId = `${path.id}:${lastOnCurve.id}:${cmd.point.id}`;
        if (selection.segmentIds.has(segmentId)) {
          selectedPoints.push(lastOnCurve);
          selectedPoints.push(cmd.ctrl1);
          selectedPoints.push(cmd.ctrl2);
          selectedPoints.push(cmd.point);
        } else {
          if (selection.pointIds.has(cmd.ctrl1.id)) selectedPoints.push(cmd.ctrl1);
          if (selection.pointIds.has(cmd.ctrl2.id)) selectedPoints.push(cmd.ctrl2);
          if (selection.pointIds.has(cmd.point.id)) selectedPoints.push(cmd.point);
        }
        lastOnCurve = cmd.point;
      }
    }
    
    // Handle closing segment in closed path
    if (isClosed && lastOnCurve && firstOnCurve && lastOnCurve.id !== firstOnCurve.id) {
      const segmentId = `${path.id}:${lastOnCurve.id}:${firstOnCurve.id}`;
      if (selection.segmentIds.has(segmentId)) {
        selectedPoints.push(lastOnCurve);
        selectedPoints.push(firstOnCurve);
      }
    }
  }

  if (selectedPoints.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pt of selectedPoints) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }

  return { minX, minY, maxX, maxY };
}

function hitTestTransformHandle(
  sx: number, sy: number,
  bbox: SelectionBBox,
  vt: ViewTransform,
): TransformHandle {
  const p1 = toScreen(bbox.minX, bbox.maxY, vt);
  const p2 = toScreen(bbox.maxX, bbox.minY, vt);
  
  const padding = 8;
  const left = p1.x - padding;
  const top = p1.y - padding;
  const right = p2.x + padding;
  const bottom = p2.y + padding;
  const midX = (left + right) / 2;
  const midY = (top + bottom) / 2;
  
  const HANDLE_R = 8;
  const ROTATION_R = 10;
  const ROTATION_OFFSET = 20;
  const rotationY = top - ROTATION_OFFSET;

  const dist = (x1: number, y1: number, x2: number, y2: number) => 
    Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);

  if (dist(sx, sy, midX, rotationY) < ROTATION_R) return 'rotate';
  if (dist(sx, sy, left, top) < HANDLE_R) return 'tl';
  if (dist(sx, sy, right, top) < HANDLE_R) return 'tr';
  if (dist(sx, sy, left, bottom) < HANDLE_R) return 'bl';
  if (dist(sx, sy, right, bottom) < HANDLE_R) return 'br';
  if (dist(sx, sy, midX, top) < HANDLE_R) return 'tm';
  if (dist(sx, sy, midX, bottom) < HANDLE_R) return 'bm';
  if (dist(sx, sy, left, midY) < HANDLE_R) return 'lm';
  if (dist(sx, sy, right, midY) < HANDLE_R) return 'rm';

  if (sx >= left && sx <= right && sy >= top && sy <= bottom) {
    return 'move';
  }

  return null;
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
    let firstOnCurve: { id: string; x: number; y: number } | null = null;
    const isClosed = path.commands[path.commands.length - 1]?.kind === 'Z';

    for (const cmd of path.commands) {
      if (cmd.kind === 'M') {
        lastOnCurve = cmd.point;
        firstOnCurve = cmd.point;
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
    
    // Handle closing segment (last point back to first point in closed path)
    if (isClosed && lastOnCurve && firstOnCurve && lastOnCurve.id !== firstOnCurve.id) {
      const p1 = toScreen(lastOnCurve.x, lastOnCurve.y, vt);
      const p2 = toScreen(firstOnCurve.x, firstOnCurve.y, vt);
      
      const dist = pointToSegmentDistance(sx, sy, p1.x, p1.y, p2.x, p2.y);
      if (dist < closestDist) {
        closestDist = dist;
        closestId = `${path.id}:${lastOnCurve.id}:${firstOnCurve.id}`;
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
    layers: Layer[];
    activeLayerId: string;
  }>;
  dispatch: (action: unknown) => void;
  setRubberBand: (rb: RubberBand | null) => void;
  setMousePos: (pos: { x: number; y: number } | null) => void;
  setPendingOffCurve: (pos: { x: number; y: number } | null) => void;
  redraw: () => void;
  getCanvasRect: () => DOMRect | null;
  onTransformFeedback?: (feedback: { isActive: boolean; deltaX: number; deltaY: number; scaleX: number; scaleY: number; rotation: number }) => void;
  setHoveredPointId: (id: string | null) => void;
  setHoveredSegmentId: (id: string | null) => void;
  setDragPos: (pos: { x: number; y: number } | null) => void;
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
  onTransformFeedback,
  setHoveredPointId,
  setHoveredSegmentId,
  setDragPos,
}: InteractionParams) {
  const dragRef = useRef<{
    type: 'point' | 'canvas' | 'transform';
    startFx: number; startFy: number;
    curFx: number; curFy: number;
    rbStartX: number; rbStartY: number;
    snapshot: EditablePath[] | null;
    transformHandle?: TransformHandle;
    transformBBox?: SelectionBBox;
    transformCenter?: { x: number; y: number };
    startScreenX?: number;
    startScreenY?: number;
  } | null>(null);

  const panRef = useRef<{
    startOriginX: number; startOriginY: number;
    startX: number; startY: number;
  } | null>(null);

  const pendingOffCurveRef = useRef<{ x: number; y: number } | null>(null);
  const hoveredHandleRef = useRef<TransformHandle>(null);

  const getCursor = useCallback((): string => {
    if (dragRef.current?.type === 'transform' && dragRef.current.transformHandle === 'move') {
      return 'grabbing';
    }
    const handle = hoveredHandleRef.current;
    if (!handle) return 'default';
    if (handle === 'move') return 'grab';
    if (handle === 'rotate') return 'crosshair';
    if (handle === 'tl' || handle === 'br') return 'nwse-resize';
    if (handle === 'tr' || handle === 'bl') return 'nesw-resize';
    if (handle === 'tm' || handle === 'bm') return 'ns-resize';
    if (handle === 'lm' || handle === 'rm') return 'ew-resize';
    return 'default';
  }, []);

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
      const totalSelected = selection.pointIds.size + selection.segmentIds.size;
      
      // Check for transform handle hit (only if more than one element selected)
      if (totalSelected > 1) {
        const bbox = computeSelectionBBox(paths, selection);
        if (bbox) {
          const hitHandle = hitTestTransformHandle(x, y, bbox, vt);
          if (hitHandle) {
            const fp = toFontSpace(x, y, vt);
            const center = { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2 };
            dragRef.current = {
              type: 'transform',
              startFx: fp.x,
              startFy: fp.y,
              curFx: fp.x,
              curFy: fp.y,
              rbStartX: 0,
              rbStartY: 0,
              snapshot: clonePaths(paths),
              transformHandle: hitHandle,
              transformBBox: bbox,
              transformCenter: center,
              startScreenX: x,
              startScreenY: y,
            };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            return;
          }
        }
      }

      // Check for point hit
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
      if (toolMode === 'node') {
        const { paths } = stateRef.current;
        const totalSelected = selection.pointIds.size + selection.segmentIds.size;
        if (totalSelected > 1) {
          const bbox = computeSelectionBBox(paths, selection);
          if (bbox) {
            const hoveredHandle = hitTestTransformHandle(x, y, bbox, vt);
            if (hoveredHandleRef.current !== hoveredHandle) {
              hoveredHandleRef.current = hoveredHandle;
              redraw();
            }
          } else {
            hoveredHandleRef.current = null;
          }
        } else {
          hoveredHandleRef.current = null;
        }
        
        // Hover detection for points and segments
        const hitPointId = hitTest(x, y, paths, vt);
        const hitSegmentId = hitPointId ? null : hitTestSegment(x, y, paths, vt);
        
        setHoveredPointId(hitPointId);
        setHoveredSegmentId(hitSegmentId);
      } else {
        hoveredHandleRef.current = null;
        setHoveredPointId(null);
        setHoveredSegmentId(null);
      }
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
      setDragPos({ x: fp.x, y: fp.y });
      redraw();
    } else if (drag.type === 'canvas') {
      const rb: RubberBand = { x1: drag.rbStartX, y1: drag.rbStartY, x2: x, y2: y };
      setRubberBand(rb);
      redraw();
    } else if (drag.type === 'transform' && drag.transformBBox && drag.transformCenter && drag.snapshot) {
      const fp = toFontSpace(x, y, vt);
      const bbox = drag.transformBBox;
      const center = drag.transformCenter;
      const handle = drag.transformHandle;

      const deltas = new Map<string, { x: number; y: number }>();
      
      const collectPointsFromPaths = (paths: EditablePath[]) => {
        const pts: Array<{ id: string; x: number; y: number }> = [];
        for (const path of paths) {
          let lastOnCurve: { id: string; x: number; y: number } | null = null;
          let firstOnCurve: { id: string; x: number; y: number } | null = null;
          const isClosed = path.commands[path.commands.length - 1]?.kind === 'Z';
          
          for (const cmd of path.commands) {
            if (cmd.kind === 'M') {
              if (selection.pointIds.has(cmd.point.id)) pts.push(cmd.point);
              lastOnCurve = cmd.point;
              firstOnCurve = cmd.point;
            } else if (cmd.kind === 'L' && lastOnCurve) {
              const segId = `${path.id}:${lastOnCurve.id}:${cmd.point.id}`;
              if (selection.segmentIds.has(segId)) {
                pts.push(lastOnCurve);
                pts.push(cmd.point);
              } else if (selection.pointIds.has(cmd.point.id)) {
                pts.push(cmd.point);
              }
              lastOnCurve = cmd.point;
            } else if (cmd.kind === 'Q' && lastOnCurve) {
              const segId = `${path.id}:${lastOnCurve.id}:${cmd.point.id}`;
              if (selection.segmentIds.has(segId)) {
                pts.push(lastOnCurve);
                pts.push(cmd.ctrl);
                pts.push(cmd.point);
              } else {
                if (selection.pointIds.has(cmd.ctrl.id)) pts.push(cmd.ctrl);
                if (selection.pointIds.has(cmd.point.id)) pts.push(cmd.point);
              }
              lastOnCurve = cmd.point;
            } else if (cmd.kind === 'C' && lastOnCurve) {
              const segId = `${path.id}:${lastOnCurve.id}:${cmd.point.id}`;
              if (selection.segmentIds.has(segId)) {
                pts.push(lastOnCurve);
                pts.push(cmd.ctrl1);
                pts.push(cmd.ctrl2);
                pts.push(cmd.point);
              } else {
                if (selection.pointIds.has(cmd.ctrl1.id)) pts.push(cmd.ctrl1);
                if (selection.pointIds.has(cmd.ctrl2.id)) pts.push(cmd.ctrl2);
                if (selection.pointIds.has(cmd.point.id)) pts.push(cmd.point);
              }
              lastOnCurve = cmd.point;
            }
          }
          
          // Handle closing segment in closed path
          if (isClosed && lastOnCurve && firstOnCurve && lastOnCurve.id !== firstOnCurve.id) {
            const segId = `${path.id}:${lastOnCurve.id}:${firstOnCurve.id}`;
            if (selection.segmentIds.has(segId)) {
              pts.push(lastOnCurve);
              pts.push(firstOnCurve);
            }
          }
        }
        return pts;
      };

      const originalPoints = collectPointsFromPaths(drag.snapshot);
      const currentPoints = collectPointsFromPaths(stateRef.current.paths);
      
      const getCurrentPos = (id: string) => currentPoints.find(p => p.id === id);

      if (handle === 'rotate') {
        const startAngle = Math.atan2(drag.startFy - center.y, drag.startFx - center.x);
        const currentAngle = Math.atan2(fp.y - center.y, fp.x - center.x);
        const angleDelta = currentAngle - startAngle;
        const rotation = angleDelta * 180 / Math.PI;
        const cos = Math.cos(angleDelta);
        const sin = Math.sin(angleDelta);

        for (const origPt of originalPoints) {
          const dx = origPt.x - center.x;
          const dy = origPt.y - center.y;
          const targetX = center.x + dx * cos - dy * sin;
          const targetY = center.y + dx * sin + dy * cos;
          
          const currentPt = getCurrentPos(origPt.id);
          if (currentPt) {
            deltas.set(origPt.id, { x: targetX - currentPt.x, y: targetY - currentPt.y });
          }
        }
        
        onTransformFeedback?.({ isActive: true, deltaX: 0, deltaY: 0, scaleX: 1, scaleY: 1, rotation });
      } else if (handle === 'move') {
        const deltaX = fp.x - drag.startFx;
        const deltaY = fp.y - drag.startFy;

        for (const origPt of originalPoints) {
          const targetX = origPt.x + deltaX;
          const targetY = origPt.y + deltaY;
          
          const currentPt = getCurrentPos(origPt.id);
          if (currentPt) {
            deltas.set(origPt.id, { x: targetX - currentPt.x, y: targetY - currentPt.y });
          }
        }
        
        onTransformFeedback?.({ isActive: true, deltaX, deltaY, scaleX: 1, scaleY: 1, rotation: 0 });
      } else {
        let scaleX = 1, scaleY = 1;
        const bboxW = bbox.maxX - bbox.minX;
        const bboxH = bbox.maxY - bbox.minY;
        
        const screenBboxW = bboxW * vt.scale;
        const screenBboxH = bboxH * vt.scale;
        
        const screenDeltaX = x - (drag.startScreenX ?? x);
        const screenDeltaY = y - (drag.startScreenY ?? y);

        if (handle === 'tl' || handle === 'tr' || handle === 'tm') {
          scaleY = screenBboxH > 0 ? 1 - screenDeltaY / screenBboxH : 1;
        }
        if (handle === 'bl' || handle === 'br' || handle === 'bm') {
          scaleY = screenBboxH > 0 ? 1 + screenDeltaY / screenBboxH : 1;
        }
        if (handle === 'tl' || handle === 'bl' || handle === 'lm') {
          scaleX = screenBboxW > 0 ? 1 - screenDeltaX / screenBboxW : 1;
        }
        if (handle === 'tr' || handle === 'br' || handle === 'rm') {
          scaleX = screenBboxW > 0 ? 1 + screenDeltaX / screenBboxW : 1;
        }

        if (e.shiftKey && (handle === 'tl' || handle === 'tr' || handle === 'bl' || handle === 'br')) {
          const maxScale = Math.max(Math.abs(scaleX), Math.abs(scaleY));
          scaleX = scaleX < 0 ? -maxScale : maxScale;
          scaleY = scaleY < 0 ? -maxScale : maxScale;
        }

        for (const origPt of originalPoints) {
          const targetX = center.x + (origPt.x - center.x) * scaleX;
          const targetY = center.y + (origPt.y - center.y) * scaleY;
          
          const currentPt = getCurrentPos(origPt.id);
          if (currentPt) {
            deltas.set(origPt.id, { x: targetX - currentPt.x, y: targetY - currentPt.y });
          }
        }
        
        onTransformFeedback?.({ isActive: true, deltaX: 0, deltaY: 0, scaleX, scaleY, rotation: 0 });
      }

      setDragPos({ x: center.x, y: center.y });
      dispatch({ type: 'TRANSFORM_POINTS_LIVE', deltas });
      redraw();
    } else {
      onTransformFeedback?.({ isActive: false, deltaX: 0, deltaY: 0, scaleX: 1, scaleY: 1, rotation: 0 });
      setDragPos(null);
    }
  }, [stateRef, dispatch, getEventPos, setRubberBand, setMousePos, redraw, onTransformFeedback, setDragPos]);

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
      setDragPos(null);
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
    } else if (drag.type === 'transform') {
      const deltaX = drag.curFx - drag.startFx;
      const deltaY = drag.curFy - drag.startFy;
      const threshold = 0; // 10 units in font space
      
      if (drag.snapshot && (Math.abs(deltaX) > threshold || Math.abs(deltaY) > threshold)) {
        dispatch({ type: 'COMMIT_TRANSFORM', snapshot: drag.snapshot });
      }
      onTransformFeedback?.({ isActive: false, deltaX: 0, deltaY: 0, scaleX: 1, scaleY: 1, rotation: 0 });
      setDragPos(null);
      redraw();
    }
  }, [stateRef, dispatch, getEventPos, setRubberBand, redraw, onTransformFeedback, setDragPos]);

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
    hoveredHandleRef.current = null;
    setHoveredPointId(null);
    setHoveredSegmentId(null);
    redraw();
  }, [setMousePos, redraw, setHoveredPointId, setHoveredSegmentId]);

  return { onPointerDown, onPointerMove, onPointerUp, onWheel, onPointerLeave, getCursor };
}
