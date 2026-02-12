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

    if mode == RepairMode::Completa {
        wipe_runtime_dirs(minecraft_root, &mut report.issues_detected)?;
    }

    if mode == RepairMode::SoloMods {
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
            minecraft_root,
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
