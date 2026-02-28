import { useCallback, useRef } from 'react';
import type { EditablePath, FontMetrics, ViewTransform, Selection, RubberBand, Layer, DrawingLayer, ImageLayer } from '@/lib/editorTypes';

// ---------- colour helpers ----------
// CanvasKit Color4f: [R, G, B, A] each 0.0–1.0
function rgba(r: number, g: number, b: number, a = 1): Float32Array {
  return new Float32Array([r / 255, g / 255, b / 255, a]);
}

const C = {
  bg:              rgba(255, 255, 255),
  fill:            rgba(30, 30, 30, 0.12),
  outline:         rgba(30, 30, 30, 0.85),
  baseline:        rgba(150, 150, 150),
  metricLine:      rgba(120, 120, 120, 0.6),
  rulerBg:         rgba(248, 248, 248),
  rulerTick:       rgba(150, 150, 150),
  rulerText:       rgba(80, 80, 80),
  bbox:            rgba(180, 180, 180),
  handle:          rgba(160, 160, 160),
  onCurveFill:     rgba(255, 255, 255),
  onCurveStroke:   rgba(70, 70, 70),
  offCurveFill:    rgba(255, 255, 255),
  offCurveStroke:  rgba(140, 140, 140),
  selectedFill:    rgba(0, 112, 243),
  selectedStroke:  rgba(0, 80, 200),
  hoveredFill:     rgba(255, 200, 100),
  hoveredStroke:   rgba(200, 150, 50),
  hoveredSegment:  rgba(255, 200, 100, 0.8),
  rubber:          rgba(0, 112, 243, 0.12),
  rubberStroke:    rgba(0, 112, 243, 0.7),
  ghostPoint:      rgba(0, 112, 243, 0.35),
  directionArrow:  rgba(100, 149, 237, 0.9),
  pendingOffCurve: rgba(200, 100, 0, 0.5),
  transformBox:    rgba(0, 112, 243, 0.8),
  transformHandle: rgba(255, 255, 255),
  transformHandleStroke: rgba(0, 112, 243),
};

const RULER_WIDTH = 28;

// ---------- coordinate transform ----------
function toScreen(
  fx: number, fy: number, vt: ViewTransform,
): [number, number] {
  return [
    vt.originX + fx * vt.scale,
    vt.originY - fy * vt.scale,  // Y-flip: font Y-up → screen Y-down
  ];
}

// ---------- direction arrows ----------
/** Collect arrows at the midpoint of each segment, showing the direction of travel.
 *  For lines: midpoint with direction toward end.
 *  For curves: point at t=0.5 with tangent direction. */
