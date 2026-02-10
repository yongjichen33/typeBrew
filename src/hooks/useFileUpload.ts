import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';

interface UploadedFont {
  name: string;
  path: string;
  size: number;
}

export function useFileUpload() {
  const [uploadedFonts, setUploadedFonts] = useState<UploadedFont[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const validateFontFile = (fileName: string): boolean => {
    const validExtensions = ['.otf', '.ttf'];
    const extension = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
    return validExtensions.includes(extension);
  };

  const uploadFont = async (filePath: string, fileName: string) => {
    if (!validateFontFile(fileName)) {
      toast.error('Invalid file type. Please upload .otf or .ttf files only.');
      return;
    }

    try {
      setIsUploading(true);
      const savedPath = await invoke<string>('save_font_file', {
        filePath,
        fileName,
      });

      const newFont: UploadedFont = {
        name: fileName,
        path: savedPath,
        size: 0,
      };

      setUploadedFonts(prev => [...prev, newFont]);

      toast.success(`${fileName} has been added to your collection.`);
    } catch (error) {
      toast.error(`Failed to upload ${fileName}: ${error}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileDialog = async () => {
    const selected = await open({
      multiple: true,
      filters: [{
        name: 'Font Files',
        extensions: ['otf', 'ttf']
      }]
    });

    if (!selected) return;

    if (Array.isArray(selected)) {
      for (const filePath of selected) {
        const fileName = filePath.split(/[\\/]/).pop() || '';
        await uploadFont(filePath, fileName);
      }
    } else {
      const fileName = (selected as string).split(/[\\/]/).pop() || '';
      await uploadFont(selected as string, fileName);
    }
  };

  return {
    uploadedFonts,
    isUploading,
    uploadFont,
    handleFileDialog,
    validateFontFile,
  };
}
