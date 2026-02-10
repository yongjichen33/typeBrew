import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

interface HeadTableData {
  version: string;
  font_revision: number;
  checksum_adjustment: number;
  magic_number: number;
  flags: number;
  units_per_em: number;
  created: number;
  modified: number;
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
  mac_style: number;
  lowest_rec_ppem: number;
  font_direction_hint: number;
  index_to_loc_format: number;
  glyph_data_format: number;
}

function Field({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-muted-foreground">{label}</label>
      <Input defaultValue={String(value)} />
    </div>
  );
}

export function HeadTable({ data }: { data: HeadTableData }) {
  return (
    <ScrollArea className="h-[calc(100vh-320px)]">
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Version" value={data.version} />
          <Field label="Font Revision" value={data.font_revision} />
          <Field label="Units Per Em" value={data.units_per_em} />
          <Field label="Magic Number" value={`0x${data.magic_number.toString(16).toUpperCase()}`} />
          <Field label="Flags" value={data.flags} />
          <Field label="Mac Style" value={data.mac_style} />
          <Field label="Checksum Adjustment" value={data.checksum_adjustment} />
          <Field label="Lowest Rec PPEM" value={data.lowest_rec_ppem} />
        </div>

        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-3">Bounding Box</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="xMin" value={data.x_min} />
            <Field label="yMin" value={data.y_min} />
            <Field label="xMax" value={data.x_max} />
            <Field label="yMax" value={data.y_max} />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-3">Timestamps</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Created" value={data.created} />
            <Field label="Modified" value={data.modified} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Font Direction Hint" value={data.font_direction_hint} />
          <Field label="Index to Loc Format" value={data.index_to_loc_format} />
          <Field label="Glyph Data Format" value={data.glyph_data_format} />
        </div>
      </div>
    </ScrollArea>
  );
}
