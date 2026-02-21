import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Loader2, Save } from 'lucide-react';

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

interface EditableRecord extends NameRecord {
  editedValue: string;
  isSaving: boolean;
  isDirty: boolean;
}

export function NameTable({ data, filePath, onSaved }: NameTableProps) {
  const [records, setRecords] = useState<EditableRecord[]>([]);

  useEffect(() => {
    const editable = data.name_records.map((r) => ({
      ...r,
      editedValue: r.value,
      isSaving: false,
      isDirty: false,
    }));
    setRecords(editable);
  }, [data]);

  const handleChange = (index: number, value: string) => {
    setRecords((prev) =>
      prev.map((r, i) =>
        i === index
          ? { ...r, editedValue: value, isDirty: value !== r.value }
          : r
      )
    );
  };

  const handleSave = async (index: number) => {
    const record = records[index];
    if (!record.isDirty) return;

    setRecords((prev) =>
      prev.map((r, i) => (i === index ? { ...r, isSaving: true } : r))
    );

    try {
      await invoke('update_name_table', {
        filePath,
        updates: {
          name_id: record.name_id,
          platform_id: parseInt(record.platform_id),
          value: record.editedValue,
        },
      });
      toast.success('Name record updated successfully');
      setRecords((prev) =>
        prev.map((r, i) =>
          i === index
            ? { ...r, value: r.editedValue, isDirty: false, isSaving: false }
            : r
        )
      );
      onSaved();
    } catch (error) {
      toast.error(`Failed to update name record: ${error}`);
      setRecords((prev) =>
        prev.map((r, i) => (i === index ? { ...r, isSaving: false } : r))
      );
    }
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
      <div className="p-6 space-y-3">
        {records.map((record, i) => (
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
            <div className="flex gap-2">
              <Input
                value={record.editedValue}
                onChange={(e) => handleChange(i, e.target.value)}
                className={record.isDirty ? 'border-primary' : ''}
              />
              {record.isDirty && (
                <Button
                  size="sm"
                  onClick={() => handleSave(i)}
                  disabled={record.isSaving}
                >
                  {record.isSaving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Save className="h-3 w-3" />
                  )}
                </Button>
              )}
            </div>
            {i < records.length - 1 && <Separator className="mt-3" />}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
