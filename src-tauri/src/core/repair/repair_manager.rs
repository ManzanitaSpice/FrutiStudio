use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::assets_repair::repair_assets;
use super::config_repair::repair_config_files;
use super::integrity_check::{compare_or_create_snapshot, SnapshotData};
use super::libraries_repair::repair_libraries;
use super::loader_repair::repair_loader;
use super::mods_repair::repair_mods;
use super::version_repair::repair_version;
use super::world_repair::inspect_world;

pub type RepairError = String;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RepairMode {
    Inteligente,
    Completa,
    SoloVerificar,
    SoloMods,
    ReinstalarLoader,
    RepararYOptimizar,
    VerificarIntegridad,
}

impl Default for RepairMode {
    fn default() -> Self {
        Self::Inteligente
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RepairReport {
    pub libraries_fixed: u32,
    pub assets_fixed: u32,
    pub mods_fixed: u32,
    pub loader_reinstalled: bool,
    pub config_regenerated: bool,
    pub world_backed_up: bool,
    pub dependencies_fixed: u32,
    pub version_fixed: bool,
    pub checked_only: bool,
    pub optimized: bool,
    pub issues_detected: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct RepairSummary {
    pub report: RepairReport,
    pub user_message: String,
}

pub async fn repair_instance(
    instance_id: &str,
    mode: RepairMode,
    instance_root: &Path,
    minecraft_root: &Path,
    version_id: &str,
    loader_name: Option<&str>,
) -> Result<RepairSummary, RepairError> {
    if instance_id.trim().is_empty() {
        return Err("No hay una instancia válida seleccionada para reparar.".to_string());
    }

    let mut report = RepairReport {
        checked_only: mode == RepairMode::SoloVerificar,
        ..RepairReport::default()
    };

    let libraries_root = resolve_shared_libraries_root(instance_root, minecraft_root);

    if mode == RepairMode::Completa {
        wipe_runtime_dirs(minecraft_root, &mut report.issues_detected)?;
    }

    if mode == RepairMode::VerificarIntegridad {
        report.version_fixed = clear_version_json_cache(
            instance_root,
            minecraft_root,
            version_id,
            &mut report.issues_detected,
        )?;
    } else if mode == RepairMode::Inteligente {
        run_intelligent_repair(
            instance_root,
            minecraft_root,
            version_id,
            loader_name,
            &mut report,
        )?;
    } else if mode == RepairMode::SoloMods {
        let mods = repair_mods(minecraft_root, true, &mut report.issues_detected)?;
        report.mods_fixed += mods;
    } else if mode == RepairMode::ReinstalarLoader {
        report.loader_reinstalled = repair_loader(
            minecraft_root,
            loader_name,
            true,
            &mut report.issues_detected,
        )?;
    } else {
        report.version_fixed = repair_version(
            minecraft_root,
            version_id,
            mode != RepairMode::SoloVerificar,
            &mut report.issues_detected,
        )?;
        report.libraries_fixed += repair_libraries(
            &libraries_root,
            mode != RepairMode::SoloVerificar,
            &mut report.issues_detected,
        )?;
        report.assets_fixed += repair_assets(
            minecraft_root,
            mode != RepairMode::SoloVerificar,
            &mut report.issues_detected,
        )?;
        report.loader_reinstalled = repair_loader(
            minecraft_root,
            loader_name,
            mode == RepairMode::Completa || mode == RepairMode::RepararYOptimizar,
            &mut report.issues_detected,
        )?;
        report.mods_fixed += repair_mods(
            minecraft_root,
            mode != RepairMode::SoloVerificar,
            &mut report.issues_detected,
        )?;
        report.config_regenerated = repair_config_files(
            instance_root,
            mode != RepairMode::SoloVerificar,
            &mut report.issues_detected,
        )?;
        report.world_backed_up = inspect_world(
            instance_root,
            mode != RepairMode::SoloVerificar,
            &mut report.issues_detected,
        )?;
    }

    let snapshot =
        SnapshotData::from_runtime(instance_id, version_id, loader_name, minecraft_root)?;
    compare_or_create_snapshot(instance_root, &snapshot, &mut report.issues_detected)?;

    if mode == RepairMode::RepararYOptimizar {
        optimize_runtime(instance_root, minecraft_root)?;
        report.optimized = true;
    }

    let user_message = if report.issues_detected.is_empty() && !has_repairs(&report) {
        "No se encontraron problemas.".to_string()
    } else {
        format!(
            "Reparación completada\n✔ {} librerías restauradas\n✔ {} assets descargados\n✔ {} mods reparados\n{}{}{}",
            report.libraries_fixed,
            report.assets_fixed,
            report.mods_fixed,
            if report.loader_reinstalled { "✔ Loader reinstalado\n" } else { "" },
            if report.config_regenerated { "✔ Config regenerada\n" } else { "" },
            if report.world_backed_up { "✔ Backup de mundo generado" } else { "" }
        )
    };

    Ok(RepairSummary {
        report,
        user_message,
    })
}

fn run_intelligent_repair(
    instance_root: &Path,
    minecraft_root: &Path,
    version_id: &str,
    loader_name: Option<&str>,
    report: &mut RepairReport,
) -> Result<(), RepairError> {
    let mut precheck_issues = Vec::new();
    let libraries_root = resolve_shared_libraries_root(instance_root, minecraft_root);
    report.version_fixed = repair_version(minecraft_root, version_id, false, &mut precheck_issues)?;
    report.libraries_fixed += repair_libraries(&libraries_root, false, &mut precheck_issues)?;
    report.assets_fixed += repair_assets(minecraft_root, false, &mut precheck_issues)?;
    report.mods_fixed += repair_mods(minecraft_root, false, &mut precheck_issues)?;

    let joined = precheck_issues.join(" | ").to_ascii_lowercase();
    let should_repair_base = joined.contains("version")
        || joined.contains("libraries")
        || joined.contains("asset")
        || joined.contains("hash")
        || joined.contains("corrupt");
    let should_repair_mods = joined.contains("mod") || joined.contains("incompat");
    let should_repair_loader = joined.contains("loader")
        || joined.contains("forge")
        || joined.contains("fabric")
        || joined.contains("quilt")
        || joined.contains("neoforge");

    if should_repair_base {
        report.version_fixed = repair_version(
            minecraft_root,
            version_id,
            true,
            &mut report.issues_detected,
        )? || report.version_fixed;
        report.libraries_fixed +=
            repair_libraries(&libraries_root, true, &mut report.issues_detected)?;
        report.assets_fixed += repair_assets(minecraft_root, true, &mut report.issues_detected)?;
    }

    if should_repair_loader {
        report.loader_reinstalled = repair_loader(
            minecraft_root,
            loader_name,
            true,
            &mut report.issues_detected,
        )? || report.loader_reinstalled;
    }

    if should_repair_mods {
        report.mods_fixed += repair_mods(minecraft_root, true, &mut report.issues_detected)?;
    }

    report.config_regenerated =
        repair_config_files(instance_root, true, &mut report.issues_detected)?;
    report.world_backed_up = inspect_world(instance_root, true, &mut report.issues_detected)?;
    report.issues_detected.extend(precheck_issues);
    Ok(())
}

fn wipe_runtime_dirs(minecraft_root: &Path, issues: &mut Vec<String>) -> Result<(), RepairError> {
    for rel in ["libraries", "natives", "runtime", "assets"] {
        let path = minecraft_root.join(rel);
        if path.exists() {
            fs::remove_dir_all(&path).map_err(|error| {
                format!(
                    "No se pudo limpiar {} durante reparación completa: {error}",
                    path.display()
                )
            })?;
            issues.push(format!("Se limpió {} para reinstalación completa", rel));
        }
    }
    Ok(())
}

fn has_repairs(report: &RepairReport) -> bool {
    report.libraries_fixed > 0
        || report.assets_fixed > 0
        || report.mods_fixed > 0
        || report.loader_reinstalled
        || report.config_regenerated
        || report.world_backed_up
        || report.version_fixed
}

fn clear_version_json_cache(
    instance_root: &Path,
    minecraft_root: &Path,
    version_id: &str,
    issues: &mut Vec<String>,
) -> Result<bool, RepairError> {
    let mut cleared = false;

    // 1. Runtime version.json cacheado por instancia
    let runtime_json = instance_root.join(".runtime").join("version.json");
    if runtime_json.exists() {
        fs::remove_file(&runtime_json).map_err(|error| {
            format!(
                "No se pudo limpiar runtime version.json ({}): {error}",
                runtime_json.display()
            )
        })?;
        issues.push("Se eliminó cache runtime .runtime/version.json".to_string());
        cleared = true;
    }

    // 2. Version JSON oficial (versions/<mc>/<mc>.json)
    let version_json = minecraft_root
        .join("versions")
        .join(version_id)
        .join(format!("{version_id}.json"));
    if version_json.exists() {
        fs::remove_file(&version_json).map_err(|error| {
            format!(
                "No se pudo limpiar version.json ({}): {error}",
                version_json.display()
            )
        })?;
        issues.push(format!(
            "Se eliminó cache versions/{version_id}/{version_id}.json"
        ));
        cleared = true;
    }

    // 3. Launch plan y launch command cacheados (contienen rutas de libraries resueltas)
    for cached_file in [
        "launch-plan.json",
        "launch-command.txt",
        "instance_integrity.json",
    ] {
        let path = instance_root.join(cached_file);
        if path.exists() {
            let _ = fs::remove_file(&path);
            issues.push(format!("Se eliminó cache {cached_file}"));
            cleared = true;
        }
    }

    // 4. Loader profile JSONs (versions/<loader-profile>/<loader-profile>.json)
    //    Pueden contener coordenadas maven con versiones incorrectas.
    let versions_dir = minecraft_root.join("versions");
    if versions_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&versions_dir) {
            for entry in entries.flatten() {
                let dir_name = entry.file_name();
                let dir_name_str = dir_name.to_string_lossy();
                // Solo perfiles de loader que contienen la versión MC base
                if dir_name_str.contains(version_id)
                    && dir_name_str != version_id
                    && entry.path().is_dir()
                {
                    let profile_json = entry.path().join(format!("{}.json", dir_name_str));
                    if profile_json.exists() {
                        let _ = fs::remove_file(&profile_json);
                        issues.push(format!(
                            "Se eliminó perfil de loader versions/{dir_name_str}/{dir_name_str}.json"
                        ));
                        cleared = true;
                    }
                }
            }
        }
    }

    if !cleared {
        issues.push("No se encontraron JSON locales para limpiar.".to_string());
    }

    Ok(cleared)
}

fn resolve_shared_libraries_root(instance_root: &Path, minecraft_root: &Path) -> PathBuf {
    instance_root
        .parent()
        .and_then(|path| path.parent())
        .map(|root| root.join("libraries"))
        .unwrap_or_else(|| minecraft_root.join("libraries"))
}

fn optimize_runtime(instance_root: &Path, minecraft_root: &Path) -> Result<(), RepairError> {
    prune_dir(minecraft_root.join("logs"), 20)?;
    prune_dir(minecraft_root.join("crash-reports"), 20)?;
    let _ = fs::create_dir_all(instance_root.join("maintenance"));
    Ok(())
}

fn prune_dir(dir: PathBuf, keep: usize) -> Result<(), RepairError> {
    if !dir.is_dir() {
        return Ok(());
    }
    let mut entries = fs::read_dir(&dir)
        .map_err(|error| format!("No se pudo leer {}: {error}", dir.display()))?
        .flatten()
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, entry.path()))
        })
        .collect::<Vec<_>>();
    entries.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in entries.into_iter().skip(keep) {
        let _ = fs::remove_file(path);
    }
    Ok(())
}
