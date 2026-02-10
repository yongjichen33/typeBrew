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
      <label className="text-sm font-medium text-muted-foreground">{label}</label>
      <Input defaultValue={String(value)} />
    </div>
  );
}

export function PostTable({ data }: { data: PostTableData }) {
  return (
    <ScrollArea className="h-[calc(100vh-320px)]">
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Version" value={data.version} />
          <Field label="Is Fixed Pitch" value={data.is_fixed_pitch ? 'Yes' : 'No'} />
        </div>

        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-3">Italic</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Italic Angle" value={data.italic_angle} />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-3">Underline</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Underline Position" value={data.underline_position} />
            <Field label="Underline Thickness" value={data.underline_thickness} />
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
