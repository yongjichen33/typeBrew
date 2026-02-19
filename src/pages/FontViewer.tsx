import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Search } from 'lucide-react';
import { toast } from 'sonner';
import { TableList } from '@/components/TableList';
import { TableContent } from '@/components/TableContent';
import type { FontMetadata } from '@/types/font';
import { openFontDialog } from '@/hooks/useFileUpload';
import { parseGlyphOutlines, type Glyph } from '@/lib/glyphParser';

const OUTLINE_TABLES = ['glyf', 'CFF ', 'CFF2'];
const GLYPH_BATCH_SIZE = 200;

interface GlyphState {
  glyphs: Glyph[];
  totalGlyphs: number;
  unitsPerEm: number;
}

export function FontViewer() {
  const location = useLocation();
  const navigate = useNavigate();

  const [fonts, setFonts] = useState<FontMetadata[]>(() => {
    const initial = location.state?.metadata as FontMetadata | undefined;
    return initial ? [initial] : [];
  });
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(
    (location.state?.metadata as FontMetadata | undefined)?.file_path ?? null
  );
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableData, setTableData] = useState<string | null>(null);
  const [glyphState, setGlyphState] = useState<GlyphState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const loadingMoreRef = useRef(false);

  const selectedFont = fonts.find(f => f.file_path === selectedFilePath) ?? null;

  // Listen for "Open Font" menu event
  useEffect(() => {
    const unlisten = listen('menu:open-font', async () => {
      const newFonts = await openFontDialog();
      if (newFonts.length > 0) {
        setFonts(prev => {
          const existing = new Set(prev.map(f => f.file_path));
          const unique = newFonts.filter(f => !existing.has(f.file_path));
          return [...prev, ...unique];
        });
        // Select the first newly opened font
        setSelectedFilePath(newFonts[0].file_path);
        setSelectedTable(null);
        setTableData(null);
        setGlyphState(null);
      }
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  const loadGlyphBatch = useCallback(async (filePath: string, offset: number) => {
    const buffer = await invoke<ArrayBuffer>('get_glyph_outlines', {
      filePath,
      offset,
      limit: GLYPH_BATCH_SIZE,
    });
    return parseGlyphOutlines(buffer);
  }, []);

  // Load table data when selection changes
  useEffect(() => {
    if (!selectedTable || !selectedFilePath) return;

    const loadTableData = async () => {
      setIsLoading(true);
      setTableData(null);
      setGlyphState(null);
      try {
        if (OUTLINE_TABLES.includes(selectedTable)) {
          const data = await loadGlyphBatch(selectedFilePath, 0);
          setGlyphState({
            glyphs: data.glyphs,
            totalGlyphs: data.totalGlyphs,
            unitsPerEm: data.unitsPerEm,
          });
        } else {
          const data = await invoke<string>('get_font_table', {
            filePath: selectedFilePath,
            tableName: selectedTable,
          });
          setTableData(data);
        }
      } catch (error) {
        toast.error(`Failed to load ${selectedTable} table: ${error}`);
      } finally {
        setIsLoading(false);
      }
    };

    loadTableData();
  }, [selectedTable, selectedFilePath, loadGlyphBatch]);

  const handleLoadMore = useCallback(async () => {
    if (!glyphState || !selectedFilePath || loadingMoreRef.current) return;
    if (glyphState.glyphs.length >= glyphState.totalGlyphs) return;

    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    try {
      const data = await loadGlyphBatch(selectedFilePath, glyphState.glyphs.length);
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
  }, [glyphState, selectedFilePath, loadGlyphBatch]);

  const handleTableUpdated = useCallback(async () => {
    if (!selectedTable || !selectedFilePath) return;
    if (OUTLINE_TABLES.includes(selectedTable)) return;
    try {
      const data = await invoke<string>('get_font_table', {
        filePath: selectedFilePath,
        tableName: selectedTable,
      });
      setTableData(data);
    } catch (error) {
      toast.error(`Failed to refresh table: ${error}`);
    }
  }, [selectedTable, selectedFilePath]);

  const handleSelectTable = useCallback((filePath: string, table: string) => {
    const fontChanged = filePath !== selectedFilePath;
    if (fontChanged) {
      setSelectedFilePath(filePath);
    }
    setTableData(null);
    setGlyphState(null);
    setSelectedTable(table);
  }, [selectedFilePath]);

  return (
    <div className="min-h-screen bg-background p-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold">
              {selectedFont?.family_name ?? 'typeBrew'}
            </h1>
            {selectedFont && (
              <p className="text-sm text-muted-foreground">
                {selectedFont.style_name} • {selectedFont.num_glyphs} glyphs
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Split View */}
      <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4 h-[calc(100vh-200px)]">
        {/* Left: Font Tree */}
        <Card>
          <CardHeader>
            <div className="relative mt-2">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tables..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="p-0">
            <TableList
              fonts={fonts}
              selectedFilePath={selectedFilePath}
              selectedTable={selectedTable}
              searchQuery={searchQuery}
              onSelectTable={handleSelectTable}
            />
          </CardContent>
        </Card>

        {/* Right: Table Content */}
        <Card>
          <CardHeader>
            <CardTitle>
              {selectedTable || 'Select a table'}
            </CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="p-0">
            <TableContent
              data={tableData}
              glyphData={glyphState}
              isLoading={isLoading}
              isLoadingMore={isLoadingMore}
              tableName={selectedTable}
              onLoadMore={handleLoadMore}
              filePath={selectedFilePath}
              onTableUpdated={handleTableUpdated}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
