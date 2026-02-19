use serde::{Deserialize, Serialize};
use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::raw::{FontRef as RawFontRef, TableProvider};
use skrifa::{FontRef, GlyphId, MetadataProvider};
use std::collections::HashMap;
use std::fmt::Write;
use std::fs;
use std::sync::Mutex;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FontMetadata {
    pub file_name: String,
    pub file_path: String,
    pub family_name: String,
    pub style_name: String,
    pub version: String,
    pub num_glyphs: u32,
    pub available_tables: Vec<String>,
}

// Cached extracted outlines for a font
struct CachedOutlines {
    outlines: Vec<GlyphOutline>,
    units_per_em: u16,
}

// Cache to store parsed font bytes and extracted outlines in memory
pub struct FontCache {
    fonts: Mutex<HashMap<String, Vec<u8>>>,
    outlines: Mutex<HashMap<String, CachedOutlines>>,
}

impl FontCache {
    pub fn new() -> Self {
        Self {
            fonts: Mutex::new(HashMap::new()),
            outlines: Mutex::new(HashMap::new()),
        }
    }

    pub fn get(&self, path: &str) -> Option<Vec<u8>> {
        self.fonts.lock().unwrap().get(path).cloned()
    }

    pub fn insert(&self, path: String, bytes: Vec<u8>) {
        self.fonts.lock().unwrap().insert(path, bytes);
    }
}

// Struct to represent a glyph with its SVG path
#[derive(Serialize, Deserialize, Debug)]
pub struct GlyphOutline {
    pub glyph_id: u32,
    pub glyph_name: Option<String>,
    pub svg_path: String,
    pub advance_width: f32,
    pub bounds: Option<GlyphBounds>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct GlyphBounds {
    pub x_min: f32,
    pub y_min: f32,
    pub x_max: f32,
    pub y_max: f32,
}

// Custom pen implementation that converts outline commands to SVG path
struct SvgPathPen {
    path: String,
    x_min: f32,
    x_max: f32,
    y_min: f32,
    y_max: f32,
}

impl SvgPathPen {
    fn new() -> Self {
        Self {
            path: String::with_capacity(256),
            x_min: f32::MAX,
            x_max: f32::MIN,
            y_min: f32::MAX,
            y_max: f32::MIN,
        }
    }

    fn into_path(self) -> String {
        self.path
    }

    fn bounding_box(&self) -> GlyphBounds{
        GlyphBounds{
            x_min: self.x_min,
            y_min: self.y_min,
            x_max: self.x_max,
            y_max: self.y_max,
        }
    }
}

impl OutlinePen for SvgPathPen {
    fn move_to(&mut self, x: f32, y: f32) {
        let _ = write!(self.path, "M{} {} ", x, -y);
        self.update_bounds(x, y);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        let _ = write!(self.path, "L{} {} ", x, -y);
        self.update_bounds(x, y);
    }

    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        let _ = write!(self.path, "Q{} {} {} {} ", cx0, -cy0, x, -y);
        self.update_bounds(cx0, cy0);
        self.update_bounds(x, y);
    }

    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        let _ = write!(self.path, "C{} {} {} {} {} {} ", cx0, -cy0, cx1, -cy1, x, -y);
        self.update_bounds(cx0, cy0);
        self.update_bounds(cx1, cy1);
        self.update_bounds(x, y);
    }

    fn close(&mut self) {
        self.path.push('Z');
    }
}

impl SvgPathPen {
    fn update_bounds(&mut self, x: f32, y: f32) {
        self.x_min = self.x_min.min(x);
        self.x_max = self.x_max.max(x);
        self.y_min = self.y_min.min(y);
        self.y_max = self.y_max.max(y);
    }
}

// Extract outlines for all glyphs in the font
fn extract_glyph_outlines(bytes: &[u8]) -> Result<Vec<GlyphOutline>, String> {
    let font = FontRef::new(bytes)
        .map_err(|e| format!("Failed to parse font: {:?}", e))?;

    let outlines = font.outline_glyphs();
    let glyph_metrics = font.glyph_metrics(skrifa::instance::Size::unscaled(), skrifa::instance::LocationRef::default());

    let num_glyphs = font.maxp()
        .map_err(|e| format!("Failed to read maxp table: {:?}", e))?
        .num_glyphs();

    // Pre-build glyph_id → unicode lookup (O(n) once instead of O(n) per glyph)
    let mut gid_to_unicode: HashMap<GlyphId, u32> = HashMap::new();
    for (codepoint, gid) in font.charmap().mappings() {
        gid_to_unicode.entry(gid).or_insert(codepoint);
    }

    let location = skrifa::instance::Location::default();
    let mut glyph_outlines = Vec::with_capacity(num_glyphs as usize);

    for glyph_id in 0..num_glyphs {
        let gid = GlyphId::from(glyph_id);

        let outline = match outlines.get(gid) {
            Some(o) => o,
            None => continue,
        };

        let mut pen = SvgPathPen::new();
        let settings = DrawSettings::unhinted(skrifa::instance::Size::unscaled(), &location);

        if outline.draw(settings, &mut pen).is_err() {
            continue;
        }

        if pen.path.is_empty() {
            continue;
        }

        let glyph_name = gid_to_unicode
            .get(&gid)
            .map(|cp| format!("U+{:04X}", cp));

        let advance_width = glyph_metrics.advance_width(gid).unwrap_or(0.0);
        let boundingbox = pen.bounding_box();

        glyph_outlines.push(GlyphOutline {
            glyph_id: glyph_id as u32,
            glyph_name,
            svg_path: pen.into_path(),
            advance_width,
            bounds: Some(boundingbox),
        });
    }

    Ok(glyph_outlines)
}

