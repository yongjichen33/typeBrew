import { useCallback, useRef } from 'react';
import type { EditablePath, FontMetrics, ViewTransform, Selection, RubberBand } from '@/lib/editorTypes';

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
  ascender:        rgba(100, 130, 200, 0.8),
  descender:       rgba(200, 100, 100, 0.8),
  xHeight:         rgba(100, 200, 150, 0.8),
  capHeight:       rgba(200, 150, 100, 0.8),
  advance:         rgba(100, 180, 100, 0.8),
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

/** Compute bounding box of selected points in font-space. */
function computeSelectionBBox(
  paths: EditablePath[],
  selection: Selection,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const selectedPoints: Array<{ x: number; y: number }> = [];

  for (const path of paths) {
    let lastOnCurve: { id: string; x: number; y: number } | null = null;

    for (const cmd of path.commands) {
      if (cmd.kind === 'M') {
        if (selection.pointIds.has(cmd.point.id)) {
          selectedPoints.push(cmd.point);
        }
        lastOnCurve = cmd.point;
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
    const isClosed = path.commands[path.commands.length - 1]?.kind === 'Z';
    const firstOnCurve = path.commands[0]?.kind === 'M' ? path.commands[0].point : null;
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
  drawHLine(metrics.ascender, C.ascender, 0, metrics.advanceWidth);
  drawHLine(metrics.descender, C.descender, 0, metrics.advanceWidth);
  if (metrics.xHeight) drawHLine(metrics.xHeight, C.xHeight, 0, metrics.advanceWidth);
  if (metrics.capHeight) drawHLine(metrics.capHeight, C.capHeight, 0, metrics.advanceWidth);
  drawVLine(0, C.baseline, minY, maxY);
  drawVLine(metrics.advanceWidth, C.advance, minY, maxY);
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

  if (paths.length === 0) {
    // Still draw draw-mode UI even with no path data
    if (toolMode === 'draw' && mousePos) {
      drawGhostPoint(ck, skCanvas, mousePos.x, mousePos.y, C.ghostPoint);
    }
    return;
  }

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

  // ---- 9. Transformation UI (selection bounding box with handles) ----
  if (toolMode === 'node') {
    const totalSelected = selection.pointIds.size + selection.segmentIds.size;
    if (totalSelected > 1) {
      const bbox = computeSelectionBBox(paths, selection);
      if (bbox) {
      const [sx1, sy1] = toScreen(bbox.minX, bbox.maxY, vt);
      const [sx2, sy2] = toScreen(bbox.maxX, bbox.minY, vt);
      
      const padding = 8;
      const left = sx1 - padding;
      const top = sy1 - padding;
      const right = sx2 + padding;
      const bottom = sy2 + padding;
      
      const boxPaint = new Paint();
      boxPaint.setAntiAlias(true);
      boxPaint.setStyle(ck.PaintStyle.Stroke);
      boxPaint.setStrokeWidth(1);
      boxPaint.setColor(C.transformBox);
      skCanvas.drawRect(ck.LTRBRect(left, top, right, bottom), boxPaint);
      boxPaint.delete();

      const handleFill = new Paint();
      handleFill.setAntiAlias(true);
      handleFill.setStyle(ck.PaintStyle.Fill);
      handleFill.setColor(C.transformHandle);

      const handleStroke = new Paint();
      handleStroke.setAntiAlias(true);
      handleStroke.setStyle(ck.PaintStyle.Stroke);
      handleStroke.setStrokeWidth(1.5);
      handleStroke.setColor(C.transformHandleStroke);

      const HANDLE_R = 4;
      const drawHandle = (hx: number, hy: number) => {
        skCanvas.drawCircle(hx, hy, HANDLE_R, handleFill);
        skCanvas.drawCircle(hx, hy, HANDLE_R, handleStroke);
      };

      drawHandle(left, top);
      drawHandle(right, top);
      drawHandle(left, bottom);
      drawHandle(right, bottom);
      drawHandle((left + right) / 2, top);
      drawHandle((left + right) / 2, bottom);
      drawHandle(left, (top + bottom) / 2);
      drawHandle(right, (top + bottom) / 2);

      const ROTATION_HANDLE_OFFSET = 20;
      const rotationY = top - ROTATION_HANDLE_OFFSET;
      skCanvas.drawLine((left + right) / 2, top, (left + right) / 2, rotationY, handleStroke);
      
      const rotPaint = new Paint();
      rotPaint.setAntiAlias(true);
      rotPaint.setStyle(ck.PaintStyle.Stroke);
      rotPaint.setStrokeWidth(2);
      rotPaint.setColor(C.transformHandleStroke);
      
      const cx = (left + right) / 2;
      const cy = rotationY;
      skCanvas.drawCircle(cx, cy, HANDLE_R + 1, rotPaint);
      
      const arrowPath = new ck.Path();
      arrowPath.moveTo(cx + 6, cy - 2);
      arrowPath.lineTo(cx + 2, cy - 6);
      arrowPath.lineTo(cx + 2, cy + 2);
      arrowPath.close();
      skCanvas.drawPath(arrowPath, handleFill);
      arrowPath.delete();
      
      rotPaint.delete();
      handleFill.delete();
      handleStroke.delete();
      }
    }
  }

  // ---- 10. Draw-mode ghost point (cursor preview) ----
  if (toolMode === 'draw' && mousePos) {
    drawGhostPoint(ck, skCanvas, mousePos.x, mousePos.y, C.ghostPoint);
  }
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
  }>,
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
      );
      surfaceRef.current.flush();
    });
  }, [ck, surfaceRef, surfaceValidRef, stateRef, metricsRef, extraRef]);

  const registerSurface = useCallback(() => {
    surfaceIdRef.current++;
    surfaceValidRef.current = true;
    pendingRef.current = false; // reset so the next redraw() call isn't skipped
  }, [surfaceValidRef]);

  return { redraw, registerSurface };
}
