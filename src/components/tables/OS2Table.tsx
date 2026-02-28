import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

interface OS2TableData {
  version: number;
  x_avg_char_width: number;
  us_weight_class: number;
  us_width_class: number;
  fs_type: number;
  y_subscript_x_size: number;
  y_subscript_y_size: number;
  y_subscript_x_offset: number;
  y_subscript_y_offset: number;
  y_superscript_x_size: number;
  y_superscript_y_size: number;
  y_superscript_x_offset: number;
  y_superscript_y_offset: number;
  y_strikeout_size: number;
  y_strikeout_position: number;
  s_family_class: number;
}

function Field({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="space-y-1.5">
      <label className="text-muted-foreground text-sm font-medium">{label}</label>
      <Input defaultValue={String(value)} disabled className="opacity-60" />
    </div>
  );
}

function getWeightClassName(value: number): string {
  const weights: Record<number, string> = {
    100: 'Thin',
    200: 'Extra Light',
    300: 'Light',
    400: 'Normal',
    500: 'Medium',
    600: 'Semi Bold',
    700: 'Bold',
    800: 'Extra Bold',
    900: 'Black',
  };
  return weights[value] || 'Unknown';
}

function getWidthClassName(value: number): string {
  const widths: Record<number, string> = {
    1: 'Ultra Condensed',
    2: 'Extra Condensed',
    3: 'Condensed',
    4: 'Semi Condensed',
    5: 'Normal',
    6: 'Semi Expanded',
    7: 'Expanded',
    8: 'Extra Expanded',
    9: 'Ultra Expanded',
  };
  return widths[value] || 'Unknown';
}

export function OS2Table({ data }: { data: OS2TableData }) {
  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Version" value={data.version} />
          <Field label="Average Character Width" value={data.x_avg_char_width} />
        </div>

        <div>
          <h4 className="text-muted-foreground mb-3 text-sm font-medium">Weight &amp; Width</h4>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field
              label="Weight Class"
              value={`${data.us_weight_class} (${getWeightClassName(data.us_weight_class)})`}
            />
            <Field
              label="Width Class"
              value={`${data.us_width_class} (${getWidthClassName(data.us_width_class)})`}
            />
          </div>
        </div>

        <div>
          <h4 className="text-muted-foreground mb-3 text-sm font-medium">Subscript</h4>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="X Size" value={data.y_subscript_x_size} />
            <Field label="Y Size" value={data.y_subscript_y_size} />
            <Field label="X Offset" value={data.y_subscript_x_offset} />
            <Field label="Y Offset" value={data.y_subscript_y_offset} />
          </div>
        </div>

        <div>
          <h4 className="text-muted-foreground mb-3 text-sm font-medium">Superscript</h4>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="X Size" value={data.y_superscript_x_size} />
            <Field label="Y Size" value={data.y_superscript_y_size} />
            <Field label="X Offset" value={data.y_superscript_x_offset} />
            <Field label="Y Offset" value={data.y_superscript_y_offset} />
          </div>
        </div>

        <div>
          <h4 className="text-muted-foreground mb-3 text-sm font-medium">Strikeout</h4>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Size" value={data.y_strikeout_size} />
            <Field label="Position" value={data.y_strikeout_position} />
          </div>
        </div>

        <div>
          <h4 className="text-muted-foreground mb-3 text-sm font-medium">Miscellaneous</h4>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="FS Type" value={data.fs_type} />
            <Field label="Family Class" value={data.s_family_class} />
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
