import { useCallback, useRef } from 'react';
import type { EditablePath, FontMetrics, ViewTransform, Selection, RubberBand } from '@/lib/editorTypes';

// ---------- colour helpers ----------
// CanvasKit Color4f: [R, G, B, A] each 0.0–1.0
function rgba(r: number, g: number, b: number, a = 1): Float32Array {
  return new Float32Array([r / 255, g / 255, b / 255, a]);
}

const C = {
  bg:             rgba(255, 255, 255),
  fill:           rgba(30, 30, 30, 0.12),
  outline:        rgba(30, 30, 30, 0.85),
  baseline:       rgba(150, 150, 150),
  ascender:       rgba(100, 130, 200, 0.8),
  descender:      rgba(200, 100, 100, 0.8),
  advance:        rgba(100, 180, 100, 0.8),
  bbox:           rgba(180, 180, 180),
  handle:         rgba(160, 160, 160),
  onCurveFill:    rgba(255, 255, 255),
  onCurveStroke:  rgba(70, 70, 70),
  offCurveFill:   rgba(255, 255, 255),
  offCurveStroke: rgba(140, 140, 140),
  selectedFill:   rgba(0, 112, 243),
  selectedStroke: rgba(0, 80, 200),
  rubber:         rgba(0, 112, 243, 0.12),
  rubberStroke:   rgba(0, 112, 243, 0.7),
  ghostPoint:     rgba(0, 112, 243, 0.35),
};

// ---------- coordinate transform ----------
function toScreen(
  fx: number, fy: number, vt: ViewTransform,
): [number, number] {
  return [
    vt.originX + fx * vt.scale,
    vt.originY - fy * vt.scale,  // Y-flip: font Y-up → screen Y-down
  ];
}

