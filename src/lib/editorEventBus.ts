import type { GlyphEditorTabState } from './editorTypes';

type OpenEditorHandler = (state: GlyphEditorTabState) => void;

/**
 * Module-level event bus that bridges the Golden Layout component isolation
 * boundary. GlyphGrid (inside a GL tab) can call `emit` to open a new
 * editor tab, which is handled by FontViewer via `setHandler`.
 */
let _handler: OpenEditorHandler | null = null;

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
};
