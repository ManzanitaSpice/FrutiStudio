use std::collections::HashSet;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use crate::core::instance::{
    ExternalDetectedInstance, ExternalDiscoveryCache, ExternalDiscoveryRoot,
};
use crate::core::launcher_discovery::detect_minecraft_launcher_installations;

fn external_discovery_cache_path(launcher_root: &Path) -> PathBuf {
    launcher_root
        .join("cache")
        .join("external-instance-index.json")
}

pub(crate) fn read_external_discovery_cache(launcher_root: &Path) -> ExternalDiscoveryCache {
    let path = external_discovery_cache_path(launcher_root);
    let Ok(raw) = fs::read_to_string(path) else {
        return ExternalDiscoveryCache {
            schema_version: 1,
            ..ExternalDiscoveryCache::default()
        };
    };
    serde_json::from_str(&raw).unwrap_or(ExternalDiscoveryCache {
        schema_version: 1,
        ..ExternalDiscoveryCache::default()
    })
}

pub(crate) fn write_external_discovery_cache(
    launcher_root: &Path,
    cache: &ExternalDiscoveryCache,
) -> Result<(), String> {
    let cache_path = external_discovery_cache_path(launcher_root);
    if let Some(parent) = cache_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!("No se pudo crear carpeta de cache de instancias externas: {error}")
        })?;
    }
    fs::write(
        &cache_path,
        serde_json::to_string_pretty(cache).map_err(|error| {
            format!("No se pudo serializar cache de instancias externas: {error}")
        })?,
    )
    .map_err(|error| format!("No se pudo escribir cache de instancias externas: {error}"))
}

pub fn launcher_from_hint(value: Option<&str>) -> Option<String> {
    let normalized = value?.trim().to_lowercase();
    if normalized.is_empty() {
        return None;
    }
    match normalized.as_str() {
        "prism" | "prismlauncher" => Some("prism".to_string()),
        "curseforge" | "cf" => Some("curseforge".to_string()),
        "modrinth" | "modrinthapp" => Some("modrinth".to_string()),
        "minecraft" | "mojang" | "vanilla" => Some("minecraft".to_string()),
        "atlauncher" | "at" => Some("atlauncher".to_string()),
        other => Some(other.to_string()),
    }
}

fn detect_launcher_signature(root: &Path) -> Option<String> {
    let checks = [
        ("prism", root.join("instance.cfg")),
        ("prism", root.join("instances").join("instance.cfg")),
        ("curseforge", root.join("minecraftinstance.json")),
        ("modrinth", root.join("profile.json")),
        ("minecraft", root.join("launcher_profiles.json")),
        ("minecraft", root.join("versions")),
        ("atlauncher", root.join("instances")),
    ];
    for (launcher, path) in checks {
        if path.exists() {
            if launcher == "minecraft" && path.file_name() == Some(OsStr::new("versions")) {
                if path.is_dir() {
                    return Some(launcher.to_string());
                }
                continue;
            }
            return Some(launcher.to_string());
        }
    }
    None
}

fn normalize_external_root(launcher: &str, root: &Path) -> PathBuf {
    if launcher == "prism" {
        if root.ends_with("instances") {
            return root
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| root.to_path_buf());
        }
        return root.to_path_buf();
    }
    if launcher == "modrinth" && root.ends_with("profiles") {
        return root
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| root.to_path_buf());
    }
    root.to_path_buf()
}

fn discover_known_launcher_roots() -> Vec<(String, PathBuf, String)> {
    let mut roots: Vec<(String, PathBuf, String)> = Vec::new();

    for installation in detect_minecraft_launcher_installations() {
        let launcher = installation.launcher;
        let source = format!("known:{}", installation.kind);
        roots.push((launcher, PathBuf::from(installation.root), source));
    }

    if let Ok(home) = std::env::var("HOME") {
        let home = PathBuf::from(home);
        roots.push((
            "prism".to_string(),
            home.join(".local").join("share").join("PrismLauncher"),
            "known:linux".to_string(),
        ));
        roots.push((
            "modrinth".to_string(),
            home.join(".local")
                .join("share")
                .join("ModrinthApp")
                .join("meta"),
            "known:linux".to_string(),
        ));
    }

    if let Ok(appdata) = std::env::var("APPDATA") {
        roots.push((
            "modrinth".to_string(),
            PathBuf::from(appdata).join("ModrinthApp").join("meta"),
            "known:windows".to_string(),
        ));
    }

    let mut dedup = HashSet::new();
    roots
        .into_iter()
        .filter(|(launcher, root, _)| {
            dedup.insert((launcher.clone(), root.to_string_lossy().to_string()))
        })
        .collect()
}

fn collect_external_scan_roots(launcher_root: &Path) -> Vec<(String, PathBuf, String)> {
    let mut roots = discover_known_launcher_roots();
    let cache = read_external_discovery_cache(launcher_root);

    for manual in cache.manual_roots {
        let path = PathBuf::from(manual.path);
        let launcher = launcher_from_hint(manual.launcher_hint.as_deref())
            .or_else(|| detect_launcher_signature(&path))
            .unwrap_or_else(|| "minecraft".to_string());
        roots.push((launcher, path, "manual".to_string()));
    }

    for cached in cache.discovered_roots {
        roots.push((
            cached.launcher,
            PathBuf::from(cached.root),
            format!("cache:{}", cached.source),
        ));
    }

    let mut dedup = HashSet::new();
    roots
        .into_iter()
        .filter(|(launcher, root, _)| {
            dedup.insert((launcher.clone(), root.to_string_lossy().to_string()))
        })
        .collect()
}

