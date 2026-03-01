import { useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useCanvasKit } from '@/hooks/useCanvasKit';
import { useGlyphEditor, computeClipboardData } from '@/hooks/useGlyphEditor';
import {
  getClipboard,
  setClipboard,
  setFocusedGlyphId,
  useFocusedGlyphId,
} from '@/lib/glyphClipboard';
import {
  editablePathToSvg,
  outlineDataToEditablePaths,
  buildComponentInfoTree,
  flattenComponentOffsets,
  getComponentAtPath,
} from '@/lib/svgPathParser';
import { editorEventBus } from '@/lib/editorEventBus';
import { EditorToolbar } from './EditorToolbar';
import { GlyphEditorCanvas } from './GlyphEditorCanvas';
import { InspectorPanel } from './InspectorPanel';
import { GlyphPreview } from './GlyphPreview';
import type { GlyphEditorTabState, FontMetrics, ViewTransform } from '@/lib/editorTypes';

export interface TransformFeedback {
  isActive: boolean;
  deltaX: number;
  deltaY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

/** Compute an initial view transform that fits the glyph in the canvas. */
function computeInitialVt(metrics: FontMetrics, canvasW: number, canvasH: number): ViewTransform {
  const glyphH = metrics.yMax - metrics.yMin || metrics.unitsPerEm;
  const glyphW = metrics.xMax - metrics.xMin || metrics.advanceWidth || metrics.unitsPerEm;
  if (glyphW === 0 || glyphH === 0) {
    return { scale: 1, originX: canvasW / 2, originY: canvasH / 2 };
  }
  const padding = 0.15;
  const scale = Math.min(
    (canvasW * (1 - 2 * padding)) / glyphW,
    (canvasH * (1 - 2 * padding)) / glyphH
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

// Module-level constant — avoids allocating a new object on every render.
const DEFAULT_VT: ViewTransform = { scale: 0.3, originX: 100, originY: 400 };

interface Props {
  tabState: GlyphEditorTabState;
}

export function GlyphEditorTab({ tabState }: Props) {
  const {
    filePath,
    tableName,
    glyphId,
    glyphName,
    outlineData,
    advanceWidth,
    boundsXMin,
    boundsYMin,
    boundsXMax,
    boundsYMax,
    unitsPerEm,
  } = tabState;

  const ck = useCanvasKit();

  // Initial metrics from glyph data; ascender/descender fetched from hhea
  const [metrics, setMetrics] = useState<FontMetrics | null>(null);

  const [state, dispatch] = useGlyphEditor(DEFAULT_VT);

  // Keep a stable ref for interaction hooks
  const stateRef = useRef({
    paths: state.paths,
    selection: state.selection,
    toolMode: state.toolMode,
    viewTransform: state.viewTransform,
    showDirection: state.showDirection,
    showCoordinates: state.showCoordinates,
    activePathId: state.activePathId,
    isDrawingPath: state.isDrawingPath,
    layers: state.layers,
    activeLayerId: state.activeLayerId,
    focusedLayerId: state.focusedLayerId,
    showTransformBox: state.showTransformBox,
    showPixelGrid: state.showPixelGrid,
    showPreview: state.showPreview,
    previewInverted: state.previewInverted,
    previewHeight: state.previewHeight,
    isComposite: state.isComposite,
    components: state.components,
    activeComponentPath: state.activeComponentPath,
    isDirty: state.isDirty,
    isSaving: state.isSaving,
  });
  // useLayoutEffect fires before paint so RAF callbacks always read fresh state
  useLayoutEffect(() => {
    stateRef.current = {
      paths: state.paths,
      selection: state.selection,
      toolMode: state.toolMode,
      viewTransform: state.viewTransform,
      showDirection: state.showDirection,
      showCoordinates: state.showCoordinates,
      activePathId: state.activePathId,
      isDrawingPath: state.isDrawingPath,
      layers: state.layers,
      activeLayerId: state.activeLayerId,
      focusedLayerId: state.focusedLayerId,
      showTransformBox: state.showTransformBox,
      showPixelGrid: state.showPixelGrid,
      showPreview: state.showPreview,
      previewInverted: state.previewInverted,
      previewHeight: state.previewHeight,
      isComposite: state.isComposite,
      components: state.components,
      activeComponentPath: state.activeComponentPath,
      isDirty: state.isDirty,
      isSaving: state.isSaving,
    };
  }, [state]);

  // Drag state for preview-height resize divider
  const [previewDrag, setPreviewDrag] = useState<{
    startY: number;
    startHeight: number;
    maxHeight: number;
  } | null>(null);

  useEffect(() => {
    if (!previewDrag) return;
    const { startY, startHeight, maxHeight } = previewDrag;
    const minHeight = 60;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = startY - e.clientY;
      const newHeight = Math.min(maxHeight, Math.max(minHeight, startHeight + deltaY));
      dispatch({ type: 'SET_PREVIEW_HEIGHT', previewHeight: newHeight });
    };

    const handleMouseUp = () => setPreviewDrag(null);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [previewDrag, dispatch]);

  const [transformFeedback, setTransformFeedback] = useState<TransformFeedback>({
    isActive: false,
    deltaX: 0,
    deltaY: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  });

  // Load glyph data and font metrics on mount
  useEffect(() => {
    if (!outlineData) return;

    // Composite glyphs have no contours of their own; components carry the paths
    const paths = outlineData.is_composite ? [] : outlineDataToEditablePaths(outlineData);
    const components = buildComponentInfoTree(outlineData.components ?? []);
    dispatch({
      type: 'SET_PATHS',
      paths,
      isComposite: outlineData.is_composite,
      components,
    });

    // Fetch hhea for ascender/descender and OS/2 for xHeight/capHeight
    Promise.all([
      invoke<string>('get_font_table', { filePath, tableName: 'hhea' }),
      invoke<string>('get_font_table', { filePath, tableName: 'OS/2' }).catch(() => null),
    ])
      .then(([hheaJson, os2Json]) => {
        const hhea = JSON.parse(hheaJson);
        let xHeight = 0;
        let capHeight = 0;
        if (os2Json) {
          const os2 = JSON.parse(os2Json);
          xHeight = Number(os2.sx_height ?? 0);
          capHeight = Number(os2.s_cap_height ?? 0);
        }
        const m: FontMetrics = {
          unitsPerEm,
          ascender: Number(hhea.ascender ?? 800),
          descender: Number(hhea.descender ?? -200),
          xHeight,
          capHeight,
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
          xHeight: Math.round(unitsPerEm * 0.5),
          capHeight: Math.round(unitsPerEm * 0.7),
          advanceWidth,
          xMin: boundsXMin,
          yMin: boundsYMin,
          xMax: boundsXMax,
          yMax: boundsYMax,
        };
        setMetrics(m);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, outlineData]);

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

  const focusedId = useFocusedGlyphId();
  const isFocused = focusedId === glyphId;

  // Save handler
  const handleSave = useCallback(async () => {
    if (state.isSaving) return;
    dispatch({ type: 'SET_SAVING', saving: true });
    try {
      if (state.isComposite) {
        // For composite glyphs: save active component outline + update offsets
        const activeComp = getComponentAtPath(state.components, state.activeComponentPath);
        if (activeComp && !activeComp.isComposite && !activeComp.locked && state.paths.length > 0) {
          const svgPathOut = editablePathToSvg(state.paths);
          await invoke('save_glyph_outline', {
            filePath,
            glyphId: activeComp.glyphId,
            svgPath: svgPathOut,
            tableName,
          });
          editorEventBus.emitGlyphSaved({
            filePath,
            glyphId: activeComp.glyphId,
            svgPath: svgPathOut,
          });
        }
        // Always save composite offsets
        await invoke('update_composite_offsets', {
          filePath,
          compositeGlyphId: glyphId,
          components: flattenComponentOffsets(state.components),
        });
        dispatch({ type: 'MARK_SAVED' });
        toast.success('Composite glyph saved');
      } else {
        const svgPathOut = editablePathToSvg(state.paths);
        await invoke('save_glyph_outline', {
          filePath,
          glyphId,
          svgPath: svgPathOut,
          tableName,
        });
        dispatch({ type: 'MARK_SAVED' });
        editorEventBus.emitGlyphSaved({ filePath, glyphId, svgPath: svgPathOut });
        toast.success('Glyph saved');
      }
    } catch (error) {
      dispatch({ type: 'SET_SAVING', saving: false });
      toast.error(`Failed to save glyph: ${error}`);
    }
  }, [
    state.paths,
    state.isSaving,
    state.isComposite,
    state.components,
    state.activeComponentPath,
    filePath,
    glyphId,
    tableName,
    dispatch,
  ]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isFocused) return;

      const activeEl = document.activeElement;
      const isInputFocused =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl?.getAttribute('contenteditable') === 'true';

      if (isInputFocused) {
        return;
      }

      // Read all state through stateRef to avoid stale closure captures
      const s = stateRef.current;

      // Ctrl/Cmd + S to save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (s.isDirty && !s.isSaving) {
          handleSave();
        }
        return;
      }

      if (e.key === 's' || e.key === 'S') dispatch({ type: 'SET_TOOL_MODE', mode: 'node' });
      if (e.key === 'p' || e.key === 'P') dispatch({ type: 'SET_TOOL_MODE', mode: 'pen' });
      if (e.key === 'h' || e.key === 'H') dispatch({ type: 'SET_TOOL_MODE', mode: 'hand' });
      if (e.key === 'k' || e.key === 'K') dispatch({ type: 'SET_TOOL_MODE', mode: 'knife' });
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        dispatch({ type: 'UNDO' });
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') {
        e.preventDefault();
        dispatch({ type: 'REDO' });
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        const clipboardData = computeClipboardData(s.paths, s.selection);
        setClipboard(clipboardData);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        const clipboardData = getClipboard();
        dispatch({ type: 'PASTE_CLIPBOARD', clipboard: clipboardData });
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        dispatch({ type: 'DELETE_SELECTED_POINTS' });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // stateRef is a stable ref — state values are read inside the handler via stateRef.current
  }, [dispatch, isFocused, handleSave]);

  // Format tab breadcrumb
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
  const glyphLabel = glyphName ? `#${glyphId} (${glyphName})` : `#${glyphId}`;

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumb */}
      <div className="text-muted-foreground flex shrink-0 items-center gap-1.5 border-b px-4 py-2 font-mono text-sm">
        <span>{fileName}</span>
        <span className="text-border">/</span>
        <span>{tableName}</span>
        <span className="text-border">/</span>
        <span className="text-foreground font-medium">{glyphLabel}</span>
        {state.isDirty && <span className="ml-1 text-xs text-orange-500">•</span>}
      </div>

