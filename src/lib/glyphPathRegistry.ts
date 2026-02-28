import type { EditablePath } from './editorTypes';

// Keyed by `${filePath}::${glyphId}`
const _paths = new Map<string, EditablePath[]>();
const _redrawListeners = new Set<() => void>();
/** Keys that at least one composite editor is currently watching. */
const _watched = new Set<string>();

export const glyphPathRegistry = {
  /**
   * Called by composite editors on mount to declare which component glyphs
   * they need. Returns a cleanup function that removes the watch and frees
   * the stored paths.
   */
  watch(filePath: string, glyphIds: number[]): () => void {
    const keys = glyphIds.map((id) => `${filePath}::${id}`);
    keys.forEach((k) => _watched.add(k));
    return () => {
      keys.forEach((k) => {
        _watched.delete(k);
        _paths.delete(k);
      });
    };
  },
  /**
   * Called by every glyph editor on every layout effect.
   * Skips the write (O(1) Set.has check) if no composite is watching this glyph.
   */
  update(filePath: string, glyphId: number, paths: EditablePath[]): void {
    const key = `${filePath}::${glyphId}`;
    if (!_watched.has(key)) return;
    _paths.set(key, paths);
    _redrawListeners.forEach((fn) => fn());
  },
  get(filePath: string, glyphId: number): EditablePath[] {
    return _paths.get(`${filePath}::${glyphId}`) ?? [];
  },
  /** Returns unsubscribe function — used in useEffect cleanup. */
  addRedrawListener(fn: () => void): () => void {
    _redrawListeners.add(fn);
    return () => _redrawListeners.delete(fn);
  },
};
