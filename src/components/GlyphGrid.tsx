import { useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2 } from 'lucide-react';
import type { Glyph } from '@/lib/glyphParser';

interface GlyphGridProps {
  glyphs: Glyph[];
  totalGlyphs: number;
  unitsPerEm: number;
  onLoadMore: () => void;
  isLoadingMore: boolean;
}

function GlyphCell({ glyph, unitsPerEm }: { glyph: Glyph; unitsPerEm: number }) {
  const bounds = glyph.bounds;
  const padding = 20;
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

export function GlyphGrid({ glyphs, totalGlyphs, unitsPerEm, onLoadMore, isLoadingMore }: GlyphGridProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasMore = glyphs.length < totalGlyphs;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onLoadMore();
        }
      },
      { rootMargin: '200px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore]);

  return (
    <ScrollArea className="h-full">
      <div className="p-6">
        <div className="mb-4">
          <h3 className="text-sm font-medium text-muted-foreground">
            Showing {glyphs.length} of {totalGlyphs} glyphs
          </h3>
        </div>
        <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
          {glyphs.map((glyph) => (
            <GlyphCell key={glyph.glyph_id} glyph={glyph} unitsPerEm={unitsPerEm} />
          ))}
        </div>
        {hasMore && (
          <div ref={sentinelRef} className="flex justify-center py-6">
            {isLoadingMore && (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            )}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
