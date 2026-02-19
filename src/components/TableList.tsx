import { useState, useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ChevronRight, ChevronDown } from 'lucide-react';
import type { FontMetadata } from '@/types/font';

interface TableListProps {
  fonts: FontMetadata[];
  selectedFilePath: string | null;
  selectedTable: string | null;
  searchQuery: string;
  onSelectTable: (filePath: string, table: string) => void;
}

export function TableList({
  fonts,
  selectedFilePath,
  selectedTable,
  searchQuery,
  onSelectTable,
}: TableListProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    new Set(fonts.map(f => f.file_path))
  );
  const prevFontCount = useRef(fonts.length);

  // Auto-expand newly added fonts
  useEffect(() => {
    if (fonts.length > prevFontCount.current) {
      setExpanded(prev => {
        const next = new Set(prev);
        for (const f of fonts) {
          next.add(f.file_path);
        }
        return next;
      });
    }
    prevFontCount.current = fonts.length;
  }, [fonts]);

  const toggleExpand = (filePath: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  };

  const query = searchQuery.toLowerCase();

  return (
    <ScrollArea className="h-[calc(100vh-320px)]">
      <div className="p-2">
        {fonts.map(font => {
          const filteredTables = query
            ? font.available_tables.filter(t => t.toLowerCase().includes(query))
            : font.available_tables;

          if (query && filteredTables.length === 0) return null;

          const isExpanded = expanded.has(font.file_path);
          const isFontSelected = font.file_path === selectedFilePath;

          return (
            <div key={font.file_path}>
              <button
                onClick={() => toggleExpand(font.file_path)}
                className={cn(
                  'w-full flex items-center gap-1.5 px-2 py-2 rounded-md text-sm font-medium transition-colors',
                  isFontSelected ? 'bg-muted' : 'hover:bg-muted/50'
                )}
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{font.file_name}</span>
                <Badge variant="outline" className="ml-auto text-xs shrink-0">
                  {filteredTables.length}
                </Badge>
              </button>

              {isExpanded && (
                <div className="ml-4">
                  {filteredTables.map(table => (
                    <button
                      key={table}
                      onClick={() => onSelectTable(font.file_path, table)}
                      className={cn(
                        'w-full text-left px-4 py-1.5 rounded-md transition-colors font-mono text-sm',
                        isFontSelected && selectedTable === table
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-muted'
                      )}
                    >
                      {table}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {fonts.length === 0 && (
          <p className="text-center text-muted-foreground py-8">
            No fonts opened
          </p>
        )}
      </div>
    </ScrollArea>
  );
}
