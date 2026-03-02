import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import type { FontMetrics } from '@/lib/editorTypes';

/**
 * SVG → Canvas. SVG always renders as smooth anti-aliased vectors no matter how you zoom it. A <canvas>  
  rasterizes the path at exactly ppem × ppem pixels, giving true pixel-snapped output that matches what a
   renderer would produce.                                                                               
                                                                                                         
  How it works:
  1. Canvas is sized to ceil(vbW) × ceil(vbH) — the glyph's actual pixel footprint at that ppem (e.g. 4×8
   at 8ppem, 24×48 at 48ppem)
  2. ctx.translate(-vbX, -vbY) maps the path's viewBox coordinates into canvas pixel space
  3. ctx.fill(new Path2D(path)) rasterizes the hinted outline — since skrifa's hinting engine snaps
  control points to the pixel grid, this produces the characteristic staircase/jagged edges
  4. The canvas is displayed at cw × ZOOM_LEVEL CSS pixels with imageRendering: pixelated — each hinted
  pixel becomes a ZOOM_LEVEL-sized block

  Adjust ZOOM_LEVEL to change how large each pixel block appears.
 */

const PX_SIZES = [8, 12, 16, 24, 32, 48];
/** How many CSS pixels each rasterized pixel occupies — increase to zoom in further. */
const ZOOM_LEVEL = 4;

interface Props {
  filePath: string;
  glyphId: number;
  metrics: FontMetrics;
}

interface CellProps {
  ppem: number;
  path: string;
  vbX: number;
  vbY: number;
  vbW: number;
  vbH: number;
}

/** Rasterizes a single hinted glyph onto a canvas at its natural ppem pixel size,
 *  then displays it scaled up so individual hinted pixels are clearly visible. */
function HintingCell({ ppem, path, vbX, vbY, vbW, vbH }: CellProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Canvas dimensions in actual pixels at ppem size
  const cw = Math.max(1, Math.ceil(vbW));
  const ch = Math.max(1, Math.ceil(vbH));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // White background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, cw, ch);

    if (path) {
      ctx.save();
      // Shift the path from viewBox space into canvas pixel space
      ctx.translate(-vbX, -vbY);
      ctx.fillStyle = 'black';
      ctx.fill(new Path2D(path));
      ctx.restore();
    }
  }, [path, vbX, vbY, cw, ch]);

  return (
    <div className="flex flex-col items-center gap-1">
      <canvas
        ref={canvasRef}
        width={cw}
        height={ch}
        style={{
          // Scale up so each hinted pixel is ZOOM_LEVEL CSS pixels wide
          width: cw * ZOOM_LEVEL,
          height: ch * ZOOM_LEVEL,
          imageRendering: 'pixelated',
          border: '1px solid #e5e7eb',
        }}
      />
      <span className="text-muted-foreground text-[9px]">{ppem}px</span>
    </div>
  );
}

export function HintingPreviewPanel({ filePath, glyphId, metrics }: Props) {
  const [svgPaths, setSvgPaths] = useState<string[]>([]);

  useEffect(() => {
    invoke<string[]>('get_hinted_glyph_outlines', { filePath, glyphId, pxSizes: PX_SIZES })
      .then(setSvgPaths)
      .catch(() => setSvgPaths([]));
  }, [filePath, glyphId]);

  const upm = metrics.unitsPerEm || 1000;
  const fH = metrics.ascender - metrics.descender;

  return (
    <div className="flex w-48 shrink-0 flex-col gap-4 overflow-y-auto border-l p-3 md:w-56 lg:w-64">
      <p className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
        Hinting
      </p>
      {PX_SIZES.map((ppem, i) => {
        const scale = ppem / upm;
        const vbX = metrics.xMin * scale;
        const vbY = -metrics.ascender * scale;
        const vbW = (metrics.xMax - metrics.xMin) * scale || ppem;
        const vbH = fH * scale || ppem;

        return (
          <HintingCell
            key={ppem}
            ppem={ppem}
            path={svgPaths[i] ?? ''}
            vbX={vbX}
            vbY={vbY}
            vbW={vbW}
            vbH={vbH}
          />
        );
      })}
    </div>
  );
}
