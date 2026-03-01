import { useCallback, useLayoutEffect, useRef } from 'react';
import type {
  EditablePath,
  ViewTransform,
  Selection,
  RubberBand,
  Layer,
  ImageLayer,
  ComponentInfo,
  HistoryEntry,
} from '@/lib/editorTypes';
import { collectAllPoints, clonePaths, getPoint, getComponentAtPath } from '@/lib/svgPathParser';

const HIT_RADIUS_PX = 8;
const DRAG_THRESHOLD_PX = 4;

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
function hitTest(sx: number, sy: number, paths: EditablePath[], vt: ViewTransform): string | null {
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

/** Get accumulated x/y offset for a component path through the tree. */
function getAccumulatedOffset(
  components: ComponentInfo[],
  path: number[]
): { dx: number; dy: number } {
  let dx = 0,
    dy = 0;
  let current = components;
  for (const idx of path) {
    if (!current[idx]) break;
    dx += current[idx].xOffset;
    dy += current[idx].yOffset;
    current = current[idx].subComponents;
  }
  return { dx, dy };
}

/** Adjust a ViewTransform to account for the active component's accumulated offset. */
function adjustVtForComponent(
  vt: ViewTransform,
  isComposite: boolean,
  path: number[],
  components: ComponentInfo[]
): ViewTransform {
  if (!isComposite || path.length === 0) return vt;
  const { dx, dy } = getAccumulatedOffset(components, path);
  return { ...vt, originX: vt.originX + dx * vt.scale, originY: vt.originY - dy * vt.scale };
}

/** Distance from point (px, py) to line segment (x1,y1)-(x2,y2) */
function pointToSegmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
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
  px: number,
  py: number,
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  samples: number = 10
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
  px: number,
  py: number,
  x0: number,
  y0: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  x1: number,
  y1: number,
  samples: number = 15
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
  | 'tl'
  | 'tr'
  | 'bl'
  | 'br'
  | 'tm'
  | 'bm'
  | 'lm'
  | 'rm'
  | 'rotate'
  | 'move'
  | null;

export interface SelectionBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function computeSelectionBBox(
  paths: EditablePath[],
  selection: Selection
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

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const pt of selectedPoints) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }

  return { minX, minY, maxX, maxY };
}

const GLYPH_TRANSFORM_PAD = 8;
const GLYPH_HANDLE_HIT = 6;
const GLYPH_ROTATE_OFFSET = 24;
const GLYPH_ROTATE_HIT_R = 8;

/** Hit-test the glyph selection bounding box handles. Returns handle type or null. */
function hitTestGlyphTransformHandle(
  x: number,
  y: number,
  bbox: SelectionBBox,
  vt: ViewTransform
): TransformHandle {
  const sx1r = vt.originX + bbox.minX * vt.scale;
  const sy1r = vt.originY - bbox.maxY * vt.scale; // font maxY = screen top
  const sx2r = vt.originX + bbox.maxX * vt.scale;
  const sy2r = vt.originY - bbox.minY * vt.scale;
  const sx1 = sx1r - GLYPH_TRANSFORM_PAD,
    sy1 = sy1r - GLYPH_TRANSFORM_PAD;
  const sx2 = sx2r + GLYPH_TRANSFORM_PAD,
    sy2 = sy2r + GLYPH_TRANSFORM_PAD;
  const midX = (sx1 + sx2) / 2,
    midY = (sy1 + sy2) / 2;
  const rotY = sy1 - GLYPH_ROTATE_OFFSET;

  if (Math.hypot(x - midX, y - rotY) <= GLYPH_ROTATE_HIT_R) return 'rotate';

  const candidates: Array<[number, number, Exclude<TransformHandle, null>]> = [
    [sx1, sy1, 'tl'],
    [sx2, sy1, 'tr'],
    [sx1, sy2, 'bl'],
    [sx2, sy2, 'br'],
    [midX, sy1, 'tm'],
    [midX, sy2, 'bm'],
    [sx1, midY, 'lm'],
    [sx2, midY, 'rm'],
  ];
  for (const [hx, hy, h] of candidates) {
    if (Math.abs(x - hx) <= GLYPH_HANDLE_HIT && Math.abs(y - hy) <= GLYPH_HANDLE_HIT) return h;
  }
  if (x >= sx1 && x <= sx2 && y >= sy1 && y <= sy2) return 'move';
  return null;
}

/** Returns the fixed font-space origin point for a given scale handle. */
function getGlyphScaleOrigin(
  handle: TransformHandle,
  bbox: SelectionBBox
): { x: number; y: number } {
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  switch (handle) {
    case 'tl':
      return { x: bbox.maxX, y: bbox.minY }; // opposite = BR font-space
    case 'tr':
      return { x: bbox.minX, y: bbox.minY }; // opposite = BL
    case 'bl':
      return { x: bbox.maxX, y: bbox.maxY }; // opposite = TR
    case 'br':
      return { x: bbox.minX, y: bbox.maxY }; // opposite = TL
    case 'tm':
      return { x: cx, y: bbox.minY }; // opposite = BM center
    case 'bm':
      return { x: cx, y: bbox.maxY }; // opposite = TM center
    case 'lm':
      return { x: bbox.maxX, y: cy }; // opposite = RM center
    case 'rm':
      return { x: bbox.minX, y: cy }; // opposite = LM center
    default:
      return { x: cx, y: cy };
  }
}

