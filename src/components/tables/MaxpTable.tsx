import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

interface MaxpTableData {
  version: string;
  num_glyphs: number;
}

function Field({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-muted-foreground">{label}</label>
      <Input defaultValue={String(value)} />
    </div>
  );
}

export function MaxpTable({ data }: { data: MaxpTableData }) {
  return (
    <ScrollArea className="h-[calc(100vh-320px)]">
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Version" value={data.version} />
          <Field label="Number of Glyphs" value={data.num_glyphs} />
        </div>
      </div>
    </ScrollArea>
  );
}
