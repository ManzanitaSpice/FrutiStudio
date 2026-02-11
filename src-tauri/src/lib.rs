#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::fs;
use std::io::{Read, Write};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::header::{HeaderMap, HeaderValue};

use fs2::available_space;
use once_cell::sync::Lazy;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha1::{Digest, Sha1};
use tauri::command;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, FilePath};
use tokio::sync::{oneshot, Semaphore};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    #[serde(alias = "base_dir")]
    base_dir: Option<String>,
    ui_scale: Option<f32>,
    theme: Option<String>,
    version: Option<u32>,
    telemetry_opt_in: Option<bool>,
    auto_updates: Option<bool>,
    background_downloads: Option<bool>,
    active_section: Option<String>,
    focus_mode: Option<bool>,
    show_verification_window: Option<bool>,
    never_rename_folder: Option<bool>,
    replace_toolbar_by_menu: Option<bool>,
    update_check_interval_hours: Option<u32>,
    mods_track_metadata: Option<bool>,
    mods_install_dependencies: Option<bool>,
    mods_suggest_pack_updates: Option<bool>,
    mods_check_blocked_subfolders: Option<bool>,
    mods_move_blocked_mods: Option<bool>,
    downloads_path: Option<String>,
    mods_path: Option<String>,
    icons_path: Option<String>,
    java_path: Option<String>,
    skins_path: Option<String>,
    explorer_filters: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartupFileEntry {
    relative_path: String,
    size_bytes: u64,
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
    #[serde(default)]
    loader_name: Option<String>,
    #[serde(default)]
    loader_version: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LaunchInstanceResult {
    pid: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeLogSnapshot {
    status: Option<String>,
    state_details: Option<Value>,
    state_updated_at: Option<u64>,
    stdout_path: Option<String>,
    stderr_path: Option<String>,
    command: Option<String>,
    lines: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LaunchPlan {
    java_path: String,
    java_args: Vec<String>,
    game_args: Vec<String>,
    main_class: String,
    classpath_entries: Vec<String>,
    classpath_separator: String,
    game_dir: String,
    assets_dir: String,
    libraries_dir: String,
    natives_dir: String,
    version_json: String,
    asset_index: String,
    #[serde(default)]
    required_java_major: u32,
    #[serde(default)]
    resolved_java_major: u32,
    loader: String,
    loader_profile_resolved: bool,
    auth: LaunchAuth,
    env: HashMap<String, String>,
}

fn expected_main_class_for_loader(loader: &str) -> Option<&'static str> {
    match loader {
        "fabric" | "quilt" => Some("net.fabricmc.loader.launch.knot.KnotClient"),
        "vanilla" => Some("net.minecraft.client.main.Main"),
        _ => None,
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LaunchAuth {
    username: String,
    uuid: String,
    access_token: String,
    user_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ValidationReport {
    ok: bool,
    errors: Vec<String>,
    warnings: Vec<String>,
    checks: HashMap<String, bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstanceCommandArgs {
    #[serde(alias = "instance_id", alias = "id")]
    instance_id: Option<String>,
    #[serde(alias = "playerName")]
    username: Option<String>,
    #[serde(alias = "playerUuid")]
    uuid: Option<String>,
    #[serde(alias = "access_token")]
    access_token: Option<String>,
    #[serde(alias = "user_type")]
    user_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstancePathArgs {
    #[serde(alias = "instance_id", alias = "id")]
    instance_id: Option<String>,
    sub_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstanceArchiveArgs {
    #[serde(alias = "instance_id", alias = "id", alias = "uuid")]
    instance_id: Option<String>,
    archive_path: String,
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

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FingerprintScanResult {
    files: Vec<FingerprintFileResult>,
    unmatched_fingerprints: Vec<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FingerprintFileResult {
    path: String,
    file_name: String,
    fingerprint: u32,
    matched: bool,
    mod_id: Option<u32>,
    file_id: Option<u32>,
    mod_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseforgeDownloadResolution {
    mod_id: u32,
    file_id: u32,
    can_auto_download: bool,
    download_url: Option<String>,
    website_url: Option<String>,
    reason: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct FingerprintsRequestBody {
    fingerprints: Vec<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseforgeFingerprintsEnvelope {
    data: CurseforgeFingerprintsData,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseforgeFingerprintsData {
    exact_matches: Vec<CurseforgeFingerprintMatch>,
    #[serde(default)]
    unmatched_fingerprints: Vec<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseforgeFingerprintMatch {
    id: u32,
    file: CurseforgeMatchedFile,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseforgeMatchedFile {
    id: u32,
    file_name: String,
    #[serde(default)]
    file_fingerprint: u32,
}

#[derive(Debug, Deserialize)]
struct CurseforgeModEnvelope {
    data: CurseforgeModData,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseforgeModData {
    name: Option<String>,
    links: Option<CurseforgeModLinks>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseforgeModLinks {
    website_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CurseforgeFileEnvelope {
    data: CurseforgeFileData,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseforgeFileData {
    download_url: Option<String>,
    is_available: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct MojangVersionManifest {
    versions: Vec<MojangVersionEntry>,
}

#[derive(Debug, Deserialize)]
struct MojangVersionEntry {
    id: String,
    url: String,
}

#[derive(Debug, Deserialize)]
struct MojangVersionDetail {
    downloads: MojangVersionDownloads,
}

#[derive(Debug, Deserialize)]
struct MojangVersionDownloads {
    client: MojangDownload,
}

#[derive(Debug, Deserialize)]
struct MojangDownload {
    url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct JavaRuntime {
    id: String,
    name: String,
    path: String,
    version: String,
    major: u32,
    architecture: String,
    source: String,
    recommended: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct JavaResolution {
    minecraft_version: String,
    required_major: u32,
    selected: Option<JavaRuntime>,
    runtimes: Vec<JavaRuntime>,
}

struct JavaManager {
    launcher_root: PathBuf,
}

fn murmurhash2(data: &[u8]) -> u32 {
    const M: u32 = 0x5bd1e995;
    const R: u32 = 24;
    let len = data.len() as u32;
    let mut h = 1u32 ^ len;
    let mut i = 0usize;

    while i + 4 <= data.len() {
        let mut k = u32::from_le_bytes([data[i], data[i + 1], data[i + 2], data[i + 3]]);
        k = k.wrapping_mul(M);
        k ^= k >> R;
        k = k.wrapping_mul(M);

        h = h.wrapping_mul(M);
        h ^= k;
        i += 4;
    }

    match data.len() - i {
        3 => {
            h ^= (data[i + 2] as u32) << 16;
            h ^= (data[i + 1] as u32) << 8;
            h ^= data[i] as u32;
            h = h.wrapping_mul(M);
        }
        2 => {
            h ^= (data[i + 1] as u32) << 8;
            h ^= data[i] as u32;
            h = h.wrapping_mul(M);
        }
        1 => {
            h ^= data[i] as u32;
            h = h.wrapping_mul(M);
        }
        _ => {}
    }

    h ^= h >> 13;
    h = h.wrapping_mul(M);
    h ^= h >> 15;
    h
}

fn curseforge_headers(api_key: &str) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    let key =
        HeaderValue::from_str(api_key).map_err(|error| format!("API key inválida: {error}"))?;
    headers.insert("x-api-key", key);
    headers.insert("content-type", HeaderValue::from_static("application/json"));
    Ok(headers)
}

async fn fetch_mod_name_and_site(
    client: &reqwest::Client,
    headers: &HeaderMap,
    mod_id: u32,
) -> (Option<String>, Option<String>) {
    let response = client
        .get(format!("https://api.curseforge.com/v1/mods/{mod_id}"))
        .headers(headers.clone())
        .send()
        .await;

    if let Ok(resp) = response {
        if let Ok(envelope) = resp.json::<CurseforgeModEnvelope>().await {
            let site = envelope.data.links.and_then(|links| links.website_url);
            return (envelope.data.name, site);
        }
    }

    (
        None,
        Some(format!(
            "https://www.curseforge.com/minecraft/mc-mods/{mod_id}"
        )),
    )
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

fn database_connection(app: &tauri::AppHandle) -> Result<Connection, String> {
    let path = database_path(app)?;
    Connection::open(path).map_err(|error| format!("No se pudo abrir la base de datos: {error}"))
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
            version TEXT NOT NULL,
            loader_name TEXT,
            loader_version TEXT
        );
        CREATE TABLE IF NOT EXISTS modpacks (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            version TEXT NOT NULL
        );",
    )
    .map_err(|error| format!("No se pudo inicializar la base: {error}"))?;

    conn.execute("ALTER TABLE instances ADD COLUMN loader_name TEXT", [])
        .or_else(|error| {
            if error.to_string().contains("duplicate column name") {
                Ok(0)
            } else {
                Err(error)
            }
        })
        .map_err(|error| format!("No se pudo migrar columna loader_name: {error}"))?;

    conn.execute("ALTER TABLE instances ADD COLUMN loader_version TEXT", [])
        .or_else(|error| {
            if error.to_string().contains("duplicate column name") {
                Ok(0)
            } else {
                Err(error)
            }
        })
        .map_err(|error| format!("No se pudo migrar columna loader_version: {error}"))?;

    Ok(())
}

const REQUIRED_LAUNCHER_DIRS: [&str; 3] = ["instances", "downloads", "logs"];
const ASSET_MIRROR_BASES: [&str; 3] = [
    "https://resources.download.minecraft.net",
    "https://bmclapi2.bangbang93.com/assets",
    "https://download.mcbbs.net/assets",
];

#[derive(Clone)]
struct AssetDownloadTask {
    urls: Vec<String>,
    path: PathBuf,
    sha1: String,
    object_name: String,
}
const DEFAULT_LAUNCHER_DIR_NAME: &str = "FrutiLauncherOfficial";
const BACKUP_PREFIX: &str = "config.json.";
const BACKUP_SUFFIX: &str = ".bak";
const MAX_CONFIG_BACKUPS: usize = 12;
const MAX_BACKUP_AGE_DAYS: u64 = 14;

fn launcher_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_path = config_path(app)?;
    if config_path.exists() {
        if let Ok(raw) = fs::read_to_string(&config_path) {
            if let Ok(config) = serde_json::from_str::<AppConfig>(&raw) {
                if let Some(base_dir) = config.base_dir {
                    if !base_dir.trim().is_empty() {
                        return Ok(PathBuf::from(base_dir));
                    }
                }
            }
        }
    }
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("No se pudo obtener la carpeta del launcher: {error}"))?;
    Ok(base.join(DEFAULT_LAUNCHER_DIR_NAME))
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
async fn collect_startup_files(app: tauri::AppHandle) -> Result<Vec<StartupFileEntry>, String> {
    let root = launcher_root(&app)?;
    let mut files = Vec::new();

    let config = config_path(&app).ok();
    if let Some(path) = config {
        if let Ok(metadata) = fs::metadata(&path) {
            files.push(StartupFileEntry {
                relative_path: "config.json".to_string(),
                size_bytes: metadata.len(),
            });
        }
    }

    let candidates = ["instances", "downloads", "logs"];
    for folder in candidates {
        let path = root.join(folder);
        let entries = match fs::read_dir(path) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            if metadata.is_file() {
                files.push(StartupFileEntry {
                    relative_path: format!("{folder}/{}", entry.file_name().to_string_lossy()),
                    size_bytes: metadata.len(),
                });
            }
            if files.len() >= 18 {
                break;
            }
        }
        if files.len() >= 18 {
            break;
        }
    }

    Ok(files)
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
    let normalized = base_dir.trim().to_string();
    let config = AppConfig {
        base_dir: (!normalized.is_empty()).then_some(normalized),
        ..load_config(app.clone()).await?
    };
    save_config(app, config).await
}

#[command]
async fn default_base_dir(app: tauri::AppHandle) -> Result<String, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("No se pudo obtener el directorio base: {error}"))?;
    let target = base.join(DEFAULT_LAUNCHER_DIR_NAME);
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

    for folder in REQUIRED_LAUNCHER_DIRS {
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
    let logs_dir = launcher_root(&app)?.join("logs");

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

fn read_last_lines(path: &Path, max_lines: usize) -> Vec<String> {
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };

    let mut lines: Vec<String> = raw.lines().map(|line| line.to_string()).collect();
    if lines.len() > max_lines {
        let start = lines.len().saturating_sub(max_lines);
        lines = lines.split_off(start);
    }
    lines
}

fn latest_runtime_log(logs_dir: &Path, suffix: &str) -> Option<PathBuf> {
    let Ok(entries) = fs::read_dir(logs_dir) else {
        return None;
    };

    let mut candidates = Vec::<(u64, PathBuf)>::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !name.starts_with("runtime-") || !name.ends_with(suffix) {
            continue;
        }
        let modified = entry
            .metadata()
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs())
            .unwrap_or_default();
        candidates.push((modified, path));
    }

    candidates.sort_by_key(|(modified, _)| *modified);
    candidates.pop().map(|(_, path)| path)
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

fn command_available(command: &str) -> bool {
    Command::new("sh")
        .arg("-c")
        .arg(format!("command -v {command} >/dev/null 2>&1"))
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn shell_escape(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn java_bin_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "javaw.exe"
    } else {
        "java"
    }
}

fn parse_java_version(output: &str) -> Option<(String, u32)> {
    let line = output.lines().next()?.trim().to_string();
    let token = line
        .split_whitespace()
        .find(|part| part.starts_with('"') && part.ends_with('"'))?
        .trim_matches('"')
        .to_string();

    if let Some(rest) = token.strip_prefix("1.") {
        let major = rest.split('.').next()?.parse::<u32>().ok()?;
        return Some((token, major));
    }

    let major = token.split('.').next()?.parse::<u32>().ok()?;
    Some((token, major))
}

fn inspect_java_runtime(path: &Path, source: &str) -> Option<JavaRuntime> {
    if !path.exists() {
        return None;
    }

    let output = Command::new(path).arg("-version").output().ok()?;
    if !output.status.success() {
        return None;
    }

    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let combined = if stderr.trim().is_empty() {
        stdout
    } else {
        stderr
    };
    let (version, major) = parse_java_version(&combined)?;

    let architecture = if combined.to_lowercase().contains("64-bit") {
        "x64".to_string()
    } else if combined.to_lowercase().contains("aarch64") {
        "arm64".to_string()
    } else {
        std::env::consts::ARCH.to_string()
    };

    let runtime_name = path
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.file_name())
        .and_then(|name| name.to_str())
        .unwrap_or("java");

    Some(JavaRuntime {
        id: format!("{}-{}", source, major),
        name: format!("Java {major} ({runtime_name})"),
        path: path.display().to_string(),
        version,
        major,
        architecture,
        source: source.to_string(),
        recommended: false,
    })
}

impl JavaManager {
    fn new(app: &tauri::AppHandle) -> Result<Self, String> {
        Ok(Self {
            launcher_root: launcher_root(app)?,
        })
    }

    fn java_runtime_dir(&self) -> PathBuf {
        self.launcher_root.join("runtime").join("java")
    }

    fn required_major_for_minecraft(&self, mc_version: &str) -> u32 {
        let clean = mc_version.trim().trim_start_matches('v');
        let mut parts = clean.split('.');
        let major = parts
            .next()
            .and_then(|p| p.parse::<u32>().ok())
            .unwrap_or_default();
        let minor = parts
            .next()
            .and_then(|p| p.parse::<u32>().ok())
            .unwrap_or_default();

        if major == 1 && minor <= 16 {
            8
        } else if major == 1 && minor == 17 {
            16
        } else if major == 1 && minor >= 18 {
            17
        } else if major > 1 {
            21
        } else {
            17
        }
    }

    fn detect_installed(&self) -> Vec<JavaRuntime> {
        let mut runtimes = Vec::new();
        let mut seen_paths = HashSet::new();

        if let Ok(explicit) = std::env::var("FRUTI_JAVA_PATH") {
            let path = PathBuf::from(explicit.trim());
            if let Some(runtime) = inspect_java_runtime(&path, "fruti-env") {
                seen_paths.insert(runtime.path.clone());
                runtimes.push(runtime);
            }
        }

        let managed_root = self.java_runtime_dir();
        if let Ok(entries) = fs::read_dir(&managed_root) {
            for entry in entries.flatten() {
                let runtime = entry.path();
                if !runtime.is_dir() {
                    continue;
                }
                let java = runtime.join("bin").join(java_bin_name());
                if let Some(found) = inspect_java_runtime(&java, "embebido") {
                    if seen_paths.insert(found.path.clone()) {
                        runtimes.push(found);
                    }
                }
            }
        }

        let mut system_candidates = vec![
            PathBuf::from("/usr/bin/java"),
            PathBuf::from("/usr/local/bin/java"),
            PathBuf::from("/opt/homebrew/opt/openjdk/bin/java"),
        ];

        if cfg!(target_os = "windows") {
            for root in [
                "C:/Program Files/Java",
                "C:/Program Files/Eclipse Adoptium",
                "C:/Program Files/Adoptium",
            ] {
                let base = PathBuf::from(root);
                if let Ok(entries) = fs::read_dir(base) {
                    for entry in entries.flatten() {
                        let java = entry.path().join("bin").join(java_bin_name());
                        system_candidates.push(java);
                    }
                }
            }
        }

        if let Ok(java_home) = std::env::var("JAVA_HOME") {
            let java_home = java_home.trim();
            if !java_home.is_empty() {
                system_candidates.push(PathBuf::from(java_home).join("bin").join(java_bin_name()));
            }
        }

        for candidate in system_candidates {
            if let Some(found) = inspect_java_runtime(&candidate, "sistema") {
                if seen_paths.insert(found.path.clone()) {
                    runtimes.push(found);
                }
            }
        }

        if command_available("java") {
            let from_path = PathBuf::from("java");
            if let Some(found) = inspect_java_runtime(&from_path, "path") {
                if seen_paths.insert(found.path.clone()) {
                    runtimes.push(found);
                }
            }
        }

        runtimes.sort_by(|a, b| {
            a.major
                .cmp(&b.major)
                .then_with(|| a.path.cmp(&b.path))
                .then_with(|| a.source.cmp(&b.source))
        });
        runtimes
    }

    fn resolve_for_minecraft(&self, mc_version: &str) -> JavaResolution {
        let required_major = self.required_major_for_minecraft(mc_version);
        let mut runtimes = self.detect_installed();

        let selected_index = runtimes
            .iter()
            .position(|runtime| runtime.major == required_major)
            .or_else(|| {
                runtimes
                    .iter()
                    .position(|runtime| runtime.major > required_major)
            });

        if let Some(index) = selected_index {
            runtimes[index].recommended = true;
        }

        JavaResolution {
            minecraft_version: mc_version.to_string(),
            required_major,
            selected: selected_index.map(|index| runtimes[index].clone()),
            runtimes,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstanceMemoryConfig {
    min: u32,
    max: u32,
}

fn current_minecraft_os() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    }
}

fn library_allowed_for_current_os(library: &Value) -> bool {
    let Some(rules) = library.get("rules").and_then(|v| v.as_array()) else {
        return true;
    };

    let mut allowed = false;
    for rule in rules {
        let action = rule
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or("allow");
        let os = rule
            .get("os")
            .and_then(|v| v.get("name"))
            .and_then(|v| v.as_str());
        let applies = os
            .map(|name| name == current_minecraft_os())
            .unwrap_or(true);
        if applies {
            allowed = action == "allow";
        }
    }
    allowed
}

fn maven_path(name: &str) -> Option<PathBuf> {
    let mut parts = name.split(':');
    let group = parts.next()?;
    let artifact = parts.next()?;
    let version = parts.next()?;
    let ext = parts.next().unwrap_or("jar");
    let mut path = PathBuf::new();
    for piece in group.split('.') {
        path.push(piece);
    }
    path.push(artifact);
    path.push(version);
    path.push(format!("{artifact}-{version}.{ext}"));
    Some(path)
}

fn minecraft_rule_allows_current_os(rule: &Value) -> bool {
    let os_name = rule
        .get("os")
        .and_then(|v| v.get("name"))
        .and_then(|v| v.as_str());
    let arch = rule
        .get("os")
        .and_then(|v| v.get("arch"))
        .and_then(|v| v.as_str());

    let os_ok = os_name
        .map(|name| name == current_minecraft_os())
        .unwrap_or(true);
    let arch_ok = arch
        .map(|target| std::env::consts::ARCH.contains(target))
        .unwrap_or(true);

    os_ok && arch_ok
}

fn argument_allowed_for_current_os(arg: &Value) -> bool {
    let Some(rules) = arg.get("rules").and_then(|v| v.as_array()) else {
        return true;
    };

    let mut allowed = false;
    for rule in rules {
        let action = rule
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or("allow");
        if minecraft_rule_allows_current_os(rule) {
            allowed = action == "allow";
        }
    }
    allowed
}

fn append_argument_values(target: &mut Vec<String>, argument_node: &Value) {
    if let Some(text) = argument_node.as_str() {
        target.push(text.to_string());
        return;
    }

    let Some(obj) = argument_node.as_object() else {
        return;
    };

    if !argument_allowed_for_current_os(argument_node) {
        return;
    }

    let Some(value) = obj.get("value") else {
        return;
    };

    match value {
        Value::String(single) => target.push(single.to_string()),
        Value::Array(values) => {
            for item in values {
                if let Some(single) = item.as_str() {
                    target.push(single.to_string());
                }
            }
        }
        _ => {}
    }
}

fn expand_launch_placeholders(value: &str, variables: &HashMap<&str, String>) -> String {
    let mut expanded = value.to_string();
    for (key, replacement) in variables {
        expanded = expanded.replace(&format!("${{{key}}}"), replacement);
    }
    expanded
}

fn has_unresolved_placeholder(value: &str) -> bool {
    value.contains("${") && value.contains('}')
}

fn sanitize_game_args(args: &mut Vec<String>) {
    let mut sanitized = Vec::new();
    let mut index = 0;

    while index < args.len() {
        let current = &args[index];

        if current == "--demo" {
            index += 1;
            continue;
        }

        if current.starts_with("--") && index + 1 < args.len() && !args[index + 1].starts_with("--")
        {
            let value = &args[index + 1];
            if has_unresolved_placeholder(current) || has_unresolved_placeholder(value) {
                index += 2;
                continue;
            }
            sanitized.push(current.clone());
            sanitized.push(value.clone());
            index += 2;
            continue;
        }

        if !has_unresolved_placeholder(current) {
            sanitized.push(current.clone());
        }
        index += 1;
    }

    *args = sanitized;
}

fn normalize_resolution_args(args: &mut Vec<String>) {
    let width = extract_or_fallback_arg(args, "--width", "1280")
        .parse::<u32>()
        .ok()
        .filter(|value| *value > 0)
        .unwrap_or(1280)
        .to_string();
    let height = extract_or_fallback_arg(args, "--height", "720")
        .parse::<u32>()
        .ok()
        .filter(|value| *value > 0)
        .unwrap_or(720)
        .to_string();

    upsert_game_arg(args, "--width", width);
    upsert_game_arg(args, "--height", height);
}

fn normalize_java_launch_args(
    args: Vec<String>,
    classpath: String,
    natives_dir: &Path,
) -> Vec<String> {
    let mut normalized = Vec::new();
    let mut index = 0;
    let mut java_library_path_seen = false;

    while index < args.len() {
        let current = &args[index];
        let is_cp_flag = current == "-cp" || current == "-classpath";
        let is_cp_inline = current.starts_with("-cp=") || current.starts_with("-classpath=");

        if is_cp_flag {
            index += 2;
            continue;
        }

        if is_cp_inline {
            index += 1;
            continue;
        }

        if current.starts_with("-Djava.library.path=") {
            if java_library_path_seen {
                index += 1;
                continue;
            }

            let value = current
                .split_once('=')
                .map(|(_, value)| value)
                .unwrap_or_default();
            let resolved = if value.trim().is_empty() || has_unresolved_placeholder(value) {
                natives_dir.to_string_lossy().to_string()
            } else {
                value.to_string()
            };
            normalized.push(format!("-Djava.library.path={resolved}"));
            java_library_path_seen = true;
            index += 1;
            continue;
        }

        normalized.push(current.clone());
        index += 1;
    }

    if !java_library_path_seen {
        normalized.push(format!(
            "-Djava.library.path={}",
            natives_dir.to_string_lossy()
        ));
    }

    normalized.push("-cp".to_string());
    normalized.push(classpath);
    normalized
}

fn merge_version_json(parent: &Value, child: &Value) -> Value {
    let mut merged = parent.clone();

    if let Some(parent_obj) = merged.as_object_mut() {
        if let Some(child_obj) = child.as_object() {
            for (key, child_value) in child_obj {
                if key == "libraries" {
                    let mut libraries = parent_obj
                        .get("libraries")
                        .and_then(|value| value.as_array())
                        .cloned()
                        .unwrap_or_default();
                    libraries.extend(child_value.as_array().cloned().unwrap_or_default());
                    parent_obj.insert("libraries".to_string(), Value::Array(libraries));
                    continue;
                }

                if key == "arguments" {
                    let mut merged_arguments = parent_obj
                        .get("arguments")
                        .cloned()
                        .unwrap_or_else(|| serde_json::json!({}));

                    if let Some(arguments_obj) = merged_arguments.as_object_mut() {
                        let child_arguments = child_value.as_object().cloned().unwrap_or_default();

                        for argument_key in ["game", "jvm"] {
                            let mut values = arguments_obj
                                .get(argument_key)
                                .and_then(|value| value.as_array())
                                .cloned()
                                .unwrap_or_default();
                            values.extend(
                                child_arguments
                                    .get(argument_key)
                                    .and_then(|value| value.as_array())
                                    .cloned()
                                    .unwrap_or_default(),
                            );
                            arguments_obj.insert(argument_key.to_string(), Value::Array(values));
                        }
                    }

                    parent_obj.insert("arguments".to_string(), merged_arguments);
                    continue;
                }

                parent_obj.insert(key.clone(), child_value.clone());
            }
        }
    }

    merged
}

fn resolve_loader_profile_json(
    minecraft_root: &Path,
    version: &str,
    loader: &str,
    loader_version: Option<&str>,
    base_version_json: &Value,
) -> Option<Value> {
    let loader_version = loader_version.unwrap_or("latest").trim();
    if loader_version.is_empty() || loader_version.eq_ignore_ascii_case("latest") {
        return None;
    }

    let mut candidates = Vec::new();
    candidates.push(loader_version.to_string());
    candidates.push(format!("{version}-{loader}-{loader_version}"));
    candidates.push(format!("{version}-{loader_version}"));
    if loader == "forge" {
        candidates.push(format!("{version}-forge-{loader_version}"));
    }
    if loader == "neoforge" {
        candidates.push(format!("{version}-neoforge-{loader_version}"));
    }

    for candidate in candidates {
        let json_path = minecraft_root
            .join("versions")
            .join(&candidate)
            .join(format!("{candidate}.json"));
        if !json_path.exists() {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&json_path) else {
            continue;
        };
        let Ok(loader_json) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };

        let inherits_from = loader_json
            .get("inheritsFrom")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .trim()
            .to_string();
        let parent = if inherits_from.is_empty() || inherits_from == version {
            base_version_json.clone()
        } else {
            let parent_path = minecraft_root
                .join("versions")
                .join(&inherits_from)
                .join(format!("{inherits_from}.json"));
            if !parent_path.exists() {
                base_version_json.clone()
            } else {
                fs::read_to_string(parent_path)
                    .ok()
                    .and_then(|content| serde_json::from_str::<Value>(&content).ok())
                    .unwrap_or_else(|| base_version_json.clone())
            }
        };

        return Some(merge_version_json(&parent, &loader_json));
    }

    None
}

async fn resolve_latest_loader_version(loader: &str, minecraft_version: &str) -> Option<String> {
    if loader == "forge" {
        let promotions_url =
            "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
        if let Ok(resp) = reqwest::get(promotions_url).await {
            if let Ok(json) = resp.json::<Value>().await {
                let key_recommended = format!("{minecraft_version}-recommended");
                let key_latest = format!("{minecraft_version}-latest");
                if let Some(version) = json
                    .get("promos")
                    .and_then(|v| v.get(&key_recommended).or_else(|| v.get(&key_latest)))
                    .and_then(|v| v.as_str())
                {
                    return Some(format!("{minecraft_version}-{version}"));
                }
            }
        }
    }

    let metadata_urls = if loader == "neoforge" {
        vec!["https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml"]
    } else {
        vec!["https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml"]
    };

    for url in metadata_urls {
        let Ok(resp) = reqwest::get(url).await else {
            continue;
        };
        let Ok(xml) = resp.text().await else {
            continue;
        };
        let mut matches = xml
            .match_indices("<version>")
            .filter_map(|(start, _)| {
                let rest = &xml[start + 9..];
                let end = rest.find("</version>")?;
                Some(rest[..end].to_string())
            })
            .collect::<Vec<_>>();
        matches.retain(|value| value.starts_with(minecraft_version));
        matches.sort();
        if let Some(last) = matches.last() {
            return Some(last.clone());
        }
    }

    None
}

async fn resolve_latest_fabric_like_loader_version(
    loader: &str,
    minecraft_version: &str,
) -> Option<String> {
    let endpoint = if loader == "quilt" {
        format!("https://meta.quiltmc.org/v3/versions/loader/{minecraft_version}")
    } else {
        format!("https://meta.fabricmc.net/v2/versions/loader/{minecraft_version}")
    };

    let Ok(resp) = reqwest::get(&endpoint).await else {
        return None;
    };
    let Ok(json) = resp.json::<Value>().await else {
        return None;
    };
    json.as_array()
        .and_then(|values| values.first())
        .and_then(|entry| entry.get("loader"))
        .and_then(|loader| loader.get("version"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
}
async fn install_forge_like_loader(
    app: &tauri::AppHandle,
    minecraft_root: &Path,
    minecraft_version: &str,
    loader: &str,
    requested_loader_version: Option<&str>,
) -> Result<String, String> {
    ensure_forge_preflight_files(minecraft_root, minecraft_version)?;

    let requested = requested_loader_version
        .unwrap_or("latest")
        .trim()
        .to_string();
    let resolved_version = if requested.is_empty() || requested.eq_ignore_ascii_case("latest") {
        resolve_latest_loader_version(loader, minecraft_version)
            .await
            .ok_or_else(|| {
                format!(
                    "No se pudo resolver una versión {loader} para Minecraft {minecraft_version}."
                )
            })?
    } else {
        requested
    };

    let (base_url, artifact_name, expected_id) = if loader == "neoforge" {
        (
            "https://maven.neoforged.net/releases/net/neoforged/neoforge",
            "neoforge",
            if resolved_version.starts_with(minecraft_version) {
                resolved_version.clone()
            } else {
                format!("{minecraft_version}-{resolved_version}")
            },
        )
    } else {
        (
            "https://maven.minecraftforge.net/net/minecraftforge/forge",
            "forge",
            resolved_version.clone(),
        )
    };

    let installer_url =
        format!("{base_url}/{resolved_version}/{artifact_name}-{resolved_version}-installer.jar");
    let mut installer_urls = vec![installer_url];
    if loader == "forge" {
        installer_urls.push(format!(
            "https://files.minecraftforge.net/maven/net/minecraftforge/forge/{resolved_version}/forge-{resolved_version}-installer.jar"
        ));
    }
    let installer_target = minecraft_root
        .join("installers")
        .join(format!("{artifact_name}-{resolved_version}-installer.jar"));
    download_from_candidates(
        &installer_urls,
        &installer_target,
        "instalador Forge/NeoForge",
    )
    .await?;

    let manager = JavaManager::new(app)?;
    let required_java_major = manager.required_major_for_minecraft(minecraft_version);
    let runtimes = manager.detect_installed();
    let java_bin = runtimes
        .iter()
        .find(|runtime| runtime.major == required_java_major)
        .or_else(|| {
            runtimes
                .iter()
                .find(|runtime| runtime.major > required_java_major)
        })
        .map(|runtime| runtime.path.clone())
        .or_else(|| command_available("java").then(|| "java".to_string()))
        .ok_or_else(|| {
            let loader_name = if loader == "neoforge" {
                "NeoForge"
            } else {
                "Forge"
            };
            format!(
                "No se encontró Java compatible para instalar {loader_name} (requerido Java {required_java_major})."
            )
        })?;

    let install_flag = if loader == "neoforge" {
        "--install-client"
    } else {
        "--installClient"
    };
    let mut installer = Command::new(&java_bin)
        .current_dir(minecraft_root)
        .arg("-jar")
        .arg(&installer_target)
        .arg(install_flag)
        .arg(minecraft_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("No se pudo ejecutar el instalador {loader}: {error}"))?;

    let start = std::time::Instant::now();
    let install_timeout = Duration::from_secs(600);
    loop {
        if let Some(status) = installer
            .try_wait()
            .map_err(|error| format!("No se pudo monitorear instalador {loader}: {error}"))?
        {
            if !status.success() {
                let exit_code = status.code().unwrap_or(-1);
                return Err(format!(
                    "Falló la instalación de {loader} {resolved_version} (código {exit_code})."
                ));
            }
            break;
        }

        if start.elapsed() >= install_timeout {
            let _ = installer.kill();
            return Err(format!(
                "El instalador de {loader} {resolved_version} excedió el tiempo límite ({}s).",
                install_timeout.as_secs()
            ));
        }

        std::thread::sleep(Duration::from_millis(400));
    }

    let version_dir = minecraft_root.join("versions").join(&expected_id);
    let version_json = version_dir.join(format!("{expected_id}.json"));
    if !version_json.exists() {
        return Err(format!(
            "El instalador de {loader} terminó pero no creó {}",
            version_json.display()
        ));
    }

    Ok(expected_id)
}

fn ensure_forge_preflight_files(
    minecraft_root: &Path,
    minecraft_version: &str,
) -> Result<(), String> {
    let version_dir = minecraft_root.join("versions").join(minecraft_version);
    let version_jar = version_dir.join(format!("{minecraft_version}.jar"));
    let version_json = version_dir.join(format!("{minecraft_version}.json"));
    if !version_jar.exists() || !version_json.exists() {
        return Err(format!(
            "Preflight Forge incompleto: faltan archivos base de Minecraft ({}, {}).",
            version_jar.display(),
            version_json.display()
        ));
    }

    let launcher_profiles = minecraft_root.join("launcher_profiles.json");
    if !launcher_profiles.exists() {
        let default_profile = serde_json::json!({
            "profiles": {
                "FrutiLauncher": {
                    "name": "FrutiLauncher",
                    "type": "custom",
                    "lastVersionId": minecraft_version
                }
            },
            "selectedProfile": "FrutiLauncher",
            "clientToken": "00000000000000000000000000000000",
            "authenticationDatabase": {}
        });
        fs::write(
            &launcher_profiles,
            serde_json::to_string_pretty(&default_profile).map_err(|error| {
                format!("No se pudo serializar launcher_profiles.json: {error}")
            })?,
        )
        .map_err(|error| format!("No se pudo crear launcher_profiles.json para Forge: {error}"))?;
    }

    Ok(())
}

async fn download_from_candidates(urls: &[String], path: &Path, label: &str) -> Result<(), String> {
    download_with_retries(urls, path, None, 4, should_validate_zip_from_path(path))
        .await
        .map_err(|error| format!("No se pudo descargar {label}. Último error: {error}"))
}

fn upsert_game_arg(args: &mut Vec<String>, key: &str, value: String) {
    if let Some(position) = args.iter().position(|arg| arg == key) {
        if position + 1 < args.len() {
            args[position + 1] = value;
            return;
        }
        args.push(value);
        return;
    }

    args.push(key.to_string());
    args.push(value);
}

async fn download_to(url: &str, path: &Path) -> Result<(), String> {
    let urls = vec![url.to_string()];
    download_with_retries(&urls, path, None, 4, should_validate_zip_from_path(path)).await
}

fn should_validate_zip_from_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("jar") || ext.eq_ignore_ascii_case("zip"))
        .unwrap_or(false)
}

fn file_sha1(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| {
        format!(
            "No se pudo abrir archivo para SHA1 {}: {error}",
            path.display()
        )
    })?;
    let mut hasher = Sha1::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let read = file.read(&mut buffer).map_err(|error| {
            format!(
                "No se pudo leer archivo para SHA1 {}: {error}",
                path.display()
            )
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn download_partial_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("download");
    path.parent()
        .map(|parent| parent.join(format!("{file_name}.part")))
        .unwrap_or_else(|| PathBuf::from(format!("{file_name}.part")))
}

async fn download_with_retries(
    urls: &[String],
    path: &Path,
    expected_sha1: Option<&str>,
    attempts: u8,
    validate_zip: bool,
) -> Result<(), String> {
    if let Ok(meta) = fs::metadata(path) {
        if meta.is_file() && meta.len() > 0 && (!validate_zip || is_valid_zip_archive(path)) {
            if let Some(expected) = expected_sha1 {
                let existing_hash = file_sha1(path)?;
                if existing_hash.eq_ignore_ascii_case(expected) {
                    return Ok(());
                }
            } else {
                return Ok(());
            }
        }
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("No se pudo crear carpeta para descarga: {error}"))?;
    }

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(12))
        .timeout(std::time::Duration::from_secs(120))
        .user_agent("FrutiLauncher/1.0")
        .build()
        .map_err(|error| format!("No se pudo preparar cliente HTTP: {error}"))?;

    let partial_path = download_partial_path(path);
    let max_attempts = attempts.max(1);
    let mut last_error = None;

    for attempt in 1..=max_attempts {
        for url in urls {
            let resume_from = fs::metadata(&partial_path)
                .map(|meta| meta.len())
                .unwrap_or(0);
            let mut request = client.get(url);
            if resume_from > 0 {
                request = request.header(reqwest::header::RANGE, format!("bytes={resume_from}-"));
            }

            match request.send().await {
                Ok(response) => {
                    if !(response.status().is_success()
                        || response.status() == reqwest::StatusCode::PARTIAL_CONTENT)
                    {
                        last_error = Some(format!("{url} respondió {}", response.status()));
                        continue;
                    }

                    let append_mode = resume_from > 0
                        && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
                    let bytes = response
                        .bytes()
                        .await
                        .map_err(|error| format!("No se pudo leer respuesta {url}: {error}"))?;
                    let mut options = fs::OpenOptions::new();
                    options.write(true).create(true);
                    if append_mode {
                        options.append(true);
                    } else {
                        options.truncate(true);
                    }
                    let mut output = options.open(&partial_path).map_err(|error| {
                        format!(
                            "No se pudo abrir temporal de descarga {}: {error}",
                            partial_path.display()
                        )
                    })?;
                    output.write_all(&bytes).map_err(|error| {
                        format!(
                            "No se pudo escribir temporal de descarga {}: {error}",
                            partial_path.display()
                        )
                    })?;

                    if validate_zip && !is_valid_zip_archive(&partial_path) {
                        last_error = Some(format!("{url} devolvió un archivo zip/jar inválido"));
                        continue;
                    }

                    if let Some(expected) = expected_sha1 {
                        let downloaded_hash = file_sha1(&partial_path)?;
                        if !downloaded_hash.eq_ignore_ascii_case(expected) {
                            last_error = Some(format!(
                                "{url} devolvió hash SHA1 inválido (esperado {expected}, obtenido {downloaded_hash})"
                            ));
                            continue;
                        }
                    }

                    fs::rename(&partial_path, path).map_err(|error| {
                        format!(
                            "No se pudo mover temporal {} a {}: {error}",
                            partial_path.display(),
                            path.display()
                        )
                    })?;
                    return Ok(());
                }
                Err(error) => {
                    last_error = Some(format!("No se pudo descargar {url}: {error}"));
                }
            }
        }

        if attempt < max_attempts {
            tokio::time::sleep(std::time::Duration::from_millis(1000 * attempt as u64)).await;
        }
    }

    Err(last_error.unwrap_or_else(|| "desconocido".to_string()))
}

async fn download_many_with_limit(
    items: Vec<AssetDownloadTask>,
    concurrency: usize,
) -> Result<(), String> {
    if items.is_empty() {
        return Ok(());
    }

    let gate = std::sync::Arc::new(Semaphore::new(concurrency.max(1)));
    let mut tasks = tokio::task::JoinSet::new();

    for task in items {
        let permit_gate = gate.clone();
        tasks.spawn(async move {
            let _permit = permit_gate
                .acquire_owned()
                .await
                .map_err(|error| format!("No se pudo adquirir cupo de descarga: {error}"))?;
            download_with_retries(&task.urls, &task.path, Some(&task.sha1), 5, false)
                .await
                .map_err(|error| {
                    format!("Asset {} ({}) falló: {error}", task.object_name, task.sha1)
                })
        });
    }

    while let Some(joined) = tasks.join_next().await {
        match joined {
            Ok(Ok(())) => {}
            Ok(Err(error)) => return Err(error),
            Err(error) => return Err(format!("Error en tarea de descarga: {error}")),
        }
    }

    Ok(())
}

fn remove_partial_files(root: &Path) -> Result<u64, String> {
    if !root.exists() {
        return Ok(0);
    }

    let mut cleaned = 0_u64;
    let mut stack = vec![root.to_path_buf()];
    while let Some(current) = stack.pop() {
        let entries = fs::read_dir(&current)
            .map_err(|error| format!("No se pudo inspeccionar {}: {error}", current.display()))?;

        for entry in entries {
            let entry = entry.map_err(|error| {
                format!(
                    "No se pudo leer un elemento dentro de {}: {error}",
                    current.display()
                )
            })?;
            let path = entry.path();
            let file_type = entry.file_type().map_err(|error| {
                format!(
                    "No se pudo leer tipo de archivo {}: {error}",
                    path.display()
                )
            })?;

            if file_type.is_dir() {
                stack.push(path);
                continue;
            }

            if !file_type.is_file() {
                continue;
            }

            let file_name = path.file_name().and_then(OsStr::to_str).unwrap_or_default();
            if file_name.contains(".part.") {
                fs::remove_file(&path).map_err(|error| {
                    format!(
                        "No se pudo limpiar temporal incompleto {}: {error}",
                        path.display()
                    )
                })?;
                cleaned += 1;
            }
        }
    }

    Ok(cleaned)
}

fn is_valid_zip_archive(path: &Path) -> bool {
    let Ok(file) = fs::File::open(path) else {
        return false;
    };

    ZipArchive::new(file).is_ok()
}

fn is_valid_jar_for_runtime(path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(|value| value.to_str()) else {
        return true;
    };
    if !ext.eq_ignore_ascii_case("jar") {
        return true;
    }

    is_valid_zip_archive(path)
}

fn classpath_entries_complete(plan: &LaunchPlan) -> bool {
    !plan.classpath_entries.is_empty()
        && plan.classpath_entries.iter().all(|entry| {
            let path = Path::new(entry);
            fs::metadata(path)
                .map(|meta| meta.is_file() && meta.len() > 0)
                .unwrap_or(false)
                && is_valid_jar_for_runtime(path)
        })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ModLoaderKind {
    Fabric,
    Quilt,
    ForgeLike,
    Unknown,
}

fn detect_mod_loader_kind(mod_jar: &Path) -> ModLoaderKind {
    let Ok(file) = fs::File::open(mod_jar) else {
        return ModLoaderKind::Unknown;
    };
    let Ok(mut zip) = ZipArchive::new(file) else {
        return ModLoaderKind::Unknown;
    };

    let has_fabric = zip.by_name("fabric.mod.json").is_ok();
    let has_quilt = zip.by_name("quilt.mod.json").is_ok();
    let has_forge = zip.by_name("META-INF/mods.toml").is_ok()
        || zip.by_name("mcmod.info").is_ok()
        || zip.by_name("META-INF/neoforge.mods.toml").is_ok();

    if has_fabric {
        ModLoaderKind::Fabric
    } else if has_quilt {
        ModLoaderKind::Quilt
    } else if has_forge {
        ModLoaderKind::ForgeLike
    } else {
        ModLoaderKind::Unknown
    }
}

fn evaluate_mod_loader_compatibility(
    game_dir: &Path,
    instance_loader: &str,
) -> (bool, Vec<String>) {
    let mods_dir = game_dir.join("mods");
    if !mods_dir.exists() {
        return (true, Vec::new());
    }

    let Ok(entries) = fs::read_dir(&mods_dir) else {
        return (
            false,
            vec![format!(
                "No se pudo leer la carpeta de mods para validar compatibilidad: {}",
                mods_dir.display()
            )],
        );
    };

    let mut issues = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let is_jar = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("jar"))
            .unwrap_or(false);
        if !is_jar {
            continue;
        }

        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("mod-desconocido.jar");

        let kind = detect_mod_loader_kind(&path);
        let compatible = match instance_loader {
            "fabric" => kind == ModLoaderKind::Fabric || kind == ModLoaderKind::Unknown,
            "quilt" => {
                kind == ModLoaderKind::Quilt
                    || kind == ModLoaderKind::Fabric
                    || kind == ModLoaderKind::Unknown
            }
            "forge" | "neoforge" => {
                kind == ModLoaderKind::ForgeLike || kind == ModLoaderKind::Unknown
            }
            _ => kind == ModLoaderKind::Unknown,
        };

        if !compatible {
            issues.push(format!(
                "{file_name} parece no compatible con loader '{instance_loader}'"
            ));
        }
    }

    (issues.is_empty(), issues)
}

async fn fetch_json_with_fallback(urls: &[String], context: &str) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("FrutiLauncher/1.0")
        .build()
        .map_err(|error| format!("No se pudo preparar cliente HTTP: {error}"))?;
    let mut last_error = None;
    for url in urls {
        match client.get(url).send().await {
            Ok(response) => {
                if !response.status().is_success() {
                    last_error = Some(format!("{url} respondió {}", response.status()));
                    continue;
                }
                match response.json::<Value>().await {
                    Ok(json) => return Ok(json),
                    Err(error) => {
                        last_error = Some(format!("JSON inválido en {url}: {error}"));
                    }
                }
            }
            Err(error) => {
                last_error = Some(format!("No se pudo descargar {url}: {error}"));
            }
        }
    }

    Err(format!(
        "No se pudo descargar {context}. Último error: {}",
        last_error.unwrap_or_else(|| "desconocido".to_string())
    ))
}

fn extract_native_library(jar_path: &Path, natives_dir: &Path) -> Result<(), String> {
    let file = fs::File::open(jar_path)
        .map_err(|error| format!("No se pudo abrir nativo {}: {error}", jar_path.display()))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| format!("Jar nativo inválido: {error}"))?;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("No se pudo leer entrada nativa #{index}: {error}"))?;
        let Some(enclosed) = entry.enclosed_name().map(|name| name.to_path_buf()) else {
            continue;
        };

        let normalized = enclosed.to_string_lossy();
        if normalized.starts_with("META-INF/") || normalized.ends_with('/') {
            continue;
        }

        let is_native = normalized.ends_with(".dll")
            || normalized.ends_with(".so")
            || normalized.ends_with(".dylib")
            || normalized.ends_with(".jnilib");
        if !is_native {
            continue;
        }

        let Some(file_name) = enclosed.file_name() else {
            continue;
        };
        let target = natives_dir.join(file_name);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("No se pudo preparar carpeta de nativos: {error}"))?;
        }
        let mut output = fs::File::create(&target)
            .map_err(|error| format!("No se pudo crear nativo {}: {error}", target.display()))?;
        std::io::copy(&mut entry, &mut output).map_err(|error| {
            format!(
                "No se pudo extraer nativo {} a {}: {error}",
                normalized,
                target.display()
            )
        })?;
    }

    Ok(())
}

fn resolve_memory_config(instance_root: &Path) -> InstanceMemoryConfig {
    let path = instance_root.join("instance.json");
    let Ok(content) = fs::read_to_string(path) else {
        return InstanceMemoryConfig {
            min: 2048,
            max: 4096,
        };
    };
    let Ok(value) = serde_json::from_str::<Value>(&content) else {
        return InstanceMemoryConfig {
            min: 2048,
            max: 4096,
        };
    };
    let mem = value.get("memory").cloned().unwrap_or(Value::Null);
    let min = mem.get("min").and_then(|v| v.as_u64()).unwrap_or(2048) as u32;
    let max = mem.get("max").and_then(|v| v.as_u64()).unwrap_or(4096) as u32;
    InstanceMemoryConfig {
        min,
        max: max.max(min),
    }
}

fn normalize_uuid(raw: &str) -> Option<String> {
    let compact = raw.trim().replace('-', "").to_lowercase();
    if compact.len() == 32 && compact.chars().all(|ch| ch.is_ascii_hexdigit()) {
        Some(compact)
    } else {
        None
    }
}

fn default_offline_uuid(username: &str) -> String {
    let left = murmurhash2(username.as_bytes());
    let right = murmurhash2(format!("fruti-{username}").as_bytes());
    let time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or_default();
    format!("{left:08x}{right:08x}{:016x}", time)
}

fn current_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn apply_auth_to_launch_plan(plan: &mut LaunchPlan, auth: LaunchAuth) {
    let mut replace_flag_value = |flag: &str, value: &str| {
        if let Some(index) = plan.game_args.iter().position(|arg| arg == flag) {
            if let Some(slot) = plan.game_args.get_mut(index + 1) {
                *slot = value.to_string();
                return;
            }
        }
        plan.game_args.push(flag.to_string());
        plan.game_args.push(value.to_string());
    };

    replace_flag_value("--username", &auth.username);
    replace_flag_value("--uuid", &auth.uuid);
    replace_flag_value("--accessToken", &auth.access_token);
    replace_flag_value("--userType", &auth.user_type);
    plan.auth = auth;
}

fn ensure_single_game_arg(plan: &mut LaunchPlan, flag: &str, value: &str) {
    let mut index = 0;
    let mut first_match: Option<usize> = None;
    while index < plan.game_args.len() {
        if plan.game_args[index] == flag {
            if first_match.is_none() {
                first_match = Some(index);
                if let Some(slot) = plan.game_args.get_mut(index + 1) {
                    *slot = value.to_string();
                } else {
                    plan.game_args.push(value.to_string());
                }
                index += 2;
                continue;
            }

            let remove_count = if index + 1 < plan.game_args.len() {
                2
            } else {
                1
            };
            plan.game_args.drain(index..index + remove_count);
            continue;
        }
        index += 1;
    }

    if first_match.is_none() {
        plan.game_args.push(flag.to_string());
        plan.game_args.push(value.to_string());
    }
}

fn normalize_critical_game_args(plan: &mut LaunchPlan, version: &str) {
    sanitize_game_args(&mut plan.game_args);
    let username = if plan.auth.username.trim().is_empty() {
        "Player".to_string()
    } else {
        plan.auth.username.clone()
    };
    let uuid = plan.auth.uuid.clone();
    let user_type = if plan.auth.user_type.trim().is_empty() {
        "offline".to_string()
    } else {
        plan.auth.user_type.clone()
    };
    let access_token = if user_type == "offline" {
        "0".to_string()
    } else {
        plan.auth.access_token.clone()
    };
    let version_type = extract_or_fallback_arg(&plan.game_args, "--versionType", "FrutiLauncher");

    ensure_single_game_arg(plan, "--username", &username);
    ensure_single_game_arg(plan, "--version", version);
    ensure_single_game_arg(plan, "--uuid", &uuid);
    ensure_single_game_arg(plan, "--accessToken", &access_token);
    ensure_single_game_arg(plan, "--userType", &user_type);
    ensure_single_game_arg(plan, "--versionType", &version_type);
    normalize_resolution_args(&mut plan.game_args);

    plan.auth.username = username;
    plan.auth.user_type = user_type;
    plan.auth.access_token = access_token;
}

fn extract_or_fallback_arg(args: &[String], flag: &str, fallback: &str) -> String {
    args.iter()
        .position(|arg| arg == flag)
        .and_then(|index| args.get(index + 1))
        .cloned()
        .unwrap_or_else(|| fallback.to_string())
}

async fn bootstrap_instance_runtime(
    app: &tauri::AppHandle,
    instance_root: &Path,
    instance: &InstanceRecord,
) -> Result<(), String> {
    let minecraft_root = instance_root.join("minecraft");
    let version = instance.version.trim();
    let loader = instance
        .loader_name
        .as_deref()
        .unwrap_or("vanilla")
        .trim()
        .to_lowercase();

    let assets_objects_dir = minecraft_root.join("assets").join("objects");
    let libraries_dir = minecraft_root.join("libraries");
    let cleaned_assets = remove_partial_files(&assets_objects_dir)?;
    let cleaned_libraries = remove_partial_files(&libraries_dir)?;
    if cleaned_assets > 0 || cleaned_libraries > 0 {
        write_instance_state(
            instance_root,
            "cleaning_partials",
            serde_json::json!({
                "assetsPartials": cleaned_assets,
                "librariesPartials": cleaned_libraries
            }),
        );
    }

    let manifest_urls = vec![
        "https://launchermeta.mojang.com/mc/game/version_manifest.json".to_string(),
        "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json".to_string(),
    ];
    write_instance_state(
        instance_root,
        "downloading_manifest",
        serde_json::json!({"step": "version_manifest"}),
    );
    let manifest_json = fetch_json_with_fallback(&manifest_urls, "manifiesto de versiones").await?;
    let manifest = serde_json::from_value::<MojangVersionManifest>(manifest_json)
        .map_err(|error| format!("No se pudo parsear el manifiesto de versiones: {error}"))?;

    let Some(version_entry) = manifest
        .versions
        .into_iter()
        .find(|entry| entry.id == version)
    else {
        return Err(format!(
            "La versión {version} no existe en el manifiesto oficial."
        ));
    };

    let version_json_urls = vec![
        version_entry.url.clone(),
        version_entry
            .url
            .replace("piston-meta.mojang.com", "launchermeta.mojang.com"),
    ];
    write_instance_state(
        instance_root,
        "downloading_version_metadata",
        serde_json::json!({"version": version}),
    );
    let base_version_json =
        fetch_json_with_fallback(&version_json_urls, "metadata de versión").await?;

    let version_dir = minecraft_root.join("versions").join(version);
    fs::create_dir_all(&version_dir)
        .map_err(|error| format!("No se pudo crear carpeta versions: {error}"))?;
    fs::write(
        version_dir.join(format!("{version}.json")),
        serde_json::to_string_pretty(&base_version_json)
            .map_err(|error| format!("No se pudo serializar version.json: {error}"))?,
    )
    .map_err(|error| format!("No se pudo guardar version.json: {error}"))?;

    let client_url = base_version_json
        .get("downloads")
        .and_then(|v| v.get("client"))
        .and_then(|v| v.get("url"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "La metadata de Minecraft no trae URL de client.jar".to_string())?;
    let client_jar = version_dir.join(format!("{version}.jar"));
    write_instance_state(
        instance_root,
        "downloading_client",
        serde_json::json!({"version": version, "target": client_jar.to_string_lossy()}),
    );
    download_to(client_url, &client_jar).await?;

    let asset_index_url = base_version_json
        .get("assetIndex")
        .and_then(|v| v.get("url"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "La metadata de Minecraft no trae assetIndex.url".to_string())?;
    let asset_index_id = base_version_json
        .get("assetIndex")
        .and_then(|v| v.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("legacy");
    write_instance_state(
        instance_root,
        "downloading_asset_index",
        serde_json::json!({"step": "asset_index", "url": asset_index_url}),
    );
    let asset_index_urls = vec![
        asset_index_url.to_string(),
        asset_index_url.replace("piston-meta.mojang.com", "launchermeta.mojang.com"),
        asset_index_url.replace("launchermeta.mojang.com", "piston-meta.mojang.com"),
    ];
    let asset_index_json = fetch_json_with_fallback(&asset_index_urls, "asset index").await?;
    let indexes_dir = minecraft_root.join("assets").join("indexes");
    fs::create_dir_all(&indexes_dir)
        .map_err(|error| format!("No se pudo crear indexes dir: {error}"))?;
    fs::write(
        indexes_dir.join(format!("{asset_index_id}.json")),
        serde_json::to_string_pretty(&asset_index_json)
            .map_err(|error| format!("No se pudo serializar asset index: {error}"))?,
    )
    .map_err(|error| format!("No se pudo guardar asset index: {error}"))?;

    write_instance_state(
        instance_root,
        "downloading_assets",
        serde_json::json!({"assetIndex": asset_index_id}),
    );

    if let Some(objects) = asset_index_json.get("objects").and_then(|v| v.as_object()) {
        let mut downloads = Vec::new();
        for value in objects.values() {
            let Some(hash) = value.get("hash").and_then(|v| v.as_str()) else {
                continue;
            };
            if hash.len() < 2 {
                continue;
            }
            let sub = &hash[0..2];
            let target = minecraft_root
                .join("assets")
                .join("objects")
                .join(sub)
                .join(hash);
            let urls = ASSET_MIRROR_BASES
                .iter()
                .map(|base| format!("{base}/{sub}/{hash}"))
                .collect::<Vec<_>>();
            downloads.push(AssetDownloadTask {
                urls,
                path: target,
                sha1: hash.to_string(),
                object_name: value
                    .get("path")
                    .and_then(|v| v.as_str())
                    .unwrap_or("asset")
                    .to_string(),
            });
        }
        let total_downloads = downloads.len();
        write_instance_state(
            instance_root,
            "downloading_assets",
            serde_json::json!({"assetIndex": asset_index_id, "total": total_downloads}),
        );
        download_many_with_limit(downloads, 24).await?;
        write_instance_state(
            instance_root,
            "assets_ready",
            serde_json::json!({"assetIndex": asset_index_id, "total": total_downloads}),
        );
    }

    let mut effective_version_json = base_version_json.clone();
    if loader == "forge" || loader == "neoforge" {
        write_instance_state(
            instance_root,
            "installing_loader",
            serde_json::json!({"loader": loader, "version": instance.loader_version, "step": "forge_like"}),
        );
        let _installed_profile_id = install_forge_like_loader(
            app,
            &minecraft_root,
            version,
            &loader,
            instance.loader_version.as_deref(),
        )
        .await?;
        if let Some(profile_json) = resolve_loader_profile_json(
            &minecraft_root,
            version,
            &loader,
            instance.loader_version.as_deref(),
            &base_version_json,
        ) {
            effective_version_json = profile_json;
        }
    }

    let mut libraries: Vec<Value> = effective_version_json
        .get("libraries")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut main_class = effective_version_json
        .get("mainClass")
        .and_then(|v| v.as_str())
        .unwrap_or("net.minecraft.client.main.Main")
        .to_string();
    let mut game_arguments = effective_version_json
        .get("arguments")
        .and_then(|v| v.get("game"))
        .cloned()
        .unwrap_or(Value::Array(Vec::new()));
    let mut jvm_arguments = effective_version_json
        .get("arguments")
        .and_then(|v| v.get("jvm"))
        .cloned()
        .unwrap_or(Value::Array(Vec::new()));

    if loader == "fabric" || loader == "quilt" {
        let requested_loader_version = instance
            .loader_version
            .as_deref()
            .unwrap_or("latest")
            .trim();
        let loader_version = if requested_loader_version.is_empty()
            || requested_loader_version.eq_ignore_ascii_case("latest")
        {
            resolve_latest_fabric_like_loader_version(&loader, version)
                .await
                .unwrap_or_else(|| "latest".to_string())
        } else {
            requested_loader_version.to_string()
        };
        let profile_urls = if loader == "quilt" {
            vec![
                format!(
                    "https://meta.quiltmc.org/v3/versions/loader/{}/{}/profile/json",
                    version, loader_version
                ),
                format!(
                    "https://meta.quiltmc.org/v3/versions/loader/{}/latest/profile/json",
                    version
                ),
            ]
        } else {
            vec![
                format!(
                    "https://meta.fabricmc.net/v2/versions/loader/{}/{}/profile/json",
                    version, loader_version
                ),
                format!(
                    "https://meta.fabricmc.net/v2/versions/loader/{}/{}/profile/json",
                    version, "stable"
                ),
            ]
        };
        write_instance_state(
            instance_root,
            "installing_loader",
            serde_json::json!({"loader": loader, "version": loader_version, "step": "fabric_profile"}),
        );
        let profile = fetch_json_with_fallback(&profile_urls, "perfil del loader").await?;
        effective_version_json = merge_version_json(&effective_version_json, &profile);
        libraries = effective_version_json
            .get("libraries")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        if let Some(class) = effective_version_json
            .get("mainClass")
            .and_then(|v| v.as_str())
        {
            main_class = class.to_string();
        }
        if let Some(args) = effective_version_json
            .get("arguments")
            .and_then(|v| v.get("game"))
        {
            game_arguments = args.clone();
        }
        if let Some(args) = effective_version_json
            .get("arguments")
            .and_then(|v| v.get("jvm"))
        {
            jvm_arguments = args.clone();
        }
    }

    if game_arguments.as_array().is_none() {
        if let Some(legacy_args) = effective_version_json
            .get("minecraftArguments")
            .and_then(|v| v.as_str())
        {
            game_arguments = Value::Array(
                legacy_args
                    .split_whitespace()
                    .map(|value| Value::String(value.to_string()))
                    .collect(),
            );
        }
    }

    if jvm_arguments.as_array().is_none() {
        jvm_arguments = Value::Array(Vec::new());
    }

    if main_class.trim().is_empty() {
        main_class = "net.minecraft.client.main.Main".to_string();
    }

    let mut classpath_entries = Vec::new();
    let mut classpath_seen = HashSet::new();
    let natives_dir = minecraft_root.join("natives");
    fs::create_dir_all(&natives_dir)
        .map_err(|error| format!("No se pudo crear natives dir: {error}"))?;
    let os_native_key = match current_minecraft_os() {
        "windows" => "natives-windows",
        "osx" => "natives-osx",
        _ => "natives-linux",
    };

    write_instance_state(
        instance_root,
        "downloading_libraries",
        serde_json::json!({"step": "libraries", "total": libraries.len()}),
    );

    for library in libraries {
        if !library_allowed_for_current_os(&library) {
            continue;
        }
        let mut artifact_resolved = false;

        if let Some(downloads) = library.get("downloads") {
            if let Some(artifact) = downloads.get("artifact") {
                let url = artifact.get("url").and_then(|v| v.as_str());
                let path = artifact
                    .get("path")
                    .and_then(|v| v.as_str())
                    .map(PathBuf::from)
                    .or_else(|| {
                        library
                            .get("name")
                            .and_then(|v| v.as_str())
                            .and_then(maven_path)
                    });
                if let (Some(url), Some(rel)) = (url, path) {
                    let target = minecraft_root.join("libraries").join(rel);
                    download_to(url, &target).await?;
                    if classpath_seen.insert(target.clone()) {
                        classpath_entries.push(target);
                    }
                    artifact_resolved = true;
                }
            }

            if let Some(classifiers) = downloads.get("classifiers") {
                if let Some(native) = classifiers
                    .get(os_native_key)
                    .or_else(|| classifiers.get("natives-windows-64"))
                {
                    if let (Some(url), Some(path)) = (
                        native.get("url").and_then(|v| v.as_str()),
                        native.get("path").and_then(|v| v.as_str()),
                    ) {
                        let native_jar = minecraft_root.join("libraries").join(path);
                        download_to(url, &native_jar).await?;
                        extract_native_library(&native_jar, &natives_dir)?;
                    }
                }
            }
        }

        if !artifact_resolved {
            let maven_name = library.get("name").and_then(|v| v.as_str());
            let base_url = library
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or("https://libraries.minecraft.net/")
                .trim_end_matches('/');

            if let Some(rel) = maven_name.and_then(maven_path) {
                let rel_url = rel.to_string_lossy().replace('\\', "/");
                let target = minecraft_root.join("libraries").join(&rel);
                let url = format!("{base_url}/{rel_url}");
                download_to(&url, &target).await?;
                if classpath_seen.insert(target.clone()) {
                    classpath_entries.push(target);
                }
            }
        }
    }

    if classpath_seen.insert(client_jar.clone()) {
        classpath_entries.push(client_jar.clone());
    }

    let java_major = base_version_json
        .get("javaVersion")
        .and_then(|v| v.get("majorVersion"))
        .and_then(|v| v.as_u64())
        .unwrap_or(17) as u32;
    let manager = JavaManager::new(app)?;
    let mut resolution = manager.resolve_for_minecraft(version);
    resolution.required_major = java_major;
    let selected = resolution
        .runtimes
        .iter()
        .find(|r| r.major == java_major)
        .cloned()
        .or_else(|| {
            resolution
                .runtimes
                .iter()
                .find(|r| r.major > java_major)
                .cloned()
        })
        .or_else(|| {
            if command_available("java") {
                Some(JavaRuntime {
                    id: "path-java".to_string(),
                    name: "Java del PATH".to_string(),
                    path: "java".to_string(),
                    version: "desconocida".to_string(),
                    major: java_major,
                    architecture: std::env::consts::ARCH.to_string(),
                    source: "path".to_string(),
                    recommended: true,
                })
            } else {
                None
            }
        })
        .ok_or_else(|| format!("No se encontró Java compatible. Requerido Java {java_major}."))?;

    write_instance_state(
        instance_root,
        "libraries_ready",
        serde_json::json!({"step": "libraries"}),
    );

    let memory = resolve_memory_config(instance_root);
    let cp_separator = if cfg!(target_os = "windows") {
        ';'
    } else {
        ':'
    };
    let classpath_entries_raw = classpath_entries
        .iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>();
    let user = "Player";
    let uuid = default_offline_uuid(user);

    let mut game_args = Vec::new();

    let mut java_args = vec![
        format!("-Xms{}M", memory.min),
        format!("-Xmx{}M", memory.max),
        format!("-Djava.library.path={}", natives_dir.to_string_lossy()),
    ];

    let auth_player_name = user.to_string();
    let auth_uuid = uuid.clone();
    let auth_access_token = "0".to_string();
    let version_name = version.to_string();
    let game_dir = minecraft_root.to_string_lossy().to_string();
    let assets_root = minecraft_root.join("assets").to_string_lossy().to_string();
    let library_directory = minecraft_root
        .join("libraries")
        .to_string_lossy()
        .to_string();
    let classpath_value = classpath_entries_raw.join(&cp_separator.to_string());

    let replacements = HashMap::from([
        (
            "natives_directory",
            natives_dir.to_string_lossy().to_string(),
        ),
        ("launcher_name", "FrutiLauncher".to_string()),
        ("launcher_version", "1.0.0".to_string()),
        ("classpath", classpath_value.clone()),
        ("classpath_separator", cp_separator.to_string()),
        ("auth_player_name", auth_player_name.clone()),
        ("version_name", version_name.clone()),
        ("game_directory", game_dir.clone()),
        ("assets_root", assets_root.clone()),
        ("assets_index_name", asset_index_id.to_string()),
        ("auth_uuid", auth_uuid.clone()),
        ("auth_access_token", auth_access_token.clone()),
        ("user_type", "offline".to_string()),
        ("version_type", "FrutiLauncher".to_string()),
        ("library_directory", library_directory.clone()),
    ]);

    if let Some(values) = jvm_arguments.as_array() {
        for value in values {
            let mut resolved = Vec::new();
            append_argument_values(&mut resolved, value);
            for argument in resolved {
                java_args.push(expand_launch_placeholders(&argument, &replacements));
            }
        }
    }

    if let Some(values) = game_arguments.as_array() {
        for value in values {
            let mut resolved = Vec::new();
            append_argument_values(&mut resolved, value);
            for argument in resolved {
                game_args.push(expand_launch_placeholders(&argument, &replacements));
            }
        }
    }

    let required_game_args = [
        ("--username", user.to_string()),
        ("--version", version.to_string()),
        ("--gameDir", minecraft_root.to_string_lossy().to_string()),
        (
            "--assetsDir",
            minecraft_root.join("assets").to_string_lossy().to_string(),
        ),
        ("--assetIndex", asset_index_id.to_string()),
        ("--uuid", uuid.clone()),
        ("--accessToken", "0".to_string()),
        ("--userType", "offline".to_string()),
        ("--versionType", "FrutiLauncher".to_string()),
    ];

    for (key, value) in required_game_args {
        upsert_game_arg(&mut game_args, key, value);
    }

    sanitize_game_args(&mut game_args);
    normalize_resolution_args(&mut game_args);

    java_args = normalize_java_launch_args(java_args, classpath_value, &natives_dir);

    write_instance_state(
        instance_root,
        "building_launch_plan",
        serde_json::json!({"step": "launch_plan"}),
    );

    let launch_plan = LaunchPlan {
        java_path: selected.path.clone(),
        java_args: java_args.clone(),
        game_args: game_args.clone(),
        main_class: main_class.clone(),
        classpath_entries: classpath_entries_raw,
        classpath_separator: cp_separator.to_string(),
        game_dir: minecraft_root.to_string_lossy().to_string(),
        assets_dir: minecraft_root.join("assets").to_string_lossy().to_string(),
        libraries_dir: minecraft_root
            .join("libraries")
            .to_string_lossy()
            .to_string(),
        natives_dir: natives_dir.to_string_lossy().to_string(),
        version_json: version_dir
            .join(format!("{version}.json"))
            .to_string_lossy()
            .to_string(),
        asset_index: asset_index_id.to_string(),
        required_java_major: java_major,
        resolved_java_major: selected.major,
        loader,
        loader_profile_resolved: true,
        auth: LaunchAuth {
            username: user.to_string(),
            uuid,
            access_token: auth_access_token,
            user_type: "offline".to_string(),
        },
        env: HashMap::from([(
            "MINECRAFT_LAUNCHER_BRAND".to_string(),
            "FrutiLauncher".to_string(),
        )]),
    };

    fs::write(
        instance_root.join("launch-plan.json"),
        serde_json::to_string_pretty(&launch_plan)
            .map_err(|error| format!("No se pudo serializar launch plan: {error}"))?,
    )
    .map_err(|error| format!("No se pudo escribir launch-plan.json: {error}"))?;

    let mut command = vec![shell_escape(&selected.path)];
    command.extend(java_args.iter().map(|arg| shell_escape(arg)));
    command.push(main_class);
    command.extend(game_args.iter().map(|arg| shell_escape(arg)));

    fs::write(
        instance_root.join("launch-command.txt"),
        format!(
            "{}
",
            command.join(" ")
        ),
    )
    .map_err(|error| format!("No se pudo escribir launch-command.txt: {error}"))?;

    Ok(())
}

fn summarize_state_details(details: &Value) -> String {
    let mut chunks = Vec::new();
    if let Some(step) = details.get("step").and_then(Value::as_str) {
        chunks.push(step.to_string());
    }
    if let Some(url) = details.get("url").and_then(Value::as_str) {
        chunks.push(url.to_string());
    }
    if let Some(target) = details.get("target").and_then(Value::as_str) {
        chunks.push(target.to_string());
    }
    if let Some(name) = details.get("name").and_then(Value::as_str) {
        chunks.push(name.to_string());
    }
    if let (Some(done), Some(total)) = (
        details.get("completed").and_then(Value::as_u64),
        details.get("total").and_then(Value::as_u64),
    ) {
        chunks.push(format!("{done}/{total}"));
    }

    if chunks.is_empty() {
        details.to_string()
    } else {
        chunks.join(" | ")
    }
}

fn write_instance_state(instance_root: &Path, status: &str, details: Value) {
    let updated_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default();
    let state = serde_json::json!({
        "status": status,
        "updatedAt": updated_at,
        "details": details
    });
    let _ = fs::write(
        instance_root.join("instance-state.json"),
        serde_json::to_string_pretty(&state).unwrap_or_else(|_| "{}".to_string()),
    );

    let event_path = instance_root.join("instance-events.log");
    let summary = summarize_state_details(&state["details"]);
    let line = format!(
        "[{updated_at}] {status}: {summary}
"
    );
    let _ = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(event_path)
        .and_then(|mut file| file.write_all(line.as_bytes()));
}

fn validate_launch_plan(instance_root: &Path, plan: &LaunchPlan) -> ValidationReport {
    let mut checks = HashMap::new();
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    let is_non_empty_file = |path: &Path| -> bool {
        fs::metadata(path)
            .map(|meta| meta.is_file() && meta.len() > 0)
            .unwrap_or(false)
    };

    let is_non_empty_dir = |path: &Path| -> bool {
        if !path.is_dir() {
            return false;
        }
        fs::read_dir(path)
            .map(|mut entries| entries.next().is_some())
            .unwrap_or(false)
    };

    let launch_plan_path = instance_root.join("launch-plan.json");
    let launch_command_path = instance_root.join("launch-command.txt");
    let logs_dir = instance_root.join("logs");
    let crash_reports_dir = Path::new(&plan.game_dir).join("crash-reports");
    let version_jar_path = Path::new(&plan.version_json).with_extension("jar");

    let classpath_entries_paths: Vec<&Path> = plan
        .classpath_entries
        .iter()
        .map(|entry| Path::new(entry))
        .collect();
    let classpath_complete = !plan.classpath_entries.is_empty();
    let classpath_libraries_ok = classpath_entries_complete(plan);
    let classpath_has_mc_jar = classpath_entries_paths
        .iter()
        .any(|entry| *entry == version_jar_path.as_path());
    let has_loader_runtime_jar = match plan.loader.as_str() {
        "fabric" => plan
            .classpath_entries
            .iter()
            .any(|entry| entry.contains("fabric-loader")),
        "quilt" => plan
            .classpath_entries
            .iter()
            .any(|entry| entry.contains("quilt-loader")),
        _ => true,
    };

    let main_class_matches_loader = expected_main_class_for_loader(plan.loader.as_str())
        .map(|expected| plan.main_class == expected)
        .unwrap_or(true);

    let (mods_compatible_with_loader, mod_compatibility_issues) =
        evaluate_mod_loader_compatibility(Path::new(&plan.game_dir), &plan.loader);

    let java_major_compatible = if plan.required_java_major == 0 || plan.resolved_java_major == 0 {
        true
    } else {
        plan.resolved_java_major >= plan.required_java_major
    };

    let required_checks = [
        (
            "metadata_instancia",
            instance_root.join("instance.json").exists(),
        ),
        (
            "version_minecraft_valida",
            !plan.asset_index.trim().is_empty(),
        ),
        (
            "json_version_minecraft",
            is_non_empty_file(Path::new(&plan.version_json)),
        ),
        ("jar_minecraft_valido", is_non_empty_file(&version_jar_path)),
        ("main_class_resuelta", !plan.main_class.trim().is_empty()),
        ("main_class_loader_compatible", main_class_matches_loader),
        ("argumentos_jvm", !plan.java_args.is_empty()),
        ("argumentos_juego", !plan.game_args.is_empty()),
        (
            "placeholders_resueltos",
            !plan
                .java_args
                .iter()
                .chain(plan.game_args.iter())
                .any(|arg| has_unresolved_placeholder(arg)),
        ),
        (
            "modo_demo_desactivado",
            !plan.game_args.iter().any(|arg| arg == "--demo"),
        ),
        ("classpath_completo", classpath_complete),
        ("classpath_incluye_jar_minecraft", classpath_has_mc_jar),
        ("libraries_descargadas_compatibles", classpath_libraries_ok),
        ("assets_index", !plan.asset_index.trim().is_empty()),
        (
            "assets_descargados",
            is_non_empty_dir(&Path::new(&plan.assets_dir).join("objects")),
        ),
        (
            "natives_extraidos",
            is_non_empty_dir(Path::new(&plan.natives_dir)),
        ),
        (
            "runtime_java_compatible",
            Path::new(&plan.java_path).exists() || plan.java_path == "java",
        ),
        ("ruta_java_correcta", !plan.java_path.trim().is_empty()),
        ("version_java_compatible", java_major_compatible),
        ("game_dir", Path::new(&plan.game_dir).exists()),
        ("assets_dir", Path::new(&plan.assets_dir).exists()),
        ("libraries_dir", Path::new(&plan.libraries_dir).exists()),
        (
            "loader_instalado_si_aplica",
            if plan.loader == "vanilla" {
                true
            } else {
                plan.loader_profile_resolved
            },
        ),
        (
            "perfil_loader_resuelto",
            if plan.loader == "vanilla" {
                true
            } else {
                plan.loader_profile_resolved
            },
        ),
        ("runtime_loader_en_classpath", has_loader_runtime_jar),
        (
            "mods_compatibles_con_loader",
            if plan.loader == "vanilla" {
                true
            } else {
                mods_compatible_with_loader
            },
        ),
        (
            "configuracion_memoria",
            plan.java_args.iter().any(|arg| arg.starts_with("-Xms"))
                && plan.java_args.iter().any(|arg| arg.starts_with("-Xmx")),
        ),
        (
            "usuario_uuid",
            !plan.auth.username.is_empty() && !plan.auth.uuid.is_empty(),
        ),
        ("opciones_autenticacion", !plan.auth.user_type.is_empty()),
        (
            "permisos_ejecucion",
            Path::new(&plan.java_path).is_file() || plan.java_path == "java",
        ),
        ("validacion_previa", is_non_empty_file(&launch_plan_path)),
        ("comando_correcto", is_non_empty_file(&launch_command_path)),
        ("ejecucion_java", true),
    ];

    for (name, ok) in required_checks {
        checks.insert(name.to_string(), ok);
        if !ok {
            errors.push(format!("Fallo en requisito crítico: {name}"));
        }
    }

    let classpath_separator_valid = if cfg!(target_os = "windows") {
        plan.classpath_separator == ";"
    } else {
        plan.classpath_separator == ":"
    };
    let classpath_raw_size: usize = plan
        .classpath_entries
        .iter()
        .map(|entry| entry.len() + 1)
        .sum();
    let game_dir_is_long = cfg!(target_os = "windows") && plan.game_dir.len() > 180;

    let advisory_checks = [
        (
            "mods_descargados_si_aplica",
            if plan.loader == "vanilla" {
                true
            } else {
                Path::new(&plan.game_dir).join("mods").exists()
            },
            "No hay carpeta de mods para el loader configurado.",
        ),
        (
            "variables_entorno",
            !plan.env.is_empty(),
            "No hay variables de entorno personalizadas definidas.",
        ),
        (
            "access_token",
            !plan.auth.access_token.is_empty(),
            "Se usará sesión offline o token temporal para autenticación.",
        ),
        (
            "sistema_logs",
            logs_dir.exists(),
            "No existe carpeta de logs; se creará al primer arranque.",
        ),
        (
            "monitoreo_proceso",
            instance_root.join("instance-state.json").exists(),
            "No hay estado previo de ejecución registrado.",
        ),
        (
            "captura_stdout_stderr",
            logs_dir.exists(),
            "No hay capturas de logs previas disponibles.",
        ),
        (
            "manejo_crash",
            crash_reports_dir.exists() || logs_dir.exists(),
            "No hay reportes de crash previos para diagnóstico.",
        ),
        (
            "estado_instancia_actualizado",
            instance_root.join("instance-state.json").exists(),
            "El estado de instancia aún no fue actualizado en disco.",
        ),
        (
            "classpath_separator",
            classpath_separator_valid,
            "Separador de classpath inválido para el sistema actual.",
        ),
    ];

    for (name, ok, warning_message) in advisory_checks {
        checks.insert(name.to_string(), ok);
        if !ok {
            warnings.push(format!("{warning_message} ({name})"));
        }
    }

    if cfg!(target_os = "windows") && classpath_raw_size > 24_000 {
        warnings.push(format!(
            "El classpath acumulado tiene {} caracteres y puede causar fallos de arranque en Windows.",
            classpath_raw_size
        ));
    }

    if game_dir_is_long {
        warnings.push(
            "La ruta de la instancia es muy larga en Windows; usa una carpeta base más corta para evitar errores del loader."
                .to_string(),
        );
    }

    if !["vanilla", "fabric", "quilt", "forge", "neoforge"].contains(&plan.loader.as_str()) {
        warnings.push(format!(
            "Loader '{}' aún no tiene integración completa de perfil en esta versión.",
            plan.loader
        ));
    }

    for issue in mod_compatibility_issues {
        errors.push(format!("Mod incompatible detectado: {issue}"));
    }

    ValidationReport {
        ok: errors.is_empty(),
        errors,
        warnings,
        checks,
    }
}

fn read_launch_plan(instance_root: &Path) -> Result<LaunchPlan, String> {
    let launch_plan_path = instance_root.join("launch-plan.json");
    fs::read_to_string(&launch_plan_path)
        .map_err(|error| format!("No se pudo leer launch-plan.json: {error}"))
        .and_then(|raw| {
            serde_json::from_str::<LaunchPlan>(&raw)
                .map_err(|error| format!("launch-plan.json inválido: {error}"))
        })
}

fn launch_plan_matches_instance(plan: &LaunchPlan, instance: &InstanceRecord) -> bool {
    let requested_loader = instance
        .loader_name
        .as_deref()
        .unwrap_or("vanilla")
        .trim()
        .to_lowercase();
    let plan_version = extract_or_fallback_arg(&plan.game_args, "--version", &instance.version);

    plan_version == instance.version && plan.loader == requested_loader
}

fn build_launch_command(
    _app: &tauri::AppHandle,
    instance_root: &Path,
    _instance: &InstanceRecord,
) -> Result<String, String> {
    let launch_command = instance_root.join("launch-command.txt");
    fs::read_to_string(launch_command)
        .map(|cmd| cmd.trim().to_string())
        .map_err(|error| format!("No se pudo leer launch-command.txt: {error}"))
}

#[command]
async fn delete_instance(app: tauri::AppHandle, args: InstanceCommandArgs) -> Result<(), String> {
    let instance_id = args.instance_id.unwrap_or_default().trim().to_string();
    if instance_id.is_empty() {
        return Err("No hay una instancia válida seleccionada para eliminar.".to_string());
    }

    with_instance_lock(&instance_id, || {
        let instance_root = launcher_root(&app)?.join("instances").join(&instance_id);
        if instance_root.exists() {
            fs::remove_dir_all(&instance_root).map_err(|error| {
                format!(
                    "No se pudo eliminar la carpeta de la instancia ({}) : {error}",
                    instance_root.display()
                )
            })?;
        }

        let path = database_path(&app)?;
        let conn = Connection::open(path)
            .map_err(|error| format!("No se pudo abrir la base de datos: {error}"))?;
        conn.execute("DELETE FROM instances WHERE id = ?1", params![instance_id])
            .map_err(|error| {
                format!("No se pudo eliminar la instancia de la base de datos: {error}")
            })?;

        Ok(())
    })
}

#[command]
async fn list_java_runtimes(app: tauri::AppHandle) -> Result<Vec<JavaRuntime>, String> {
    let manager = JavaManager::new(&app)?;
    Ok(manager.detect_installed())
}

#[command]
async fn resolve_java_for_minecraft(
    app: tauri::AppHandle,
    minecraft_version: String,
) -> Result<JavaResolution, String> {
    let manager = JavaManager::new(&app)?;
    Ok(manager.resolve_for_minecraft(&minecraft_version))
}

#[command]
async fn list_instances(app: tauri::AppHandle) -> Result<Vec<InstanceRecord>, String> {
    let path = database_path(&app)?;
    let conn = Connection::open(path)
        .map_err(|error| format!("No se pudo abrir la base de datos: {error}"))?;
    let mut stmt = conn
        .prepare("SELECT id, name, version, loader_name, loader_version FROM instances")
        .map_err(|error| format!("No se pudo leer instancias: {error}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(InstanceRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                version: row.get(2)?,
                loader_name: row.get(3)?,
                loader_version: row.get(4)?,
            })
        })
        .map_err(|error| format!("No se pudo mapear instancias: {error}"))?;
    let mut instances = Vec::new();
    for row in rows {
        instances.push(row.map_err(|error| format!("Instancia inválida: {error}"))?);
    }
    Ok(instances)
}

fn ensure_instance_layout(instance_root: &Path) -> Result<(), String> {
    let minecraft_root = instance_root.join("minecraft");
    fs::create_dir_all(minecraft_root.join("versions"))
        .map_err(|error| format!("No se pudo asegurar minecraft/versions: {error}"))?;
    fs::create_dir_all(minecraft_root.join("libraries"))
        .map_err(|error| format!("No se pudo asegurar minecraft/libraries: {error}"))?;
    fs::create_dir_all(minecraft_root.join("assets").join("objects"))
        .map_err(|error| format!("No se pudo asegurar minecraft/assets/objects: {error}"))?;
    fs::create_dir_all(minecraft_root.join("assets").join("indexes"))
        .map_err(|error| format!("No se pudo asegurar minecraft/assets/indexes: {error}"))?;
    fs::create_dir_all(minecraft_root.join("mods"))
        .map_err(|error| format!("No se pudo asegurar minecraft/mods: {error}"))?;
    fs::create_dir_all(minecraft_root.join("config"))
        .map_err(|error| format!("No se pudo asegurar minecraft/config: {error}"))?;
    fs::create_dir_all(minecraft_root.join("saves"))
        .map_err(|error| format!("No se pudo asegurar minecraft/saves: {error}"))?;
    fs::create_dir_all(instance_root.join("logs"))
        .map_err(|error| format!("No se pudo asegurar logs: {error}"))?;
    Ok(())
}

fn normalized_loader_version(instance: &InstanceRecord) -> String {
    let loader = instance
        .loader_name
        .as_deref()
        .unwrap_or("vanilla")
        .trim()
        .to_lowercase();

    if loader == "vanilla" {
        return "latest".to_string();
    }

    instance
        .loader_version
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "—")
        .unwrap_or("latest")
        .to_string()
}

fn write_instance_metadata(instance_root: &Path, instance: &InstanceRecord) -> Result<(), String> {
    let metadata_path = instance_root.join("instance.json");
    let created_at = fs::read_to_string(&metadata_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|value| value.get("createdAt").and_then(Value::as_u64))
        .unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or_default()
        });

    let meta = serde_json::json!({
        "id": instance.id,
        "name": instance.name,
        "minecraft_version": instance.version,
        "loader": instance
            .loader_name
            .clone()
            .unwrap_or_else(|| "vanilla".to_string())
            .to_lowercase(),
        "loader_version": normalized_loader_version(instance),
        "java": Value::Null,
        "memory": {"min": 2048, "max": 4096},
        "createdAt": created_at
    });

    fs::write(
        &metadata_path,
        serde_json::to_string_pretty(&meta)
            .map_err(|error| format!("No se pudo serializar metadata: {error}"))?,
    )
    .map_err(|error| format!("No se pudo escribir metadata de instancia: {error}"))?;

    Ok(())
}

fn ensure_instance_metadata(instance_root: &Path, instance: &InstanceRecord) -> Result<(), String> {
    let metadata_path = instance_root.join("instance.json");
    if metadata_path.exists() {
        return Ok(());
    }

    write_instance_metadata(instance_root, instance)
}

fn add_directory_to_zip(
    writer: &mut ZipWriter<fs::File>,
    source: &Path,
    base: &Path,
) -> Result<(), String> {
    let entries =
        fs::read_dir(source).map_err(|error| format!("No se pudo recorrer directorio: {error}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        let relative = path
            .strip_prefix(base)
            .map_err(|error| format!("No se pudo relativizar ruta para exportar: {error}"))?;
        let archive_name = relative.to_string_lossy().replace('\\', "/");
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o644);

        if path.is_dir() {
            writer
                .add_directory(format!("{archive_name}/"), options)
                .map_err(|error| format!("No se pudo agregar directorio al zip: {error}"))?;
            add_directory_to_zip(writer, &path, base)?;
            continue;
        }

        writer
            .start_file(archive_name, options)
            .map_err(|error| format!("No se pudo agregar archivo al zip: {error}"))?;
        let content = fs::read(&path)
            .map_err(|error| format!("No se pudo leer archivo para exportar: {error}"))?;
        writer
            .write_all(&content)
            .map_err(|error| format!("No se pudo escribir contenido al zip: {error}"))?;
    }

    Ok(())
}

fn extract_instance_zip(archive_path: &Path, target_root: &Path) -> Result<(), String> {
    let file = fs::File::open(archive_path)
        .map_err(|error| format!("No se pudo abrir el archivo zip: {error}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| format!("ZIP inválido para importar: {error}"))?;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("No se pudo leer entrada ZIP: {error}"))?;
        let Some(safe_name) = entry.enclosed_name().map(|name| name.to_path_buf()) else {
            continue;
        };
        let out_path = target_root.join(safe_name);

        if entry.is_dir() {
            fs::create_dir_all(&out_path)
                .map_err(|error| format!("No se pudo crear directorio importado: {error}"))?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("No se pudo crear carpeta importada: {error}"))?;
        }

        let mut output = fs::File::create(&out_path)
            .map_err(|error| format!("No se pudo crear archivo importado: {error}"))?;
        let mut buffer = Vec::new();
        entry
            .read_to_end(&mut buffer)
            .map_err(|error| format!("No se pudo leer contenido ZIP: {error}"))?;
        output
            .write_all(&buffer)
            .map_err(|error| format!("No se pudo escribir archivo importado: {error}"))?;
    }

    Ok(())
}

fn read_instance_record(
    app: &tauri::AppHandle,
    instance_id: &str,
) -> Result<InstanceRecord, String> {
    let path = database_path(app)?;
    let conn = Connection::open(path)
        .map_err(|error| format!("No se pudo abrir la base de datos: {error}"))?;

    conn.query_row(
        "SELECT id, name, version, loader_name, loader_version FROM instances WHERE id = ?1",
        params![instance_id],
        |row| {
            Ok(InstanceRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                version: row.get(2)?,
                loader_name: row.get(3)?,
                loader_version: row.get(4)?,
            })
        },
    )
    .map_err(|error| format!("No se pudo obtener la instancia: {error}"))
}

#[command]
async fn create_instance(app: tauri::AppHandle, instance: InstanceRecord) -> Result<(), String> {
    let path = database_path(&app)?;
    let conn = Connection::open(path)
        .map_err(|error| format!("No se pudo abrir la base de datos: {error}"))?;
    conn.execute(
        "INSERT OR REPLACE INTO instances (id, name, version, loader_name, loader_version) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![instance.id, instance.name, instance.version, instance.loader_name, instance.loader_version],
    )
    .map_err(|error| format!("No se pudo crear la instancia: {error}"))?;

    let instance_root = launcher_root(&app)?.join("instances").join(&instance.id);
    ensure_instance_layout(&instance_root)?;

    write_instance_metadata(&instance_root, &instance)?;

    Ok(())
}

#[command]
async fn update_instance(app: tauri::AppHandle, instance: InstanceRecord) -> Result<(), String> {
    let path = database_path(&app)?;
    let conn = Connection::open(path)
        .map_err(|error| format!("No se pudo abrir la base de datos: {error}"))?;
    conn.execute(
        "UPDATE instances SET name = ?2, version = ?3, loader_name = ?4, loader_version = ?5 WHERE id = ?1",
        params![
            instance.id,
            instance.name,
            instance.version,
            instance.loader_name,
            Some(normalized_loader_version(&instance))
        ],
    )
    .map_err(|error| format!("No se pudo actualizar la instancia: {error}"))?;

    let instance_root = launcher_root(&app)?.join("instances").join(&instance.id);
    ensure_instance_layout(&instance_root)?;
    write_instance_metadata(&instance_root, &instance)?;

    let _ = fs::remove_file(instance_root.join("launch-plan.json"));
    let _ = fs::remove_file(instance_root.join("launch-command.txt"));

    let loader = instance
        .loader_name
        .as_deref()
        .unwrap_or("vanilla")
        .to_lowercase();

    write_instance_state(
        &instance_root,
        "instance_updated",
        serde_json::json!({
            "instance": instance.id,
            "version": instance.version,
            "loader": loader,
            "loaderVersion": normalized_loader_version(&instance)
        }),
    );

    Ok(())
}

#[command]
async fn export_instance(
    app: tauri::AppHandle,
    args: InstanceArchiveArgs,
) -> Result<String, String> {
    ensure_launcher_layout(&app)?;
    let instance_id = args.instance_id.unwrap_or_default().trim().to_string();
    if instance_id.is_empty() {
        return Err("instance_id es requerido".to_string());
    }

    let archive_path = PathBuf::from(args.archive_path.trim());
    if archive_path.as_os_str().is_empty() {
        return Err("archive_path es requerido".to_string());
    }

    with_instance_lock(&instance_id, || {
        let instance_root = launcher_root(&app)?.join("instances").join(&instance_id);
        if !instance_root.exists() {
            return Err("No existe la instancia seleccionada para exportar".to_string());
        }

        if let Some(parent) = archive_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("No se pudo crear carpeta de exportación: {error}"))?;
        }

        let file = fs::File::create(&archive_path)
            .map_err(|error| format!("No se pudo crear el archivo ZIP de exportación: {error}"))?;
        let mut writer = ZipWriter::new(file);
        add_directory_to_zip(&mut writer, &instance_root, &instance_root)?;
        writer
            .finish()
            .map_err(|error| format!("No se pudo cerrar ZIP de exportación: {error}"))?;

        Ok(archive_path.to_string_lossy().to_string())
    })
}

#[command]
async fn import_instance(
    app: tauri::AppHandle,
    args: InstanceArchiveArgs,
) -> Result<InstanceRecord, String> {
    ensure_launcher_layout(&app)?;
    let archive_path = PathBuf::from(args.archive_path.trim());
    if archive_path.as_os_str().is_empty() {
        return Err("archive_path es requerido".to_string());
    }
    if !archive_path.exists() {
        return Err("No se encontró el archivo a importar".to_string());
    }

    let parsed_instance_id = args
        .instance_id
        .unwrap_or_else(|| {
            archive_path
                .file_stem()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| format!("instance-import-{}", current_unix_secs()))
        })
        .trim()
        .to_string();
    let instance_id = if parsed_instance_id.is_empty() {
        format!("instance-import-{}", current_unix_secs())
    } else {
        parsed_instance_id
    };

    with_instance_lock(&instance_id, || {
        let root = launcher_root(&app)?;
        let instance_root = root.join("instances").join(&instance_id);
        if instance_root.exists() {
            fs::remove_dir_all(&instance_root).map_err(|error| {
                format!("No se pudo limpiar carpeta previa de instancia: {error}")
            })?;
        }
        fs::create_dir_all(&instance_root)
            .map_err(|error| format!("No se pudo crear carpeta de instancia importada: {error}"))?;

        extract_instance_zip(&archive_path, &instance_root)?;

        let metadata_path = instance_root.join("instance.json");
        if !metadata_path.exists() {
            return Err("El archivo importado no contiene instance.json".to_string());
        }
        let metadata_raw = fs::read_to_string(&metadata_path)
            .map_err(|error| format!("No se pudo leer metadata importada: {error}"))?;
        let metadata: Value = serde_json::from_str(&metadata_raw)
            .map_err(|error| format!("instance.json importado es inválido: {error}"))?;

        let imported_name = metadata
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("Instancia importada")
            .to_string();
        let imported_version = metadata
            .get("minecraft_version")
            .or_else(|| metadata.get("version"))
            .and_then(Value::as_str)
            .unwrap_or("latest")
            .to_string();
        let imported_loader = metadata
            .get("loader")
            .and_then(Value::as_str)
            .unwrap_or("vanilla")
            .to_string();
        let imported_loader_version = metadata
            .get("loader_version")
            .and_then(Value::as_str)
            .unwrap_or("latest")
            .to_string();

        let record = InstanceRecord {
            id: instance_id.clone(),
            name: imported_name,
            version: imported_version,
            loader_name: Some(imported_loader),
            loader_version: Some(imported_loader_version),
        };

        let connection = database_connection(&app)?;
        connection
            .execute(
                "INSERT OR REPLACE INTO instances (id, name, version, loader_name, loader_version) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    record.id,
                    record.name,
                    record.version,
                    record.loader_name,
                    record.loader_version
                ],
            )
            .map_err(|error| format!("No se pudo guardar la instancia importada: {error}"))?;
        ensure_instance_layout(&instance_root)?;

        Ok(record)
    })
}

async fn prepare_instance_runtime(
    app: &tauri::AppHandle,
    instance_id: &str,
    reinstall: bool,
    auto_rebuild_plan: bool,
    allow_bootstrap: bool,
) -> Result<(PathBuf, InstanceRecord), String> {
    if instance_id.trim().is_empty() {
        return Err("No hay una instancia válida seleccionada para preparar.".to_string());
    }

    let instance_root = launcher_root(app)?.join("instances").join(instance_id);
    if reinstall && instance_root.exists() {
        fs::remove_dir_all(&instance_root).map_err(|error| {
            format!(
                "No se pudo limpiar la instancia para reinstalar ({}) : {error}",
                instance_root.display()
            )
        })?;
    }

    ensure_instance_layout(&instance_root)?;

    let instance = read_instance_record(app, instance_id)?;
    ensure_instance_metadata(&instance_root, &instance)?;

    let cached_plan = read_launch_plan(&instance_root).ok();
    let cached_is_usable = cached_plan
        .as_ref()
        .map(|plan| {
            launch_plan_matches_instance(plan, &instance)
                && validate_launch_plan(&instance_root, plan).ok
        })
        .unwrap_or(false);

    let launch_plan_exists = instance_root.join("launch-plan.json").exists();
    let should_bootstrap = reinstall
        || (allow_bootstrap && (!launch_plan_exists || (auto_rebuild_plan && !cached_is_usable)));

    if should_bootstrap {
        bootstrap_instance_runtime(app, &instance_root, &instance).await?;
        let _ = build_launch_command(app, &instance_root, &instance)?;
    }

    Ok((instance_root, instance))
}

#[command]
async fn repair_instance(app: tauri::AppHandle, args: InstanceCommandArgs) -> Result<(), String> {
    let instance_id = args.instance_id.unwrap_or_default().trim().to_string();
    if instance_id.is_empty() {
        return Err("No hay una instancia válida seleccionada para reparar.".to_string());
    }

    let mut last_error = None;

    for attempt in 1..=2 {
        let (instance_root, instance) =
            prepare_instance_runtime(&app, &instance_id, true, true, true).await?;
        write_instance_state(
            &instance_root,
            "repairing",
            serde_json::json!({"instance": instance.id, "attempt": attempt}),
        );

        match read_launch_plan(&instance_root) {
            Ok(launch_plan) => {
                let validation = validate_launch_plan(&instance_root, &launch_plan);
                if validation.ok {
                    write_instance_state(
                        &instance_root,
                        "repaired",
                        serde_json::json!({
                            "instance": instance.id,
                            "attempt": attempt,
                            "checks": validation.checks,
                            "warnings": validation.warnings
                        }),
                    );
                    return Ok(());
                }

                last_error = Some(format!(
                    "La reinstalación terminó con validaciones fallidas: {}",
                    validation.errors.join("; ")
                ));
            }
            Err(error) => {
                last_error = Some(error);
            }
        }

        if attempt == 1 {
            write_instance_state(
                &instance_root,
                "repair_fallback_reinstall",
                serde_json::json!({
                    "instance": instance.id,
                    "message": "La reparación no pasó validación; se eliminará y recreará completamente la instancia."
                }),
            );
            let _ = fs::remove_dir_all(&instance_root);
        }
    }

    Err(last_error.unwrap_or_else(|| {
        "La reparación falló después de reintentar la reinstalación completa.".to_string()
    }))
}

#[command]
async fn preflight_instance(
    app: tauri::AppHandle,
    args: InstanceCommandArgs,
) -> Result<ValidationReport, String> {
    let instance_id = args.instance_id.unwrap_or_default().trim().to_string();
    if instance_id.is_empty() {
        return Err("No hay una instancia válida seleccionada para validar.".to_string());
    }

    let (instance_root, _) =
        prepare_instance_runtime(&app, &instance_id, false, false, false).await?;
    write_instance_state(
        &instance_root,
        "preflight",
        serde_json::json!({"instance": instance_id}),
    );

    let launch_plan = match read_launch_plan(&instance_root) {
        Ok(plan) => plan,
        Err(_) => {
            let mut checks = HashMap::new();
            checks.insert("runtime_preparado".to_string(), false);
            return Ok(ValidationReport {
                ok: false,
                errors: vec![
                    "La instancia todavía no está instalada. Iníciala o repárala manualmente para descargar runtime, loader y libraries."
                        .to_string(),
                ],
                warnings: vec![
                    "Se evitó la instalación automática durante verificación para respetar inicio manual de instancias."
                        .to_string(),
                ],
                checks,
            });
        }
    };

    Ok(validate_launch_plan(&instance_root, &launch_plan))
}

#[command]
async fn launch_instance(
    app: tauri::AppHandle,
    args: InstanceCommandArgs,
) -> Result<LaunchInstanceResult, String> {
    let instance_id = args.instance_id.unwrap_or_default().trim().to_string();
    if instance_id.is_empty() {
        return Err("No hay una instancia válida seleccionada para iniciar.".to_string());
    }

    let (instance_root, instance) =
        prepare_instance_runtime(&app, &instance_id, false, true, true).await?;

    let mut launch_plan = read_launch_plan(&instance_root)?;

    let auth_username = args
        .username
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&launch_plan.auth.username)
        .to_string();
    let auth_uuid = args
        .uuid
        .as_deref()
        .and_then(normalize_uuid)
        .unwrap_or_else(|| {
            normalize_uuid(&launch_plan.auth.uuid)
                .unwrap_or_else(|| default_offline_uuid(&auth_username))
        });
    let auth_access_token = args
        .access_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&launch_plan.auth.access_token)
        .to_string();
    let auth_user_type = args
        .user_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&launch_plan.auth.user_type)
        .to_string();

    apply_auth_to_launch_plan(
        &mut launch_plan,
        LaunchAuth {
            username: auth_username,
            uuid: auth_uuid,
            access_token: if auth_access_token.is_empty() {
                "0".to_string()
            } else {
                auth_access_token
            },
            user_type: if auth_user_type.is_empty() {
                "offline".to_string()
            } else {
                auth_user_type
            },
        },
    );

    let current_version =
        extract_or_fallback_arg(&launch_plan.game_args, "--version", &instance.version);
    normalize_critical_game_args(&mut launch_plan, &current_version);

    let validation = validate_launch_plan(&instance_root, &launch_plan);
    if !validation.ok {
        return Err(format!(
            "La validación previa falló: {}",
            validation.errors.join("; ")
        ));
    }

    write_instance_state(
        &instance_root,
        "launching",
        serde_json::json!({"checks": validation.checks, "warnings": validation.warnings}),
    );

    let logs_dir = instance_root.join("logs");
    fs::create_dir_all(&logs_dir)
        .map_err(|error| format!("No se pudo crear carpeta de logs de instancia: {error}"))?;
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default();
    let stdout_path = logs_dir.join(format!("runtime-{ts}.stdout.log"));
    let stderr_path = logs_dir.join(format!("runtime-{ts}.stderr.log"));
    let stdout = fs::File::create(&stdout_path)
        .map_err(|error| format!("No se pudo crear log stdout: {error}"))?;
    let stderr = fs::File::create(&stderr_path)
        .map_err(|error| format!("No se pudo crear log stderr: {error}"))?;

    let mut cmd = Command::new(&launch_plan.java_path);
    cmd.current_dir(Path::new(&launch_plan.game_dir))
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));

    for (key, value) in &launch_plan.env {
        cmd.env(key, value);
    }

    cmd.args(&launch_plan.java_args)
        .arg(&launch_plan.main_class)
        .args(&launch_plan.game_args);

    let mut child = cmd
        .spawn()
        .map_err(|error| format!("No se pudo ejecutar Java para la instancia: {error}"))?;
    let pid = child.id();

    for _ in 0..6 {
        std::thread::sleep(std::time::Duration::from_millis(500));
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("No se pudo comprobar el proceso de Minecraft: {error}"))?
        {
            let code = status.code().unwrap_or(-1);
            let stderr_lines = read_last_lines(&stderr_path, 40);
            let stderr_excerpt = stderr_lines
                .iter()
                .rev()
                .take(8)
                .cloned()
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join("\n");
            write_instance_state(
                &instance_root,
                "crashed",
                serde_json::json!({"exitCode": code, "stderr": stderr_excerpt}),
            );
            return Err(if stderr_excerpt.is_empty() {
                format!(
                    "Minecraft cerró durante el arranque (código {code}). Revisa logs/runtime*.stderr.log"
                )
            } else {
                format!(
                    "Minecraft cerró durante el arranque (código {code}). Últimas líneas:\n{stderr_excerpt}"
                )
            });
        }
    }

    write_instance_state(
        &instance_root,
        "running",
        serde_json::json!({
            "pid": pid,
            "stdout": stdout_path.to_string_lossy(),
            "stderr": stderr_path.to_string_lossy()
        }),
    );

    let monitor_root = instance_root.clone();
    std::thread::spawn(move || match child.wait() {
        Ok(status) => {
            let code = status.code().unwrap_or(-1);
            if status.success() {
                write_instance_state(
                    &monitor_root,
                    "stopped",
                    serde_json::json!({"exitCode": code}),
                );
            } else {
                write_instance_state(
                    &monitor_root,
                    "crashed",
                    serde_json::json!({"exitCode": code}),
                );
                let _ = fs::write(
                    monitor_root.join("crash-report.txt"),
                    format!(
                        "Minecraft terminó con código {code}. Revisa logs en la carpeta logs/."
                    ),
                );
            }
        }
        Err(error) => write_instance_state(
            &monitor_root,
            "error",
            serde_json::json!({"reason": format!("No se pudo monitorear proceso: {error}")}),
        ),
    });

    Ok(LaunchInstanceResult { pid })
}