/** Returns the path ID if sourcePointId is the last on-curve endpoint of an open path, else null. */
function getExtendablePathId(paths: EditablePath[], sourcePointId: string): string | null {
  for (const path of paths) {
    const cmds = path.commands;
    if (cmds.length === 0) continue;
    const lastCmd = cmds[cmds.length - 1];
    if (lastCmd.kind === 'Z') continue; // closed path — can't extend
    let lastPtId: string | null = null;
    if (lastCmd.kind === 'L' || lastCmd.kind === 'M') lastPtId = lastCmd.point.id;
    else if (lastCmd.kind === 'Q') lastPtId = lastCmd.point.id;
    else if (lastCmd.kind === 'C') lastPtId = lastCmd.point.id;
    if (lastPtId === sourcePointId) return path.id;
  }
  return null;
}

/** Find the insert index and kind for a segment, given its segment ID. Only L and closing-Z segments are "straight". */
function findSegmentInsertIndex(
  paths: EditablePath[],
  segmentId: string
): { pathId: string; insertIndex: number; isStraight: boolean } | null {
  const parts = segmentId.split(':');
  if (parts.length < 3) return null;
  const pathId = parts[0];
  const endId = parts[2];

  const path = paths.find((p) => p.id === pathId);
  if (!path) return null;

  // Closing segment: endId === first M point id — treated as straight
  const firstCmd = path.commands[0];
  if (firstCmd?.kind === 'M' && firstCmd.point.id === endId) {
    return { pathId, insertIndex: path.commands.length, isStraight: true };
  }

  for (let i = 0; i < path.commands.length; i++) {
    const cmd = path.commands[i];
    if ((cmd.kind === 'L' || cmd.kind === 'Q' || cmd.kind === 'C') && cmd.point.id === endId) {
      return { pathId, insertIndex: i, isStraight: cmd.kind === 'L' };
    }
  }
  return null;
}

/** Hit-test against an image layer's transform handles. Returns handle type or null. */
function hitTestImageHandle(
  sx: number,
  sy: number,
  il: ImageLayer,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  img: any,
  vt: ViewTransform
): TransformHandle {
  const cx = vt.originX + il.offsetX * vt.scale;
  const cy = vt.originY - il.offsetY * vt.scale;
  const halfW = (img.width() * il.scaleX * vt.scale) / 2;
  const halfH = (img.height() * il.scaleY * vt.scale) / 2;
  const angleRad = (il.rotation * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  // Transform screen point into image-local (unrotated) space
  const dx = sx - cx;
  const dy = sy - cy;
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;

  const HANDLE_R = 8;
  const ROTATION_OFFSET = 24;

  if (Math.sqrt(localX ** 2 + (localY + halfH + ROTATION_OFFSET) ** 2) < HANDLE_R) return 'rotate';

  const handles: Array<[number, number, TransformHandle]> = [
    [-halfW, -halfH, 'tl'],
    [halfW, -halfH, 'tr'],
    [-halfW, halfH, 'bl'],
    [halfW, halfH, 'br'],
    [0, -halfH, 'tm'],
    [0, halfH, 'bm'],
    [-halfW, 0, 'lm'],
    [halfW, 0, 'rm'],
  ];
  for (const [hx, hy, handle] of handles) {
    if (Math.sqrt((localX - hx) ** 2 + (localY - hy) ** 2) < HANDLE_R) return handle;
  }
  if (localX >= -halfW && localX <= halfW && localY >= -halfH && localY <= halfH) return 'move';
  return null;
}

/** Find the closest segment (line or curve) within hit radius. Returns segment id or null. */
function hitTestSegment(
  sx: number,
  sy: number,
  paths: EditablePath[],
  vt: ViewTransform
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
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  paths: EditablePath[],
  vt: ViewTransform
): Set<string> {
  const minX = Math.min(x1, x2),
    maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2),
    maxY = Math.max(y1, y2);

  const result = new Set<string>();
  const pts = collectAllPoints(paths);

  for (const pt of pts) {
    const [sx, sy] = [vt.originX + pt.x * vt.scale, vt.originY - pt.y * vt.scale];
    if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
      result.add(pt.id);
    }
  }
  return result;
}

