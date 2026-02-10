#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use fs2::available_space;
use once_cell::sync::Lazy;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::command;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, FilePath};
use tokio::sync::oneshot;

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    #[serde(alias = "base_dir")]
    base_dir: Option<String>,
    ui_scale: Option<f32>,
    theme: Option<String>,
    version: Option<u32>,
    telemetry_opt_in: Option<bool>,
}

#[derive(Debug, Serialize)]
struct BaseDirValidationResult {
    ok: bool,
    errors: Vec<String>,
    warnings: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstanceRecord {
    id: String,
    name: String,
    version: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModpackAction {
    action: String,
    id: String,
    name: Option<String>,
    version: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SelectFolderResult {
    ok: bool,
    path: Option<String>,
    error: Option<String>,
}

fn config_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("config.json"))
        .map_err(|error| format!("No se pudo obtener el directorio de config: {error}"))
}

fn migrate_config(mut config: AppConfig) -> AppConfig {
    let version = config.version.unwrap_or(0);
    if version < 1 {
        config.version = Some(1);
    }
    config
}

fn database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("frutistudio.db"))
        .map_err(|error| format!("No se pudo obtener el directorio de datos: {error}"))
}

fn init_database(app: &tauri::AppHandle) -> Result<(), String> {
    let path = database_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("No se pudo crear carpeta de datos: {error}"))?;
    }
    let conn = Connection::open(path)
        .map_err(|error| format!("No se pudo abrir la base de datos: {error}"))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS instances (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            version TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS modpacks (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            version TEXT NOT NULL
        );",
    )
    .map_err(|error| format!("No se pudo inicializar la base: {error}"))?;
    Ok(())
}

const REQUIRED_LAUNCHER_DIRS: [&str; 3] = ["instances", "downloads", "logs"];
const BACKUP_PREFIX: &str = "config.json.";
const BACKUP_SUFFIX: &str = ".bak";
const MAX_CONFIG_BACKUPS: usize = 12;
const MAX_BACKUP_AGE_DAYS: u64 = 14;

fn launcher_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|error| format!("No se pudo obtener la carpeta del launcher: {error}"))
}

fn ensure_launcher_layout(app: &tauri::AppHandle) -> Result<(), String> {
    let root = launcher_root(app)?;
    fs::create_dir_all(&root)
        .map_err(|error| format!("No se pudo crear carpeta raíz del launcher: {error}"))?;
    for directory in REQUIRED_LAUNCHER_DIRS {
        fs::create_dir_all(root.join(directory)).map_err(|error| {
            format!("No se pudo crear carpeta requerida ({directory}): {error}")
        })?;
    }
    Ok(())
}

static INSTANCE_LOCKS: Lazy<std::sync::Mutex<HashSet<String>>> =
    Lazy::new(|| std::sync::Mutex::new(HashSet::new()));

#[command]
async fn select_folder(app: tauri::AppHandle) -> Result<SelectFolderResult, String> {
    let (tx, rx) = oneshot::channel();

    app.dialog().file().pick_folder(move |folder| {
        if let Some(FilePath::Path(path)) = folder {
            let _ = tx.send(Ok(SelectFolderResult {
                ok: true,
                path: Some(path.display().to_string()),
                error: None,
            }));
        } else {
            let _ = tx.send(Ok(SelectFolderResult {
                ok: false,
                path: None,
                error: Some("No se seleccionó ninguna carpeta".to_string()),
            }));
        }
    });

    rx.await
        .unwrap_or_else(|_| Err("Error al recibir la ruta".to_string()))
}

#[command]
async fn load_config(app: tauri::AppHandle) -> Result<AppConfig, String> {
    ensure_launcher_layout(&app)?;
    let config_path = config_path(&app)?;
    if !config_path.exists() {
        return Ok(migrate_config(AppConfig::default()));
    }

    let raw = fs::read_to_string(&config_path)
        .map_err(|error| format!("No se pudo leer config.json: {error}"))?;
    serde_json::from_str(&raw)
        .map(migrate_config)
        .map_err(|error| format!("Config inválida: {error}"))
}

#[command]
async fn save_config(app: tauri::AppHandle, config: AppConfig) -> Result<(), String> {
    ensure_launcher_layout(&app)?;
    let config_path = config_path(&app)?;
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("No se pudo crear carpeta de config: {error}"))?;
    }

    let config = migrate_config(config);
    let raw = serde_json::to_string_pretty(&config)
        .map_err(|error| format!("No se pudo serializar config: {error}"))?;
    backup_file(&config_path)?;
    fs::write(&config_path, raw).map_err(|error| format!("No se pudo guardar config.json: {error}"))
}

fn backup_file(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let backup_dir = path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("backups");
    fs::create_dir_all(&backup_dir)
        .map_err(|error| format!("No se pudo crear carpeta de backups: {error}"))?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("No se pudo obtener timestamp: {error}"))?
        .as_secs();
    let backup_path = backup_dir.join(format!("{BACKUP_PREFIX}{timestamp}{BACKUP_SUFFIX}"));
    fs::copy(path, backup_path).map_err(|error| format!("No se pudo respaldar config: {error}"))?;
    cleanup_backups(&backup_dir)?;
    Ok(())
}

