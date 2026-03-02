use serde::{Deserialize, Serialize};
use skrifa::outline::{DrawSettings, Engine, HintingInstance, HintingOptions, OutlinePen, Target};
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
    num_glyphs: u32,
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
pub struct HintingInfo {
    pub is_hinted: bool,
    pub hint_format: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GlyphBounds {
    pub x_min: f32,
    pub y_min: f32,
    pub x_max: f32,
    pub y_max: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ComponentOffset {
    pub glyph_id: u32,
    pub x_offset: f32,
    pub y_offset: f32,
    /// Recursively nested outline for this component (None if not yet resolved).
    pub outline: Option<Box<GlyphOutlineData>>,
}

// Structured outline data for the glyph editor
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GlyphOutlineData {
    pub glyph_id: u32,
    pub glyph_name: Option<String>,
    pub contours: Vec<Contour>,
    pub advance_width: f32,
    pub lsb: f32,
    pub bounds: Option<GlyphBounds>,
    pub is_composite: bool,
    pub component_glyph_ids: Vec<u32>,
    pub components: Vec<ComponentOffset>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Contour {
    pub commands: Vec<OutlineCommand>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "kind")]
pub enum OutlineCommand {
    M {
        point: Point,
    },
    L {
        point: Point,
    },
    Q {
        ctrl: Point,
        point: Point,
    },
    C {
        ctrl1: Point,
        ctrl2: Point,
        point: Point,
    },
    Z,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Point {
    pub x: f32,
    pub y: f32,
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

    fn bounding_box(&self) -> GlyphBounds {
        GlyphBounds {
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
        let _ = write!(
            self.path,
            "C{} {} {} {} {} {} ",
            cx0, -cy0, cx1, -cy1, x, -y
        );
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

// Pen implementation that collects outline commands as structured data
struct OutlineDataPen {
    contours: Vec<Contour>,
    current_contour: Vec<OutlineCommand>,
    x_min: f32,
    x_max: f32,
    y_min: f32,
    y_max: f32,
}

impl OutlineDataPen {
    fn new() -> Self {
        Self {
            contours: Vec::new(),
            current_contour: Vec::new(),
            x_min: f32::MAX,
            x_max: f32::MIN,
            y_min: f32::MAX,
            y_max: f32::MIN,
        }
    }

    fn update_bounds(&mut self, x: f32, y: f32) {
        self.x_min = self.x_min.min(x);
        self.x_max = self.x_max.max(x);
        self.y_min = self.y_min.min(y);
        self.y_max = self.y_max.max(y);
    }

    #[allow(clippy::too_many_arguments)]
    fn into_outline_data(
        self,
        glyph_id: u32,
        glyph_name: Option<String>,
        advance_width: f32,
        lsb: f32,
        is_composite: bool,
        component_glyph_ids: Vec<u32>,
        components: Vec<ComponentOffset>,
    ) -> GlyphOutlineData {
        GlyphOutlineData {
            glyph_id,
            glyph_name,
            contours: self.contours,
            advance_width,
            lsb,
            bounds: if self.x_min < self.x_max {
                Some(GlyphBounds {
                    x_min: self.x_min,
                    y_min: self.y_min,
                    x_max: self.x_max,
                    y_max: self.y_max,
                })
            } else {
                None
            },
            is_composite,
            component_glyph_ids,
            components,
        }
    }
}

impl OutlinePen for OutlineDataPen {
    fn move_to(&mut self, x: f32, y: f32) {
        // Start a new contour
        if !self.current_contour.is_empty() {
            self.contours.push(Contour {
                commands: std::mem::take(&mut self.current_contour),
            });
        }
        self.current_contour.push(OutlineCommand::M {
            point: Point { x, y },
        });
        self.update_bounds(x, y);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.current_contour.push(OutlineCommand::L {
            point: Point { x, y },
        });
        self.update_bounds(x, y);
    }

    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        self.current_contour.push(OutlineCommand::Q {
            ctrl: Point { x: cx0, y: cy0 },
            point: Point { x, y },
        });
        self.update_bounds(cx0, cy0);
        self.update_bounds(x, y);
    }

    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        self.current_contour.push(OutlineCommand::C {
            ctrl1: Point { x: cx0, y: cy0 },
            ctrl2: Point { x: cx1, y: cy1 },
            point: Point { x, y },
        });
        self.update_bounds(cx0, cy0);
        self.update_bounds(cx1, cy1);
        self.update_bounds(x, y);
    }

    fn close(&mut self) {
        self.current_contour.push(OutlineCommand::Z);
    }
}

// Extract outlines for all glyphs in the font
fn extract_glyph_outlines(bytes: &[u8]) -> Result<Vec<GlyphOutline>, String> {
    let font = FontRef::new(bytes).map_err(|e| format!("Failed to parse font: {:?}", e))?;

    let outlines = font.outline_glyphs();
    let glyph_metrics = font.glyph_metrics(
        skrifa::instance::Size::unscaled(),
        skrifa::instance::LocationRef::default(),
    );

    let num_glyphs = font
        .maxp()
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

        let glyph_name = gid_to_unicode.get(&gid).map(|cp| format!("U+{:04X}", cp));

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
fn encode_glyph_outlines_binary(
    outlines: &[GlyphOutline],
    total_glyphs: u32,
    units_per_em: u16,
) -> Vec<u8> {
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
            let bytes = cache
                .get(file_path)
                .unwrap_or_else(|| fs::read(file_path).unwrap_or_default());
            if bytes.is_empty() {
                return Err(format!("Failed to read font file: {}", file_path));
            }

            let outlines = extract_glyph_outlines(&bytes)?;
            let font =
                RawFontRef::new(&bytes).map_err(|e| format!("Invalid font file: {:?}", e))?;
            let units_per_em = font
                .head()
                .ok()
                .map(|head| head.units_per_em())
                .unwrap_or(1000);
            let num_glyphs = font
                .maxp()
                .ok()
                .map(|maxp| maxp.num_glyphs() as u32)
                .unwrap_or(outlines.len() as u32);

            cache.outlines.lock().unwrap().insert(
                file_path.to_string(),
                CachedOutlines {
                    outlines,
                    units_per_em,
                    num_glyphs,
                },
            );
        }
    }

    // Serve the requested page from cache
    let outline_cache = cache.outlines.lock().unwrap();
    let cached = outline_cache.get(file_path).unwrap();

    let total_outlines = cached.outlines.len();
    let start = (offset as usize).min(total_outlines);
    let end = ((offset as usize) + (limit as usize)).min(total_outlines);
    let page = &cached.outlines[start..end];

    Ok(encode_glyph_outlines_binary(
        page,
        cached.num_glyphs, // Use actual num_glyphs from maxp
        cached.units_per_em,
    ))
}

/// Parse composite glyph component records, extracting glyph IDs and x/y offsets.
fn parse_composite_components(data: &[u8]) -> Vec<ComponentOffset> {
    const MORE_COMPONENTS: u16 = 0x0020;
    const ARG_1_AND_2_ARE_WORDS: u16 = 0x0001;
    const ARGS_ARE_XY_VALUES: u16 = 0x0002;
    const WE_HAVE_A_SCALE: u16 = 0x0008;
    const WE_HAVE_AN_X_AND_Y_SCALE: u16 = 0x0040;
    const WE_HAVE_A_TWO_BY_TWO: u16 = 0x0080;

    let mut components = Vec::new();
    let mut pos = 0;
    loop {
        if pos + 4 > data.len() {
            break;
        }
        let flags = u16::from_be_bytes([data[pos], data[pos + 1]]);
        let component_glyph_id = u16::from_be_bytes([data[pos + 2], data[pos + 3]]);
        pos += 4;

        // Parse argument bytes (x/y offsets or point indices)
        let (x_offset, y_offset) = if flags & ARG_1_AND_2_ARE_WORDS != 0 {
            if pos + 4 > data.len() {
                break;
            }
            let arg1 = i16::from_be_bytes([data[pos], data[pos + 1]]);
            let arg2 = i16::from_be_bytes([data[pos + 2], data[pos + 3]]);
            pos += 4;
            if flags & ARGS_ARE_XY_VALUES != 0 {
                (arg1 as f32, arg2 as f32)
            } else {
                (0.0_f32, 0.0_f32)
            }
        } else {
            if pos + 2 > data.len() {
                break;
            }
            let arg1 = data[pos] as i8;
            let arg2 = data[pos + 1] as i8;
            pos += 2;
            if flags & ARGS_ARE_XY_VALUES != 0 {
                (arg1 as f32, arg2 as f32)
            } else {
                (0.0_f32, 0.0_f32)
            }
        };

        // Skip optional transform data
        if flags & WE_HAVE_A_TWO_BY_TWO != 0 {
            pos += 8;
        } else if flags & WE_HAVE_AN_X_AND_Y_SCALE != 0 {
            pos += 4;
        } else if flags & WE_HAVE_A_SCALE != 0 {
            pos += 2;
        }

        components.push(ComponentOffset {
            glyph_id: component_glyph_id as u32,
            x_offset,
            y_offset,
            outline: None,
        });

        if flags & MORE_COMPONENTS == 0 {
            break;
        }
    }
    components
}

fn get_composite_info(font: &FontRef<'_>, glyph_id: u32) -> (bool, Vec<ComponentOffset>) {
    use skrifa::raw::types::Tag;

    let glyf_bytes = match font.table_data(Tag::new(b"glyf")) {
        Some(d) => d.as_bytes().to_owned(),
        None => return (false, vec![]),
    };
    let loca_bytes = match font.table_data(Tag::new(b"loca")) {
        Some(d) => d.as_bytes().to_owned(),
        None => return (false, vec![]),
    };
    let is_long_loca = match font.head() {
        Ok(h) => h.index_to_loc_format() == 1,
        Err(_) => return (false, vec![]),
    };

    let glyph_start = if is_long_loca {
        let idx = glyph_id as usize * 4;
        if idx + 4 > loca_bytes.len() {
            return (false, vec![]);
        }
        u32::from_be_bytes([
            loca_bytes[idx],
            loca_bytes[idx + 1],
            loca_bytes[idx + 2],
            loca_bytes[idx + 3],
        ]) as usize
    } else {
        let idx = glyph_id as usize * 2;
        if idx + 2 > loca_bytes.len() {
            return (false, vec![]);
        }
        (u16::from_be_bytes([loca_bytes[idx], loca_bytes[idx + 1]]) as usize) * 2
    };

    if glyph_start + 2 > glyf_bytes.len() {
        return (false, vec![]);
    }

    // numberOfContours < 0 → composite glyph
    let num_contours = i16::from_be_bytes([glyf_bytes[glyph_start], glyf_bytes[glyph_start + 1]]);
    if num_contours >= 0 {
        return (false, vec![]);
    }

    // Component records start at offset+10 (10-byte glyph header)
    if glyph_start + 10 > glyf_bytes.len() {
        return (true, vec![]);
    }
    let components = parse_composite_components(&glyf_bytes[glyph_start + 10..]);
    (true, components)
}

/// Read the left side bearing for a glyph directly from the hmtx table.
fn get_hmtx_lsb(font: &FontRef<'_>, glyph_id: u32) -> f32 {
    use skrifa::raw::types::Tag;
    let hmtx_data = match font.table_data(Tag::new(b"hmtx")) {
        Some(d) => d.as_bytes().to_owned(),
        None => return 0.0,
    };
    let num_h_metrics = match font.hhea() {
        Ok(h) => h.number_of_h_metrics() as usize,
        Err(_) => return 0.0,
    };
    if (glyph_id as usize) < num_h_metrics {
        // metrics portion: (advance_width: u16, lsb: i16) per entry
        let offset = glyph_id as usize * 4 + 2;
        if offset + 2 <= hmtx_data.len() {
            return i16::from_be_bytes([hmtx_data[offset], hmtx_data[offset + 1]]) as f32;
        }
    } else {
        // lsb-only portion after the metrics entries
        let lsb_index = glyph_id as usize - num_h_metrics;
        let offset = num_h_metrics * 4 + lsb_index * 2;
        if offset + 2 <= hmtx_data.len() {
            return i16::from_be_bytes([hmtx_data[offset], hmtx_data[offset + 1]]) as f32;
        }
    }
    0.0
}

/// Recursively build GlyphOutlineData, resolving component outlines for composites.
fn build_glyph_outline_data_recursive(
    bytes: &[u8],
    glyph_id: u32,
    depth: u8,
) -> Option<GlyphOutlineData> {
    if depth > 5 {
        return None;
    }

    let font = FontRef::new(bytes).ok()?;

    let advance_width = font
        .glyph_metrics(
            skrifa::instance::Size::unscaled(),
            skrifa::instance::LocationRef::default(),
        )
        .advance_width(GlyphId::from(glyph_id))
        .unwrap_or(0.0);

    let lsb = get_hmtx_lsb(&font, glyph_id);

    let outlines = font.outline_glyphs();
    let outline = outlines.get(GlyphId::from(glyph_id))?;

    // Check composite status before drawing — composite glyphs have no contours
    // of their own (skrifa's draw() would flatten all components, which we don't want).
    let (is_composite, mut components) = get_composite_info(&font, glyph_id);

    let mut pen = OutlineDataPen::new();
    if !is_composite {
        let location = skrifa::instance::Location::default();
        let settings = DrawSettings::unhinted(skrifa::instance::Size::unscaled(), &location);
        let _ = outline.draw(settings, &mut pen);
        if !pen.current_contour.is_empty() {
            let commands = std::mem::take(&mut pen.current_contour);
            pen.contours.push(Contour { commands });
        }
    }

    // Recursively fill component outlines
    if is_composite {
        for comp in &mut components {
            comp.outline =
                build_glyph_outline_data_recursive(bytes, comp.glyph_id, depth + 1).map(Box::new);
        }
    }

    let component_glyph_ids: Vec<u32> = components.iter().map(|c| c.glyph_id).collect();

    Some(pen.into_outline_data(
        glyph_id,
        None,
        advance_width,
        lsb,
        is_composite,
        component_glyph_ids,
        components,
    ))
}

pub fn get_glyph_outline_data(
    file_path: &str,
    glyph_id: u32,
    cache: &FontCache,
) -> Result<GlyphOutlineData, String> {
    let bytes = cache
        .get(file_path)
        .unwrap_or_else(|| fs::read(file_path).unwrap_or_default());
    if bytes.is_empty() {
        return Err(format!("Failed to read font file: {}", file_path));
    }

    build_glyph_outline_data_recursive(&bytes, glyph_id, 0)
        .ok_or_else(|| format!("Glyph {} not found or failed to parse", glyph_id))
}

pub fn parse_font(file_path: &str, cache: &FontCache) -> Result<FontMetadata, String> {
    // Read font file bytes
    let bytes = fs::read(file_path).map_err(|e| format!("Failed to read font file: {}", e))?;

    // Parse font with read-fonts
    let font = RawFontRef::new(&bytes).map_err(|e| format!("Invalid font file: {:?}", e))?;

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
        .map(|head| {
            format!(
                "{}.{}",
                head.font_revision().to_bits() >> 16,
                head.font_revision().to_bits() & 0xFFFF
            )
        })
        .unwrap_or_else(|| "Unknown".to_string());

    // Get number of glyphs from maxp table
    let num_glyphs = font.maxp().ok().map(|maxp| maxp.num_glyphs()).unwrap_or(0);

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

pub fn get_table_content(
    file_path: &str,
    table_name: &str,
    cache: &FontCache,
) -> Result<String, String> {
    // Try to get bytes from cache first, otherwise read from disk
    let bytes = cache
        .get(file_path)
        .unwrap_or_else(|| fs::read(file_path).unwrap_or_default());

    if bytes.is_empty() {
        return Err(format!("Failed to read font file: {}", file_path));
    }

    // Parse font
    let font = RawFontRef::new(&bytes).map_err(|e| format!("Invalid font file: {:?}", e))?;

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
            let table = font
                .head()
                .map_err(|e| format!("Failed to read head table: {:?}", e))?;
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
            let table = font
                .name()
                .map_err(|e| format!("Failed to read name table: {:?}", e))?;
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
            let table = font
                .maxp()
                .map_err(|e| format!("Failed to read maxp table: {:?}", e))?;
            serde_json::to_string_pretty(&serde_json::json!({
                "version": format!("{:?}", table.version()),
                "num_glyphs": table.num_glyphs(),
            }))
            .map_err(|e| format!("Failed to serialize maxp table: {}", e))?
        }
        "hhea" => {
            let table = font
                .hhea()
                .map_err(|e| format!("Failed to read hhea table: {:?}", e))?;
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
            let table = font
                .post()
                .map_err(|e| format!("Failed to read post table: {:?}", e))?;
            serde_json::to_string_pretty(&serde_json::json!({
                "version": format!("{:?}", table.version()),
                "italic_angle": table.italic_angle().to_f64(),
                "underline_position": table.underline_position(),
                "underline_thickness": table.underline_thickness(),
                "is_fixed_pitch": table.is_fixed_pitch(),
            }))
            .map_err(|e| format!("Failed to serialize post table: {}", e))?
        }
        "OS/2" | "os2" => {
            let table = font
                .os2()
                .map_err(|e| format!("Failed to read OS/2 table: {:?}", e))?;
            serde_json::to_string_pretty(&serde_json::json!({
                "version": table.version(),
                "x_avg_char_width": table.x_avg_char_width(),
                "us_weight_class": table.us_weight_class(),
                "us_width_class": table.us_width_class(),
                "fs_type": table.fs_type(),
                "y_subscript_x_size": table.y_subscript_x_size(),
                "y_subscript_y_size": table.y_subscript_y_size(),
                "y_subscript_x_offset": table.y_subscript_x_offset(),
                "y_subscript_y_offset": table.y_subscript_y_offset(),
                "y_superscript_x_size": table.y_superscript_x_size(),
                "y_superscript_y_size": table.y_superscript_y_size(),
                "y_superscript_x_offset": table.y_superscript_x_offset(),
                "y_superscript_y_offset": table.y_superscript_y_offset(),
                "y_strikeout_size": table.y_strikeout_size(),
                "y_strikeout_position": table.y_strikeout_position(),
                "s_family_class": table.s_family_class(),
                "sx_height": table.sx_height(),
                "s_cap_height": table.s_cap_height(),
            }))
            .map_err(|e| format!("Failed to serialize OS/2 table: {}", e))?
        }
        "loca" => {
            use skrifa::raw::types::Tag;
            let head = font
                .head()
                .map_err(|e| format!("Failed to read head table: {:?}", e))?;
            let is_long = head.index_to_loc_format() != 0;
            let num_glyphs = font
                .maxp()
                .map_err(|e| format!("Failed to read maxp table: {:?}", e))?
                .num_glyphs() as usize;

            let loca_data = font
                .table_data(Tag::new(b"loca"))
                .ok_or_else(|| "No loca table in font".to_string())?;

            let offsets = parse_loca_offsets(loca_data.as_bytes(), num_glyphs + 1, is_long);

            let entries: Vec<serde_json::Value> = offsets
                .iter()
                .enumerate()
                .map(|(i, &offset)| {
                    let length = if i + 1 < offsets.len() {
                        offsets[i + 1].saturating_sub(offset)
                    } else {
                        0
                    };
                    serde_json::json!({
                        "glyph_id": i,
                        "offset": offset,
                        "length": length,
                    })
                })
                .collect();

            serde_json::to_string_pretty(&serde_json::json!({
                "format": if is_long { "long (32-bit)" } else { "short (16-bit)" },
                "num_glyphs": num_glyphs,
                "entries": entries,
            }))
            .map_err(|e| format!("Failed to serialize loca table: {}", e))?
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

#[derive(Deserialize)]
pub struct HheaTableUpdate {
    pub ascender: i16,
    pub descender: i16,
    pub line_gap: i16,
    pub caret_slope_rise: i16,
    pub caret_slope_run: i16,
    pub caret_offset: i16,
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

    let bytes = cache
        .get(file_path)
        .unwrap_or_else(|| fs::read(file_path).unwrap_or_default());

    if bytes.is_empty() {
        return Err(format!("Failed to read font file: {}", file_path));
    }

    let font = RawFontRef::new(&bytes).map_err(|e| format!("Invalid font file: {:?}", e))?;

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
    fs::write(file_path, &new_bytes).map_err(|e| format!("Failed to write font file: {}", e))?;

    // Invalidate caches
    cache
        .fonts
        .lock()
        .unwrap()
        .insert(file_path.to_string(), new_bytes);
    cache.outlines.lock().unwrap().remove(file_path);

    Ok(())
}

pub fn update_hhea_table(
    file_path: &str,
    updates: &HheaTableUpdate,
    cache: &FontCache,
) -> Result<(), String> {
    use write_fonts::from_obj::ToOwnedTable;
    use write_fonts::tables::hhea::Hhea;
    use write_fonts::FontBuilder;

    let bytes = cache
        .get(file_path)
        .unwrap_or_else(|| fs::read(file_path).unwrap_or_default());

    if bytes.is_empty() {
        return Err(format!("Failed to read font file: {}", file_path));
    }

    let font = RawFontRef::new(&bytes).map_err(|e| format!("Invalid font file: {:?}", e))?;

    let mut hhea: Hhea = font
        .hhea()
        .map_err(|e| format!("Failed to read hhea table: {:?}", e))?
        .to_owned_table();

    hhea.ascender = updates.ascender.into();
    hhea.descender = updates.descender.into();
    hhea.line_gap = updates.line_gap.into();
    hhea.caret_slope_rise = updates.caret_slope_rise;
    hhea.caret_slope_run = updates.caret_slope_run;
    hhea.caret_offset = updates.caret_offset;

    let new_bytes = FontBuilder::new()
        .add_table(&hhea)
        .map_err(|e| format!("Failed to add hhea table: {:?}", e))?
        .copy_missing_tables(font)
        .build();

    fs::write(file_path, &new_bytes).map_err(|e| format!("Failed to write font file: {}", e))?;

    cache
        .fonts
        .lock()
        .unwrap()
        .insert(file_path.to_string(), new_bytes);
    cache.outlines.lock().unwrap().remove(file_path);

    Ok(())
}

#[derive(Deserialize)]
pub struct MaxpTableUpdate {
    pub num_glyphs: u16,
}

pub fn update_maxp_table(
    file_path: &str,
    updates: &MaxpTableUpdate,
    cache: &FontCache,
) -> Result<(), String> {
    use write_fonts::from_obj::ToOwnedTable;
    use write_fonts::tables::maxp::Maxp;
    use write_fonts::FontBuilder;

    let bytes = cache
        .get(file_path)
        .unwrap_or_else(|| fs::read(file_path).unwrap_or_default());

    if bytes.is_empty() {
        return Err(format!("Failed to read font file: {}", file_path));
    }

    let font = RawFontRef::new(&bytes).map_err(|e| format!("Invalid font file: {:?}", e))?;

    let mut maxp: Maxp = font
        .maxp()
        .map_err(|e| format!("Failed to read maxp table: {:?}", e))?
        .to_owned_table();

    maxp.num_glyphs = updates.num_glyphs;

    let new_bytes = FontBuilder::new()
        .add_table(&maxp)
        .map_err(|e| format!("Failed to add maxp table: {:?}", e))?
        .copy_missing_tables(font)
        .build();

    fs::write(file_path, &new_bytes).map_err(|e| format!("Failed to write font file: {}", e))?;

    cache
        .fonts
        .lock()
        .unwrap()
        .insert(file_path.to_string(), new_bytes);
    cache.outlines.lock().unwrap().remove(file_path);

    Ok(())
}

#[derive(Deserialize)]
pub struct NameTableUpdate {
    pub name_id: u16,
    pub platform_id: u16,
    pub value: String,
}

pub fn update_name_table(
    file_path: &str,
    updates: &NameTableUpdate,
    cache: &FontCache,
) -> Result<(), String> {
    use write_fonts::tables::name::{Name, NameRecord};
    use write_fonts::FontBuilder;

    let bytes = cache
        .get(file_path)
        .unwrap_or_else(|| fs::read(file_path).unwrap_or_default());

    if bytes.is_empty() {
        return Err(format!("Failed to read font file: {}", file_path));
    }

    let font = RawFontRef::new(&bytes).map_err(|e| format!("Invalid font file: {:?}", e))?;

    let name_table = font
        .name()
        .map_err(|e| format!("Failed to read name table: {:?}", e))?;

    let mut new_records = Vec::new();
    let mut found = false;

    for record in name_table.name_record().iter() {
        if record.name_id().to_u16() == updates.name_id
            && record.platform_id() == updates.platform_id
        {
            let new_record = NameRecord {
                platform_id: record.platform_id.get(),
                encoding_id: record.encoding_id.get(),
                language_id: record.language_id.get(),
                name_id: record.name_id().to_u16().into(),
                string: updates.value.clone().into(),
            };
            new_records.push(new_record);
            found = true;
        } else {
            let existing_string = record
                .string(name_table.string_data())
                .map(|s| s.chars().collect::<String>())
                .unwrap_or_default();
            let new_record = NameRecord {
                platform_id: record.platform_id.get(),
                encoding_id: record.encoding_id.get(),
                language_id: record.language_id.get(),
                name_id: record.name_id().to_u16().into(),
                string: existing_string.into(),
            };
            new_records.push(new_record);
        }
    }

    if !found {
        return Err(format!(
            "No name record found for name_id={} platform_id={}",
            updates.name_id, updates.platform_id
        ));
    }

    let new_name = Name::new(new_records);

    let new_bytes = FontBuilder::new()
        .add_table(&new_name)
        .map_err(|e| format!("Failed to add name table: {:?}", e))?
        .copy_missing_tables(font)
        .build();

    fs::write(file_path, &new_bytes).map_err(|e| format!("Failed to write font file: {}", e))?;

    cache
        .fonts
        .lock()
        .unwrap()
        .insert(file_path.to_string(), new_bytes);
    cache.outlines.lock().unwrap().remove(file_path);

    Ok(())
}

// ── Composite offset update ───────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CompositeOffsetUpdate {
    // pub glyph_id: u32,
    pub x_offset: f32,
    pub y_offset: f32,
}

/// Rebuild a composite glyph's binary representation with updated x/y offsets.
/// `updates` are matched positionally to component records in the original data.
fn patch_composite_glyph_offsets(
    glyph_data: &[u8],
    updates: &[CompositeOffsetUpdate],
) -> Result<Vec<u8>, String> {
    const MORE_COMPONENTS: u16 = 0x0020;
    const ARG_1_AND_2_ARE_WORDS: u16 = 0x0001;
    const ARGS_ARE_XY_VALUES: u16 = 0x0002;
    const WE_HAVE_A_SCALE: u16 = 0x0008;
    const WE_HAVE_AN_X_AND_Y_SCALE: u16 = 0x0040;
    const WE_HAVE_A_TWO_BY_TWO: u16 = 0x0080;

    if glyph_data.len() < 10 {
        return Err("Composite glyph data too short".into());
    }

    // Copy the 10-byte glyph header verbatim
    let mut output = glyph_data[..10].to_vec();
    let mut pos = 10;
    let mut comp_index = 0usize;

    loop {
        if pos + 4 > glyph_data.len() {
            break;
        }
        let flags = u16::from_be_bytes([glyph_data[pos], glyph_data[pos + 1]]);
        let component_glyph_id = u16::from_be_bytes([glyph_data[pos + 2], glyph_data[pos + 3]]);
        pos += 4;

        // Parse existing args to get current offset (for fallback if no update)
        let (cur_x, cur_y) = if flags & ARG_1_AND_2_ARE_WORDS != 0 {
            if pos + 4 > glyph_data.len() {
                return Err("Malformed composite glyph".into());
            }
            let arg1 = i16::from_be_bytes([glyph_data[pos], glyph_data[pos + 1]]);
            let arg2 = i16::from_be_bytes([glyph_data[pos + 2], glyph_data[pos + 3]]);
            pos += 4;
            if flags & ARGS_ARE_XY_VALUES != 0 {
                (arg1 as f32, arg2 as f32)
            } else {
                (0.0_f32, 0.0_f32)
            }
        } else {
            if pos + 2 > glyph_data.len() {
                return Err("Malformed composite glyph".into());
            }
            let arg1 = glyph_data[pos] as i8;
            let arg2 = glyph_data[pos + 1] as i8;
            pos += 2;
            if flags & ARGS_ARE_XY_VALUES != 0 {
                (arg1 as f32, arg2 as f32)
            } else {
                (0.0_f32, 0.0_f32)
            }
        };

        // Use provided update or fall back to current values
        let (new_x, new_y) = if let Some(update) = updates.get(comp_index) {
            (update.x_offset, update.y_offset)
        } else {
            (cur_x, cur_y)
        };

        // Determine if word-size args are needed
        let needs_words = !(-128.0..=127.0).contains(&new_x) || !(-128.0..=127.0).contains(&new_y);

        let mut new_flags = flags | ARGS_ARE_XY_VALUES;
        if needs_words {
            new_flags |= ARG_1_AND_2_ARE_WORDS;
        } else {
            new_flags &= !ARG_1_AND_2_ARE_WORDS;
        }

        output.extend(new_flags.to_be_bytes());
        output.extend(component_glyph_id.to_be_bytes());
        if needs_words {
            output.extend((new_x.round() as i16).to_be_bytes());
            output.extend((new_y.round() as i16).to_be_bytes());
        } else {
            output.push(new_x.round() as i8 as u8);
            output.push(new_y.round() as i8 as u8);
        }

        // Copy transform data verbatim
        let transform_start = pos;
        if flags & WE_HAVE_A_TWO_BY_TWO != 0 {
            pos += 8;
        } else if flags & WE_HAVE_AN_X_AND_Y_SCALE != 0 {
            pos += 4;
        } else if flags & WE_HAVE_A_SCALE != 0 {
            pos += 2;
        }
        output.extend_from_slice(&glyph_data[transform_start..pos]);

        comp_index += 1;

        if flags & MORE_COMPONENTS == 0 {
            // Copy any trailing instruction data
            if pos < glyph_data.len() {
                output.extend_from_slice(&glyph_data[pos..]);
            }
            break;
        }
    }

    Ok(output)
}

pub fn update_composite_offsets(
    file_path: &str,
    composite_glyph_id: u32,
    components: Vec<CompositeOffsetUpdate>,
    cache: &FontCache,
) -> Result<(), String> {
    let bytes = cache
        .get(file_path)
        .unwrap_or_else(|| fs::read(file_path).unwrap_or_default());
    if bytes.is_empty() {
        return Err(format!("Failed to read font file: {}", file_path));
    }

    let font = RawFontRef::new(&bytes).map_err(|e| format!("Invalid font file: {:?}", e))?;
    use skrifa::raw::types::Tag;
    let head = font.head().map_err(|e| format!("head: {:?}", e))?;
    let is_long = head.index_to_loc_format() != 0;
    let num_glyphs = font
        .maxp()
        .map_err(|e| format!("maxp: {:?}", e))?
        .num_glyphs() as usize;

    let loca_data = font
        .table_data(Tag::new(b"loca"))
        .ok_or_else(|| "No loca table in font".to_string())?;
    let glyf_data = font
        .table_data(Tag::new(b"glyf"))
        .ok_or_else(|| "No glyf table in font".to_string())?;

    let glyf = glyf_data.as_bytes();
    let offsets = parse_loca_offsets(loca_data.as_bytes(), num_glyphs + 1, is_long);
    let glyph_id = composite_glyph_id as usize;

    if glyph_id >= num_glyphs {
        return Err(format!("Glyph ID {} out of range", composite_glyph_id));
    }

    let start = offsets[glyph_id] as usize;
    let end = if glyph_id + 1 < offsets.len() {
        offsets[glyph_id + 1] as usize
    } else {
        glyf.len()
    };

    if start >= end || end > glyf.len() {
        return Err(format!(
            "Glyph {} not found in glyf table",
            composite_glyph_id
        ));
    }

    let new_glyph_bytes = patch_composite_glyph_offsets(&glyf[start..end], &components)?;

    let (new_glyf, new_loca) = rebuild_glyf_with_patch(
        glyf,
        &offsets,
        glyph_id,
        &new_glyph_bytes,
        is_long,
        num_glyphs,
    )?;

    use write_fonts::types::Tag as WTag;
    use write_fonts::FontBuilder;

    let new_bytes = FontBuilder::new()
        .add_raw(WTag::new(b"glyf"), new_glyf)
        .add_raw(WTag::new(b"loca"), new_loca)
        .copy_missing_tables(font)
        .build();

    fs::write(file_path, &new_bytes).map_err(|e| format!("Failed to write font: {}", e))?;

    cache
        .fonts
        .lock()
        .unwrap()
        .insert(file_path.to_string(), new_bytes);
    cache.outlines.lock().unwrap().remove(file_path);

    Ok(())
}

// ── Glyph outline save ────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct SaveGlyphOutlineArgs {
    pub glyph_id: u32,
    /// SVG path string in the same format the backend produces (Y negated).
    pub svg_path: String,
    /// "glyf", "CFF ", or "CFF2"
    pub table_name: String,
}

#[allow(dead_code)]
enum SvgCmd {
    MoveTo(f32, f32),
    LineTo(f32, f32),
    QuadTo(f32, f32, f32, f32),
    CurveTo(f32, f32, f32, f32, f32, f32),
    Close,
}

/// Tokenise an SVG path string into command letters and number strings.
/// Handles whitespace/comma separators, negative numbers, and scientific notation.
fn tokenize_svg_path(path: &str) -> Vec<String> {
    let mut tokens: Vec<String> = Vec::new();
    let mut chars = path.chars().peekable();

    while let Some(&c) = chars.peek() {
        match c {
            'M' | 'm' | 'L' | 'l' | 'Q' | 'q' | 'C' | 'c' | 'Z' | 'z' => {
                tokens.push(c.to_string());
                chars.next();
            }
            '0'..='9' | '.' => {
                let mut s = String::new();
                while let Some(&d) = chars.peek() {
                    if d.is_ascii_digit() || d == '.' {
                        s.push(d);
                        chars.next();
                    } else if (d == 'e' || d == 'E') && !s.is_empty() {
                        s.push(d);
                        chars.next();
                        if let Some(&sign) = chars.peek() {
                            if sign == '+' || sign == '-' {
                                s.push(sign);
                                chars.next();
                            }
                        }
                    } else {
                        break;
                    }
                }
                if !s.is_empty() {
                    tokens.push(s);
                }
            }
            '-' | '+' => {
                let mut s = String::new();
                s.push(c);
                chars.next();
                while let Some(&d) = chars.peek() {
                    if d.is_ascii_digit() || d == '.' {
                        s.push(d);
                        chars.next();
                    } else if (d == 'e' || d == 'E') && s.len() > 1 {
                        s.push(d);
                        chars.next();
                        if let Some(&sign) = chars.peek() {
                            if sign == '+' || sign == '-' {
                                s.push(sign);
                                chars.next();
                            }
                        }
                    } else {
                        break;
                    }
                }
                // Only push if it's actually a number (more than just the sign)
                if s.len() > 1 {
                    tokens.push(s);
                }
            }
            ' ' | '\t' | '\n' | '\r' | ',' => {
                chars.next();
            }
            _ => {
                chars.next();
            }
        }
    }
    tokens
}

fn parse_svg_path_cmds(path: &str) -> Result<Vec<SvgCmd>, String> {
    let tokens = tokenize_svg_path(path);

    let mut cmds = Vec::new();
    let mut i = 0usize;

    let next_f = |idx: &mut usize| -> Result<f32, String> {
        let s = tokens
            .get(*idx)
            .ok_or_else(|| "unexpected end of path".to_string())?;
        *idx += 1;
        s.parse::<f32>()
            .map_err(|e| format!("bad number '{}': {}", s, e))
    };

    while i < tokens.len() {
        match tokens[i].as_str() {
            "M" | "m" => {
                i += 1;
                let x = next_f(&mut i)?;
                // Y in svg_path is already negated (-y_font); negate again → font-space Y-up
                let y = -next_f(&mut i)?;
                cmds.push(SvgCmd::MoveTo(x, y));
            }
            "L" | "l" => {
                i += 1;
                let x = next_f(&mut i)?;
                let y = -next_f(&mut i)?;
                cmds.push(SvgCmd::LineTo(x, y));
            }
            "Q" | "q" => {
                i += 1;
                let cx = next_f(&mut i)?;
                let cy = -next_f(&mut i)?;
                let x = next_f(&mut i)?;
                let y = -next_f(&mut i)?;
                cmds.push(SvgCmd::QuadTo(cx, cy, x, y));
            }
            "C" | "c" => {
                i += 1;
                let cx1 = next_f(&mut i)?;
                let cy1 = -next_f(&mut i)?;
                let cx2 = next_f(&mut i)?;
                let cy2 = -next_f(&mut i)?;
                let x = next_f(&mut i)?;
                let y = -next_f(&mut i)?;
                cmds.push(SvgCmd::CurveTo(cx1, cy1, cx2, cy2, x, y));
            }
            "Z" | "z" => {
                i += 1;
                cmds.push(SvgCmd::Close);
            }
            _ => {
                i += 1; // skip unrecognised token
            }
        }
    }
    Ok(cmds)
}

/// Build raw TrueType SimpleGlyph bytes from a list of SVG-derived path commands.
/// All Y values must already be in font-space (Y-up).
/// Returns empty Vec for empty paths (space glyph).
fn build_glyf_glyph_bytes(cmds: &[SvgCmd]) -> Result<Vec<u8>, String> {
    // points per contour: (x_font, y_font, is_on_curve)
    let mut contours: Vec<Vec<(i16, i16, bool)>> = Vec::new();
    let mut cur: Vec<(i16, i16, bool)> = Vec::new();

    for cmd in cmds {
        match cmd {
            SvgCmd::MoveTo(x, y) => {
                if !cur.is_empty() {
                    contours.push(std::mem::take(&mut cur));
                }
                cur.push((x.round() as i16, y.round() as i16, true));
            }
            SvgCmd::LineTo(x, y) => {
                cur.push((x.round() as i16, y.round() as i16, true));
            }
            SvgCmd::QuadTo(cx, cy, x, y) => {
                cur.push((cx.round() as i16, cy.round() as i16, false));
                cur.push((x.round() as i16, y.round() as i16, true));
            }
            SvgCmd::CurveTo(..) => {
                return Err("Cubic Bézier (C) not supported in glyf table. \
                    Use a CFF font for cubic curves."
                    .into());
            }
            SvgCmd::Close => {
                if !cur.is_empty() {
                    contours.push(std::mem::take(&mut cur));
                }
            }
        }
    }
    if !cur.is_empty() {
        contours.push(cur);
    }
    if contours.is_empty() {
        return Ok(Vec::new());
    }

    // Flatten
    let mut pts: Vec<(i16, i16, bool)> = Vec::new();
    let mut end_pts: Vec<u16> = Vec::new();
    for c in &contours {
        pts.extend_from_slice(c);
        end_pts.push((pts.len() - 1) as u16);
    }

    let x_min = pts.iter().map(|p| p.0).min().unwrap();
    let x_max = pts.iter().map(|p| p.0).max().unwrap();
    let y_min = pts.iter().map(|p| p.1).min().unwrap();
    let y_max = pts.iter().map(|p| p.1).max().unwrap();

    let mut buf: Vec<u8> = Vec::new();

    // numberOfContours (big-endian i16)
    buf.extend((contours.len() as i16).to_be_bytes());
    // bounding box
    buf.extend(x_min.to_be_bytes());
    buf.extend(y_min.to_be_bytes());
    buf.extend(x_max.to_be_bytes());
    buf.extend(y_max.to_be_bytes());
    // endPtsOfContours
    for ep in &end_pts {
        buf.extend(ep.to_be_bytes());
    }
    // instructionLength = 0
    buf.extend(0u16.to_be_bytes());
    // flags (uncompressed: no SHORT_VECTOR bits)
    for &(_, _, on) in &pts {
        buf.push(if on { 0x01 } else { 0x00 });
    }
    // x-coordinates (relative i16 deltas, big-endian)
    let mut prev: i16 = 0;
    for &(x, _, _) in &pts {
        let d = x - prev;
        buf.extend(d.to_be_bytes());
        prev = x;
    }
    // y-coordinates (relative i16 deltas, big-endian)
    prev = 0;
    for &(_, y, _) in &pts {
        let d = y - prev;
        buf.extend(d.to_be_bytes());
        prev = y;
    }

    Ok(buf)
}

fn parse_loca_offsets(loca: &[u8], n_plus_one: usize, is_long: bool) -> Vec<u32> {
    let mut v = Vec::with_capacity(n_plus_one);
    if is_long {
        for i in 0..n_plus_one {
            let b = i * 4;
            if b + 4 > loca.len() {
                v.push(0);
                continue;
            }
            v.push(u32::from_be_bytes([
                loca[b],
                loca[b + 1],
                loca[b + 2],
                loca[b + 3],
            ]));
        }
    } else {
        for i in 0..n_plus_one {
            let b = i * 2;
            if b + 2 > loca.len() {
                v.push(0);
                continue;
            }
            v.push(u16::from_be_bytes([loca[b], loca[b + 1]]) as u32 * 2);
        }
    }
    v
}

fn rebuild_glyf_with_patch(
    glyf: &[u8],
    offsets: &[u32], // n+1 entries
    glyph_id: usize,
    new_glyph: &[u8],
    is_long: bool,
    target_num_glyphs: usize,
) -> Result<(Vec<u8>, Vec<u8>), String> {
    let current_num = offsets.len().saturating_sub(1);
    let mut new_glyf: Vec<u8> = Vec::new();
    let mut new_offsets: Vec<u32> = Vec::with_capacity(target_num_glyphs + 1);

    // Copy existing glyphs and add new one at the right position
    for i in 0..target_num_glyphs {
        new_offsets.push(new_glyf.len() as u32);

        if i == glyph_id {
            // Insert the new/modified glyph
            new_glyf.extend_from_slice(new_glyph);
        } else if i < current_num {
            // Copy existing glyph
            let start = offsets[i] as usize;
            let end = offsets[i + 1] as usize;
            if start < end && end <= glyf.len() {
                new_glyf.extend_from_slice(&glyf[start..end]);
            }
            // Empty glyph (start == end) - nothing to copy
        }
        // Pad to 4-byte boundary (required by OpenType spec)
        while !new_glyf.len().is_multiple_of(4) {
            new_glyf.push(0);
        }
    }
    new_offsets.push(new_glyf.len() as u32); // sentinel

    // Build loca bytes
    let new_loca = if is_long {
        let mut v: Vec<u8> = Vec::with_capacity(new_offsets.len() * 4);
        for &o in &new_offsets {
            v.extend(o.to_be_bytes());
        }
        v
    } else {
        // Short loca stores offset/2 as uint16
        let mut v: Vec<u8> = Vec::with_capacity(new_offsets.len() * 2);
        for &o in &new_offsets {
            if o > 0x1FFFE {
                return Err("glyf table too large for short loca format".into());
            }
            v.extend(((o / 2) as u16).to_be_bytes());
        }
        v
    };

    Ok((new_glyf, new_loca))
}

/// Extend hmtx table with new entries for added glyphs
fn extend_hmtx(
    hmtx_data: &[u8],
    current_num_glyphs: usize,
    target_num_glyphs: usize,
    num_h_metrics: u16,
    default_advance_width: u16,
) -> Vec<u8> {
    // hmtx format: num_h_metrics entries of (advance_width: u16, lsb: i16)
    // followed by (num_glyphs - num_h_metrics) entries of just (lsb: i16)

    let mut new_hmtx =
        Vec::with_capacity(hmtx_data.len() + (target_num_glyphs - current_num_glyphs) * 2);
    new_hmtx.extend_from_slice(hmtx_data);

    let num_h_metrics = num_h_metrics as usize;

    // Get the last advance width from the hmtx table
    let _last_aw = if num_h_metrics > 0 && hmtx_data.len() >= num_h_metrics * 4 {
        let offset = (num_h_metrics - 1) * 4;
        u16::from_be_bytes([hmtx_data[offset], hmtx_data[offset + 1]])
    } else {
        default_advance_width
    };

    // Add new entries
    for _ in current_num_glyphs..target_num_glyphs {
        // For glyphs beyond num_h_metrics, only lsb is stored (2 bytes)
        // They use the last advance_width from the metrics portion
        new_hmtx.extend(0i16.to_be_bytes()); // lsb = 0
    }

    new_hmtx
}

/// Calculate xAvgCharWidth for OS/2 table
fn calculate_x_avg_char_width(bytes: &[u8], num_glyphs: u16) -> i16 {
    let font = match RawFontRef::new(bytes) {
        Ok(f) => f,
        Err(_) => return 0,
    };

    let glyph_metrics = font.glyph_metrics(
        skrifa::instance::Size::unscaled(),
        skrifa::instance::LocationRef::default(),
    );

    let mut total_width: i32 = 0;
    let mut count: i32 = 0;

    for gid in 0..num_glyphs {
        if let Some(aw) = glyph_metrics.advance_width(GlyphId::from(gid as u32)) {
            total_width += aw as i32;
            count += 1;
        }
    }

    if count > 0 {
        (total_width / count) as i16
    } else {
        0
    }
}

pub fn save_glyph_outline(
    file_path: &str,
    args: &SaveGlyphOutlineArgs,
    cache: &FontCache,
) -> Result<(), String> {
    let table = args.table_name.trim();
    if table != "glyf" {
        return Err(format!(
            "Saving '{}' outlines is not yet supported. Only the glyf table can be saved.",
            table
        ));
    }

    let bytes = cache
        .get(file_path)
        .unwrap_or_else(|| fs::read(file_path).unwrap_or_default());
    if bytes.is_empty() {
        return Err(format!("Failed to read font file: {}", file_path));
    }

    let font = RawFontRef::new(&bytes).map_err(|e| format!("Invalid font file: {:?}", e))?;

    // Parse the SVG path back to font-space points
    let cmds = parse_svg_path_cmds(&args.svg_path)?;
    let new_glyph_bytes = build_glyf_glyph_bytes(&cmds)?;

    // Read loca + glyf raw bytes
    use skrifa::raw::types::Tag;
    let head = font.head().map_err(|e| format!("head: {:?}", e))?;
    let is_long = head.index_to_loc_format() != 0;
    let num_glyphs = font
        .maxp()
        .map_err(|e| format!("maxp: {:?}", e))?
        .num_glyphs() as usize;

    let loca_data = font
        .table_data(Tag::new(b"loca"))
        .ok_or_else(|| "No loca table in font".to_string())?;
    let glyf_data = font
        .table_data(Tag::new(b"glyf"))
        .ok_or_else(|| "No glyf table in font".to_string())?;

    let offsets = parse_loca_offsets(loca_data.as_bytes(), num_glyphs + 1, is_long);

    // Determine if we're adding a new glyph or modifying an existing one
    let is_new_glyph = args.glyph_id as usize >= num_glyphs;
    let target_num_glyphs = if is_new_glyph {
        (args.glyph_id + 1) as usize
    } else {
        num_glyphs
    };

    if target_num_glyphs > 65535 {
        return Err(format!(
            "glyph_id {} exceeds maximum (65535)",
            args.glyph_id
        ));
    }

    let (new_glyf, new_loca) = rebuild_glyf_with_patch(
        glyf_data.as_bytes(),
        &offsets,
        args.glyph_id as usize,
        &new_glyph_bytes,
        is_long,
        target_num_glyphs,
    )?;

    // Get hhea for number_of_h_metrics and default advance width
    let hhea = font.hhea().map_err(|e| format!("hhea: {:?}", e))?;
    let num_h_metrics = hhea.number_of_h_metrics() as usize;
    let default_aw = hhea.advance_width_max().to_u16();

    // Extend hmtx if adding new glyphs
    let new_hmtx = if is_new_glyph {
        let hmtx_data = font
            .table_data(Tag::new(b"hmtx"))
            .ok_or_else(|| "No hmtx table in font".to_string())?;
        extend_hmtx(
            hmtx_data.as_bytes(),
            num_glyphs,
            target_num_glyphs,
            num_h_metrics as u16,
            default_aw,
        )
    } else {
        font.table_data(Tag::new(b"hmtx"))
            .map(|d| d.as_bytes().to_vec())
            .unwrap_or_default()
    };

    // Rebuild font with patched tables
    use write_fonts::from_obj::ToOwnedTable;
    use write_fonts::tables::maxp::Maxp;
    use write_fonts::types::Tag as WTag;
    use write_fonts::FontBuilder;

    // Build intermediate font with updated tables
    let intermediate_bytes = if is_new_glyph {
        let mut maxp: Maxp = font
            .maxp()
            .map_err(|e| format!("maxp: {:?}", e))?
            .to_owned_table();
        maxp.num_glyphs = target_num_glyphs as u16;

        FontBuilder::new()
            .add_raw(WTag::new(b"glyf"), new_glyf)
            .add_raw(WTag::new(b"loca"), new_loca)
            .add_raw(WTag::new(b"hmtx"), new_hmtx)
            .add_table(&maxp)
            .map_err(|e| format!("Failed to add maxp: {:?}", e))?
            .copy_missing_tables(font)
            .build()
    } else {
        FontBuilder::new()
            .add_raw(WTag::new(b"glyf"), new_glyf)
            .add_raw(WTag::new(b"loca"), new_loca)
            .add_raw(WTag::new(b"hmtx"), new_hmtx)
            .copy_missing_tables(font)
            .build()
    };

    // Recalculate OS/2 xAvgCharWidth after font rebuild
    let final_bytes = if is_new_glyph {
        let new_font = RawFontRef::new(&intermediate_bytes)
            .map_err(|e| format!("Failed to parse rebuilt font: {:?}", e))?;

        let x_avg = calculate_x_avg_char_width(&intermediate_bytes, target_num_glyphs as u16);

        // Update OS/2 table with new xAvgCharWidth
        if let Ok(os2) = new_font.os2() {
            use write_fonts::tables::os2::Os2;
            let mut new_os2: Os2 = os2.to_owned_table();
            new_os2.x_avg_char_width = x_avg;

            FontBuilder::new()
                .add_table(&new_os2)
                .map_err(|e| format!("Failed to add OS/2: {:?}", e))?
                .copy_missing_tables(new_font)
                .build()
        } else {
            intermediate_bytes
        }
    } else {
        intermediate_bytes
    };

    fs::write(file_path, &final_bytes).map_err(|e| format!("Failed to write font: {}", e))?;

    // Invalidate caches
    cache
        .fonts
        .lock()
        .unwrap()
        .insert(file_path.to_string(), final_bytes);
    cache.outlines.lock().unwrap().remove(file_path);

    Ok(())
}

pub fn check_font_hinting(file_path: &str, cache: &FontCache) -> Result<HintingInfo, String> {
    let bytes = cache
        .get(file_path)
        .unwrap_or_else(|| fs::read(file_path).unwrap_or_default());
    if bytes.is_empty() {
        return Ok(HintingInfo { is_hinted: false, hint_format: None });
    }
    let font = FontRef::new(&bytes).map_err(|e| format!("{:?}", e))?;

    // TrueType: any of fpgm / prep / cvt_ exists and is non-empty
    let has_tt = [b"fpgm", b"prep", b"cvt "].iter().any(|tag| {
        use skrifa::raw::types::Tag;
        font.table_data(Tag::new(*tag))
            .map(|d| !d.as_bytes().is_empty())
            .unwrap_or(false)
    });
    if has_tt {
        return Ok(HintingInfo {
            is_hinted: true,
            hint_format: Some("truetype".into()),
        });
    }

    // CFF: presence of "CFF " table (PostScript fonts embed hint data in Private Dict)
    {
        use skrifa::raw::types::Tag;
        if font.table_data(Tag::new(b"CFF ")).is_some() {
            return Ok(HintingInfo {
                is_hinted: true,
                hint_format: Some("cff".into()),
            });
        }
    }

    Ok(HintingInfo { is_hinted: false, hint_format: None })
}

fn draw_hinted_glyph_svgs(
    bytes: &[u8],
    glyph_id: u32,
    px_sizes: &[f32],
) -> Result<Vec<String>, String> {
    let font = FontRef::new(bytes).map_err(|e| format!("{:?}", e))?;
    let outlines = font.outline_glyphs();
    let glyph = outlines
        .get(GlyphId::from(glyph_id))
        .ok_or_else(|| "Glyph not found".to_string())?;

    let options = HintingOptions {
        engine: Engine::Interpreter,
        target: Target::Mono,
    };

    let mut results = Vec::new();
    for &ppem in px_sizes {
        let instance = HintingInstance::new(
            &outlines,
            skrifa::instance::Size::new(ppem),
            skrifa::instance::LocationRef::default(),
            options.clone(),
        )
        .map_err(|e| format!("Hint init {}px: {:?}", ppem, e))?;

        let settings = DrawSettings::hinted(&instance, false);
        let mut pen = SvgPathPen::new();
        let _ = glyph.draw(settings, &mut pen);
        results.push(pen.into_path());
    }
    Ok(results)
}

pub fn get_hinted_glyph_outlines(
    file_path: &str,
    glyph_id: u32,
    px_sizes: Vec<f32>,
    cache: &FontCache,
) -> Result<Vec<String>, String> {
    let bytes = cache
        .get(file_path)
        .unwrap_or_else(|| fs::read(file_path).unwrap_or_default());
    if bytes.is_empty() {
        return Err(format!("Failed to read font file: {}", file_path));
    }
    draw_hinted_glyph_svgs(&bytes, glyph_id, &px_sizes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tokenize_svg_path_empty() {
        let tokens = tokenize_svg_path("");
        assert!(tokens.is_empty());
    }

    #[test]
    fn test_tokenize_svg_path_whitespace_only() {
        let tokens = tokenize_svg_path("   \t\n  ");
        assert!(tokens.is_empty());
    }

    #[test]
    fn test_tokenize_svg_path_single_move() {
        let tokens = tokenize_svg_path("M 100 200");
        assert_eq!(tokens, vec!["M", "100", "200"]);
    }

    #[test]
    fn test_tokenize_svg_path_move_line() {
        let tokens = tokenize_svg_path("M 0 0 L 100 0");
        assert_eq!(tokens, vec!["M", "0", "0", "L", "100", "0"]);
    }

    #[test]
    fn test_tokenize_svg_path_negative_numbers() {
        let tokens = tokenize_svg_path("M -100 -200 L 50 -50");
        assert_eq!(tokens, vec!["M", "-100", "-200", "L", "50", "-50"]);
    }

    #[test]
    fn test_tokenize_svg_path_decimals() {
        let tokens = tokenize_svg_path("M 10.5 20.75 L 30.25 40.5");
        assert_eq!(tokens, vec!["M", "10.5", "20.75", "L", "30.25", "40.5"]);
    }

    #[test]
    fn test_tokenize_svg_path_scientific_notation() {
        let tokens = tokenize_svg_path("M 1e2 2E-1 L 3e+1 4E0");
        assert_eq!(tokens, vec!["M", "1e2", "2E-1", "L", "3e+1", "4E0"]);
    }

    #[test]
    fn test_tokenize_svg_path_comma_separator() {
        let tokens = tokenize_svg_path("M 0,0 L 100,0");
        assert_eq!(tokens, vec!["M", "0", "0", "L", "100", "0"]);
    }

    #[test]
    fn test_tokenize_svg_path_quadratic() {
        let tokens = tokenize_svg_path("M 0 0 Q 50 100 100 0");
        assert_eq!(tokens, vec!["M", "0", "0", "Q", "50", "100", "100", "0"]);
    }

    #[test]
    fn test_tokenize_svg_path_cubic() {
        let tokens = tokenize_svg_path("M 0 0 C 25 100 75 100 100 0");
        assert_eq!(
            tokens,
            vec!["M", "0", "0", "C", "25", "100", "75", "100", "100", "0"]
        );
    }

    #[test]
    fn test_tokenize_svg_path_close() {
        let tokens = tokenize_svg_path("M 0 0 L 100 0 Z");
        assert_eq!(tokens, vec!["M", "0", "0", "L", "100", "0", "Z"]);
    }

    #[test]
    fn test_tokenize_svg_path_lowercase() {
        let tokens = tokenize_svg_path("m 100 200 l 300 400 z");
        assert_eq!(tokens, vec!["m", "100", "200", "l", "300", "400", "z"]);
    }

    #[test]
    fn test_parse_svg_path_cmds_empty() {
        let result = parse_svg_path_cmds("");
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[test]
    fn test_parse_svg_path_cmds_move_to() {
        let result = parse_svg_path_cmds("M 100 200");
        assert!(result.is_ok());
        let cmds = result.unwrap();
        assert_eq!(cmds.len(), 1);
        assert!(matches!(cmds[0], SvgCmd::MoveTo(100.0, -200.0)));
    }

    #[test]
    fn test_parse_svg_path_cmds_line_to() {
        let result = parse_svg_path_cmds("M 0 0 L 100 0");
        assert!(result.is_ok());
        let cmds = result.unwrap();
        assert_eq!(cmds.len(), 2);
        assert!(matches!(cmds[0], SvgCmd::MoveTo(0.0, 0.0)));
        assert!(matches!(cmds[1], SvgCmd::LineTo(100.0, 0.0)));
    }

    #[test]
    fn test_parse_svg_path_cmds_quad_to() {
        let result = parse_svg_path_cmds("M 0 0 Q 50 100 100 0");
        assert!(result.is_ok());
        let cmds = result.unwrap();
        assert_eq!(cmds.len(), 2);
        if let SvgCmd::QuadTo(cx, cy, x, y) = &cmds[1] {
            assert_eq!(*cx, 50.0);
            assert_eq!(*cy, -100.0);
            assert_eq!(*x, 100.0);
            assert_eq!(*y, 0.0);
        } else {
            panic!("Expected QuadTo");
        }
    }

    #[test]
    fn test_parse_svg_path_cmds_curve_to() {
        let result = parse_svg_path_cmds("M 0 0 C 25 100 75 100 100 0");
        assert!(result.is_ok());
        let cmds = result.unwrap();
        assert_eq!(cmds.len(), 2);
        if let SvgCmd::CurveTo(cx1, cy1, cx2, cy2, x, y) = &cmds[1] {
            assert_eq!(*cx1, 25.0);
            assert_eq!(*cy1, -100.0);
            assert_eq!(*cx2, 75.0);
            assert_eq!(*cy2, -100.0);
            assert_eq!(*x, 100.0);
            assert_eq!(*y, 0.0);
        } else {
            panic!("Expected CurveTo");
        }
    }

    #[test]
    fn test_parse_svg_path_cmds_close() {
        let result = parse_svg_path_cmds("M 0 0 L 100 0 Z");
        assert!(result.is_ok());
        let cmds = result.unwrap();
        assert_eq!(cmds.len(), 3);
        assert!(matches!(cmds[2], SvgCmd::Close));
    }

    #[test]
    fn test_parse_svg_path_cmds_y_negation() {
        let result = parse_svg_path_cmds("M 0 -100");
        assert!(result.is_ok());
        let cmds = result.unwrap();
        if let SvgCmd::MoveTo(_, y) = &cmds[0] {
            assert_eq!(*y, 100.0);
        } else {
            panic!("Expected MoveTo");
        }
    }

    #[test]
    fn test_build_glyf_glyph_bytes_empty() {
        let result = build_glyf_glyph_bytes(&[]);
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[test]
    fn test_build_glyf_glyph_bytes_simple_line() {
        let cmds = vec![
            SvgCmd::MoveTo(0.0, 0.0),
            SvgCmd::LineTo(100.0, 0.0),
            SvgCmd::LineTo(100.0, 200.0),
            SvgCmd::Close,
        ];
        let result = build_glyf_glyph_bytes(&cmds);
        assert!(result.is_ok());
        let bytes = result.unwrap();
        assert!(!bytes.is_empty());

        let num_contours = i16::from_be_bytes([bytes[0], bytes[1]]);
        assert_eq!(num_contours, 1);
    }

    #[test]
    fn test_build_glyf_glyph_bytes_quadratic() {
        let cmds = vec![
            SvgCmd::MoveTo(0.0, 0.0),
            SvgCmd::QuadTo(50.0, 100.0, 100.0, 0.0),
            SvgCmd::Close,
        ];
        let result = build_glyf_glyph_bytes(&cmds);
        assert!(result.is_ok());
        let bytes = result.unwrap();
        assert!(!bytes.is_empty());
    }

    #[test]
    fn test_build_glyf_glyph_bytes_cubic_error() {
        let cmds = vec![
            SvgCmd::MoveTo(0.0, 0.0),
            SvgCmd::CurveTo(25.0, 100.0, 75.0, 100.0, 100.0, 0.0),
        ];
        let result = build_glyf_glyph_bytes(&cmds);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Cubic"));
    }

    #[test]
    fn test_build_glyf_glyph_bytes_multiple_contours() {
        let cmds = vec![
            SvgCmd::MoveTo(0.0, 0.0),
            SvgCmd::LineTo(10.0, 0.0),
            SvgCmd::Close,
            SvgCmd::MoveTo(100.0, 100.0),
            SvgCmd::LineTo(110.0, 100.0),
            SvgCmd::Close,
        ];
        let result = build_glyf_glyph_bytes(&cmds);
        assert!(result.is_ok());
        let bytes = result.unwrap();

        let num_contours = i16::from_be_bytes([bytes[0], bytes[1]]);
        assert_eq!(num_contours, 2);
    }
}