interface InteractionParams {
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
    focusedLayerId: string;
    showTransformBox: boolean;
    isComposite: boolean;
    components: ComponentInfo[];
    activeComponentPath: number[];
  }>;
  dispatch: (action: unknown) => void;
  setRubberBand: (rb: RubberBand | null) => void;
  setMousePos: (pos: { x: number; y: number } | null) => void;
  setPendingOffCurve: (pos: { x: number; y: number } | null) => void;
  redraw: () => void;
  getCanvasRect: () => DOMRect | null;
  onTransformFeedback?: (feedback: {
    isActive: boolean;
    deltaX: number;
    deltaY: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
  }) => void;
  setHoveredPointId: (id: string | null) => void;
  setHoveredSegmentId: (id: string | null) => void;
  setDragPos: (pos: { x: number; y: number } | null) => void;
  setConnectPreview: (
    preview: { fromX: number; fromY: number; toX: number; toY: number } | null
  ) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  imageCacheRef: React.MutableRefObject<Map<string, any>>;
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
  setConnectPreview,
  imageCacheRef,
}: InteractionParams) {
  const dragRef = useRef<{
    type:
      | 'point'
      | 'canvas'
      | 'image-move'
      | 'image-rotate'
      | 'image-scale'
      | 'glyph-transform'
      | 'connect'
      | 'component-move';
    startFx: number;
    startFy: number;
    curFx: number;
    curFy: number;
    rbStartX: number;
    rbStartY: number;
    snapshot: HistoryEntry | null;
    /** Pre-move component tree snapshot for component-move undo. */
    componentSnapshot?: ComponentInfo[];
    // Image drag fields
    imageLayerId?: string;
    imageHandleType?: TransformHandle;
    imageInitial?: {
      offsetX: number;
      offsetY: number;
      scaleX: number;
      scaleY: number;
      rotation: number;
    };
    imageHalfW?: number;
    imageHalfH?: number;
    startAngle?: number;
    // Glyph transform fields
    glyphHandle?: TransformHandle;
    bboxAtStart?: SelectionBBox;
    centerFx?: number;
    centerFy?: number;
    startAngleDeg?: number;
    scaleOriginFx?: number;
    scaleOriginFy?: number;
    // Connect fields
    connectSourcePointId?: string;
    connectSourceX?: number;
    connectSourceY?: number;
  } | null>(null);

  const panRef = useRef<{
    startOriginX: number;
    startOriginY: number;
    startX: number;
    startY: number;
  } | null>(null);

  const pendingOffCurveRef = useRef<{ x: number; y: number } | null>(null);
  const hoveredHandleRef = useRef<TransformHandle>(null);
  const prevHoverRef = useRef<{ pointId: string | null; segmentId: string | null }>({
    pointId: null,
    segmentId: null,
  });
  const redrawRef = useRef(redraw);
  useLayoutEffect(() => {
    redrawRef.current = redraw;
  }, [redraw]);

  function initiatePan(e: PointerEvent, x: number, y: number, vt: ViewTransform) {
    panRef.current = { startOriginX: vt.originX, startOriginY: vt.originY, startX: x, startY: y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  const getCursor = useCallback((): string => {
    if (dragRef.current?.type === 'component-move') return 'grabbing';
    if (dragRef.current?.type === 'image-move') return 'grabbing';
    if (dragRef.current?.type === 'glyph-transform' && dragRef.current.glyphHandle === 'move')
      return 'grabbing';
    const { isComposite, components: cs, activeComponentPath: acp } = stateRef.current;
    if (isComposite && acp.length > 0) {
      const ac = getComponentAtPath(cs, acp);
      if (ac?.locked) return 'grab';
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
  }, [stateRef]);

  const getEventPos = useCallback(
    (e: PointerEvent | WheelEvent) => {
      const rect = getCanvasRect();
      if (!rect) return { x: e.clientX, y: e.clientY };
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    [getCanvasRect]
  );

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      const { x, y } = getEventPos(e);
      const { toolMode, paths, viewTransform: vt, selection } = stateRef.current;

      // Middle mouse = pan (always)
      if (e.button === 1) {
        initiatePan(e, x, y, vt);
        return;
      }

      // Hand tool = pan (always — before composite guards so it works even with no component selected)
      if (toolMode === 'hand') {
        initiatePan(e, x, y, vt);
        return;
      }

      // Composite guards
      const { isComposite, components: stateComponents, activeComponentPath } = stateRef.current;

      // No component selected: editing is disabled
      if (isComposite && activeComponentPath.length === 0) return;

      // Locked component: dragging moves the component offset
      const activeComp = getComponentAtPath(stateComponents, activeComponentPath);
      if (isComposite && activeComp?.locked) {
        const fp = toFontSpace(x, y, vt);
        dragRef.current = {
          type: 'component-move',
          startFx: fp.x,
          startFy: fp.y,
          curFx: fp.x,
          curFy: fp.y,
          rbStartX: x,
          rbStartY: y,
          snapshot: null,
          componentSnapshot: JSON.parse(JSON.stringify(stateComponents)) as ComponentInfo[],
        };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        return;
      }

      const hitVt = adjustVtForComponent(vt, isComposite, activeComponentPath, stateComponents);

      // Node tool: select and drag points and segments
      if (toolMode === 'node') {
        // Check glyph transform box handles first (when showTransformBox is active)
        const { showTransformBox } = stateRef.current;
        if (showTransformBox && selection.pointIds.size > 1) {
          let glyphBbox = computeSelectionBBox(paths, selection);
          if (glyphBbox) {
            // Adjust bbox for active component offset in composite glyph mode
            if (isComposite && activeComponentPath.length > 0) {
              const { dx, dy } = getAccumulatedOffset(stateComponents, activeComponentPath);
              glyphBbox = {
                minX: glyphBbox.minX + dx,
                minY: glyphBbox.minY + dy,
                maxX: glyphBbox.maxX + dx,
                maxY: glyphBbox.maxY + dy,
              };
            }
            const handle = hitTestGlyphTransformHandle(x, y, glyphBbox, vt);
            if (handle !== null) {
              const fp = toFontSpace(x, y, vt);
              const cx = (glyphBbox.minX + glyphBbox.maxX) / 2;
              const cy = (glyphBbox.minY + glyphBbox.maxY) / 2;
              const scaleOrigin = getGlyphScaleOrigin(handle, glyphBbox);
              const startAngleDeg = (Math.atan2(fp.y - cy, fp.x - cx) * 180) / Math.PI;
              dragRef.current = {
                type: 'glyph-transform',
                startFx: fp.x,
                startFy: fp.y,
                curFx: fp.x,
                curFy: fp.y,
                rbStartX: x,
                rbStartY: y,
                snapshot: { paths: clonePaths(paths) },
                glyphHandle: handle,
                bboxAtStart: glyphBbox,
                centerFx: cx,
                centerFy: cy,
                startAngleDeg,
                scaleOriginFx: scaleOrigin.x,
                scaleOriginFy: scaleOrigin.y,
              };
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              return;
            }
          }
        }

        // Check image transform handle (if focused layer is an image)
        const { focusedLayerId, layers: stateLayers } = stateRef.current;
        const focusedLayer = (stateLayers ?? []).find((l) => l.id === focusedLayerId);
        if (focusedLayer?.type === 'image') {
          const img = imageCacheRef.current.get(focusedLayer.id);
          if (img) {
            const il = focusedLayer as ImageLayer;
            const hitHandle = hitTestImageHandle(x, y, il, img, vt);
            if (hitHandle) {
              const fp = toFontSpace(x, y, vt);
              const imageInitial = {
                offsetX: il.offsetX,
                offsetY: il.offsetY,
                scaleX: il.scaleX,
                scaleY: il.scaleY,
                rotation: il.rotation,
              };
              if (hitHandle === 'move') {
                dragRef.current = {
                  type: 'image-move',
                  startFx: fp.x,
                  startFy: fp.y,
                  curFx: fp.x,
                  curFy: fp.y,
                  rbStartX: 0,
                  rbStartY: 0,
                  snapshot: null,
                  imageLayerId: focusedLayer.id,
                  imageHandleType: hitHandle,
                  imageInitial,
                };
              } else if (hitHandle === 'rotate') {
                const screenCx = vt.originX + il.offsetX * vt.scale;
                const screenCy = vt.originY - il.offsetY * vt.scale;
                dragRef.current = {
                  type: 'image-rotate',
                  startFx: fp.x,
                  startFy: fp.y,
                  curFx: fp.x,
                  curFy: fp.y,
                  rbStartX: screenCx,
                  rbStartY: screenCy,
                  snapshot: null,
                  imageLayerId: focusedLayer.id,
                  imageHandleType: hitHandle,
                  imageInitial,
                  startAngle: Math.atan2(y - screenCy, x - screenCx),
                };
              } else {
                dragRef.current = {
                  type: 'image-scale',
                  startFx: fp.x,
                  startFy: fp.y,
                  curFx: fp.x,
                  curFy: fp.y,
                  rbStartX: x,
                  rbStartY: y,
                  snapshot: null,
                  imageLayerId: focusedLayer.id,
                  imageHandleType: hitHandle,
                  imageInitial,
                  imageHalfW: (img.width() * il.scaleX * vt.scale) / 2,
                  imageHalfH: (img.height() * il.scaleY * vt.scale) / 2,
                };
              }
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              return;
            }
          }
        }

        // Check for point hit → move (select + drag)
        const hitPointId = hitTest(x, y, paths, hitVt);

        if (hitPointId) {
          const fp = toFontSpace(x, y, vt);
          dragRef.current = {
            type: 'point',
            startFx: fp.x,
            startFy: fp.y,
            curFx: fp.x,
            curFy: fp.y,
            rbStartX: x,
            rbStartY: y,
            snapshot: { paths: clonePaths(paths) },
          };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          if (e.shiftKey || e.ctrlKey || e.metaKey) {
            dispatch({ type: 'TOGGLE_SELECTION', pointId: hitPointId });
          } else if (!selection.pointIds.has(hitPointId)) {
            dispatch({ type: 'SET_SELECTION', pointIds: new Set([hitPointId]) });
          }
        } else {
          // Check for segment hit
          const hitSegmentId = hitTestSegment(x, y, paths, hitVt);

          if (hitSegmentId) {
            // Segment was hit - select/deselect segment
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
              dispatch({ type: 'TOGGLE_SEGMENT_SELECTION', segmentId: hitSegmentId });
            } else if (!selection.segmentIds.has(hitSegmentId)) {
              dispatch({
                type: 'SET_SELECTION',
                pointIds: new Set(),
                segmentIds: new Set([hitSegmentId]),
              });
            }
          } else {
            // Nothing hit - start rubber band or clear selection
            dragRef.current = {
              type: 'canvas',
              startFx: 0,
              startFy: 0,
              curFx: 0,
              curFy: 0,
              rbStartX: x,
              rbStartY: y,
              snapshot: null,
            };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            if (!e.shiftKey && !e.ctrlKey && !e.metaKey) dispatch({ type: 'CLEAR_SELECTION' });
          }
        }
      }

      // Pen tool: draw bezier curves
      if (toolMode === 'pen') {
        // If clicking on an existing point, start a connect drag instead of placing a new point
        const penHitPointId = hitTest(x, y, paths, hitVt);
        if (penHitPointId) {
          const fp = toFontSpace(x, y, vt);
          const sourcePoint = getPoint(paths, penHitPointId);
          dragRef.current = {
            type: 'connect',
            startFx: fp.x,
            startFy: fp.y,
            curFx: fp.x,
            curFy: fp.y,
            rbStartX: x,
            rbStartY: y,
            snapshot: null,
            connectSourcePointId: penHitPointId,
            connectSourceX: sourcePoint?.x ?? fp.x,
            connectSourceY: sourcePoint?.y ?? fp.y,
          };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          return;
        }

        const fp = toFontSpace(x, y, hitVt);
        const { activePathId, isDrawingPath } = stateRef.current;

        // Check if active path still exists and has points
        const activePath = activePathId ? paths.find((p) => p.id === activePathId) : null;
        const canAppend =
          activePathId && isDrawingPath && activePath && activePath.commands.length > 0;

        if (!canAppend) {
          // Start a new path
          const newPathId = `path-${Date.now()}`;
          const pointId = `pt-${Date.now()}`;
          const newPath = {
            id: newPathId,
            commands: [
              {
                kind: 'M' as const,
                point: { id: pointId, x: fp.x, y: fp.y, type: 'on-curve' as const },
              },
            ],
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
                ctrl1: {
                  id: ctrl1Id,
                  x: pending.x,
                  y: pending.y,
                  type: 'off-curve-cubic' as const,
                },
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
              command: {
                kind: 'L' as const,
                point: { id: pointId, x: fp.x, y: fp.y, type: 'on-curve' as const },
              },
            });
          }
        }
        redrawRef.current();
      }
    },
    [stateRef, dispatch, getEventPos, setPendingOffCurve]
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
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

      const {
        isComposite: mvComposite,
        components: mvComponents,
        activeComponentPath: mvActivePath,
      } = stateRef.current;

      // No component selected: suppress all hover/edit feedback
      if (mvComposite && mvActivePath.length === 0) {
        redraw();
        return;
      }

      const mvHitVt = adjustVtForComponent(vt, mvComposite, mvActivePath, mvComponents);

      if (!dragRef.current) {
        if (toolMode === 'node') {
          const { paths } = stateRef.current;

          // Locked component: suppress hover highlights — no editing allowed, skip O(n) hit tests
          const activeCompForHover = getComponentAtPath(mvComponents, mvActivePath);
          if (mvComposite && activeCompForHover?.locked) {
            if (prevHoverRef.current.pointId !== null) {
              setHoveredPointId(null);
              prevHoverRef.current.pointId = null;
            }
            if (prevHoverRef.current.segmentId !== null) {
              setHoveredSegmentId(null);
              prevHoverRef.current.segmentId = null;
            }
            hoveredHandleRef.current = null;
            return;
          }

          // Glyph transform box hover (check before image and point hover)
          const { showTransformBox: stb, selection: sel } = stateRef.current;
          if (stb && sel.pointIds.size > 1) {
            let glyphBbox2 = computeSelectionBBox(paths, sel);
            if (glyphBbox2) {
              // Adjust bbox for active component offset in composite glyph mode
              if (mvComposite && mvActivePath.length > 0) {
                const { dx, dy } = getAccumulatedOffset(mvComponents, mvActivePath);
                glyphBbox2 = {
                  minX: glyphBbox2.minX + dx,
                  minY: glyphBbox2.minY + dy,
                  maxX: glyphBbox2.maxX + dx,
                  maxY: glyphBbox2.maxY + dy,
                };
              }
              const handle = hitTestGlyphTransformHandle(x, y, glyphBbox2, vt);
              if (hoveredHandleRef.current !== handle) {
                hoveredHandleRef.current = handle;
                redraw();
              }
              if (handle !== null) {
                if (null !== prevHoverRef.current.pointId) {
                  setHoveredPointId(null);
                  prevHoverRef.current.pointId = null;
                }
                if (null !== prevHoverRef.current.segmentId) {
                  setHoveredSegmentId(null);
                  prevHoverRef.current.segmentId = null;
                }
                return;
              }
            }
          }

          const focusedLayer2 = (stateRef.current.layers ?? []).find(
            (l) => l.id === stateRef.current.focusedLayerId
          );
          if (focusedLayer2?.type === 'image') {
            // Image layer focused: hover image handles
            const img2 = imageCacheRef.current.get(focusedLayer2.id);
            const hitHandle = img2
              ? hitTestImageHandle(x, y, focusedLayer2 as ImageLayer, img2, vt)
              : null;
            if (hoveredHandleRef.current !== hitHandle) {
              hoveredHandleRef.current = hitHandle;
              redraw();
            }
            if (null !== prevHoverRef.current.pointId) {
              setHoveredPointId(null);
              prevHoverRef.current.pointId = null;
            }
            if (null !== prevHoverRef.current.segmentId) {
              setHoveredSegmentId(null);
              prevHoverRef.current.segmentId = null;
            }
          } else {
            hoveredHandleRef.current = null;
            // Hover detection for points and segments
            const hitPointId = hitTest(x, y, paths, mvHitVt);
            const hitSegmentId = hitPointId ? null : hitTestSegment(x, y, paths, mvHitVt);
            if (hitPointId !== prevHoverRef.current.pointId) {
              setHoveredPointId(hitPointId);
              prevHoverRef.current.pointId = hitPointId;
            }
            if (hitSegmentId !== prevHoverRef.current.segmentId) {
              setHoveredSegmentId(hitSegmentId);
              prevHoverRef.current.segmentId = hitSegmentId;
            }
          }
        } else {
          hoveredHandleRef.current = null;
          if (null !== prevHoverRef.current.pointId) {
            setHoveredPointId(null);
            prevHoverRef.current.pointId = null;
          }
          if (null !== prevHoverRef.current.segmentId) {
            setHoveredSegmentId(null);
            prevHoverRef.current.segmentId = null;
          }
        }
        if (toolMode === 'draw' || toolMode === 'select') redraw();
        return;
      }

      const drag = dragRef.current;

      if (drag.type === 'point') {
        const fp = toFontSpace(x, y, vt);
        // Gate movement behind a minimum drag distance to prevent jitter from
        // accidentally shifting points during Ctrl+Click or any quick click.
        const screenDx = x - drag.rbStartX;
        const screenDy = y - drag.rbStartY;
        if (
          Math.sqrt(screenDx * screenDx + screenDy * screenDy) >= DRAG_THRESHOLD_PX &&
          selection.pointIds.size > 0
        ) {
          const deltaX = fp.x - drag.curFx;
          const deltaY = fp.y - drag.curFy;
          const deltas = new Map<string, { x: number; y: number }>();
          for (const id of selection.pointIds) {
            deltas.set(id, { x: deltaX, y: deltaY });
          }
          dispatch({ type: 'MOVE_POINTS_LIVE', deltas });
          setDragPos({ x: fp.x, y: fp.y });
          redraw();
        }
        // Always advance curFx/curFy so the first delta after threshold crossing
        // is a smooth incremental move, not a jump from the original click position.
        drag.curFx = fp.x;
        drag.curFy = fp.y;
      } else if (drag.type === 'connect') {
        // Track cursor position and update preview line — no point movement
        const fp = toFontSpace(x, y, vt);
        drag.curFx = fp.x;
        drag.curFy = fp.y;
        setConnectPreview({
          fromX: drag.connectSourceX ?? fp.x,
          fromY: drag.connectSourceY ?? fp.y,
          toX: fp.x,
          toY: fp.y,
        });
        redraw();
      } else if (drag.type === 'canvas') {
        const rb: RubberBand = { x1: drag.rbStartX, y1: drag.rbStartY, x2: x, y2: y };
        setRubberBand(rb);
        redraw();
      } else if (drag.type === 'image-move' && drag.imageLayerId && drag.imageInitial) {
        const fp = toFontSpace(x, y, vt);
        dispatch({
          type: 'UPDATE_IMAGE_LAYER',
          layerId: drag.imageLayerId,
          updates: {
            offsetX: drag.imageInitial.offsetX + (fp.x - drag.startFx),
            offsetY: drag.imageInitial.offsetY + (fp.y - drag.startFy),
          },
        });
        redraw();
      } else if (drag.type === 'image-rotate' && drag.imageLayerId && drag.imageInitial) {
        const screenCx = drag.rbStartX;
        const screenCy = drag.rbStartY;
        const currentAngle = Math.atan2(y - screenCy, x - screenCx);
        const deltaAngle = currentAngle - (drag.startAngle ?? 0);
        dispatch({
          type: 'UPDATE_IMAGE_LAYER',
          layerId: drag.imageLayerId,
          updates: { rotation: drag.imageInitial.rotation + (deltaAngle * 180) / Math.PI },
        });
        redraw();
      } else if (
        drag.type === 'image-scale' &&
        drag.imageLayerId &&
        drag.imageInitial &&
        drag.imageHalfW !== undefined &&
        drag.imageHalfH !== undefined
      ) {
        const handle = drag.imageHandleType;
        const sdx = x - drag.rbStartX;
        const sdy = y - drag.rbStartY;
        const init = drag.imageInitial;
        const HANDLE_SCALE_DIR: Partial<
          Record<NonNullable<TransformHandle>, { x: number; y: number }>
        > = {
          lm: { x: -1, y: 0 },
          tl: { x: -1, y: -1 },
          bl: { x: -1, y: 1 },
          rm: { x: 1, y: 0 },
          tr: { x: 1, y: -1 },
          br: { x: 1, y: 1 },
          tm: { x: 0, y: -1 },
          bm: { x: 0, y: 1 },
        };
        const dir = handle ? HANDLE_SCALE_DIR[handle] : undefined;
        let newScaleX = init.scaleX;
        let newScaleY = init.scaleY;
        if (dir) {
          if (dir.x !== 0)
            newScaleX =
              drag.imageHalfW > 0
                ? init.scaleX * (1 + (dir.x * sdx) / drag.imageHalfW)
                : init.scaleX;
          if (dir.y !== 0)
            newScaleY =
              drag.imageHalfH > 0
                ? init.scaleY * (1 + (dir.y * sdy) / drag.imageHalfH)
                : init.scaleY;
        }
        dispatch({
          type: 'UPDATE_IMAGE_LAYER',
          layerId: drag.imageLayerId,
          updates: { scaleX: Math.max(0.01, newScaleX), scaleY: Math.max(0.01, newScaleY) },
        });
        redraw();
      } else if (
        drag.type === 'glyph-transform' &&
        drag.snapshot &&
        drag.glyphHandle !== undefined
      ) {
        const handle = drag.glyphHandle;
        const { selection: sel, paths: curPaths } = stateRef.current;

        if (handle === 'move') {
          const fp = toFontSpace(x, y, vt);
          const deltaX = fp.x - drag.curFx;
          const deltaY = fp.y - drag.curFy;
          drag.curFx = fp.x;
          drag.curFy = fp.y;
          const deltas = new Map<string, { x: number; y: number }>();
          for (const id of sel.pointIds) {
            deltas.set(id, { x: deltaX, y: deltaY });
          }
          dispatch({ type: 'MOVE_POINTS_LIVE', deltas });
          redraw();
        } else if (handle === 'rotate') {
          const cx = drag.centerFx!;
          const cy = drag.centerFy!;
          const fp = toFontSpace(x, y, vt);
          const currentAngleDeg = (Math.atan2(fp.y - cy, fp.x - cx) * 180) / Math.PI;
          const rotDeg = currentAngleDeg - drag.startAngleDeg!;
          const rad = (rotDeg * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const deltas = new Map<string, { x: number; y: number }>();
          for (const id of sel.pointIds) {
            const snap = getPoint(drag.snapshot.paths, id);
            if (!snap) continue;
            const cur = getPoint(curPaths, id);
            if (!cur) continue;
            const dx = snap.x - cx;
            const dy = snap.y - cy;
            const targetX = cx + dx * cos - dy * sin;
            const targetY = cy + dx * sin + dy * cos;
            deltas.set(id, { x: targetX - cur.x, y: targetY - cur.y });
          }
          dispatch({ type: 'TRANSFORM_POINTS_LIVE', deltas });
          redraw();
        } else {
          // Scale handles: compute scale from font-space displacement
          const fp = toFontSpace(x, y, vt);
          const originFx = drag.scaleOriginFx!;
          const originFy = drag.scaleOriginFy!;
          const startDxF = drag.startFx - originFx;
          const startDyF = drag.startFy - originFy;
          const curDxF = fp.x - originFx;
          const curDyF = fp.y - originFy;
          const isHoriz = handle === 'lm' || handle === 'rm';
          const isVert = handle === 'tm' || handle === 'bm';
          const scaleX = isVert ? 1 : Math.abs(startDxF) > 0.001 ? curDxF / startDxF : 1;
          const scaleY = isHoriz ? 1 : Math.abs(startDyF) > 0.001 ? curDyF / startDyF : 1;
          const deltas = new Map<string, { x: number; y: number }>();
          for (const id of sel.pointIds) {
            const snap = getPoint(drag.snapshot.paths, id);
            if (!snap) continue;
            const cur = getPoint(curPaths, id);
            if (!cur) continue;
            const targetX = originFx + (snap.x - originFx) * scaleX;
            const targetY = originFy + (snap.y - originFy) * scaleY;
            deltas.set(id, { x: targetX - cur.x, y: targetY - cur.y });
          }
          dispatch({ type: 'TRANSFORM_POINTS_LIVE', deltas });
          redraw();
        }
      } else if (drag.type === 'component-move') {
        const fp = toFontSpace(x, y, vt);
        const dx = fp.x - drag.curFx;
        const dy = fp.y - drag.curFy;
        drag.curFx = fp.x;
        drag.curFy = fp.y;
        const { activeComponentPath: acp } = stateRef.current;
        dispatch({ type: 'MOVE_COMPONENT_LIVE', path: acp, dx, dy });
        redraw();
      } else {
        onTransformFeedback?.({
          isActive: false,
          deltaX: 0,
          deltaY: 0,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
        });
        setDragPos(null);
      }
    },
    [
      stateRef,
      dispatch,
      getEventPos,
      setRubberBand,
      setMousePos,
      redraw,
      onTransformFeedback,
      setDragPos,
      setConnectPreview,
      imageCacheRef,
    ]
  );

  const onPointerUp = useCallback(
    (e: PointerEvent) => {
      const { x, y } = getEventPos(e);
      const { paths, viewTransform: vt, selection } = stateRef.current;

      if (panRef.current) {
        panRef.current = null;
        return;
      }
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
          if (e.shiftKey || e.ctrlKey || e.metaKey) {
            dispatch({ type: 'SET_SELECTION', pointIds: new Set([...selection.pointIds, ...ids]) });
          } else {
            dispatch({ type: 'SET_SELECTION', pointIds: ids });
          }
        }
        setRubberBand(null);
        redraw();
      } else if (
        drag.type === 'image-move' ||
        drag.type === 'image-rotate' ||
        drag.type === 'image-scale'
      ) {
        // Image transforms are committed live; nothing special needed on release
        redraw();
      } else if (drag.type === 'glyph-transform') {
        if (drag.glyphHandle === 'move') {
          if (drag.snapshot && (drag.curFx !== drag.startFx || drag.curFy !== drag.startFy)) {
            dispatch({ type: 'COMMIT_MOVE', snapshot: drag.snapshot });
          }
        } else {
          if (drag.snapshot) {
            dispatch({ type: 'COMMIT_TRANSFORM', snapshot: drag.snapshot });
          }
        }
        setDragPos(null);
        redraw();
      } else if (drag.type === 'component-move') {
        const { activeComponentPath: acp } = stateRef.current;
        dispatch({
          type: 'COMMIT_COMPONENT_MOVE',
          path: acp,
          componentSnapshot: drag.componentSnapshot ?? [],
        });
        redraw();
      } else if (drag.type === 'connect') {
        setConnectPreview(null);
        const sourceId = drag.connectSourcePointId;
        if (!sourceId) {
          redraw();
          return;
        }

        // Only act when there was meaningful drag movement
        const screenDx = x - drag.rbStartX;
        const screenDy = y - drag.rbStartY;
        if (Math.sqrt(screenDx * screenDx + screenDy * screenDy) < DRAG_THRESHOLD_PX) {
          redraw();
          return;
        }

        const sourcePoint = getPoint(paths, sourceId);
        if (!sourcePoint) {
          redraw();
          return;
        }

        const fp = toFontSpace(x, y, vt);
        const extendSourcePathId = getExtendablePathId(paths, sourceId) ?? undefined;

        // Case 1: Release on a different existing point
        const releasePointId = hitTest(x, y, paths, vt);
        if (releasePointId && releasePointId !== sourceId) {
          if (extendSourcePathId) {
            // Source is the last point of an open path → connect endpoints without creating new points
            dispatch({
              type: 'CONNECT_PATH_ENDPOINTS',
              sourcePathId: extendSourcePathId,
              targetPointId: releasePointId,
            });
          } else {
            const targetPoint = getPoint(paths, releasePointId);
            if (targetPoint) {
              dispatch({
                type: 'CONNECT_WITH_LINE',
                fromX: sourcePoint.x,
                fromY: sourcePoint.y,
                toX: targetPoint.x,
                toY: targetPoint.y,
              });
            }
          }
          redraw();
          return;
        }

        // Case 2: Release on a straight segment
        const releaseSegId = hitTestSegment(x, y, paths, vt);
        if (releaseSegId) {
          const segInfo = findSegmentInsertIndex(paths, releaseSegId);
          if (segInfo && segInfo.isStraight) {
            const newPointId = `pt-insert-${Date.now()}`;
            dispatch({
              type: 'CONNECT_WITH_LINE',
              fromX: sourcePoint.x,
              fromY: sourcePoint.y,
              toX: fp.x,
              toY: fp.y,
              extendSourcePathId,
              insertInSegment: {
                pathId: segInfo.pathId,
                insertIndex: segInfo.insertIndex,
                newPointId,
                newPointX: fp.x,
                newPointY: fp.y,
              },
            });
            redraw();
            return;
          }
        }

        // Case 3: Release in empty space — create new point and connect
        dispatch({
          type: 'CONNECT_WITH_LINE',
          fromX: sourcePoint.x,
          fromY: sourcePoint.y,
          toX: fp.x,
          toY: fp.y,
          extendSourcePathId,
        });
        redraw();
      }
    },
    [
      stateRef,
      dispatch,
      getEventPos,
      setRubberBand,
      redraw,
      onTransformFeedback,
      setDragPos,
      setConnectPreview,
    ]
  );

  const onWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const { x, y } = getEventPos(e);
      const { viewTransform: vt } = stateRef.current;
      const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newScale = Math.max(0.05, Math.min(50, vt.scale * zoomFactor));
      const newOriginX = x - (x - vt.originX) * (newScale / vt.scale);
      const newOriginY = y - (y - vt.originY) * (newScale / vt.scale);
      dispatch({
        type: 'SET_VIEW_TRANSFORM',
        vt: { scale: newScale, originX: newOriginX, originY: newOriginY },
      });
      redraw();
    },
    [stateRef, dispatch, getEventPos, redraw]
  );

  const onPointerLeave = useCallback(() => {
    setMousePos(null);
    hoveredHandleRef.current = null;
    setHoveredPointId(null);
    setHoveredSegmentId(null);
    redraw();
  }, [setMousePos, redraw, setHoveredPointId, setHoveredSegmentId]);

  return { onPointerDown, onPointerMove, onPointerUp, onWheel, onPointerLeave, getCursor };
}
