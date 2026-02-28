import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

interface PostTableData {
  version: string;
  italic_angle: number;
  underline_position: number;
  underline_thickness: number;
  is_fixed_pitch: boolean;
}

function Field({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="space-y-1.5">
      <label className="text-muted-foreground text-sm font-medium">{label}</label>
      <Input defaultValue={String(value)} />
    </div>
  );
}

export function PostTable({ data }: { data: PostTableData }) {
  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Version" value={data.version} />
          <Field label="Is Fixed Pitch" value={data.is_fixed_pitch ? 'Yes' : 'No'} />
        </div>

        <div>
          <h4 className="text-muted-foreground mb-3 text-sm font-medium">Italic</h4>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Italic Angle" value={data.italic_angle} />
          </div>
        </div>

        <div>
          <h4 className="text-muted-foreground mb-3 text-sm font-medium">Underline</h4>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Underline Position" value={data.underline_position} />
            <Field label="Underline Thickness" value={data.underline_thickness} />
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
