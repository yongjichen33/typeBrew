import { useEffect, useRef, useState } from 'react';
import { useEditorRenderer } from '@/hooks/useEditorRenderer';
import { useEditorInteraction } from '@/hooks/useEditorInteraction';
import type {
  EditablePath,
  FontMetrics,
  Selection,
  ViewTransform,
  RubberBand,
} from '@/lib/editorTypes';

interface GlyphEditorCanvasProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ck: any;
  paths: EditablePath[];
  selection: Selection;
  toolMode: string;
  viewTransform: ViewTransform;
  metrics: FontMetrics;
  showDirection: boolean;
  showCoordinates: boolean;
  dispatch: (action: unknown) => void;
  stateRef: React.MutableRefObject<{
    paths: EditablePath[];
    selection: Selection;
    toolMode: string;
    drawPointType: string;
    viewTransform: ViewTransform;
    showDirection: boolean;
    showCoordinates: boolean;
  }>;
}

export function GlyphEditorCanvas({
  ck,
  paths,
  selection,
  toolMode,
  viewTransform,
  metrics,
  showDirection,
  showCoordinates,
  dispatch,
  stateRef,
}: GlyphEditorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const surfaceRef = useRef<any | null>(null);
  const surfaceValidRef = useRef(false);

  const [canvasSize, setCanvasSize] = useState({ w: 1, h: 1 });

  const metricsRef = useRef<FontMetrics>(metrics);
  useEffect(() => { metricsRef.current = metrics; }, [metrics]);

  const [rubberBand, setRubberBandState] = useState<RubberBand | null>(null);
  const [mousePos, setMousePosState] = useState<{ x: number; y: number } | null>(null);
  const [pendingOffCurve, setPendingOffCurveState] = useState<{ x: number; y: number } | null>(null);

  const rubberBandRef = useRef<RubberBand | null>(null);
  const mousePosRef = useRef<{ x: number; y: number } | null>(null);
  const pendingOffCurveRef = useRef<{ x: number; y: number } | null>(null);

  const extraRef = useRef({
    rubberBand: rubberBandRef.current,
    mousePos: mousePosRef.current,
    pendingOffCurve: pendingOffCurveRef.current,
    canvasWidth: canvasSize.w,
    canvasHeight: canvasSize.h,
  });

  // Keep extra ref up to date
  useEffect(() => {
    extraRef.current = {
      rubberBand: rubberBandRef.current,
      mousePos: mousePosRef.current,
      pendingOffCurve: pendingOffCurveRef.current,
      canvasWidth: canvasSize.w,
      canvasHeight: canvasSize.h,
    };
  }, [rubberBand, mousePos, pendingOffCurve, canvasSize]);

  const setRubberBand = (rb: RubberBand | null) => {
    rubberBandRef.current = rb;
    extraRef.current = { ...extraRef.current, rubberBand: rb };
    setRubberBandState(rb);
  };
  const setMousePos = (pos: { x: number; y: number } | null) => {
    mousePosRef.current = pos;
    extraRef.current = { ...extraRef.current, mousePos: pos };
    setMousePosState(pos);
  };
  const setPendingOffCurve = (pos: { x: number; y: number } | null) => {
    pendingOffCurveRef.current = pos;
    extraRef.current = { ...extraRef.current, pendingOffCurve: pos };
    setPendingOffCurveState(pos);
  };

  const { redraw, registerSurface } = useEditorRenderer(ck, surfaceRef, surfaceValidRef, stateRef, metricsRef, extraRef);

  // Create/destroy CanvasKit surface when ck or canvas size changes
  useEffect(() => {
    if (!ck || !canvasRef.current) return;

    // Set physical canvas size (matching CSS size)
    const canvas = canvasRef.current;
    canvas.width = canvasSize.w;
    canvas.height = canvasSize.h;
    extraRef.current = { ...extraRef.current, canvasWidth: canvasSize.w, canvasHeight: canvasSize.h };

    // Destroy old surface
    if (surfaceRef.current) {
      surfaceValidRef.current = false;
      surfaceRef.current.delete();
      surfaceRef.current = null;
    }

    // Create new surface
    const surface = ck.MakeSWCanvasSurface(canvas) ?? ck.MakeWebGLCanvasSurface(canvas);
    if (!surface) {
      console.error('Failed to create CanvasKit surface');
      return;
    }
    surfaceRef.current = surface;
    registerSurface();
    redraw();

    return () => {
      if (surfaceRef.current) {
        surfaceValidRef.current = false;
        surfaceRef.current.delete();
        surfaceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ck, canvasSize.w, canvasSize.h]);

  // Trigger redraw on relevant state changes
  useEffect(() => {
    redraw();
  }, [redraw, paths, selection, toolMode, viewTransform, rubberBand, mousePos, pendingOffCurve, showDirection, showCoordinates]);

  // Observe container size and update canvas dimensions
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        setCanvasSize({ w: Math.floor(width), h: Math.floor(height) });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Redraw when the tab becomes visible again (GL shows the hidden container)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) redraw();
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getCanvasRect = () => canvasRef.current?.getBoundingClientRect() ?? null;

  const { onPointerDown, onPointerMove, onPointerUp, onWheel, onPointerLeave } =
    useEditorInteraction({ stateRef, dispatch, setRubberBand, setMousePos, setPendingOffCurve, redraw, getCanvasRect });

  // Collect on-curve screen positions for coordinate labels
  const coordLabels = showCoordinates ? paths.flatMap((path) =>
    path.commands.flatMap((cmd) => {
      const pt =
        cmd.kind === 'M' || cmd.kind === 'L' ? cmd.point :
        cmd.kind === 'Q' ? cmd.point :
        cmd.kind === 'C' ? cmd.point :
        null;
      if (!pt) return [];
      const sx = viewTransform.originX + pt.x * viewTransform.scale;
      const sy = viewTransform.originY - pt.y * viewTransform.scale;
      return [{ id: pt.id, label: `${Math.round(pt.x)}, ${Math.round(pt.y)}`, sx, sy }];
    })
  ) : [];

  // Metric line labels (HTML overlay, since CanvasKit has no bundled fonts)
  const metricLabels = (() => {
    const labels: Array<{ key: string; label: string; sx?: number; sy?: number; isVertical: boolean; color: string }> = [];
    const { originX, originY, scale } = viewTransform;
    const W = canvasSize.w;
    const H = canvasSize.h;

    const addH = (fontY: number, label: string, color: string) => {
      const sy = originY - fontY * scale;
      if (sy < -10 || sy > H + 10) return;
      labels.push({ key: label, label, sy, isVertical: false, color });
    };
    const addV = (fontX: number, label: string, color: string) => {
      const sx = originX + fontX * scale;
      if (sx < -10 || sx > W + 10) return;
      labels.push({ key: label, label, sx, isVertical: true, color });
    };

    addH(0, 'Baseline', 'rgb(150,150,150)');
    addH(metrics.ascender, 'Ascender', 'rgb(100,130,200)');
    addH(metrics.descender, 'Descender', 'rgb(200,100,100)');
    if (metrics.xHeight) addH(metrics.xHeight, 'x-height', 'rgb(100,200,150)');
    if (metrics.capHeight) addH(metrics.capHeight, 'Cap height', 'rgb(200,150,100)');
    addV(0, 'Origin', 'rgb(150,150,150)');
    addV(metrics.advanceWidth, 'Advance', 'rgb(100,180,100)');

    return labels;
  })();

  return (
    <div ref={containerRef} className="flex-1 min-h-0 w-full relative overflow-hidden bg-white">
      <canvas
        ref={canvasRef}
        style={{
          width: canvasSize.w,
          height: canvasSize.h,
          cursor: toolMode === 'draw' ? 'crosshair' : toolMode === 'hand' ? 'grab' : 'default',
          display: 'block',
        }}
        onPointerDown={(e) => onPointerDown(e.nativeEvent)}
        onPointerMove={(e) => onPointerMove(e.nativeEvent)}
        onPointerUp={(e) => onPointerUp(e.nativeEvent)}
        onPointerLeave={onPointerLeave}
        onWheel={(e) => onWheel(e.nativeEvent)}
      />
      {/* Metric line labels */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {metricLabels.map(({ key, label, sx, sy, isVertical, color }) => (
          <span
            key={key}
            className="absolute text-[10px] font-mono whitespace-nowrap"
            style={
              isVertical
                ? { left: (sx ?? 0) + 4, top: 4, color }
                : { right: 4, top: (sy ?? 0) - 14, color }
            }
          >
            {label}
          </span>
        ))}
      </div>
      {coordLabels.length > 0 && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {coordLabels.map(({ id, label, sx, sy }) => (
            <span
              key={id}
              className="absolute text-[10px] font-mono text-gray-600 whitespace-nowrap"
              style={{ left: sx + 8, top: sy - 6 }}
            >
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
