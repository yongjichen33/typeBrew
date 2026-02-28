import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { FontTree, type TreeNode } from './FontTree';
import type { FontMetadata } from '@/types/font';
import type { ActiveTabInfo } from '@/hooks/useGoldenLayout';

interface TableListProps {
  fonts: FontMetadata[];
  selectedFilePath: string | null;
  selectedTable: string | null;
  searchQuery: string;
  onSelectTable: (filePath: string, table: string) => void;
  expandedIds?: string[];
  onExpand?: (expandedIds: string[]) => void;
  activeTab?: ActiveTabInfo | null;
}

function tableNodeId(filePath: string, table: string): string {
  return `${filePath}::${table}`;
}

export function TableList({
  fonts,
  selectedFilePath,
  selectedTable,
  searchQuery,
  onSelectTable,
  expandedIds: controlledExpandedIds,
  onExpand,
  activeTab,
}: TableListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(400);
  const [internalExpandedIds, setInternalExpandedIds] = useState<string[]>([]);
  const prevActiveTabRef = useRef<ActiveTabInfo | null>(null);

  // Use controlled or internal state
  const isControlled = controlledExpandedIds !== undefined;
  const expandedIds = isControlled ? controlledExpandedIds : internalExpandedIds;
  const handleExpandChange = onExpand ?? setInternalExpandedIds;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setContainerHeight(entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Convert fonts to tree data format
  const treeData: TreeNode[] = useMemo(
    () =>
      fonts.map((font) => ({
        id: font.file_path,
        label: font.file_name,
        children: font.available_tables.map((table) => ({
          id: tableNodeId(font.file_path, table),
          label: table,
        })),
      })),
    [fonts]
  );

  // Compute selected node id based on activeTab or manual selection
  const selectedIds = useMemo(() => {
    if (activeTab) {
      if (activeTab.type === 'table') {
        return [tableNodeId(activeTab.filePath, activeTab.tableName)];
      }
      return [activeTab.filePath];
    }
    if (selectedFilePath && selectedTable) {
      return [tableNodeId(selectedFilePath, selectedTable)];
    }
    return [];
  }, [activeTab, selectedFilePath, selectedTable]);

  // Auto-expand when activeTab changes
  useEffect(() => {
    const prevTab = prevActiveTabRef.current;
    const tabChanged =
      (activeTab === null && prevTab !== null) ||
      (activeTab !== null && prevTab === null) ||
      (activeTab &&
        prevTab &&
        (activeTab.filePath !== prevTab.filePath ||
          activeTab.type !== prevTab.type ||
          (activeTab.type === 'table' &&
            prevTab.type === 'table' &&
            activeTab.tableName !== prevTab.tableName) ||
          (activeTab.type === 'glyph' &&
            prevTab.type === 'glyph' &&
            activeTab.glyphId !== prevTab.glyphId)));

    prevActiveTabRef.current = activeTab ?? null;

    if (activeTab && tabChanged && !expandedIds.includes(activeTab.filePath)) {
      handleExpandChange([...expandedIds, activeTab.filePath]);
    }
  }, [activeTab, expandedIds, handleExpandChange]);

  // Handle node selection — only table (leaf) nodes trigger onSelectTable
  const handleSelect = useCallback(
    (ids: string[]) => {
      const id = ids[0];
      if (!id) return;

      const sepIndex = id.indexOf('::');
      if (sepIndex === -1) return; // clicked a font node, ignore

      const filePath = id.substring(0, sepIndex);
      const table = id.substring(sepIndex + 2);
      onSelectTable(filePath, table);
    },
    [onSelectTable]
  );

  return (
    <div ref={containerRef} className="h-full">
      {fonts.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center">No fonts opened</p>
      ) : (
        <FontTree
          data={treeData}
          selectedIds={selectedIds}
          expandedIds={expandedIds}
          onExpand={handleExpandChange}
          onSelect={handleSelect}
          searchTerm={searchQuery}
          height={containerHeight}
          itemHeight={28}
        />
      )}
    </div>
  );
}
