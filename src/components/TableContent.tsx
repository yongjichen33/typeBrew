import { Skeleton } from '@/components/ui/skeleton';
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

export function TableContent({ data, glyphData, isLoading, isLoadingMore, tableName, onLoadMore }: TableContentProps) {
  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    );
  }

  if (!tableName) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-320px)] text-muted-foreground">
        Select a table to view its contents
      </div>
    );
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

  if (!data) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-320px)] text-muted-foreground">
        No data available
      </div>
    );
  }

  let parsed: any;
  try {
    parsed = JSON.parse(data);
  } catch {
    parsed = null;
  }

  if (!parsed) {
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
