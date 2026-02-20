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
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(400);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setContainerHeight(entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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

  return (
    <div ref={containerRef} className="h-full">
      {fonts.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">
          No fonts opened
        </p>
      ) : (
        <RsTree
          data={treeData}
          selectedIds={selectedIds}
          onSelect={handleSelect}
          searchTerm={searchQuery}
          autoExpandSearch={true}
          showIcons={false}
          showTreeLines={true}
          clickToToggle={true}
          autoHeight={false}
          height={containerHeight}
          itemHeight={30}
          treeNodeClassName="font-mono text-sm"
        />
      )}
    </div>
  );
}