function collectArrows(
  paths: EditablePath[],
  vt: ViewTransform,
): Array<{ sx: number; sy: number; dx: number; dy: number }> {
  const arrows: Array<{ sx: number; sy: number; dx: number; dy: number }> = [];

  for (const path of paths) {
    let lastOnCurve: { x: number; y: number } | null = null;

    for (const cmd of path.commands) {
      if (cmd.kind === 'M') {
        lastOnCurve = cmd.point;
      } else if (cmd.kind === 'L' && lastOnCurve) {
        const midX = (lastOnCurve.x + cmd.point.x) / 2;
        const midY = (lastOnCurve.y + cmd.point.y) / 2;
        const [sx, sy] = toScreen(midX, midY, vt);
        const [ex, ey] = toScreen(cmd.point.x, cmd.point.y, vt);
        const dx = ex - sx;
        const dy = ey - sy;
        if (Math.sqrt(dx * dx + dy * dy) > 1) {
          arrows.push({ sx, sy, dx, dy });
        }
        lastOnCurve = cmd.point;
      } else if (cmd.kind === 'Q' && lastOnCurve) {
        const t = 0.5;
        const mt = 1 - t;
        const p0 = lastOnCurve;
        const p1 = cmd.ctrl;
        const p2 = cmd.point;
        const midX = mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x;
        const midY = mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y;
        const tangentX = 2 * (mt * (p1.x - p0.x) + t * (p2.x - p1.x));
        const tangentY = 2 * (mt * (p1.y - p0.y) + t * (p2.y - p1.y));
        const [sx, sy] = toScreen(midX, midY, vt);
        const [tx, ty] = toScreen(midX + tangentX, midY + tangentY, vt);
        const dx = tx - sx;
        const dy = ty - sy;
        if (Math.sqrt(dx * dx + dy * dy) > 1) {
          arrows.push({ sx, sy, dx, dy });
        }
        lastOnCurve = cmd.point;
      } else if (cmd.kind === 'C' && lastOnCurve) {
        const t = 0.5;
        const mt = 1 - t;
        const mt2 = mt * mt;
        const mt3 = mt2 * mt;
        const t2 = t * t;
        const t3 = t2 * t;
        const p0 = lastOnCurve;
        const p1 = cmd.ctrl1;
        const p2 = cmd.ctrl2;
        const p3 = cmd.point;
        const midX = mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x;
        const midY = mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y;
        const tangentX = 3 * (mt2 * (p1.x - p0.x) + 2 * mt * t * (p2.x - p1.x) + t2 * (p3.x - p2.x));
        const tangentY = 3 * (mt2 * (p1.y - p0.y) + 2 * mt * t * (p2.y - p1.y) + t2 * (p3.y - p2.y));
        const [sx, sy] = toScreen(midX, midY, vt);
        const [tx, ty] = toScreen(midX + tangentX, midY + tangentY, vt);
        const dx = tx - sx;
        const dy = ty - sy;
        if (Math.sqrt(dx * dx + dy * dy) > 1) {
          arrows.push({ sx, sy, dx, dy });
        }
        lastOnCurve = cmd.point;
      }
    }
    
    // Handle closing segment in closed path
    const isClosed = path.commands[path.commands.length - 1]?.kind === 'Z';
    const firstOnCurve = path.commands[0]?.kind === 'M' ? path.commands[0].point : null;
    if (isClosed && lastOnCurve && firstOnCurve) {
      const midX = (lastOnCurve.x + firstOnCurve.x) / 2;
      const midY = (lastOnCurve.y + firstOnCurve.y) / 2;
      const [sx, sy] = toScreen(midX, midY, vt);
      const [ex, ey] = toScreen(firstOnCurve.x, firstOnCurve.y, vt);
      const dx = ex - sx;
      const dy = ey - sy;
      if (Math.sqrt(dx * dx + dy * dy) > 1) {
        arrows.push({ sx, sy, dx, dy });
      }
    }
  }

  return arrows;
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
  pendingOffCurve: { x: number; y: number } | null,
  toolMode: string,
  canvasWidth: number,
  canvasHeight: number,
  showDirection: boolean,
  hoveredPointId: string | null = null,
  hoveredSegmentId: string | null = null,
  dragPos: { x: number; y: number } | null = null,
  layers: Layer[] = [],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  imageCache: Map<string, any> = new Map(),
  inactiveDrawingPaths: EditablePath[] = [],
  focusedLayerId: string = '',
  showTransformBox: boolean = false,
  connectPreview: { fromX: number; fromY: number; toX: number; toY: number } | null = null,
  showPixelGrid: boolean = false,
): void {
  if (!ck || !skCanvas) return;

  const Paint = ck.Paint;

  skCanvas.clear(ck.Color4f(1, 1, 1, 1));

  if (!metrics) return;

  // ---- 1. Metric lines ----
  const metricPaint = new Paint();
  metricPaint.setAntiAlias(true);
  metricPaint.setStyle(ck.PaintStyle.Stroke);
  metricPaint.setStrokeWidth(1);

  const drawHLine = (fontY: number, color: Float32Array, xStart: number, xEnd: number) => {
    const [, sy] = toScreen(0, fontY, vt);
    if (sy < -10 || sy > canvasHeight + 10) return;
    const [sx1] = toScreen(xStart, 0, vt);
    const [sx2] = toScreen(xEnd, 0, vt);
    metricPaint.setColor(color);
    skCanvas.drawLine(sx1, sy, sx2, sy, metricPaint);
  };
  const drawVLine = (fontX: number, color: Float32Array, yStart: number, yEnd: number) => {
    const [sx] = toScreen(fontX, 0, vt);
    if (sx < -10 || sx > canvasWidth + 10) return;
    const [, sy1] = toScreen(0, yStart, vt);
    const [, sy2] = toScreen(0, yEnd, vt);
    metricPaint.setColor(color);
    skCanvas.drawLine(sx, sy1, sx, sy2, metricPaint);
  };

  const minY = Math.min(metrics.descender, 0);
  const maxY = Math.max(metrics.ascender, metrics.xHeight ?? 0, metrics.capHeight ?? 0);

  drawHLine(0, C.baseline, 0, metrics.advanceWidth);
  drawHLine(metrics.ascender, C.metricLine, 0, metrics.advanceWidth);
  drawHLine(metrics.descender, C.metricLine, 0, metrics.advanceWidth);
  if (metrics.xHeight) drawHLine(metrics.xHeight, C.metricLine, 0, metrics.advanceWidth);
  if (metrics.capHeight) drawHLine(metrics.capHeight, C.metricLine, 0, metrics.advanceWidth);
  drawVLine(0, C.metricLine, minY, maxY);
  drawVLine(metrics.advanceWidth, C.metricLine, minY, maxY);
  metricPaint.delete();

  // ---- 1a. Pixel grid (adaptive background grid, always ~20px cells on screen) ----
  if (showPixelGrid) {
    // Pick a grid interval so cells are ~10 screen pixels wide.
    // Snap to 1-2-5 sequence (1, 2, 5, 10, 20, 50, 100, …)
    const TARGET_CELL_PX = 20;
    const rawInterval = TARGET_CELL_PX / vt.scale;
    const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(rawInterval, 0.001))));
    const normalized = rawInterval / magnitude;
    const gridInterval = normalized < 2 ? magnitude : normalized < 5 ? 2 * magnitude : 5 * magnitude;

    const gridMinFX = -metrics.advanceWidth;
    const gridMaxFX = 2 * metrics.advanceWidth;
    const gridMinFY = 2 * metrics.descender;
    const gridMaxFY = 2 * metrics.ascender;

    // Screen extents of grid bounds (for clamping line lengths)
    const [, gridTopSy] = toScreen(0, gridMaxFY, vt);
    const [, gridBotSy] = toScreen(0, gridMinFY, vt);
    const [gridLeftSx] = toScreen(gridMinFX, 0, vt);
    const [gridRightSx] = toScreen(gridMaxFX, 0, vt);

    // Font-space range visible in viewport, clamped to grid bounds
    const visMinFX = Math.max(gridMinFX, (RULER_WIDTH - vt.originX) / vt.scale);
    const visMaxFX = Math.min(gridMaxFX, (canvasWidth - vt.originX) / vt.scale);
    const visMinFY = Math.max(gridMinFY, (vt.originY - canvasHeight) / vt.scale);
    const visMaxFY = Math.min(gridMaxFY, (vt.originY - RULER_WIDTH) / vt.scale);

    const gridPaint = new Paint();
    gridPaint.setAntiAlias(true);
    gridPaint.setStyle(ck.PaintStyle.Stroke);
    gridPaint.setStrokeWidth(0.5);
    gridPaint.setColor(rgba(180, 180, 220, 0.5));

    // Vertical lines
    const startFX = Math.floor(visMinFX / gridInterval) * gridInterval;
    for (let fx = startFX; fx <= visMaxFX + gridInterval; fx += gridInterval) {
      if (fx < visMinFX) continue;
      const [sx] = toScreen(fx, 0, vt);
      skCanvas.drawLine(sx, Math.max(RULER_WIDTH, gridTopSy), sx, Math.min(canvasHeight, gridBotSy), gridPaint);
    }

    // Horizontal lines
    const startFY = Math.floor(visMinFY / gridInterval) * gridInterval;
    for (let fy = startFY; fy <= visMaxFY + gridInterval; fy += gridInterval) {
      if (fy < visMinFY) continue;
      const [, sy] = toScreen(0, fy, vt);
      skCanvas.drawLine(Math.max(RULER_WIDTH, gridLeftSx), sy, Math.min(canvasWidth, gridRightSx), sy, gridPaint);
    }

    gridPaint.delete();
  }

  // ---- 1b. Image layers (bottom-to-top order) ----
  for (const layer of layers) {
    if (layer.type !== 'image' || !layer.visible) continue;
    const img = (imageCache as Map<string, any>).get(layer.id);
    if (!img) continue;
    const il = layer as ImageLayer;
    const [screenCx, screenCy] = toScreen(il.offsetX, il.offsetY, vt);
    const displayW = img.width() * il.scaleX * vt.scale;
    const displayH = img.height() * il.scaleY * vt.scale;
    const imgPaint = new Paint();
    imgPaint.setAlphaf(il.opacity);
    imgPaint.setAntiAlias(true);
    skCanvas.save();
    skCanvas.concat(ck.Matrix.multiply(
      ck.Matrix.translated(screenCx, screenCy),
      ck.Matrix.rotated(il.rotation * Math.PI / 180),
    ));
    skCanvas.drawImageRect(
      img,
      ck.LTRBRect(0, 0, img.width(), img.height()),
      ck.LTRBRect(-displayW / 2, -displayH / 2, displayW / 2, displayH / 2),
      imgPaint,
    );
    imgPaint.delete();
    skCanvas.restore();
  }

  // ---- 1c. Inactive drawing layers (faded, no handles) ----
  if (inactiveDrawingPaths.length > 0) {
    const inactiveSk = new ck.Path();
    for (const path of inactiveDrawingPaths) {
      for (const cmd of path.commands) {
        if (cmd.kind === 'M') {
          const [sx, sy] = toScreen(cmd.point.x, cmd.point.y, vt);
          inactiveSk.moveTo(sx, sy);
        } else if (cmd.kind === 'L') {
          const [sx, sy] = toScreen(cmd.point.x, cmd.point.y, vt);
          inactiveSk.lineTo(sx, sy);
        } else if (cmd.kind === 'Q') {
          const [cx, cy] = toScreen(cmd.ctrl.x, cmd.ctrl.y, vt);
          const [x, y] = toScreen(cmd.point.x, cmd.point.y, vt);
          inactiveSk.quadTo(cx, cy, x, y);
        } else if (cmd.kind === 'C') {
          const [c1x, c1y] = toScreen(cmd.ctrl1.x, cmd.ctrl1.y, vt);
          const [c2x, c2y] = toScreen(cmd.ctrl2.x, cmd.ctrl2.y, vt);
          const [x, y] = toScreen(cmd.point.x, cmd.point.y, vt);
          inactiveSk.cubicTo(c1x, c1y, c2x, c2y, x, y);
        } else if (cmd.kind === 'Z') {
          inactiveSk.close();
        }
      }
    }
    const inactiveFill = new Paint();
    inactiveFill.setAntiAlias(true);
    inactiveFill.setStyle(ck.PaintStyle.Fill);
    inactiveFill.setColor(rgba(30, 30, 30, 0.05));
    skCanvas.drawPath(inactiveSk, inactiveFill);
    inactiveFill.delete();
    const inactiveStroke = new Paint();
    inactiveStroke.setAntiAlias(true);
    inactiveStroke.setStyle(ck.PaintStyle.Stroke);
    inactiveStroke.setStrokeWidth(1);
    inactiveStroke.setColor(rgba(30, 30, 30, 0.35));
    skCanvas.drawPath(inactiveSk, inactiveStroke);
    inactiveStroke.delete();
    inactiveSk.delete();
  }

  // ---- 2. Glyph fill and stroke (skip if no paths) ----
  if (paths.length > 0) {
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
        const [x, y]   = toScreen(cmd.point.x, cmd.point.y, vt);
        skPath.quadTo(cx, cy, x, y);
      } else if (cmd.kind === 'C') {
        const [c1x, c1y] = toScreen(cmd.ctrl1.x, cmd.ctrl1.y, vt);
        const [c2x, c2y] = toScreen(cmd.ctrl2.x, cmd.ctrl2.y, vt);
        const [x, y]     = toScreen(cmd.point.x, cmd.point.y, vt);
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
        const [px, py]   = toScreen(cmd.point.x, cmd.point.y, vt);
        skCanvas.drawLine(lastOnX, lastOnY, c1x, c1y, handlePaint);
        skCanvas.drawLine(c2x, c2y, px, py, handlePaint);
        lastOnX = px; lastOnY = py;
      }
    }
  }
  handlePaint.delete();

  // ---- 4b. Highlight selected segments (lines and curves) ----
  if (selection.segmentIds.size > 0) {
    const segmentPaint = new Paint();
    segmentPaint.setAntiAlias(true);
    segmentPaint.setStyle(ck.PaintStyle.Stroke);
    segmentPaint.setStrokeWidth(4);
    segmentPaint.setColor(C.selectedFill);

    for (const path of paths) {
      let lastOnCurve: { id: string; x: number; y: number } | null = null;
      
      for (const cmd of path.commands) {
        if (cmd.kind === 'M') {
          lastOnCurve = cmd.point;
        } else if (cmd.kind === 'L' && lastOnCurve) {
          const segmentId = `${path.id}:${lastOnCurve.id}:${cmd.point.id}`;
          if (selection.segmentIds.has(segmentId)) {
            const [x1, y1] = toScreen(lastOnCurve.x, lastOnCurve.y, vt);
            const [x2, y2] = toScreen(cmd.point.x, cmd.point.y, vt);
            skCanvas.drawLine(x1, y1, x2, y2, segmentPaint);
          }
          lastOnCurve = cmd.point;
        } else if (cmd.kind === 'Q' && lastOnCurve) {
          const segmentId = `${path.id}:${lastOnCurve.id}:${cmd.point.id}`;
          if (selection.segmentIds.has(segmentId)) {
            const [x0, y0] = toScreen(lastOnCurve.x, lastOnCurve.y, vt);
            const [cx, cy] = toScreen(cmd.ctrl.x, cmd.ctrl.y, vt);
            const [x1, y1] = toScreen(cmd.point.x, cmd.point.y, vt);
            
            const highlightPath = new ck.Path();
            highlightPath.moveTo(x0, y0);
            highlightPath.quadTo(cx, cy, x1, y1);
            skCanvas.drawPath(highlightPath, segmentPaint);
            highlightPath.delete();
          }
          lastOnCurve = cmd.point;
        } else if (cmd.kind === 'C' && lastOnCurve) {
          const segmentId = `${path.id}:${lastOnCurve.id}:${cmd.point.id}`;
          if (selection.segmentIds.has(segmentId)) {
            const [x0, y0] = toScreen(lastOnCurve.x, lastOnCurve.y, vt);
            const [c1x, c1y] = toScreen(cmd.ctrl1.x, cmd.ctrl1.y, vt);
            const [c2x, c2y] = toScreen(cmd.ctrl2.x, cmd.ctrl2.y, vt);
            const [x1, y1] = toScreen(cmd.point.x, cmd.point.y, vt);
            
            const highlightPath = new ck.Path();
            highlightPath.moveTo(x0, y0);
            highlightPath.cubicTo(c1x, c1y, c2x, c2y, x1, y1);
            skCanvas.drawPath(highlightPath, segmentPaint);
            highlightPath.delete();
          }
          lastOnCurve = cmd.point;
        }
      }
      
      // Handle closing segment in closed path
      const isClosed = path.commands[path.commands.length - 1]?.kind === 'Z';
      const firstOnCurve = path.commands[0]?.kind === 'M' ? path.commands[0].point : null;
      if (isClosed && lastOnCurve && firstOnCurve && lastOnCurve.id !== firstOnCurve.id) {
        const segmentId = `${path.id}:${lastOnCurve.id}:${firstOnCurve.id}`;
        if (selection.segmentIds.has(segmentId)) {
          const [x1, y1] = toScreen(lastOnCurve.x, lastOnCurve.y, vt);
          const [x2, y2] = toScreen(firstOnCurve.x, firstOnCurve.y, vt);
          skCanvas.drawLine(x1, y1, x2, y2, segmentPaint);
        }
      }
    }
    segmentPaint.delete();
  }

  // ---- 4c. Highlight hovered segments ----
  if (hoveredSegmentId && toolMode === 'node') {
    const hoverPaint = new Paint();
    hoverPaint.setAntiAlias(true);
    hoverPaint.setStyle(ck.PaintStyle.Stroke);
    hoverPaint.setStrokeWidth(4);
    hoverPaint.setColor(C.hoveredSegment);

    for (const path of paths) {
      let lastOnCurve: { id: string; x: number; y: number } | null = null;
      
      for (const cmd of path.commands) {
        if (cmd.kind === 'M') {
          lastOnCurve = cmd.point;
        } else if (cmd.kind === 'L' && lastOnCurve) {
          const segmentId = `${path.id}:${lastOnCurve.id}:${cmd.point.id}`;
          if (segmentId === hoveredSegmentId && !selection.segmentIds.has(segmentId)) {
            const [x1, y1] = toScreen(lastOnCurve.x, lastOnCurve.y, vt);
            const [x2, y2] = toScreen(cmd.point.x, cmd.point.y, vt);
            skCanvas.drawLine(x1, y1, x2, y2, hoverPaint);
          }
          lastOnCurve = cmd.point;
        } else if (cmd.kind === 'Q' && lastOnCurve) {
          const segmentId = `${path.id}:${lastOnCurve.id}:${cmd.point.id}`;
          if (segmentId === hoveredSegmentId && !selection.segmentIds.has(segmentId)) {
            const [x0, y0] = toScreen(lastOnCurve.x, lastOnCurve.y, vt);
            const [cx, cy] = toScreen(cmd.ctrl.x, cmd.ctrl.y, vt);
            const [x1, y1] = toScreen(cmd.point.x, cmd.point.y, vt);
            
            const hoverPath = new ck.Path();
            hoverPath.moveTo(x0, y0);
            hoverPath.quadTo(cx, cy, x1, y1);
            skCanvas.drawPath(hoverPath, hoverPaint);
            hoverPath.delete();
          }
          lastOnCurve = cmd.point;
        } else if (cmd.kind === 'C' && lastOnCurve) {
          const segmentId = `${path.id}:${lastOnCurve.id}:${cmd.point.id}`;
          if (segmentId === hoveredSegmentId && !selection.segmentIds.has(segmentId)) {
            const [x0, y0] = toScreen(lastOnCurve.x, lastOnCurve.y, vt);
            const [c1x, c1y] = toScreen(cmd.ctrl1.x, cmd.ctrl1.y, vt);
            const [c2x, c2y] = toScreen(cmd.ctrl2.x, cmd.ctrl2.y, vt);
            const [x1, y1] = toScreen(cmd.point.x, cmd.point.y, vt);
            
            const hoverPath = new ck.Path();
            hoverPath.moveTo(x0, y0);
            hoverPath.cubicTo(c1x, c1y, c2x, c2y, x1, y1);
            skCanvas.drawPath(hoverPath, hoverPaint);
            hoverPath.delete();
          }
          lastOnCurve = cmd.point;
        }
      }
      
      // Handle closing segment in closed path
      const isClosed = path.commands[path.commands.length - 1]?.kind === 'Z';
      const firstOnCurve = path.commands[0]?.kind === 'M' ? path.commands[0].point : null;
      if (isClosed && lastOnCurve && firstOnCurve && lastOnCurve.id !== firstOnCurve.id) {
        const segmentId = `${path.id}:${lastOnCurve.id}:${firstOnCurve.id}`;
        if (segmentId === hoveredSegmentId && !selection.segmentIds.has(segmentId)) {
          const [x1, y1] = toScreen(lastOnCurve.x, lastOnCurve.y, vt);
          const [x2, y2] = toScreen(firstOnCurve.x, firstOnCurve.y, vt);
          skCanvas.drawLine(x1, y1, x2, y2, hoverPaint);
        }
      }
    }
    hoverPaint.delete();
  }

  // ---- 5. Points ----
  const ON_R = 5;
  const OFF_SIZE = 7;

  for (const path of paths) {
    for (const cmd of path.commands) {
      const drawOnCurve = (pt: { id: string; x: number; y: number }) => {
        const [sx, sy] = toScreen(pt.x, pt.y, vt);
        const isSelected = selection.pointIds.has(pt.id);
        const isHovered = hoveredPointId === pt.id;
        const fpaint = new Paint();
        fpaint.setAntiAlias(true);
        fpaint.setStyle(ck.PaintStyle.Fill);
        fpaint.setColor(isSelected ? C.selectedFill : isHovered ? C.hoveredFill : C.onCurveFill);
        skCanvas.drawCircle(sx, sy, ON_R, fpaint);
        fpaint.delete();
        const spaint = new Paint();
        spaint.setAntiAlias(true);
        spaint.setStyle(ck.PaintStyle.Stroke);
        spaint.setStrokeWidth(1.5);
        spaint.setColor(isSelected ? C.selectedStroke : isHovered ? C.hoveredStroke : C.onCurveStroke);
        skCanvas.drawCircle(sx, sy, ON_R, spaint);
        spaint.delete();
      };

      const drawOffCurve = (pt: { id: string; x: number; y: number }) => {
        const [sx, sy] = toScreen(pt.x, pt.y, vt);
        const isSelected = selection.pointIds.has(pt.id);
        const isHovered = hoveredPointId === pt.id;
        const half = OFF_SIZE / 2;
        const rect = ck.LTRBRect(sx - half, sy - half, sx + half, sy + half);
        const fpaint = new Paint();
        fpaint.setAntiAlias(true);
        fpaint.setStyle(ck.PaintStyle.Fill);
        fpaint.setColor(isSelected ? C.selectedFill : isHovered ? C.hoveredFill : C.offCurveFill);
        skCanvas.drawRect(rect, fpaint);
        fpaint.delete();
        const spaint = new Paint();
        spaint.setAntiAlias(true);
        spaint.setStyle(ck.PaintStyle.Stroke);
        spaint.setStrokeWidth(1.5);
        spaint.setColor(isSelected ? C.selectedStroke : isHovered ? C.hoveredStroke : C.offCurveStroke);
        skCanvas.drawRect(rect, spaint);
        spaint.delete();
      };

      if (cmd.kind === 'M' || cmd.kind === 'L') drawOnCurve(cmd.point);
      else if (cmd.kind === 'Q') { drawOffCurve(cmd.ctrl); drawOnCurve(cmd.point); }
      else if (cmd.kind === 'C') { drawOffCurve(cmd.ctrl1); drawOffCurve(cmd.ctrl2); drawOnCurve(cmd.point); }
    }
  }

  // ---- 6. Direction arrows on segments ----
  if (showDirection) {
    const ARROW_HEIGHT = 12;
    const ARROW_HALF_W = 5;
    const arrowPaint = new Paint();
    arrowPaint.setAntiAlias(true);
    arrowPaint.setStyle(ck.PaintStyle.Fill);
    arrowPaint.setColor(C.directionArrow);

    const arrowPath = new ck.Path();
    for (const { sx, sy, dx, dy } of collectArrows(paths, vt)) {
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1) continue;
      const nx = dx / len;
      const ny = dy / len;
      const tipX = sx + nx * ARROW_HEIGHT / 2;
      const tipY = sy + ny * ARROW_HEIGHT / 2;
      const baseX = sx - nx * ARROW_HEIGHT / 2;
      const baseY = sy - ny * ARROW_HEIGHT / 2;
      const perpX = -ny * ARROW_HALF_W;
      const perpY = nx * ARROW_HALF_W;

      arrowPath.moveTo(tipX, tipY);
      arrowPath.lineTo(baseX + perpX, baseY + perpY);
      arrowPath.lineTo(baseX - perpX, baseY - perpY);
      arrowPath.close();
    }
    skCanvas.drawPath(arrowPath, arrowPaint);
    arrowPath.delete();
    arrowPaint.delete();
  }

  // ---- 7. Pending off-curve ghost (in draw mode) ----
  if (toolMode === 'draw' && pendingOffCurve) {
    const [psx, psy] = toScreen(pendingOffCurve.x, pendingOffCurve.y, vt);
    const half = OFF_SIZE / 2 + 1;
    const rect = ck.LTRBRect(psx - half, psy - half, psx + half, psy + half);

    // Draw a ghost dashed square to signal the pending control point
    const gfill = new Paint();
    gfill.setAntiAlias(true);
    gfill.setStyle(ck.PaintStyle.Fill);
    gfill.setColor(C.pendingOffCurve);
    skCanvas.drawRect(rect, gfill);
    gfill.delete();

    const gstroke = new Paint();
    gstroke.setAntiAlias(true);
    gstroke.setStyle(ck.PaintStyle.Stroke);
    gstroke.setStrokeWidth(1.5);
    gstroke.setColor(rgba(200, 100, 0, 0.9));
    skCanvas.drawRect(rect, gstroke);
    gstroke.delete();

  }

  // ---- 8. Rubber-band selection rect ----
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

  // ---- 9b. Smart guides (alignment lines) ----
  if (selection.pointIds.size > 0) {
    const ALIGN_TOLERANCE = 2;
    const allPoints: Array<{ x: number; y: number; id?: string }> = [];
    
    for (const path of paths) {
      for (const cmd of path.commands) {
        if (cmd.kind === 'M' || cmd.kind === 'L') {
          allPoints.push(cmd.point);
        } else if (cmd.kind === 'Q') {
          allPoints.push(cmd.ctrl);
          allPoints.push(cmd.point);
        } else if (cmd.kind === 'C') {
          allPoints.push(cmd.ctrl1);
          allPoints.push(cmd.ctrl2);
          allPoints.push(cmd.point);
        }
      }
    }
    
    // Get positions of selected points (use dragPos if dragging, otherwise use original positions)
    const selectedPositions: Array<{ x: number; y: number }> = [];
    if (dragPos && selection.pointIds.size === 1) {
      selectedPositions.push(dragPos);
    } else {
      for (const pt of allPoints) {
        if (pt.id && selection.pointIds.has(pt.id)) {
          selectedPositions.push({ x: pt.x, y: pt.y });
        }
      }
    }
    
    const matchX: Array<{ x: number; pt: { x: number; y: number; id?: string } }> = [];
    const matchY: Array<{ y: number; pt: { x: number; y: number; id?: string } }> = [];
    
    for (const selPos of selectedPositions) {
      for (const pt of allPoints) {
        if (pt.id && selection.pointIds.has(pt.id)) continue;
        if (Math.abs(pt.x - selPos.x) < ALIGN_TOLERANCE) {
          if (!matchX.some(m => Math.abs(m.x - pt.x) < 0.01)) {
            matchX.push({ x: pt.x, pt });
          }
        }
        if (Math.abs(pt.y - selPos.y) < ALIGN_TOLERANCE) {
          if (!matchY.some(m => Math.abs(m.y - pt.y) < 0.01)) {
            matchY.push({ y: pt.y, pt });
          }
        }
      }
    }
    
    if (matchX.length > 0 || matchY.length > 0) {
      const guidePaint = new Paint();
      guidePaint.setAntiAlias(true);
      guidePaint.setStyle(ck.PaintStyle.Stroke);
      guidePaint.setStrokeWidth(1.5);
      guidePaint.setColor(rgba(0, 200, 255, 0.9));
      
      for (const m of matchX) {
        const [sx] = toScreen(m.x, 0, vt);
        skCanvas.drawLine(sx, 0, sx, canvasHeight, guidePaint);
      }
      
      for (const m of matchY) {
        const [, sy] = toScreen(0, m.y, vt);
        skCanvas.drawLine(0, sy, canvasWidth, sy, guidePaint);
      }
      
      guidePaint.delete();
      
      // Highlight matching points
      const matchedPoints = new Set<{ x: number; y: number; id?: string }>();
      for (const m of matchX) matchedPoints.add(m.pt);
      for (const m of matchY) matchedPoints.add(m.pt);
      
      const highlightPaint = new Paint();
      highlightPaint.setAntiAlias(true);
      highlightPaint.setStyle(ck.PaintStyle.Fill);
      highlightPaint.setColor(rgba(0, 200, 255, 0.6));
      
      for (const pt of matchedPoints) {
        const [sx, sy] = toScreen(pt.x, pt.y, vt);
        skCanvas.drawCircle(sx, sy, 8, highlightPaint);
      }
      
      highlightPaint.delete();
    }
  }
  } // end if (paths.length > 0)

  // ---- 8b. Connect preview line (drawn during 'connect' drag in pen mode) ----
  if (connectPreview) {
    const [fromSx, fromSy] = toScreen(connectPreview.fromX, connectPreview.fromY, vt);
    const [toSx, toSy] = toScreen(connectPreview.toX, connectPreview.toY, vt);
    const previewPaint = new Paint();
    previewPaint.setAntiAlias(true);
    previewPaint.setStyle(ck.PaintStyle.Stroke);
    previewPaint.setStrokeWidth(1.5);
    previewPaint.setColor(rgba(0, 112, 243, 0.6));
    skCanvas.drawLine(fromSx, fromSy, toSx, toSy, previewPaint);
    previewPaint.delete();
  }

  // ---- 9. Selection bounding box (shown after multi-point drag completes) ----
  if (showTransformBox && selection.pointIds.size > 1) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const path of paths) {
      for (const cmd of path.commands) {
        const pts =
          cmd.kind === 'M' || cmd.kind === 'L' ? [cmd.point]
          : cmd.kind === 'Q' ? [cmd.ctrl, cmd.point]
          : cmd.kind === 'C' ? [cmd.ctrl1, cmd.ctrl2, cmd.point]
          : [];
        for (const pt of pts) {
          if (selection.pointIds.has(pt.id)) {
            if (pt.x < minX) minX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y > maxY) maxY = pt.y;
          }
        }
      }
    }
    if (isFinite(minX)) {
      const pad = 8;
      const [sx1r, sy1r] = toScreen(minX, maxY, vt); // top-left before pad
      const [sx2r, sy2r] = toScreen(maxX, minY, vt); // bottom-right before pad
      const sx1 = sx1r - pad, sy1 = sy1r - pad;
      const sx2 = sx2r + pad, sy2 = sy2r + pad;
      const midX = (sx1 + sx2) / 2;
      const midY = (sy1 + sy2) / 2;

      // Box outline
      const boxPath = new ck.Path();
      boxPath.moveTo(sx1, sy1);
      boxPath.lineTo(sx2, sy1);
      boxPath.lineTo(sx2, sy2);
      boxPath.lineTo(sx1, sy2);
      boxPath.close();
      const boxPaint = new Paint();
      boxPaint.setAntiAlias(true);
      boxPaint.setStyle(ck.PaintStyle.Stroke);
      boxPaint.setColor(C.transformBox);
      boxPaint.setStrokeWidth(1.5);
      skCanvas.drawPath(boxPath, boxPaint);
      boxPaint.delete();
      boxPath.delete();

      // 8 resize handles (squares)
      const HANDLE_HALF = 4;
      const hFill = new Paint();
      hFill.setAntiAlias(true);
      hFill.setStyle(ck.PaintStyle.Fill);
      hFill.setColor(C.transformHandle);
      const hStroke = new Paint();
      hStroke.setAntiAlias(true);
      hStroke.setStyle(ck.PaintStyle.Stroke);
      hStroke.setStrokeWidth(1.5);
      hStroke.setColor(C.transformHandleStroke);
      const handlePositions: [number, number][] = [
        [sx1, sy1], [sx2, sy1], [sx1, sy2], [sx2, sy2],
        [midX, sy1], [midX, sy2], [sx1, midY], [sx2, midY],
      ];
      for (const [hx, hy] of handlePositions) {
        const r = ck.LTRBRect(hx - HANDLE_HALF, hy - HANDLE_HALF, hx + HANDLE_HALF, hy + HANDLE_HALF);
        skCanvas.drawRect(r, hFill);
        skCanvas.drawRect(r, hStroke);
      }
      hFill.delete();
      hStroke.delete();

      // Rotation handle: stem line + circle
      const ROTATE_Y = sy1 - 24;
      const linePaint = new Paint();
      linePaint.setAntiAlias(true);
      linePaint.setStyle(ck.PaintStyle.Stroke);
      linePaint.setStrokeWidth(1);
      linePaint.setColor(C.transformBox);
      skCanvas.drawLine(midX, sy1, midX, ROTATE_Y, linePaint);
      linePaint.delete();
      const rFill = new Paint();
      rFill.setAntiAlias(true);
      rFill.setStyle(ck.PaintStyle.Fill);
      rFill.setColor(C.transformHandle);
      const rStroke = new Paint();
      rStroke.setAntiAlias(true);
      rStroke.setStyle(ck.PaintStyle.Stroke);
      rStroke.setStrokeWidth(1.5);
      rStroke.setColor(C.transformHandleStroke);
      skCanvas.drawCircle(midX, ROTATE_Y, 5, rFill);
      skCanvas.drawCircle(midX, ROTATE_Y, 5, rStroke);
      rFill.delete();
      rStroke.delete();
    }
  }

  // ---- 9c. Image transform box (when focused layer is image) ----
  if (focusedLayerId) {
    const focusedLayer = layers.find(l => l.id === focusedLayerId);
    if (focusedLayer?.type === 'image' && focusedLayer.visible) {
      const il = focusedLayer as ImageLayer;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const img = (imageCache as Map<string, any>).get(il.id);
      if (img) {
        const [cx, cy] = toScreen(il.offsetX, il.offsetY, vt);
        const halfW = img.width() * il.scaleX * vt.scale / 2;
        const halfH = img.height() * il.scaleY * vt.scale / 2;
        const angleRad = il.rotation * Math.PI / 180;
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);
        const rot = (lx: number, ly: number): [number, number] => [
          cx + lx * cos - ly * sin,
          cy + lx * sin + ly * cos,
        ];

        // Rotated bounding box
        const [tlX, tlY] = rot(-halfW, -halfH);
        const [trX, trY] = rot(halfW, -halfH);
        const [brX, brY] = rot(halfW, halfH);
        const [blX, blY] = rot(-halfW, halfH);
        const imgBoxPath = new ck.Path();
        imgBoxPath.moveTo(tlX, tlY);
        imgBoxPath.lineTo(trX, trY);
        imgBoxPath.lineTo(brX, brY);
        imgBoxPath.lineTo(blX, blY);
        imgBoxPath.close();
        const imgBoxPaint = new Paint();
        imgBoxPaint.setAntiAlias(true);
        imgBoxPaint.setStyle(ck.PaintStyle.Stroke);
        imgBoxPaint.setStrokeWidth(1.5);
        imgBoxPaint.setColor(C.transformBox);
        skCanvas.drawPath(imgBoxPath, imgBoxPaint);
        imgBoxPaint.delete();
        imgBoxPath.delete();

        // 8 resize handles (squares)
        const HANDLE_HALF = 4;
        const imgHFill = new Paint();
        imgHFill.setAntiAlias(true);
        imgHFill.setStyle(ck.PaintStyle.Fill);
        imgHFill.setColor(C.transformHandle);
        const imgHStroke = new Paint();
        imgHStroke.setAntiAlias(true);
        imgHStroke.setStyle(ck.PaintStyle.Stroke);
        imgHStroke.setStrokeWidth(1.5);
        imgHStroke.setColor(C.transformHandleStroke);

        const handlePositions: [number, number][] = [
          [-halfW, -halfH], [halfW, -halfH], [-halfW, halfH], [halfW, halfH],
          [0, -halfH], [0, halfH], [-halfW, 0], [halfW, 0],
        ];
        for (const [lx, ly] of handlePositions) {
          const [hx, hy] = rot(lx, ly);
          const r = ck.LTRBRect(hx - HANDLE_HALF, hy - HANDLE_HALF, hx + HANDLE_HALF, hy + HANDLE_HALF);
          skCanvas.drawRect(r, imgHFill);
          skCanvas.drawRect(r, imgHStroke);
        }

        // Rotation handle above top-center
        const ROTATION_OFFSET = 24;
        const [tmX, tmY] = rot(0, -halfH);
        const [rotHX, rotHY] = rot(0, -(halfH + ROTATION_OFFSET));
        skCanvas.drawLine(tmX, tmY, rotHX, rotHY, imgHStroke);
        skCanvas.drawCircle(rotHX, rotHY, 5, imgHFill);
        skCanvas.drawCircle(rotHX, rotHY, 5, imgHStroke);

        imgHFill.delete();
        imgHStroke.delete();
      }
    }
  }

  // ---- 10. Draw-mode ghost point (cursor preview) ----
  if (toolMode === 'draw' && mousePos) {
    drawGhostPoint(ck, skCanvas, mousePos.x, mousePos.y, C.ghostPoint);
  }

  // ---- 11. Rulers (drawn last to appear on top) ----
  const rulerBgPaint = new Paint();
  rulerBgPaint.setAntiAlias(true);
  rulerBgPaint.setStyle(ck.PaintStyle.Fill);
  rulerBgPaint.setColor(C.rulerBg);

  // Horizontal ruler background (top)
  skCanvas.drawRect(ck.LTRBRect(0, 0, canvasWidth, RULER_WIDTH), rulerBgPaint);
  // Vertical ruler background (left)
  skCanvas.drawRect(ck.LTRBRect(0, 0, RULER_WIDTH, canvasHeight), rulerBgPaint);

  const rulerTickPaint = new Paint();
  rulerTickPaint.setAntiAlias(true);
  rulerTickPaint.setStyle(ck.PaintStyle.Stroke);
  rulerTickPaint.setStrokeWidth(1.5);
  rulerTickPaint.setColor(C.rulerTick);

  const textFont = new ck.Font(null, 8);
  const textPaint = new Paint();
  textPaint.setAntiAlias(true);
  textPaint.setStyle(ck.PaintStyle.Fill);
  textPaint.setColor(C.rulerText);

  // Determine nice tick interval based on scale
  const minTickSpacing = 40;
  const rawInterval = minTickSpacing / vt.scale;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)));
  const normalized = rawInterval / magnitude;
  let tickInterval: number;
  if (normalized < 2) tickInterval = magnitude;
  else if (normalized < 5) tickInterval = 2 * magnitude;
  else tickInterval = 5 * magnitude;

  // Horizontal ruler (X axis)
  const minFontX = (RULER_WIDTH - vt.originX) / vt.scale;
  const maxFontX = (canvasWidth - vt.originX) / vt.scale;
  const startX = Math.floor(minFontX / tickInterval) * tickInterval;
  const endX = Math.ceil(maxFontX / tickInterval) * tickInterval;
  for (let fontX = startX; fontX <= endX; fontX += tickInterval) {
    const [sx] = toScreen(fontX, 0, vt);
    if (sx < RULER_WIDTH || sx > canvasWidth) continue;
    
    skCanvas.drawLine(sx, RULER_WIDTH - 10, sx, RULER_WIDTH, rulerTickPaint);
    
    const label = Math.round(fontX).toString();
    const textBlob = ck.TextBlob.MakeFromText(label, textFont);
    if (textBlob) {
      skCanvas.drawTextBlob(textBlob, sx + 2, RULER_WIDTH - 12, textPaint);
      textBlob.delete();
    }

    const halfInterval = tickInterval / 2;
    const [minorSx] = toScreen(fontX + halfInterval, 0, vt);
    if (minorSx > RULER_WIDTH && minorSx < canvasWidth) {
      skCanvas.drawLine(minorSx, RULER_WIDTH - 5, minorSx, RULER_WIDTH, rulerTickPaint);
    }
  }

  // Vertical ruler (Y axis)
  const minFontY = (vt.originY - canvasHeight) / vt.scale;
  const maxFontY = (vt.originY - RULER_WIDTH) / vt.scale;
  const startY = Math.floor(minFontY / tickInterval) * tickInterval;
  const endY = Math.ceil(maxFontY / tickInterval) * tickInterval;
  for (let fontY = startY; fontY <= endY; fontY += tickInterval) {
    const [, sy] = toScreen(0, fontY, vt);
    if (sy < RULER_WIDTH || sy > canvasHeight) continue;
    
    skCanvas.drawLine(RULER_WIDTH - 10, sy, RULER_WIDTH, sy, rulerTickPaint);
    
    const label = Math.round(fontY).toString();
    const textBlob = ck.TextBlob.MakeFromText(label, textFont);
    if (textBlob) {
      skCanvas.drawTextBlob(textBlob, 2, sy + 3, textPaint);
      textBlob.delete();
    }

    const halfInterval = tickInterval / 2;
    const [, minorSy] = toScreen(0, fontY + halfInterval, vt);
    if (minorSy > RULER_WIDTH && minorSy < canvasHeight) {
      skCanvas.drawLine(RULER_WIDTH - 5, minorSy, RULER_WIDTH, minorSy, rulerTickPaint);
    }
  }

  // Ruler border lines
  skCanvas.drawLine(0, RULER_WIDTH, canvasWidth, RULER_WIDTH, rulerTickPaint);
  skCanvas.drawLine(RULER_WIDTH, 0, RULER_WIDTH, canvasHeight, rulerTickPaint);

  rulerBgPaint.delete();
  rulerTickPaint.delete();
  textPaint.delete();
  textFont.delete();
}