// ---------- main draw function ----------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function renderFrame(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ck: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  skCanvas: any,
  paths: EditablePath[],
  metrics: FontMetrics | null,
  vt: ViewTransform,
  selection: Selection,
  rubberBand: RubberBand | null,
  mousePos: { x: number; y: number } | null,
  toolMode: string,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const Paint = ck.Paint;

  skCanvas.clear(ck.Color4f(1, 1, 1, 1));

  if (!metrics) return;

  // ---- 1. Metric lines (dashed) ----
  const metricPaint = new Paint();
  metricPaint.setAntiAlias(true);
  metricPaint.setStyle(ck.PaintStyle.Stroke);
  metricPaint.setStrokeWidth(1);

  const drawHLine = (fontY: number, color: Float32Array) => {
    const [, sy] = toScreen(0, fontY, vt);
    if (sy < -10 || sy > canvasHeight + 10) return;
    metricPaint.setColor(color);
    skCanvas.drawLine(0, sy, canvasWidth, sy, metricPaint);
  };
  const drawVLine = (fontX: number, color: Float32Array) => {
    const [sx] = toScreen(fontX, 0, vt);
    if (sx < -10 || sx > canvasWidth + 10) return;
    metricPaint.setColor(color);
    skCanvas.drawLine(sx, 0, sx, canvasHeight, metricPaint);
  };

  drawHLine(0, C.baseline);
  drawHLine(metrics.ascender, C.ascender);
  drawHLine(metrics.descender, C.descender);
  drawVLine(0, C.baseline);
  drawVLine(metrics.advanceWidth, C.advance);
  metricPaint.delete();

  // ---- 2. Bounding box ----
  if (metrics.xMin !== metrics.xMax && metrics.yMin !== metrics.yMax) {
    const [x1, y1] = toScreen(metrics.xMin, metrics.yMax, vt);
    const [x2, y2] = toScreen(metrics.xMax, metrics.yMin, vt);
    const bboxPaint = new Paint();
    bboxPaint.setAntiAlias(true);
    bboxPaint.setStyle(ck.PaintStyle.Stroke);
    bboxPaint.setStrokeWidth(0.5);
    bboxPaint.setColor(C.bbox);
    skCanvas.drawRect(ck.LTRBRect(x1, y1, x2, y2), bboxPaint);
    bboxPaint.delete();
  }

  if (paths.length === 0) return;

  // ---- 3. Glyph fill ----
  const skPath = new ck.Path();
  for (const path of paths) {
    for (const cmd of path.commands) {
      if (cmd.kind === 'M') {
        const [sx, sy] = toScreen(cmd.point.x, cmd.point.y, vt);
        skPath.moveTo(sx, sy);
      } else if (cmd.kind === 'L') {
        const [sx, sy] = toScreen(cmd.point.x, cmd.point.y, vt);
        skPath.lineTo(sx, sy);
      } else if (cmd.kind === 'Q') {
        const [cx, cy] = toScreen(cmd.ctrl.x, cmd.ctrl.y, vt);
        const [x, y] = toScreen(cmd.point.x, cmd.point.y, vt);
        skPath.quadTo(cx, cy, x, y);
      } else if (cmd.kind === 'C') {
        const [c1x, c1y] = toScreen(cmd.ctrl1.x, cmd.ctrl1.y, vt);
        const [c2x, c2y] = toScreen(cmd.ctrl2.x, cmd.ctrl2.y, vt);
        const [x, y] = toScreen(cmd.point.x, cmd.point.y, vt);
        skPath.cubicTo(c1x, c1y, c2x, c2y, x, y);
      } else if (cmd.kind === 'Z') {
        skPath.close();
      }
    }
  }

  const fillPaint = new Paint();
  fillPaint.setAntiAlias(true);
  fillPaint.setStyle(ck.PaintStyle.Fill);
  fillPaint.setColor(C.fill);
  skCanvas.drawPath(skPath, fillPaint);
  fillPaint.delete();

  const strokePaint = new Paint();
  strokePaint.setAntiAlias(true);
  strokePaint.setStyle(ck.PaintStyle.Stroke);
  strokePaint.setStrokeWidth(1.5);
  strokePaint.setColor(C.outline);
  skCanvas.drawPath(skPath, strokePaint);
  strokePaint.delete();
  skPath.delete();

  // ---- 4. Bézier handle arms ----
  const handlePaint = new Paint();
  handlePaint.setAntiAlias(true);
  handlePaint.setStyle(ck.PaintStyle.Stroke);
  handlePaint.setStrokeWidth(1);
  handlePaint.setColor(C.handle);

  // Keep track of last on-curve point per contour for Q handle arm
  for (const path of paths) {
    let lastOnX = 0, lastOnY = 0;
    for (const cmd of path.commands) {
      if (cmd.kind === 'M' || cmd.kind === 'L') {
        const [sx, sy] = toScreen(cmd.point.x, cmd.point.y, vt);
        lastOnX = sx; lastOnY = sy;
      } else if (cmd.kind === 'Q') {
        const [cx, cy] = toScreen(cmd.ctrl.x, cmd.ctrl.y, vt);
        const [px, py] = toScreen(cmd.point.x, cmd.point.y, vt);
        skCanvas.drawLine(lastOnX, lastOnY, cx, cy, handlePaint);
        skCanvas.drawLine(cx, cy, px, py, handlePaint);
        lastOnX = px; lastOnY = py;
      } else if (cmd.kind === 'C') {
        const [c1x, c1y] = toScreen(cmd.ctrl1.x, cmd.ctrl1.y, vt);
        const [c2x, c2y] = toScreen(cmd.ctrl2.x, cmd.ctrl2.y, vt);
        const [px, py] = toScreen(cmd.point.x, cmd.point.y, vt);
        skCanvas.drawLine(lastOnX, lastOnY, c1x, c1y, handlePaint);
        skCanvas.drawLine(c2x, c2y, px, py, handlePaint);
        lastOnX = px; lastOnY = py;
      }
    }
  }
  handlePaint.delete();

  // ---- 5. Points ----
  const ON_R = 5;
  const OFF_SIZE = 7;

  for (const path of paths) {
    for (const cmd of path.commands) {
      const drawOnCurve = (pt: { id: string; x: number; y: number }) => {
        const [sx, sy] = toScreen(pt.x, pt.y, vt);
        const isSelected = selection.pointIds.has(pt.id);
        const fpaint = new Paint();
        fpaint.setAntiAlias(true);
        fpaint.setStyle(ck.PaintStyle.Fill);
        fpaint.setColor(isSelected ? C.selectedFill : C.onCurveFill);
        skCanvas.drawCircle(sx, sy, ON_R, fpaint);
        fpaint.delete();
        const spaint = new Paint();
        spaint.setAntiAlias(true);
        spaint.setStyle(ck.PaintStyle.Stroke);
        spaint.setStrokeWidth(1.5);
        spaint.setColor(isSelected ? C.selectedStroke : C.onCurveStroke);
        skCanvas.drawCircle(sx, sy, ON_R, spaint);
        spaint.delete();
      };

      const drawOffCurve = (pt: { id: string; x: number; y: number }) => {
        const [sx, sy] = toScreen(pt.x, pt.y, vt);
        const isSelected = selection.pointIds.has(pt.id);
        const half = OFF_SIZE / 2;
        const rect = ck.LTRBRect(sx - half, sy - half, sx + half, sy + half);
        const fpaint = new Paint();
        fpaint.setAntiAlias(true);
        fpaint.setStyle(ck.PaintStyle.Fill);
        fpaint.setColor(isSelected ? C.selectedFill : C.offCurveFill);
        skCanvas.drawRect(rect, fpaint);
        fpaint.delete();
        const spaint = new Paint();
        spaint.setAntiAlias(true);
        spaint.setStyle(ck.PaintStyle.Stroke);
        spaint.setStrokeWidth(1.5);
        spaint.setColor(isSelected ? C.selectedStroke : C.offCurveStroke);
        skCanvas.drawRect(rect, spaint);
        spaint.delete();
      };

      if (cmd.kind === 'M' || cmd.kind === 'L') drawOnCurve(cmd.point);
      else if (cmd.kind === 'Q') { drawOffCurve(cmd.ctrl); drawOnCurve(cmd.point); }
      else if (cmd.kind === 'C') { drawOffCurve(cmd.ctrl1); drawOffCurve(cmd.ctrl2); drawOnCurve(cmd.point); }
    }
  }

  // ---- 6. Rubber-band selection rect ----
  if (rubberBand) {
    const { x1, y1, x2, y2 } = rubberBand;
    const left = Math.min(x1, x2), top = Math.min(y1, y2);
    const right = Math.max(x1, x2), bottom = Math.max(y1, y2);

    const rfill = new Paint();
    rfill.setAntiAlias(true);
    rfill.setStyle(ck.PaintStyle.Fill);
    rfill.setColor(C.rubber);
    skCanvas.drawRect(ck.LTRBRect(left, top, right, bottom), rfill);
    rfill.delete();

    const rstroke = new Paint();
    rstroke.setAntiAlias(true);
    rstroke.setStyle(ck.PaintStyle.Stroke);
    rstroke.setStrokeWidth(1);
    rstroke.setColor(C.rubberStroke);
    skCanvas.drawRect(ck.LTRBRect(left, top, right, bottom), rstroke);
    rstroke.delete();
  }

  // ---- 7. Draw-mode ghost point ----
  if (toolMode === 'draw' && mousePos) {
    const [sx, sy] = [mousePos.x, mousePos.y]; // already screen coords
    const gpaint = new Paint();
    gpaint.setAntiAlias(true);
    gpaint.setStyle(ck.PaintStyle.Fill);
    gpaint.setColor(C.ghostPoint);
    skCanvas.drawCircle(sx, sy, ON_R, gpaint);
    gpaint.delete();
  }
}

