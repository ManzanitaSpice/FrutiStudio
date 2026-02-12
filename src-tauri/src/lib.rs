#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
pub mod core;

use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::fs;
use std::io::{Read, Write};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures::stream::{self, StreamExt, TryStreamExt};
use reqwest::header::{HeaderMap, HeaderValue};

use fs2::available_space;
use once_cell::sync::Lazy;
use regex::Regex;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha1::{Digest, Sha1};
use tauri::command;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, FilePath};
use tokio::io::{AsyncWriteExt, BufWriter};
use tokio::sync::{oneshot, Semaphore};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::core::config::{
    AppConfig, BaseDirValidationResult, LauncherFactoryResetArgs, LauncherFactoryResetResult,
    NetworkTuning, StartupFileEntry,
};
use crate::core::download_routes;
use crate::core::external_discovery::{
    detect_external_instances, launcher_from_hint, read_external_discovery_cache,
    write_external_discovery_cache,
};
use crate::core::instance::{
    ExternalDetectedInstance, ExternalImportArgs, InstalledModEntry, InstanceArchiveArgs,
    InstanceCommandArgs, InstancePathArgs, InstanceRecord, LauncherInstallation,
    ManualExternalRoot, RegisterExternalRootArgs, RemoveExternalRootArgs,
};
use crate::core::instance_config::{instance_game_dir, resolve_instance_launch_config};
use crate::core::java::{JavaManager, JavaResolution, JavaRuntime};
use crate::core::java_resolver::{required_java_major, required_java_major_for_version};
use crate::core::launch_pipeline::{LauncherDataLayout, CANONICAL_LAUNCHER_DIRS};
use crate::core::launcher::{
    LaunchAuth, LaunchInstanceResult, LaunchPlan, LoaderCrashDiagnostic, MinecraftJarValidation,
    ModInspection, ModLoaderKind, RuntimeLogSnapshot, RuntimeRepairResult,
    StartupFailureClassification, ValidationReport,
};
use crate::core::launcher_discovery::{
    detect_loader_from_version_json, detect_minecraft_launcher_installations,
    expected_main_class_for_loader,
};
use crate::core::loader_normalizer::normalize_loader_profile as normalize_loader_profile_core;
use crate::core::mods::ModDownloadIntegrity;
use crate::core::network::{
    CurseforgeDownloadResolution, CurseforgeFileEnvelope, CurseforgeFingerprintsEnvelope,
    CurseforgeModEnvelope, DownloadTrace, FingerprintFileResult, FingerprintScanResult,
    FingerprintsRequestBody, ModpackAction, MojangVersionManifest, SelectFolderResult,
};
use crate::core::repair::{RepairMode, RepairReport};
use crate::core::runtime_manager::RuntimeManager;

fn copy_if_missing(from: &Path, to: &Path) -> Result<bool, String> {
    if !from.exists() || to.exists() {
        return Ok(false);
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("No se pudo crear carpeta de destino: {error}"))?;
    }
    fs::copy(from, to).map_err(|error| {
        format!(
            "No se pudo copiar {} a {}: {error}",
            from.display(),
            to.display()
        )
    })?;
    Ok(true)
}

fn hydrate_from_detected_launcher(
    minecraft_root: &Path,
    minecraft_version: &str,
) -> Result<(), String> {
    for installation in detect_minecraft_launcher_installations() {
        if !installation.usable {
            continue;
        }
        let source_root = PathBuf::from(&installation.root);
        if source_root == minecraft_root {
            continue;
        }

        let source_version_dir = source_root.join("versions").join(minecraft_version);
        if !source_version_dir.is_dir() {
            continue;
        }

        let target_version_dir = minecraft_root.join("versions").join(minecraft_version);
        let source_json = source_version_dir.join(format!("{minecraft_version}.json"));
        let source_jar = source_version_dir.join(format!("{minecraft_version}.jar"));
        let target_json = target_version_dir.join(format!("{minecraft_version}.json"));
        let target_jar = target_version_dir.join(format!("{minecraft_version}.jar"));

        let _ = copy_if_missing(&source_json, &target_json)?;
        let _ = copy_if_missing(&source_jar, &target_jar)?;

        let _ = copy_if_missing(
            &source_root.join("launcher_profiles.json"),
            &minecraft_root.join("launcher_profiles.json"),
        )?;

        break;
    }

    Ok(())
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

fn resolve_env_file_value(key: &str) -> Option<String> {
    let candidates = [PathBuf::from(".env"), PathBuf::from("../.env")];
    for path in candidates {
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        for line in raw.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            let Some((name, value)) = trimmed.split_once('=') else {
                continue;
            };
            if name.trim() != key {
                continue;
            }
            let cleaned = value.trim().trim_matches('"').trim_matches('\'').trim();
            if !cleaned.is_empty() {
                return Some(cleaned.to_string());
            }
        }
    }
    None
}

fn resolve_curseforge_api_key(api_key_override: Option<&str>) -> Result<String, String> {
    if let Some(override_value) = api_key_override {
        let trimmed = override_value.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    let env_keys = ["CURSEFORGE_API_KEY", "TAURI_CURSEFORGE_API_KEY"];
    for key in env_keys {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Ok(trimmed.to_string());
            }
        }

        if let Some(value) = resolve_env_file_value(key) {
            return Ok(value);
        }
    }

    Err("No se encontró CURSEFORGE_API_KEY en el backend. Configúrala en variables de entorno del proceso Tauri.".to_string())
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

    if config
        .java_mode
        .as_deref()
        .map(str::trim)
        .is_none_or(|value| value.is_empty())
    {
        config.java_mode = Some("embedded".to_string());
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
    init_database(app)?;
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
            path TEXT,
            loader TEXT,
            created_at INTEGER,
            loader_name TEXT,
            loader_version TEXT,
            source_launcher TEXT,
            source_path TEXT,
            source_instance_name TEXT
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

    conn.execute("ALTER TABLE instances ADD COLUMN source_launcher TEXT", [])
        .or_else(|error| {
            if error.to_string().contains("duplicate column name") {
                Ok(0)
            } else {
                Err(error)
            }
        })
        .map_err(|error| format!("No se pudo migrar columna source_launcher: {error}"))?;

    conn.execute("ALTER TABLE instances ADD COLUMN source_path TEXT", [])
        .or_else(|error| {
            if error.to_string().contains("duplicate column name") {
                Ok(0)
            } else {
                Err(error)
            }
        })
        .map_err(|error| format!("No se pudo migrar columna source_path: {error}"))?;

    conn.execute(
        "ALTER TABLE instances ADD COLUMN source_instance_name TEXT",
        [],
    )
    .or_else(|error| {
        if error.to_string().contains("duplicate column name") {
            Ok(0)
        } else {
            Err(error)
        }
    })
    .map_err(|error| format!("No se pudo migrar columna source_instance_name: {error}"))?;

    conn.execute("ALTER TABLE instances ADD COLUMN java_mode TEXT", [])
        .or_else(|error| {
            if error.to_string().contains("duplicate column name") {
                Ok(0)
            } else {
                Err(error)
            }
        })
        .map_err(|error| format!("No se pudo migrar columna java_mode: {error}"))?;

    conn.execute("ALTER TABLE instances ADD COLUMN java_path TEXT", [])
        .or_else(|error| {
            if error.to_string().contains("duplicate column name") {
                Ok(0)
            } else {
                Err(error)
            }
        })
        .map_err(|error| format!("No se pudo migrar columna java_path: {error}"))?;

    conn.execute("ALTER TABLE instances ADD COLUMN path TEXT", [])
        .or_else(|error| {
            if error.to_string().contains("duplicate column name") {
                Ok(0)
            } else {
                Err(error)
            }
        })
        .map_err(|error| format!("No se pudo migrar columna path: {error}"))?;

    conn.execute("ALTER TABLE instances ADD COLUMN loader TEXT", [])
        .or_else(|error| {
            if error.to_string().contains("duplicate column name") {
                Ok(0)
            } else {
                Err(error)
            }
        })
        .map_err(|error| format!("No se pudo migrar columna loader: {error}"))?;

    conn.execute("ALTER TABLE instances ADD COLUMN created_at INTEGER", [])
        .or_else(|error| {
            if error.to_string().contains("duplicate column name") {
                Ok(0)
            } else {
                Err(error)
            }
        })
        .map_err(|error| format!("No se pudo migrar columna created_at: {error}"))?;

    Ok(())
}

const REQUIRED_LAUNCHER_DIRS: [&str; CANONICAL_LAUNCHER_DIRS.len()] = CANONICAL_LAUNCHER_DIRS;
const ASSET_MIRROR_BASES: [&str; 3] = [
    "https://bmclapi2.bangbang93.com/assets",
    "https://resources.download.minecraft.net",
    "https://download.mcbbs.net/assets",
];
const ASSET_VALIDATION_RECHECK_SECS: u64 = 3 * 24 * 60 * 60;

fn env_u64(key: &str, default_value: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(default_value)
}

fn resolve_network_tuning(config: Option<&AppConfig>) -> NetworkTuning {
    config
        .and_then(|cfg| cfg.network_tuning.clone())
        .unwrap_or_default()
}

fn http_client_with_tuning(tuning: &NetworkTuning) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(tuning.connect_timeout_secs.max(1)))
        .timeout(Duration::from_secs(tuning.request_timeout_secs.max(1)))
        .pool_max_idle_per_host(32)
        .tcp_keepalive(Duration::from_secs(30))
        .user_agent("FrutiLauncher/1.0")
        .build()
        .map_err(|error| format!("No se pudo preparar cliente HTTP: {error}"))
}

static HTTP_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(env_u64(
            "FRUTI_CONNECT_TIMEOUT_SECS",
            12,
        )))
        .timeout(std::time::Duration::from_secs(env_u64(
            "FRUTI_REQUEST_TIMEOUT_SECS",
            120,
        )))
        .pool_max_idle_per_host(32)
        .tcp_keepalive(std::time::Duration::from_secs(30))
        .user_agent("FrutiLauncher/1.0")
        .build()
        .expect("No se pudo preparar cliente HTTP global")
});

#[derive(Clone)]
struct AssetDownloadTask {
    urls: Vec<String>,
    path: PathBuf,
    sha1: String,
    object_name: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetValidationCache {
    assets: HashMap<String, AssetValidationEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetValidationEntry {
    size: u64,
    last_checked: u64,
}

fn launcher_assets_cache_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(launcher_root(app)?
        .join(".fruti_cache")
        .join("assets")
        .join("objects"))
}

fn launcher_assets_validation_cache_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(launcher_root(app)?
        .join(".fruti_cache")
        .join("assets")
        .join("assets_cache.json"))
}

fn launcher_persistent_cache_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(launcher_root(app)?.join(".fruti_cache"))
}

fn launcher_global_download_cache_dir() -> PathBuf {
    std::env::temp_dir()
        .join("fruti-launcher")
        .join("downloads")
        .join("sha1")
}

fn launcher_asset_indexes_cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(launcher_persistent_cache_root(app)?
        .join("assets")
        .join("indexes"))
}

fn load_cached_asset_index_if_valid(
    app: &tauri::AppHandle,
    asset_index_id: &str,
    expected_sha1: Option<&str>,
) -> Result<Option<Value>, String> {
    let cache_dir = launcher_asset_indexes_cache_dir(app)?;
    let cached_path = cache_dir.join(format!("{asset_index_id}.json"));
    if !cached_path.exists() {
        return Ok(None);
    }

    if let Some(expected) = expected_sha1 {
        let current = file_sha1(&cached_path)?;
        if !current.eq_ignore_ascii_case(expected) {
            return Ok(None);
        }
    }

    let raw = fs::read_to_string(&cached_path).map_err(|error| {
        format!(
            "No se pudo leer asset index cacheado {}: {error}",
            cached_path.display()
        )
    })?;
    let parsed = serde_json::from_str::<Value>(&raw).map_err(|error| {
        format!(
            "Asset index cacheado inválido {}: {error}",
            cached_path.display()
        )
    })?;
    Ok(Some(parsed))
}

fn load_asset_validation_cache(app: &tauri::AppHandle) -> AssetValidationCache {
    let Ok(path) = launcher_assets_validation_cache_path(app) else {
        return AssetValidationCache::default();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return AssetValidationCache::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn save_asset_validation_cache(
    app: &tauri::AppHandle,
    cache: &AssetValidationCache,
) -> Result<(), String> {
    let path = launcher_assets_validation_cache_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "No se pudo crear carpeta para assets_cache.json {}: {error}",
                parent.display()
            )
        })?;
    }
    fs::write(
        &path,
        serde_json::to_string_pretty(cache)
            .map_err(|error| format!("No se pudo serializar assets_cache.json: {error}"))?,
    )
    .map_err(|error| format!("No se pudo escribir {}: {error}", path.display()))
}

fn unix_now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn existing_asset_is_valid(
    path: &Path,
    expected_size: u64,
    expected_sha1: &str,
    now_secs: u64,
    cache: &mut AssetValidationCache,
) -> Result<bool, String> {
    let Ok(metadata) = fs::metadata(path) else {
        return Ok(false);
    };
    if !metadata.is_file() || metadata.len() != expected_size {
        cache.assets.remove(expected_sha1);
        return Ok(false);
    }

    if let Some(entry) = cache.assets.get(expected_sha1) {
        if entry.size == expected_size
            && now_secs.saturating_sub(entry.last_checked) <= ASSET_VALIDATION_RECHECK_SECS
        {
            return Ok(true);
        }
    }

    let hash = file_sha1(path)?;
    if hash.eq_ignore_ascii_case(expected_sha1) {
        cache.assets.insert(
            expected_sha1.to_string(),
            AssetValidationEntry {
                size: expected_size,
                last_checked: now_secs,
            },
        );
        return Ok(true);
    }

    cache.assets.remove(expected_sha1);
    Ok(false)
}

fn sync_asset_from_cache(
    cache_root: &Path,
    hash: &str,
    target: &Path,
    expected_sha1: &str,
) -> Result<bool, String> {
    if hash.len() < 2 {
        return Ok(false);
    }
    let sub = &hash[0..2];
    let cache_file = cache_root.join(sub).join(hash);
    if !cache_file.exists() {
        return Ok(false);
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("No se pudo crear carpeta destino de asset: {error}"))?;
    }

    let cache_hash = file_sha1(&cache_file)?;
    if !cache_hash.eq_ignore_ascii_case(expected_sha1) {
        let _ = fs::remove_file(&cache_file);
        return Ok(false);
    }

    let mut last_copy_error = None;
    for attempt in 0..6 {
        match fs::copy(&cache_file, target) {
            Ok(_) => return Ok(true),
            Err(error) if cfg!(target_os = "windows") && error.raw_os_error() == Some(32) => {
                last_copy_error = Some(error);
                if attempt < 5 {
                    std::thread::sleep(Duration::from_millis(120 * (attempt + 1) as u64));
                    continue;
                }
            }
            Err(error) => {
                return Err(format!(
                    "No se pudo copiar asset desde cache {} a {}: {error}",
                    cache_file.display(),
                    target.display()
                ));
            }
        }
    }

    if target.exists() {
        let target_hash = file_sha1(target)?;
        if target_hash.eq_ignore_ascii_case(expected_sha1) {
            return Ok(true);
        }
    }

    if cfg!(target_os = "windows") {
        return Ok(false);
    }

    if let Some(error) = last_copy_error {
        return Err(format!(
            "No se pudo copiar asset desde cache {} a {}: {error}",
            cache_file.display(),
            target.display()
        ));
    }

    Ok(true)
}

fn persist_asset_to_cache(
    cache_root: &Path,
    source: &Path,
    hash: &str,
    expected_sha1: &str,
) -> Result<(), String> {
    if hash.len() < 2 || !source.exists() {
        return Ok(());
    }
    let source_hash = file_sha1(source)?;
    if !source_hash.eq_ignore_ascii_case(expected_sha1) {
        return Err(format!(
            "Asset descargado con hash inválido al persistir cache (esperado {expected_sha1}, obtenido {source_hash})"
        ));
    }
    let sub = &hash[0..2];
    let cache_dir = cache_root.join(sub);
    fs::create_dir_all(&cache_dir)
        .map_err(|error| format!("No se pudo crear carpeta de cache de assets: {error}"))?;
    let cache_file = cache_dir.join(hash);
    if cache_file.exists() {
        return Ok(());
    }
    fs::copy(source, &cache_file).map_err(|error| {
        format!(
            "No se pudo persistir asset en cache {}: {error}",
            cache_file.display()
        )
    })?;
    Ok(())
}

#[derive(Clone)]
struct BinaryDownloadTask {
    urls: Vec<String>,
    path: PathBuf,
    sha1: Option<String>,
    label: String,
    validate_zip: bool,
}
const DEFAULT_LAUNCHER_DIR_NAME: &str = "FrutiLauncherOficial";
const LEGACY_DEFAULT_LAUNCHER_DIR_NAME: &str = "FrutiLauncherOfficial";
const BACKUP_PREFIX: &str = "config.json.";
const BACKUP_SUFFIX: &str = ".bak";
const MAX_CONFIG_BACKUPS: usize = 12;
const MAX_BACKUP_AGE_DAYS: u64 = 14;

fn default_official_minecraft_root() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let trimmed = appdata.trim();
            if !trimmed.is_empty() {
                return Some(PathBuf::from(trimmed).join(".minecraft"));
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let trimmed = home.trim();
            if !trimmed.is_empty() {
                return Some(
                    PathBuf::from(trimmed)
                        .join("Library")
                        .join("Application Support")
                        .join("minecraft"),
                );
            }
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Ok(home) = std::env::var("HOME") {
            let trimmed = home.trim();
            if !trimmed.is_empty() {
                return Some(PathBuf::from(trimmed).join(".minecraft"));
            }
        }
    }

    None
}

fn launcher_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_path = config_path(app)?;
    if config_path.exists() {
        if let Ok(raw) = fs::read_to_string(&config_path) {
            if let Ok(config) = serde_json::from_str::<AppConfig>(&raw) {
                if let Some(base_dir) = config.base_dir {
                    if !base_dir.trim().is_empty() {
                        return Ok(normalize_launcher_root_candidate(Path::new(&base_dir)));
                    }
                }

                if let Some(minecraft_root) = config.minecraft_root {
                    let trimmed = minecraft_root.trim();
                    if !trimmed.is_empty() {
                        return Ok(PathBuf::from(trimmed));
                    }
                }
            }
        }
    }

    if let Some(official_root) = default_official_minecraft_root() {
        return Ok(official_root);
    }

    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("No se pudo obtener la carpeta del launcher: {error}"))?;
    Ok(base.join(DEFAULT_LAUNCHER_DIR_NAME))
}

fn normalize_launcher_root_candidate(base_path: &Path) -> PathBuf {
    let file_name = base_path
        .file_name()
        .and_then(OsStr::to_str)
        .map(|value| value.to_ascii_lowercase());

    if matches!(
        file_name.as_deref(),
        Some("frutilauncheroficial") | Some("frutilauncherofficial")
    ) {
        base_path.to_path_buf()
    } else {
        base_path.join(DEFAULT_LAUNCHER_DIR_NAME)
    }
}

fn ensure_launcher_layout(app: &tauri::AppHandle) -> Result<(), String> {
    let root = launcher_root(app)?;
    let layout = LauncherDataLayout::from_root(&root);
    layout.ensure()?;

    for directory in REQUIRED_LAUNCHER_DIRS {
        if !root.join(directory).exists() {
            return Err(format!(
                "No se pudo validar carpeta requerida del launcher_data: {directory}"
            ));
        }
    }

    Ok(())
}

static INSTANCE_LOCKS: Lazy<std::sync::Mutex<HashSet<String>>> =
    Lazy::new(|| std::sync::Mutex::new(HashSet::new()));
static PREFLIGHT_RUNNING: AtomicBool = AtomicBool::new(false);

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
    let normalized = base_dir.trim();
    let target = if normalized.is_empty() {
        None
    } else {
        Some(
            normalize_launcher_root_candidate(Path::new(normalized))
                .display()
                .to_string(),
        )
    };
    let config = AppConfig {
        base_dir: target,
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

fn validate_factory_reset_target(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let components = path.components().count();
    if components < 3 {
        return Err(format!(
            "Ruta insegura para limpieza total: {}",
            path.display()
        ));
    }
    Ok(())
}

fn delete_reset_target(path: &Path, removed_entries: &mut Vec<String>) -> Result<(), String> {
    println!("Resetting launcher...");
    println!("Deleting: {}", path.display());

    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|error| {
            format!(
                "No se pudo eliminar la carpeta del launcher ({}): {error}",
                path.display()
            )
        })?;
    } else if path.is_file() {
        fs::remove_file(path)
            .map_err(|error| format!("No se pudo eliminar archivo {}: {error}", path.display()))?;
    }

    println!("Exists after delete? {}", path.exists());
    removed_entries.push(path.display().to_string());
    Ok(())
}