      {/* Toolbar */}
      {(() => {
        const activeComp = getComponentAtPath(state.components, state.activeComponentPath);
        const isLockedMode =
          state.isComposite && state.activeComponentPath.length > 0 && (activeComp?.locked ?? true);
        return (
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
            showDirection={state.showDirection}
            onSetShowDirection={(showDirection) =>
              dispatch({ type: 'SET_SHOW_DIRECTION', showDirection })
            }
            showCoordinates={state.showCoordinates}
            onSetShowCoordinates={(showCoordinates) =>
              dispatch({ type: 'SET_SHOW_COORDINATES', showCoordinates })
            }
            showPixelGrid={state.showPixelGrid}
            onSetShowPixelGrid={(showPixelGrid) =>
              dispatch({ type: 'SET_SHOW_PIXEL_GRID', showPixelGrid })
            }
            showPreview={state.showPreview}
            onSetShowPreview={(showPreview) => dispatch({ type: 'SET_SHOW_PREVIEW', showPreview })}
            previewInverted={state.previewInverted}
            onSetPreviewInverted={(previewInverted) =>
              dispatch({ type: 'SET_PREVIEW_INVERTED', previewInverted })
            }
            isLockedMode={isLockedMode}
          />
        );
      })()}

      {/* Canvas area with Inspector */}
      <div
        ref={containerRef}
        onMouseDown={() => setFocusedGlyphId(glyphId)}
        className="flex min-h-0 flex-1"
      >
        {!ck || !metrics ? (
          <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading editor…</span>
          </div>
        ) : (
          <>
            <div className="flex min-h-0 flex-1 flex-col">
              <GlyphEditorCanvas
                ck={ck}
                paths={state.paths}
                selection={state.selection}
                toolMode={state.toolMode}
                viewTransform={state.viewTransform}
                metrics={metrics}
                showDirection={state.showDirection}
                showCoordinates={state.showCoordinates}
                layers={state.layers}
                activeLayerId={state.activeLayerId}
                showTransformBox={state.showTransformBox}
                showPixelGrid={state.showPixelGrid}
                dispatch={dispatch as (action: unknown) => void}
                stateRef={stateRef}
                onTransformFeedback={setTransformFeedback}
              />
              {state.showPreview && (
                <>
                  <div
                    className="bg-border hover:bg-primary/50 h-1 shrink-0 cursor-ns-resize transition-colors"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      const containerHeight = containerRef.current?.offsetHeight ?? 400;
                      setPreviewDrag({
                        startY: e.clientY,
                        startHeight: stateRef.current.previewHeight,
                        maxHeight: containerHeight * 0.5,
                      });
                    }}
                  />
                  <GlyphPreview
                    ck={ck}
                    paths={state.paths}
                    metrics={metrics}
                    inverted={state.previewInverted}
                    height={state.previewHeight}
                  />
                </>
              )}
            </div>
            <InspectorPanel
              selection={state.selection}
              paths={state.paths}
              dispatch={dispatch as (action: unknown) => void}
              transformFeedback={transformFeedback}
              layers={state.layers}
              activeLayerId={state.activeLayerId}
              focusedLayerId={state.focusedLayerId}
              isComposite={state.isComposite}
              components={state.components}
              activeComponentPath={state.activeComponentPath}
            />
          </>
        )}
      </div>
    </div>
  );
}
