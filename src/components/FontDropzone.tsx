import { useEffect, useState } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload } from 'lucide-react';
import { useFileUpload } from '@/hooks/useFileUpload';

export function FontDropzone() {
  const [isDragging, setIsDragging] = useState(false);
  const { uploadFont, handleFileDialog, isUploading } = useFileUpload();

  useEffect(() => {
    const webview = getCurrentWebviewWindow();

    const unlistenHover = webview.onDragDropEvent((event) => {
      if (event.payload.type === 'over') {
        setIsDragging(true);
      } else if (event.payload.type === 'drop') {
        setIsDragging(false);
        const paths = event.payload.paths;

        paths.forEach((filePath) => {
          const fileName = filePath.split(/[\\/]/).pop() || '';
          uploadFont(filePath, fileName);
        });
      } else if (event.payload.type === 'leave') {
        setIsDragging(false);
      }
    });

    return () => {
      unlistenHover.then(fn => fn());
    };
  }, [uploadFont]);

  return (
    <div className="w-full max-w-2xl mx-auto p-6 space-y-6">
      <Card
        className={`
          relative overflow-hidden transition-all duration-200
          ${isDragging ? 'border-primary border-2 bg-primary/5' : 'border-dashed border-2'}
          ${isUploading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        <div className="p-12 flex flex-col items-center justify-center space-y-4">
          <div className="rounded-full bg-primary/10 p-6">
            <Upload className="h-12 w-12 text-primary" />
          </div>

          <div className="text-center space-y-2">
            <h3 className="text-xl font-semibold">
              {isDragging ? 'Drop your fonts here' : 'Upload font files'}
            </h3>
            <p className="text-sm text-muted-foreground">
              Drag and drop .otf or .ttf files here, or click to browse
            </p>
          </div>

          <Button
            onClick={handleFileDialog}
            disabled={isUploading}
            size="lg"
          >
            <Upload className="mr-2 h-4 w-4" />
            {isUploading ? 'Uploading...' : 'Choose Files'}
          </Button>
        </div>
      </Card>

    </div>
  );
}
