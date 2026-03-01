import { useState, useEffect } from 'react';

// Vite resolves the .wasm file as a URL (static asset) because of assetsInclude: ['**/*.wasm']
import canvasKitWasmUrl from 'canvaskit-wasm/bin/canvaskit.wasm?url';

// Static import lets Vite/esbuild pre-bundle and convert the CJS module.exports to an ESM default.
import CanvasKitInit from 'canvaskit-wasm';

// Module-level promise — loads WASM only once regardless of how many editor tabs are open.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ckPromise: Promise<any> | null = null;
// Prevents infinite retry loops if WASM init permanently fails.
let ckFailed = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useCanvasKit(): any | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [ck, setCk] = useState<any | null>(null);

  useEffect(() => {
    if (ckFailed) return;
    if (!ckPromise) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ckPromise = (CanvasKitInit as (opts: { locateFile: () => string }) => Promise<any>)({
        locateFile: () => canvasKitWasmUrl,
      }).catch((err: unknown) => {
        console.error('Failed to load CanvasKit:', err);
        ckFailed = true;
        ckPromise = null;
        return null;
      });
    }
    ckPromise.then(setCk);
  }, []);

  return ck;
}
