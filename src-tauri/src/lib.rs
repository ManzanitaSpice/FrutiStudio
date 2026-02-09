#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::command;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, FilePath};
use tokio::sync::oneshot;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    #[serde(alias = "base_dir")]
    base_dir: Option<String>,
}

#[derive(Debug, Serialize)]
struct BaseDirValidationResult {
    ok: bool,
    errors: Vec<String>,
}

fn config_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("config.json"))
        .map_err(|error| format!("No se pudo obtener el directorio de config: {error}"))
}

#[command]
async fn select_folder(app: tauri::AppHandle) -> Result<String, String> {
    let (tx, rx) = oneshot::channel();

    app.dialog().file().pick_folder(move |folder| {
        if let Some(FilePath::Path(path)) = folder {
            let _ = tx.send(Ok(path.display().to_string()));
        } else {
            let _ = tx.send(Err("No se seleccionó ninguna carpeta".to_string()));
        }
    });

    rx.await
        .unwrap_or_else(|_| Err("Error al recibir la ruta".to_string()))
}

#[command]
async fn load_config(app: tauri::AppHandle) -> Result<AppConfig, String> {
    let config_path = config_path(&app)?;
    if !config_path.exists() {
        return Ok(AppConfig::default());
    }

    let raw = fs::read_to_string(&config_path)
        .map_err(|error| format!("No se pudo leer config.json: {error}"))?;
    serde_json::from_str(&raw).map_err(|error| format!("Config inválida: {error}"))
}

#[command]
async fn save_base_dir(app: tauri::AppHandle, base_dir: String) -> Result<(), String> {
    let config_path = config_path(&app)?;
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("No se pudo crear carpeta de config: {error}"))?;
    }

    let config = AppConfig {
        base_dir: Some(base_dir),
    };
    let raw = serde_json::to_string_pretty(&config)
        .map_err(|error| format!("No se pudo serializar config: {error}"))?;
    fs::write(&config_path, raw)
        .map_err(|error| format!("No se pudo guardar config.json: {error}"))
}

#[command]
async fn validate_base_dir(base_dir: String) -> Result<BaseDirValidationResult, String> {
    let base_path = Path::new(&base_dir);
    if !base_path.exists() {
        return Ok(BaseDirValidationResult {
            ok: false,
            errors: vec!["La carpeta base no existe.".to_string()],
        });
    }

    if !base_path.is_dir() {
        return Ok(BaseDirValidationResult {
            ok: false,
            errors: vec!["La ruta indicada no es una carpeta.".to_string()],
        });
    }

    let mut errors = Vec::new();

    if let Err(error) = fs::read_dir(base_path) {
        errors.push(format!(
            "No se pudo leer la carpeta base (permiso de lectura): {error}"
        ));
    }

    let test_file = base_path.join(".frutistudio_write_test");
    match fs::File::create(&test_file).and_then(|mut file| file.write_all(b"ok")) {
        Ok(()) => {
            let _ = fs::remove_file(&test_file);
        }
        Err(error) => errors.push(format!(
            "No se pudo escribir en la carpeta base (permiso de escritura): {error}"
        )),
    }

    for folder in ["instances", "modpacks"] {
        let folder_path = base_path.join(folder);
        if let Err(error) = fs::create_dir_all(&folder_path) {
            errors.push(format!(
                "No se pudo asegurar la carpeta \"{folder}\" dentro de la base: {error}"
            ));
        }
    }

    Ok(BaseDirValidationResult {
        ok: errors.is_empty(),
        errors,
    })
}

#[command]
async fn append_log(
    app: tauri::AppHandle,
    scope: String,
    message: String,
) -> Result<(), String> {
    let logs_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("No se pudo obtener el directorio de config: {error}"))?
        .join("logs");

    fs::create_dir_all(&logs_dir)
        .map_err(|error| format!("No se pudo crear carpeta de logs: {error}"))?;

    let log_path = logs_dir.join(format!("{scope}.log"));
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("No se pudo obtener timestamp: {error}"))?;
    let line = format!("[{}] {message}\n", timestamp.as_secs());
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| format!("No se pudo abrir archivo de log: {error}"))?;

    file.write_all(line.as_bytes())
        .map_err(|error| format!("No se pudo escribir en log: {error}"))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            select_folder,
            load_config,
            save_base_dir,
            validate_base_dir,
            append_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