// Encode glyph outlines into a compact binary format for efficient IPC transfer.
// Format:
//   Header: total_glyphs(u32) + batch_count(u32) + units_per_em(u16)
//   Per glyph: glyph_id(u32) + advance_width(f32) + has_bounds(u8)
//              + [x_min(f32) + y_min(f32) + x_max(f32) + y_max(f32)]
//              + name_len(u16) + name_bytes + path_len(u32) + path_bytes
fn encode_glyph_outlines_binary(outlines: &[GlyphOutline], total_glyphs: u32, units_per_em: u16) -> Vec<u8> {
    let mut buf = Vec::new();

    // Header
    buf.extend_from_slice(&total_glyphs.to_le_bytes());
    buf.extend_from_slice(&(outlines.len() as u32).to_le_bytes());
    buf.extend_from_slice(&units_per_em.to_le_bytes());

    for glyph in outlines {
        buf.extend_from_slice(&glyph.glyph_id.to_le_bytes());
        buf.extend_from_slice(&glyph.advance_width.to_le_bytes());

        if let Some(ref bounds) = glyph.bounds {
            buf.push(1);
            buf.extend_from_slice(&bounds.x_min.to_le_bytes());
            buf.extend_from_slice(&bounds.y_min.to_le_bytes());
            buf.extend_from_slice(&bounds.x_max.to_le_bytes());
            buf.extend_from_slice(&bounds.y_max.to_le_bytes());
        } else {
            buf.push(0);
        }

        let name_bytes = glyph.glyph_name.as_deref().unwrap_or("").as_bytes();
        buf.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        buf.extend_from_slice(name_bytes);

        let path_bytes = glyph.svg_path.as_bytes();
        buf.extend_from_slice(&(path_bytes.len() as u32).to_le_bytes());
        buf.extend_from_slice(path_bytes);
    }

    buf
}

pub fn get_glyph_outlines_binary(
    file_path: &str,
    offset: u32,
    limit: u32,
    cache: &FontCache,
) -> Result<Vec<u8>, String> {
    // Ensure outlines are extracted and cached (expensive work happens only once)
    {
        let has_cached = cache.outlines.lock().unwrap().contains_key(file_path);
        if !has_cached {
            let bytes = cache.get(file_path).unwrap_or_else(|| {
                fs::read(file_path).unwrap_or_default()
            });
            if bytes.is_empty() {
                return Err(format!("Failed to read font file: {}", file_path));
            }

            let outlines = extract_glyph_outlines(&bytes)?;
            let font = RawFontRef::new(&bytes)
                .map_err(|e| format!("Invalid font file: {:?}", e))?;
            let units_per_em = font.head()
                .ok()
                .map(|head| head.units_per_em())
                .unwrap_or(1000);

            cache.outlines.lock().unwrap().insert(
                file_path.to_string(),
                CachedOutlines { outlines, units_per_em },
            );
        }
    }

    // Serve the requested page from cache
    let outline_cache = cache.outlines.lock().unwrap();
    let cached = outline_cache.get(file_path).unwrap();

    let total = cached.outlines.len();
    let start = (offset as usize).min(total);
    let end = ((offset as usize) + (limit as usize)).min(total);
    let page = &cached.outlines[start..end];

    Ok(encode_glyph_outlines_binary(page, total as u32, cached.units_per_em))
}

