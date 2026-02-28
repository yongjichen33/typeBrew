import { Skeleton } from '@/components/ui/skeleton';
import { Loader2 } from 'lucide-react';
import { GlyphGrid } from '@/components/GlyphGrid';
import { HeadTable } from '@/components/tables/HeadTable';
import { NameTable } from '@/components/tables/NameTable';
import { MaxpTable } from '@/components/tables/MaxpTable';
import { HheaTable } from '@/components/tables/HheaTable';
import { PostTable } from '@/components/tables/PostTable';
import { OS2Table } from '@/components/tables/OS2Table';
import { LocaTable } from '@/components/tables/LocaTable';
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
  filePath: string | null;
  onTableUpdated: () => void;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3 p-4">
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
    <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3">
      <Loader2 className="h-8 w-8 animate-spin" />
      <p className="text-sm">Loading table data...</p>
    </div>
  );
}

export function TableContent({
  data,
  glyphData,
  isLoading,
  isLoadingMore,
  tableName,
  onLoadMore,
  filePath,
  onTableUpdated,
}: TableContentProps) {
  if (!tableName) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center">
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
        filePath={filePath ?? ''}
        tableName={tableName ?? ''}
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
      <div className="text-muted-foreground flex h-full items-center justify-center">
        Failed to parse table data
      </div>
    );
  }

  switch (tableName) {
    case 'head':
      return <HeadTable data={parsed} filePath={filePath!} onSaved={onTableUpdated} />;
    case 'name':
      return <NameTable data={parsed} filePath={filePath!} onSaved={onTableUpdated} />;
    case 'maxp':
      return <MaxpTable data={parsed} filePath={filePath!} onSaved={onTableUpdated} />;
    case 'hhea':
      return <HheaTable data={parsed} filePath={filePath!} onSaved={onTableUpdated} />;
    case 'post':
      return <PostTable data={parsed} />;
    case 'OS/2':
    case 'os2':
      return <OS2Table data={parsed} />;
    case 'loca':
      return <LocaTable data={parsed} />;
    default:
      return <DefaultTable tableName={tableName} data={parsed} />;
  }
}