#[command]
async fn read_instance_runtime_logs(
    app: tauri::AppHandle,
    args: InstanceCommandArgs,
) -> Result<RuntimeLogSnapshot, String> {
    let instance_id = args.instance_id.unwrap_or_default().trim().to_string();
    if instance_id.is_empty() {
        return Err("No hay una instancia válida seleccionada para leer logs.".to_string());
    }

    let instance_root = launcher_root(&app)?.join("instances").join(&instance_id);
    if !instance_root.exists() {
        return Err("La carpeta de la instancia no existe.".to_string());
    }

    let state_raw = fs::read_to_string(instance_root.join("instance-state.json")).ok();
    let state_value = state_raw
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok());
    let status = state_value
        .as_ref()
        .and_then(|value| value.get("status"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let state_updated_at = state_value
        .as_ref()
        .and_then(|value| value.get("updatedAt"))
        .and_then(Value::as_u64);
    let state_details = state_value
        .as_ref()
        .and_then(|value| value.get("details"))
        .cloned();

    let logs_dir = instance_root.join("logs");
    let stdout_path = latest_runtime_log(&logs_dir, ".stdout.log");
    let stderr_path = latest_runtime_log(&logs_dir, ".stderr.log");
    let launch_command = fs::read_to_string(instance_root.join("launch-command.txt"))
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let mut lines = vec![format!("[Launcher] Instancia: {instance_id}")];
    if let Some(command) = &launch_command {
        lines.push(format!("[Launcher] Comando de arranque: {command}"));
    }
    for line in read_last_lines(&instance_root.join("instance-events.log"), 220) {
        lines.push(format!("[EVENT] {line}"));
    }
    if let Some(path) = &stdout_path {
        for line in read_last_lines(path, 180) {
            lines.push(format!("[STDOUT] {line}"));
        }
    }
    if let Some(path) = &stderr_path {
        for line in read_last_lines(path, 180) {
            lines.push(format!("[STDERR] {line}"));
        }
    }

    Ok(RuntimeLogSnapshot {
        status,
        state_details,
        state_updated_at,
        stdout_path: stdout_path.map(|p| p.to_string_lossy().to_string()),
        stderr_path: stderr_path.map(|p| p.to_string_lossy().to_string()),
        command: launch_command,
        lines,
    })
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

#[command]
async fn curseforge_scan_fingerprints(
    mods_dir: String,
    api_key: String,
) -> Result<FingerprintScanResult, String> {
    let mods_path = Path::new(&mods_dir);
    if !mods_path.exists() || !mods_path.is_dir() {
        return Err("La carpeta de mods no existe o no es válida.".to_string());
    }

    let mut local_files = Vec::new();
    for entry in fs::read_dir(mods_path)
        .map_err(|error| format!("No se pudo leer carpeta de mods: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Entrada inválida: {error}"))?;
        let path = entry.path();
        if path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("jar"))
            .unwrap_or(false)
        {
            let bytes = fs::read(&path)
                .map_err(|error| format!("No se pudo leer archivo {}: {error}", path.display()))?;
            let fingerprint = murmurhash2(&bytes);
            local_files.push((path, fingerprint));
        }
    }

    let body = FingerprintsRequestBody {
        fingerprints: local_files.iter().map(|(_, fp)| *fp).collect(),
    };

    let headers = curseforge_headers(&api_key)?;
    let client = reqwest::Client::new();
    let response = client
        .post("https://api.curseforge.com/v1/fingerprints")
        .headers(headers.clone())
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Error de red al consultar fingerprints: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("CurseForge respondió {status}: {text}"));
    }

    let envelope = response
        .json::<CurseforgeFingerprintsEnvelope>()
        .await
        .map_err(|error| format!("Respuesta inválida de CurseForge: {error}"))?;

    let mut files = Vec::new();
    for (path, fingerprint) in local_files {
        if let Some(matched) = envelope
            .data
            .exact_matches
            .iter()
            .find(|item| item.file.file_fingerprint == fingerprint)
        {
            let (mod_name, _) = fetch_mod_name_and_site(&client, &headers, matched.id).await;
            files.push(FingerprintFileResult {
                path: path.display().to_string(),
                file_name: path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default()
                    .to_string(),
                fingerprint,
                matched: true,
                mod_id: Some(matched.id),
                file_id: Some(matched.file.id),
                mod_name,
            });
        } else {
            files.push(FingerprintFileResult {
                path: path.display().to_string(),
                file_name: path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default()
                    .to_string(),
                fingerprint,
                matched: false,
                mod_id: None,
                file_id: None,
                mod_name: None,
            });
        }
    }

    Ok(FingerprintScanResult {
        files,
        unmatched_fingerprints: envelope.data.unmatched_fingerprints,
    })
}

