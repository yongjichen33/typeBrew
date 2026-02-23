import React from 'react';
import type { ClipboardData } from './editorTypes';

let globalClipboard: ClipboardData = { points: [], segments: [] };
const clipboardListeners = new Set<() => void>();

let focusedGlyphId: number | null = null;
const focusListeners = new Set<(id: number | null) => void>();

export function getClipboard(): ClipboardData {
  return globalClipboard;
}

export function setClipboard(data: ClipboardData): void {
  globalClipboard = {
    points: data.points.map(p => ({ ...p })),
    segments: data.segments.map(s => ({
      pathId: s.pathId,
      kind: s.kind,
      startPoint: { ...s.startPoint },
      endPoint: { ...s.endPoint },
      ...(s.ctrl1 && { ctrl1: { ...s.ctrl1 } }),
      ...(s.ctrl2 && { ctrl2: { ...s.ctrl2 } }),
    })),
  };
  clipboardListeners.forEach(fn => fn());
}

export function subscribe(fn: () => void): () => void {
  clipboardListeners.add(fn);
  return () => clipboardListeners.delete(fn);
}

export function useGlyphClipboard(): ClipboardData {
  const [clipboard, setClipboardState] = React.useState(getClipboard);
  
  React.useEffect(() => {
    return subscribe(() => setClipboardState(getClipboard()));
  }, []);
  
  return clipboard;
}

export function getFocusedGlyphId(): number | null {
  return focusedGlyphId;
}

export function setFocusedGlyphId(id: number): void {
  focusedGlyphId = id;
  focusListeners.forEach(fn => fn(id));
}

export function subscribeFocus(fn: (id: number | null) => void): () => void {
  focusListeners.add(fn);
  return () => focusListeners.delete(fn);
}

export function useFocusedGlyphId(): number | null {
  const [id, setId] = React.useState(getFocusedGlyphId);
  
  React.useEffect(() => {
    return subscribeFocus(setId);
  }, []);
  
  return id;
}
