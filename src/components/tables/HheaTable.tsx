import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

interface HheaTableData {
  version: string;
  ascender: number;
  descender: number;
  line_gap: number;
  advance_width_max: number;
  min_left_side_bearing: number;
  min_right_side_bearing: number;
  x_max_extent: number;
  caret_slope_rise: number;
  caret_slope_run: number;
  caret_offset: number;
  number_of_hmetrics: number;
}

function Field({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-muted-foreground">{label}</label>
      <Input defaultValue={String(value)} />
    </div>
  );
}

export function HheaTable({ data }: { data: HheaTableData }) {
  return (
    <ScrollArea className="h-[calc(100vh-320px)]">
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Version" value={data.version} />
          <Field label="Number of HMetrics" value={data.number_of_hmetrics} />
        </div>

        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-3">Vertical Metrics</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Ascender" value={data.ascender} />
            <Field label="Descender" value={data.descender} />
            <Field label="Line Gap" value={data.line_gap} />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-3">Horizontal Extents</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Advance Width Max" value={data.advance_width_max} />
            <Field label="Min Left Side Bearing" value={data.min_left_side_bearing} />
            <Field label="Min Right Side Bearing" value={data.min_right_side_bearing} />
            <Field label="xMax Extent" value={data.x_max_extent} />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-3">Caret</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Caret Slope Rise" value={data.caret_slope_rise} />
            <Field label="Caret Slope Run" value={data.caret_slope_run} />
            <Field label="Caret Offset" value={data.caret_offset} />
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
