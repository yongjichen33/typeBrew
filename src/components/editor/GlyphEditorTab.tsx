import { useEffect, useRef, useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useCanvasKit } from '@/hooks/useCanvasKit';
import { useGlyphEditor } from '@/hooks/useGlyphEditor';
import { parseSvgPath, editablePathToSvg } from '@/lib/svgPathParser';
import { EditorToolbar } from './EditorToolbar';
import { GlyphEditorCanvas } from './GlyphEditorCanvas';
import type { GlyphEditorTabState, FontMetrics, ViewTransform } from '@/lib/editorTypes';

/** Compute an initial view transform that fits the glyph in the canvas. */
function computeInitialVt(metrics: FontMetrics, canvasW: number, canvasH: number): ViewTransform {
  const glyphH = (metrics.yMax - metrics.yMin) || metrics.unitsPerEm;
  const glyphW = (metrics.xMax - metrics.xMin) || metrics.advanceWidth || metrics.unitsPerEm;
  if (glyphW === 0 || glyphH === 0) {
    return { scale: 1, originX: canvasW / 2, originY: canvasH / 2 };
  }
  const padding = 0.15;
  const scale = Math.min(
    (canvasW * (1 - 2 * padding)) / glyphW,
    (canvasH * (1 - 2 * padding)) / glyphH,
  );
  // Center the glyph
  const centerFontX = (metrics.xMin + metrics.xMax) / 2;
  const centerFontY = (metrics.yMin + metrics.yMax) / 2;
  return {
    scale,
    originX: canvasW / 2 - centerFontX * scale,
    originY: canvasH / 2 + centerFontY * scale,
  };
}

interface Props {
  tabState: GlyphEditorTabState;
}

export function GlyphEditorTab({ tabState }: Props) {
  const { filePath, tableName, glyphId, glyphName, svgPath, advanceWidth, boundsXMin, boundsYMin, boundsXMax, boundsYMax, unitsPerEm } = tabState;

  const ck = useCanvasKit();

  // Initial metrics from glyph data; ascender/descender fetched from hhea
  const [metrics, setMetrics] = useState<FontMetrics | null>(null);

  const defaultVt: ViewTransform = { scale: 0.3, originX: 100, originY: 400 };
  const [state, dispatch] = useGlyphEditor(defaultVt);

  // Keep a stable ref for interaction hooks
  const stateRef = useRef({
    paths: state.paths,
    selection: state.selection,
    toolMode: state.toolMode,
    viewTransform: state.viewTransform,
  });
  useEffect(() => {
    stateRef.current = {
      paths: state.paths,
      selection: state.selection,
      toolMode: state.toolMode,
      viewTransform: state.viewTransform,
    };
  }, [state]);

  // Load glyph data and font metrics on mount
  useEffect(() => {
    // Parse the SVG path into editable points
    const paths = parseSvgPath(svgPath);
    dispatch({ type: 'SET_PATHS', paths });

    // Fetch hhea for ascender/descender
    invoke<string>('get_font_table', { filePath, tableName: 'hhea' })
      .then((json) => {
        const hhea = JSON.parse(json);
        const m: FontMetrics = {
          unitsPerEm,
          ascender: Number(hhea.ascender ?? 800),
          descender: Number(hhea.descender ?? -200),
          advanceWidth,
          xMin: boundsXMin,
          yMin: boundsYMin,
          xMax: boundsXMax,
          yMax: boundsYMax,
        };
        setMetrics(m);
      })
      .catch(() => {
        // Fallback: estimate from unitsPerEm
        const m: FontMetrics = {
          unitsPerEm,
          ascender: Math.round(unitsPerEm * 0.8),
          descender: -Math.round(unitsPerEm * 0.2),
          advanceWidth,
          xMin: boundsXMin,
          yMin: boundsYMin,
          xMax: boundsXMax,
          yMax: boundsYMax,
        };
        setMetrics(m);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, svgPath]);

  // Once we have metrics and ck, compute initial view transform
  const [vtInitialized, setVtInitialized] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!metrics || vtInitialized || !containerRef.current) return;
    const { offsetWidth: w, offsetHeight: h } = containerRef.current;
    if (w > 0 && h > 0) {
      const vt = computeInitialVt(metrics, w, h);
      dispatch({ type: 'SET_VIEW_TRANSFORM', vt });
      setVtInitialized(true);
    }
  }, [metrics, vtInitialized, dispatch]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'v' || e.key === 'V') dispatch({ type: 'SET_TOOL_MODE', mode: 'select' });
    if (e.key === 'p' || e.key === 'P') dispatch({ type: 'SET_TOOL_MODE', mode: 'draw' });
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
      e.preventDefault();
      dispatch({ type: 'UNDO' });
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') {
      e.preventDefault();
      dispatch({ type: 'REDO' });
    }
  }, [dispatch]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Save handler
  const handleSave = useCallback(async () => {
    dispatch({ type: 'SET_SAVING', saving: true });
    try {
      const svgPathOut = editablePathToSvg(state.paths);
      await invoke('save_glyph_outline', {
        filePath,
        glyphId,
        svgPath: svgPathOut,
        tableName,
      });
      dispatch({ type: 'MARK_SAVED' });
      toast.success('Glyph saved');
    } catch (error) {
      dispatch({ type: 'SET_SAVING', saving: false });
      toast.error(`Failed to save glyph: ${error}`);
    }
  }, [state.paths, filePath, glyphId, tableName, dispatch]);

  // Format tab breadcrumb
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
  const glyphLabel = glyphName
    ? `#${glyphId} (${glyphName})`
    : `#${glyphId}`;

  return (
    <div className="h-full flex flex-col">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 px-4 py-2 border-b text-sm text-muted-foreground font-mono shrink-0">
        <span>{fileName}</span>
        <span className="text-border">/</span>
        <span>{tableName}</span>
        <span className="text-border">/</span>
        <span className="text-foreground font-medium">{glyphLabel}</span>
        {state.isDirty && <span className="ml-1 text-xs text-orange-500">•</span>}
      </div>

      {/* Toolbar */}
      <EditorToolbar
        toolMode={state.toolMode}
        onSetMode={(mode) => dispatch({ type: 'SET_TOOL_MODE', mode })}
        canUndo={state.undoStack.length > 0}
        canRedo={state.redoStack.length > 0}
        onUndo={() => dispatch({ type: 'UNDO' })}
        onRedo={() => dispatch({ type: 'REDO' })}
        isDirty={state.isDirty}
        isSaving={state.isSaving}
        onSave={handleSave}
      />

      {/* Canvas area */}
      <div ref={containerRef} className="flex-1 min-h-0 flex">
        {!ck || !metrics ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading editor…</span>
          </div>
        ) : (
          <GlyphEditorCanvas
            ck={ck}
            paths={state.paths}
            selection={state.selection}
            toolMode={state.toolMode}
            viewTransform={state.viewTransform}
            metrics={metrics}
            dispatch={dispatch as (action: unknown) => void}
            stateRef={stateRef}
          />
        )}
      </div>
    </div>
  );
}
