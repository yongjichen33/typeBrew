import { describe, it, expect } from 'vitest';
import { parseGlyphOutlines, type Glyph } from './glyphParser';

function encodeGlyphOutlines(
  glyphs: Glyph[],
  totalGlyphs: number,
  unitsPerEm: number
): ArrayBuffer {
  const encoder = new TextEncoder();

  // Calculate total size needed
  let size = 10; // header: total_glyphs(4) + batch_count(4) + units_per_em(2)
  for (const g of glyphs) {
    size += 4 + 4 + 1; // glyph_id + advance_width + has_bounds
    if (g.bounds) {
      size += 16; // 4 floats
    }
    const nameBytes = g.glyph_name ? encoder.encode(g.glyph_name) : new Uint8Array(0);
    size += 2 + nameBytes.length; // name_len + name
    const pathBytes = encoder.encode(g.svg_path);
    size += 4 + pathBytes.length; // path_len + path
  }

  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  const encoder2 = new TextEncoder();
  let offset = 0;

  // Header
  view.setUint32(offset, totalGlyphs, true);
  offset += 4;
  view.setUint32(offset, glyphs.length, true);
  offset += 4;
  view.setUint16(offset, unitsPerEm, true);
  offset += 2;

  // Glyphs
  for (const g of glyphs) {
    view.setUint32(offset, g.glyph_id, true);
    offset += 4;
    view.setFloat32(offset, g.advance_width, true);
    offset += 4;

    if (g.bounds) {
      view.setUint8(offset, 1);
      offset += 1;
      view.setFloat32(offset, g.bounds.x_min, true);
      offset += 4;
      view.setFloat32(offset, g.bounds.y_min, true);
      offset += 4;
      view.setFloat32(offset, g.bounds.x_max, true);
      offset += 4;
      view.setFloat32(offset, g.bounds.y_max, true);
      offset += 4;
    } else {
      view.setUint8(offset, 0);
      offset += 1;
    }

    const nameBytes = g.glyph_name ? encoder2.encode(g.glyph_name) : new Uint8Array(0);
    view.setUint16(offset, nameBytes.length, true);
    offset += 2;
    new Uint8Array(buffer, offset, nameBytes.length).set(nameBytes);
    offset += nameBytes.length;

    const pathBytes = encoder2.encode(g.svg_path);
    view.setUint32(offset, pathBytes.length, true);
    offset += 4;
    new Uint8Array(buffer, offset, pathBytes.length).set(pathBytes);
    offset += pathBytes.length;
  }

  return buffer;
}

