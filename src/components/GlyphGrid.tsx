import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Plus, ArrowUp } from 'lucide-react';
import type { Glyph } from '@/lib/glyphParser';
import { editorEventBus } from '@/lib/editorEventBus';
import type { GlyphOutlineData } from '@/lib/editorTypes';

interface GlyphGridProps {
  glyphs: Glyph[];
  totalGlyphs: number;
  unitsPerEm: number;
  onLoadMore: () => void;
  isLoadingMore: boolean;
  filePath: string;
  tableName: string;
}

function GlyphCell({
  glyph,
  unitsPerEm,
  filePath,
  tableName,
}: {
  glyph: Glyph;
  unitsPerEm: number;
  filePath: string;
  tableName: string;
}) {
  const bounds = glyph.bounds;
  const padding = 20;
  const viewBox = bounds
    ? `${bounds.x_min - padding} ${-bounds.y_max - padding} ${bounds.x_max - bounds.x_min + padding * 2} ${bounds.y_max - bounds.y_min + padding * 2}`
    : `0 ${-unitsPerEm} ${unitsPerEm} ${unitsPerEm}`;

  const handleClick = async () => {
    try {
      const outlineData = await invoke<GlyphOutlineData>('get_glyph_outline_data', {
        filePath,
        glyphId: glyph.glyph_id,
      });

      editorEventBus.emit({
        filePath,
        tableName,
        glyphId: glyph.glyph_id,
        glyphName: glyph.glyph_name,
        outlineData,
        advanceWidth: outlineData.advance_width,
        boundsXMin: outlineData.bounds?.x_min ?? 0,
        boundsYMin: outlineData.bounds?.y_min ?? 0,
        boundsXMax: outlineData.bounds?.x_max ?? 0,
        boundsYMax: outlineData.bounds?.y_max ?? 0,
        unitsPerEm,
      });
    } catch (err) {
      console.error('Failed to load glyph outline data:', err);
    }
  };

  return (
    <div
      onClick={handleClick}
      className="hover:bg-primary/10 hover:border-primary/50 flex cursor-pointer flex-col items-center rounded-lg border p-2 transition-all duration-150 hover:scale-[1.02] hover:shadow-md"
    >
      <svg viewBox={viewBox} className="mb-1 h-12 w-full">
        <path d={glyph.svg_path} fill="currentColor" className="text-foreground" />
      </svg>
      <div className="text-center">
        <div className="text-muted-foreground font-mono text-xs">#{glyph.glyph_id}</div>
        {glyph.glyph_name && (
          <div className="text-muted-foreground mt-1 text-xs">{glyph.glyph_name}</div>
        )}
      </div>
    </div>
  );
}

export function GlyphGrid({
  glyphs: initialGlyphs,
  totalGlyphs,
  unitsPerEm,
  onLoadMore,
  isLoadingMore,
  filePath,
  tableName,
}: GlyphGridProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const hasMore = initialGlyphs.length < totalGlyphs;
  // Keep a stable ref to the latest onLoadMore so the IntersectionObserver
  // effect doesn't need it as a dep and won't disconnect/reconnect every render.
  const onLoadMoreRef = useRef(onLoadMore);
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);
  const [glyphs, setGlyphs] = useState(initialGlyphs);
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    setGlyphs(initialGlyphs);
  }, [initialGlyphs]);

  useEffect(() => {
    const handleGlyphSaved = (data: { filePath: string; glyphId: number; svgPath: string }) => {
      if (data.filePath !== filePath) return;

      setGlyphs((prev) =>
        prev.map((g) => (g.glyph_id === data.glyphId ? { ...g, svg_path: data.svgPath } : g))
      );
    };

    editorEventBus.setGlyphSavedHandler(handleGlyphSaved);
    return () => editorEventBus.clearGlyphSavedHandler();
  }, [filePath]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onLoadMoreRef.current();
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
    // onLoadMore intentionally omitted: latest value is always in onLoadMoreRef
     
  }, [hasMore]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Find the viewport element within the container
    const viewport = container.querySelector(
      '[data-radix-scroll-area-viewport]'
    ) as HTMLDivElement | null;
    if (!viewport) return;

    scrollViewportRef.current = viewport;

    const handleScroll = () => {
      setShowScrollTop(viewport.scrollTop > 300);
    };

    viewport.addEventListener('scroll', handleScroll);
    return () => viewport.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    if (scrollViewportRef.current) {
      scrollViewportRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div ref={containerRef} className="relative h-full">
      <ScrollArea className="h-full">
        <div className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-muted-foreground text-sm font-medium">
              Showing {glyphs.length} of {totalGlyphs} glyphs
            </h3>
            <button
              onClick={() => {
                const newGlyphId = totalGlyphs;
                const emptyOutlineData: GlyphOutlineData = {
                  glyph_id: newGlyphId,
                  glyph_name: undefined,
                  contours: [],
                  advance_width: unitsPerEm,
                  bounds: undefined,
                  is_composite: false,
                  component_glyph_ids: [],
                  components: [],
                };
                editorEventBus.emit({
                  filePath,
                  tableName,
                  glyphId: newGlyphId,
                  glyphName: undefined,
                  outlineData: emptyOutlineData,
                  advanceWidth: unitsPerEm,
                  boundsXMin: 0,
                  boundsYMin: 0,
                  boundsXMax: unitsPerEm,
                  boundsYMax: unitsPerEm,
                  unitsPerEm,
                });
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 rounded px-3 py-1.5 text-xs transition-colors"
            >
              <Plus size={14} />
              <span>New Glyph</span>
            </button>
          </div>
          <div className="grid grid-cols-6 gap-2 md:grid-cols-8 lg:grid-cols-12">
            {glyphs.map((glyph) => (
              <GlyphCell
                key={glyph.glyph_id}
                glyph={glyph}
                unitsPerEm={unitsPerEm}
                filePath={filePath}
                tableName={tableName}
              />
            ))}
          </div>
          {hasMore && (
            <div ref={sentinelRef} className="flex justify-center py-6">
              {isLoadingMore && <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />}
            </div>
          )}
        </div>
      </ScrollArea>
      {showScrollTop && (
        <button
          onClick={scrollToTop}
          className="bg-primary text-primary-foreground hover:bg-primary/90 absolute right-4 bottom-4 z-50 flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition-all"
          aria-label="Scroll to top"
        >
          <ArrowUp size={20} />
        </button>
      )}
    </div>
  );
}