fn cleanup_backups(backup_dir: &Path) -> Result<(), String> {
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(MAX_BACKUP_AGE_DAYS * 24 * 60 * 60))
        .ok_or_else(|| "No se pudo calcular la antigüedad máxima de backups".to_string())?;

    let mut backups: Vec<(PathBuf, SystemTime)> = fs::read_dir(backup_dir)
        .map_err(|error| format!("No se pudo leer carpeta de backups: {error}"))?
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with(BACKUP_PREFIX) || !name.ends_with(BACKUP_SUFFIX) {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            let modified = metadata.modified().ok()?;
            Some((entry.path(), modified))
        })
        .collect();

    backups.sort_by_key(|(_, modified)| *modified);

    for (path, modified) in &backups {
        if *modified < cutoff {
            let _ = fs::remove_file(path);
        }
    }

    let mut remaining: Vec<PathBuf> = backups
        .into_iter()
        .filter_map(|(path, _)| path.exists().then_some(path))
        .collect();
    if remaining.len() > MAX_CONFIG_BACKUPS {
        remaining.sort();
        let remove_count = remaining.len() - MAX_CONFIG_BACKUPS;
        for old in remaining.into_iter().take(remove_count) {
            let _ = fs::remove_file(old);
        }
    }

    Ok(())
}

#[command]
async fn save_base_dir(app: tauri::AppHandle, base_dir: String) -> Result<(), String> {
    let config = AppConfig {
        base_dir: Some(base_dir),
        ..load_config(app.clone()).await?
    };
    save_config(app, config).await
}

#[command]
async fn default_base_dir(app: tauri::AppHandle) -> Result<String, String> {
    let base = app
        .path()
        .data_dir()
        .map_err(|error| format!("No se pudo obtener el directorio base: {error}"))?;
    let target = base.join("FrutiLauncher");
    fs::create_dir_all(&target)
        .map_err(|error| format!("No se pudo crear la carpeta base: {error}"))?;
    Ok(target.display().to_string())
}

#[command]
async fn validate_base_dir(
    base_dir: String,
    dry_run: Option<bool>,
) -> Result<BaseDirValidationResult, String> {
    let base_path = Path::new(&base_dir);
    if !base_path.exists() {
        return Ok(BaseDirValidationResult {
            ok: false,
            errors: vec!["La carpeta base no existe.".to_string()],
            warnings: vec![],
        });
    }

    if !base_path.is_dir() {
        return Ok(BaseDirValidationResult {
            ok: false,
            errors: vec!["La ruta indicada no es una carpeta.".to_string()],
            warnings: vec![],
        });
    }

    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    if let Err(error) = fs::read_dir(base_path) {
        errors.push(format!(
            "No se pudo leer la carpeta base (permiso de lectura): {error}"
        ));
    }

    if let Ok(space) = available_space(base_path) {
        const MIN_SPACE: u64 = 2 * 1024 * 1024 * 1024;
        if space < MIN_SPACE {
            warnings.push(format!(
                "Espacio libre bajo: {} MB disponibles.",
                space / 1024 / 1024
            ));
        }
    } else {
        warnings.push("No se pudo verificar el espacio disponible.".to_string());
    }

    let is_dry_run = dry_run.unwrap_or(false);
    if !is_dry_run {
        let test_file = base_path.join(".frutistudio_write_test");
        match fs::File::create(&test_file).and_then(|mut file| file.write_all(b"ok")) {
            Ok(()) => {
                let _ = fs::remove_file(&test_file);
            }
            Err(error) => errors.push(format!(
                "No se pudo escribir en la carpeta base (permiso de escritura): {error}"
            )),
        }
    }

    for folder in ["instances", "modpacks"] {
        if !is_dry_run {
            let folder_path = base_path.join(folder);
            if let Err(error) = fs::create_dir_all(&folder_path) {
                errors.push(format!(
                    "No se pudo asegurar la carpeta \"{folder}\" dentro de la base: {error}"
                ));
            }
        }
    }

    Ok(BaseDirValidationResult {
        ok: errors.is_empty(),
        errors,
        warnings,
    })
}

#[command]
async fn append_log(
    app: tauri::AppHandle,
    scope: String,
    lines: Vec<String>,
) -> Result<(), String> {
    let logs_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("No se pudo obtener el directorio de config: {error}"))?
        .join("logs");

    fs::create_dir_all(&logs_dir)
        .map_err(|error| format!("No se pudo crear carpeta de logs: {error}"))?;

    let log_path = logs_dir.join(format!("{scope}.log"));
    rotate_log_if_needed(&log_path)?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| format!("No se pudo abrir archivo de log: {error}"))?;

    for line in lines {
        file.write_all(format!("{line}\n").as_bytes())
            .map_err(|error| format!("No se pudo escribir en log: {error}"))?;
    }
    Ok(())
}

