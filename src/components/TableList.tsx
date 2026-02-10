import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface TableListProps {
  tables: string[];
  selectedTable: string | null;
  onSelectTable: (table: string) => void;
}

export function TableList({ tables, selectedTable, onSelectTable }: TableListProps) {
  return (
    <ScrollArea className="h-[calc(100vh-320px)]">
      <div className="p-2">
        {tables.map((table) => (
          <button
            key={table}
            onClick={() => onSelectTable(table)}
            className={cn(
              "w-full text-left px-4 py-2 rounded-md transition-colors font-mono text-sm",
              selectedTable === table
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted"
            )}
          >
            {table}
          </button>
        ))}
        {tables.length === 0 && (
          <p className="text-center text-muted-foreground py-8">
            No tables found
          </p>
        )}
      </div>
    </ScrollArea>
  );
}
