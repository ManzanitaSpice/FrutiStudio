#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::command;
use tauri_plugin_dialog::{DialogExt, FilePath};
use std::sync::mpsc;

#[command]
fn select_folder(app: tauri::AppHandle) -> Result<String, String> {
    let (tx, rx) = mpsc::channel();

    app.dialog().file().pick_folder(move |folder| {
        if let Some(FilePath::Path(path)) = folder {
            let _ = tx.send(Ok(path.display().to_string()));
        } else {
            let _ = tx.send(Err("No se seleccionó ninguna carpeta".to_string()));
        }
    });

    rx.recv().unwrap_or_else(|_| Err("Error al recibir la ruta".to_string()))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![select_folder])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}