fn rotate_log_if_needed(path: &Path) -> Result<(), String> {
    const MAX_SIZE: u64 = 5 * 1024 * 1024;
    if let Ok(metadata) = fs::metadata(path) {
        if metadata.len() > MAX_SIZE {
            let backup = path.with_extension("log.1");
            let _ = fs::remove_file(&backup);
            fs::rename(path, backup).map_err(|error| format!("No se pudo rotar log: {error}"))?;
        }
    }
    Ok(())
}

fn with_instance_lock<T>(id: &str, f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let mut locks = INSTANCE_LOCKS
        .lock()
        .map_err(|_| "No se pudo obtener el lock".to_string())?;
    if locks.contains(id) {
        return Err("La instancia está bloqueada por otra operación.".to_string());
    }
    locks.insert(id.to_string());
    drop(locks);
    let result = f();
    let mut locks = INSTANCE_LOCKS
        .lock()
        .map_err(|_| "No se pudo liberar el lock".to_string())?;
    locks.remove(id);
    result
}

#[command]
async fn list_instances(app: tauri::AppHandle) -> Result<Vec<InstanceRecord>, String> {
    let path = database_path(&app)?;
    let conn = Connection::open(path)
        .map_err(|error| format!("No se pudo abrir la base de datos: {error}"))?;
    let mut stmt = conn
        .prepare("SELECT id, name, version FROM instances")
        .map_err(|error| format!("No se pudo leer instancias: {error}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(InstanceRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                version: row.get(2)?,
            })
        })
        .map_err(|error| format!("No se pudo mapear instancias: {error}"))?;
    let mut instances = Vec::new();
    for row in rows {
        instances.push(row.map_err(|error| format!("Instancia inválida: {error}"))?);
    }
    Ok(instances)
}

#[command]
async fn create_instance(app: tauri::AppHandle, instance: InstanceRecord) -> Result<(), String> {
    let path = database_path(&app)?;
    let conn = Connection::open(path)
        .map_err(|error| format!("No se pudo abrir la base de datos: {error}"))?;
    conn.execute(
        "INSERT OR REPLACE INTO instances (id, name, version) VALUES (?1, ?2, ?3)",
        params![instance.id, instance.name, instance.version],
    )
    .map_err(|error| format!("No se pudo crear la instancia: {error}"))?;
    Ok(())
}

#[command]
async fn manage_modpack(app: tauri::AppHandle, action: ModpackAction) -> Result<(), String> {
    let path = database_path(&app)?;
    backup_file(&path)?;
    let conn = Connection::open(path)
        .map_err(|error| format!("No se pudo abrir la base de datos: {error}"))?;

    let id = action.id.clone();
    with_instance_lock(&id, || {
        match action.action.as_str() {
            "create" => {
                conn.execute(
                    "INSERT INTO modpacks (id, name, version) VALUES (?1, ?2, ?3)",
                    params![
                        action.id,
                        action.name.unwrap_or_else(|| "Nuevo modpack".to_string()),
                        action.version.unwrap_or_else(|| "1.0.0".to_string())
                    ],
                )
                .map_err(|error| format!("No se pudo crear modpack: {error}"))?;
            }
            "duplicate" => {
                let new_id = format!(
                    "{}-copy-{}",
                    action.id,
                    SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or(Duration::from_secs(0))
                        .as_secs()
                );
                conn.execute(
                    "INSERT INTO modpacks (id, name, version)
                    SELECT ?1, name || ' (copia)', version FROM modpacks WHERE id = ?2",
                    params![new_id, action.id],
                )
                .map_err(|error| format!("No se pudo duplicar modpack: {error}"))?;
            }
            "delete" => {
                conn.execute("DELETE FROM modpacks WHERE id = ?1", params![action.id])
                    .map_err(|error| format!("No se pudo eliminar modpack: {error}"))?;
            }
            _ => return Err("Acción de modpack inválida".to_string()),
        }
        Ok(())
    })
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            select_folder,
            load_config,
            save_config,
            save_base_dir,
            default_base_dir,
            validate_base_dir,
            append_log,
            list_instances,
            create_instance,
            manage_modpack
        ])
        .setup(|app| {
            if let Err(error) = init_database(app.handle()) {
                eprintln!("Error al inicializar la base de datos: {error}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_config_sets_version() {
        let config = AppConfig::default();
        let migrated = migrate_config(config);
        assert_eq!(migrated.version, Some(1));
    }

    #[test]
    fn validate_base_dir_rejects_missing() {
        let rt = tokio::runtime::Runtime::new().expect("runtime");
        let result = rt.block_on(validate_base_dir(
            "/path/que/no/existe".to_string(),
            Some(true),
        ));
        let result = result.expect("resultado valido");
        assert!(!result.ok);
    }
}
