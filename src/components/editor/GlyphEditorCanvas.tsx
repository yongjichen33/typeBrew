import { useEffect, useRef, useState } from 'react';
import { useEditorRenderer } from '@/hooks/useEditorRenderer';
import { useEditorInteraction } from '@/hooks/useEditorInteraction';
import type {
  EditablePath,
  FontMetrics,
  Selection,
  ViewTransform,
  RubberBand,
  Layer,
  ImageLayer,
} from '@/lib/editorTypes';
import type { TransformFeedback } from './GlyphEditorTab';

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
  layers: Layer[];
  activeLayerId: string;
  dispatch: (action: unknown) => void;
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
    isComposite: boolean;
  }>;
  showTransformBox: boolean;
  showPixelGrid: boolean;
  onTransformFeedback?: (feedback: TransformFeedback) => void;
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
  layers,
  dispatch,
  stateRef,
  showTransformBox,
  showPixelGrid,
  onTransformFeedback,
}: GlyphEditorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const surfaceRef = useRef<any | null>(null);
  const surfaceValidRef = useRef(false);

  const [canvasSize, setCanvasSize] = useState({ w: 1, h: 1 });

  const metricsRef = useRef<FontMetrics>(metrics);
  useEffect(() => {
    metricsRef.current = metrics;
  }, [metrics]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const imageCacheRef = useRef<Map<string, any>>(new Map());

  const [rubberBand, setRubberBandState] = useState<RubberBand | null>(null);
  const [mousePos, setMousePosState] = useState<{ x: number; y: number } | null>(null);
  const [pendingOffCurve, setPendingOffCurveState] = useState<{ x: number; y: number } | null>(
    null
  );
  const [hoveredPointId, setHoveredPointIdState] = useState<string | null>(null);
  const [hoveredSegmentId, setHoveredSegmentIdState] = useState<string | null>(null);
  const [dragPos, setDragPosState] = useState<{ x: number; y: number } | null>(null);
  const [connectPreview, setConnectPreviewState] = useState<{
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
  } | null>(null);

  const rubberBandRef = useRef<RubberBand | null>(null);
  const mousePosRef = useRef<{ x: number; y: number } | null>(null);
  const pendingOffCurveRef = useRef<{ x: number; y: number } | null>(null);
  const hoveredPointIdRef = useRef<string | null>(null);
  const hoveredSegmentIdRef = useRef<string | null>(null);
  const dragPosRef = useRef<{ x: number; y: number } | null>(null);
  const connectPreviewRef = useRef<{
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
  } | null>(null);

  const extraRef = useRef({
    rubberBand: rubberBandRef.current,
    mousePos: mousePosRef.current,
    pendingOffCurve: pendingOffCurveRef.current,
    canvasWidth: canvasSize.w,
    canvasHeight: canvasSize.h,
    hoveredPointId: hoveredPointIdRef.current,
    hoveredSegmentId: hoveredSegmentIdRef.current,
    dragPos: dragPosRef.current,
    connectPreview: connectPreviewRef.current,
  });

  // Keep extra ref up to date
  useEffect(() => {
    extraRef.current = {
      rubberBand: rubberBandRef.current,
      mousePos: mousePosRef.current,
      pendingOffCurve: pendingOffCurveRef.current,
      canvasWidth: canvasSize.w,
      canvasHeight: canvasSize.h,
      hoveredPointId: hoveredPointIdRef.current,
      hoveredSegmentId: hoveredSegmentIdRef.current,
      dragPos: dragPosRef.current,
      connectPreview: connectPreviewRef.current,
    };
  }, [
    rubberBand,
    mousePos,
    pendingOffCurve,
    canvasSize,
    hoveredPointId,
    hoveredSegmentId,
    dragPos,
    connectPreview,
  ]);

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
  const setHoveredPointId = (id: string | null) => {
    hoveredPointIdRef.current = id;
    extraRef.current = { ...extraRef.current, hoveredPointId: id };
    setHoveredPointIdState(id);
  };
  const setHoveredSegmentId = (id: string | null) => {
    hoveredSegmentIdRef.current = id;
    extraRef.current = { ...extraRef.current, hoveredSegmentId: id };
    setHoveredSegmentIdState(id);
  };
  const setDragPos = (pos: { x: number; y: number } | null) => {
    dragPosRef.current = pos;
    extraRef.current = { ...extraRef.current, dragPos: pos };
    setDragPosState(pos);
  };
  const setConnectPreview = (
    preview: { fromX: number; fromY: number; toX: number; toY: number } | null
  ) => {
    connectPreviewRef.current = preview;
    extraRef.current = { ...extraRef.current, connectPreview: preview };
    setConnectPreviewState(preview);
  };

  const { redraw, registerSurface } = useEditorRenderer(
    ck,
    surfaceRef,
    surfaceValidRef,
    stateRef,
    metricsRef,
    extraRef,
    imageCacheRef
  );

  // Decode image layers into CanvasKit SkImage objects (must be after redraw is defined)
  useEffect(() => {
    if (!ck) return;
    const imageLayers = layers.filter((l): l is ImageLayer => l.type === 'image');
    const activeIds = new Set(imageLayers.map((l) => l.id));
    for (const [id, img] of imageCacheRef.current) {
      if (!activeIds.has(id)) {
        img.delete();
        imageCacheRef.current.delete(id);
      }
    }
    for (const layer of imageLayers) {
      if (imageCacheRef.current.has(layer.id)) continue;
      fetch(layer.imageDataUrl)
        .then((r) => r.arrayBuffer())
        .then((ab) => {
          const skImg = ck.MakeImageFromEncoded(new Uint8Array(ab));
          if (skImg) {
            imageCacheRef.current.set(layer.id, skImg);
            redraw();
          }
        })
        .catch(() => {
          /* ignore decode errors */
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ck, layers]);

  // Create/destroy CanvasKit surface when ck or canvas size changes
  useEffect(() => {
    if (!ck || !canvasRef.current) return;

    // Set physical canvas size (matching CSS size)
    const canvas = canvasRef.current;
    canvas.width = canvasSize.w;
    canvas.height = canvasSize.h;
    extraRef.current = {
      ...extraRef.current,
      canvasWidth: canvasSize.w,
      canvasHeight: canvasSize.h,
    };

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
  }, [
    redraw,
    paths,
    selection,
    toolMode,
    viewTransform,
    rubberBand,
    mousePos,
    pendingOffCurve,
    showDirection,
    showCoordinates,
    dragPos,
    layers,
    showTransformBox,
    showPixelGrid,
  ]);

  // Observe container size and update canvas dimensions
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        const newW = Math.floor(width);
        const newH = Math.floor(height);
        setCanvasSize({ w: newW, h: newH });
        // Center the view when canvas resizes (only if metrics are available)
        if (metricsRef.current) {
          dispatch({
            type: 'CENTER_VIEW',
            canvasWidth: newW,
            canvasHeight: newH,
            metrics: metricsRef.current,
          });
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [dispatch]);

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

  const { onPointerDown, onPointerMove, onPointerUp, onWheel, onPointerLeave, getCursor } =
    useEditorInteraction({
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
    });

  const coordLabels = showCoordinates
    ? paths.flatMap((path) =>
        path.commands.flatMap((cmd) => {
          const labels: Array<{
            id: string;
            label: string;
            sx: number;
            sy: number;
            color: string;
          }> = [];
          const { originX, originY, scale } = viewTransform;

          const addLabel = (pt: { id: string; x: number; y: number }, color: string) => {
            const sx = originX + pt.x * scale;
            const sy = originY - pt.y * scale;
            labels.push({
              id: pt.id,
              label: `${Math.round(pt.x)}, ${Math.round(pt.y)}`,
              sx,
              sy,
              color,
            });
          };

          if (cmd.kind === 'M' || cmd.kind === 'L') {
            addLabel(cmd.point, 'rgb(30,30,30)');
          } else if (cmd.kind === 'Q') {
            addLabel(cmd.ctrl, 'rgb(65,105,225)');
            addLabel(cmd.point, 'rgb(30,30,30)');
          } else if (cmd.kind === 'C') {
            addLabel(cmd.ctrl1, 'rgb(65,105,225)');
            addLabel(cmd.ctrl2, 'rgb(65,105,225)');
            addLabel(cmd.point, 'rgb(30,30,30)');
          }
          return labels;
        })
      )
    : [];

  // Metric line labels (HTML overlay, since CanvasKit has no bundled fonts)
  const metricLabels = (() => {
    const labels: Array<{
      key: string;
      label: string;
      sx?: number;
      sy?: number;
      isVertical: boolean;
      color: string;
    }> = [];
    const { originX, originY, scale } = viewTransform;
    const advanceX = originX + metrics.advanceWidth * scale;
    const addH = (fontY: number, label: string, color: string) => {
      const sy = originY - fontY * scale;
      if (sy < -10 || sy > canvasSize.h + 10) return;
      labels.push({ key: label, label, sx: advanceX, sy, isVertical: false, color });
    };

    addH(0, 'Baseline', 'rgb(150,150,150)');
    addH(metrics.ascender, 'Ascender', 'rgb(120,120,120)');
    addH(metrics.descender, 'Descender', 'rgb(120,120,120)');
    if (metrics.xHeight) addH(metrics.xHeight, 'x-height', 'rgb(120,120,120)');
    if (metrics.capHeight) addH(metrics.capHeight, 'Cap height', 'rgb(120,120,120)');

    return labels;
  })();

  return (
    <div ref={containerRef} className="relative min-h-0 w-full flex-1 overflow-hidden bg-white">
      <canvas
        ref={canvasRef}
        style={{
          width: canvasSize.w,
          height: canvasSize.h,
          cursor:
            toolMode === 'pen'
              ? 'crosshair'
              : toolMode === 'hand'
                ? 'grab'
                : toolMode === 'node'
                  ? getCursor()
                  : 'default',
          display: 'block',
        }}
        onPointerDown={(e) => onPointerDown(e.nativeEvent)}
        onPointerMove={(e) => onPointerMove(e.nativeEvent)}
        onPointerUp={(e) => onPointerUp(e.nativeEvent)}
        onPointerLeave={onPointerLeave}
        onWheel={(e) => onWheel(e.nativeEvent)}
      />
      {/* Metric line labels */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {metricLabels.map(({ key, label, sx, sy, isVertical, color }) => (
          <span
            key={key}
            className="absolute font-mono text-[10px] whitespace-nowrap"
            style={
              isVertical
                ? { left: (sx ?? 0) + 4, top: (sy ?? 4) - 14, color }
                : { left: (sx ?? 0) + 4, top: (sy ?? 0) - 14, color }
            }
          >
            {label}
          </span>
        ))}
      </div>
      {coordLabels.length > 0 && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {coordLabels.map(({ id, label, sx, sy, color }) => (
            <span
              key={id}
              className="absolute rounded bg-white/80 px-1 py-0.5 font-mono text-xs whitespace-nowrap shadow-sm"
              style={{ left: sx + 10, top: sy - 8, color }}
            >
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
