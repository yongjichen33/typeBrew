import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router';
import { listen } from '@tauri-apps/api/event';
import { SplitPane, Pane } from 'react-split-pane';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Search, ChevronDown, ChevronRight, ArrowUp, ArrowDown } from 'lucide-react';
import { TableList } from '@/components/TableList';
import type { FontMetadata } from '@/types/font';
import { openFontDialog } from '@/hooks/useFileUpload';
import { useGoldenLayout } from '@/hooks/useGoldenLayout';
import { editorEventBus } from '@/lib/editorEventBus';
import '@/styles/golden-layout.css';

function ToolbarButton({ 
  icon, 
  title, 
  active, 
  onClick 
}: { 
  icon: React.ReactNode; 
  title: string; 
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={[
        'flex items-center justify-center w-6 h-6 rounded transition-colors',
        active 
          ? 'bg-primary text-primary-foreground' 
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      ].join(' ')}
    >
      {icon}
    </button>
  );
}

function ToolbarDivider() {
  return <div className="w-px h-3 bg-border mx-0.5" />;
}

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
  const [showSearch, setShowSearch] = useState(false);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [sortAscending, setSortAscending] = useState(true);

  const { containerRef, addTab, addEditorTab, isEmpty, activeTab } = useGoldenLayout();

  // Register the glyph editor tab opener with the event bus
  useEffect(() => {
    editorEventBus.setHandler(addEditorTab);
    return () => editorEventBus.clearHandler();
  }, [addEditorTab]);

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

  // Sorted fonts based on sortAscending
  const sortedFonts = useMemo(() => {
    return [...fonts].sort((a, b) => {
      const cmp = a.file_name.localeCompare(b.file_name);
      return sortAscending ? cmp : -cmp;
    });
  }, [fonts, sortAscending]);

  // Get all font file paths for expand/collapse all
  const allFontPaths = useMemo(() => fonts.map(f => f.file_path), [fonts]);
  
  // Derive allExpanded state from actual expandedIds
  const allExpanded = useMemo(() => 
    allFontPaths.every(path => expandedIds.includes(path)),
    [allFontPaths, expandedIds]
  );

  const handleExpandAll = useCallback(() => {
    setExpandedIds(allFontPaths);
  }, [allFontPaths]);

  const handleCollapseAll = useCallback(() => {
    setExpandedIds([]);
  }, []);

  const handleToggleExpand = useCallback(() => {
    if (allExpanded) {
      handleCollapseAll();
    } else {
      handleExpandAll();
    }
  }, [allExpanded, handleExpandAll, handleCollapseAll]);

  return (
    <div className="h-screen bg-background">
      <SplitPane direction="horizontal">
        {/* Left: Font Tree */}
        <Pane defaultSize="300px" minSize="200px" maxSize="500px">
          <Card className="h-full rounded-none border-0 border-r flex flex-col py-0">
            {/* Compact Toolbar */}
            <div className="p-1.5 border-b bg-muted/30">
              <div className="flex items-center gap-0.5">
                <ToolbarButton
                  icon={<Search size={14} />}
                  title="Search tables"
                  active={showSearch}
                  onClick={() => {
                    if (showSearch) {
                      setSearchQuery('');
                    }
                    setShowSearch(!showSearch);
                  }}
                />
                <ToolbarButton
                  icon={allExpanded ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  title={allExpanded ? "Collapse all" : "Expand all"}
                  onClick={handleToggleExpand}
                />
                <ToolbarDivider />
                <ToolbarButton
                  icon={sortAscending ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                  title={`Sort ${sortAscending ? 'descending' : 'ascending'}`}
                  onClick={() => setSortAscending(!sortAscending)}
                />
              </div>
              
              {/* Search input (shown when search is active) */}
              {showSearch && (
                <div className="relative mt-1.5">
                  <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search tables..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-7 h-6 text-xs"
                    autoFocus
                  />
                </div>
              )}
            </div>
            <CardContent className="p-0 flex-1 min-h-0 overflow-hidden">
              <TableList
                fonts={sortedFonts}
                selectedFilePath={selectedFilePath}
                selectedTable={selectedTable}
                searchQuery={searchQuery}
                onSelectTable={handleSelectTable}
                expandedIds={expandedIds}
                onExpand={setExpandedIds}
                activeTab={activeTab}
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
