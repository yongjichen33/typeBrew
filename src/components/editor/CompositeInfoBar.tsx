import { Lock } from 'lucide-react';

interface CompositeInfoBarProps {
  componentGlyphIds: number[];
  onOpenComponent: (glyphId: number) => void;
}

export function CompositeInfoBar({ componentGlyphIds, onOpenComponent }: CompositeInfoBarProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-1.5 border-b bg-amber-50 shrink-0 text-sm">
      <div className="flex items-center gap-1.5 text-amber-700 font-medium shrink-0">
        <Lock className="h-3.5 w-3.5" />
        <span>Read-only composite glyph</span>
      </div>
      {componentGlyphIds.length > 0 && (
        <>
          <span className="text-amber-600 shrink-0">Components:</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {componentGlyphIds.map((id) => (
              <button
                key={id}
                onClick={() => onOpenComponent(id)}
                className="px-2 py-0.5 rounded border border-amber-300 bg-white text-amber-800 hover:bg-amber-100 hover:border-amber-400 transition-colors font-mono text-xs cursor-pointer"
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