#[command]
async fn curseforge_resolve_download(
    mod_id: u32,
    file_id: u32,
    api_key: String,
) -> Result<CurseforgeDownloadResolution, String> {
    let headers = curseforge_headers(&api_key)?;
    let client = reqwest::Client::new();

    let file_response = client
        .get(format!(
            "https://api.curseforge.com/v1/mods/{mod_id}/files/{file_id}"
        ))
        .headers(headers.clone())
        .send()
        .await
        .map_err(|error| format!("No se pudo consultar el archivo en CurseForge: {error}"))?;

    if !file_response.status().is_success() {
        let status = file_response.status();
        let text = file_response.text().await.unwrap_or_default();
        return Err(format!("CurseForge respondió {status}: {text}"));
    }

    let file_envelope = file_response
        .json::<CurseforgeFileEnvelope>()
        .await
        .map_err(|error| format!("Respuesta inválida al consultar archivo: {error}"))?;

    let (mod_name, website_url) = fetch_mod_name_and_site(&client, &headers, mod_id).await;
    let can_auto_download = file_envelope
        .data
        .is_available
        .unwrap_or(file_envelope.data.download_url.is_some())
        && file_envelope.data.download_url.is_some();

    let reason = if can_auto_download {
        format!(
            "Descarga permitida por API para {}",
            mod_name.unwrap_or_else(|| format!("mod {mod_id}"))
        )
    } else {
        "El archivo no permite descarga automática por API; usar descarga manual en navegador"
            .to_string()
    };

    Ok(CurseforgeDownloadResolution {
        mod_id,
        file_id,
        can_auto_download,
        download_url: file_envelope.data.download_url,
        website_url,
        reason,
    })
}