/** Hook that returns a `redraw` trigger bound to a surface ref. */
export function useEditorRenderer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ck: any | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  surfaceRef: React.MutableRefObject<any | null>,
  stateRef: React.MutableRefObject<{
    paths: EditablePath[];
    selection: Selection;
    toolMode: string;
    viewTransform: ViewTransform;
  }>,
  metricsRef: React.MutableRefObject<FontMetrics | null>,
  extraRef: React.MutableRefObject<{
    rubberBand: RubberBand | null;
    mousePos: { x: number; y: number } | null;
    canvasWidth: number;
    canvasHeight: number;
  }>,
) {
  const pendingRef = useRef(false);

  const redraw = useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface || !ck) return;
    if (pendingRef.current) return;
    pendingRef.current = true;

    surface.requestAnimationFrame((skCanvas: unknown) => {
      pendingRef.current = false;
      const s = stateRef.current;
      const extra = extraRef.current;
      renderFrame(
        ck, skCanvas,
        s.paths, metricsRef.current,
        s.viewTransform, s.selection,
        extra.rubberBand, extra.mousePos,
        s.toolMode,
        extra.canvasWidth, extra.canvasHeight,
      );
    });
  }, [ck, surfaceRef, stateRef, metricsRef, extraRef]);

  return { redraw };
}