#[cfg(target_os = "windows")]
fn kill_reset_processes() {
    for process_name in ["java.exe", "javaw.exe", "minecraft.exe"] {
        let _ = Command::new("taskkill")
            .args(["/IM", process_name, "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

#[cfg(not(target_os = "windows"))]
fn kill_reset_processes() {
    for process_name in ["java", "javaw", "minecraft"] {
        let _ = Command::new("pkill")
            .args(["-f", process_name])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

#[cfg(target_os = "windows")]
fn request_windows_admin_confirmation() -> Result<(), String> {
    let status = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "Start-Process powershell -WindowStyle Hidden -Verb RunAs -ArgumentList '-NoProfile -Command exit 0'",
        ])
        .status()
        .map_err(|error| format!("No se pudo solicitar confirmación de administrador: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err("Se canceló la confirmación de administrador.".to_string())
    }
}

#[cfg(not(target_os = "windows"))]
fn request_windows_admin_confirmation() -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn is_windows_process_elevated() -> bool {
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();

    let Ok(output) = output else {
        return false;
    };

    if !output.status.success() {
        return false;
    }

    String::from_utf8_lossy(&output.stdout)
        .trim()
        .eq_ignore_ascii_case("true")
}

#[cfg(target_os = "windows")]
fn relaunch_self_as_admin() -> Result<(), String> {
    let exe = std::env::current_exe()
        .map_err(|error| format!("No se pudo obtener el ejecutable actual: {error}"))?;
    let args: Vec<String> = std::env::args().skip(1).collect();

    let escape_ps = |value: &str| value.replace('\'', "''");
    let quoted_args: Vec<String> = args
        .iter()
        .map(|arg| format!("'{}'", escape_ps(arg)))
        .collect();

    let command = if quoted_args.is_empty() {
        format!(
            "Start-Process -FilePath '{}' -Verb RunAs",
            escape_ps(&exe.display().to_string())
        )
    } else {
        format!(
            "Start-Process -FilePath '{}' -Verb RunAs -ArgumentList {}",
            escape_ps(&exe.display().to_string()),
            quoted_args.join(",")
        )
    };

    let status = Command::new("powershell")
        .args(["-NoProfile", "-Command", &command])
        .status()
        .map_err(|error| format!("No se pudo relanzar en modo administrador: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err("Se canceló la elevación a administrador.".to_string())
    }
}

#[cfg(target_os = "windows")]
fn ensure_persistent_admin_mode(_app: &tauri::AppHandle) -> Result<(), String> {
    if is_windows_process_elevated() {
        return Ok(());
    }

    relaunch_self_as_admin()?;
    std::process::exit(0);
}

#[cfg(not(target_os = "windows"))]
fn ensure_persistent_admin_mode(_app: &tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

#[command]
async fn launcher_factory_reset(
    app: tauri::AppHandle,
    args: LauncherFactoryResetArgs,
) -> Result<LauncherFactoryResetResult, String> {
    if args.confirmation_phrase.trim().to_uppercase() != "REINSTALAR" {
        return Err("Confirma escribiendo exactamente REINSTALAR.".to_string());
    }

    request_windows_admin_confirmation()?;
    kill_reset_processes();

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("No se pudo resolver app_data_dir: {error}"))?;
    let local_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("No se pudo resolver app_local_data_dir: {error}"))?;
    let temp_dir = std::env::temp_dir();

    let mut roots = vec![launcher_root(&app)?];
    let default_root = app_data_dir.join(DEFAULT_LAUNCHER_DIR_NAME);
    if !roots.iter().any(|candidate| candidate == &default_root) {
        roots.push(default_root);
    }
    let legacy_default_root = app_data_dir.join(LEGACY_DEFAULT_LAUNCHER_DIR_NAME);
    if !roots
        .iter()
        .any(|candidate| candidate == &legacy_default_root)
    {
        roots.push(legacy_default_root);
    }
    let local_root = local_data_dir.join(DEFAULT_LAUNCHER_DIR_NAME);
    if !roots.iter().any(|candidate| candidate == &local_root) {
        roots.push(local_root);
    }
    let temp_root = temp_dir.join(DEFAULT_LAUNCHER_DIR_NAME);
    if !roots.iter().any(|candidate| candidate == &temp_root) {
        roots.push(temp_root);
    }

    let mut cleared_roots = Vec::new();
    let mut removed_entries = Vec::new();
    let mut reset_relative_targets = vec![
        PathBuf::from("cache"),
        PathBuf::from("temp"),
        PathBuf::from("http_cache"),
        PathBuf::from("runtime"),
        PathBuf::from("versions"),
        PathBuf::from("libraries"),
        PathBuf::from("assets"),
        PathBuf::from(".fruti_cache"),
        PathBuf::from("downloads"),
        PathBuf::from("logs"),
        PathBuf::from(".cache"),
        PathBuf::from("minecraft"),
    ];

    if !args.preserve_external_instances.unwrap_or(true) {
        reset_relative_targets.push(PathBuf::from("instances"));
    }

    for root in roots {
        validate_factory_reset_target(&root)?;
        if root.exists() {
            let mut touched_root = false;
            for relative in &reset_relative_targets {
                let target = root.join(relative);
                if target.exists() {
                    delete_reset_target(&target, &mut removed_entries)?;
                    touched_root = true;
                }
            }

            if root.exists()
                && root
                    .read_dir()
                    .map(|mut entries| entries.next().is_none())
                    .unwrap_or(false)
            {
                delete_reset_target(&root, &mut removed_entries)?;
                touched_root = true;
            }

            if touched_root {
                cleared_roots.push(root.display().to_string());
            }
        }
    }

    let db_path = database_path(&app)?;
    if db_path.exists() {
        delete_reset_target(&db_path, &mut removed_entries)
            .map_err(|error| format!("No se pudo eliminar base de datos del launcher: {error}"))?;
    }
    init_database(&app)?;

    let cfg_path = config_path(&app)?;
    if cfg_path.exists() {
        delete_reset_target(&cfg_path, &mut removed_entries)
            .map_err(|error| format!("No se pudo eliminar config.json: {error}"))?;
    }

    if let Some(parent) = cfg_path.parent() {
        let backups = parent.join("backups");
        if backups.exists() {
            delete_reset_target(&backups, &mut removed_entries).map_err(|error| {
                format!("No se pudo eliminar backups de configuración: {error}")
            })?;
        }
    }

    std::thread::sleep(Duration::from_millis(500));

    Ok(LauncherFactoryResetResult {
        cleared_roots,
        removed_entries,
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

fn startup_crash_hint(runtime_lines: &[String]) -> Option<String> {
    if runtime_lines.is_empty() {
        return None;
    }

    let joined_raw = runtime_lines.join("\n");
    let joined = joined_raw.to_lowercase();

    let has_tinyremapper_read_failure = joined
        .contains("net.fabricmc.tinyremapper.tinyremapper.readfile")
        || (joined.contains("tinyremapper")
            && (joined.contains("readfile")
                || joined.contains("zipexception")
                || joined.contains("invalid loc header")
                || joined.contains("zip end header not found")));

    if has_tinyremapper_read_failure {
        return Some(
            "Diagnóstico Fabric: TinyRemapper no pudo leer uno de los jars requeridos. \
            Suele indicar librerías/runtime corruptos o incompletos. Abre la instancia y prueba \
            \"Reparar runtime\"; si persiste, reinstala el loader Fabric y valida que no haya \
            mods/jars truncados en la carpeta mods."
                .to_string(),
        );
    }

    let has_loader_metadata_failure = joined.contains("mcversionlookup")
        || joined.contains("classreader")
        || joined.contains("class-file metadata")
        || joined.contains("failed to read class")
        || joined.contains("minecraftgameprovider.locategame")
        || joined.contains("knot.init")
        || joined.contains("knotclient.main");

    let has_corrupt_or_incomplete_jar_signal = joined.contains("minecraft.jar")
        && (joined.contains("zip end header not found")
            || joined.contains("invalid loc header")
            || joined.contains("invalid or corrupt jarfile")
            || joined.contains("failed to read class-file metadata")
            || joined.contains("sha1")
            || joined.contains("hash mismatch")
            || joined.contains("checksum"));

    let has_main_class_mismatch_signal = joined.contains("knotclient")
        && (joined.contains("could not find or load main class")
            || joined.contains("classnotfoundexception")
            || joined.contains("main class"));

    let has_java_too_old = joined.contains("unsupportedclassversionerror")
        || joined.contains("class file version")
        || (joined.contains("compiled by a more recent version of the java runtime")
            && joined.contains("this version of the java runtime"));

    if has_java_too_old {
        let mismatch =
            Regex::new(r"class file version\s+(\d+(?:\.\d+)?).+?up to\s+(\d+(?:\.\d+)?)")
                .ok()
                .and_then(|pattern| {
                    pattern
                        .captures(&joined)
                        .map(|captures| (captures[1].to_string(), captures[2].to_string()))
                });

        if let Some((required_class, current_class)) = mismatch {
            let class_to_java = |value: &str| -> Option<u16> {
                value
                    .split('.')
                    .next()
                    .and_then(|raw| raw.parse::<u16>().ok())
                    .and_then(|class_version| class_version.checked_sub(44))
            };

            let required_java = class_to_java(&required_class);
            let current_java = class_to_java(&current_class);

            if let (Some(required_java), Some(current_java)) = (required_java, current_java) {
                return Some(format!(
                    "Diagnóstico Java: la instancia requiere Java {required_java}, pero la instancia está usando Java {current_java}. Abre Configuración > Java y selecciona/instala Java {required_java} para esta instancia."
                ));
            }
        }

        return Some(
            "Diagnóstico Java: la instancia fue compilada para una versión más nueva de Java que la disponible. Minecraft 1.20.5+ requiere Java 21. Abre Configuración > Java y selecciona/instala Java 21 para esta instancia."
                .to_string(),
        );
    }

    if has_loader_metadata_failure
        || has_corrupt_or_incomplete_jar_signal
        || has_main_class_mismatch_signal
    {
        return Some(
            "Diagnóstico loader (Fabric/Quilt): no se pudo validar minecraft.jar o el arranque \
            temprano del loader. Pasos sugeridos: 1) ejecuta \"Reparar runtime\" (jar + libraries + \
            natives + loader), 2) si persiste, borra versions/<mc_version> en esa instancia, 3) \
            reinstala Fabric/Quilt con la versión exacta de Minecraft, 4) prueba arranque sin mods \
            para aislar incompatibilidades. Verifica además que la main class sea \
            net.fabricmc.loader.launch.knot.KnotClient y revisa señales de jar inválido (tamaño/hash \
            SHA1 o ausencia de clases cliente válidas)."
                .to_string(),
        );
    }

    None
}

fn is_loader_runtime_repair_recommended(runtime_lines: &[String]) -> bool {
    if runtime_lines.is_empty() {
        return false;
    }

    let joined = runtime_lines.join("\n").to_lowercase();
    joined.contains("net.fabricmc.tinyremapper.tinyremapper.readfile")
        || (joined.contains("tinyremapper")
            && (joined.contains("readfile")
                || joined.contains("zipexception")
                || joined.contains("invalid loc header")
                || joined.contains("zip end header not found")))
        || joined.contains("mcversionlookup")
        || joined.contains("classreader")
        || joined.contains("class-file metadata")
        || joined.contains("failed to read class")
        || joined.contains("minecraftgameprovider.locategame")
        || joined.contains("knot.init")
        || joined.contains("knotclient.main")
        || (joined.contains("minecraft.jar")
            && (joined.contains("zip end header not found")
                || joined.contains("invalid loc header")
                || joined.contains("invalid or corrupt jarfile")
                || joined.contains("failed to read class-file metadata")
                || joined.contains("sha1")
                || joined.contains("hash mismatch")
                || joined.contains("checksum")))
        || (joined.contains("knotclient")
            && (joined.contains("could not find or load main class")
                || joined.contains("classnotfoundexception")
                || joined.contains("main class")))
}

fn normalize_stack_line(line: &str) -> String {
    line.trim()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn loader_failure_fingerprint(
    classification: StartupFailureClassification,
    main_class: &str,
    loader: &str,
    version: &str,
    stack_excerpt: &[String],
) -> String {
    let normalized_stack = stack_excerpt
        .iter()
        .map(|line| normalize_stack_line(line))
        .collect::<Vec<_>>()
        .join("|");
    format!(
        "{:?}|{}|{}|{}|{}",
        classification,
        main_class.trim().to_lowercase(),
        loader.trim().to_lowercase(),
        version.trim().to_lowercase(),
        normalized_stack
    )
}

fn classify_loader_failure(
    launch_plan: &LaunchPlan,
    lines: &[String],
    jar_validation: &MinecraftJarValidation,
) -> StartupFailureClassification {
    if !jar_validation.ok {
        return StartupFailureClassification::CorruptMinecraftJar;
    }

    let joined = lines.join("\n").to_lowercase();
    let expected_main = expected_main_class_for_loader(&launch_plan.loader);
    let main_class_matches_loader = expected_main
        .map(|expected| launch_plan.main_class.eq_ignore_ascii_case(expected))
        .unwrap_or(true);
    if !main_class_matches_loader
        || (joined.contains("knotclient") && joined.contains("could not find or load main class"))
    {
        return StartupFailureClassification::LoaderProfileMismatch;
    }

    if joined.contains("mod")
        || joined.contains("fabric.mod.json")
        || joined.contains("quilt.mod.json")
        || joined.contains("failed to load")
    {
        return StartupFailureClassification::ModEarlyBootIncompatibility;
    }

    StartupFailureClassification::UnknownEarlyLoaderFailure
}

fn read_loader_stack_excerpt(lines: &[String], max_items: usize) -> Vec<String> {
    lines
        .iter()
        .filter(|line| {
            let normalized = line.to_lowercase();
            normalized.contains("mcversionlookup")
                || normalized.contains("classreader")
                || normalized.contains("knot")
                || normalized.contains("tinyremapper")
                || normalized.contains("exception")
        })
        .take(max_items)
        .cloned()
        .collect()
}

fn write_loader_crash_diagnostic(
    instance_root: &Path,
    launch_plan: &LaunchPlan,
    instance: &InstanceRecord,
    exit_code: i32,
    lines: &[String],
) -> Result<LoaderCrashDiagnostic, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default();
    let version_jar =
        Path::new(&launch_plan.version_json).with_file_name(format!("{}.jar", instance.version));
    let expected_sha1 =
        expected_client_sha1_from_version_json(Path::new(&launch_plan.version_json));
    let jar_validation = validate_minecraft_client_jar(&version_jar, expected_sha1.as_deref());
    let version_json_raw = fs::read_to_string(&launch_plan.version_json).unwrap_or_default();
    let version_json = serde_json::from_str::<Value>(&version_json_raw).unwrap_or(Value::Null);
    let stack_excerpt = read_loader_stack_excerpt(lines, 12);
    let classification = classify_loader_failure(launch_plan, lines, &jar_validation);
    let fingerprint = loader_failure_fingerprint(
        classification,
        &launch_plan.main_class,
        &launch_plan.loader,
        &instance.version,
        &stack_excerpt,
    );

    let diagnostic = LoaderCrashDiagnostic {
        timestamp,
        instance_id: instance.id.clone(),
        version: instance.version.clone(),
        loader: launch_plan.loader.clone(),
        loader_version: instance.loader_version.clone(),
        main_class: launch_plan.main_class.clone(),
        exit_code,
        classification,
        fingerprint,
        jar_path: version_jar.to_string_lossy().to_string(),
        jar_size_bytes: fs::metadata(&version_jar).ok().map(|meta| meta.len()),
        jar_sha1: file_sha1(&version_jar).ok(),
        expected_client_sha1: expected_sha1,
        jar_is_zip: is_valid_zip_stream(&version_jar),
        jar_has_client_markers: has_minecraft_client_marker(&version_jar),
        version_json_path: launch_plan.version_json.clone(),
        version_json_inherits_from: version_json
            .get("inheritsFrom")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        version_json_jar: version_json
            .get("jar")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        stack_excerpt,
    };

    let logs_dir = instance_root.join("logs");
    fs::create_dir_all(&logs_dir)
        .map_err(|error| format!("No se pudo crear carpeta logs para diagnóstico: {error}"))?;
    let path = logs_dir.join(format!("loader-diagnostic-{timestamp}.json"));
    let payload = serde_json::to_vec_pretty(&diagnostic)
        .map_err(|error| format!("No se pudo serializar diagnóstico de loader: {error}"))?;
    fs::write(&path, payload).map_err(|error| {
        format!(
            "No se pudo escribir diagnóstico de loader {}: {error}",
            path.display()
        )
    })?;

    Ok(diagnostic)
}

fn purge_minecraft_version_tree(game_dir: &Path, minecraft_version: &str) -> Result<(), String> {
    let version_dir = game_dir.join("versions").join(minecraft_version);
    if version_dir.exists() {
        fs::remove_dir_all(&version_dir).map_err(|error| {
            format!(
                "No se pudo purgar versions/{minecraft_version} en {}: {error}",
                game_dir.display()
            )
        })?;
    }
    Ok(())
}

struct ScopedModsDisable {
    source: PathBuf,
    disabled: PathBuf,
    active: bool,
}

impl ScopedModsDisable {
    fn disable(game_dir: &Path) -> Result<Option<Self>, String> {
        let source = game_dir.join("mods");
        if !source.exists() {
            return Ok(None);
        }

        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_secs())
            .unwrap_or_default();
        let disabled = game_dir.join(format!("mods.disabled.{ts}"));
        fs::rename(&source, &disabled).map_err(|error| {
            format!(
                "No se pudo desactivar mods para arranque seguro ({} -> {}): {error}",
                source.display(),
                disabled.display()
            )
        })?;

        Ok(Some(Self {
            source,
            disabled,
            active: true,
        }))
    }

    fn restore(&mut self) -> Result<(), String> {
        if !self.active {
            return Ok(());
        }

        if self.source.exists() {
            fs::remove_dir_all(&self.source).map_err(|error| {
                format!(
                    "No se pudo limpiar mods temporal antes de restaurar {}: {error}",
                    self.source.display()
                )
            })?;
        }

        fs::rename(&self.disabled, &self.source).map_err(|error| {
            format!(
                "No se pudo restaurar mods desactivados ({} -> {}): {error}",
                self.disabled.display(),
                self.source.display()
            )
        })?;
        self.active = false;
        Ok(())
    }
}

impl Drop for ScopedModsDisable {
    fn drop(&mut self) {
        if self.active {
            let _ = self.restore();
        }
    }
}

fn format_startup_crash_message(
    code: i32,
    stderr_lines: &[String],
    stdout_lines: &[String],
    error_files: &[String],
) -> String {
    let mut excerpt_source = stderr_lines;
    if excerpt_source.is_empty() {
        excerpt_source = stdout_lines;
    }

    let stderr_excerpt = excerpt_source
        .iter()
        .rev()
        .take(8)
        .cloned()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");

    let mut diagnostic_lines = Vec::with_capacity(stderr_lines.len() + stdout_lines.len());
    diagnostic_lines.extend(stderr_lines.iter().cloned());
    diagnostic_lines.extend(stdout_lines.iter().cloned());
    let hint = startup_crash_hint(&diagnostic_lines);
    let tracked_files = if error_files.is_empty() {
        String::new()
    } else {
        format!("\n\nArchivos para depuración:\n{}", error_files.join("\n"))
    };

    match (stderr_excerpt.is_empty(), hint) {
        (true, Some(hint)) => format!(
            "Minecraft cerró durante el arranque (código {code}). {hint} Revisa logs/runtime*.stderr.log{tracked_files}"
        ),
        (true, None) => {
            format!("Minecraft cerró durante el arranque (código {code}). Revisa logs/runtime*.stderr.log{tracked_files}")
        }
        (false, Some(hint)) => format!(
            "Minecraft cerró durante el arranque (código {code}). {hint}\n\nÚltimas líneas:\n{stderr_excerpt}{tracked_files}"
        ),
        (false, None) => format!(
            "Minecraft cerró durante el arranque (código {code}). Últimas líneas:\n{stderr_excerpt}{tracked_files}"
        ),
    }
}

fn expected_client_sha1_from_version_json(version_json_path: &Path) -> Option<String> {
    let raw = fs::read_to_string(version_json_path).ok()?;
    let json: Value = serde_json::from_str(&raw).ok()?;
    json.get("downloads")
        .and_then(|downloads| downloads.get("client"))
        .and_then(|client| client.get("sha1"))
        .and_then(|sha1| sha1.as_str())
        .map(|sha1| sha1.trim().to_string())
        .filter(|sha1| !sha1.is_empty())
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

fn fast_volume_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();

    #[cfg(target_os = "windows")]
    {
        for letter in b'A'..=b'Z' {
            let root = PathBuf::from(format!("{}:/", char::from(letter)));
            if root.is_dir() {
                roots.push(root);
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        roots.push(PathBuf::from("/"));
        for mount_parent in ["/mnt", "/media", "/Volumes"] {
            let parent = PathBuf::from(mount_parent);
            let Ok(entries) = fs::read_dir(&parent) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    roots.push(path);
                }
            }
        }
    }

    roots
}

fn discover_java_candidates_from_volumes() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    #[cfg(target_os = "windows")]
    {
        for volume in fast_volume_roots() {
            for rel in [
                ["Program Files", "Java"],
                ["Program Files", "Eclipse Adoptium"],
                ["Program Files", "Adoptium"],
                ["Program Files (x86)", "Java"],
                ["Program Files", "Microsoft"],
            ] {
                let base = volume.join(rel[0]).join(rel[1]);
                let Ok(entries) = fs::read_dir(&base) else {
                    continue;
                };
                for entry in entries.flatten() {
                    candidates.push(entry.path().join("bin").join(java_bin_name()));
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        for volume in fast_volume_roots() {
            let java_home = volume
                .join("Library")
                .join("Java")
                .join("JavaVirtualMachines");
            let Ok(entries) = fs::read_dir(java_home) else {
                continue;
            };
            for entry in entries.flatten() {
                candidates.push(
                    entry
                        .path()
                        .join("Contents")
                        .join("Home")
                        .join("bin")
                        .join(java_bin_name()),
                );
            }
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for volume in fast_volume_roots() {
            for path in [
                volume.join("usr").join("bin").join("java"),
                volume.join("usr").join("local").join("bin").join("java"),
                volume
                    .join("opt")
                    .join("homebrew")
                    .join("opt")
                    .join("openjdk")
                    .join("bin")
                    .join("java"),
            ] {
                candidates.push(path);
            }
        }
    }

    candidates
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
        self.launcher_root.join("runtime")
    }

    fn managed_runtime_bin(runtime_dir: &Path) -> Option<PathBuf> {
        if !runtime_dir.is_dir() {
            return None;
        }

        let java_bin = runtime_dir.join("bin").join(java_bin_name());
        if java_bin.is_file() {
            Some(java_bin)
        } else {
            None
        }
    }

    fn required_major_for_minecraft(mc_version: &str) -> u32 {
        Self::required_major_for_minecraft_version(mc_version)
    }

    fn required_major_for_minecraft_version(mc_version: &str) -> u32 {
        required_java_major_for_version(mc_version)
    }

    fn detect_installed(&self) -> Vec<JavaRuntime> {
        let mut runtimes = Vec::new();
        let mut seen_paths = HashSet::new();

        let managed_root = self.java_runtime_dir();

        for root in [managed_root.clone(), managed_root.join("java")] {
            let Ok(entries) = fs::read_dir(root) else {
                continue;
            };
            for entry in entries.flatten() {
                let runtime = entry.path();
                let Some(java) = Self::managed_runtime_bin(&runtime) else {
                    continue;
                };
                if let Some(found) = inspect_java_runtime(&java, "embebido") {
                    if seen_paths.insert(found.path.clone()) {
                        runtimes.push(found);
                    }
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
        let required_major = Self::required_major_for_minecraft(mc_version);
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
    let fourth = parts.next();
    let fifth = parts.next();

    let (classifier, ext) = match (fourth, fifth) {
        (None, _) => (None, "jar".to_string()),
        (Some(raw), None) => {
            if let Some((raw_classifier, raw_ext)) = raw.split_once('@') {
                let normalized_ext = if raw_ext.trim().is_empty() {
                    "jar"
                } else {
                    raw_ext.trim()
                };
                let normalized_classifier = raw_classifier.trim();
                (
                    (!normalized_classifier.is_empty())
                        .then_some(normalized_classifier.to_string()),
                    normalized_ext.to_string(),
                )
            } else {
                match raw {
                    "jar" | "zip" | "pom" => (None, raw.to_string()),
                    _ => (Some(raw.to_string()), "jar".to_string()),
                }
            }
        }
        (Some(raw_classifier), Some(raw_ext)) => {
            let normalized_ext = if raw_ext.trim().is_empty() {
                "jar"
            } else {
                raw_ext.trim()
            };
            let normalized_classifier = raw_classifier.trim();
            (
                (!normalized_classifier.is_empty()).then_some(normalized_classifier.to_string()),
                normalized_ext.to_string(),
            )
        }
    };

    if parts.next().is_some() {
        return None;
    }

    let mut path = PathBuf::new();
    for piece in group.split('.') {
        path.push(piece);
    }
    path.push(artifact);
    path.push(version);
    let file_name = if let Some(classifier) = classifier {
        format!("{artifact}-{version}-{classifier}.{ext}")
    } else {
        format!("{artifact}-{version}.{ext}")
    };
    path.push(file_name);
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

    let mut candidates =
        if loader_version.is_empty() || loader_version.eq_ignore_ascii_case("latest") {
            if loader == "forge" || loader == "neoforge" {
                discover_forge_like_profile_id(minecraft_root, loader, version, "")
                    .into_iter()
                    .collect::<Vec<_>>()
            } else {
                Vec::new()
            }
        } else {
            let mut explicit_candidates = Vec::new();
            explicit_candidates.push(loader_version.to_string());
            explicit_candidates.push(format!("{version}-{loader}-{loader_version}"));
            explicit_candidates.push(format!("{version}-{loader_version}"));
            if loader == "forge" {
                explicit_candidates.push(format!("{version}-forge-{loader_version}"));
            }
            if loader == "neoforge" {
                explicit_candidates.push(format!("{version}-neoforge-{loader_version}"));
            }
            explicit_candidates
        };

    if candidates.is_empty() {
        return None;
    }

    candidates = dedupe_non_empty(candidates);

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

fn normalize_loader_profile(profile: &mut Value, minecraft_version: &str, loader: &str) {
    normalize_loader_profile_core(profile, minecraft_version, loader);
}

fn persist_loader_profile_json(
    minecraft_root: &Path,
    minecraft_version: &str,
    loader: &str,
    loader_version: &str,
    profile: &Value,
) -> Result<String, String> {
    let profile_id = profile
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(|| {
            crate::core::loaders::profile_id_for_loader(loader, minecraft_version, loader_version)
        });

    let mut normalized_profile = profile.clone();
    if let Some(profile_obj) = normalized_profile.as_object_mut() {
        profile_obj.insert("id".to_string(), Value::String(profile_id.clone()));
    }
    normalize_loader_profile(&mut normalized_profile, minecraft_version, loader);

    let profile_dir = minecraft_root.join("versions").join(&profile_id);
    fs::create_dir_all(&profile_dir).map_err(|error| {
        format!("No se pudo crear carpeta de perfil {loader} ({profile_id}): {error}")
    })?;
    fs::write(
        profile_dir.join(format!("{profile_id}.json")),
        serde_json::to_string_pretty(&normalized_profile)
            .map_err(|error| format!("No se pudo serializar perfil {loader}: {error}"))?,
    )
    .map_err(|error| format!("No se pudo guardar perfil {loader}: {error}"))?;

    Ok(profile_id)
}

fn normalize_loader_profile_json_file(
    minecraft_root: &Path,
    profile_id: &str,
    minecraft_version: &str,
    loader: &str,
) -> Result<(), String> {
    let profile_path = minecraft_root
        .join("versions")
        .join(profile_id)
        .join(format!("{profile_id}.json"));
    let raw = fs::read_to_string(&profile_path).map_err(|error| {
        format!(
            "No se pudo leer perfil del loader {} en {}: {error}",
            profile_id,
            profile_path.display()
        )
    })?;
    let mut profile: Value = serde_json::from_str(&raw)
        .map_err(|error| format!("Perfil de loader inválido {}: {error}", profile_id))?;
    normalize_loader_profile(&mut profile, minecraft_version, loader);

    fs::write(
        &profile_path,
        serde_json::to_string_pretty(&profile)
            .map_err(|error| format!("No se pudo serializar perfil {loader}: {error}"))?,
    )
    .map_err(|error| {
        format!("No se pudo guardar perfil {loader} normalizado ({profile_id}): {error}")
    })?;

    Ok(())
}

fn runtime_version_json_path(instance_root: &Path) -> PathBuf {
    instance_root.join(".runtime").join("version.json")
}

fn instance_runtime_exists(instance_root: &Path, loader: &str) -> bool {
    if loader.trim().eq_ignore_ascii_case("vanilla") {
        return false;
    }

    let runtime_path = runtime_version_json_path(instance_root);
    if !runtime_path.is_file() {
        return false;
    }

    let Ok(raw) = fs::read_to_string(&runtime_path) else {
        return false;
    };
    let Ok(runtime_json) = serde_json::from_str::<Value>(&raw) else {
        return false;
    };

    let detected = detect_loader_from_version_json(&runtime_json).unwrap_or("vanilla");
    if detected != loader {
        return false;
    }

    let has_required_loader_lib = match loader {
        "fabric" => runtime_json
            .get("libraries")
            .and_then(Value::as_array)
            .map(|libraries| {
                libraries.iter().any(|lib| {
                    lib.get("name")
                        .and_then(Value::as_str)
                        .is_some_and(|name| name.contains("net.fabricmc:fabric-loader"))
                })
            })
            .unwrap_or(false),
        "quilt" => runtime_json
            .get("libraries")
            .and_then(Value::as_array)
            .map(|libraries| {
                libraries.iter().any(|lib| {
                    lib.get("name")
                        .and_then(Value::as_str)
                        .is_some_and(|name| name.contains("org.quiltmc:quilt-loader"))
                })
            })
            .unwrap_or(false),
        "forge" => runtime_json
            .get("libraries")
            .and_then(Value::as_array)
            .map(|libraries| {
                libraries.iter().any(|lib| {
                    lib.get("name").and_then(Value::as_str).is_some_and(|name| {
                        name.contains("net.minecraftforge:forge")
                            || name.contains("net.minecraftforge:fmlloader")
                    })
                })
            })
            .unwrap_or(false),
        "neoforge" => runtime_json
            .get("libraries")
            .and_then(Value::as_array)
            .map(|libraries| {
                libraries.iter().any(|lib| {
                    lib.get("name").and_then(Value::as_str).is_some_and(|name| {
                        name.contains("net.neoforged:neoforge")
                            || name.contains("net.neoforged:fml")
                    })
                })
            })
            .unwrap_or(false),
        _ => true,
    };

    if !has_required_loader_lib {
        return false;
    }

    expected_main_class_for_loader(loader)
        .map(|expected| {
            runtime_json
                .get("mainClass")
                .and_then(Value::as_str)
                .is_some_and(|main_class| main_class.trim() == expected)
        })
        .unwrap_or(true)
}

fn launch_plan_matches_persisted_runtime(instance_root: &Path, plan: &LaunchPlan) -> bool {
    let runtime_path = runtime_version_json_path(instance_root);
    if !runtime_path.is_file() {
        return false;
    }

    let Ok(raw) = fs::read_to_string(&runtime_path) else {
        return false;
    };
    let Ok(runtime_json) = serde_json::from_str::<Value>(&raw) else {
        return false;
    };

    let runtime_main_class = runtime_json
        .get("mainClass")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if runtime_main_class.is_empty() || runtime_main_class != plan.main_class.trim() {
        return false;
    }

    let runtime_loader = detect_loader_from_version_json(&runtime_json).unwrap_or("vanilla");
    if runtime_loader != plan.loader {
        return false;
    }

    if runtime_loader != "vanilla" && !instance_runtime_exists(instance_root, runtime_loader) {
        return false;
    }

    true
}

fn loader_profile_matches(actual: &str, expected: &str, loader: &str) -> bool {
    let actual = actual.trim().to_ascii_lowercase();
    let expected = expected.trim().to_ascii_lowercase();
    let loader = loader.trim().to_ascii_lowercase();

    if actual.is_empty() || expected.is_empty() {
        return false;
    }

    if loader == "forge" || loader == "neoforge" {
        return actual.contains(&loader) && expected.contains(&loader);
    }

    actual == expected
}

fn normalize_mc_base(version: &str) -> String {
    let value = version
        .split("-forge")
        .next()
        .unwrap_or(version)
        .split("-neoforge")
        .next()
        .unwrap_or(version)
        .trim();
    value.to_string()
}

fn ensure_loader_profile_client_jar(
    minecraft_root: &Path,
    profile_id: &str,
    minecraft_version: &str,
    expected_sha1: Option<&str>,
) -> Result<bool, String> {
    let source_jar = minecraft_root
        .join("versions")
        .join(minecraft_version)
        .join(format!("{minecraft_version}.jar"));
    if !source_jar.exists() {
        return Err(format!(
            "No existe minecraft.jar base para enlazar perfil del loader: {}",
            source_jar.display()
        ));
    }

    let profile_dir = minecraft_root.join("versions").join(profile_id);
    fs::create_dir_all(&profile_dir).map_err(|error| {
        format!(
            "No se pudo crear carpeta del perfil {} para alias de jar: {error}",
            profile_id
        )
    })?;

    let target_jar = profile_dir.join(format!("{profile_id}.jar"));
    if is_clean_minecraft_client_jar(&target_jar, expected_sha1) {
        return Ok(false);
    }

    fs::copy(&source_jar, &target_jar).map_err(|error| {
        format!(
            "No se pudo copiar minecraft.jar base ({}) al perfil del loader ({}): {error}",
            source_jar.display(),
            target_jar.display()
        )
    })?;

    let validation = validate_minecraft_client_jar(&target_jar, expected_sha1);
    if !validation.ok {
        return Err(format!(
            "El jar copiado para el perfil {profile_id} quedó inválido: {}",
            validation
                .reason
                .unwrap_or_else(|| "razón desconocida".to_string())
        ));
    }

    Ok(true)
}

fn validate_loader_profile_json(
    minecraft_root: &Path,
    profile_id: &str,
    vanilla_version: &str,
    loader: &str,
) -> Result<(), String> {
    let profile_path = minecraft_root
        .join("versions")
        .join(profile_id)
        .join(format!("{profile_id}.json"));
    let raw = fs::read_to_string(&profile_path).map_err(|error| {
        format!(
            "No se pudo leer perfil del loader {} en {}: {error}",
            profile_id,
            profile_path.display()
        )
    })?;
    let json: Value = serde_json::from_str(&raw)
        .map_err(|error| format!("Perfil de loader inválido {}: {error}", profile_id))?;

    let inherits_from = json
        .get("inheritsFrom")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if inherits_from.is_empty() {
        return Err(format!(
            "Perfil {profile_id} inválido: inheritsFrom está vacío; se esperaba al menos '{vanilla_version}'"
        ));
    }

    if loader == "fabric" || loader == "quilt" {
        if inherits_from != vanilla_version {
            return Err(format!(
                "Perfil {profile_id} inválido: inheritsFrom debe ser '{vanilla_version}' y se encontró '{inherits_from}'"
            ));
        }
    } else if loader == "forge" || loader == "neoforge" {
        let launch_target = json
            .get("launchTarget")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        let expected_target = if loader == "forge" {
            "forge_client"
        } else {
            "neoforge_client"
        };
        if launch_target.is_empty() {
            return Err(format!(
                "Perfil {profile_id} inválido: launchTarget está vacío; se esperaba '{expected_target}'"
            ));
        }
        if launch_target != expected_target {
            return Err(format!(
                "Perfil {profile_id} inválido: launchTarget debe ser '{expected_target}' y se encontró '{launch_target}'"
            ));
        }

        let mc_base = normalize_mc_base(inherits_from);
        if mc_base != vanilla_version {
            return Err(format!(
                "Perfil {profile_id} inválido: inheritsFrom ({inherits_from}) no referencia a la base de Minecraft '{vanilla_version}'"
            ));
        }
    }

    if let Some(jar) = json.get("jar").and_then(Value::as_str) {
        let jar = jar.trim();
        if !jar.is_empty() {
            let jar_is_valid = if loader == "forge" || loader == "neoforge" {
                let base_jar = normalize_mc_base(jar);
                jar == profile_id || base_jar == vanilla_version
            } else {
                jar == vanilla_version
            };
            if !jar_is_valid {
                return Err(format!(
                    "Perfil {profile_id} intenta usar jar '{jar}' en lugar de '{vanilla_version}'"
                ));
            }
        }
    }

    Ok(())
}

async fn resolve_latest_loader_version(loader: &str, minecraft_version: &str) -> Option<String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(env_u64(
            "FRUTI_ENDPOINT_CONNECT_TIMEOUT_SECS",
            10,
        )))
        .timeout(Duration::from_secs(env_u64(
            "FRUTI_ENDPOINT_REQUEST_TIMEOUT_SECS",
            25,
        )))
        .build()
        .ok()?;
    let user_agent = "FrutiLauncher/1.0 (+https://github.com/fruti-studio)";

    if loader == "forge" {
        for promotions_url in download_routes::forge_promotions_urls() {
            if let Ok(resp) = client
                .get(&promotions_url)
                .header(reqwest::header::USER_AGENT, user_agent)
                .send()
                .await
            {
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
    }

    let metadata_urls = download_routes::forge_like_metadata_urls(loader);

    let neoforge_channel = neoforge_channel_for_minecraft(minecraft_version);

    for url in metadata_urls {
        let Ok(resp) = client
            .get(url)
            .header(reqwest::header::USER_AGENT, user_agent)
            .send()
            .await
        else {
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
        matches.retain(|value| {
            if loader == "neoforge" {
                return value.starts_with(&neoforge_channel);
            }
            value.starts_with(minecraft_version)
        });
        matches.sort_by(|left, right| compare_numeric_versions(left, right));
        if let Some(last) = matches.last() {
            return Some(last.clone());
        }
    }

    None
}

fn neoforge_channel_for_minecraft(minecraft_version: &str) -> String {
    let mut parts = minecraft_version.split('.');
    let _major = parts.next();
    let minor = parts.next().unwrap_or_default();
    let patch = parts.next().unwrap_or("0");
    format!("{minor}.{patch}.")
}

fn compare_numeric_versions(left: &str, right: &str) -> std::cmp::Ordering {
    let parse = |value: &str| {
        value
            .split(|c: char| !c.is_ascii_digit())
            .filter(|segment| !segment.is_empty())
            .map(|segment| segment.parse::<u64>().unwrap_or(0))
            .collect::<Vec<_>>()
    };

    let left_parts = parse(left);
    let right_parts = parse(right);
    let max = left_parts.len().max(right_parts.len());

    for idx in 0..max {
        let l = *left_parts.get(idx).unwrap_or(&0);
        let r = *right_parts.get(idx).unwrap_or(&0);
        match l.cmp(&r) {
            std::cmp::Ordering::Equal => continue,
            ordering => return ordering,
        }
    }

    left.cmp(right)
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

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(env_u64(
            "FRUTI_ENDPOINT_CONNECT_TIMEOUT_SECS",
            10,
        )))
        .timeout(Duration::from_secs(env_u64(
            "FRUTI_ENDPOINT_REQUEST_TIMEOUT_SECS",
            25,
        )))
        .build()
        .ok()?;

    let Ok(resp) = client
        .get(&endpoint)
        .header(
            reqwest::header::USER_AGENT,
            "FrutiLauncher/1.0 (+https://github.com/fruti-studio)",
        )
        .send()
        .await
    else {
        return None;
    };
    let Ok(json) = resp.json::<Value>().await else {
        return None;
    };
    let entries = json.as_array()?;
    let preferred = entries.iter().find(|entry| {
        entry
            .get("loader")
            .and_then(|loader| loader.get("stable"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
    });

    preferred
        .or_else(|| entries.first())
        .and_then(|entry| entry.get("loader"))
        .and_then(|loader| loader.get("version"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
}

fn read_log_tail(path: &Path, max_lines: usize) -> String {
    if max_lines == 0 {
        return String::new();
    }

    let Ok(content) = fs::read_to_string(path) else {
        return String::new();
    };

    content
        .lines()
        .rev()
        .take(max_lines)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n")
}

async fn install_forge_like_loader(
    app: &tauri::AppHandle,
    instance_root: &Path,
    minecraft_root: &Path,
    minecraft_version: &str,
    loader: &str,
    requested_loader_version: Option<&str>,
) -> Result<String, String> {
    crate::core::loaders::validate_loader_request(loader, minecraft_version)?;
    ensure_forge_preflight_files(minecraft_root, minecraft_version)?;
    let config = load_config(app.clone()).await?;
    let tuning = resolve_network_tuning(Some(&config));

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

    let artifact_name = if loader == "neoforge" {
        "neoforge"
    } else {
        "forge"
    };
    let expected_id_candidates =
        expected_forge_like_profile_ids(loader, minecraft_version, &resolved_version);

    let installer_urls = download_routes::forge_like_installer_urls(loader, &resolved_version);
    let compatibility = download_routes::loader_compatibility_routes();
    let compatible = compatibility.iter().any(|entry| {
        entry.loader == loader
            && minecraft_version.starts_with(entry.minecraft_prefix)
            && entry.jar_published
    });
    if !compatible {
        return Err(format!(
            "No hay ruta de compatibilidad publicada para loader {loader} en Minecraft {minecraft_version}"
        ));
    }
    write_instance_state(
        instance_root,
        "loader_compatibility_checked",
        serde_json::json!({
            "loader": loader,
            "minecraftVersion": minecraft_version,
            "resolvedVersion": resolved_version,
            "metadataEndpoints": compatibility
                .iter()
                .filter(|entry| entry.loader == loader)
                .map(|entry| entry.metadata_endpoint.to_string())
                .collect::<Vec<_>>()
        }),
    );
    let launcher_cache_dir = launcher_root(app)?
        .join("cache")
        .join("loaders")
        .join(loader)
        .join(&resolved_version);
    fs::create_dir_all(&launcher_cache_dir)
        .map_err(|error| format!("No se pudo crear caché de loader {loader}: {error}"))?;

    let installer_file_name = format!("{artifact_name}-{resolved_version}-installer.jar");
    let installer_cache_target = launcher_cache_dir.join(&installer_file_name);
    download_from_candidates(
        &installer_urls,
        &installer_cache_target,
        "instalador Forge/NeoForge",
        &tuning,
    )
    .await?;

    let installer_target = minecraft_root.join("installers").join(&installer_file_name);
    if let Some(parent) = installer_target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("No se pudo crear carpeta de instaladores: {error}"))?;
    }
    fs::copy(&installer_cache_target, &installer_target).map_err(|error| {
        format!(
            "No se pudo copiar instalador cacheado {} a {}: {error}",
            installer_cache_target.display(),
            installer_target.display()
        )
    })?;

    let required_java_major = JavaManager::required_major_for_minecraft(minecraft_version);
    let runtime_manager = RuntimeManager::new(app)?;
    let java_bin = runtime_manager
        .ensure_runtime_for_java_major(required_java_major)
        .await
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|_| {
            let loader_name = if loader == "neoforge" {
                "NeoForge"
            } else {
                "Forge"
            };
            format!(
                "No se encontró Java embebido compatible para instalar {loader_name} (requerido Java {required_java_major})."
            )
        })?;

    let install_flag = if loader == "neoforge" {
        "--install-client"
    } else {
        "--installClient"
    };
    let installer_logs_dir = instance_root.join("logs");
    fs::create_dir_all(&installer_logs_dir)
        .map_err(|error| format!("No se pudo crear carpeta de logs del instalador: {error}"))?;
    let installer_stdout = installer_logs_dir.join("loader-installer.stdout.log");
    let installer_stderr = installer_logs_dir.join("loader-installer.stderr.log");
    let installer_stdout_file = fs::File::create(&installer_stdout)
        .map_err(|error| format!("No se pudo crear log stdout del instalador: {error}"))?;
    let installer_stderr_file = fs::File::create(&installer_stderr)
        .map_err(|error| format!("No se pudo crear log stderr del instalador: {error}"))?;

    let mut installer = Command::new(&java_bin)
        .current_dir(minecraft_root)
        .arg("-jar")
        .arg(&installer_target)
        .arg(install_flag)
        .arg(minecraft_root)
        .stdout(Stdio::from(installer_stdout_file))
        .stderr(Stdio::from(installer_stderr_file))
        .spawn()
        .map_err(|error| format!("No se pudo ejecutar el instalador {loader}: {error}"))?;

    let start = std::time::Instant::now();
    let install_timeout = Duration::from_secs(600);
    let mut next_progress_emit = Duration::from_secs(0);
    loop {
        if let Some(status) = installer
            .try_wait()
            .map_err(|error| format!("No se pudo monitorear instalador {loader}: {error}"))?
        {
            if !status.success() {
                let exit_code = status.code().unwrap_or(-1);
                let stderr_tail = read_log_tail(&installer_stderr, 20);
                let stdout_tail = read_log_tail(&installer_stdout, 20);
                let mut detail = String::new();
                if !stderr_tail.trim().is_empty() {
                    detail.push_str(&format!("\n\nÚltimas líneas stderr:\n{stderr_tail}"));
                }
                if !stdout_tail.trim().is_empty() {
                    detail.push_str(&format!("\n\nÚltimas líneas stdout:\n{stdout_tail}"));
                }
                return Err(format!(
                    "Falló la instalación de {loader} {resolved_version} (código {exit_code}). Logs: {}, {}.{}",
                    installer_stdout.display(),
                    installer_stderr.display(),
                    detail
                ));
            }
            break;
        }

        let elapsed = start.elapsed();
        if elapsed >= next_progress_emit {
            write_instance_state(
                instance_root,
                "installing_loader",
                serde_json::json!({
                    "loader": loader,
                    "version": resolved_version,
                    "step": "forge_like_wait",
                    "elapsedSeconds": elapsed.as_secs(),
                    "timeoutSeconds": install_timeout.as_secs(),
                    "stdout": installer_stdout.to_string_lossy().to_string(),
                    "stderr": installer_stderr.to_string_lossy().to_string()
                }),
            );
            next_progress_emit += Duration::from_secs(5);
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

    let installed_profile_id = expected_id_candidates.iter().find_map(|candidate| {
        let path = minecraft_root
            .join("versions")
            .join(candidate)
            .join(format!("{candidate}.json"));
        path.exists().then_some(candidate.to_string())
    });

    let installed_profile_id = installed_profile_id.or_else(|| {
        discover_forge_like_profile_id(minecraft_root, loader, minecraft_version, &resolved_version)
    });

    if installed_profile_id.is_none() {
        return Err(format!(
            "El instalador de {loader} terminó pero no creó un profile esperado ({:?}).",
            expected_id_candidates
        ));
    }

    Ok(installed_profile_id.unwrap_or_else(|| resolved_version.clone()))
}

fn expected_forge_like_profile_ids(
    loader: &str,
    minecraft_version: &str,
    resolved_version: &str,
) -> Vec<String> {
    let mut candidates = vec![resolved_version.to_string()];
    let trimmed = resolved_version.trim();

    if loader == "forge" {
        let without_mc_prefix = trimmed
            .strip_prefix(&format!("{minecraft_version}-"))
            .unwrap_or(trimmed)
            .to_string();
        let forge_suffix = without_mc_prefix
            .strip_prefix("forge-")
            .unwrap_or(&without_mc_prefix)
            .to_string();

        candidates.push(format!("{minecraft_version}-{without_mc_prefix}"));
        candidates.push(format!("{minecraft_version}-forge-{without_mc_prefix}"));
        candidates.push(format!("{minecraft_version}-{forge_suffix}"));
        candidates.push(format!("{minecraft_version}-forge-{forge_suffix}"));
    }

    if loader == "neoforge" {
        candidates.push(format!("{minecraft_version}-neoforge-{trimmed}"));
        candidates.push(format!("{minecraft_version}-{trimmed}"));
    }

    dedupe_non_empty(candidates)
}

fn dedupe_non_empty(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .filter(|value| seen.insert(value.clone()))
        .collect()
}

fn discover_forge_like_profile_id(
    minecraft_root: &Path,
    loader: &str,
    minecraft_version: &str,
    resolved_version: &str,
) -> Option<String> {
    let versions_dir = minecraft_root.join("versions");
    let entries = fs::read_dir(&versions_dir).ok()?;
    let resolved_lower = resolved_version.to_lowercase();
    let loader_lower = loader.to_lowercase();
    let mc_prefix = format!("{minecraft_version}-").to_lowercase();

    let mut strong_matches: Vec<String> = Vec::new();
    let mut relaxed_matches: Vec<String> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(id) = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.to_string())
        else {
            continue;
        };
        let id_lower = id.to_lowercase();
        if !id_lower.starts_with(&mc_prefix) {
            continue;
        }
        if !id_lower.contains(&loader_lower) {
            continue;
        }
        let profile_json = path.join(format!("{id}.json"));
        if profile_json.exists() {
            if id_lower.contains(&resolved_lower) {
                strong_matches.push(id);
            } else {
                relaxed_matches.push(id);
            }
        }
    }

    if !strong_matches.is_empty() {
        strong_matches.sort_by(|left, right| compare_numeric_versions(left, right));
        return strong_matches.pop();
    }

    relaxed_matches.sort_by(|left, right| compare_numeric_versions(left, right));
    relaxed_matches.pop()
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

async fn download_from_candidates(
    urls: &[String],
    path: &Path,
    label: &str,
    tuning: &NetworkTuning,
) -> Result<(), String> {
    download_with_retries(
        urls,
        path,
        None,
        tuning.retries,
        should_validate_zip_from_path(path),
        tuning,
        label,
    )
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

async fn download_to(
    url: &str,
    path: &Path,
    tuning: &NetworkTuning,
    expected_sha1: Option<&str>,
    expected_md5: Option<&str>,
) -> Result<ModDownloadIntegrity, String> {
    let urls = vec![url.to_string()];
    download_with_retries(
        &urls,
        path,
        expected_sha1,
        tuning.retries,
        should_validate_zip_from_path(path),
        tuning,
        "mod_download",
    )
    .await?;

    let actual_sha1 = file_sha1(path)?;
    let actual_md5 = file_md5(path)?;
    if let Some(expected) = expected_md5 {
        if !actual_md5.eq_ignore_ascii_case(expected) {
            return Err(format!(
                "MD5 inválido tras descarga (esperado {expected}, obtenido {actual_md5})"
            ));
        }
    }

    Ok(ModDownloadIntegrity {
        expected_sha1: expected_sha1.map(ToOwned::to_owned),
        expected_md5: expected_md5.map(ToOwned::to_owned),
        actual_sha1,
        actual_md5,
    })
}

fn mirror_candidates_for_url(url: &str) -> Vec<String> {
    download_routes::mirror_candidates_for_url(url)
}

fn should_validate_zip_from_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("jar") || ext.eq_ignore_ascii_case("zip"))
        .unwrap_or(false)
}

fn file_md5(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| {
        format!(
            "No se pudo abrir archivo para MD5 {}: {error}",
            path.display()
        )
    })?;
    let mut context = md5::Context::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let read = file.read(&mut buffer).map_err(|error| {
            format!(
                "No se pudo leer archivo para MD5 {}: {error}",
                path.display()
            )
        })?;
        if read == 0 {
            break;
        }
        context.consume(&buffer[..read]);
    }
    Ok(format!("{:x}", context.compute()))
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

fn normalized_sha1(expected_sha1: Option<&str>) -> Result<Option<String>, String> {
    let Some(raw) = expected_sha1 else {
        return Ok(None);
    };
    let normalized = raw.trim().to_ascii_lowercase();
    if normalized.len() != 40 || !normalized.chars().all(|value| value.is_ascii_hexdigit()) {
        return Err(format!("Hash SHA1 inválido recibido: {raw}"));
    }
    Ok(Some(normalized))
}

fn remove_file_with_retry(path: &Path, reason: &str) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    let mut last_error = None;
    for attempt in 0..6 {
        match fs::remove_file(path) {
            Ok(()) => return Ok(()),
            Err(error) => {
                if is_windows_access_denied(&error) {
                    last_error = Some(access_denied_hint(path, reason, &error));
                    std::thread::sleep(Duration::from_millis(120 * (attempt + 1) as u64));
                    continue;
                }
                return Err(format!(
                    "No se pudo eliminar archivo bloqueado {}: {error}",
                    path.display()
                ));
            }
        }
    }

    Err(last_error.unwrap_or_else(|| {
        format!(
            "No se pudo eliminar {} después de varios reintentos",
            path.display()
        )
    }))
}

fn global_cache_path_for_sha1(cache_root: &Path, sha1: &str) -> PathBuf {
    let prefix = &sha1[0..2];
    cache_root.join(prefix).join(sha1)
}

fn restore_binary_from_global_cache(
    cache_root: &Path,
    expected_sha1: &str,
    target: &Path,
    validate_zip: bool,
) -> Result<bool, String> {
    let cache_file = global_cache_path_for_sha1(cache_root, expected_sha1);
    if !cache_file.exists() {
        return Ok(false);
    }

    if file_sha1(&cache_file)? != expected_sha1 {
        let _ = fs::remove_file(&cache_file);
        return Ok(false);
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("No se pudo crear carpeta para cache global: {error}"))?;
    }
    fs::copy(&cache_file, target).map_err(|error| {
        format!(
            "No se pudo restaurar binario desde cache global {}: {error}",
            cache_file.display()
        )
    })?;

    if validate_zip && !is_valid_zip_stream(target) {
        let _ = remove_file_with_retry(target, "limpiar zip inválido restaurado de cache global");
        return Ok(false);
    }

    Ok(true)
}

fn persist_binary_to_global_cache(
    cache_root: &Path,
    source: &Path,
    expected_sha1: &str,
) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }
    if file_sha1(source)? != expected_sha1 {
        return Err(format!(
            "No se puede cachear archivo con hash inválido en cache global: {}",
            source.display()
        ));
    }
    let cache_file = global_cache_path_for_sha1(cache_root, expected_sha1);
    if cache_file.exists() {
        return Ok(());
    }
    if let Some(parent) = cache_file.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("No se pudo crear directorio de cache global: {error}"))?;
    }
    fs::copy(source, &cache_file).map_err(|error| {
        format!(
            "No se pudo persistir archivo en cache global {}: {error}",
            cache_file.display()
        )
    })?;
    Ok(())
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

fn normalized_display_path(path: &Path) -> String {
    fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string()
}

fn ensure_writable_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path)
        .map_err(|error| format!("No se pudo asegurar carpeta {}: {error}", path.display()))?;
    let probe_path = path.join(".fruti-write-test");
    fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&probe_path)
        .map_err(|error| {
            format!(
                "No hay permisos de escritura en {}: {error}. Cierra procesos Java/Minecraft, ejecuta FrutiLauncher como administrador y revisa antivirus/Acceso controlado a carpetas.",
                normalized_display_path(path)
            )
        })?;
    let _ = fs::remove_file(probe_path);
    Ok(())
}

fn ensure_writable_file(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        ensure_writable_dir(parent)?;
    }

    if path.exists() {
        let metadata = fs::metadata(path).map_err(|error| {
            format!(
                "No se pudo leer metadata para {}: {error}",
                normalized_display_path(path)
            )
        })?;
        let mut permissions = metadata.permissions();
        if permissions.readonly() {
            permissions.set_readonly(false);
            fs::set_permissions(path, permissions).map_err(|error| {
                format!(
                    "No se pudo corregir permisos de {}: {error}",
                    normalized_display_path(path)
                )
            })?;
        }
    }

    Ok(())
}

fn is_windows_access_denied(error: &std::io::Error) -> bool {
    cfg!(target_os = "windows") && error.raw_os_error() == Some(5)
}

fn access_denied_hint(path: &Path, action: &str, error: &std::io::Error) -> String {
    if is_windows_access_denied(error) {
        return format!(
            "Windows bloqueó {action} en {}: {error}. Cierra Java/Minecraft, ejecuta FrutiLauncher como administrador y revisa antivirus/Acceso controlado a carpetas.",
            normalized_display_path(path)
        );
    }

    format!(
        "No se pudo {action} en {}: {error}",
        normalized_display_path(path)
    )
}

fn content_type_is_suspicious_for_archive(
    content_type: Option<&reqwest::header::HeaderValue>,
) -> bool {
    let Some(raw) = content_type else {
        return false;
    };
    let Ok(value) = raw.to_str() else {
        return true;
    };
    let normalized = value.to_ascii_lowercase();
    normalized.starts_with("text/")
        || normalized.contains("html")
        || normalized.contains("json")
        || normalized.contains("xml")
}

fn classpath_contains_loader_artifact(entries: &[String], needle: &str) -> bool {
    let normalized_needle = needle.to_ascii_lowercase().replace('\\', "/");
    entries.iter().any(|entry| {
        entry
            .to_ascii_lowercase()
            .replace('\\', "/")
            .contains(&normalized_needle)
    })
}

fn classpath_has_loader_runtime(loader: &str, entries: &[String]) -> bool {
    let has_any = |needles: &[&str]| -> bool {
        needles
            .iter()
            .any(|needle| classpath_contains_loader_artifact(entries, needle))
    };

    match loader {
        "fabric" => classpath_contains_loader_artifact(entries, "fabric-loader"),
        "quilt" => classpath_contains_loader_artifact(entries, "quilt-loader"),
        "forge" => {
            let modern_runtime = has_any(&["bootstraplauncher", "modlauncher"])
                && has_any(&[
                    "fmlloader",
                    "net/minecraftforge/forge",
                    "minecraftforge/fml",
                ]);

            let legacy_runtime = classpath_contains_loader_artifact(entries, "launchwrapper")
                && has_any(&["net/minecraftforge/forge", "minecraftforge/fml"]);

            modern_runtime || legacy_runtime
        }
        "neoforge" => {
            classpath_contains_loader_artifact(entries, "bootstraplauncher")
                && has_any(&["net/neoforged/neoforge", "net/neoforged/fml"])
        }
        _ => true,
    }
}

async fn download_with_retries(
    urls: &[String],
    path: &Path,
    expected_sha1: Option<&str>,
    attempts: u8,
    validate_zip: bool,
    tuning: &NetworkTuning,
    stage: &str,
) -> Result<(), String> {
    let normalized_expected_sha1 = normalized_sha1(expected_sha1)?;

    if let Ok(meta) = fs::metadata(path) {
        if meta.is_file() && meta.len() > 0 && (!validate_zip || is_valid_zip_stream(path)) {
            if let Some(expected) = normalized_expected_sha1.as_deref() {
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
        ensure_writable_dir(parent)?;
    }

    if let Some(expected_sha1) = normalized_expected_sha1.as_deref() {
        let cache_root = launcher_global_download_cache_dir();
        if restore_binary_from_global_cache(&cache_root, expected_sha1, path, validate_zip)? {
            return Ok(());
        }
    }

    let client = http_client_with_tuning(tuning)?;
    let mut traces: Vec<DownloadTrace> = Vec::new();

    let partial_path = download_partial_path(path);
    ensure_writable_file(path)?;
    ensure_writable_file(&partial_path)?;
    let mut reset_partial = false;

    if partial_path.exists() {
        if validate_zip && !is_valid_zip_stream(&partial_path) {
            reset_partial = true;
        }
        if let Some(expected) = normalized_expected_sha1.as_deref() {
            match file_sha1(&partial_path) {
                Ok(hash) if hash.eq_ignore_ascii_case(expected) => {
                    let _ = fs::rename(&partial_path, path);
                    if path.exists() {
                        return Ok(());
                    }
                }
                Ok(_) | Err(_) => {}
            }
        }
    }

    if reset_partial {
        remove_file_with_retry(&partial_path, "limpiar temporal corrupto de descarga")?;
    }
    let max_attempts = attempts.max(1);
    let mut last_error = None;

    for attempt in 1..=max_attempts {
        for url in urls {
            traces.push(DownloadTrace {
                endpoint: format!("{}:{}", stage, download_routes::endpoint_label(url)),
                url: url.clone(),
                sha1: expected_sha1.map(ToOwned::to_owned),
                md5: None,
            });
            let resume_from = fs::metadata(&partial_path)
                .map(|meta| meta.len())
                .unwrap_or(0);
            let mut request = client.get(url).header(
                reqwest::header::USER_AGENT,
                "FrutiLauncher/1.0 (+https://github.com/fruti-studio)",
            );
            if resume_from > 0 {
                request = request.header(reqwest::header::RANGE, format!("bytes={resume_from}-"));
            }

            match request.send().await {
                Ok(response) => {
                    let status = response.status();
                    if !status.is_success() {
                        last_error = Some(format!("{url} respondió {status}"));
                        continue;
                    }

                    if status == reqwest::StatusCode::PARTIAL_CONTENT && resume_from == 0 {
                        last_error = Some(format!(
                            "{url} respondió 206 sin reanudación previa; se rechaza para evitar archivos truncados"
                        ));
                        continue;
                    }

                    if validate_zip
                        && content_type_is_suspicious_for_archive(
                            response.headers().get(reqwest::header::CONTENT_TYPE),
                        )
                    {
                        let content_type = response
                            .headers()
                            .get(reqwest::header::CONTENT_TYPE)
                            .and_then(|value| value.to_str().ok())
                            .unwrap_or("desconocido");
                        last_error = Some(format!(
                            "{url} devolvió Content-Type sospechoso para jar/zip: {content_type}"
                        ));
                        continue;
                    }

                    let append_mode =
                        resume_from > 0 && status == reqwest::StatusCode::PARTIAL_CONTENT;
                    let expected_length = response.content_length();
                    let mut options = tokio::fs::OpenOptions::new();
                    options.write(true).create(true);
                    if append_mode {
                        options.append(true);
                    } else {
                        options.truncate(true);
                    }

                    let output = options.open(&partial_path).await.map_err(|error| {
                        access_denied_hint(&partial_path, "abrir temporal de descarga", &error)
                    })?;
                    let mut writer = BufWriter::new(output);
                    let mut stream = response.bytes_stream();
                    let mut received_bytes = 0_u64;

                    while let Some(chunk_result) = stream.next().await {
                        let chunk = chunk_result
                            .map_err(|error| format!("No se pudo leer respuesta {url}: {error}"))?;
                        received_bytes = received_bytes.saturating_add(chunk.len() as u64);
                        writer.write_all(&chunk).await.map_err(|error| {
                            access_denied_hint(
                                &partial_path,
                                "escribir temporal de descarga",
                                &error,
                            )
                        })?;
                    }

                    writer.flush().await.map_err(|error| {
                        access_denied_hint(
                            &partial_path,
                            "vaciar buffer temporal de descarga",
                            &error,
                        )
                    })?;

                    if let Some(content_length) = expected_length {
                        if content_length != received_bytes {
                            last_error = Some(format!(
                                "{url} devolvió Content-Length inválido (esperado {content_length} bytes, recibido {received_bytes} bytes)",
                            ));
                            let _ = fs::remove_file(&partial_path);
                            continue;
                        }
                    }

                    if validate_zip && !is_valid_zip_stream(&partial_path) {
                        last_error = Some(format!("{url} devolvió un archivo zip/jar inválido"));
                        let _ = fs::remove_file(&partial_path);
                        continue;
                    }

                    if let Some(expected) = expected_sha1 {
                        let downloaded_hash = file_sha1(&partial_path)?;
                        if !downloaded_hash.eq_ignore_ascii_case(expected) {
                            last_error = Some(format!(
                                "{url} devolvió hash SHA1 inválido (esperado {expected}, obtenido {downloaded_hash})"
                            ));
                            let _ = fs::remove_file(&partial_path);
                            continue;
                        }
                    }

                    let mut moved = false;
                    for _ in 0..4 {
                        if let Some(parent) = path.parent() {
                            ensure_writable_dir(parent)?;
                        }
                        if !partial_path.exists() {
                            break;
                        }
                        match fs::rename(&partial_path, path) {
                            Ok(()) => {
                                moved = true;
                                break;
                            }
                            Err(rename_error) => {
                                if path.exists() {
                                    match remove_file_with_retry(path, "reemplazar archivo destino")
                                    {
                                        Ok(()) => {
                                            if fs::rename(&partial_path, path).is_ok() {
                                                moved = true;
                                                break;
                                            }
                                        }
                                        Err(remove_error) => {
                                            last_error = Some(remove_error);
                                        }
                                    }
                                }

                                if is_windows_access_denied(&rename_error) {
                                    last_error = Some(access_denied_hint(
                                        path,
                                        "mover temporal a destino",
                                        &rename_error,
                                    ));
                                }
                            }
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(120)).await;
                    }

                    if !moved {
                        let final_exists = path.exists();
                        return Err(format!(
                            "No se pudo mover temporal a destino. sha1={}; temp={}; final={}; finalExiste={final_exists}",
                            normalized_expected_sha1
                                .as_deref()
                                .unwrap_or("sin-sha1"),
                            normalized_display_path(&partial_path),
                            normalized_display_path(path),
                        ));
                    }

                    if let Some(expected_sha1) = normalized_expected_sha1.as_deref() {
                        let cache_root = launcher_global_download_cache_dir();
                        let _ = persist_binary_to_global_cache(&cache_root, path, expected_sha1);
                    }
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

    let trace_summary = traces
        .iter()
        .map(|trace| format!("{}=>{}", trace.endpoint, trace.url))
        .collect::<Vec<_>>()
        .join("; ");
    Err(format!(
        "{} | endpoints: {}",
        last_error.unwrap_or_else(|| "desconocido".to_string()),
        trace_summary
    ))
}

async fn download_many_with_limit<F>(
    items: Vec<AssetDownloadTask>,
    concurrency: usize,
    on_item_complete: F,
) -> Result<(), String>
where
    F: Fn(usize) -> Result<(), String> + Send + Sync,
{
    if items.is_empty() {
        return Ok(());
    }

    let tuning = NetworkTuning::default();
    let completed = std::sync::Arc::new(AtomicUsize::new(0));
    let on_item_complete = std::sync::Arc::new(on_item_complete);

    stream::iter(items)
        .map(Ok::<AssetDownloadTask, String>)
        .try_for_each_concurrent(concurrency.max(1), |task| {
            let tuning = tuning.clone();
            let completed = completed.clone();
            let on_item_complete = on_item_complete.clone();
            async move {
                let temp_path = download_partial_path(&task.path);
                download_with_retries(
                    &task.urls,
                    &task.path,
                    Some(&task.sha1),
                    tuning.retries,
                    false,
                    &tuning,
                    "asset",
                )
                .await
                .map_err(|error| {
                    format!(
                        "Asset {} ({}) falló: {} | final={} | temp={}",
                        task.object_name,
                        task.sha1,
                        error,
                        normalized_display_path(&task.path),
                        normalized_display_path(&temp_path)
                    )
                })?;

                let completed_now = completed.fetch_add(1, Ordering::SeqCst) + 1;
                on_item_complete(completed_now)?;
                Ok::<(), String>(())
            }
        })
        .await
}

fn recommended_download_concurrency(multiplier: usize, min: usize, max: usize) -> usize {
    let workers = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(4)
        .saturating_mul(multiplier.max(1));
    workers.clamp(min.max(1), max.max(min.max(1)))
}

async fn download_binaries_with_limit(
    items: Vec<BinaryDownloadTask>,
    concurrency: usize,
) -> Result<(), String> {
    if items.is_empty() {
        return Ok(());
    }

    let gate = std::sync::Arc::new(Semaphore::new(concurrency.max(1)));
    let mut tasks = tokio::task::JoinSet::new();
    let tuning = NetworkTuning::default();

    for task in items {
        let permit_gate = gate.clone();
        let tuning = tuning.clone();
        tasks.spawn(async move {
            let _permit = permit_gate
                .acquire_owned()
                .await
                .map_err(|error| format!("No se pudo adquirir cupo de descarga: {error}"))?;
            download_with_retries(
                &task.urls,
                &task.path,
                task.sha1.as_deref(),
                tuning.retries,
                task.validate_zip,
                &tuning,
                "binary",
            )
            .await
            .map_err(|error| format!("{} falló: {error}", task.label))
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
        let entries = match fs::read_dir(&current) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                continue;
            }
            Err(error) => {
                return Err(format!(
                    "No se pudo inspeccionar {}: {error}",
                    current.display()
                ));
            }
        };

        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    continue;
                }
                Err(error) => {
                    return Err(format!(
                        "No se pudo leer un elemento dentro de {}: {error}",
                        current.display()
                    ));
                }
            };
            let path = entry.path();
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    continue;
                }
                Err(error) => {
                    return Err(format!(
                        "No se pudo leer tipo de archivo {}: {error}",
                        path.display()
                    ));
                }
            };

            if file_type.is_dir() {
                stack.push(path);
                continue;
            }

            if !file_type.is_file() {
                continue;
            }

            let file_name = path.file_name().and_then(OsStr::to_str).unwrap_or_default();
            if file_name.ends_with(".part") || file_name.contains(".part.") {
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

#[derive(Debug, Clone)]
struct RuntimeIntegrityIssue {
    path: PathBuf,
    reason: String,
}

#[derive(Debug, Default)]
struct RuntimeIntegrityReport {
    issues: Vec<RuntimeIntegrityIssue>,
    corrupt_files: Vec<PathBuf>,
}

impl RuntimeIntegrityReport {
    fn ok(&self) -> bool {
        self.issues.is_empty()
    }
}

fn is_valid_zip_stream(path: &Path) -> bool {
    let Ok(file) = fs::File::open(path) else {
        return false;
    };
    let Ok(mut zip) = ZipArchive::new(file) else {
        return false;
    };

    if zip.len() == 0 {
        return false;
    }

    let probes = zip.len().min(3);
    for index in 0..probes {
        let Ok(mut entry) = zip.by_index(index) else {
            return false;
        };
        let mut byte = [0_u8; 1];
        if entry.read(&mut byte).is_err() {
            return false;
        }
    }

    true
}

fn has_minecraft_client_marker(path: &Path) -> bool {
    let Ok(file) = fs::File::open(path) else {
        return false;
    };
    let Ok(mut zip) = ZipArchive::new(file) else {
        return false;
    };

    [
        "net/minecraft/client/main/Main.class",
        "net/minecraft/client/Minecraft.class",
    ]
    .iter()
    .any(|entry| zip.by_name(entry).is_ok())
}

const MIN_CLIENT_JAR_SIZE_BYTES: u64 = 15 * 1024 * 1024;

fn validate_minecraft_client_jar(
    path: &Path,
    expected_sha1: Option<&str>,
) -> MinecraftJarValidation {
    let Ok(metadata) = fs::metadata(path) else {
        return MinecraftJarValidation {
            ok: false,
            reason: Some("minecraft.jar no existe".to_string()),
        };
    };

    if !metadata.is_file() {
        return MinecraftJarValidation {
            ok: false,
            reason: Some("minecraft.jar no es un archivo válido".to_string()),
        };
    }

    if metadata.len() < MIN_CLIENT_JAR_SIZE_BYTES {
        return MinecraftJarValidation {
            ok: false,
            reason: Some(format!(
                "minecraft.jar demasiado pequeño ({} bytes, mínimo {})",
                metadata.len(),
                MIN_CLIENT_JAR_SIZE_BYTES
            )),
        };
    }

    if !is_valid_zip_stream(path) {
        return MinecraftJarValidation {
            ok: false,
            reason: Some("minecraft.jar no es un ZIP/JAR válido".to_string()),
        };
    }

    if !has_minecraft_client_marker(path) {
        return MinecraftJarValidation {
            ok: false,
            reason: Some("minecraft.jar no contiene clases cliente esperadas".to_string()),
        };
    }

    if let Some(expected_sha1) = expected_sha1 {
        let Ok(actual_sha1) = file_sha1(path) else {
            return MinecraftJarValidation {
                ok: false,
                reason: Some("No se pudo calcular SHA1 de minecraft.jar".to_string()),
            };
        };
        if !actual_sha1.eq_ignore_ascii_case(expected_sha1) {
            return MinecraftJarValidation {
                ok: false,
                reason: Some(format!(
                    "SHA1 inválido: esperado {expected_sha1}, obtenido {actual_sha1}"
                )),
            };
        }
    }

    MinecraftJarValidation {
        ok: true,
        reason: None,
    }
}

fn is_clean_minecraft_client_jar(path: &Path, expected_sha1: Option<&str>) -> bool {
    validate_minecraft_client_jar(path, expected_sha1).ok
}

fn looks_like_minecraft_version_jar(path: &Path) -> bool {
    let Some(file_stem) = path.file_stem().and_then(|value| value.to_str()) else {
        return false;
    };
    let Some(version_dir) = path
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|value| value.to_str())
    else {
        return false;
    };

    file_stem == version_dir
}

fn scan_runtime_integrity(
    game_dir: &Path,
    minecraft_version: Option<&str>,
) -> RuntimeIntegrityReport {
    let mut report = RuntimeIntegrityReport::default();
    let mut seen_corrupt = HashSet::new();

    for scope in ["libraries", "versions", "mods"] {
        let root = game_dir.join(scope);
        if !root.exists() {
            continue;
        }

        let mut stack = vec![root];
        while let Some(current) = stack.pop() {
            let Ok(entries) = fs::read_dir(&current) else {
                report.issues.push(RuntimeIntegrityIssue {
                    path: current.clone(),
                    reason: "No se pudo leer carpeta para validar integridad".to_string(),
                });
                continue;
            };

            for entry in entries.flatten() {
                let path = entry.path();
                let Ok(file_type) = entry.file_type() else {
                    report.issues.push(RuntimeIntegrityIssue {
                        path: path.clone(),
                        reason: "No se pudo inspeccionar el tipo de archivo".to_string(),
                    });
                    continue;
                };

                if file_type.is_dir() {
                    stack.push(path);
                    continue;
                }

                if !file_type.is_file() {
                    continue;
                }

                let file_name = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default();
                if file_name.ends_with(".part") || file_name.contains(".part.") {
                    report.issues.push(RuntimeIntegrityIssue {
                        path: path.clone(),
                        reason: "Temporal incompleto (.part) detectado".to_string(),
                    });
                    if seen_corrupt.insert(path.clone()) {
                        report.corrupt_files.push(path.clone());
                    }
                    continue;
                }

                let is_archive = path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| ext.eq_ignore_ascii_case("jar") || ext.eq_ignore_ascii_case("zip"))
                    .unwrap_or(false);

                if !is_archive {
                    continue;
                }

                let Ok(meta) = fs::metadata(&path) else {
                    report.issues.push(RuntimeIntegrityIssue {
                        path: path.clone(),
                        reason: "No se pudo leer metadata del archivo".to_string(),
                    });
                    if seen_corrupt.insert(path.clone()) {
                        report.corrupt_files.push(path.clone());
                    }
                    continue;
                };

                let min_size = if scope == "mods" { 0 } else { 512 };
                if min_size > 0 && meta.len() < min_size {
                    report.issues.push(RuntimeIntegrityIssue {
                        path: path.clone(),
                        reason: format!(
                            "Archivo con tamaño sospechoso ({} bytes; mínimo recomendado {} bytes)",
                            meta.len(),
                            min_size
                        ),
                    });
                    if seen_corrupt.insert(path.clone()) {
                        report.corrupt_files.push(path.clone());
                    }
                    continue;
                }

                if !is_valid_zip_stream(&path) {
                    report.issues.push(RuntimeIntegrityIssue {
                        path: path.clone(),
                        reason: "ZIP/JAR inválido o ilegible".to_string(),
                    });
                    if seen_corrupt.insert(path.clone()) {
                        report.corrupt_files.push(path.clone());
                    }
                    continue;
                }

                if scope == "versions"
                    && minecraft_version
                        .map(|expected| expected == file_name.trim_end_matches(".jar"))
                        .unwrap_or(false)
                    && looks_like_minecraft_version_jar(&path)
                    && !has_minecraft_client_marker(&path)
                {
                    report.issues.push(RuntimeIntegrityIssue {
                        path: path.clone(),
                        reason: "JAR de Minecraft sin clases cliente esperadas (Main/Minecraft)"
                            .to_string(),
                    });
                    if seen_corrupt.insert(path.clone()) {
                        report.corrupt_files.push(path.clone());
                    }
                }
            }
        }
    }

    report
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

fn canonical_or_original(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn resolve_minecraft_client_jar_path(plan: &LaunchPlan) -> PathBuf {
    let default_path = Path::new(&plan.version_json).with_extension("jar");
    if default_path.is_file() {
        return default_path;
    }

    let launch_version = extract_or_fallback_arg(&plan.game_args, "--version", "");
    if !launch_version.trim().is_empty() {
        let from_version_arg = Path::new(&plan.game_dir)
            .join("versions")
            .join(&launch_version)
            .join(format!("{launch_version}.jar"));
        if from_version_arg.is_file() {
            return from_version_arg;
        }
    }

    plan.classpath_entries
        .iter()
        .map(PathBuf::from)
        .find(|entry| {
            entry.is_file()
                && entry
                    .extension()
                    .and_then(|value| value.to_str())
                    .map(|ext| ext.eq_ignore_ascii_case("jar"))
                    .unwrap_or(false)
                && looks_like_minecraft_version_jar(entry)
        })
        .unwrap_or(default_path)
}

fn detect_mod_loader_kind(mod_jar: &Path) -> ModLoaderKind {
    inspect_mod_jar(mod_jar).loader
}

fn parse_quilt_dependencies(value: &Value) -> Vec<String> {
    let mut dependencies = Vec::new();

    let mut push_dep = |candidate: &str| {
        let dep = candidate.trim();
        if !dep.is_empty() {
            dependencies.push(dep.to_string());
        }
    };

    if let Some(entries) = value.as_array() {
        for entry in entries {
            if let Some(dep) = entry.as_str() {
                push_dep(dep);
            } else if let Some(dep) = entry.get("id").and_then(Value::as_str) {
                push_dep(dep);
            }
        }
    } else if let Some(entries) = value.as_object() {
        for (dep, _) in entries {
            push_dep(dep);
        }
    }

    dependencies
}

fn parse_forge_dependencies_from_toml(raw: &str) -> Vec<String> {
    let mut dependencies = Vec::new();
    let mut current_mod_id: Option<String> = None;
    let mut current_is_mandatory = true;

    let mut flush_dependency = |mod_id: &mut Option<String>, mandatory: bool| {
        if mandatory {
            if let Some(dep) = mod_id.take() {
                if !dep.trim().is_empty() {
                    dependencies.push(dep);
                }
            }
        }
        *mod_id = None;
    };

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        if trimmed.starts_with("[[") && trimmed.ends_with("]]") {
            flush_dependency(&mut current_mod_id, current_is_mandatory);
            current_is_mandatory = true;
            if !trimmed.contains("dependencies") {
                continue;
            }
            continue;
        }

        if let Some((key, value)) = trimmed.split_once('=') {
            let key = key.trim();
            let value = value.trim().trim_matches('"').trim_matches('\'').trim();
            if key == "modId" {
                current_mod_id = Some(value.to_string());
            } else if key == "mandatory" {
                current_is_mandatory = !value.eq_ignore_ascii_case("false");
            }
        }
    }

    flush_dependency(&mut current_mod_id, current_is_mandatory);

    dependencies
}

fn parse_forge_mod_id_from_toml(raw: &str) -> Option<String> {
    let mut in_mods_section = false;

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        if trimmed.starts_with("[[") && trimmed.ends_with("]]") {
            in_mods_section = trimmed.contains("mods");
            continue;
        }

        if !in_mods_section {
            continue;
        }

        if let Some((key, value)) = trimmed.split_once('=') {
            if key.trim() != "modId" {
                continue;
            }
            let id = value.trim().trim_matches('"').trim_matches('\'').trim();
            if !id.is_empty() {
                return Some(id.to_string());
            }
        }
    }

    None
}

fn inspect_mod_jar(mod_jar: &Path) -> ModInspection {
    let Ok(file) = fs::File::open(mod_jar) else {
        return ModInspection {
            id: None,
            loader: ModLoaderKind::Unknown,
            dependencies: Vec::new(),
            minecraft_constraint: None,
        };
    };
    let Ok(mut zip) = ZipArchive::new(file) else {
        return ModInspection {
            id: None,
            loader: ModLoaderKind::Unknown,
            dependencies: Vec::new(),
            minecraft_constraint: None,
        };
    };

    let fabric_json = {
        match zip.by_name("fabric.mod.json") {
            Ok(mut entry) => {
                let mut content = String::new();
                if entry.read_to_string(&mut content).is_ok() {
                    Some(content)
                } else {
                    None
                }
            }
            Err(_) => None,
        }
    };

    let quilt_json = {
        match zip.by_name("quilt.mod.json") {
            Ok(mut entry) => {
                let mut content = String::new();
                if entry.read_to_string(&mut content).is_ok() {
                    Some(content)
                } else {
                    None
                }
            }
            Err(_) => None,
        }
    };

    let has_fabric = fabric_json.is_some();
    let has_quilt = quilt_json.is_some();
    let has_forge = zip.by_name("META-INF/mods.toml").is_ok() || zip.by_name("mcmod.info").is_ok();
    let has_neoforge = zip.by_name("META-INF/neoforge.mods.toml").is_ok();

    let forge_toml = {
        match zip.by_name("META-INF/mods.toml") {
            Ok(mut entry) => {
                let mut content = String::new();
                if entry.read_to_string(&mut content).is_ok() {
                    Some(content)
                } else {
                    None
                }
            }
            Err(_) => None,
        }
    };

    let loader = if has_fabric {
        ModLoaderKind::Fabric
    } else if has_quilt {
        ModLoaderKind::Quilt
    } else if has_neoforge {
        ModLoaderKind::NeoForge
    } else if has_forge {
        ModLoaderKind::Forge
    } else {
        ModLoaderKind::Unknown
    };

    let mut id = None;
    let mut dependencies = Vec::new();
    let mut minecraft_constraint = None;

    if let Some(content) = fabric_json {
        if let Ok(json) = serde_json::from_str::<Value>(&content) {
            id = json
                .get("id")
                .and_then(Value::as_str)
                .map(ToString::to_string);
            if let Some(depends) = json.get("depends").and_then(Value::as_object) {
                dependencies.extend(depends.keys().cloned());
                minecraft_constraint = depends
                    .get("minecraft")
                    .and_then(Value::as_str)
                    .map(ToString::to_string);
            }
        }
    } else if let Some(content) = quilt_json {
        if let Ok(json) = serde_json::from_str::<Value>(&content) {
            id = json
                .get("quilt_loader")
                .and_then(|v| v.get("id"))
                .and_then(Value::as_str)
                .map(ToString::to_string);
            if let Some(depends) = json.get("quilt_loader").and_then(|v| v.get("depends")) {
                dependencies.extend(parse_quilt_dependencies(depends));
            }
        }
    } else if let Some(content) = forge_toml {
        if id.is_none() {
            id = parse_forge_mod_id_from_toml(&content);
        }
        dependencies.extend(parse_forge_dependencies_from_toml(&content));
    }

    ModInspection {
        id,
        loader,
        dependencies,
        minecraft_constraint,
    }
}

fn evaluate_mod_loader_compatibility(
    game_dir: &Path,
    instance_loader: &str,
    minecraft_version: Option<&str>,
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
    let mut installed_ids = HashSet::new();
    let mut inspected = Vec::new();

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

        let inspection = inspect_mod_jar(&path);
        if let Some(id) = inspection.id.clone() {
            installed_ids.insert(id.to_lowercase());
        }
        inspected.push((path, inspection));
    }

    let normalized_loader = instance_loader.trim().to_lowercase();

    for (path, inspection) in inspected {
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("mod-desconocido.jar");

        let compatible = match normalized_loader.as_str() {
            "fabric" => {
                inspection.loader == ModLoaderKind::Fabric
                    || inspection.loader == ModLoaderKind::Unknown
            }
            "quilt" => {
                inspection.loader == ModLoaderKind::Quilt
                    || inspection.loader == ModLoaderKind::Fabric
                    || inspection.loader == ModLoaderKind::Unknown
            }
            "forge" | "neoforge" => {
                matches!(
                    inspection.loader,
                    ModLoaderKind::Forge | ModLoaderKind::NeoForge | ModLoaderKind::Unknown
                )
            }
            _ => inspection.loader == ModLoaderKind::Unknown,
        };

        if !compatible {
            issues.push(format!(
                "{file_name} parece no compatible con loader '{normalized_loader}'"
            ));
        }

        if let Some(required_mc) = inspection.minecraft_constraint.as_deref() {
            if let Some(current_mc) = minecraft_version {
                if !required_mc.contains(current_mc) {
                    issues.push(format!(
                        "{file_name} declara minecraft={required_mc}, posible incompatibilidad con {current_mc}"
                    ));
                }
            }
        }

        for dependency in inspection.dependencies {
            let dependency = dependency.trim().to_lowercase();
            if dependency == "minecraft"
                || dependency == "java"
                || dependency == "fabricloader"
                || dependency == "fabric-loader"
                || dependency == "quilt_loader"
                || dependency == "forge"
                || dependency == "neoforge"
                || dependency == "fml"
            {
                continue;
            }
            if !installed_ids.contains(&dependency) {
                issues.push(format!(
                    "{file_name} depende de '{dependency}' y no se detectó en la carpeta mods"
                ));
            }
        }
    }

    (issues.is_empty(), issues)
}

async fn fetch_json_with_fallback(urls: &[String], context: &str) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(env_u64(
            "FRUTI_ENDPOINT_CONNECT_TIMEOUT_SECS",
            10,
        )))
        .timeout(std::time::Duration::from_secs(env_u64(
            "FRUTI_ENDPOINT_REQUEST_TIMEOUT_SECS",
            30,
        )))
        .user_agent("FrutiLauncher/1.0")
        .build()
        .map_err(|error| format!("No se pudo preparar cliente HTTP: {error}"))?;
    let mut last_error = None;
    let retries = env_u64("FRUTI_ENDPOINT_RETRIES", 3).max(1);
    for attempt in 1..=retries {
        for url in urls {
            match client.get(url).send().await {
                Ok(response) => {
                    if !response.status().is_success() {
                        last_error = Some(format!(
                            "{url} [{}] respondió {}",
                            download_routes::endpoint_label(url),
                            response.status()
                        ));
                        continue;
                    }
                    match response.json::<Value>().await {
                        Ok(json) => return Ok(json),
                        Err(error) => {
                            last_error = Some(format!(
                                "JSON inválido en {url} [{}]: {error}",
                                download_routes::endpoint_label(url)
                            ));
                        }
                    }
                }
                Err(error) => {
                    last_error = Some(format!(
                        "No se pudo descargar {url} [{}]: {error}",
                        download_routes::endpoint_label(url)
                    ));
                }
            }
        }
        if attempt < retries {
            tokio::time::sleep(Duration::from_millis(300 * attempt)).await;
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

fn normalize_critical_game_args(
    plan: &mut LaunchPlan,
    version: &str,
    loader_name: Option<&str>,
    loader_version: Option<&str>,
) {
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
    let mut version_type =
        extract_or_fallback_arg(&plan.game_args, "--versionType", "FrutiLauncher");
    let normalized_loader = loader_name
        .map(|value| value.trim().to_lowercase())
        .unwrap_or_else(|| "vanilla".to_string());
    if normalized_loader != "vanilla" {
        let pretty_loader = match normalized_loader.as_str() {
            "forge" => "Forge",
            "fabric" => "Fabric",
            "quilt" => "Quilt",
            "neoforge" => "NeoForge",
            _ => loader_name.unwrap_or("Loader"),
        };
        let loader_suffix = loader_version
            .map(str::trim)
            .filter(|value| !value.is_empty() && *value != "latest")
            .map(|value| format!(" {value}"))
            .unwrap_or_default();
        version_type = format!("{pretty_loader}{loader_suffix}");
    }

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

fn loader_profile_chain_is_valid(plan: &LaunchPlan) -> bool {
    if plan.loader == "vanilla" {
        return true;
    }

    let launch_version = extract_or_fallback_arg(&plan.game_args, "--version", "");
    if launch_version.trim().is_empty() {
        return false;
    }

    let launch_json = Path::new(&plan.game_dir)
        .join("versions")
        .join(&launch_version)
        .join(format!("{launch_version}.json"));
    if !launch_json.is_file() {
        return false;
    }

    let Ok(raw_launch_json) = fs::read_to_string(&launch_json) else {
        return false;
    };
    let Ok(launch_profile_json) = serde_json::from_str::<Value>(&raw_launch_json) else {
        return false;
    };

    let launch_profile_id = launch_profile_json
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if !launch_profile_id.is_empty()
        && !loader_profile_matches(&launch_version, launch_profile_id, &plan.loader)
    {
        return false;
    }

    let main_class = launch_profile_json
        .get("mainClass")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if (plan.loader == "forge" || plan.loader == "neoforge") && main_class.contains("modlauncher") {
        return true;
    }

    let vanilla_version = launch_profile_json
        .get("inheritsFrom")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| normalize_mc_base(value))
        .unwrap_or_default();

    if vanilla_version.is_empty() {
        return false;
    }

    validate_loader_profile_json(
        Path::new(&plan.game_dir),
        &launch_version,
        &vanilla_version,
        &plan.loader,
    )
    .is_ok()
}

async fn bootstrap_instance_runtime(
    app: &tauri::AppHandle,
    instance_root: &Path,
    instance: &InstanceRecord,
) -> Result<(), String> {
    let launch_config = resolve_instance_launch_config(instance_root, instance);
    let minecraft_root = launch_config.game_dir.clone();
    let version = launch_config.minecraft_version.trim();
    let mut loader = launch_config.modloader.trim().to_ascii_lowercase();

    hydrate_from_detected_launcher(&minecraft_root, version)?;

    let assets_objects_dir = minecraft_root.join("assets").join("objects");
    let libraries_dir = minecraft_root.join("libraries");
    let versions_dir = minecraft_root.join("versions");
    let mods_dir = minecraft_root.join("mods");
    let cleaned_assets = remove_partial_files(&assets_objects_dir)?;
    let cleaned_libraries = remove_partial_files(&libraries_dir)?;
    let cleaned_versions = remove_partial_files(&versions_dir)?;
    let cleaned_mods = remove_partial_files(&mods_dir)?;
    if cleaned_assets > 0 || cleaned_libraries > 0 || cleaned_versions > 0 || cleaned_mods > 0 {
        write_instance_state(
            instance_root,
            "cleaning_partials",
            serde_json::json!({
                "assetsPartials": cleaned_assets,
                "librariesPartials": cleaned_libraries,
                "versionsPartials": cleaned_versions,
                "modsPartials": cleaned_mods
            }),
        );
    }

    let manifest_urls = download_routes::MINECRAFT_MANIFEST_URLS
        .iter()
        .map(|url| (*url).to_string())
        .collect::<Vec<_>>();
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

    let version_json_urls = download_routes::version_metadata_urls(&version_entry.url);
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

    let client_download = base_version_json
        .get("downloads")
        .and_then(|v| v.get("client"))
        .ok_or_else(|| "La metadata de Minecraft no trae metadata de client.jar".to_string())?;
    let client_url = client_download
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "La metadata de Minecraft no trae URL de client.jar".to_string())?;
    let client_sha1 = client_download
        .get("sha1")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "La metadata de Minecraft no trae SHA1 de client.jar; no se puede validar integridad."
                .to_string()
        })?;
    let client_jar = version_dir.join(format!("{version}.jar"));
    write_instance_state(
        instance_root,
        "downloading_client",
        serde_json::json!({
            "version": version,
            "target": client_jar.to_string_lossy(),
            "sha1": client_sha1
        }),
    );
    let network_tuning = resolve_network_tuning(Some(&load_config(app.clone()).await?));
    download_with_retries(
        &[client_url.to_string()],
        &client_jar,
        Some(client_sha1),
        network_tuning.retries,
        should_validate_zip_from_path(&client_jar),
        &network_tuning,
        "client_jar",
    )
    .await?;

    let initial_jar_validation = validate_minecraft_client_jar(&client_jar, Some(client_sha1));
    if !initial_jar_validation.ok {
        let _ = fs::remove_dir_all(&version_dir);
        fs::create_dir_all(&version_dir).map_err(|error| {
            format!("No se pudo recrear carpeta de versión tras corrupción: {error}")
        })?;
        fs::write(
            version_dir.join(format!("{version}.json")),
            serde_json::to_string_pretty(&base_version_json)
                .map_err(|error| format!("No se pudo serializar version.json: {error}"))?,
        )
        .map_err(|error| format!("No se pudo restaurar version.json: {error}"))?;

        write_instance_state(
            instance_root,
            "repairing_client",
            serde_json::json!({
                "version": version,
                "reason": "client_jar_invalid_after_download",
                "details": initial_jar_validation.reason,
                "target": client_jar.to_string_lossy(),
                "sha1": client_sha1,
                "deletedVersionDir": version_dir.to_string_lossy()
            }),
        );
        download_with_retries(
            &[client_url.to_string()],
            &client_jar,
            Some(client_sha1),
            network_tuning.retries,
            should_validate_zip_from_path(&client_jar),
            &network_tuning,
            "client_jar_retry",
        )
        .await?;

        let second_validation = validate_minecraft_client_jar(&client_jar, Some(client_sha1));
        if !second_validation.ok {
            let _ = fs::remove_dir_all(&version_dir);
            return Err(format!(
                "El minecraft.jar descargado para {version} quedó inválido/corrupto tras 2 intentos ({:?}). Se eliminó versions/{version} para evitar bucles de descarga.",
                second_validation.reason
            ));
        }
    }

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
    let asset_index_sha1 = base_version_json
        .get("assetIndex")
        .and_then(|v| v.get("sha1"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let asset_index_json = if let Some(cached) =
        load_cached_asset_index_if_valid(app, asset_index_id, asset_index_sha1)?
    {
        write_instance_state(
            instance_root,
            "downloading_asset_index",
            serde_json::json!({"step": "asset_index_cached", "id": asset_index_id}),
        );
        cached
    } else {
        write_instance_state(
            instance_root,
            "downloading_asset_index",
            serde_json::json!({"step": "asset_index", "url": asset_index_url}),
        );
        let asset_index_urls = download_routes::asset_index_urls(asset_index_url);
        let downloaded = fetch_json_with_fallback(&asset_index_urls, "asset index").await?;

        let indexes_dir = minecraft_root.join("assets").join("indexes");
        fs::create_dir_all(&indexes_dir)
            .map_err(|error| format!("No se pudo crear indexes dir: {error}"))?;
        let serialized = serde_json::to_string_pretty(&downloaded)
            .map_err(|error| format!("No se pudo serializar asset index: {error}"))?;
        fs::write(
            indexes_dir.join(format!("{asset_index_id}.json")),
            &serialized,
        )
        .map_err(|error| format!("No se pudo guardar asset index: {error}"))?;

        let cache_indexes_dir = launcher_asset_indexes_cache_dir(app)?;
        fs::create_dir_all(&cache_indexes_dir).map_err(|error| {
            format!(
                "No se pudo crear carpeta de cache de asset indexes {}: {error}",
                cache_indexes_dir.display()
            )
        })?;
        fs::write(
            cache_indexes_dir.join(format!("{asset_index_id}.json")),
            serialized,
        )
        .map_err(|error| format!("No se pudo persistir asset index cacheado: {error}"))?;

        downloaded
    };

    let indexes_dir = minecraft_root.join("assets").join("indexes");
    fs::create_dir_all(&indexes_dir)
        .map_err(|error| format!("No se pudo crear indexes dir: {error}"))?;
    fs::write(
        indexes_dir.join(format!("{asset_index_id}.json")),
        serde_json::to_string_pretty(&asset_index_json)
            .map_err(|error| format!("No se pudo serializar asset index: {error}"))?,
    )
    .map_err(|error| format!("No se pudo guardar asset index local: {error}"))?;

    write_instance_state(
        instance_root,
        "downloading_assets",
        serde_json::json!({"assetIndex": asset_index_id}),
    );

    if let Some(objects) = asset_index_json.get("objects").and_then(|v| v.as_object()) {
        let assets_cache_root = launcher_assets_cache_root(app)?;
        ensure_writable_dir(&assets_cache_root)?;
        let _ = remove_partial_files(&minecraft_root.join("assets").join("objects"));
        let _ = remove_partial_files(&assets_cache_root);

        let mut validation_cache = load_asset_validation_cache(app);
        let mut seen_hashes = HashSet::new();
        let mut downloads = Vec::new();
        let mut restored_from_cache = 0_u64;
        let mut reused_existing = 0_u64;
        let now_secs = unix_now_secs();

        for value in objects.values() {
            let Some(hash) = value.get("hash").and_then(|v| v.as_str()) else {
                continue;
            };
            let expected_size = value.get("size").and_then(|v| v.as_u64()).unwrap_or(0);
            if hash.len() < 2 || !seen_hashes.insert(hash.to_string()) {
                continue;
            }

            let sub = &hash[0..2];
            let target = minecraft_root
                .join("assets")
                .join("objects")
                .join(sub)
                .join(hash);

            if expected_size > 0
                && existing_asset_is_valid(
                    &target,
                    expected_size,
                    hash,
                    now_secs,
                    &mut validation_cache,
                )?
            {
                reused_existing += 1;
                continue;
            }

            if sync_asset_from_cache(&assets_cache_root, hash, &target, hash)? {
                restored_from_cache += 1;
                if expected_size > 0 {
                    validation_cache.assets.insert(
                        hash.to_string(),
                        AssetValidationEntry {
                            size: expected_size,
                            last_checked: now_secs,
                        },
                    );
                }
                continue;
            }

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
            serde_json::json!({
                "assetIndex": asset_index_id,
                "total": total_downloads,
                "restoredFromCache": restored_from_cache,
                "reusedExisting": reused_existing
            }),
        );
        let asset_concurrency = recommended_download_concurrency(16, 48, 128);
        download_many_with_limit(downloads.clone(), asset_concurrency, |completed| {
            if completed == 1 || completed % 25 == 0 || completed == total_downloads {
                write_instance_state(
                    instance_root,
                    "downloading_assets",
                    serde_json::json!({
                        "assetIndex": asset_index_id,
                        "total": total_downloads,
                        "restoredFromCache": restored_from_cache,
                        "reusedExisting": reused_existing,
                        "completed": completed,
                        "remaining": total_downloads.saturating_sub(completed),
                        "progress": if total_downloads == 0 { 100 } else { completed * 100 / total_downloads },
                    }),
                );
            }
            Ok(())
        })
        .await?;
        for task in downloads {
            persist_asset_to_cache(&assets_cache_root, &task.path, &task.sha1, &task.sha1)?;
            if let Ok(meta) = fs::metadata(&task.path) {
                validation_cache.assets.insert(
                    task.sha1.clone(),
                    AssetValidationEntry {
                        size: meta.len(),
                        last_checked: now_secs,
                    },
                );
            }
        }
        save_asset_validation_cache(app, &validation_cache)?;
        write_instance_state(
            instance_root,
            "assets_ready",
            serde_json::json!({
                "assetIndex": asset_index_id,
                "total": total_downloads,
                "restoredFromCache": restored_from_cache,
                "reusedExisting": reused_existing
            }),
        );
    }

    let mut effective_version_json = base_version_json.clone();
    let detected_loader = detect_loader_from_version_json(&effective_version_json);
    if let Some(detected) = detected_loader {
        if detected != "vanilla" {
            let runtime_ok = instance_runtime_exists(instance_root, detected);
            if loader == "vanilla" && runtime_ok {
                write_instance_state(
                    instance_root,
                    "loader_auto_corrected",
                    serde_json::json!({
                        "requested": loader,
                        "detected": detected,
                        "version": version,
                        "reason": "version_json_detected_loader"
                    }),
                );
                loader = detected.to_string();
            } else if !runtime_ok && loader == "vanilla" {
                write_instance_state(
                    instance_root,
                    "loader_detection_skipped",
                    serde_json::json!({
                        "requested": loader,
                        "detected": detected,
                        "version": version,
                        "reason": "runtime_missing_or_invalid"
                    }),
                );
            }
        }
    }
    let mut launch_version_name = version.to_string();
    if loader == "forge" || loader == "neoforge" {
        let loader_runtime_available = instance_runtime_exists(instance_root, &loader);
        if loader_runtime_available {
            write_instance_state(
                instance_root,
                "installing_loader",
                serde_json::json!({"loader": loader, "version": instance.loader_version, "step": "forge_like_skip_existing"}),
            );
            if let Some(profile_json) = resolve_loader_profile_json(
                &minecraft_root,
                version,
                &loader,
                None,
                &base_version_json,
            ) {
                if let Some(profile_id) = profile_json.get("id").and_then(Value::as_str) {
                    launch_version_name = profile_id.to_string();
                }
                effective_version_json = profile_json;
            }
        } else {
            write_instance_state(
                instance_root,
                "installing_loader",
                serde_json::json!({"loader": loader, "version": instance.loader_version, "step": "forge_like"}),
            );
            let installed_profile_id = install_forge_like_loader(
                app,
                instance_root,
                &minecraft_root,
                version,
                &loader,
                Some(launch_config.modloader_version.as_str()),
            )
            .await?;
            normalize_loader_profile_json_file(
                &minecraft_root,
                &installed_profile_id,
                version,
                &loader,
            )?;
            validate_loader_profile_json(&minecraft_root, &installed_profile_id, version, &loader)?;
            if let Some(profile_json) = resolve_loader_profile_json(
                &minecraft_root,
                version,
                &loader,
                Some(&installed_profile_id),
                &base_version_json,
            ) {
                effective_version_json = profile_json;
            }
            launch_version_name = installed_profile_id;
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
        let requested_loader_version = launch_config.modloader_version.trim();
        let loader_version = if requested_loader_version.is_empty()
            || requested_loader_version.eq_ignore_ascii_case("latest")
        {
            resolve_latest_fabric_like_loader_version(&loader, version)
                .await
                .unwrap_or_else(|| "latest".to_string())
        } else {
            requested_loader_version.to_string()
        };
        let profile_urls =
            download_routes::fabric_like_profile_urls(&loader, version, &loader_version);
        write_instance_state(
            instance_root,
            "installing_loader",
            serde_json::json!({"loader": loader, "version": loader_version, "step": "fabric_profile"}),
        );
        let mut profile = fetch_json_with_fallback(&profile_urls, "perfil del loader").await?;
        normalize_loader_profile(&mut profile, version, &loader);
        let persisted_profile_id = persist_loader_profile_json(
            &minecraft_root,
            version,
            &loader,
            &loader_version,
            &profile,
        )?;
        let base_client_sha1 = base_version_json
            .get("downloads")
            .and_then(|downloads| downloads.get("client"))
            .and_then(|client| client.get("sha1"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let profile_jar_repaired = ensure_loader_profile_client_jar(
            &minecraft_root,
            &persisted_profile_id,
            version,
            base_client_sha1,
        )?;
        if profile_jar_repaired {
            write_instance_state(
                instance_root,
                "repairing_profile_jar",
                serde_json::json!({
                    "loader": loader,
                    "profileId": persisted_profile_id,
                    "sourceVersion": version,
                }),
            );
        }
        validate_loader_profile_json(&minecraft_root, &persisted_profile_id, version, &loader)?;
        launch_version_name = persisted_profile_id;
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
    let natives_dir = instance_root.join("natives");
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

    let mut native_archives = Vec::new();
    let mut library_downloads = Vec::new();
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
                    let urls = mirror_candidates_for_url(url);
                    library_downloads.push(BinaryDownloadTask {
                        urls,
                        path: target.clone(),
                        sha1: artifact
                            .get("sha1")
                            .and_then(|value| value.as_str())
                            .map(|value| value.to_string()),
                        label: format!("Librería {}", target.display()),
                        validate_zip: should_validate_zip_from_path(&target),
                    });
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
                        library_downloads.push(BinaryDownloadTask {
                            urls: mirror_candidates_for_url(url),
                            path: native_jar.clone(),
                            sha1: native
                                .get("sha1")
                                .and_then(|value| value.as_str())
                                .map(|value| value.to_string()),
                            label: format!("Native {}", native_jar.display()),
                            validate_zip: should_validate_zip_from_path(&native_jar),
                        });
                        native_archives.push(native_jar);
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
                library_downloads.push(BinaryDownloadTask {
                    urls: mirror_candidates_for_url(&url),
                    path: target.clone(),
                    sha1: None,
                    label: format!("Librería {}", target.display()),
                    validate_zip: should_validate_zip_from_path(&target),
                });
                if classpath_seen.insert(target.clone()) {
                    classpath_entries.push(target);
                }
            }
        }
    }

    let total_libraries = library_downloads.len();
    let library_concurrency = recommended_download_concurrency(8, 16, 64);
    write_instance_state(
        instance_root,
        "downloading_libraries",
        serde_json::json!({"step": "libraries", "total": total_libraries, "concurrency": library_concurrency}),
    );
    download_binaries_with_limit(library_downloads, library_concurrency).await?;

    for native_jar in native_archives {
        extract_native_library(&native_jar, &natives_dir)?;
    }

    if classpath_seen.insert(client_jar.clone()) {
        classpath_entries.push(client_jar.clone());
    }

    let java_major = launch_config.java_version_required.unwrap_or_else(|| {
        required_java_major(
            version,
            Some(&base_version_json),
            Some(&effective_version_json),
        )
    });
    let runtime_manager = RuntimeManager::new(app)?;
    let selected = runtime_manager
        .ensure_runtime_for_java_major(java_major)
        .await
        .ok()
        .map(|path| JavaRuntime {
            id: format!("managed-java-{java_major}"),
            name: format!("Java {java_major} (embebido)"),
            path: path.to_string_lossy().to_string(),
            version: format!("{java_major}"),
            major: java_major,
            architecture: std::env::consts::ARCH.to_string(),
            source: "embebido".to_string(),
            recommended: true,
        })
        .ok_or_else(|| {
            format!(
                "No se encontró Java embebido compatible. Minecraft requiere Java {java_major}."
            )
        })?;

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
    if !classpath_has_loader_runtime(&loader, &classpath_entries_raw) {
        return Err(format!(
            "Classpath incompleto para loader {loader}: faltan artefactos runtime obligatorios (BootstrapLauncher/FML). Reinstala el loader o repara la instancia."
        ));
    }
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
    let version_name = if launch_version_name.trim().is_empty() {
        effective_version_json
            .get("id")
            .and_then(|value| value.as_str())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(version)
            .to_string()
    } else {
        launch_version_name.clone()
    };
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

    if loader == "forge" || loader == "neoforge" {
        let fallback_launch_target = if loader == "forge" {
            "forge_client"
        } else {
            "neoforge_client"
        };
        let launch_target = effective_version_json
            .get("launchTarget")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(fallback_launch_target)
            .to_string();
        upsert_game_arg(&mut game_args, "--launchTarget", launch_target);
    }

    let required_game_args = [
        ("--username", user.to_string()),
        ("--version", version_name.clone()),
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

    let persisted_runtime_version_json = persist_instance_runtime_version_json(
        instance_root,
        &version_name,
        &effective_version_json,
    )?;

    write_instance_state(
        instance_root,
        "building_launch_plan",
        serde_json::json!({
            "step": "launch_plan",
            "runtimeVersionJson": persisted_runtime_version_json.to_string_lossy(),
            "launchVersion": version_name,
        }),
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
        version_json: persisted_runtime_version_json.to_string_lossy().to_string(),
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

fn persist_instance_runtime_version_json(
    instance_root: &Path,
    launch_version_name: &str,
    merged_version_json: &Value,
) -> Result<PathBuf, String> {
    let runtime_dir = instance_root.join(".runtime");
    fs::create_dir_all(&runtime_dir)
        .map_err(|error| format!("No se pudo crear carpeta de runtime persistente: {error}"))?;

    let runtime_version_path = runtime_dir.join("version.json");
    fs::write(
        &runtime_version_path,
        serde_json::to_string_pretty(merged_version_json)
            .map_err(|error| format!("No se pudo serializar runtime version.json: {error}"))?,
    )
    .map_err(|error| format!("No se pudo guardar runtime version.json: {error}"))?;

    let runtime_version_sha1 = file_sha1(&runtime_version_path)?;

    let runtime_state = serde_json::json!({
        "launchVersion": launch_version_name,
        "runtimeVersionSha1": runtime_version_sha1,
        "librariesCount": merged_version_json
            .get("libraries")
            .and_then(Value::as_array)
            .map(|libraries| libraries.len())
            .unwrap_or(0),
        "mainClass": merged_version_json
            .get("mainClass")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        "updatedAt": SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or_default(),
    });
    fs::write(
        runtime_dir.join("runtime_state.json"),
        serde_json::to_string_pretty(&runtime_state)
            .map_err(|error| format!("No se pudo serializar runtime_state.json: {error}"))?,
    )
    .map_err(|error| format!("No se pudo guardar runtime_state.json: {error}"))?;

    Ok(runtime_version_path)
}

fn validate_persisted_runtime_version(
    instance_root: &Path,
    launch_plan: &LaunchPlan,
) -> Result<(), String> {
    let runtime_version_path = Path::new(&launch_plan.version_json);
    let raw = fs::read_to_string(runtime_version_path)
        .map_err(|error| format!("No se pudo leer runtime version.json persistido: {error}"))?;
    let runtime_json: Value = serde_json::from_str(&raw)
        .map_err(|error| format!("runtime version.json persistido inválido: {error}"))?;

    let runtime_main_class = runtime_json
        .get("mainClass")
        .and_then(Value::as_str)
        .ok_or_else(|| "runtime version.json no contiene mainClass".to_string())?;

    if runtime_main_class.trim() != launch_plan.main_class.trim() {
        return Err(format!(
            "runtime version.json y launch plan tienen mainClass distinto (runtime='{}', plan='{}')",
            runtime_main_class, launch_plan.main_class
        ));
    }

    let runtime_libraries_count = runtime_json
        .get("libraries")
        .and_then(Value::as_array)
        .map(|libraries| libraries.len())
        .unwrap_or(0);
    if runtime_libraries_count == 0 {
        return Err(
            "runtime version.json no contiene librerías; se forzará reconstrucción".to_string(),
        );
    }

    let runtime_state_path = instance_root.join(".runtime").join("runtime_state.json");
    if runtime_state_path.is_file() {
        let state_raw = fs::read_to_string(&runtime_state_path)
            .map_err(|error| format!("No se pudo leer runtime_state.json: {error}"))?;
        let runtime_state: Value = serde_json::from_str(&state_raw)
            .map_err(|error| format!("runtime_state.json inválido: {error}"))?;

        if let Some(expected_sha1) = runtime_state
            .get("runtimeVersionSha1")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let actual_sha1 = file_sha1(runtime_version_path)?;
            if !actual_sha1.eq_ignore_ascii_case(expected_sha1) {
                return Err(format!(
                    "runtime version.json corrupto (SHA1 esperado {}, obtenido {})",
                    expected_sha1, actual_sha1
                ));
            }
        }

        if let Some(expected_main_class) = runtime_state
            .get("mainClass")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            if runtime_main_class.trim() != expected_main_class {
                return Err(format!(
                    "runtime_state.json tiene mainClass distinto (state='{}', runtime='{}')",
                    expected_main_class, runtime_main_class
                ));
            }
        }
    }

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
    const MIN_MINECRAFT_JAR_SIZE_BYTES: u64 = MIN_CLIENT_JAR_SIZE_BYTES;

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

    let natives_dir_ready = |path: &Path| -> bool { path.is_dir() };

    let launch_plan_path = instance_root.join("launch-plan.json");
    let launch_command_path = instance_root.join("launch-command.txt");
    let logs_dir = instance_root.join("logs");
    let crash_reports_dir = Path::new(&plan.game_dir).join("crash-reports");
    let version_jar_path = resolve_minecraft_client_jar_path(plan);
    let minecraft_jar_size_ok = fs::metadata(&version_jar_path)
        .map(|meta| meta.is_file() && meta.len() >= MIN_MINECRAFT_JAR_SIZE_BYTES)
        .unwrap_or(false);
    let minecraft_jar_client_marker_ok = if version_jar_path.is_file() {
        has_minecraft_client_marker(&version_jar_path)
    } else {
        false
    };
    let expected_client_sha1 =
        expected_client_sha1_from_version_json(Path::new(&plan.version_json));
    let minecraft_jar_sha1_ok = if !version_jar_path.is_file() {
        false
    } else if let Some(expected_sha1) = expected_client_sha1.as_deref() {
        file_sha1(&version_jar_path)
            .map(|actual_sha1| actual_sha1.eq_ignore_ascii_case(expected_sha1))
            .unwrap_or(false)
    } else {
        true
    };

    let classpath_entries_paths: Vec<&Path> = plan
        .classpath_entries
        .iter()
        .map(|entry| Path::new(entry))
        .collect();
    let classpath_complete = !plan.classpath_entries.is_empty();
    let classpath_libraries_ok = classpath_entries_complete(plan);
    let version_jar_canonical = canonical_or_original(&version_jar_path);
    let classpath_has_mc_jar = classpath_entries_paths
        .iter()
        .any(|entry| canonical_or_original(entry) == version_jar_canonical);
    let has_loader_runtime_jar =
        classpath_has_loader_runtime(plan.loader.as_str(), &plan.classpath_entries);

    let main_class_matches_loader = expected_main_class_for_loader(plan.loader.as_str())
        .map(|expected| plan.main_class == expected)
        .unwrap_or(true);

    let launch_mc_version = extract_or_fallback_arg(&plan.game_args, "--version", "");
    let (mods_compatible_with_loader, mod_compatibility_issues) = evaluate_mod_loader_compatibility(
        Path::new(&plan.game_dir),
        &plan.loader,
        Some(&launch_mc_version),
    );
    let runtime_integrity = scan_runtime_integrity(
        Path::new(&plan.game_dir),
        Path::new(&plan.version_json)
            .file_stem()
            .and_then(|value| value.to_str()),
    );

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
        ("jar_minecraft_tamano_minimo", minecraft_jar_size_ok),
        (
            "jar_minecraft_cliente_valido",
            minecraft_jar_client_marker_ok,
        ),
        ("jar_minecraft_sha1", minecraft_jar_sha1_ok),
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
        ("runtime_sin_archivos_corruptos", runtime_integrity.ok()),
        ("assets_index", !plan.asset_index.trim().is_empty()),
        (
            "assets_descargados",
            is_non_empty_dir(&Path::new(&plan.assets_dir).join("objects")),
        ),
        (
            "natives_extraidos",
            natives_dir_ready(Path::new(&plan.natives_dir)),
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
        (
            "perfil_loader_valido",
            if plan.loader == "vanilla" {
                true
            } else {
                loader_profile_chain_is_valid(plan)
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

    if !runtime_integrity.ok() {
        let formatted = runtime_integrity
            .issues
            .iter()
            .take(8)
            .map(|issue| format!("{} ({})", issue.path.display(), issue.reason))
            .collect::<Vec<_>>()
            .join("; ");
        errors.push(format!(
            "Se detectaron archivos corruptos/incompletos en libraries, versions o mods: {formatted}"
        ));
    }

    if version_jar_path.is_file() && !minecraft_jar_size_ok {
        let size = fs::metadata(&version_jar_path)
            .map(|meta| meta.len())
            .unwrap_or_default();
        errors.push(format!(
            "minecraft.jar tiene tamaño inválido ({size} bytes). Se esperaba al menos {MIN_MINECRAFT_JAR_SIZE_BYTES} bytes; ejecuta \"Reparar runtime\" para forzar una descarga limpia."
        ));
    }

    if version_jar_path.is_file() && !minecraft_jar_sha1_ok {
        if let Some(expected_sha1) = expected_client_sha1.as_deref() {
            let actual_sha1 =
                file_sha1(&version_jar_path).unwrap_or_else(|_| "desconocido".to_string());
            errors.push(format!(
                "minecraft.jar no coincide con el hash SHA1 esperado ({expected_sha1}); se obtuvo {actual_sha1}. Borra versions/<mc_version> y ejecuta \"Reparar runtime\"."
            ));
        }
    }

    if version_jar_path.is_file() && !minecraft_jar_client_marker_ok {
        errors.push(
            "minecraft.jar no contiene clases cliente válidas (Main/Minecraft). Esto suele ocurrir cuando el archivo quedó mezclado/corrupto tras una descarga fallida. Elimina versions/<mc_version> y ejecuta \"Reparar runtime\" para reinstalar la versión completa."
                .to_string(),
        );
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

fn launch_plan_matches_instance(
    instance_root: &Path,
    plan: &LaunchPlan,
    instance: &InstanceRecord,
) -> bool {
    let requested_loader = instance
        .loader_name
        .as_deref()
        .unwrap_or("vanilla")
        .trim()
        .to_lowercase();
    let plan_version = extract_or_fallback_arg(&plan.game_args, "--version", &instance.version)
        .trim()
        .to_lowercase();
    let requested_version = instance.version.trim().to_lowercase();

    let version_matches = if requested_loader == "vanilla" {
        plan_version == requested_version
    } else {
        plan_version == requested_version
            || plan_version.starts_with(&format!("{requested_version}-"))
            || plan_version.contains(&requested_version)
    };

    let loader_matches = if plan.loader == requested_loader {
        true
    } else {
        plan.loader != "vanilla" && instance_runtime_exists(instance_root, &plan.loader)
    };

    version_matches && loader_matches
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

        let conn = database_connection(&app)?;
        conn.execute("DELETE FROM instances WHERE id = ?1", params![instance_id])
            .map_err(|error| {
                format!("No se pudo eliminar la instancia de la base de datos: {error}")
            })?;

        Ok(())
    })
}

fn slugify_instance_id(input: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in input.chars() {
        let normalized = if ch.is_ascii_alphanumeric() {
            ch.to_ascii_lowercase()
        } else {
            '-'
        };
        if normalized == '-' {
            if last_dash || out.is_empty() {
                continue;
            }
            last_dash = true;
            out.push('-');
        } else {
            last_dash = false;
            out.push(normalized);
        }
    }
    out.trim_matches('-').to_string()
}

#[command]
async fn detect_minecraft_launchers() -> Result<Vec<LauncherInstallation>, String> {
    Ok(detect_minecraft_launcher_installations())
}

#[command]
async fn list_external_instances(
    app: tauri::AppHandle,
) -> Result<Vec<ExternalDetectedInstance>, String> {
    let root = launcher_root(&app)?;
    Ok(detect_external_instances(&root))
}

#[command]
async fn list_external_roots(app: tauri::AppHandle) -> Result<Vec<ManualExternalRoot>, String> {
    let root = launcher_root(&app)?;
    let cache = read_external_discovery_cache(&root);
    Ok(cache.manual_roots)
}

#[command]
async fn register_external_root(
    app: tauri::AppHandle,
    args: RegisterExternalRootArgs,
) -> Result<Vec<ManualExternalRoot>, String> {
    ensure_launcher_layout(&app)?;
    let raw = args.path.trim();
    if raw.is_empty() {
        return Err("path es requerido".to_string());
    }
    let normalized = PathBuf::from(raw);
    if !normalized.exists() || !normalized.is_dir() {
        return Err("La ruta indicada no existe o no es una carpeta".to_string());
    }

    let root = launcher_root(&app)?;
    let mut cache = read_external_discovery_cache(&root);
    let normalized_str = normalized.to_string_lossy().to_string();
    if let Some(existing) = cache
        .manual_roots
        .iter_mut()
        .find(|entry| entry.path.eq_ignore_ascii_case(&normalized_str))
    {
        existing.launcher_hint = args
            .launcher_hint
            .as_deref()
            .and_then(|value| launcher_from_hint(Some(value)));
        existing.label = args.label;
    } else {
        cache.manual_roots.push(ManualExternalRoot {
            path: normalized_str,
            launcher_hint: args
                .launcher_hint
                .as_deref()
                .and_then(|value| launcher_from_hint(Some(value))),
            label: args.label,
        });
    }
    cache.schema_version = 1;
    write_external_discovery_cache(&root, &cache)?;
    Ok(cache.manual_roots)
}

#[command]
async fn remove_external_root(
    app: tauri::AppHandle,
    args: RemoveExternalRootArgs,
) -> Result<Vec<ManualExternalRoot>, String> {
    let target = args.path.trim();
    if target.is_empty() {
        return Err("path es requerido".to_string());
    }

    let root = launcher_root(&app)?;
    let mut cache = read_external_discovery_cache(&root);
    cache
        .manual_roots
        .retain(|entry| !entry.path.eq_ignore_ascii_case(target));
    cache.schema_version = 1;
    write_external_discovery_cache(&root, &cache)?;
    Ok(cache.manual_roots)
}

#[command]
async fn import_external_instance(
    app: tauri::AppHandle,
    args: ExternalImportArgs,
) -> Result<InstanceRecord, String> {
    ensure_launcher_layout(&app)?;
    let external_id = args.external_id.trim();
    if external_id.is_empty() {
        return Err("external_id es requerido".to_string());
    }

    let root = launcher_root(&app)?;
    let external = detect_external_instances(&root)
        .into_iter()
        .find(|entry| entry.id == external_id)
        .ok_or_else(|| "No se encontró la instancia externa seleccionada".to_string())?;

    let base_id = slugify_instance_id(
        args.custom_name
            .as_deref()
            .unwrap_or(external.name.as_str()),
    );
    let instance_id = if base_id.is_empty() {
        format!("external-{}", current_unix_secs())
    } else {
        format!("external-{base_id}")
    };

    with_instance_lock(&instance_id, || {
        let instance_root = launcher_root(&app)?.join("instances").join(&instance_id);
        fs::create_dir_all(&instance_root)
            .map_err(|error| format!("No se pudo preparar carpeta de la instancia: {error}"))?;

        let record = InstanceRecord {
            id: instance_id.clone(),
            name: args
                .custom_name
                .clone()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| external.name.clone()),
            version: external.version.clone(),
            loader_name: Some(external.loader_name.to_lowercase()),
            loader_version: Some(external.loader_version.clone()),
            source_launcher: Some(external.launcher.clone()),
            source_path: Some(external.path.clone()),
            source_instance_name: Some(external.name.clone()),
            java_mode: None,
            java_path: None,
        };

        let meta = serde_json::json!({
            "id": record.id,
            "name": record.name,
            "minecraft_version": record.version,
            "modloader": record.loader_name.clone().unwrap_or_else(|| "vanilla".to_string()),
            "modloader_version": record.loader_version.clone().unwrap_or_else(|| "latest".to_string()),
            "loader": record.loader_name.clone().unwrap_or_else(|| "vanilla".to_string()),
            "loader_version": record.loader_version.clone().unwrap_or_else(|| "latest".to_string()),
            "java_version_required": JavaManager::required_major_for_minecraft_version(record.version.as_str()),
            "java": Value::Null,
            "memory_alloc": {"min": 2048, "max": 4096},
            "memory": {"min": 2048, "max": 4096},
            "game_dir": external.game_dir,
            "createdAt": current_unix_secs(),
            "external": {
                "launcher": record.source_launcher,
                "instanceName": record.source_instance_name,
                "path": record.source_path
            }
        });

        fs::write(
            instance_root.join("instance.json"),
            serde_json::to_string_pretty(&meta)
                .map_err(|error| format!("No se pudo serializar metadata externa: {error}"))?,
        )
        .map_err(|error| format!("No se pudo guardar metadata externa: {error}"))?;

        ensure_instance_layout(&instance_root)?;

        let connection = database_connection(&app)?;
        connection
            .execute(
                "INSERT OR REPLACE INTO instances (id, name, version, loader_name, loader_version, source_launcher, source_path, source_instance_name, java_mode, java_path) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    record.id,
                    record.name,
                    record.version,
                    record.loader_name,
                    record.loader_version,
                    record.source_launcher,
                    record.source_path,
                    record.source_instance_name,
                    record.java_mode,
                    record.java_path
                ],
            )
            .map_err(|error| format!("No se pudo guardar la instancia externa: {error}"))?;

        Ok(record)
    })
}

#[command]
async fn detect_installed_mods(
    app: tauri::AppHandle,
    args: InstanceCommandArgs,
) -> Result<Vec<InstalledModEntry>, String> {
    let instance_id = args.instance_id.unwrap_or_default().trim().to_string();
    if instance_id.is_empty() {
        return Err("No hay una instancia válida seleccionada para detectar mods.".to_string());
    }

    let instance_root = launcher_root(&app)?.join("instances").join(&instance_id);
    let mods_dir = instance_game_dir(&instance_root).join("mods");
    if !mods_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    let read_dir = fs::read_dir(&mods_dir)
        .map_err(|error| format!("No se pudo leer carpeta mods: {error}"))?;

    for entry in read_dir.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(ext) = path.extension().and_then(|value| value.to_str()) else {
            continue;
        };
        if !ext.eq_ignore_ascii_case("jar") {
            continue;
        }

        let metadata = fs::metadata(&path)
            .map_err(|error| format!("No se pudo leer metadata de mod: {error}"))?;
        let loader_hint = match detect_mod_loader_kind(&path) {
            ModLoaderKind::Vanilla => "vanilla",
            ModLoaderKind::Fabric => "fabric",
            ModLoaderKind::Quilt => "quilt",
            ModLoaderKind::Forge => "forge",
            ModLoaderKind::NeoForge => "neoforge",
            ModLoaderKind::Unknown => "unknown",
        }
        .to_string();

        entries.push(InstalledModEntry {
            file_name: path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_string(),
            path: path.to_string_lossy().to_string(),
            loader_hint,
            size_bytes: metadata.len(),
        });
    }

    entries.sort_by(|left, right| left.file_name.cmp(&right.file_name));
    Ok(entries)
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
    let conn = database_connection(&app)?;
    let mut stmt = conn
        .prepare("SELECT id, name, version, loader_name, loader_version, source_launcher, source_path, source_instance_name, java_mode, java_path FROM instances")
        .map_err(|error| format!("No se pudo leer instancias: {error}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(InstanceRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                version: row.get(2)?,
                loader_name: row.get(3)?,
                loader_version: row.get(4)?,
                source_launcher: row.get(5)?,
                source_path: row.get(6)?,
                source_instance_name: row.get(7)?,
                java_mode: row.get(8)?,
                java_path: row.get(9)?,
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
    let minecraft_root = instance_game_dir(instance_root);
    let canonical_root = instance_root.join("minecraft");
    let legacy_hidden_root = instance_root.join(".minecraft");

    if minecraft_root == canonical_root && legacy_hidden_root.exists() && !canonical_root.exists() {
        fs::rename(&legacy_hidden_root, &canonical_root).map_err(|error| {
            format!(
                "No se pudo migrar estructura legacy {} -> {}: {error}",
                legacy_hidden_root.display(),
                minecraft_root.display()
            )
        })?;
    } else if minecraft_root != canonical_root
        && canonical_root.exists()
        && !minecraft_root.exists()
    {
        fs::rename(&canonical_root, &minecraft_root).map_err(|error| {
            format!(
                "No se pudo migrar estructura legacy {} -> {}: {error}",
                canonical_root.display(),
                minecraft_root.display()
            )
        })?;
    }
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
    fs::create_dir_all(minecraft_root.join("resourcepacks"))
        .map_err(|error| format!("No se pudo asegurar minecraft/resourcepacks: {error}"))?;
    fs::create_dir_all(minecraft_root.join("config"))
        .map_err(|error| format!("No se pudo asegurar minecraft/config: {error}"))?;
    fs::create_dir_all(minecraft_root.join("saves"))
        .map_err(|error| format!("No se pudo asegurar minecraft/saves: {error}"))?;
    fs::create_dir_all(instance_root.join("natives"))
        .map_err(|error| format!("No se pudo asegurar natives: {error}"))?;
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

    let game_dir = instance_game_dir(instance_root);
    let loader_name = instance
        .loader_name
        .clone()
        .unwrap_or_else(|| "vanilla".to_string())
        .to_lowercase();
    let loader_version = normalized_loader_version(instance);

    let java_mode = instance
        .java_mode
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("embedded");
    let java_path = instance
        .java_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let meta = serde_json::json!({
        "id": instance.id,
        "name": instance.name,
        "minecraft_version": instance.version,
        "modloader": loader_name,
        "modloader_version": loader_version,
        "loader": instance
            .loader_name
            .clone()
            .unwrap_or_else(|| "vanilla".to_string())
            .to_lowercase(),
        "loader_version": normalized_loader_version(instance),
        "java_version_required": JavaManager::required_major_for_minecraft_version(instance.version.as_str()),
        "java": {
            "mode": java_mode,
            "path": java_path,
        },
        "memory_alloc": {"min": 2048, "max": 4096},
        "memory": {"min": 2048, "max": 4096},
        "game_dir": game_dir,
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
    let conn = database_connection(app)?;

    conn.query_row(
        "SELECT id, name, version, loader_name, loader_version, source_launcher, source_path, source_instance_name, java_mode, java_path FROM instances WHERE id = ?1",
        params![instance_id],
        |row| {
            Ok(InstanceRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                version: row.get(2)?,
                loader_name: row.get(3)?,
                loader_version: row.get(4)?,
                source_launcher: row.get(5)?,
                source_path: row.get(6)?,
                source_instance_name: row.get(7)?,
                java_mode: row.get(8)?,
                java_path: row.get(9)?,
            })
        },
    )
    .map_err(|error| format!("No se pudo obtener la instancia: {error}"))
}

#[command]
async fn create_instance(app: tauri::AppHandle, instance: InstanceRecord) -> Result<(), String> {
    let normalized = InstanceRecord {
        id: instance.id.clone(),
        name: instance.name.clone(),
        version: instance.version.clone(),
        loader_name: instance.loader_name.clone(),
        loader_version: Some(normalized_loader_version(&instance)),
        source_launcher: None,
        source_path: None,
        source_instance_name: None,
        java_mode: instance.java_mode.clone(),
        java_path: instance.java_path.clone(),
    };

    let conn = database_connection(&app)?;
    let instance_root = launcher_root(&app)?.join("instances").join(&instance.id);
    let instance_path = instance_root.display().to_string();
    let normalized_loader = instance
        .loader_name
        .as_deref()
        .unwrap_or("vanilla")
        .to_lowercase();
    let created_at = current_unix_secs() as i64;

    conn.execute(
        "INSERT OR REPLACE INTO instances (id, name, version, path, loader, created_at, loader_name, loader_version, source_launcher, source_path, source_instance_name, java_mode, java_path) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            normalized.id,
            normalized.name,
            normalized.version,
            instance_path,
            normalized_loader,
            created_at,
            normalized.loader_name,
            normalized.loader_version,
            normalized.source_launcher,
            normalized.source_path,
            normalized.source_instance_name,
            normalized.java_mode,
            normalized.java_path
        ],
    )
    .map_err(|error| format!("No se pudo crear la instancia: {error}"))?;

    ensure_instance_layout(&instance_root)?;

    write_instance_metadata(&instance_root, &normalized)?;

    Ok(())
}

#[command]
async fn update_instance(app: tauri::AppHandle, instance: InstanceRecord) -> Result<(), String> {
    let conn = database_connection(&app)?;
    conn.execute(
        "UPDATE instances SET name = ?2, version = ?3, loader_name = ?4, loader_version = ?5, java_mode = ?6, java_path = ?7 WHERE id = ?1",
        params![
            instance.id,
            instance.name,
            instance.version,
            instance.loader_name,
            Some(normalized_loader_version(&instance)),
            instance.java_mode,
            instance.java_path
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
            source_launcher: None,
            source_path: None,
            source_instance_name: None,
            java_mode: metadata
                .get("java")
                .and_then(|value| value.get("mode"))
                .and_then(Value::as_str)
                .map(str::to_string),
            java_path: metadata
                .get("java")
                .and_then(|value| value.get("path"))
                .and_then(Value::as_str)
                .map(str::to_string),
        };

        let connection = database_connection(&app)?;
        connection
            .execute(
                "INSERT OR REPLACE INTO instances (id, name, version, loader_name, loader_version, source_launcher, source_path, source_instance_name, java_mode, java_path) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    record.id,
                    record.name,
                    record.version,
                    record.loader_name,
                    record.loader_version,
                    record.source_launcher,
                    record.source_path,
                    record.source_instance_name,
                    record.java_mode,
                    record.java_path
                ],
            )
            .map_err(|error| format!("No se pudo guardar la instancia importada: {error}"))?;
        ensure_instance_layout(&instance_root)?;

        Ok(record)
    })
}

fn remove_dir_if_exists(path: &Path, removed: &mut Vec<String>) -> Result<(), String> {
    if path.exists() {
        fs::remove_dir_all(path)
            .map_err(|error| format!("No se pudo eliminar {}: {error}", path.display()))?;
        removed.push(path.to_string_lossy().to_string());
    }
    Ok(())
}

fn kill_running_minecraft_processes() -> Vec<String> {
    let mut killed = Vec::new();

    #[cfg(target_os = "windows")]
    {
        let candidates = ["javaw.exe", "java.exe", "Minecraft.exe"];
        for process in candidates {
            let output = Command::new("taskkill")
                .arg("/F")
                .arg("/IM")
                .arg(process)
                .output();
            if output.as_ref().map(|o| o.status.success()).unwrap_or(false) {
                killed.push(process.to_string());
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let output = Command::new("pkill")
            .arg("-f")
            .arg(r"net\.minecraft|minecraft|fabric-loader|forge")
            .output();
        if output.as_ref().map(|o| o.status.success()).unwrap_or(false) {
            killed.push("pkill:-f minecraft".to_string());
        }
    }

    killed
}

fn reset_instance_runtime(
    app: &tauri::AppHandle,
    instance_id: &str,
) -> Result<RuntimeRepairResult, String> {
    let instance_root = launcher_root(app)?.join("instances").join(instance_id);
    let minecraft_root = instance_game_dir(&instance_root);

    let mut removed_paths = Vec::new();
    remove_dir_if_exists(&minecraft_root.join("versions"), &mut removed_paths)?;
    remove_dir_if_exists(&minecraft_root.join("libraries"), &mut removed_paths)?;
    remove_dir_if_exists(&minecraft_root.join("assets"), &mut removed_paths)?;
    remove_dir_if_exists(&minecraft_root.join("runtime"), &mut removed_paths)?;
    remove_dir_if_exists(&minecraft_root.join("natives"), &mut removed_paths)?;
    remove_dir_if_exists(&minecraft_root.join("http_cache"), &mut removed_paths)?;
    remove_dir_if_exists(&minecraft_root.join("download_cache"), &mut removed_paths)?;
    remove_dir_if_exists(&minecraft_root.join("installers"), &mut removed_paths)?;
    remove_dir_if_exists(&instance_root.join("natives"), &mut removed_paths)?;

    // Preserve mods, saves, resourcepacks, config and any external roots.
    ensure_instance_layout(&instance_root)?;

    let partials = remove_partial_files(&minecraft_root)? + remove_partial_files(&instance_root)?;
    let killed_processes = kill_running_minecraft_processes();

    write_instance_state(
        &instance_root,
        "runtime_reset",
        serde_json::json!({
            "removedPaths": removed_paths,
            "removedPartials": partials,
            "killedProcesses": killed_processes
        }),
    );

    Ok(RuntimeRepairResult {
        removed_paths,
        removed_partial_files: partials,
        killed_processes,
    })
}

#[command]
async fn repair_everything_runtime(
    app: tauri::AppHandle,
    args: InstanceCommandArgs,
) -> Result<RuntimeRepairResult, String> {
    let instance_id = args.instance_id.unwrap_or_default().trim().to_string();
    if instance_id.is_empty() {
        return Err("No hay una instancia válida seleccionada para reparar todo.".to_string());
    }

    let result = reset_instance_runtime(&app, &instance_id)?;
    let _ = prepare_instance_runtime(&app, &instance_id, false, true, true).await?;
    Ok(result)
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
    if reinstall {
        let _ = reset_instance_runtime(app, instance_id)?;
    }

    ensure_instance_layout(&instance_root)?;

    let instance = read_instance_record(app, instance_id)?;
    ensure_instance_metadata(&instance_root, &instance)?;
    let minecraft_root = instance_game_dir(&instance_root);
    let repair_eval = crate::core::repair::evaluate_instance_repair_needs(
        minecraft_root
            .join("versions")
            .join(&instance.version)
            .join(format!("{}.json", instance.version))
            .exists(),
        minecraft_root
            .join("versions")
            .join(&instance.version)
            .join(format!("{}.jar", instance.version))
            .exists(),
    );
    if !repair_eval.ok {
        write_instance_state(
            &instance_root,
            "repair_precheck",
            serde_json::json!({"issues": repair_eval.issues}),
        );
    }

    let integrity_report = scan_runtime_integrity(&minecraft_root, Some(&instance.version));
    if !integrity_report.ok() {
        for path in &integrity_report.corrupt_files {
            let _ = fs::remove_file(path);
        }
        let integrity_details = integrity_report
            .issues
            .iter()
            .take(20)
            .map(|issue| {
                serde_json::json!({
                    "path": issue.path.to_string_lossy(),
                    "reason": issue.reason
                })
            })
            .collect::<Vec<_>>();
        write_instance_state(
            &instance_root,
            "runtime_integrity_repair",
            serde_json::json!({
                "removed": integrity_report.corrupt_files.len(),
                "issues": integrity_details
            }),
        );
    }

    let cached_plan = read_launch_plan(&instance_root).ok();
    let cached_is_usable = cached_plan
        .as_ref()
        .map(|plan| {
            launch_plan_matches_instance(&instance_root, plan, &instance)
                && launch_plan_matches_persisted_runtime(&instance_root, plan)
                && validate_launch_plan(&instance_root, plan).ok
                && validate_persisted_runtime_version(&instance_root, plan).is_ok()
                && integrity_report.ok()
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

fn parse_repair_mode(value: Option<String>) -> RepairMode {
    match value
        .unwrap_or_else(|| "inteligente".to_string())
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "completa" | "full" | "deep" => RepairMode::Completa,
        "solo_verificar" | "verify" | "check" => RepairMode::SoloVerificar,
        "solo_mods" | "mods" => RepairMode::SoloMods,
        "reinstalar_loader" | "loader" => RepairMode::ReinstalarLoader,
        "reparar_y_optimizar" | "optimize" => RepairMode::RepararYOptimizar,
        _ => RepairMode::Inteligente,
    }
}

#[command]
async fn repair_instance(
    app: tauri::AppHandle,
    args: InstanceCommandArgs,
) -> Result<RepairReport, String> {
    let instance_id = args.instance_id.unwrap_or_default().trim().to_string();
    if instance_id.is_empty() {
        return Err("No hay una instancia válida seleccionada para reparar.".to_string());
    }

    let mode = parse_repair_mode(args.repair_mode);
    let reinstall = matches!(mode, RepairMode::Completa);
    let (instance_root, instance) =
        prepare_instance_runtime(&app, &instance_id, reinstall, true, true).await?;

    write_instance_state(
        &instance_root,
        "repairing",
        serde_json::json!({"instance": instance.id, "mode": format!("{:?}", mode)}),
    );

    let minecraft_root = instance_game_dir(&instance_root);
    let summary = crate::core::repair::repair_manager::repair_instance(
        &instance.id,
        mode,
        &instance_root,
        &minecraft_root,
        &instance.version,
        instance.loader_name.as_deref(),
    )
    .await?;

    let launch_plan = read_launch_plan(&instance_root)?;
    let validation = validate_launch_plan(&instance_root, &launch_plan);
    if !validation.ok {
        return Err(format!(
            "La reparación terminó con validaciones fallidas: {}",
            validation.errors.join("; ")
        ));
    }

    write_instance_state(
        &instance_root,
        "repaired",
        serde_json::json!({
            "instance": instance.id,
            "report": summary.report,
            "message": summary.user_message,
            "checks": validation.checks,
            "warnings": validation.warnings
        }),
    );

    Ok(summary.report)
}

#[command]
async fn preflight_instance(
    app: tauri::AppHandle,
    args: InstanceCommandArgs,
) -> Result<ValidationReport, String> {
    if PREFLIGHT_RUNNING.swap(true, Ordering::SeqCst) {
        return Ok(ValidationReport {
            ok: true,
            errors: Vec::new(),
            warnings: vec![
                "Ya hay un preflight en ejecución; se omite la ejecución duplicada.".to_string(),
            ],
            checks: HashMap::new(),
        });
    }

    struct PreflightGuard;
    impl Drop for PreflightGuard {
        fn drop(&mut self) {
            PREFLIGHT_RUNNING.store(false, Ordering::SeqCst);
        }
    }
    let _preflight_guard = PreflightGuard;

    let instance_id = args.instance_id.unwrap_or_default().trim().to_string();
    if instance_id.is_empty() {
        return Err("No hay una instancia válida seleccionada para validar.".to_string());
    }

    let (instance_root, _) =
        prepare_instance_runtime(&app, &instance_id, false, true, true).await?;
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
                    "No se logró generar el plan de arranque automáticamente durante la verificación."
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

    let mut launch_repair_attempted = false;
    let mut safe_mode_attempted = false;
    let mut safe_mode_mods_result: Option<bool> = None;
    let mut version_purge_attempted = false;
    let mut previous_fingerprint: Option<String> = None;

    let (mut instance_root, mut instance) =
        prepare_instance_runtime(&app, &instance_id, false, true, true).await?;

    'launch_attempt: loop {
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
        normalize_critical_game_args(
            &mut launch_plan,
            &current_version,
            instance.loader_name.as_deref(),
            instance.loader_version.as_deref(),
        );

        let validation = validate_launch_plan(&instance_root, &launch_plan);
        if !validation.ok {
            if !launch_repair_attempted {
                launch_repair_attempted = true;
                write_instance_state(
                    &instance_root,
                    "auto_repair_runtime",
                    serde_json::json!({
                        "instance": instance.id,
                        "reason": "preflight_validation_failed",
                        "errors": validation.errors
                    }),
                );
                (instance_root, instance) =
                    prepare_instance_runtime(&app, &instance_id, true, true, true).await?;
                continue 'launch_attempt;
            }

            return Err(format!(
                "La validación previa falló: {}",
                validation.errors.join("; ")
            ));
        }

        let mut safe_mode_guard = None;
        if safe_mode_attempted && safe_mode_mods_result.is_none() {
            safe_mode_guard = ScopedModsDisable::disable(Path::new(&launch_plan.game_dir))?;
            write_instance_state(
                &instance_root,
                "launch_safe_mode",
                serde_json::json!({
                    "instance": instance.id,
                    "reason": "repeat_loader_failure",
                    "modsDisabled": safe_mode_guard.is_some()
                }),
            );
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
                let stdout_lines = read_last_lines(&stdout_path, 40);
                let stderr_excerpt = stderr_lines
                    .iter()
                    .rev()
                    .take(8)
                    .cloned()
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect::<Vec<_>>()
                    .join(
                        "
",
                    );
                write_instance_state(
                    &instance_root,
                    "crashed",
                    serde_json::json!({"exitCode": code, "stderr": stderr_excerpt}),
                );

                let mut diagnostic_lines =
                    Vec::with_capacity(stderr_lines.len() + stdout_lines.len());
                diagnostic_lines.extend(stderr_lines.iter().cloned());
                diagnostic_lines.extend(stdout_lines.iter().cloned());

                let is_loader_failure = is_loader_runtime_repair_recommended(&diagnostic_lines);
                let diagnostic = if is_loader_failure {
                    write_loader_crash_diagnostic(
                        &instance_root,
                        &launch_plan,
                        &instance,
                        code,
                        &diagnostic_lines,
                    )
                    .ok()
                } else {
                    None
                };

                let same_fingerprint = diagnostic
                    .as_ref()
                    .and_then(|item| {
                        previous_fingerprint
                            .as_ref()
                            .map(|prev| prev == &item.fingerprint)
                    })
                    .unwrap_or(false);

                if let Some(item) = diagnostic.as_ref() {
                    previous_fingerprint = Some(item.fingerprint.clone());
                }

                let debug_files = vec![
                    stderr_path.to_string_lossy().to_string(),
                    stdout_path.to_string_lossy().to_string(),
                    instance_root
                        .join("instance-state.json")
                        .to_string_lossy()
                        .to_string(),
                    instance_root
                        .join("crash-report.txt")
                        .to_string_lossy()
                        .to_string(),
                    instance_root.join("logs").to_string_lossy().to_string(),
                ];

                if is_loader_failure && !launch_repair_attempted {
                    launch_repair_attempted = true;
                    write_instance_state(
                        &instance_root,
                        "auto_repair_runtime",
                        serde_json::json!({
                            "instance": instance.id,
                            "reason": "loader_runtime_crash",
                            "exitCode": code,
                            "classification": diagnostic.as_ref().map(|value| value.classification),
                        }),
                    );
                    (instance_root, instance) =
                        prepare_instance_runtime(&app, &instance_id, true, true, true).await?;
                    continue 'launch_attempt;
                }

                if is_loader_failure && same_fingerprint && !safe_mode_attempted {
                    safe_mode_attempted = true;
                    continue 'launch_attempt;
                }

                if safe_mode_attempted && safe_mode_mods_result.is_none() {
                    if status.success() {
                        safe_mode_mods_result = Some(true);
                    } else {
                        safe_mode_mods_result = Some(false);
                    }
                }

                if is_loader_failure
                    && safe_mode_mods_result == Some(false)
                    && !version_purge_attempted
                {
                    version_purge_attempted = true;
                    purge_minecraft_version_tree(
                        Path::new(&launch_plan.game_dir),
                        &instance.version,
                    )?;
                    write_instance_state(
                        &instance_root,
                        "purge_version_runtime",
                        serde_json::json!({
                            "instance": instance.id,
                            "version": instance.version,
                            "reason": "safe_mode_failed_loader_crash"
                        }),
                    );
                    (instance_root, instance) =
                        prepare_instance_runtime(&app, &instance_id, true, true, true).await?;
                    continue 'launch_attempt;
                }

                if safe_mode_mods_result == Some(true) {
                    return Err(
                        "Diagnóstico: MOD_EARLY_BOOT_INCOMPATIBILITY. El juego inicia en modo seguro sin mods; revisa incompatibilidades o dependencias en la carpeta mods/."
                            .to_string(),
                    );
                }

                return Err(format_startup_crash_message(
                    code,
                    &stderr_lines,
                    &stdout_lines,
                    &debug_files,
                ));
            }
        }

        if let Some(mut guard) = safe_mode_guard {
            guard.restore()?;
            return Err(
                "Diagnóstico: MOD_EARLY_BOOT_INCOMPATIBILITY. El juego pudo mantenerse en ejecución en modo seguro sin mods."
                    .to_string(),
            );
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

        break Ok(LaunchInstanceResult { pid });
    }
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
async fn curseforge_scan_fingerprints(mods_dir: String) -> Result<FingerprintScanResult, String> {
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

    let api_key = resolve_curseforge_api_key(None)?;
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
) -> Result<CurseforgeDownloadResolution, String> {
    let api_key = resolve_curseforge_api_key(None)?;
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
    expected_sha1: Option<String>,
    expected_md5: Option<String>,
    mod_loader_hint: Option<String>,
) -> Result<String, String> {
    let id = instance_id.trim();
    if id.is_empty() {
        return Err("instance_id es requerido".to_string());
    }

    let safe_name = crate::core::mods::normalize_mod_file_name(&file_name, "mod.jar");
    if safe_name.is_empty() {
        return Err("Nombre de archivo inválido".to_string());
    }

    let instance_root = launcher_root(&app)?.join("instances").join(id);
    let mods_dir = instance_game_dir(&instance_root).join("mods");
    fs::create_dir_all(&mods_dir)
        .map_err(|error| format!("No se pudo crear carpeta mods: {error}"))?;

    let mut effective_name = safe_name.to_string();
    if !effective_name.contains('.') {
        let from_url = url
            .split('?')
            .next()
            .and_then(|value| value.rsplit('/').next())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("mod.jar");
        effective_name = from_url.to_string();
    }

    let target = mods_dir.join(&effective_name);
    let instance = read_instance_record(&app, id)?;
    let loader_name = instance.loader_name.as_deref().unwrap_or("vanilla");
    crate::core::mods::validate_mod_loader_compatibility(loader_name, mod_loader_hint.as_deref())?;

    let tuning = resolve_network_tuning(Some(&load_config(app.clone()).await?));
    write_instance_state(
        &instance_root,
        "preflight",
        serde_json::json!({
            "step": "mod_download",
            "url": url.trim(),
            "endpoint": download_routes::endpoint_label(url.trim()),
            "expectedSha1": expected_sha1,
            "expectedMd5": expected_md5
        }),
    );
    let integrity = download_to(
        url.trim(),
        &target,
        &tuning,
        expected_sha1.as_deref(),
        expected_md5.as_deref(),
    )
    .await
    .map_err(|error| {
        format!(
            "No se pudo instalar el mod {} desde {}: {error}",
            effective_name,
            url.trim()
        )
    })?;

    if !is_valid_zip_stream(&target) {
        let _ = fs::remove_file(&target);
        return Err(format!(
            "El archivo descargado para {} no es un JAR/ZIP válido. URL: {}",
            effective_name,
            url.trim()
        ));
    }

    write_instance_state(
        &instance_root,
        "mod_installed",
        serde_json::json!({
            "instanceId": id,
            "file": effective_name,
            "target": target.to_string_lossy().to_string(),
            "url": url.trim(),
            "endpoint": download_routes::endpoint_label(url.trim()),
            "sha1": integrity.actual_sha1,
            "md5": integrity.actual_md5
        }),
    );

    write_instance_state(
        &instance_root,
        "launching",
        serde_json::json!({
            "step": "mod_integrity_verified",
            "file": effective_name
        }),
    );

    Ok(target.to_string_lossy().to_string())
}

#[command]
async fn curseforge_v1_get(
    path: String,
    query: Option<std::collections::HashMap<String, String>>,
    api_key: Option<String>,
) -> Result<Value, String> {
    let normalized = path.trim();
    if normalized.is_empty() || !normalized.starts_with('/') {
        return Err(
            "Ruta inválida para CurseForge API. Usa formato /v1/... interno como /mods/search"
                .to_string(),
        );
    }

    let api_key = resolve_curseforge_api_key(api_key.as_deref())?;
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

    let instance_root = launcher_root(&app)?.join("instances").join(&instance_id);
    let mut target = instance_root.clone();
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

            if trimmed.starts_with("minecraft/") || trimmed == "minecraft" {
                let game_dir = instance_game_dir(&instance_root);
                let relative = trimmed.strip_prefix("minecraft/").unwrap_or("");
                target = if relative.is_empty() {
                    game_dir
                } else {
                    game_dir.join(relative)
                };
            } else {
                target = target.join(sub_path);
            }
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
            launcher_factory_reset,
            append_log,
            list_instances,
            detect_minecraft_launchers,
            list_external_instances,
            list_external_roots,
            register_external_root,
            remove_external_root,
            import_external_instance,
            detect_installed_mods,
            list_java_runtimes,
            resolve_java_for_minecraft,
            create_instance,
            update_instance,
            export_instance,
            import_instance,
            delete_instance,
            repair_instance,
            repair_everything_runtime,
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
    fn is_windows_access_denied_detects_error_code_5() {
        let denied = std::io::Error::from_raw_os_error(5);
        if cfg!(target_os = "windows") {
            assert!(is_windows_access_denied(&denied));
        } else {
            assert!(!is_windows_access_denied(&denied));
        }
    }

    #[test]
    fn access_denied_hint_mentions_windows_block_when_applicable() {
        let denied = std::io::Error::from_raw_os_error(5);
        let message = access_denied_hint(
            Path::new("C:/tmp/demo.jar"),
            "mover temporal a destino",
            &denied,
        );

        if cfg!(target_os = "windows") {
            assert!(message.contains("Windows bloqueó"));
            assert!(message.contains("Cierra Java/Minecraft"));
        } else {
            assert!(message.contains("No se pudo mover temporal a destino"));
        }
    }

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
    fn java_major_mapping_matches_supported_ranges() {
        assert_eq!(
            JavaManager::required_major_for_minecraft_version("1.16.5"),
            8
        );
        assert_eq!(
            JavaManager::required_major_for_minecraft_version("1.17.1"),
            17
        );
        assert_eq!(
            JavaManager::required_major_for_minecraft_version("1.20.4"),
            17
        );
        assert_eq!(
            JavaManager::required_major_for_minecraft_version("1.20.5"),
            21
        );
        assert_eq!(
            JavaManager::required_major_for_minecraft_version("1.20.6"),
            21
        );
        assert_eq!(
            JavaManager::required_major_for_minecraft_version("1.21.1"),
            21
        );
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
    fn classpath_loader_detection_normalizes_windows_separators() {
        let entries = vec![
            r"C:\libs\cpw\mods\bootstraplauncher\1.1.2\bootstraplauncher-1.1.2.jar".to_string(),
            r"C:\libs\net\minecraftforge\fmlloader\1.20.1-47.3.0\fmlloader.jar".to_string(),
        ];

        assert!(classpath_has_loader_runtime("forge", &entries));
    }
    #[test]
    fn classpath_loader_detection_accepts_legacy_forge_runtime() {
        let entries = vec![
            "/home/user/.minecraft/libraries/net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar".to_string(),
            "/home/user/.minecraft/libraries/net/minecraftforge/forge/1.12.2-14.23.5.2860/forge-1.12.2-14.23.5.2860.jar".to_string(),
        ];

        assert!(classpath_has_loader_runtime("forge", &entries));
    }

    #[test]
    fn classpath_loader_detection_accepts_modlauncher_based_forge_runtime() {
        let entries = vec![
            "/home/user/.minecraft/libraries/cpw/mods/modlauncher/10.0.9/modlauncher-10.0.9.jar".to_string(),
            "/home/user/.minecraft/libraries/net/minecraftforge/forge/1.20.1-47.3.0/forge-1.20.1-47.3.0-client.jar".to_string(),
        ];

        assert!(classpath_has_loader_runtime("forge", &entries));
    }

    #[test]
    fn resolve_minecraft_client_jar_path_falls_back_to_game_version_jar() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("epoch")
            .as_nanos();
        let base = std::env::temp_dir().join(format!("frutistudio-test-jar-path-{unique}"));
        let game_dir = base.join("game");
        let version_dir = game_dir.join("versions").join("1.21.4");
        let version_json = version_dir.join("runtime-profile.json");
        let version_jar = version_dir.join("1.21.4.jar");

        fs::create_dir_all(&version_dir).expect("version dir");
        fs::write(&version_json, "{}\n").expect("version json");
        fs::write(&version_jar, b"fake-jar").expect("version jar");

        let plan = LaunchPlan {
            java_path: "java".to_string(),
            java_args: vec!["-Xms1G".to_string(), "-Xmx2G".to_string()],
            game_args: vec![
                "--username".to_string(),
                "Steve".to_string(),
                "--version".to_string(),
                "1.21.4".to_string(),
            ],
            main_class: "net.minecraft.client.main.Main".to_string(),
            classpath_entries: vec![],
            classpath_separator: if cfg!(target_os = "windows") {
                ";".to_string()
            } else {
                ":".to_string()
            },
            game_dir: game_dir.to_string_lossy().to_string(),
            assets_dir: game_dir.join("assets").to_string_lossy().to_string(),
            libraries_dir: game_dir.join("libraries").to_string_lossy().to_string(),
            natives_dir: game_dir.join("natives").to_string_lossy().to_string(),
            version_json: version_json.to_string_lossy().to_string(),
            asset_index: "19".to_string(),
            required_java_major: 17,
            resolved_java_major: 17,
            loader: "fabric".to_string(),
            loader_profile_resolved: true,
            auth: LaunchAuth {
                username: "Steve".to_string(),
                uuid: "uuid".to_string(),
                access_token: "token".to_string(),
                user_type: "offline".to_string(),
            },
            env: HashMap::new(),
        };

        let resolved = resolve_minecraft_client_jar_path(&plan);
        assert_eq!(resolved, version_jar);

        fs::remove_dir_all(base).expect("cleanup");
    }

    #[test]
    fn validate_launch_plan_accepts_existing_empty_natives_dir() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("epoch")
            .as_nanos();
        let base = std::env::temp_dir().join(format!("frutistudio-test-{unique}"));
        let instance_root = base.join("instance");
        let game_dir = base.join("game");
        let assets_dir = game_dir.join("assets");
        let assets_objects = assets_dir.join("objects");
        let libraries_dir = game_dir.join("libraries");
        let natives_dir = game_dir.join("natives");
        let version_dir = game_dir.join("versions").join("1.21.4");
        let version_json = version_dir.join("1.21.4.json");
        let version_jar = version_dir.join("1.21.4.jar");
        let launch_plan_path = instance_root.join("launch-plan.json");
        let launch_command_path = instance_root.join("launch-command.txt");

        fs::create_dir_all(&instance_root).expect("instance root");
        fs::create_dir_all(&assets_objects).expect("assets objects");
        fs::create_dir_all(&libraries_dir).expect("libraries dir");
        fs::create_dir_all(&natives_dir).expect("natives dir");
        fs::create_dir_all(&version_dir).expect("version dir");
        fs::create_dir_all(game_dir.join("mods")).expect("mods dir");
        fs::create_dir_all(game_dir.join("crash-reports")).expect("crash reports dir");

        fs::write(instance_root.join("instance.json"), "{}\n").expect("instance metadata");
        fs::write(&version_json, "{\"id\":\"1.21.4\"}\n").expect("version json");
        fs::write(&version_jar, b"jar").expect("version jar");
        fs::write(&launch_plan_path, "{}\n").expect("launch plan");
        fs::write(&launch_command_path, "java\n").expect("launch command");

        let plan = LaunchPlan {
            java_path: "java".to_string(),
            java_args: vec!["-Xms1G".to_string(), "-Xmx2G".to_string()],
            game_args: vec!["--username".to_string(), "Steve".to_string()],
            main_class: "net.minecraft.client.main.Main".to_string(),
            classpath_entries: vec![version_jar.to_string_lossy().to_string()],
            classpath_separator: if cfg!(target_os = "windows") {
                ";".to_string()
            } else {
                ":".to_string()
            },
            game_dir: game_dir.to_string_lossy().to_string(),
            assets_dir: assets_dir.to_string_lossy().to_string(),
            libraries_dir: libraries_dir.to_string_lossy().to_string(),
            natives_dir: natives_dir.to_string_lossy().to_string(),
            version_json: version_json.to_string_lossy().to_string(),
            asset_index: "19".to_string(),
            required_java_major: 17,
            resolved_java_major: 17,
            loader: "vanilla".to_string(),
            loader_profile_resolved: true,
            auth: LaunchAuth {
                username: "Steve".to_string(),
                uuid: "uuid".to_string(),
                access_token: "token".to_string(),
                user_type: "offline".to_string(),
            },
            env: HashMap::from([(
                "MINECRAFT_LAUNCHER_BRAND".to_string(),
                "FrutiLauncher".to_string(),
            )]),
        };

        let report = validate_launch_plan(&instance_root, &plan);
        assert!(
            *report
                .checks
                .get("natives_extraidos")
                .expect("check natives_extraidos"),
            "Se esperaba natives_extraidos=true cuando existe el directorio de natives"
        );

        fs::remove_dir_all(base).expect("cleanup");
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
    fn expected_forge_like_profile_ids_include_forge_variants() {
        let candidates = expected_forge_like_profile_ids("forge", "1.21.4", "1.21.4-54.1.8");
        assert!(candidates.contains(&"1.21.4-54.1.8".to_string()));
        assert!(candidates.contains(&"1.21.4-forge-54.1.8".to_string()));
    }

    #[test]
    fn expected_forge_like_profile_ids_include_neoforge_variants() {
        let candidates = expected_forge_like_profile_ids("neoforge", "1.21.1", "21.1.128");
        assert!(candidates.contains(&"21.1.128".to_string()));
        assert!(candidates.contains(&"1.21.1-neoforge-21.1.128".to_string()));
    }

    #[test]
    fn resolve_loader_profile_json_falls_back_to_discovered_forge_profile_when_loader_version_is_latest(
    ) {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("epoch")
            .as_nanos();
        let minecraft_root =
            std::env::temp_dir().join(format!("frutistudio-forge-runtime-{unique}"));
        let versions_dir = minecraft_root.join("versions");
        let base_id = "1.21.1";
        let profile_id = "1.21.1-forge-54.1.8";

        fs::create_dir_all(versions_dir.join(base_id)).expect("base dir");
        fs::create_dir_all(versions_dir.join(profile_id)).expect("loader dir");

        fs::write(
            versions_dir.join(base_id).join(format!("{base_id}.json")),
            serde_json::to_string_pretty(&serde_json::json!({
                "id": base_id,
                "mainClass": "net.minecraft.client.main.Main",
                "libraries": [{"name": "base"}]
            }))
            .expect("base json"),
        )
        .expect("write base json");

        fs::write(
            versions_dir
                .join(profile_id)
                .join(format!("{profile_id}.json")),
            serde_json::to_string_pretty(&serde_json::json!({
                "id": profile_id,
                "inheritsFrom": base_id,
                "mainClass": "cpw.mods.bootstraplauncher.BootstrapLauncher",
                "libraries": [{"name": "net.minecraftforge:forge:1.21.1-54.1.8"}]
            }))
            .expect("profile json"),
        )
        .expect("write profile json");

        let base_version = serde_json::json!({
            "id": base_id,
            "mainClass": "net.minecraft.client.main.Main",
            "libraries": [{"name": "base"}]
        });

        let resolved = resolve_loader_profile_json(
            &minecraft_root,
            base_id,
            "forge",
            Some("latest"),
            &base_version,
        )
        .expect("resolved forge profile");

        assert_eq!(
            resolved.get("mainClass").and_then(Value::as_str),
            Some("cpw.mods.bootstraplauncher.BootstrapLauncher")
        );
        assert_eq!(
            resolved
                .get("libraries")
                .and_then(Value::as_array)
                .map(|entries| entries.len()),
            Some(2)
        );

        fs::remove_dir_all(minecraft_root).expect("cleanup");
    }

    #[test]
    fn maven_path_resolves_classifier_coordinates() {
        let path = maven_path("net.neoforged:neoforge:21.1.128:client")
            .expect("maven coordinates with classifier");
        assert_eq!(
            path,
            PathBuf::from("net/neoforged/neoforge/21.1.128/neoforge-21.1.128-client.jar")
        );
    }

    #[test]
    fn maven_path_resolves_at_extension_coordinates() {
        let path = maven_path("com.example:demo:1.0.0:api@zip")
            .expect("maven coordinates with @extension");
        assert_eq!(
            path,
            PathBuf::from("com/example/demo/1.0.0/demo-1.0.0-api.zip")
        );
    }

    #[test]
    fn maven_path_rejects_invalid_coordinate_arity() {
        assert!(maven_path("too:many:segments:for:one:artifact").is_none());
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

    #[test]
    fn neoforge_channel_uses_minor_and_patch() {
        assert_eq!(neoforge_channel_for_minecraft("1.21.1"), "21.1.");
        assert_eq!(neoforge_channel_for_minecraft("1.20"), "20.0.");
    }

    #[test]
    fn compare_numeric_versions_orders_semver_like_strings() {
        assert_eq!(
            compare_numeric_versions("21.1.100", "21.1.200"),
            std::cmp::Ordering::Less
        );
        assert_eq!(
            compare_numeric_versions("21.1.200", "21.1.100"),
            std::cmp::Ordering::Greater
        );
        assert_eq!(
            compare_numeric_versions("21.1.218", "21.1.218"),
            std::cmp::Ordering::Equal
        );
    }

    #[test]
    fn classify_loader_failure_detects_corrupt_jar() {
        let plan = LaunchPlan {
            java_path: "java".to_string(),
            java_args: vec![],
            game_args: vec![],
            main_class: "net.fabricmc.loader.launch.knot.KnotClient".to_string(),
            classpath_entries: vec![],
            classpath_separator: ":".to_string(),
            game_dir: "/tmp".to_string(),
            assets_dir: "/tmp/assets".to_string(),
            libraries_dir: "/tmp/libraries".to_string(),
            natives_dir: "/tmp/natives".to_string(),
            version_json: "/tmp/version.json".to_string(),
            asset_index: "1.21.1".to_string(),
            required_java_major: 17,
            resolved_java_major: 17,
            loader: "fabric".to_string(),
            loader_profile_resolved: true,
            auth: LaunchAuth {
                username: "dev".to_string(),
                uuid: "00000000000000000000000000000000".to_string(),
                access_token: "0".to_string(),
                user_type: "offline".to_string(),
            },
            env: HashMap::new(),
        };

        let jar_validation = MinecraftJarValidation {
            ok: false,
            reason: Some("broken".to_string()),
        };
        let result = classify_loader_failure(&plan, &[], &jar_validation);
        assert_eq!(result, StartupFailureClassification::CorruptMinecraftJar);
    }

    #[test]
    fn classify_loader_failure_detects_loader_profile_mismatch() {
        let mut plan = LaunchPlan {
            java_path: "java".to_string(),
            java_args: vec![],
            game_args: vec![],
            main_class: "net.minecraft.client.main.Main".to_string(),
            classpath_entries: vec![],
            classpath_separator: ":".to_string(),
            game_dir: "/tmp".to_string(),
            assets_dir: "/tmp/assets".to_string(),
            libraries_dir: "/tmp/libraries".to_string(),
            natives_dir: "/tmp/natives".to_string(),
            version_json: "/tmp/version.json".to_string(),
            asset_index: "1.21.1".to_string(),
            required_java_major: 17,
            resolved_java_major: 17,
            loader: "fabric".to_string(),
            loader_profile_resolved: true,
            auth: LaunchAuth {
                username: "dev".to_string(),
                uuid: "00000000000000000000000000000000".to_string(),
                access_token: "0".to_string(),
                user_type: "offline".to_string(),
            },
            env: HashMap::new(),
        };

        let jar_validation = MinecraftJarValidation {
            ok: true,
            reason: None,
        };
        let result = classify_loader_failure(&plan, &[], &jar_validation);
        assert_eq!(result, StartupFailureClassification::LoaderProfileMismatch);

        plan.main_class = "net.fabricmc.loader.launch.knot.KnotClient".to_string();
        let lines = vec![
            "Could not find or load main class net.fabricmc.loader.launch.knot.KnotClient"
                .to_string(),
        ];
        let result = classify_loader_failure(&plan, &lines, &jar_validation);
        assert_eq!(result, StartupFailureClassification::LoaderProfileMismatch);
    }

    #[test]
    fn scoped_mods_disable_restores_mods_folder() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("epoch")
            .as_nanos();
        let game_dir = std::env::temp_dir().join(format!("frutistudio-safe-mode-{unique}"));
        let mods_dir = game_dir.join("mods");
        fs::create_dir_all(&mods_dir).expect("mods dir");
        fs::write(mods_dir.join("marker.txt"), b"ok").expect("marker");

        let mut guard = ScopedModsDisable::disable(&game_dir)
            .expect("disable ok")
            .expect("guard present");
        assert!(!mods_dir.exists());
        let disabled_count = game_dir
            .read_dir()
            .expect("read")
            .flatten()
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("mods.disabled.")
            })
            .count();
        assert_eq!(disabled_count, 1);

        guard.restore().expect("restore");
        assert!(mods_dir.exists());
        assert!(mods_dir.join("marker.txt").exists());

        fs::remove_dir_all(game_dir).expect("cleanup");
    }

    #[test]
    fn startup_crash_hint_detects_tinyremapper_zip_failures() {
        let stderr_lines = vec![
            "Exception in thread \"main\" java.util.zip.ZipException: zip END header not found"
                .to_string(),
            "at net.fabricmc.tinyremapper.TinyRemapper.readFile(TinyRemapper.java:311)".to_string(),
        ];

        let hint = startup_crash_hint(&stderr_lines).expect("hint");
        assert!(hint.contains("Diagnóstico Fabric"));
    }

    #[test]
    fn format_startup_crash_message_includes_hint_and_excerpt() {
        let stderr_lines = vec![
            "at net.fabricmc.tinyremapper.TinyRemapper$1$1.call(TinyRemapper.java:281)"
                .to_string(),
            "at java.base/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1144)"
                .to_string(),
            "at java.base/java.lang.Thread.run(Thread.java:1583)".to_string(),
        ];

        let message = format_startup_crash_message(1, &stderr_lines, &[], &[]);
        assert!(message.contains("Diagnóstico Fabric"));
        assert!(message.contains("Últimas líneas"));
    }

    #[test]
    fn startup_crash_hint_detects_mcversionlookup_stacktrace() {
        let stderr_lines = vec![
            "at org.objectweb.asm.ClassReader.<init>(ClassReader.java:177)".to_string(),
            "at net.fabricmc.loader.minecraft.McVersionLookup.fromAnalyzer(McVersionLookup.java:150)"
                .to_string(),
            "at net.fabricmc.loader.game.MinecraftGameProvider.locateGame(MinecraftGameProvider.java:148)"
                .to_string(),
            "at net.fabricmc.loader.launch.knot.Knot.init(Knot.java:82)".to_string(),
            "at net.fabricmc.loader.launch.knot.KnotClient.main(KnotClient.java:26)".to_string(),
        ];

        let hint = startup_crash_hint(&stderr_lines).expect("hint");
        assert!(hint.contains("Diagnóstico loader"));
        assert!(hint.contains("versions/<mc_version>"));
    }

    #[test]
    fn startup_crash_hint_detects_loader_class_metadata_read_failure() {
        let stderr_lines = vec![
            "java.lang.RuntimeException: Failed to read class-file metadata from minecraft.jar"
                .to_string(),
            "at net.fabricmc.loader.minecraft.McVersionLookup.getVersion(McVersionLookup.java:93)"
                .to_string(),
        ];

        let hint = startup_crash_hint(&stderr_lines).expect("hint");
        assert!(hint.contains("Diagnóstico loader"));
    }

    #[test]
    fn format_startup_crash_message_uses_stdout_for_loader_hint_when_stderr_is_empty() {
        let stdout_lines = vec![
            "at org.objectweb.asm.ClassReader.<init>(ClassReader.java:177)".to_string(),
            "at net.fabricmc.loader.minecraft.McVersionLookup.fromAnalyzer(McVersionLookup.java:150)"
                .to_string(),
        ];

        let message = format_startup_crash_message(1, &[], &stdout_lines, &[]);
        assert!(message.contains("Diagnóstico loader"));
        assert!(message.contains("Últimas líneas"));
    }

    #[test]
    fn startup_crash_hint_detects_java_class_version_mismatch() {
        let stderr_lines = vec![
            "Error: LinkageError occurred while loading main class net.minecraft.client.main.Main"
                .to_string(),
            "java.lang.UnsupportedClassVersionError: net/minecraft/client/main/Main has been compiled by a more recent version of the Java Runtime (class file version 65.0), this version of the Java Runtime only recognizes class file versions up to 61.0"
                .to_string(),
        ];

        let hint = startup_crash_hint(&stderr_lines).expect("hint");
        assert!(hint.contains("requiere Java 21"));
        assert!(hint.contains("usando Java 17"));
    }

    #[test]
    fn scan_runtime_integrity_flags_partials_and_tiny_archives() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("epoch")
            .as_nanos();
        let game_dir = std::env::temp_dir().join(format!("frutistudio-integrity-{unique}"));
        let libraries_dir = game_dir.join("libraries");
        let versions_dir = game_dir.join("versions").join("1.21.4");
        fs::create_dir_all(&libraries_dir).expect("libraries dir");
        fs::create_dir_all(&versions_dir).expect("versions dir");

        fs::write(libraries_dir.join("broken.jar.part"), b"partial").expect("partial");
        fs::write(versions_dir.join("1.21.4.jar"), b"small").expect("tiny jar");

        let report = scan_runtime_integrity(&game_dir, Some("1.21.1"));
        assert!(!report.ok());
        assert!(!report.corrupt_files.is_empty());

        fs::remove_dir_all(game_dir).expect("cleanup");
    }

    #[test]
    fn scan_runtime_integrity_accepts_valid_mod_archive() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("epoch")
            .as_nanos();
        let game_dir = std::env::temp_dir().join(format!("frutistudio-integrity-ok-{unique}"));
        let mods_dir = game_dir.join("mods");
        fs::create_dir_all(&mods_dir).expect("mods dir");

        let mod_path = mods_dir.join("valid.jar");
        let file = fs::File::create(&mod_path).expect("mod jar");
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        zip.start_file("fabric.mod.json", options)
            .expect("zip start file");
        let large_payload = "x".repeat(2048);
        zip.write_all(large_payload.as_bytes())
            .expect("zip write metadata");
        zip.finish().expect("zip finish");

        let report = scan_runtime_integrity(&game_dir, Some("1.21.1"));
        assert!(report.ok());

        fs::remove_dir_all(game_dir).expect("cleanup");
    }

    #[test]
    fn scan_runtime_integrity_accepts_small_valid_library_archive() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("epoch")
            .as_nanos();
        let game_dir = std::env::temp_dir().join(format!("frutistudio-integrity-lib-ok-{unique}"));
        let library_dir = game_dir
            .join("libraries")
            .join("com")
            .join("example")
            .join("tiny")
            .join("1.0.0");
        fs::create_dir_all(&library_dir).expect("library dir");

        let jar_path = library_dir.join("tiny-1.0.0.jar");
        let file = fs::File::create(&jar_path).expect("library jar");
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        zip.start_file("META-INF/MANIFEST.MF", options)
            .expect("zip start manifest");
        zip.write_all(b"Manifest-Version: 1.0\n")
            .expect("zip write manifest");
        zip.start_file("tiny/Marker.class", options)
            .expect("zip start class");
        let payload = vec![0_u8; 900];
        zip.write_all(&payload).expect("zip write class");
        zip.finish().expect("zip finish");

        let report = scan_runtime_integrity(&game_dir, Some("1.21.1"));
        assert!(report.ok());

        fs::remove_dir_all(game_dir).expect("cleanup");
    }

    #[test]
    fn scan_runtime_integrity_flags_version_jar_without_client_markers() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("epoch")
            .as_nanos();
        let game_dir =
            std::env::temp_dir().join(format!("frutistudio-integrity-client-marker-{unique}"));
        let versions_dir = game_dir.join("versions").join("1.21.4");
        fs::create_dir_all(&versions_dir).expect("versions dir");

        let jar_path = versions_dir.join("1.21.4.jar");
        let file = fs::File::create(&jar_path).expect("jar file");
        let mut writer = ZipWriter::new(file);
        writer
            .start_file("META-INF/MANIFEST.MF", SimpleFileOptions::default())
            .expect("manifest entry");
        writer
            .write_all(b"Manifest-Version: 1.0\n")
            .expect("manifest content");
        writer.finish().expect("finish jar");

        let report = scan_runtime_integrity(&game_dir, Some("1.21.1"));
        assert!(!report.ok());
        assert!(report
            .issues
            .iter()
            .any(|issue| issue.reason.contains("sin clases cliente esperadas")));

        fs::remove_dir_all(game_dir).expect("cleanup");
    }

    #[test]
    fn instance_game_dir_defaults_to_canonical_minecraft_folder() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("epoch")
            .as_nanos();
        let instance_root =
            std::env::temp_dir().join(format!("frutistudio-instance-dir-default-{unique}"));
        fs::create_dir_all(&instance_root).expect("instance root");

        let resolved = instance_game_dir(&instance_root);
        assert_eq!(resolved, instance_root.join("minecraft"));

        fs::remove_dir_all(instance_root).expect("cleanup");
    }

    #[test]
    fn ensure_instance_layout_migrates_hidden_minecraft_into_canonical_folder() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("epoch")
            .as_nanos();
        let instance_root =
            std::env::temp_dir().join(format!("frutistudio-instance-dir-migrate-{unique}"));
        let legacy_root = instance_root.join(".minecraft");
        fs::create_dir_all(legacy_root.join("mods")).expect("legacy mods dir");
        fs::write(legacy_root.join("mods").join("marker.txt"), b"ok").expect("legacy marker");

        ensure_instance_layout(&instance_root).expect("ensure layout");

        let canonical_root = instance_root.join("minecraft");
        assert!(canonical_root.join("mods").is_dir());
        assert!(canonical_root.join("mods").join("marker.txt").is_file());
        assert!(!legacy_root.exists());

        fs::remove_dir_all(instance_root).expect("cleanup");
    }

    #[test]
    fn persist_fabric_profile_normalizes_inherits_from_and_jar_to_vanilla_version() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("epoch")
            .as_nanos();
        let minecraft_root =
            std::env::temp_dir().join(format!("frutistudio-fabric-profile-{unique}"));
        fs::create_dir_all(&minecraft_root).expect("minecraft root");

        let profile = serde_json::json!({
            "id": "fabric-loader-0.15.11-1.21.1",
            "inheritsFrom": "bogus-version",
            "jar": "fabric-loader-0.15.11-1.21.1"
        });

        let profile_id =
            persist_loader_profile_json(&minecraft_root, "1.21.1", "fabric", "0.15.11", &profile)
                .expect("persist profile");

        let profile_path = minecraft_root
            .join("versions")
            .join(&profile_id)
            .join(format!("{profile_id}.json"));
        let stored: Value =
            serde_json::from_str(&fs::read_to_string(&profile_path).expect("read profile json"))
                .expect("parse profile json");

        assert_eq!(
            stored.get("inheritsFrom").and_then(Value::as_str),
            Some("1.21.1")
        );
        assert_eq!(stored.get("jar").and_then(Value::as_str), Some("1.21.1"));
        assert_eq!(
            stored.get("mainClass").and_then(Value::as_str),
            Some("net.fabricmc.loader.launch.knot.KnotClient")
        );

        fs::remove_dir_all(minecraft_root).expect("cleanup");
    }

    #[test]
    fn persist_quilt_profile_normalizes_to_vanilla_ancestry_and_main_class() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("epoch")
            .as_nanos();
        let minecraft_root =
            std::env::temp_dir().join(format!("frutistudio-quilt-profile-{unique}"));
        fs::create_dir_all(&minecraft_root).expect("minecraft root");

        let profile = serde_json::json!({
            "id": "quilt-loader-0.27.1-1.21.1",
            "inheritsFrom": "loader-chain",
            "jar": "quilt-loader-0.27.1-1.21.1",
            "mainClass": "broken.Main"
        });

        let profile_id =
            persist_loader_profile_json(&minecraft_root, "1.21.1", "quilt", "0.27.1", &profile)
                .expect("persist profile");

        let profile_path = minecraft_root
            .join("versions")
            .join(&profile_id)
            .join(format!("{profile_id}.json"));
        let stored: Value =
            serde_json::from_str(&fs::read_to_string(&profile_path).expect("read profile json"))
                .expect("parse profile json");

        assert_eq!(
            stored.get("inheritsFrom").and_then(Value::as_str),
            Some("1.21.1")
        );
        assert_eq!(stored.get("jar").and_then(Value::as_str), Some("1.21.1"));
        assert_eq!(
            stored.get("mainClass").and_then(Value::as_str),
            Some("org.quiltmc.loader.impl.launch.knot.KnotClient")
        );

        fs::remove_dir_all(minecraft_root).expect("cleanup");
    }

    #[test]
    fn normalize_loader_profile_supports_forge_and_neoforge_main_classes() {
        let mut forge_profile = serde_json::json!({
            "inheritsFrom": "forge-loader-1.21.1",
            "jar": "forge-loader-1.21.1",
            "mainClass": "broken.Main"
        });
        normalize_loader_profile(&mut forge_profile, "1.21.1", "forge");
        assert_eq!(
            forge_profile.get("inheritsFrom").and_then(Value::as_str),
            Some("forge-loader-1.21.1")
        );
        assert_eq!(
            forge_profile.get("jar").and_then(Value::as_str),
            Some("forge-loader-1.21.1")
        );
        assert_eq!(
            forge_profile.get("launchTarget").and_then(Value::as_str),
            Some("forge_client")
        );
        assert_eq!(
            forge_profile.get("mainClass").and_then(Value::as_str),
            Some("cpw.mods.bootstraplauncher.BootstrapLauncher")
        );

        let mut neoforge_profile = serde_json::json!({
            "inheritsFrom": "neoforge-loader-1.21.1",
            "jar": "neoforge-loader-1.21.1",
            "mainClass": "broken.Main"
        });
        normalize_loader_profile(&mut neoforge_profile, "1.21.1", "neoforge");
        assert_eq!(
            neoforge_profile.get("inheritsFrom").and_then(Value::as_str),
            Some("neoforge-loader-1.21.1")
        );
        assert_eq!(
            neoforge_profile.get("jar").and_then(Value::as_str),
            Some("neoforge-loader-1.21.1")
        );
        assert_eq!(
            neoforge_profile.get("launchTarget").and_then(Value::as_str),
            Some("neoforge_client")
        );
        assert_eq!(
            neoforge_profile.get("mainClass").and_then(Value::as_str),
            Some("cpw.mods.bootstraplauncher.BootstrapLauncher")
        );
    }

    #[test]
    fn detect_loader_from_version_json_prioritizes_runtime_libraries() {
        let fabric = serde_json::json!({
            "libraries": [
                {"name": "net.fabricmc:fabric-loader:0.16.9"},
                {"name": "org.ow2.asm:asm:9.7"}
            ]
        });
        let forge = serde_json::json!({
            "libraries": [
                {"name": "net.minecraftforge:forge:1.20.1-47.3.10"}
            ]
        });
        let neoforge = serde_json::json!({
            "libraries": [
                {"name": "net.neoforged:neoforge:21.1.5"}
            ]
        });
        let vanilla = serde_json::json!({
            "libraries": [
                {"name": "com.mojang:brigadier:1.0.18"}
            ]
        });

        assert_eq!(detect_loader_from_version_json(&fabric), Some("fabric"));
        assert_eq!(detect_loader_from_version_json(&forge), Some("forge"));
        assert_eq!(detect_loader_from_version_json(&neoforge), Some("neoforge"));
        assert_eq!(detect_loader_from_version_json(&vanilla), Some("vanilla"));
    }

    #[test]
    fn parse_forge_toml_extracts_mod_id_and_dependencies() {
        let toml = r#"
[[mods]]
modId = "examplemod"

[[dependencies.examplemod]]
modId = "forge"

[[dependencies.examplemod]]
modId = "cloth_config"
"#;

        assert_eq!(
            parse_forge_mod_id_from_toml(toml).as_deref(),
            Some("examplemod")
        );
        assert_eq!(
            parse_forge_dependencies_from_toml(toml),
            vec!["forge".to_string(), "cloth_config".to_string()]
        );
    }

    #[test]
    fn parse_forge_toml_ignores_optional_dependencies() {
        let toml = r#"
[[dependencies.examplemod]]
modId="jei"
mandatory=false

[[dependencies.examplemod]]
modId="architectury"
mandatory=true
"#;

        assert_eq!(
            parse_forge_dependencies_from_toml(toml),
            vec!["architectury".to_string()]
        );
    }

    #[test]
    fn parse_quilt_dependencies_supports_objects_and_map_forms() {
        let as_array = serde_json::json!([
            {"id": "fabric-api"},
            "modmenu"
        ]);
        let as_map = serde_json::json!({
            "qsl": "*",
            "owo": ">=0.11"
        });

        assert_eq!(
            parse_quilt_dependencies(&as_array),
            vec!["fabric-api".to_string(), "modmenu".to_string()]
        );
        assert_eq!(
            parse_quilt_dependencies(&as_map),
            vec!["qsl".to_string(), "owo".to_string()]
        );
    }

    #[test]
    fn launch_plan_matches_loader_profile_id_without_forcing_rebuild() {
        let instance = InstanceRecord {
            id: "inst-1".to_string(),
            name: "Instance".to_string(),
            version: "1.21.1".to_string(),
            loader_name: Some("fabric".to_string()),
            loader_version: Some("0.16.9".to_string()),
            source_launcher: None,
            source_path: None,
            source_instance_name: None,
            java_mode: None,
            java_path: None,
        };

        let instance_root = std::env::temp_dir().join("frutistudio-launch-plan-matches");

        let plan = LaunchPlan {
            java_path: "java".to_string(),
            java_args: vec![],
            game_args: vec![
                "--version".to_string(),
                "fabric-loader-0.16.9-1.21.1".to_string(),
            ],
            main_class: "net.fabricmc.loader.launch.knot.KnotClient".to_string(),
            classpath_entries: vec![],
            classpath_separator: ":".to_string(),
            game_dir: "/tmp/game".to_string(),
            assets_dir: "/tmp/game/assets".to_string(),
            libraries_dir: "/tmp/game/libraries".to_string(),
            natives_dir: "/tmp/game/natives".to_string(),
            version_json: "/tmp/game/.runtime/version.json".to_string(),
            asset_index: "1.21".to_string(),
            required_java_major: 17,
            resolved_java_major: 17,
            loader: "fabric".to_string(),
            loader_profile_resolved: true,
            auth: LaunchAuth {
                username: "Player".to_string(),
                uuid: "uuid".to_string(),
                access_token: "0".to_string(),
                user_type: "offline".to_string(),
            },
            env: HashMap::new(),
        };

        assert!(launch_plan_matches_instance(
            &instance_root,
            &plan,
            &instance
        ));
    }
    #[test]
    fn instance_runtime_exists_rejects_corrupt_runtime_json() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("epoch")
            .as_nanos();
        let instance_root =
            std::env::temp_dir().join(format!("frutistudio-runtime-exists-corrupt-{unique}"));
        let runtime_dir = instance_root.join(".runtime");
        fs::create_dir_all(&runtime_dir).expect("runtime dir");
        fs::write(runtime_dir.join("version.json"), "{not-json").expect("write corrupt");

        assert!(!instance_runtime_exists(&instance_root, "fabric"));

        let _ = fs::remove_dir_all(&instance_root);
    }

    #[test]
    fn launch_plan_matches_persisted_runtime_detects_loader_mismatch() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("epoch")
            .as_nanos();
        let instance_root =
            std::env::temp_dir().join(format!("frutistudio-runtime-loader-mismatch-{unique}"));
        let runtime_dir = instance_root.join(".runtime");
        fs::create_dir_all(&runtime_dir).expect("runtime dir");

        let runtime_version = serde_json::json!({
            "id": "fabric-loader-0.16.9-1.21.1",
            "mainClass": "net.fabricmc.loader.launch.knot.KnotClient",
            "libraries": [{"name": "net.fabricmc:fabric-loader:0.16.9"}]
        });
        fs::write(
            runtime_dir.join("version.json"),
            serde_json::to_string_pretty(&runtime_version).expect("serialize runtime"),
        )
        .expect("write runtime version");

        let plan = LaunchPlan {
            java_path: "java".to_string(),
            java_args: vec![],
            game_args: vec!["--version".to_string(), "1.21.1".to_string()],
            main_class: "net.minecraft.client.main.Main".to_string(),
            classpath_entries: vec![],
            classpath_separator: ":".to_string(),
            game_dir: "/tmp/game".to_string(),
            assets_dir: "/tmp/game/assets".to_string(),
            libraries_dir: "/tmp/game/libraries".to_string(),
            natives_dir: "/tmp/game/natives".to_string(),
            version_json: runtime_dir
                .join("version.json")
                .to_string_lossy()
                .to_string(),
            asset_index: "1.21".to_string(),
            required_java_major: 17,
            resolved_java_major: 17,
            loader: "vanilla".to_string(),
            loader_profile_resolved: true,
            auth: LaunchAuth {
                username: "Player".to_string(),
                uuid: "uuid".to_string(),
                access_token: "0".to_string(),
                user_type: "offline".to_string(),
            },
            env: HashMap::new(),
        };

        assert!(!launch_plan_matches_persisted_runtime(
            &instance_root,
            &plan
        ));

        let _ = fs::remove_dir_all(&instance_root);
    }

    #[test]
    fn validate_persisted_runtime_version_detects_corruption() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("epoch")
            .as_nanos();
        let instance_root =
            std::env::temp_dir().join(format!("frutistudio-runtime-state-{unique}"));
        let runtime_dir = instance_root.join(".runtime");
        fs::create_dir_all(&runtime_dir).expect("runtime dir");

        let runtime_version_path = runtime_dir.join("version.json");
        let runtime_version = serde_json::json!({
            "id": "fabric-loader-0.16.9-1.21.1",
            "mainClass": "net.fabricmc.loader.launch.knot.KnotClient",
            "libraries": [{"name": "net.fabricmc:fabric-loader:0.16.9"}]
        });
        fs::write(
            &runtime_version_path,
            serde_json::to_string_pretty(&runtime_version).expect("serialize runtime json"),
        )
        .expect("write runtime version");

        let sha1 = file_sha1(&runtime_version_path).expect("sha1");
        fs::write(
            runtime_dir.join("runtime_state.json"),
            serde_json::to_string_pretty(&serde_json::json!({
                "runtimeVersionSha1": sha1,
                "mainClass": "net.fabricmc.loader.launch.knot.KnotClient"
            }))
            .expect("serialize state"),
        )
        .expect("write runtime state");

        let plan = LaunchPlan {
            java_path: "java".to_string(),
            java_args: vec![],
            game_args: vec![
                "--version".to_string(),
                "fabric-loader-0.16.9-1.21.1".to_string(),
            ],
            main_class: "net.fabricmc.loader.launch.knot.KnotClient".to_string(),
            classpath_entries: vec![],
            classpath_separator: ":".to_string(),
            game_dir: "/tmp/game".to_string(),
            assets_dir: "/tmp/game/assets".to_string(),
            libraries_dir: "/tmp/game/libraries".to_string(),
            natives_dir: "/tmp/game/natives".to_string(),
            version_json: runtime_version_path.to_string_lossy().to_string(),
            asset_index: "1.21".to_string(),
            required_java_major: 17,
            resolved_java_major: 17,
            loader: "fabric".to_string(),
            loader_profile_resolved: true,
            auth: LaunchAuth {
                username: "Player".to_string(),
                uuid: "uuid".to_string(),
                access_token: "0".to_string(),
                user_type: "offline".to_string(),
            },
            env: HashMap::new(),
        };

        assert!(validate_persisted_runtime_version(&instance_root, &plan).is_ok());

        fs::write(&runtime_version_path, "{corrupt-json").expect("corrupt runtime version");
        assert!(validate_persisted_runtime_version(&instance_root, &plan).is_err());

        fs::remove_dir_all(instance_root).expect("cleanup");
    }

    #[test]
    fn inspect_mod_jar_reads_fabric_and_quilt_metadata() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("frutistudio-mod-parse-{unique}"));
        fs::create_dir_all(&root).expect("root");

        let fabric_path = root.join("fabric.jar");
        {
            let file = fs::File::create(&fabric_path).expect("fabric jar");
            let mut zip = ZipWriter::new(file);
            let options = SimpleFileOptions::default();
            zip.start_file("fabric.mod.json", options)
                .expect("fabric start");
            zip.write_all(
                br#"{"id":"fabric_example","depends":{"minecraft":">=1.21","cloth-config":"*"}}"#,
            )
            .expect("fabric write");
            zip.finish().expect("fabric finish");
        }

        let quilt_path = root.join("quilt.jar");
        {
            let file = fs::File::create(&quilt_path).expect("quilt jar");
            let mut zip = ZipWriter::new(file);
            let options = SimpleFileOptions::default();
            zip.start_file("quilt.mod.json", options)
                .expect("quilt start");
            zip.write_all(
                br#"{"quilt_loader":{"id":"quilt_example","depends":[{"id":"minecraft"},{"id":"qsl"}]}}"#,
            )
            .expect("quilt write");
            zip.finish().expect("quilt finish");
        }

        let fabric = inspect_mod_jar(&fabric_path);
        assert_eq!(fabric.loader, ModLoaderKind::Fabric);
        assert_eq!(fabric.id.as_deref(), Some("fabric_example"));
        assert!(fabric.dependencies.contains(&"cloth-config".to_string()));

        let quilt = inspect_mod_jar(&quilt_path);
        assert_eq!(quilt.loader, ModLoaderKind::Quilt);
        assert_eq!(quilt.id.as_deref(), Some("quilt_example"));
        assert!(quilt.dependencies.contains(&"qsl".to_string()));

        fs::remove_dir_all(root).expect("cleanup");
    }
}
