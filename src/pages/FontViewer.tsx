import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router';
import { invoke } from '@tauri-apps/api/core';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Search } from 'lucide-react';
import { toast } from 'sonner';
import { TableList } from '@/components/TableList';
import { TableContent } from '@/components/TableContent';
import type { FontMetadata } from '@/types/font';
import { parseGlyphOutlines, type Glyph } from '@/lib/glyphParser';

const OUTLINE_TABLES = ['glyf', 'CFF ', 'CFF2'];
const GLYPH_BATCH_SIZE = 200;

interface GlyphState {
  glyphs: Glyph[];
  totalGlyphs: number;
  unitsPerEm: number;
}

export function FontViewer() {
  const { fontName } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [metadata, setMetadata] = useState<FontMetadata | null>(
    location.state?.metadata || null
  );
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableData, setTableData] = useState<string | null>(null);
  const [glyphState, setGlyphState] = useState<GlyphState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const loadingMoreRef = useRef(false);

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
    if (!selectedTable || !metadata?.file_path) return;

    const loadTableData = async () => {
      setIsLoading(true);
      setTableData(null);
      setGlyphState(null);
      try {
        if (OUTLINE_TABLES.includes(selectedTable)) {
          const data = await loadGlyphBatch(metadata.file_path, 0);
          setGlyphState({
            glyphs: data.glyphs,
            totalGlyphs: data.totalGlyphs,
            unitsPerEm: data.unitsPerEm,
          });
        } else {
          const data = await invoke<string>('get_font_table', {
            filePath: metadata.file_path,
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
  }, [selectedTable, metadata?.file_path, loadGlyphBatch]);

  const handleLoadMore = useCallback(async () => {
    if (!glyphState || !metadata?.file_path || loadingMoreRef.current) return;
    if (glyphState.glyphs.length >= glyphState.totalGlyphs) return;

    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    try {
      const data = await loadGlyphBatch(metadata.file_path, glyphState.glyphs.length);
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
  }, [glyphState, metadata?.file_path, loadGlyphBatch]);

  const filteredTables = metadata?.available_tables.filter(table =>
    table.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  return (
    <div className="min-h-screen bg-background p-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => navigate('/')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{metadata?.family_name || fontName}</h1>
            <p className="text-sm text-muted-foreground">
              {metadata?.style_name} • {metadata?.num_glyphs} glyphs
            </p>
          </div>
        </div>
        <Badge variant="secondary">
          {metadata?.available_tables.length || 0} tables
        </Badge>
      </div>

      {/* Split View */}
      <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4 h-[calc(100vh-200px)]">
        {/* Left: Table List */}
        <Card>
          <CardHeader>
            <CardTitle>Tables</CardTitle>
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
              tables={filteredTables}
              selectedTable={selectedTable}
              onSelectTable={setSelectedTable}
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
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
