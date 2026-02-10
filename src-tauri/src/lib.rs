// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::fs;
use std::path::PathBuf;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn save_font_file(file_path: String, file_name: String) -> Result<String, String> {
    // Validate file extension
    let valid_extensions = ["otf", "ttf"];
    let extension = file_name.split('.').last().unwrap_or("").to_lowercase();

    if !valid_extensions.contains(&extension.as_str()) {
        return Err("Invalid file type. Only .otf and .ttf files are allowed.".to_string());
    }

    // Check if source file exists
    if !std::path::Path::new(&file_path).exists() {
        return Err("Source file does not exist.".to_string());
    }

    // Get the path to src/assets/fonts/
    let mut dest_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    dest_path.pop(); // Go up from src-tauri to project root
    dest_path.push("src");
    dest_path.push("assets");
    dest_path.push("fonts");
    dest_path.push(&file_name);

    // Check if destination file already exists
    if dest_path.exists() {
        return Err(format!("Font '{}' already exists.", file_name));
    }

    // Create fonts directory if it doesn't exist
    let fonts_dir = dest_path.parent().unwrap();
    fs::create_dir_all(fonts_dir).map_err(|e| e.to_string())?;

    // Copy the file
    fs::copy(&file_path, &dest_path).map_err(|e| e.to_string())?;

    Ok(dest_path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![greet, save_font_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
