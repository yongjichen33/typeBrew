import { Skeleton } from '@/components/ui/skeleton';
import { Loader2 } from 'lucide-react';
import { GlyphGrid } from '@/components/GlyphGrid';
import { HeadTable } from '@/components/tables/HeadTable';
import { NameTable } from '@/components/tables/NameTable';
import { MaxpTable } from '@/components/tables/MaxpTable';
import { HheaTable } from '@/components/tables/HheaTable';
import { PostTable } from '@/components/tables/PostTable';
import { DefaultTable } from '@/components/tables/DefaultTable';
import type { Glyph } from '@/lib/glyphParser';

interface GlyphState {
  glyphs: Glyph[];
  totalGlyphs: number;
  unitsPerEm: number;
}

interface TableContentProps {
  data: string | null;
  glyphData: GlyphState | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  tableName: string | null;
  onLoadMore: () => void;
}

function LoadingSkeleton() {
  return (
    <div className="p-4 space-y-3">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-4/5" />
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-320px)] gap-3 text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin" />
      <p className="text-sm">Loading table data...</p>
    </div>
  );
}

export function TableContent({ data, glyphData, isLoading, isLoadingMore, tableName, onLoadMore }: TableContentProps) {
  if (!tableName) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-320px)] text-muted-foreground">
        Select a table to view its contents
      </div>
    );
  }

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  // Outline tables (glyf, CFF, CFF2) — parsed from binary
  if (glyphData) {
    return (
      <GlyphGrid
        glyphs={glyphData.glyphs}
        totalGlyphs={glyphData.totalGlyphs}
        unitsPerEm={glyphData.unitsPerEm}
        onLoadMore={onLoadMore}
        isLoadingMore={isLoadingMore}
      />
    );
  }

  // Data not yet available — show spinner while waiting
  if (!data) {
    return <LoadingSpinner />;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(data);
  } catch {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-320px)] text-muted-foreground">
        Failed to parse table data
      </div>
    );
  }

  switch (tableName) {
    case 'head':
      return <HeadTable data={parsed} />;
    case 'name':
      return <NameTable data={parsed} />;
    case 'maxp':
      return <MaxpTable data={parsed} />;
    case 'hhea':
      return <HheaTable data={parsed} />;
    case 'post':
      return <PostTable data={parsed} />;
    default:
      return <DefaultTable tableName={tableName} data={parsed} />;
  }
}
