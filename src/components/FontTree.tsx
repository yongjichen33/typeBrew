import { useEffect, useMemo, useRef, useCallback, useLayoutEffect } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

interface TreeNode {
  id: string;
  label: string;
  children?: TreeNode[];
}

interface FontTreeProps {
  data: TreeNode[];
  selectedIds: string[];
  expandedIds: string[];
  onExpand: (ids: string[]) => void;
  onSelect: (ids: string[]) => void;
  searchTerm?: string;
  height: number;
  itemHeight?: number;
}

function matchSearch(term: string, text: string): boolean {
  return text.toLowerCase().includes(term.toLowerCase());
}

// Filter tree nodes - only keep nodes that match or have matching descendants
function filterTreeNodes(nodes: TreeNode[], term: string): TreeNode[] {
  if (!term) return nodes;

  return nodes
    .map((node) => {
      if (node.children) {
        const filteredChildren = filterTreeNodes(node.children, term);
        if (filteredChildren.length > 0 || matchSearch(term, node.label)) {
          return { ...node, children: filteredChildren };
        }
      }
      return matchSearch(term, node.label) ? node : null;
    })
    .filter((node): node is TreeNode => node !== null);
}

function TreeNodeComponent({
  node,
  level,
  isSelected,
  isExpanded,
  searchTerm,
  onNodeClick,
  itemHeight,
  isLastChild,
  parentLines,
}: {
  node: TreeNode;
  level: number;
  isSelected: boolean;
  isExpanded: boolean;
  searchTerm: string;
  onNodeClick: () => void;
  itemHeight: number;
  isLastChild: boolean;
  parentLines: boolean[];
}) {
  const hasChildren = node.children && node.children.length > 0;
  const matchesSelf = searchTerm && matchSearch(searchTerm, node.label);

  const renderLabel = () => {
    if (!searchTerm || !matchesSelf) return node.label;

    const idx = node.label.toLowerCase().indexOf(searchTerm.toLowerCase());
    if (idx === -1) return node.label;

    const before = node.label.slice(0, idx);
    const match = node.label.slice(idx, idx + searchTerm.length);
    const after = node.label.slice(idx + searchTerm.length);

    return (
      <>
        {before}
        <span className="rounded-sm bg-yellow-200 px-0.5 text-yellow-900">{match}</span>
        {after}
      </>
    );
  };

  return (
    <div className="flex" style={{ height: itemHeight }}>
      {/* Tree lines column */}
      <div className="flex shrink-0" style={{ width: level * 16 + 4 }}>
        {parentLines.map((hasLine, i) => (
          <div key={i} className="relative" style={{ width: 16 }}>
            {hasLine && (
              <div className="bg-border absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2" />
            )}
          </div>
        ))}
        {/* Current level line connector */}
        {level > 0 && (
          <div className="relative w-4 shrink-0">
            {/* Vertical line extending up from midpoint if not last child */}
            {!isLastChild && (
              <div className="bg-border absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2" />
            )}
            {/* Vertical line from midpoint to current item */}
            <div className="bg-border absolute top-0 left-1/2 h-1/2 w-px -translate-x-1/2" />
          </div>
        )}
      </div>

      {/* Node content */}
      <div
        className={`flex flex-1 cursor-pointer items-center gap-1 rounded px-1 py-0.5 transition-colors ${
          isSelected ? 'bg-muted text-foreground' : 'hover:bg-muted text-foreground'
        }`}
        onClick={onNodeClick}
      >
        {hasChildren && (
          <span className="flex-shrink-0">
            {isExpanded ? (
              <ChevronDown size={14} className="text-muted-foreground" />
            ) : (
              <ChevronRight size={14} className="text-muted-foreground" />
            )}
          </span>
        )}
        {!hasChildren && <span className="w-3.5" />}
        <span className="truncate font-mono text-xs">{renderLabel()}</span>
      </div>
    </div>
  );
}

