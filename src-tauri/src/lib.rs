// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod font_parser;

use font_parser::FontCache;
use tauri::ipc::Response;
use tauri::State;

#[tauri::command]
fn parse_font_file(
    file_path: String,
    cache: State<FontCache>,
) -> Result<font_parser::FontMetadata, String> {
    font_parser::parse_font(&file_path, &cache)
}

#[tauri::command]
fn get_font_table(
    file_path: String,
    table_name: String,
    cache: State<FontCache>,
) -> Result<String, String> {
    font_parser::get_table_content(&file_path, &table_name, &cache)
}

#[tauri::command]
fn get_glyph_outlines(
    file_path: String,
    offset: u32,
    limit: u32,
    cache: State<FontCache>,
) -> Result<Response, String> {
    let bytes = font_parser::get_glyph_outlines_binary(&file_path, offset, limit, &cache)?;
    Ok(Response::new(bytes))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize font cache
    let font_cache = FontCache::new();

    tauri::Builder::default()
        .manage(font_cache)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![parse_font_file, get_font_table, get_glyph_outlines])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
