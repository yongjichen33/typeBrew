import { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { Loader2, Save, RotateCcw } from 'lucide-react';

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

interface HheaTableProps {
  data: HheaTableData;
  filePath: string;
  onSaved: () => void;
}

const EDITABLE_KEYS = [
  'ascender',
  'descender',
  'line_gap',
  'caret_slope_rise',
  'caret_slope_run',
  'caret_offset',
] as const;

type EditableKey = (typeof EDITABLE_KEYS)[number];
type EditValues = Record<EditableKey, string>;

function toEditValues(data: HheaTableData): EditValues {
  const values = {} as EditValues;
  for (const key of EDITABLE_KEYS) {
    values[key] = String(data[key]);
  }
  return values;
}

function ReadOnlyField({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="space-y-1.5">
      <label className="text-muted-foreground text-sm font-medium">{label}</label>
      <Input value={String(value)} disabled className="opacity-60" />
    </div>
  );
}

function EditableField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-muted-foreground text-sm font-medium">{label}</label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function HheaTable({ data, filePath, onSaved }: HheaTableProps) {
  const [values, setValues] = useState(() => toEditValues(data));
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setValues(toEditValues(data));
  }, [data]);

  const isDirty = useMemo(() => {
    const original = toEditValues(data);
    return EDITABLE_KEYS.some((key) => values[key] !== original[key]);
  }, [values, data]);

  const update = (field: EditableKey) => (value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await invoke('update_hhea_table', {
        filePath,
        updates: {
          ascender: parseInt(values.ascender) || 0,
          descender: parseInt(values.descender) || 0,
          line_gap: parseInt(values.line_gap) || 0,
          caret_slope_rise: parseInt(values.caret_slope_rise) || 0,
          caret_slope_run: parseInt(values.caret_slope_run) || 0,
          caret_offset: parseInt(values.caret_offset) || 0,
        },
      });
      toast.success('Hhea table updated successfully');
      onSaved();
    } catch (error) {
      toast.error(`Failed to update hhea table: ${error}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setValues(toEditValues(data));
  };

  return (
    <ScrollArea className="h-full">
      {isDirty && (
        <div className="bg-background/95 sticky top-0 z-10 flex items-center justify-end gap-2 border-b px-6 py-3 backdrop-blur">
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="mr-2 h-3 w-3" />
            Reset
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
            ) : (
              <Save className="mr-2 h-3 w-3" />
            )}
            Save Changes
          </Button>
        </div>
      )}
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ReadOnlyField label="Version" value={data.version} />
          <ReadOnlyField label="Number of HMetrics" value={data.number_of_hmetrics} />
        </div>

        <div>
          <h4 className="text-muted-foreground mb-3 text-sm font-medium">Vertical Metrics</h4>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <EditableField label="Ascender" value={values.ascender} onChange={update('ascender')} />
            <EditableField
              label="Descender"
              value={values.descender}
              onChange={update('descender')}
            />
            <EditableField label="Line Gap" value={values.line_gap} onChange={update('line_gap')} />
          </div>
        </div>

        <div>
          <h4 className="text-muted-foreground mb-3 text-sm font-medium">Horizontal Extents</h4>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <ReadOnlyField label="Advance Width Max" value={data.advance_width_max} />
            <ReadOnlyField label="Min Left Side Bearing" value={data.min_left_side_bearing} />
            <ReadOnlyField label="Min Right Side Bearing" value={data.min_right_side_bearing} />
            <ReadOnlyField label="xMax Extent" value={data.x_max_extent} />
          </div>
        </div>

        <div>
          <h4 className="text-muted-foreground mb-3 text-sm font-medium">Caret</h4>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <EditableField
              label="Caret Slope Rise"
              value={values.caret_slope_rise}
              onChange={update('caret_slope_rise')}
            />
            <EditableField
              label="Caret Slope Run"
              value={values.caret_slope_run}
              onChange={update('caret_slope_run')}
            />
            <EditableField
              label="Caret Offset"
              value={values.caret_offset}
              onChange={update('caret_offset')}
            />
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