fn normalize_loader_name(value: Option<&str>) -> String {
    match value.unwrap_or("vanilla").trim().to_lowercase().as_str() {
        "forge" => "Forge".to_string(),
        "fabric" => "Fabric".to_string(),
        "quilt" => "Quilt".to_string(),
        "neoforge" => "NeoForge".to_string(),
        _ => "Vanilla".to_string(),
    }
}

fn detect_external_instances_from_root(
    launcher: &str,
    root: &Path,
) -> Vec<ExternalDetectedInstance> {
    let mut entries = Vec::new();

    if launcher == "prism" {
        let instances_root = root.join("instances");
        let Ok(read_dir) = fs::read_dir(&instances_root) else {
            return entries;
        };
        for entry in read_dir.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let mmc_pack = path.join("mmc-pack.json");
            if !mmc_pack.exists() {
                continue;
            }
            let raw = fs::read_to_string(&mmc_pack).unwrap_or_default();
            let json: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
            let name = json
                .get("name")
                .and_then(Value::as_str)
                .or_else(|| path.file_name().and_then(|v| v.to_str()))
                .unwrap_or("Prism Instance")
                .to_string();
            let version = json
                .get("components")
                .and_then(Value::as_array)
                .and_then(|components| {
                    components.iter().find_map(|component| {
                        let uid = component.get("uid")?.as_str()?;
                        if uid == "net.minecraft" {
                            component.get("version")?.as_str().map(str::to_string)
                        } else {
                            None
                        }
                    })
                })
                .unwrap_or_else(|| "latest".to_string());
            let (loader_name, loader_version) = json
                .get("components")
                .and_then(Value::as_array)
                .and_then(|components| {
                    for component in components {
                        let uid = component
                            .get("uid")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        if uid.contains("forge") || uid.contains("fabric") || uid.contains("quilt")
                        {
                            return Some((
                                normalize_loader_name(Some(uid)),
                                component
                                    .get("version")
                                    .and_then(Value::as_str)
                                    .unwrap_or("latest")
                                    .to_string(),
                            ));
                        }
                    }
                    None
                })
                .unwrap_or(("Vanilla".to_string(), "latest".to_string()));
            let game_dir = if path.join(".minecraft").is_dir() {
                path.join(".minecraft")
            } else {
                path.clone()
            };
            entries.push(ExternalDetectedInstance {
                id: format!("prism:{}", path.to_string_lossy()),
                name: name.clone(),
                version,
                launcher: "prism".to_string(),
                path: path.to_string_lossy().to_string(),
                game_dir: game_dir.to_string_lossy().to_string(),
                loader_name,
                loader_version,
                details: Some(format!("Instancia Prism: {name}")),
            });
        }
        return entries;
    }

    if launcher == "minecraft" || launcher == "curseforge" || launcher == "modrinth" {
        let versions_root = root.join("versions");
        let Ok(read_dir) = fs::read_dir(&versions_root) else {
            return entries;
        };
        for entry in read_dir.flatten() {
            let version_dir = entry.path();
            if !version_dir.is_dir() {
                continue;
            }
            let Some(version_id) = version_dir.file_name().and_then(|v| v.to_str()) else {
                continue;
            };
            let version_json = version_dir.join(format!("{version_id}.json"));
            if !version_json.exists() {
                continue;
            }
            let raw = fs::read_to_string(&version_json).unwrap_or_default();
            let json: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
            let id = json
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or(version_id)
                .to_string();
            let normalized = id.to_lowercase();
            let (loader_name, loader_version) = if normalized.contains("neoforge") {
                ("NeoForge".to_string(), "latest".to_string())
            } else if normalized.contains("forge") {
                ("Forge".to_string(), "latest".to_string())
            } else if normalized.contains("fabric") {
                ("Fabric".to_string(), "latest".to_string())
            } else if normalized.contains("quilt") {
                ("Quilt".to_string(), "latest".to_string())
            } else {
                ("Vanilla".to_string(), "latest".to_string())
            };
            entries.push(ExternalDetectedInstance {
                id: format!("{launcher}:{}", version_dir.to_string_lossy()),
                name: id.clone(),
                version: id,
                launcher: launcher.to_string(),
                path: version_dir.to_string_lossy().to_string(),
                game_dir: root.to_string_lossy().to_string(),
                loader_name,
                loader_version,
                details: Some(format!("Versión detectada en {}", root.display())),
            });
        }
    }

    entries
}

fn current_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

pub(crate) fn detect_external_instances(launcher_root: &Path) -> Vec<ExternalDetectedInstance> {
    let scan_roots = collect_external_scan_roots(launcher_root);
    let mut all = Vec::new();
    let mut discovered_roots = Vec::new();

    for (launcher, root, source) in scan_roots {
        let normalized_root = normalize_external_root(&launcher, &root);
        if !normalized_root.exists() {
            continue;
        }
        let instances = detect_external_instances_from_root(&launcher, &normalized_root);
        if !instances.is_empty() {
            discovered_roots.push(ExternalDiscoveryRoot {
                launcher: launcher.clone(),
                root: normalized_root.to_string_lossy().to_string(),
                source,
                last_seen_unix: current_unix_secs(),
            });
            all.extend(instances);
        }
    }

    let mut dedup_discovered = HashSet::new();
    discovered_roots
        .retain(|entry| dedup_discovered.insert((entry.launcher.clone(), entry.root.clone())));

    let mut cache = read_external_discovery_cache(launcher_root);
    cache.schema_version = 1;
    cache.discovered_roots = discovered_roots;
    let _ = write_external_discovery_cache(launcher_root, &cache);

    let mut dedup_instances = HashSet::new();
    all.into_iter()
        .filter(|entry| dedup_instances.insert(entry.id.clone()))
        .collect()
}
