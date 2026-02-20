import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router';
import { listen } from '@tauri-apps/api/event';
import { SplitPane, Pane } from 'react-split-pane';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Search } from 'lucide-react';
import { TableList } from '@/components/TableList';
import type { FontMetadata } from '@/types/font';
import { openFontDialog } from '@/hooks/useFileUpload';
import { useGoldenLayout } from '@/hooks/useGoldenLayout';
import '@/styles/golden-layout.css';

export function FontViewer() {
  const location = useLocation();

  const [fonts, setFonts] = useState<FontMetadata[]>(() => {
    const initial = location.state?.metadata as FontMetadata | undefined;
    return initial ? [initial] : [];
  });
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(
    (location.state?.metadata as FontMetadata | undefined)?.file_path ?? null
  );
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const { containerRef, addTab, isEmpty } = useGoldenLayout();

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
        setSelectedFilePath(newFonts[0].file_path);
        setSelectedTable(null);
      }
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  const handleSelectTable = useCallback((filePath: string, table: string) => {
    setSelectedFilePath(filePath);
    setSelectedTable(table);
    addTab(filePath, table, table);
  }, [addTab]);

  return (
    <div className="h-screen bg-background">
      <SplitPane direction="horizontal">
        {/* Left: Font Tree */}
        <Pane defaultSize="300px" minSize="200px" maxSize="500px">
          <Card className="h-full rounded-none border-0 border-r flex flex-col">
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
            <CardContent className="p-0 flex-1 min-h-0 overflow-hidden">
              <TableList
                fonts={fonts}
                selectedFilePath={selectedFilePath}
                selectedTable={selectedTable}
                searchQuery={searchQuery}
                onSelectTable={handleSelectTable}
              />
            </CardContent>
          </Card>
        </Pane>

        {/* Right: Golden Layout Tabs */}
        <Pane>
          <div className="relative h-full overflow-hidden">
            <div ref={containerRef} className="h-full w-full" />
            {isEmpty && (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground pointer-events-none">
                Select a table to view its contents
              </div>
            )}
          </div>
        </Pane>
      </SplitPane>
    </div>
  );
}
