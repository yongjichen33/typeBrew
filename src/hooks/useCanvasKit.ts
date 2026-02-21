import { useState, useEffect } from 'react';

// Vite resolves the .wasm file as a URL (static asset) because of assetsInclude: ['**/*.wasm']
// @ts-ignore — TS can't type-check ?url imports, but Vite handles them correctly
import canvasKitWasmUrl from 'canvaskit-wasm/bin/canvaskit.wasm?url';

// Static import lets Vite/esbuild pre-bundle and convert the CJS module.exports to an ESM default.
// @ts-ignore — no types shipped for default import
import CanvasKitInit from 'canvaskit-wasm';

// Module-level promise — loads WASM only once regardless of how many editor tabs are open.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ckPromise: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useCanvasKit(): any | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [ck, setCk] = useState<any | null>(null);

  useEffect(() => {
    if (!ckPromise) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ckPromise = (CanvasKitInit as (opts: { locateFile: () => string }) => Promise<any>)({
        locateFile: () => canvasKitWasmUrl,
      }).catch((err: unknown) => {
        console.error('Failed to load CanvasKit:', err);
        ckPromise = null;
        return null;
      });
    }
    ckPromise.then(setCk);
  }, []);

  return ck;
}
