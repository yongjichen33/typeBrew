import { useEffect, useRef, useState } from 'react';
import type { EditablePath, FontMetrics } from '@/lib/editorTypes';

interface GlyphPreviewProps {
  ck: unknown;
  paths: EditablePath[];
  metrics: FontMetrics;
  inverted: boolean;
  height: number;
}

function computePreviewTransform(
  metrics: FontMetrics,
  canvasWidth: number,
  canvasHeight: number
): { scale: number; originX: number; originY: number } {
  const glyphW = metrics.xMax - metrics.xMin || metrics.advanceWidth || metrics.unitsPerEm;
  const glyphH = metrics.yMax - metrics.yMin || metrics.unitsPerEm;

  if (glyphW === 0 || glyphH === 0) {
    return { scale: 1, originX: canvasWidth / 2, originY: canvasHeight / 2 };
  }

  const padding = 0.1;
  const scale = Math.min(
    (canvasWidth * (1 - 2 * padding)) / glyphW,
    (canvasHeight * (1 - 2 * padding)) / glyphH
  );

  const centerFontX = (metrics.xMin + metrics.xMax) / 2;
  const centerFontY = (metrics.yMin + metrics.yMax) / 2;

  return {
    scale,
    originX: canvasWidth / 2 - centerFontX * scale,
    originY: canvasHeight / 2 + centerFontY * scale,
  };
}

function toScreen(
  fx: number,
  fy: number,
  vt: { scale: number; originX: number; originY: number }
): [number, number] {
  return [vt.originX + fx * vt.scale, vt.originY - fy * vt.scale];
}

export function GlyphPreview({ ck, paths, metrics, inverted, height }: GlyphPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const surfaceRef = useRef<any | null>(null);
  const surfaceValidRef = useRef(false);

  const [canvasWidth, setCanvasWidth] = useState(200);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setCanvasWidth(Math.floor(entry.contentRect.width));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const ckInstance = ck as any;
    if (!ckInstance || !canvasRef.current) return;

    const canvas = canvasRef.current;
    canvas.width = canvasWidth;
    canvas.height = height;

    if (surfaceRef.current) {
      surfaceValidRef.current = false;
      surfaceRef.current.delete();
      surfaceRef.current = null;
    }

    const surface =
      ckInstance.MakeSWCanvasSurface(canvas) ?? ckInstance.MakeWebGLCanvasSurface(canvas);
    if (!surface) return;

    surfaceRef.current = surface;
    surfaceValidRef.current = true;

    return () => {
      if (surfaceRef.current) {
        surfaceValidRef.current = false;
        surfaceRef.current.delete();
        surfaceRef.current = null;
      }
    };
  }, [ck, canvasWidth, height]);

  useEffect(() => {
    const ckInstance = ck as any;
    if (!ckInstance || !surfaceRef.current || !surfaceValidRef.current) return;

    const skCanvas = surfaceRef.current.getCanvas();
    const vt = computePreviewTransform(metrics, canvasWidth, height);

    // Clear with background color
    const bgColor = inverted ? [0, 0, 0, 1] : [1, 1, 1, 1];
    skCanvas.clear(ckInstance.Color4f(bgColor[0], bgColor[1], bgColor[2], bgColor[3]));

    if (paths.length === 0) {
      surfaceRef.current.flush();
      return;
    }

    // Build SkPath
    const skPath = new ckInstance.Path();
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

    // Fill with glyph color
    const Paint = ckInstance.Paint;
    const fillPaint = new Paint();
    fillPaint.setAntiAlias(true);
    fillPaint.setStyle(ckInstance.PaintStyle.Fill);
    const fillColor = inverted ? [1, 1, 1, 1] : [0, 0, 0, 1];
    fillPaint.setColor(new Float32Array(fillColor));

    skCanvas.drawPath(skPath, fillPaint);
    fillPaint.delete();
    skPath.delete();

    surfaceRef.current.flush();
  }, [ck, paths, metrics, inverted, canvasWidth, height]);

  return (
    <div ref={containerRef} className="w-full" style={{ height }}>
      <canvas
        ref={canvasRef}
        style={{
          width: canvasWidth,
          height,
          display: 'block',
        }}
      />
    </div>
  );
}