pub fn parse_font(file_path: &str, cache: &FontCache) -> Result<FontMetadata, String> {
    // Read font file bytes
    let bytes = fs::read(file_path)
        .map_err(|e| format!("Failed to read font file: {}", e))?;

    // Parse font with read-fonts
    let font = RawFontRef::new(&bytes)
        .map_err(|e| format!("Invalid font file: {:?}", e))?;

    // Store a clone of bytes in cache for later use
    cache.insert(file_path.to_string(), bytes.clone());

    // Extract family name from name table (NameId 1)
    let family_name = font
        .name()
        .ok()
        .and_then(|name_table| {
            name_table
                .name_record()
                .iter()
                .find(|record| record.name_id().to_u16() == 1)
                .and_then(|record| record.string(name_table.string_data()).ok())
                .and_then(|s| s.chars().collect::<String>().into())
        })
        .unwrap_or_else(|| "Unknown".to_string());

    // Extract style name from name table (NameId 2)
    let style_name = font
        .name()
        .ok()
        .and_then(|name_table| {
            name_table
                .name_record()
                .iter()
                .find(|record| record.name_id().to_u16() == 2)
                .and_then(|record| record.string(name_table.string_data()).ok())
                .and_then(|s| s.chars().collect::<String>().into())
        })
        .unwrap_or_else(|| "Regular".to_string());

    // Extract version from head table
    let version = font
        .head()
        .ok()
        .map(|head| format!("{}.{}", head.font_revision().to_bits() >> 16, head.font_revision().to_bits() & 0xFFFF))
        .unwrap_or_else(|| "Unknown".to_string());

    // Get number of glyphs from maxp table
    let num_glyphs = font
        .maxp()
        .ok()
        .map(|maxp| maxp.num_glyphs())
        .unwrap_or(0);

    // Get list of available tables
    let available_tables: Vec<String> = font
        .table_directory
        .table_records()
        .iter()
        .map(|record| {
            let tag = record.tag();
            format!("{}", tag)
        })
        .collect();

    // Extract file name from path
    let file_name = std::path::Path::new(file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown.ttf")
        .to_string();

    Ok(FontMetadata {
        file_name,
        file_path: file_path.to_string(),
        family_name,
        style_name,
        version,
        num_glyphs: num_glyphs as u32,
        available_tables,
    })
}

pub fn get_table_content(file_path: &str, table_name: &str, cache: &FontCache) -> Result<String, String> {
    // Try to get bytes from cache first, otherwise read from disk
    let bytes = cache.get(file_path).unwrap_or_else(|| {
        fs::read(file_path).unwrap_or_default()
    });

    if bytes.is_empty() {
        return Err(format!("Failed to read font file: {}", file_path));
    }

    // Parse font
    let font = RawFontRef::new(&bytes)
        .map_err(|e| format!("Invalid font file: {:?}", e))?;

    // Parse the table tag
    let tag = skrifa::raw::types::Tag::from_be_bytes(
        table_name
            .as_bytes()
            .get(..4)
            .ok_or_else(|| format!("Invalid table name: {}", table_name))?
            .try_into()
            .map_err(|_| format!("Invalid table name format: {}", table_name))?,
    );

    // Try to get the table data and serialize it
    let json_data = match table_name {
        "head" => {
            let table = font.head().map_err(|e| format!("Failed to read head table: {:?}", e))?;
            serde_json::to_string_pretty(&serde_json::json!({
                "version": format!("{:?}", table.version()),
                "font_revision": table.font_revision().to_f32(),
                "checksum_adjustment": table.checksum_adjustment(),
                "magic_number": table.magic_number(),
                "flags": table.flags(),
                "units_per_em": table.units_per_em(),
                "created": table.created(),
                "modified": table.modified(),
                "x_min": table.x_min(),
                "y_min": table.y_min(),
                "x_max": table.x_max(),
                "y_max": table.y_max(),
                "mac_style": table.mac_style(),
                "lowest_rec_ppem": table.lowest_rec_ppem(),
                "font_direction_hint": table.font_direction_hint(),
                "index_to_loc_format": table.index_to_loc_format(),
                "glyph_data_format": table.glyph_data_format(),
            }))
            .map_err(|e| format!("Failed to serialize head table: {}", e))?
        }
        "name" => {
            let table = font.name().map_err(|e| format!("Failed to read name table: {:?}", e))?;
            let records: Vec<serde_json::Value> = table
                .name_record()
                .iter()
                .filter_map(|record| {
                    let name_id = record.name_id();
                    let platform_id = record.platform_id();
                    let string = record.string(table.string_data()).ok()?;
                    Some(serde_json::json!({
                        "name_id": name_id.to_u16(),
                        "platform_id": format!("{:?}", platform_id),
                        "value": string.chars().collect::<String>()
                    }))
                })
                .collect();
            serde_json::to_string_pretty(&serde_json::json!({ "name_records": records }))
                .map_err(|e| format!("Failed to serialize name table: {}", e))?
        }
        "maxp" => {
            let table = font.maxp().map_err(|e| format!("Failed to read maxp table: {:?}", e))?;
            serde_json::to_string_pretty(&serde_json::json!({
                "version": format!("{:?}", table.version()),
                "num_glyphs": table.num_glyphs(),
            }))
            .map_err(|e| format!("Failed to serialize maxp table: {}", e))?
        }
        "hhea" => {
            let table = font.hhea().map_err(|e| format!("Failed to read hhea table: {:?}", e))?;
            serde_json::to_string_pretty(&serde_json::json!({
                "version": format!("{:?}", table.version()),
                "ascender": table.ascender(),
                "descender": table.descender(),
                "line_gap": table.line_gap(),
                "advance_width_max": table.advance_width_max(),
                "min_left_side_bearing": table.min_left_side_bearing(),
                "min_right_side_bearing": table.min_right_side_bearing(),
                "x_max_extent": table.x_max_extent(),
                "caret_slope_rise": table.caret_slope_rise(),
                "caret_slope_run": table.caret_slope_run(),
                "caret_offset": table.caret_offset(),
                "number_of_hmetrics": table.number_of_h_metrics(),
            }))
            .map_err(|e| format!("Failed to serialize hhea table: {}", e))?
        }
        "post" => {
            let table = font.post().map_err(|e| format!("Failed to read post table: {:?}", e))?;
            serde_json::to_string_pretty(&serde_json::json!({
                "version": format!("{:?}", table.version()),
                "italic_angle": table.italic_angle().to_f64(),
                "underline_position": table.underline_position(),
                "underline_thickness": table.underline_thickness(),
                "is_fixed_pitch": table.is_fixed_pitch(),
            }))
            .map_err(|e| format!("Failed to serialize post table: {}", e))?
        }
        _ => {
            // For other tables, try to get raw table data
            let table_data = font
                .table_data(tag)
                .ok_or_else(|| format!("Table '{}' not found in font", table_name))?;

            serde_json::to_string_pretty(&serde_json::json!({
                "table": table_name,
                "size_bytes": table_data.len(),
                "note": "Raw table data - specialized parser not yet implemented for this table type"
            }))
            .map_err(|e| format!("Failed to serialize table info: {}", e))?
        }
    };

    Ok(json_data)
}

#[derive(Deserialize)]
pub struct HeadTableUpdate {
    pub font_revision: f64,
    pub flags: u16,
    pub units_per_em: u16,
    pub created: i64,
    pub modified: i64,
    pub x_min: i16,
    pub y_min: i16,
    pub x_max: i16,
    pub y_max: i16,
    pub mac_style: u16,
    pub lowest_rec_ppem: u16,
    pub font_direction_hint: i16,
    pub index_to_loc_format: i16,
}

pub fn update_head_table(
    file_path: &str,
    updates: &HeadTableUpdate,
    cache: &FontCache,
) -> Result<(), String> {
    use write_fonts::from_obj::ToOwnedTable;
    use write_fonts::tables::head::{Flags, Head, MacStyle};
    use write_fonts::types::{Fixed, LongDateTime};
    use write_fonts::FontBuilder;

    let bytes = cache.get(file_path).unwrap_or_else(|| {
        fs::read(file_path).unwrap_or_default()
    });

    if bytes.is_empty() {
        return Err(format!("Failed to read font file: {}", file_path));
    }

    let font = RawFontRef::new(&bytes)
        .map_err(|e| format!("Invalid font file: {:?}", e))?;

    // Convert read-only head to owned/mutable via write-fonts
    let mut head: Head = font
        .head()
        .map_err(|e| format!("Failed to read head table: {:?}", e))?
        .to_owned_table();

    // Apply updates
    head.font_revision = Fixed::from_f64(updates.font_revision);
    head.flags = Flags::from_bits_truncate(updates.flags);
    head.units_per_em = updates.units_per_em;
    head.created = LongDateTime::new(updates.created);
    head.modified = LongDateTime::new(updates.modified);
    head.x_min = updates.x_min;
    head.y_min = updates.y_min;
    head.x_max = updates.x_max;
    head.y_max = updates.y_max;
    head.mac_style = MacStyle::from_bits_truncate(updates.mac_style);
    head.lowest_rec_ppem = updates.lowest_rec_ppem;
    head.font_direction_hint = updates.font_direction_hint;
    head.index_to_loc_format = updates.index_to_loc_format;

    // Rebuild font with modified head table, copying all other tables
    let new_bytes = FontBuilder::new()
        .add_table(&head)
        .map_err(|e| format!("Failed to add head table: {:?}", e))?
        .copy_missing_tables(font)
        .build();

    // Write modified font to disk
    fs::write(file_path, &new_bytes)
        .map_err(|e| format!("Failed to write font file: {}", e))?;

    // Invalidate caches
    cache.fonts.lock().unwrap().insert(file_path.to_string(), new_bytes);
    cache.outlines.lock().unwrap().remove(file_path);

    Ok(())
}
