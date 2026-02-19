import { useState } from 'react';
import { useNavigate } from 'react-router';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import type { FontMetadata } from '@/types/font';

const VALID_EXTENSIONS = ['.otf', '.ttf'];

export function validateFontFile(fileName: string): boolean {
  const extension = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
  return VALID_EXTENSIONS.includes(extension);
}

export async function parseFontFile(filePath: string): Promise<FontMetadata> {
  return invoke<FontMetadata>('parse_font_file', { filePath });
}

export async function openFontDialog(): Promise<FontMetadata[]> {
  const selected = await open({
    multiple: true,
    filters: [{ name: 'Font Files', extensions: ['otf', 'ttf'] }],
  });

  if (!selected) return [];

  const paths = Array.isArray(selected) ? selected : [selected];
  const results: FontMetadata[] = [];

  for (const filePath of paths) {
    const fileName = filePath.split(/[\\/]/).pop() || '';
    if (!validateFontFile(fileName)) {
      toast.error(`Invalid file type: ${fileName}. Only .otf/.ttf supported.`);
      continue;
    }
    try {
      const metadata = await parseFontFile(filePath);
      results.push(metadata);
    } catch (error) {
      toast.error(`Failed to process ${fileName}: ${error}`);
    }
  }

  return results;
}

export function useFileUpload() {
  const navigate = useNavigate();
  const [isUploading, setIsUploading] = useState(false);

  const uploadFont = async (filePath: string, fileName: string) => {
    if (!validateFontFile(fileName)) {
      toast.error('Invalid file type. Please upload .otf or .ttf files only.');
      return;
    }

    try {
      setIsUploading(true);
      const metadata = await parseFontFile(filePath);

      navigate(`/font/${encodeURIComponent(fileName)}`, {
        state: { metadata, filePath },
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
      filters: [{ name: 'Font Files', extensions: ['otf', 'ttf'] }],
    });

    if (!selected) return;

    const paths = Array.isArray(selected) ? selected : [selected];
    for (const filePath of paths) {
      const fileName = filePath.split(/[\\/]/).pop() || '';
      await uploadFont(filePath, fileName);
    }
  };

  return {
    isUploading,
    uploadFont,
    handleFileDialog,
    validateFontFile,
  };
}
