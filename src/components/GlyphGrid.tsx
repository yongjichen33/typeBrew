import { useState, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { readFile } from '@tauri-apps/plugin-fs';

interface GlyphBounds {
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
}

interface Glyph {
  glyph_id: number;
  glyph_name?: string;
  svg_path: string;
  advance_width: number;
  bounds?: GlyphBounds;
}

interface GlyphGridProps {
  glyphs: Glyph[];
  numGlyphs: number;
  unitsPerEm: number;
  filePath: string | null;
}

// Convert "U+XXXX" unicode string to its character, e.g. "U+0100" → "Ā" (decimal 256)
function glyphNameToChar(name: string): string | null {
  if (!name) return null;

  const match = name.match(/^U\+([0-9A-Fa-f]{4,6})$/);
  if (!match) return null;

  const code = parseInt(match[1], 16);
  if (code === 0) return null;

  return String.fromCodePoint(code);
}

function GlyphCell({ glyph, unitsPerEm, fontFamily }: { glyph: Glyph; unitsPerEm: number; fontFamily: string | null }) {
  const char = glyph.glyph_name ? glyphNameToChar(glyph.glyph_name) : null;

  return (
    <div className="flex flex-col items-center p-3 border rounded-lg hover:bg-muted/50 transition-colors">
      {char && fontFamily ? (
        <div
          className="w-full h-20 mb-2 flex items-center justify-center text-4xl leading-none"
          style={{ fontFamily: `'${fontFamily}'` }}
        >
          {char}
        </div>
      ) : (
        <svg
          viewBox={
            glyph.bounds
              ? `${glyph.bounds.x_min - 50} ${-glyph.bounds.y_max - 50} ${glyph.bounds.x_max - glyph.bounds.x_min + 100} ${glyph.bounds.y_max - glyph.bounds.y_min + 100}`
              : `0 ${-unitsPerEm} ${unitsPerEm} ${unitsPerEm}`
          }
          className="w-full h-20 mb-2"
        >
          <path d={glyph.svg_path} fill="currentColor" className="text-foreground" />
        </svg>
      )}
      <div className="text-center">
        <div className="text-xs font-mono text-muted-foreground">
          #{glyph.glyph_id}
        </div>
        {glyph.glyph_name && (
          <div className="text-xs text-muted-foreground mt-1">
            {glyph.glyph_name}
          </div>
        )}
      </div>
    </div>
  );
}

// Cache of loaded font-face families keyed by file path
const loadedFonts = new Map<string, string>();

function getFamilyName(filePath: string): string {
  // Deterministic name derived from the file path
  let hash = 0;
  for (let i = 0; i < filePath.length; i++) {
    hash = ((hash << 5) - hash + filePath.charCodeAt(i)) | 0;
  }
  return `glyph-preview-${(hash >>> 0).toString(36)}`;
}

export function GlyphGrid({ glyphs, numGlyphs, unitsPerEm, filePath }: GlyphGridProps) {
  const [fontFamily, setFontFamily] = useState<string | null>(
    filePath ? loadedFonts.get(filePath) ?? null : null
  );

  useEffect(() => {
    if (!filePath) return;

    // Already loaded — just reuse the cached family name
    if (loadedFonts.has(filePath)) {
      setFontFamily(loadedFonts.get(filePath)!);
      return;
    }

    readFile(filePath).then((bytes) => {
      const blob = new Blob([bytes], { type: 'font/sfnt' });
      const blobUrl = URL.createObjectURL(blob);

      const familyName = getFamilyName(filePath);
      const style = document.createElement('style');
      style.textContent = `
        @font-face {
          font-family: '${familyName}';
          src: url('${blobUrl}');
        }
      `;
      document.head.appendChild(style);
      loadedFonts.set(filePath, familyName);
      setFontFamily(familyName);
    });
  }, [filePath]);

  return (
    <ScrollArea className="h-[calc(100vh-320px)]">
      <div className="p-6">
        <div className="mb-4">
          <h3 className="text-sm font-medium text-muted-foreground">
            Showing {numGlyphs} glyphs
          </h3>
        </div>
        <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
          {glyphs.map((glyph) => (
            <GlyphCell key={glyph.glyph_id} glyph={glyph} unitsPerEm={unitsPerEm} fontFamily={fontFamily} />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}
