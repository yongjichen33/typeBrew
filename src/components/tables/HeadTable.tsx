import { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { Loader2, Save, RotateCcw } from 'lucide-react';

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

interface HeadTableProps {
  data: HeadTableData;
  filePath: string;
  onSaved: () => void;
}

const EDITABLE_KEYS = [
  'font_revision', 'flags', 'units_per_em', 'created', 'modified',
  'x_min', 'y_min', 'x_max', 'y_max', 'mac_style', 'lowest_rec_ppem',
  'font_direction_hint', 'index_to_loc_format',
] as const;

type EditableKey = typeof EDITABLE_KEYS[number];
type EditValues = Record<EditableKey, string>;

function toEditValues(data: HeadTableData): EditValues {
  const values = {} as EditValues;
  for (const key of EDITABLE_KEYS) {
    values[key] = String(data[key]);
  }
  return values;
}

function ReadOnlyField({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-muted-foreground">{label}</label>
      <Input value={String(value)} disabled className="opacity-60" />
    </div>
  );
}

function EditableField({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-muted-foreground">{label}</label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function HeadTable({ data, filePath, onSaved }: HeadTableProps) {
  const [values, setValues] = useState(() => toEditValues(data));
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setValues(toEditValues(data));
  }, [data]);

  const isDirty = useMemo(() => {
    const original = toEditValues(data);
    return EDITABLE_KEYS.some(key => values[key] !== original[key]);
  }, [values, data]);

  const update = (field: EditableKey) => (value: string) => {
    setValues(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await invoke('update_head_table', {
        filePath,
        updates: {
          font_revision: parseFloat(values.font_revision) || 0,
          flags: parseInt(values.flags) || 0,
          units_per_em: parseInt(values.units_per_em) || 0,
          created: parseInt(values.created) || 0,
          modified: parseInt(values.modified) || 0,
          x_min: parseInt(values.x_min) || 0,
          y_min: parseInt(values.y_min) || 0,
          x_max: parseInt(values.x_max) || 0,
          y_max: parseInt(values.y_max) || 0,
          mac_style: parseInt(values.mac_style) || 0,
          lowest_rec_ppem: parseInt(values.lowest_rec_ppem) || 0,
          font_direction_hint: parseInt(values.font_direction_hint) || 0,
          index_to_loc_format: parseInt(values.index_to_loc_format) || 0,
        },
      });
      toast.success('Head table updated successfully');
      onSaved();
    } catch (error) {
      toast.error(`Failed to update head table: ${error}`);
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
        <div className="sticky top-0 z-10 flex items-center justify-end gap-2 border-b bg-background/95 backdrop-blur px-6 py-3">
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
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ReadOnlyField label="Version" value={data.version} />
          <EditableField label="Font Revision" value={values.font_revision} onChange={update('font_revision')} />
          <EditableField label="Units Per Em" value={values.units_per_em} onChange={update('units_per_em')} />
          <ReadOnlyField label="Magic Number" value={`0x${data.magic_number.toString(16).toUpperCase()}`} />
          <EditableField label="Flags" value={values.flags} onChange={update('flags')} />
          <EditableField label="Mac Style" value={values.mac_style} onChange={update('mac_style')} />
          <ReadOnlyField label="Checksum Adjustment" value={data.checksum_adjustment} />
          <EditableField label="Lowest Rec PPEM" value={values.lowest_rec_ppem} onChange={update('lowest_rec_ppem')} />
        </div>

        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-3">Bounding Box</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <EditableField label="xMin" value={values.x_min} onChange={update('x_min')} />
            <EditableField label="yMin" value={values.y_min} onChange={update('y_min')} />
            <EditableField label="xMax" value={values.x_max} onChange={update('x_max')} />
            <EditableField label="yMax" value={values.y_max} onChange={update('y_max')} />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-3">Timestamps</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditableField label="Created" value={values.created} onChange={update('created')} />
            <EditableField label="Modified" value={values.modified} onChange={update('modified')} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <EditableField label="Font Direction Hint" value={values.font_direction_hint} onChange={update('font_direction_hint')} />
          <EditableField label="Index to Loc Format" value={values.index_to_loc_format} onChange={update('index_to_loc_format')} />
          <ReadOnlyField label="Glyph Data Format" value={data.glyph_data_format} />
        </div>
      </div>
    </ScrollArea>
  );
}