#[command]
async fn install_mod_file(
    app: tauri::AppHandle,
    instance_id: String,
    url: String,
    file_name: String,
) -> Result<String, String> {
    let id = instance_id.trim();
    if id.is_empty() {
        return Err("instance_id es requerido".to_string());
    }

    let safe_name = file_name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("mod.jar")
        .trim();
    if safe_name.is_empty() {
        return Err("Nombre de archivo inválido".to_string());
    }

    let instance_root = launcher_root(&app)?.join("instances").join(id);
    let mods_dir = instance_root.join("minecraft").join("mods");
    fs::create_dir_all(&mods_dir)
        .map_err(|error| format!("No se pudo crear carpeta mods: {error}"))?;

    let target = mods_dir.join(safe_name);
    download_to(url.trim(), &target).await?;

    Ok(target.to_string_lossy().to_string())
}

#[command]
async fn curseforge_v1_get(
    path: String,
    query: Option<std::collections::HashMap<String, String>>,
    api_key: String,
) -> Result<Value, String> {
    let normalized = path.trim();
    if normalized.is_empty() || !normalized.starts_with('/') {
        return Err(
            "Ruta inválida para CurseForge API. Usa formato /v1/... interno como /mods/search"
                .to_string(),
        );
    }

    let headers = curseforge_headers(&api_key)?;
    let client = reqwest::Client::new();
    let url = format!("https://api.curseforge.com/v1{normalized}");
    let request = client.get(url).headers(headers);
    let request = if let Some(query_params) = query {
        request.query(&query_params)
    } else {
        request
    };

    let response = request
        .send()
        .await
        .map_err(|error| format!("No se pudo consultar CurseForge: {error}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("No se pudo leer respuesta de CurseForge: {error}"))?;

    if !status.is_success() {
        return Err(format!("CurseForge respondió {status}: {body}"));
    }

    serde_json::from_str::<Value>(&body)
        .map_err(|error| format!("Respuesta JSON inválida de CurseForge: {error}"))
}

fn open_path_in_file_manager(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("explorer");
        cmd.arg(path);
        cmd
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("open");
        cmd.arg(path);
        cmd
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(path);
        cmd
    };

    command
        .spawn()
        .map_err(|error| format!("No se pudo abrir el explorador de archivos: {error}"))?;

    Ok(())
}

#[command]
async fn open_instance_path(app: tauri::AppHandle, args: InstancePathArgs) -> Result<(), String> {
    let instance_id = args.instance_id.unwrap_or_default().trim().to_string();
    if instance_id.is_empty() {
        return Err("instance_id es requerido".to_string());
    }

    let mut target = launcher_root(&app)?.join("instances").join(&instance_id);
    if let Some(raw_sub_path) = args.sub_path {
        let trimmed = raw_sub_path.trim();
        if !trimmed.is_empty() {
            let sub_path = Path::new(trimmed);
            if sub_path.is_absolute()
                || sub_path
                    .components()
                    .any(|component| matches!(component, std::path::Component::ParentDir))
            {
                return Err("sub_path inválido".to_string());
            }
            target = target.join(sub_path);
        }
    }

    fs::create_dir_all(&target)
        .map_err(|error| format!("No se pudo preparar la carpeta solicitada: {error}"))?;
    open_path_in_file_manager(&target)
}

#[command]
async fn create_instance_shortcut(
    app: tauri::AppHandle,
    instance_id: String,
) -> Result<String, String> {
    let id = instance_id.trim();
    if id.is_empty() {
        return Err("instance_id es requerido".to_string());
    }

    let desktop = app
        .path()
        .desktop_dir()
        .map_err(|error| format!("No se pudo resolver el escritorio del usuario: {error}"))?;

    fs::create_dir_all(&desktop)
        .map_err(|error| format!("No se pudo preparar el escritorio: {error}"))?;

    let exe = std::env::current_exe()
        .map_err(|error| format!("No se pudo obtener la ruta del launcher: {error}"))?;

    #[cfg(target_os = "windows")]
    let (shortcut_path, content) = {
        let path = desktop.join(format!("FrutiLauncher - {id}.bat"));
        let data = format!(
            "@echo off\r\nstart \"\" \"{}\" --instanceId={}\r\n",
            exe.display(),
            id
        );
        (path, data)
    };

    #[cfg(target_os = "macos")]
    let (shortcut_path, content) = {
        let path = desktop.join(format!("FrutiLauncher - {id}.command"));
        let data = format!("#!/bin/bash\n\"{}\" --instanceId={}\n", exe.display(), id);
        (path, data)
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let (shortcut_path, content) = {
        let path = desktop.join(format!("FrutiLauncher - {id}.desktop"));
        let data = format!(
            "[Desktop Entry]\nType=Application\nName=FrutiLauncher ({id})\nExec=\"{}\" --instanceId={}\nTerminal=false\n",
            exe.display(),
            id
        );
        (path, data)
    };

    fs::write(&shortcut_path, content)
        .map_err(|error| format!("No se pudo crear el atajo: {error}"))?;

    #[cfg(unix)]
    {
        let mut perms = fs::metadata(&shortcut_path)
            .map_err(|error| format!("No se pudo leer permisos del atajo: {error}"))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&shortcut_path, perms)
            .map_err(|error| format!("No se pudo marcar el atajo como ejecutable: {error}"))?;
    }

    Ok(shortcut_path.display().to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            select_folder,
            load_config,
            save_config,
            collect_startup_files,
            open_instance_path,
            create_instance_shortcut,
            save_base_dir,
            default_base_dir,
            validate_base_dir,
            append_log,
            list_instances,
            list_java_runtimes,
            resolve_java_for_minecraft,
            create_instance,
            update_instance,
            export_instance,
            import_instance,
            delete_instance,
            repair_instance,
            preflight_instance,
            launch_instance,
            read_instance_runtime_logs,
            manage_modpack,
            curseforge_scan_fingerprints,
            curseforge_resolve_download,
            install_mod_file,
            curseforge_v1_get
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
    fn murmurhash2_is_stable() {
        assert_eq!(murmurhash2(b"abc"), murmurhash2(b"abc"));
        assert_ne!(murmurhash2(b"abc"), murmurhash2(b"abd"));
        assert_ne!(murmurhash2(b""), murmurhash2(b"a"));
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

    #[test]
    fn normalize_java_launch_args_keeps_single_classpath() {
        let args = vec![
            "-Xmx4G".to_string(),
            "-cp".to_string(),
            "legacy".to_string(),
            "-Ddemo=true".to_string(),
            "-classpath=fromjson".to_string(),
        ];

        let normalized =
            normalize_java_launch_args(args, "final-cp".to_string(), Path::new("/tmp/natives"));
        assert_eq!(
            normalized,
            vec![
                "-Xmx4G".to_string(),
                "-Ddemo=true".to_string(),
                "-cp".to_string(),
                "final-cp".to_string(),
            ]
        );
    }

    #[test]
    fn upsert_game_arg_updates_existing_value() {
        let mut args = vec!["--username".to_string(), "Steve".to_string()];
        upsert_game_arg(&mut args, "--username", "Alex".to_string());
        upsert_game_arg(&mut args, "--version", "1.21.11".to_string());

        assert_eq!(
            args,
            vec![
                "--username".to_string(),
                "Alex".to_string(),
                "--version".to_string(),
                "1.21.11".to_string(),
            ]
        );
    }

    #[test]
    fn sanitize_game_args_removes_demo_and_unresolved_placeholders() {
        let mut args = vec![
            "--demo".to_string(),
            "--username".to_string(),
            "${auth_player_name}".to_string(),
            "--width".to_string(),
            "${resolution_width}".to_string(),
            "--height".to_string(),
            "720".to_string(),
        ];

        sanitize_game_args(&mut args);

        assert_eq!(args, vec!["--height".to_string(), "720".to_string()]);
    }

    #[test]
    fn normalize_resolution_args_applies_defaults_for_invalid_values() {
        let mut args = vec![
            "--width".to_string(),
            "no-num".to_string(),
            "--height".to_string(),
            "0".to_string(),
        ];

        normalize_resolution_args(&mut args);

        assert_eq!(
            extract_or_fallback_arg(&args, "--width", "0"),
            "1280".to_string()
        );
        assert_eq!(
            extract_or_fallback_arg(&args, "--height", "0"),
            "720".to_string()
        );
    }

    #[test]
    fn merge_version_json_combines_libraries_and_arguments() {
        let parent = serde_json::json!({
            "mainClass": "net.minecraft.client.main.Main",
            "libraries": [{"name": "a"}],
            "arguments": {
                "game": ["--demo"],
                "jvm": ["-Xmx2G"]
            }
        });
        let child = serde_json::json!({
            "mainClass": "cpw.mods.bootstraplauncher.BootstrapLauncher",
            "libraries": [{"name": "b"}],
            "arguments": {
                "game": ["--fml.mcVersion", "1.20.1"],
                "jvm": ["-Dforge=true"]
            }
        });

        let merged = merge_version_json(&parent, &child);

        assert_eq!(
            merged.get("mainClass").and_then(|value| value.as_str()),
            Some("cpw.mods.bootstraplauncher.BootstrapLauncher")
        );
        assert_eq!(
            merged
                .get("libraries")
                .and_then(|value| value.as_array())
                .map(|value| value.len()),
            Some(2)
        );
        assert_eq!(
            merged
                .get("arguments")
                .and_then(|value| value.get("game"))
                .and_then(|value| value.as_array())
                .map(|value| value.len()),
            Some(3)
        );
        assert_eq!(
            merged
                .get("arguments")
                .and_then(|value| value.get("jvm"))
                .and_then(|value| value.as_array())
                .map(|value| value.len()),
            Some(2)
        );
    }
}
