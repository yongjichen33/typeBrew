import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { RsTree, type TreeNode } from 'rstree-ui';
import type { FontMetadata } from '@/types/font';

interface TableListProps {
  fonts: FontMetadata[];
  selectedFilePath: string | null;
  selectedTable: string | null;
  searchQuery: string;
  onSelectTable: (filePath: string, table: string) => void;
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
}: TableListProps) {
  const prevFontCount = useRef(fonts.length);

  // Convert fonts to RsTree data format
  const treeData: TreeNode[] = useMemo(() =>
    fonts.map(font => ({
      id: font.file_path,
      label: font.file_name,
      children: font.available_tables.map(table => ({
        id: tableNodeId(font.file_path, table),
        label: table,
      })),
    })),
    [fonts]
  );

  // All font nodes start expanded
  const [expandedIds, setExpandedIds] = useState<string[]>(() =>
    fonts.map(f => f.file_path)
  );

  // Auto-expand newly added fonts
  useEffect(() => {
    if (fonts.length > prevFontCount.current) {
      setExpandedIds(prev => {
        const existing = new Set(prev);
        const newIds = fonts
          .map(f => f.file_path)
          .filter(id => !existing.has(id));
        return newIds.length > 0 ? [...prev, ...newIds] : prev;
      });
    }
    prevFontCount.current = fonts.length;
  }, [fonts]);

  // Compute selected node id
  const selectedIds = useMemo(() => {
    if (selectedFilePath && selectedTable) {
      return [tableNodeId(selectedFilePath, selectedTable)];
    }
    return [];
  }, [selectedFilePath, selectedTable]);

  // Handle node selection — only table (leaf) nodes trigger onSelectTable
  const handleSelect = useCallback((ids: string[]) => {
    const id = ids[0];
    if (!id) return;

    // Font (parent) nodes don't have "::" — only table nodes do
    const sepIndex = id.indexOf('::');
    if (sepIndex === -1) return; // clicked a font node, ignore

    const filePath = id.substring(0, sepIndex);
    const table = id.substring(sepIndex + 2);
    onSelectTable(filePath, table);
  }, [onSelectTable]);

  if (fonts.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-8">
        No fonts opened
      </p>
    );
  }

  return (
    <RsTree
      data={treeData}
      selectedIds={selectedIds}
      onSelect={handleSelect}
      expandedIds={expandedIds}
      onExpand={setExpandedIds}
      searchTerm={searchQuery}
      autoExpandSearch={true}
      showIcons={false}
      showTreeLines={true}
      clickToToggle={true}
      autoHeight={true}
      maxHeight={window.innerHeight - 320}
      itemHeight={30}
      treeNodeClassName="font-mono text-sm"
    />
  );
}
