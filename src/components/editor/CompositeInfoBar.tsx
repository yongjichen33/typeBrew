import { Lock } from 'lucide-react';

interface CompositeInfoBarProps {
  componentGlyphIds: number[];
  onOpenComponent: (glyphId: number) => void;
}

export function CompositeInfoBar({ componentGlyphIds, onOpenComponent }: CompositeInfoBarProps) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b bg-amber-50 px-4 py-1.5 text-sm">
      <div className="flex shrink-0 items-center gap-1.5 font-medium text-amber-700">
        <Lock className="h-3.5 w-3.5" />
        <span>Read-only composite glyph</span>
      </div>
      {componentGlyphIds.length > 0 && (
        <>
          <span className="shrink-0 text-amber-600">Components:</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {componentGlyphIds.map((id) => (
              <button
                key={id}
                onClick={() => onOpenComponent(id)}
                className="cursor-pointer rounded border border-amber-300 bg-white px-2 py-0.5 font-mono text-xs text-amber-800 transition-colors hover:border-amber-400 hover:bg-amber-100"
              >
                Glyph {id}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