describe('parseGlyphOutlines', () => {
  it('parses empty batch', () => {
    const buffer = encodeGlyphOutlines([], 100, 1000);
    const result = parseGlyphOutlines(buffer);

    expect(result.totalGlyphs).toBe(100);
    expect(result.batchCount).toBe(0);
    expect(result.unitsPerEm).toBe(1000);
    expect(result.glyphs).toEqual([]);
  });

  it('parses single glyph without bounds or name', () => {
    const glyphs: Glyph[] = [{ glyph_id: 42, svg_path: 'M 0 0 L 100 0', advance_width: 500 }];
    const buffer = encodeGlyphOutlines(glyphs, 100, 1000);
    const result = parseGlyphOutlines(buffer);

    expect(result.totalGlyphs).toBe(100);
    expect(result.batchCount).toBe(1);
    expect(result.unitsPerEm).toBe(1000);
    expect(result.glyphs).toHaveLength(1);
    expect(result.glyphs[0].glyph_id).toBe(42);
    expect(result.glyphs[0].svg_path).toBe('M 0 0 L 100 0');
    expect(result.glyphs[0].advance_width).toBe(500);
    expect(result.glyphs[0].bounds).toBeUndefined();
    expect(result.glyphs[0].glyph_name).toBeUndefined();
  });

  it('parses glyph with bounds', () => {
    const glyphs: Glyph[] = [
      {
        glyph_id: 1,
        svg_path: 'M 0 0 L 100 0 L 100 200 Z',
        advance_width: 600,
        bounds: { x_min: 0, y_min: 0, x_max: 100, y_max: 200 },
      },
    ];
    const buffer = encodeGlyphOutlines(glyphs, 256, 2048);
    const result = parseGlyphOutlines(buffer);

    expect(result.glyphs[0].bounds).toBeDefined();
    expect(result.glyphs[0].bounds?.x_min).toBeCloseTo(0);
    expect(result.glyphs[0].bounds?.y_min).toBeCloseTo(0);
    expect(result.glyphs[0].bounds?.x_max).toBeCloseTo(100);
    expect(result.glyphs[0].bounds?.y_max).toBeCloseTo(200);
  });

  it('parses glyph with name', () => {
    const glyphs: Glyph[] = [
      {
        glyph_id: 65,
        svg_path: 'M 0 0 L 50 0',
        advance_width: 500,
        glyph_name: 'A',
      },
    ];
    const buffer = encodeGlyphOutlines(glyphs, 100, 1000);
    const result = parseGlyphOutlines(buffer);

    expect(result.glyphs[0].glyph_name).toBe('A');
  });

  it('parses glyph with unicode name', () => {
    const glyphs: Glyph[] = [
      {
        glyph_id: 1,
        svg_path: 'M 0 0 L 10 10',
        advance_width: 100,
        glyph_name: 'uni4E2D', // Chinese character
      },
    ];
    const buffer = encodeGlyphOutlines(glyphs, 100, 1000);
    const result = parseGlyphOutlines(buffer);

    expect(result.glyphs[0].glyph_name).toBe('uni4E2D');
  });

  it('parses multiple glyphs', () => {
    const glyphs: Glyph[] = [
      { glyph_id: 0, svg_path: 'M 0 0', advance_width: 250 },
      { glyph_id: 1, svg_path: 'M 0 0 L 100 0', advance_width: 500 },
      { glyph_id: 2, svg_path: 'M 0 0 L 100 0 L 100 100 Z', advance_width: 750 },
    ];
    const buffer = encodeGlyphOutlines(glyphs, 256, 1000);
    const result = parseGlyphOutlines(buffer);

    expect(result.batchCount).toBe(3);
    expect(result.glyphs).toHaveLength(3);
    expect(result.glyphs[0].glyph_id).toBe(0);
    expect(result.glyphs[1].glyph_id).toBe(1);
    expect(result.glyphs[2].glyph_id).toBe(2);
  });

  it('parses negative bounds', () => {
    const glyphs: Glyph[] = [
      {
        glyph_id: 1,
        svg_path: 'M -50 -100 L 50 100',
        advance_width: 500,
        bounds: { x_min: -50, y_min: -100, x_max: 50, y_max: 100 },
      },
    ];
    const buffer = encodeGlyphOutlines(glyphs, 100, 1000);
    const result = parseGlyphOutlines(buffer);

    expect(result.glyphs[0].bounds?.x_min).toBeCloseTo(-50);
    expect(result.glyphs[0].bounds?.y_min).toBeCloseTo(-100);
  });

  it('parses fractional advance width', () => {
    const glyphs: Glyph[] = [{ glyph_id: 1, svg_path: 'M 0 0', advance_width: 123.5 }];
    const buffer = encodeGlyphOutlines(glyphs, 100, 1000);
    const result = parseGlyphOutlines(buffer);

    expect(result.glyphs[0].advance_width).toBeCloseTo(123.5);
  });

  it('handles empty svg path', () => {
    const glyphs: Glyph[] = [{ glyph_id: 0, svg_path: '', advance_width: 0 }];
    const buffer = encodeGlyphOutlines(glyphs, 100, 1000);
    const result = parseGlyphOutlines(buffer);

    expect(result.glyphs[0].svg_path).toBe('');
  });

  it('handles complex svg path', () => {
    const complexPath = 'M 0 0 Q 50 100 100 0 C 125 50 175 50 200 0 Z';
    const glyphs: Glyph[] = [{ glyph_id: 1, svg_path: complexPath, advance_width: 200 }];
    const buffer = encodeGlyphOutlines(glyphs, 100, 1000);
    const result = parseGlyphOutlines(buffer);

    expect(result.glyphs[0].svg_path).toBe(complexPath);
  });
});
