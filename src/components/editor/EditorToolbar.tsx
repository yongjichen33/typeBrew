import {
  PenTool,
  MousePointer2,
  Scissors,
  Hand,
  Undo2,
  Redo2,
  Save,
  Loader2,
  Navigation,
  Hash,
  Grid3x3,
  Eye,
  EyeOff,
  Contrast,
} from 'lucide-react';
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
  showDirection: boolean;
  onSetShowDirection: (show: boolean) => void;
  showCoordinates: boolean;
  onSetShowCoordinates: (show: boolean) => void;
  showPixelGrid: boolean;
  onSetShowPixelGrid: (show: boolean) => void;
  showPreview: boolean;
  onSetShowPreview: (show: boolean) => void;
  previewInverted: boolean;
  onSetPreviewInverted: (inverted: boolean) => void;
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
        'flex h-8 w-8 items-center justify-center rounded transition-colors',
        active
          ? 'bg-foreground text-background'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        disabled ? 'cursor-not-allowed opacity-30' : 'cursor-pointer',
      ].join(' ')}
    >
      {icon}
    </button>
  );
}

function ToolDivider() {
  return <div className="bg-border mx-1 h-5 w-px" />;
}

function ToolGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center">{children}</div>;
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
  showDirection,
  onSetShowDirection,
  showCoordinates,
  onSetShowCoordinates,
  showPixelGrid,
  onSetShowPixelGrid,
  showPreview,
  onSetShowPreview,
  previewInverted,
  onSetPreviewInverted,
}: EditorToolbarProps) {
  return (
    <div className="bg-muted/30 flex shrink-0 items-center gap-2 border-b px-3 py-1">
      {/* Tool Palette */}
      <ToolGroup>
        <ToolButton
          icon={<MousePointer2 size={15} />}
          label="Select Tool (S) - Select and edit points"
          active={toolMode === 'node'}
          onClick={() => onSetMode('node')}
        />
        <ToolButton
          icon={<PenTool size={15} />}
          label="Pen Tool (P) - Draw Bezier curves"
          active={toolMode === 'pen'}
          onClick={() => onSetMode('pen')}
        />
        <ToolButton
          icon={<Scissors size={15} />}
          label="Knife (K) - Cut paths"
          active={toolMode === 'knife'}
          onClick={() => onSetMode('knife')}
        />
      </ToolGroup>

      <ToolDivider />

      {/* View toggles */}
      <ToolGroup>
        <ToolButton
          icon={<Navigation size={15} />}
          label="Show direction"
          active={showDirection}
          onClick={() => onSetShowDirection(!showDirection)}
        />
        <ToolButton
          icon={<Hash size={15} />}
          label="Show coordinates"
          active={showCoordinates}
          onClick={() => onSetShowCoordinates(!showCoordinates)}
        />
        <ToolButton
          icon={<Grid3x3 size={15} />}
          label="Show pixel grid"
          active={showPixelGrid}
          onClick={() => onSetShowPixelGrid(!showPixelGrid)}
        />
        <ToolButton
          icon={showPreview ? <Eye size={15} /> : <EyeOff size={15} />}
          label={showPreview ? 'Hide preview' : 'Show preview'}
          active={showPreview}
          onClick={() => onSetShowPreview(!showPreview)}
        />
        {showPreview && (
          <ToolButton
            icon={<Contrast size={15} />}
            label={previewInverted ? 'White on black' : 'Black on white'}
            active={previewInverted}
            onClick={() => onSetPreviewInverted(!previewInverted)}
          />
        )}
      </ToolGroup>

      <ToolDivider />

      {/* Hand tool */}
      <ToolGroup>
        <ToolButton
          icon={<Hand size={15} />}
          label="Hand (H) - Pan view"
          active={toolMode === 'hand'}
          onClick={() => onSetMode('hand')}
        />
      </ToolGroup>

      <ToolDivider />

      {/* Undo / Redo */}
      <ToolGroup>
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
      </ToolGroup>

      <div className="flex-1" />

      {/* Save */}
      <button
        title="Save glyph"
        disabled={!isDirty || isSaving}
        onClick={onSave}
        className={[
          'flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors',
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