function drawGhostPoint(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ck: any, skCanvas: any,
  sx: number, sy: number,
  color: Float32Array,
) {
  const gpaint = new ck.Paint();
  gpaint.setAntiAlias(true);
  gpaint.setStyle(ck.PaintStyle.Fill);
  gpaint.setColor(color);
  skCanvas.drawCircle(sx, sy, 5, gpaint);
  gpaint.delete();
}

/** Hook that returns a `redraw` trigger bound to a surface ref. */
export function useEditorRenderer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ck: any | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  surfaceRef: React.MutableRefObject<any | null>,
  surfaceValidRef: React.MutableRefObject<boolean>,
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
    showPixelGrid: boolean;
  }>,
  metricsRef: React.MutableRefObject<FontMetrics | null>,
  extraRef: React.MutableRefObject<{
    rubberBand: RubberBand | null;
    mousePos: { x: number; y: number } | null;
    pendingOffCurve: { x: number; y: number } | null;
    canvasWidth: number;
    canvasHeight: number;
    hoveredPointId: string | null;
    hoveredSegmentId: string | null;
    dragPos: { x: number; y: number } | null;
    connectPreview: { fromX: number; fromY: number; toX: number; toY: number } | null;
  }>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  imageCacheRef: React.MutableRefObject<Map<string, any>>,
) {
  const pendingRef = useRef(false);
  const surfaceIdRef = useRef(0);

  const redraw = useCallback(() => {
    if (!ck || !surfaceRef.current || !surfaceValidRef.current) return;
    if (pendingRef.current) return;
    pendingRef.current = true;

    const currentSurfaceId = surfaceIdRef.current;
    // Use browser RAF instead of surface.requestAnimationFrame to avoid
    // "Cannot pass deleted object as a pointer of type Surface" errors that
    // occur when the CanvasKit surface is deleted while a native RAF is pending.
    requestAnimationFrame(() => {
      if (!surfaceValidRef.current || surfaceIdRef.current !== currentSurfaceId || !surfaceRef.current) {
        pendingRef.current = false;
        return;
      }
      pendingRef.current = false;
      const s = stateRef.current;
      const extra = extraRef.current;
      const skCanvas = surfaceRef.current.getCanvas();
      const inactiveDrawingPaths = (s.layers ?? [])
        .filter((l): l is DrawingLayer => l.type === 'drawing' && l.visible && l.id !== s.activeLayerId)
        .flatMap(l => l.paths);
      renderFrame(
        ck, skCanvas,
        s.paths, metricsRef.current,
        s.viewTransform, s.selection,
        extra.rubberBand, extra.mousePos,
        extra.pendingOffCurve,
        s.toolMode,
        extra.canvasWidth, extra.canvasHeight,
        s.showDirection ?? false,
        extra.hoveredPointId ?? null,
        extra.hoveredSegmentId ?? null,
        extra.dragPos ?? null,
        s.layers ?? [],
        imageCacheRef.current,
        inactiveDrawingPaths,
        s.focusedLayerId ?? '',
        s.showTransformBox ?? false,
        extra.connectPreview ?? null,
        s.showPixelGrid ?? false,
      );
      surfaceRef.current.flush();
    });
  }, [ck, surfaceRef, surfaceValidRef, stateRef, metricsRef, extraRef, imageCacheRef]);

  const registerSurface = useCallback(() => {
    surfaceIdRef.current++;
    surfaceValidRef.current = true;
    pendingRef.current = false; // reset so the next redraw() call isn't skipped
  }, [surfaceValidRef]);

  return { redraw, registerSurface };
}
