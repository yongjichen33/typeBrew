import { ScrollArea } from '@/components/ui/scroll-area';

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
}

function GlyphCell({ glyph, unitsPerEm }: { glyph: Glyph; unitsPerEm: number }) {
  const bounds = glyph.bounds;
  const padding = 50;
  const viewBox = bounds
    ? `${bounds.x_min - padding} ${-bounds.y_max - padding} ${bounds.x_max - bounds.x_min + padding * 2} ${bounds.y_max - bounds.y_min + padding * 2}`
    : `0 ${-unitsPerEm} ${unitsPerEm} ${unitsPerEm}`;

  return (
    <div className="flex flex-col items-center p-3 border rounded-lg hover:bg-muted/50 transition-colors">
      <svg viewBox={viewBox} className="w-full h-20 mb-2">
        <path d={glyph.svg_path} fill="currentColor" className="text-foreground" />
      </svg>
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

export function GlyphGrid({ glyphs, numGlyphs, unitsPerEm }: GlyphGridProps) {
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
            <GlyphCell key={glyph.glyph_id} glyph={glyph} unitsPerEm={unitsPerEm} />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}
