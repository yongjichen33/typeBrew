use serde::{Deserialize, Serialize};
use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::raw::{FontRef as RawFontRef, TableProvider};
use skrifa::{FontRef, GlyphId, MetadataProvider};
use std::collections::HashMap;
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

// Cache to store parsed font bytes in memory
pub struct FontCache {
    cache: Mutex<HashMap<String, Vec<u8>>>,
}

impl FontCache {
    pub fn new() -> Self {
        Self {
            cache: Mutex::new(HashMap::new()),
        }
    }

    pub fn get(&self, path: &str) -> Option<Vec<u8>> {
        self.cache.lock().unwrap().get(path).cloned()
    }

    pub fn insert(&self, path: String, bytes: Vec<u8>) {
        self.cache.lock().unwrap().insert(path, bytes);
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
            path: String::new(),
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
        self.path.push_str(&format!("M{} {} ", x, -y));
        self.update_bounds(x, y);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.path.push_str(&format!("L{} {} ", x, -y));
        self.update_bounds(x, y);
    }

    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        self.path.push_str(&format!("Q{} {} {} {} ", cx0, -cy0, x, -y));
        self.update_bounds(cx0, cy0);
        self.update_bounds(x, y);
    }

    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        self.path.push_str(&format!("C{} {} {} {} {} {} ", cx0, -cy0, cx1, -cy1, x, -y));
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
    let charmap = font.charmap();
    let glyph_metrics = font.glyph_metrics(skrifa::instance::Size::unscaled(), skrifa::instance::LocationRef::default());

    let num_glyphs = font.maxp()
        .map_err(|e| format!("Failed to read maxp table: {:?}", e))?
        .num_glyphs();

    let mut glyph_outlines = Vec::new();

    for glyph_id in 0..num_glyphs {
        let gid = GlyphId::from(glyph_id);

        // Try to get the glyph name from cmap
        let glyph_name = charmap.mappings()
            .find(|(_, mapped_gid)| *mapped_gid == gid)
            .map(|(ch, _)| format!("U+{:04X}", ch as u32));

        // Get glyph metrics
        let advance_width = glyph_metrics.advance_width(gid).unwrap_or(0.0);

        // Try to get outline
        let mut pen = SvgPathPen::new();
        let location = skrifa::instance::Location::default();
        let settings = DrawSettings::unhinted(skrifa::instance::Size::unscaled(), &location);

        match outlines.get(gid) {
            Some(outline) => {
                if let Err(_) = outline.draw(settings, &mut pen) {
                    // Skip glyphs that fail to draw
                    continue;
                }

                // let svg_path = pen.into_path();
                
                // Only include glyphs that have actual paths
                if !pen.path.is_empty() {
                    let boundingbox = pen.bounding_box();
                    glyph_outlines.push(GlyphOutline {
                        glyph_id: glyph_id as u32,
                        glyph_name,
                        svg_path: pen.into_path(),
                        advance_width,
                        bounds: Some(boundingbox),
                    });
                }
            }
            None => continue,
        }
    }

    Ok(glyph_outlines)
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

    // Check if this is an outline table - render glyphs instead of raw data
    if table_name == "glyf" || table_name == "CFF " || table_name == "CFF2" {
        let outlines = extract_glyph_outlines(&bytes)
            .map_err(|e| format!("Failed to extract outlines: {}", e))?;

        // Get unitsPerEm from head table
        let font = RawFontRef::new(&bytes)
            .map_err(|e| format!("Invalid font file: {:?}", e))?;
        let units_per_em = font.head()
            .ok()
            .map(|head| head.units_per_em())
            .unwrap_or(1000);

        return serde_json::to_string_pretty(&serde_json::json!({
            "table": table_name,
            "type": "outline",
            "num_glyphs": outlines.len(),
            "units_per_em": units_per_em,
            "glyphs": outlines
        }))
        .map_err(|e| format!("Failed to serialize outline data: {}", e));
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
