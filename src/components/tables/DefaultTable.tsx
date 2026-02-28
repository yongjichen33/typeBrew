import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

interface DefaultTableProps {
  tableName: string;
  data: Record<string, unknown>;
}

export function DefaultTable({ tableName, data }: DefaultTableProps) {
  const sizeBytes = typeof data.size_bytes === 'number' ? data.size_bytes : null;

  return (
    <ScrollArea className="h-full">
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3">
        <Badge variant="outline" className="font-mono text-sm">
          {tableName}
        </Badge>
        {sizeBytes !== null && <p className="text-sm">{sizeBytes.toLocaleString()} bytes</p>}
        <p className="text-sm">Specialized viewer not yet implemented for this table type.</p>
      </div>
    </ScrollArea>
  );
}
