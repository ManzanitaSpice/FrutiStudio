#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::header::{HeaderMap, HeaderValue};

use fs2::available_space;
use once_cell::sync::Lazy;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
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
    auto_updates: Option<bool>,
    background_downloads: Option<bool>,
    active_section: Option<String>,
    focus_mode: Option<bool>,
    explorer_filters: Option<Value>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstanceCommandArgs {
    #[serde(alias = "instance_id", alias = "id", alias = "uuid")]
    instance_id: Option<String>,
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
        .data_dir()
        .map_err(|error| format!("No se pudo obtener la carpeta del launcher: {error}"))?;
    Ok(base.join("FrutiLauncher"))
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

        let mut by_major: HashMap<u32, JavaRuntime> = HashMap::new();
        for runtime in runtimes {
            by_major
                .entry(runtime.major)
                .and_modify(|current| {
                    if current.source != "embebido" && runtime.source == "embebido" {
                        *current = runtime.clone();
                    }
                })
                .or_insert(runtime);
        }

        let mut deduped: Vec<JavaRuntime> = by_major.into_values().collect();
        deduped.sort_by_key(|r| r.major);
        deduped
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

fn build_launch_command(
    app: &tauri::AppHandle,
    instance_root: &Path,
    instance: &InstanceRecord,
) -> Result<String, String> {
    let loader = instance
        .loader_name
        .as_deref()
        .unwrap_or("vanilla")
        .trim()
        .to_lowercase();
    let version = instance.version.trim();

    if version.is_empty() {
        return Err("La instancia no tiene versión de Minecraft definida.".to_string());
    }

    if loader == "vanilla" || loader.is_empty() {
        let runtime_jar = instance_root
            .join(".fruti-runtime")
            .join(format!("minecraft-{version}.jar"));

        if !runtime_jar.exists() {
            return Err(
                "No se encontró el client.jar local. Repara la instancia para volver a descargar runtime."
                    .to_string(),
            );
        }

        let manager = JavaManager::new(app)?;
        let resolution = manager.resolve_for_minecraft(version);
        let Some(runtime) = resolution.selected else {
            return Err(format!(
                "No se encontró Java compatible para Minecraft {version}. Requerido Java {}.",
                resolution.required_major
            ));
        };
        let java_path = PathBuf::from(runtime.path);

        return Ok(format!(
            "{} -jar {} --gameDir {}",
            shell_escape(&java_path.to_string_lossy()),
            shell_escape(&runtime_jar.to_string_lossy()),
            shell_escape(&instance_root.to_string_lossy())
        ));
    }

    if !command_available("portablemc") {
        return Err(
            "Para instancias con modloader (Forge/Fabric/Quilt/NeoForge) instala portablemc o define start-instance.sh manual."
                .to_string(),
        );
    }

    let mut target = format!("{loader}:{version}");
    let loader_version = instance
        .loader_version
        .as_deref()
        .unwrap_or("latest")
        .trim()
        .to_string();

    if !loader_version.is_empty() && loader_version != "latest" {
        target = format!("{target}:{loader_version}");
    }

    Ok(format!(
        "portablemc start {} --work-dir {}",
        shell_escape(&target),
        shell_escape(&instance_root.to_string_lossy())
    ))
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

async fn bootstrap_instance_runtime(instance_root: &Path, version: &str) -> Result<(), String> {
    let runtime_dir = instance_root.join(".fruti-runtime");
    fs::create_dir_all(&runtime_dir)
        .map_err(|error| format!("No se pudo crear runtime de instancia: {error}"))?;

    let manifest_url = "https://launchermeta.mojang.com/mc/game/version_manifest.json";
    let manifest = reqwest::get(manifest_url)
        .await
        .map_err(|error| format!("No se pudo descargar el manifiesto de versiones: {error}"))?
        .json::<MojangVersionManifest>()
        .await
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

    let detail = reqwest::get(&version_entry.url)
        .await
        .map_err(|error| format!("No se pudo descargar metadata de la versión: {error}"))?
        .json::<MojangVersionDetail>()
        .await
        .map_err(|error| format!("No se pudo parsear metadata de la versión: {error}"))?;

    let version_json_path = runtime_dir.join(format!("{version}.json"));
    let version_json = reqwest::get(&version_entry.url)
        .await
        .map_err(|error| format!("No se pudo volver a descargar metadata: {error}"))?
        .text()
        .await
        .map_err(|error| format!("No se pudo leer metadata: {error}"))?;

    fs::write(&version_json_path, version_json)
        .map_err(|error| format!("No se pudo guardar metadata local de versión: {error}"))?;

    let client_jar_path = runtime_dir.join(format!("minecraft-{version}.jar"));
    let client_bytes = reqwest::get(&detail.downloads.client.url)
        .await
        .map_err(|error| format!("No se pudo descargar client.jar: {error}"))?
        .bytes()
        .await
        .map_err(|error| format!("No se pudo leer client.jar: {error}"))?;

    fs::write(&client_jar_path, client_bytes)
        .map_err(|error| format!("No se pudo guardar client.jar: {error}"))?;

    let launch_hint = format!(
        "# FrutiStudio bootstrap
# Esta instancia descargó runtime base.
# Si usas PrismLauncher, crea/importa esta instancia o define launch-command.txt
",
    );
    fs::write(instance_root.join("launch-readme.txt"), launch_hint)
        .map_err(|error| format!("No se pudo escribir launch-readme.txt: {error}"))?;

    Ok(())
}

fn ensure_instance_layout(instance_root: &Path) -> Result<(), String> {
    fs::create_dir_all(instance_root.join("mods"))
        .map_err(|error| format!("No se pudo asegurar la carpeta mods: {error}"))?;
    fs::create_dir_all(instance_root.join("config"))
        .map_err(|error| format!("No se pudo asegurar la carpeta config: {error}"))?;
    fs::create_dir_all(instance_root.join("logs"))
        .map_err(|error| format!("No se pudo asegurar la carpeta logs: {error}"))?;
    fs::create_dir_all(instance_root.join("resourcepacks"))
        .map_err(|error| format!("No se pudo asegurar la carpeta resourcepacks: {error}"))?;
    fs::create_dir_all(instance_root.join("shaderpacks"))
        .map_err(|error| format!("No se pudo asegurar la carpeta shaderpacks: {error}"))?;
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

    bootstrap_instance_runtime(&instance_root, &instance.version).await?;

    let meta = serde_json::json!({
        "id": instance.id,
        "name": instance.name,
        "version": instance.version,
        "loaderName": instance.loader_name.unwrap_or_else(|| "Vanilla".to_string()),
        "loaderVersion": instance.loader_version.unwrap_or_else(|| "latest".to_string()),
        "createdAt": SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or_default()
    });
    fs::write(
        instance_root.join("instance.json"),
        serde_json::to_string_pretty(&meta)
            .map_err(|error| format!("No se pudo serializar metadata: {error}"))?,
    )
    .map_err(|error| format!("No se pudo escribir metadata de instancia: {error}"))?;

    Ok(())
}

#[command]
async fn repair_instance(app: tauri::AppHandle, args: InstanceCommandArgs) -> Result<(), String> {
    let instance_id = args.instance_id.unwrap_or_default().trim().to_string();
    if instance_id.is_empty() {
        return Err("No hay una instancia válida seleccionada para reparar.".to_string());
    }

    let instance_root = launcher_root(&app)?.join("instances").join(&instance_id);

    ensure_instance_layout(&instance_root)?;

    let instance = read_instance_record(&app, &instance_id)?;
    bootstrap_instance_runtime(&instance_root, &instance.version).await?;

    let launch_command = instance_root.join("launch-command.txt");
    let launch_line = build_launch_command(&app, &instance_root, &instance)?;
    fs::write(&launch_command, format!("{launch_line}\n"))
        .map_err(|error| format!("No se pudo escribir launch-command.txt: {error}"))?;

    Ok(())
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

    let instance_root = launcher_root(&app)?.join("instances").join(&instance_id);
    if !instance_root.exists() {
        return Err(
            "La carpeta de la instancia no existe. Crea la instancia nuevamente.".to_string(),
        );
    }

    let launch_script = instance_root.join("start-instance.sh");
    let launch_command = instance_root.join("launch-command.txt");

    if !launch_script.exists() && !launch_command.exists() {
        repair_instance(
            app.clone(),
            InstanceCommandArgs {
                instance_id: Some(instance_id.clone()),
            },
        )
        .await?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = fs::metadata(&launch_script) {
            let mut perms = metadata.permissions();
            perms.set_mode(0o755);
            let _ = fs::set_permissions(&launch_script, perms);
        }
    }

    let child = if launch_script.exists() {
        Command::new("bash")
            .arg(&launch_script)
            .current_dir(&instance_root)
            .spawn()
            .map_err(|error| format!("No se pudo ejecutar start-instance.sh: {error}"))?
    } else if launch_command.exists() {
        let command_line = fs::read_to_string(&launch_command)
            .map_err(|error| format!("No se pudo leer launch-command.txt: {error}"))?;
        if command_line.trim().is_empty() {
            return Err(
                "launch-command.txt está vacío. Define un comando de inicio válido.".to_string(),
            );
        }
        Command::new("sh")
            .arg("-c")
            .arg(command_line)
            .current_dir(&instance_root)
            .spawn()
            .map_err(|error| format!("No se pudo ejecutar launch-command.txt: {error}"))?
    } else if command_available("prismlauncher") {
        Command::new("prismlauncher")
            .arg("--launch")
            .arg(&instance_id)
            .spawn()
            .map_err(|error| format!("No se pudo iniciar PrismLauncher: {error}"))?
    } else if command_available("minecraft-launcher") {
        Command::new("minecraft-launcher")
            .spawn()
            .map_err(|error| format!("No se pudo iniciar Minecraft Launcher: {error}"))?
    } else {
        return Err(
            "No se encontró un método de inicio. Crea start-instance.sh o launch-command.txt dentro de la instancia, o instala PrismLauncher/minecraft-launcher."
                .to_string(),
        );
    };

    Ok(LaunchInstanceResult { pid: child.id() })
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
            list_java_runtimes,
            resolve_java_for_minecraft,
            create_instance,
            repair_instance,
            launch_instance,
            manage_modpack,
            curseforge_scan_fingerprints,
            curseforge_resolve_download,
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
}
