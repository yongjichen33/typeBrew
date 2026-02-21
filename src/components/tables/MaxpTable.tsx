import { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { Loader2, Save, RotateCcw } from 'lucide-react';

interface MaxpTableData {
  version: string;
  num_glyphs: number;
}

interface MaxpTableProps {
  data: MaxpTableData;
  filePath: string;
  onSaved: () => void;
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

export function MaxpTable({ data, filePath, onSaved }: MaxpTableProps) {
  const [numGlyphs, setNumGlyphs] = useState(String(data.num_glyphs));
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setNumGlyphs(String(data.num_glyphs));
  }, [data]);

  const isDirty = useMemo(() => {
    return numGlyphs !== String(data.num_glyphs);
  }, [numGlyphs, data]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await invoke('update_maxp_table', {
        filePath,
        updates: {
          num_glyphs: parseInt(numGlyphs) || 0,
        },
      });
      toast.success('Maxp table updated successfully');
      onSaved();
    } catch (error) {
      toast.error(`Failed to update maxp table: ${error}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setNumGlyphs(String(data.num_glyphs));
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
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ReadOnlyField label="Version" value={data.version} />
          <EditableField label="Number of Glyphs" value={numGlyphs} onChange={setNumGlyphs} />
        </div>
      </div>
    </ScrollArea>
  );
}
