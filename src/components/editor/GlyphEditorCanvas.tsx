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
  dispatch: (action: unknown) => void;
  stateRef: React.MutableRefObject<{
    paths: EditablePath[];
    selection: Selection;
    toolMode: string;
    drawPointType: string;
    viewTransform: ViewTransform;
  }>;
}

export function GlyphEditorCanvas({
  ck,
  paths,
  selection,
  toolMode,
  viewTransform,
  metrics,
  dispatch,
  stateRef,
}: GlyphEditorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const surfaceRef = useRef<any | null>(null);

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

  const { redraw } = useEditorRenderer(ck, surfaceRef, stateRef, metricsRef, extraRef);

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
    redraw();

    return () => {
      if (surfaceRef.current) {
        surfaceRef.current.delete();
        surfaceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ck, canvasSize.w, canvasSize.h]);

  // Trigger redraw on relevant state changes
  useEffect(() => {
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths, selection, toolMode, viewTransform, rubberBand, mousePos, pendingOffCurve]);

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

  const getCanvasRect = () => canvasRef.current?.getBoundingClientRect() ?? null;

  const { onPointerDown, onPointerMove, onPointerUp, onWheel, onPointerLeave } =
    useEditorInteraction({ stateRef, dispatch, setRubberBand, setMousePos, setPendingOffCurve, redraw, getCanvasRect });

  return (
    <div ref={containerRef} className="flex-1 min-h-0 w-full relative overflow-hidden bg-white">
      <canvas
        ref={canvasRef}
        style={{
          width: canvasSize.w,
          height: canvasSize.h,
          cursor: toolMode === 'draw' ? 'crosshair' : 'default',
          display: 'block',
        }}
        onPointerDown={(e) => onPointerDown(e.nativeEvent)}
        onPointerMove={(e) => onPointerMove(e.nativeEvent)}
        onPointerUp={(e) => onPointerUp(e.nativeEvent)}
        onPointerLeave={onPointerLeave}
        onWheel={(e) => onWheel(e.nativeEvent)}
      />
    </div>
  );
}
