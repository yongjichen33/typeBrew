import { createContext, useContext } from 'react';
import type { GlyphEditorContextValue } from '@/lib/editorTypes';

export const GlyphEditorContext = createContext<GlyphEditorContextValue>({
  openGlyphEditor: () => {},
});

export function useGlyphEditorContext(): GlyphEditorContextValue {
  return useContext(GlyphEditorContext);
}
