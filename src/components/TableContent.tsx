import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';

interface TableContentProps {
  data: string | null;
  isLoading: boolean;
  tableName: string | null;
}

export function TableContent({ data, isLoading, tableName }: TableContentProps) {
  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    );
  }

  if (!tableName) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-320px)] text-muted-foreground">
        Select a table to view its contents
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-320px)] text-muted-foreground">
        No data available
      </div>
    );
  }

  // Parse and check if it's outline data
  let parsed: any;
  try {
    parsed = JSON.parse(data);
  } catch {
    parsed = null;
  }

  // Render outline glyphs if this is an outline table
  if (parsed && parsed.type === 'outline' && parsed.glyphs) {
    return (
      <ScrollArea className="h-[calc(100vh-320px)]">
        <div className="p-6">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-muted-foreground">
              Showing {parsed.num_glyphs} glyphs
            </h3>
          </div>
          <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
            {parsed.glyphs.map((glyph: any) => {
              const bounds = glyph.bounds;
              const padding = 50;
              const viewBox = bounds
                ? `${bounds.x_min - padding} ${-bounds.y_max - padding} ${bounds.x_max - bounds.x_min + padding * 2} ${bounds.y_max - bounds.y_min + padding * 2}`
                : `0 ${-parsed.units_per_em} ${parsed.units_per_em} ${parsed.units_per_em}`;
              return (
              <div
                key={glyph.glyph_id}
                className="flex flex-col items-center p-3 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <svg
                  viewBox={viewBox}
                  className="w-full h-20 mb-2"
                >
                  <path
                    d={glyph.svg_path}
                    fill="currentColor"
                    className="text-foreground"
                  />
                </svg>
                <div className="text-center">
                  <div className="text-xs font-mono text-muted-foreground">
                    #{glyph.glyph_id}
                  </div>
                  {glyph.glyph_name && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {glyph.glyph_name}
                    </div>
                  )}
                </div>
              </div>
            );
            })}
          </div>
        </div>
      </ScrollArea>
    );
  }

  // Otherwise show JSON
  const formattedJson = parsed
    ? JSON.stringify(parsed, null, 2)
    : data;

  return (
    <ScrollArea className="h-[calc(100vh-320px)]">
      <SyntaxHighlighter
        language="json"
        style={oneDark}
        customStyle={{
          margin: 0,
          borderRadius: 0,
          background: 'transparent',
          fontSize: '0.875rem',
        }}
        showLineNumbers
      >
        {formattedJson}
      </SyntaxHighlighter>
    </ScrollArea>
  );
}
