// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod font_parser;

use font_parser::{FontCache, HeadTableUpdate, HheaTableUpdate, MaxpTableUpdate, NameTableUpdate};
use tauri::ipc::Response;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, State};

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

#[tauri::command]
fn update_head_table(
    file_path: String,
    updates: HeadTableUpdate,
    cache: State<FontCache>,
) -> Result<(), String> {
    font_parser::update_head_table(&file_path, &updates, &cache)
}

#[tauri::command]
fn update_hhea_table(
    file_path: String,
    updates: HheaTableUpdate,
    cache: State<FontCache>,
) -> Result<(), String> {
    font_parser::update_hhea_table(&file_path, &updates, &cache)
}

#[tauri::command]
fn update_maxp_table(
    file_path: String,
    updates: MaxpTableUpdate,
    cache: State<FontCache>,
) -> Result<(), String> {
    font_parser::update_maxp_table(&file_path, &updates, &cache)
}

#[tauri::command]
fn update_name_table(
    file_path: String,
    updates: NameTableUpdate,
    cache: State<FontCache>,
) -> Result<(), String> {
    font_parser::update_name_table(&file_path, &updates, &cache)
}

#[tauri::command]
fn save_glyph_outline(
    file_path: String,
    glyph_id: u32,
    svg_path: String,
    table_name: String,
    cache: State<FontCache>,
) -> Result<(), String> {
    let args = font_parser::SaveGlyphOutlineArgs {
        glyph_id,
        svg_path,
        table_name,
    };
    font_parser::save_glyph_outline(&file_path, &args, &cache)
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
        .setup(|app| {
            let open_font = MenuItemBuilder::with_id("open_font", "Open Font…")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&open_font)
                .separator()
                .quit()
                .build()?;

            let menu = MenuBuilder::new(app).item(&file_menu).build()?;

            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| {
                if event.id() == open_font.id() {
                    let _ = app_handle.emit("menu:open-font", ());
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            parse_font_file,
            get_font_table,
            get_glyph_outlines,
            update_head_table,
            update_hhea_table,
            update_maxp_table,
            update_name_table,
            save_glyph_outline
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
