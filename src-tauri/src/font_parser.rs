use read_fonts::{FontRef, TableProvider};
use serde::{Deserialize, Serialize};
use std::fs;

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

pub fn parse_font(file_path: &str) -> Result<FontMetadata, String> {
    // Read font file bytes
    let bytes = fs::read(file_path)
        .map_err(|e| format!("Failed to read font file: {}", e))?;

    // Parse font with read-fonts
    let font = FontRef::new(&bytes)
        .map_err(|e| format!("Invalid font file: {:?}", e))?;

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

pub fn get_table_content(file_path: &str, table_name: &str) -> Result<String, String> {
    // Read font file bytes
    let bytes = fs::read(file_path)
        .map_err(|e| format!("Failed to read font file: {}", e))?;

    // Parse font
    let font = FontRef::new(&bytes)
        .map_err(|e| format!("Invalid font file: {:?}", e))?;

    // Parse the table tag
    let tag = read_fonts::types::Tag::from_be_bytes(
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
