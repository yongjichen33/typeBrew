import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { TableContent } from '@/components/TableContent';
import { parseGlyphOutlines, type Glyph } from '@/lib/glyphParser';

const OUTLINE_TABLES = ['glyf', 'CFF ', 'CFF2'];
const GLYPH_BATCH_SIZE = 200;

interface GlyphState {
  glyphs: Glyph[];
  totalGlyphs: number;
  unitsPerEm: number;
}

interface TableContentTabProps {
  filePath: string;
  tableName: string;
  isActive: boolean;
}

export function TableContentTab({ filePath, tableName, isActive }: TableContentTabProps) {
  const [tableData, setTableData] = useState<string | null>(null);
  const [glyphState, setGlyphState] = useState<GlyphState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  const loadGlyphBatch = useCallback(async (offset: number) => {
    const buffer = await invoke<ArrayBuffer>('get_glyph_outlines', {
      filePath,
      offset,
      limit: GLYPH_BATCH_SIZE,
    });
    return parseGlyphOutlines(buffer);
  }, [filePath]);

  // Load data on mount
  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        if (OUTLINE_TABLES.includes(tableName)) {
          const data = await loadGlyphBatch(0);
          setGlyphState({
            glyphs: data.glyphs,
            totalGlyphs: data.totalGlyphs,
            unitsPerEm: data.unitsPerEm,
          });
        } else {
          const data = await invoke<string>('get_font_table', {
            filePath,
            tableName,
          });
          setTableData(data);
        }
      } catch (error) {
        toast.error(`Failed to load ${tableName} table: ${error}`);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [filePath, tableName, loadGlyphBatch]);

  const handleLoadMore = useCallback(async () => {
    if (!glyphState || loadingMoreRef.current) return;
    if (glyphState.glyphs.length >= glyphState.totalGlyphs) return;

    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    try {
      const data = await loadGlyphBatch(glyphState.glyphs.length);
      setGlyphState(prev => prev ? {
        ...prev,
        glyphs: [...prev.glyphs, ...data.glyphs],
      } : null);
    } catch (error) {
      toast.error(`Failed to load more glyphs: ${error}`);
    } finally {
      setIsLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [glyphState, loadGlyphBatch]);

  const handleTableUpdated = useCallback(async () => {
    if (OUTLINE_TABLES.includes(tableName)) return;
    try {
      const data = await invoke<string>('get_font_table', {
        filePath,
        tableName,
      });
      setTableData(data);
    } catch (error) {
      toast.error(`Failed to refresh table: ${error}`);
    }
  }, [filePath, tableName]);

  return (
    <div className={isActive ? undefined : 'hidden'}>
      <TableContent
        data={tableData}
        glyphData={glyphState}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        tableName={tableName}
        onLoadMore={handleLoadMore}
        filePath={filePath}
        onTableUpdated={handleTableUpdated}
      />
    </div>
  );
}
