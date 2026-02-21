import { MousePointer2, Pen, Undo2, Redo2, Save, Loader2 } from 'lucide-react';
import type { ToolMode } from '@/lib/editorTypes';

interface EditorToolbarProps {
  toolMode: ToolMode;
  onSetMode: (mode: ToolMode) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  isDirty: boolean;
  isSaving: boolean;
  onSave: () => void;
}

function ToolButton({
  icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={[
        'flex items-center justify-center w-8 h-8 rounded transition-colors',
        active
          ? 'bg-foreground text-background'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer',
      ].join(' ')}
    >
      {icon}
    </button>
  );
}

export function EditorToolbar({
  toolMode,
  onSetMode,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  isDirty,
  isSaving,
  onSave,
}: EditorToolbarProps) {
  return (
    <div className="flex items-center gap-1 px-3 py-1 border-b bg-muted/30 shrink-0">
      {/* Mode buttons */}
      <ToolButton
        icon={<MousePointer2 size={15} />}
        label="Select (V)"
        active={toolMode === 'select'}
        onClick={() => onSetMode('select')}
      />
      <ToolButton
        icon={<Pen size={15} />}
        label="Draw (P)"
        active={toolMode === 'draw'}
        onClick={() => onSetMode('draw')}
      />

      <div className="w-px h-5 bg-border mx-1" />

      {/* Undo / Redo */}
      <ToolButton
        icon={<Undo2 size={15} />}
        label="Undo (Ctrl+Z)"
        disabled={!canUndo}
        onClick={onUndo}
      />
      <ToolButton
        icon={<Redo2 size={15} />}
        label="Redo (Ctrl+Shift+Z)"
        disabled={!canRedo}
        onClick={onRedo}
      />

      <div className="flex-1" />

      {/* Save */}
      <button
        title="Save glyph"
        disabled={!isDirty || isSaving}
        onClick={onSave}
        className={[
          'flex items-center gap-1.5 px-2.5 h-7 rounded text-xs font-medium transition-colors',
          isDirty && !isSaving
            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'bg-muted text-muted-foreground cursor-not-allowed opacity-50',
        ].join(' ')}
      >
        {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
        {isSaving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
