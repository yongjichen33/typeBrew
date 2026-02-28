export interface GlyphBounds {
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
}

export interface Glyph {
  glyph_id: number;
  glyph_name?: string;
  svg_path: string;
  advance_width: number;
  bounds?: GlyphBounds;
}

export interface GlyphOutlineData {
  totalGlyphs: number;
  batchCount: number;
  unitsPerEm: number;
  glyphs: Glyph[];
}

/**
 * Parse binary glyph outline data from the Rust backend.
 *
 * Binary format (all little-endian):
 *   Header: total_glyphs(u32) + batch_count(u32) + units_per_em(u16)
 *   Per glyph: glyph_id(u32) + advance_width(f32) + has_bounds(u8)
 *              + [x_min(f32) + y_min(f32) + x_max(f32) + y_max(f32)]
 *              + name_len(u16) + name_bytes + path_len(u32) + path_bytes
 */
export function parseGlyphOutlines(buffer: ArrayBuffer): GlyphOutlineData {
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  let offset = 0;

  const totalGlyphs = view.getUint32(offset, true);
  offset += 4;
  const batchCount = view.getUint32(offset, true);
  offset += 4;
  const unitsPerEm = view.getUint16(offset, true);
  offset += 2;

  const glyphs: Glyph[] = new Array(batchCount);

  for (let i = 0; i < batchCount; i++) {
    const glyph_id = view.getUint32(offset, true);
    offset += 4;
    const advance_width = view.getFloat32(offset, true);
    offset += 4;

    const hasBounds = view.getUint8(offset);
    offset += 1;
    let bounds: GlyphBounds | undefined;
    if (hasBounds) {
      const x_min = view.getFloat32(offset, true);
      offset += 4;
      const y_min = view.getFloat32(offset, true);
      offset += 4;
      const x_max = view.getFloat32(offset, true);
      offset += 4;
      const y_max = view.getFloat32(offset, true);
      offset += 4;
      bounds = { x_min, y_min, x_max, y_max };
    }

    const nameLen = view.getUint16(offset, true);
    offset += 2;
    const glyph_name =
      nameLen > 0 ? decoder.decode(new Uint8Array(buffer, offset, nameLen)) : undefined;
    offset += nameLen;

    const pathLen = view.getUint32(offset, true);
    offset += 4;
    const svg_path = decoder.decode(new Uint8Array(buffer, offset, pathLen));
    offset += pathLen;

    glyphs[i] = { glyph_id, glyph_name, svg_path, advance_width, bounds };
  }

  return { totalGlyphs, batchCount, unitsPerEm, glyphs };
}
