import { useState } from 'react';
import { useNavigate } from 'react-router';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import type { FontMetadata } from '@/types/font';

export function useFileUpload() {
  const navigate = useNavigate();
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

      // Save the font file
      const savedPath = await invoke<string>('save_font_file', {
        filePath,
        fileName,
      });

      // Parse the font to get metadata
      const metadata = await invoke<FontMetadata>('parse_font_file', {
        filePath: savedPath,
      });

      // Navigate to font viewer with metadata
      navigate(`/font/${encodeURIComponent(fileName)}`, {
        state: { metadata, savedPath }
      });

      toast.success(`${fileName} has been parsed successfully.`);
    } catch (error) {
      toast.error(`Failed to process ${fileName}: ${error}`);
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
    isUploading,
    uploadFont,
    handleFileDialog,
    validateFontFile,
  };
}
