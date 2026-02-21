import { ScrollArea } from '@/components/ui/scroll-area';

interface LocaEntry {
  glyph_id: number;
  offset: number;
  length: number;
}

interface LocaTableData {
  format: string;
  num_glyphs: number;
  entries: LocaEntry[];
}

export function LocaTable({ data }: { data: LocaTableData }) {
  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">Format:</span>
          <span className="font-medium">{data.format}</span>
          <span className="text-muted-foreground">Total Glyphs:</span>
          <span className="font-medium">{data.num_glyphs}</span>
        </div>

        <div className="border rounded-md">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground w-24">
                  Glyph ID
                </th>
                <th className="text-right px-4 py-2 font-medium text-muted-foreground">
                  Offset
                </th>
                <th className="text-right px-4 py-2 font-medium text-muted-foreground">
                  Length
                </th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((entry) => (
                <tr
                  key={entry.glyph_id}
                  className="border-t hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-1.5 font-mono text-muted-foreground">
                    {entry.glyph_id}
                  </td>
                  <td className="px-4 py-1.5 text-right font-mono">
                    {entry.offset}
                  </td>
                  <td className="px-4 py-1.5 text-right font-mono">
                    {entry.length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </ScrollArea>
  );
}
