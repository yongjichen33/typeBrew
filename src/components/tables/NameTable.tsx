import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

interface NameRecord {
  name_id: number;
  platform_id: string;
  value: string;
}

interface NameTableData {
  name_records: NameRecord[];
}

const NAME_ID_LABELS: Record<number, string> = {
  0: 'Copyright',
  1: 'Font Family',
  2: 'Font Subfamily',
  3: 'Unique Identifier',
  4: 'Full Name',
  5: 'Version String',
  6: 'PostScript Name',
  7: 'Trademark',
  8: 'Manufacturer',
  9: 'Designer',
  10: 'Description',
  11: 'Vendor URL',
  12: 'Designer URL',
  13: 'License',
  14: 'License URL',
  16: 'Typographic Family',
  17: 'Typographic Subfamily',
};

export function NameTable({ data }: { data: NameTableData }) {
  if (!data.name_records?.length) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-320px)] text-muted-foreground">
        No name records available
      </div>
    );
  }

  return (
    <ScrollArea className="h-[calc(100vh-320px)]">
      <div className="p-6 space-y-3">
        {data.name_records.map((record, i) => (
          <div key={i}>
            <div className="flex items-center gap-2 mb-1.5">
              <Badge variant="outline" className="font-mono text-xs">
                {record.name_id}
              </Badge>
              <span className="text-sm font-medium text-muted-foreground">
                {NAME_ID_LABELS[record.name_id] ?? `Name ID ${record.name_id}`}
              </span>
              <Badge variant="secondary" className="text-xs ml-auto">
                {record.platform_id}
              </Badge>
            </div>
            <Input defaultValue={record.value} />
            {i < data.name_records.length - 1 && <Separator className="mt-3" />}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