export function FontTree({
  data,
  selectedIds,
  expandedIds,
  onExpand,
  onSelect,
  searchTerm = '',
  height,
  itemHeight = 28,
}: FontTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevSelectedIdRef = useRef<string | null>(null);
  const isInitialMountRef = useRef(true);

  // Filter nodes by search term
  const filteredData = useMemo(() => {
    return filterTreeNodes(data, searchTerm);
  }, [data, searchTerm]);

  // Auto-expand all parent nodes when searching
  useEffect(() => {
    if (!searchTerm) return;

    const collectParentIds = (nodes: TreeNode[]): string[] => {
      const ids: string[] = [];
      for (const node of nodes) {
        if (node.children && node.children.length > 0) {
          ids.push(node.id);
          ids.push(...collectParentIds(node.children));
        }
      }
      return ids;
    };

    const parentIds = collectParentIds(filteredData);
    const newExpanded = new Set(expandedIds);
    parentIds.forEach((id) => newExpanded.add(id));

    if (newExpanded.size !== expandedIds.length) {
      onExpand(Array.from(newExpanded));
    }
  }, [searchTerm, filteredData, expandedIds, onExpand]);

  // Get all visible nodes with tree line info
  const visibleNodes = useMemo(() => {
    const nodes: Array<{
      node: TreeNode;
      level: number;
      isLastChild: boolean;
      parentLines: boolean[];
    }> = [];

    const traverse = (nodeList: TreeNode[], level: number, parentLines: boolean[]) => {
      for (let i = 0; i < nodeList.length; i++) {
        const node = nodeList[i];
        const isLast = i === nodeList.length - 1;
        nodes.push({
          node,
          level,
          isLastChild: isLast,
          parentLines: [...parentLines],
        });
        if (node.children && expandedIds.includes(node.id)) {
          // Pass down parentLines + whether this node continues a line (not last)
          traverse(node.children, level + 1, [...parentLines, !isLast]);
        }
      }
    };

    traverse(filteredData, 0, []);
    return nodes;
  }, [filteredData, expandedIds]);

  // Scroll selected into view when selection changes
  useLayoutEffect(() => {
    const currentSelectedId = selectedIds[0];

    // Skip on initial mount to avoid scrolling before user interaction
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      prevSelectedIdRef.current = currentSelectedId;
      return;
    }

    // Only scroll if selection actually changed
    if (currentSelectedId === prevSelectedIdRef.current) return;
    prevSelectedIdRef.current = currentSelectedId;

    if (!currentSelectedId || !containerRef.current) return;

    requestAnimationFrame(() => {
      if (!containerRef.current) return;
      const selectedEl = containerRef.current.querySelector('[data-selected="true"]');
      if (selectedEl) {
        selectedEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }, [selectedIds]);

  const handleToggleExpand = useCallback(
    (nodeId: string) => {
      if (expandedIds.includes(nodeId)) {
        onExpand(expandedIds.filter((id) => id !== nodeId));
      } else {
        onExpand([...expandedIds, nodeId]);
      }
    },
    [expandedIds, onExpand]
  );

  const handleNodeClick = useCallback(
    (node: TreeNode) => {
      const hasChildren = node.children && node.children.length > 0;

      if (hasChildren) {
        // Toggle expand/collapse for parent nodes
        handleToggleExpand(node.id);
      } else {
        // Select for leaf nodes (tables)
        onSelect([node.id]);
      }
    },
    [handleToggleExpand, onSelect]
  );

  return (
    <div ref={containerRef} className="overflow-auto" style={{ height }}>
      {visibleNodes.map(({ node, level, isLastChild, parentLines }) => (
        <div
          key={node.id}
          data-id={node.id}
          data-selected={selectedIds.includes(node.id) ? 'true' : undefined}
        >
          <TreeNodeComponent
            node={node}
            level={level}
            isSelected={selectedIds.includes(node.id)}
            isExpanded={expandedIds.includes(node.id)}
            searchTerm={searchTerm}
            onNodeClick={() => handleNodeClick(node)}
            itemHeight={itemHeight}
            isLastChild={isLastChild}
            parentLines={parentLines}
          />
        </div>
      ))}
    </div>
  );
}

export type { TreeNode };
