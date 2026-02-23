import type { GlyphEditorTabState } from './editorTypes';

type OpenEditorHandler = (state: GlyphEditorTabState) => void;
type GlyphSavedHandler = (data: { filePath: string; glyphId: number; svgPath: string }) => void;

let _handler: OpenEditorHandler | null = null;
let _glyphSavedHandler: GlyphSavedHandler | null = null;

export const editorEventBus = {
  setHandler(fn: OpenEditorHandler): void {
    _handler = fn;
  },
  clearHandler(): void {
    _handler = null;
  },
  emit(state: GlyphEditorTabState): void {
    _handler?.(state);
  },
  setGlyphSavedHandler(fn: GlyphSavedHandler): void {
    _glyphSavedHandler = fn;
  },
  clearGlyphSavedHandler(): void {
    _glyphSavedHandler = null;
  },
  emitGlyphSaved(data: { filePath: string; glyphId: number; svgPath: string }): void {
    _glyphSavedHandler?.(data);
  },
};
