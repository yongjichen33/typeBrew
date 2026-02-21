import { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Loader2, Save, RotateCcw } from 'lucide-react';

interface NameRecord {
  name_id: number;
  platform_id: string;
  value: string;
}

interface NameTableData {
  name_records: NameRecord[];
}

interface NameTableProps {
  data: NameTableData;
  filePath: string;
  onSaved: () => void;
}

const NAME_ID_LABELS: Record<number, string> = {
  0: 'Copyright',
  1: 'Font Family',
  2: 'Font Subfamily',
  3: 'Unique Identifier',
  4: 'Full Name',
  5: 'Version String',
  6: 'PostScript Name',
  7: 'Trademark',
  8: 'Manufacturer',
  9: 'Designer',
  10: 'Description',
  11: 'Vendor URL',
  12: 'Designer URL',
  13: 'License',
  14: 'License URL',
  16: 'Typographic Family',
  17: 'Typographic Subfamily',
};

export function NameTable({ data, filePath, onSaved }: NameTableProps) {
  const [values, setValues] = useState<Record<number, Record<number, string>>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const newValues: Record<number, Record<number, string>> = {};
    for (const record of data.name_records) {
      const platformId = parseInt(record.platform_id);
      if (!newValues[record.name_id]) {
        newValues[record.name_id] = {};
      }
      newValues[record.name_id][platformId] = record.value;
    }
    setValues(newValues);
  }, [data]);

  const originalValues = useMemo(() => {
    const orig: Record<number, Record<number, string>> = {};
    for (const record of data.name_records) {
      const platformId = parseInt(record.platform_id);
      if (!orig[record.name_id]) {
        orig[record.name_id] = {};
      }
      orig[record.name_id][platformId] = record.value;
    }
    return orig;
  }, [data]);

  const isDirty = useMemo(() => {
    for (const nameId of Object.keys(originalValues)) {
      for (const platformId of Object.keys(originalValues[parseInt(nameId)])) {
        const orig = originalValues[parseInt(nameId)][parseInt(platformId)];
        const current = values[parseInt(nameId)]?.[parseInt(platformId)];
        if (current !== orig) {
          return true;
        }
      }
    }
    return false;
  }, [values, originalValues]);

  const handleChange = (nameId: number, platformId: number, value: string) => {
    setValues((prev) => ({
      ...prev,
      [nameId]: {
        ...(prev[nameId] || {}),
        [platformId]: value,
      },
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      for (const nameId of Object.keys(originalValues)) {
        for (const platformId of Object.keys(originalValues[parseInt(nameId)])) {
          const orig = originalValues[parseInt(nameId)][parseInt(platformId)];
          const current = values[parseInt(nameId)]?.[parseInt(platformId)];
          if (current !== orig && current !== undefined) {
            await invoke('update_name_table', {
              filePath,
              updates: {
                name_id: parseInt(nameId),
                platform_id: parseInt(platformId),
                value: current,
              },
            });
          }
        }
      }
      toast.success('Name table updated successfully');
      onSaved();
    } catch (error) {
      toast.error(`Failed to update name table: ${error}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setValues(originalValues);
  };

  if (!data.name_records?.length) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No name records available
      </div>
    );
  }

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
      <div className="p-6 space-y-3">
        {data.name_records.map((record, i) => {
          const platformId = parseInt(record.platform_id);
          const value = values[record.name_id]?.[platformId] ?? record.value;
          return (
            <div key={i}>
              <div className="flex items-center gap-2 mb-1.5">
                <Badge variant="outline" className="font-mono text-xs">
                  {record.name_id}
                </Badge>
                <span className="text-sm font-medium text-muted-foreground">
                  {NAME_ID_LABELS[record.name_id] ?? `Name ID ${record.name_id}`}
                </span>
                <Badge variant="secondary" className="text-xs ml-auto">
                  {record.platform_id}
                </Badge>
              </div>
              <Input
                value={value}
                onChange={(e) => handleChange(record.name_id, platformId, e.target.value)}
              />
              {i < data.name_records.length - 1 && <Separator className="mt-3" />}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
