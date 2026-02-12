use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotData {
    pub instance_id: String,
    pub version: String,
    pub loader: String,
    pub mods: Vec<String>,
    pub state_hash: String,
}

impl SnapshotData {
    pub fn from_runtime(
        instance_id: &str,
        version: &str,
        loader_name: Option<&str>,
        minecraft_root: &Path,
    ) -> Result<Self, String> {
        let mods = list_mods(minecraft_root.join("mods"))?;
        let mut hasher = DefaultHasher::new();
        instance_id.hash(&mut hasher);
        version.hash(&mut hasher);
        loader_name.unwrap_or("vanilla").hash(&mut hasher);
        mods.hash(&mut hasher);

        Ok(Self {
            instance_id: instance_id.to_string(),
            version: version.to_string(),
            loader: loader_name.unwrap_or("vanilla").to_string(),
            mods,
            state_hash: format!("{:x}", hasher.finish()),
        })
    }
}

pub fn compare_or_create_snapshot(
    instance_root: &Path,
    current: &SnapshotData,
    issues: &mut Vec<String>,
) -> Result<(), String> {
    let snapshot_path = instance_root.join("instance_integrity.json");
    if !snapshot_path.exists() {
        write_snapshot(&snapshot_path, current)?;
        return Ok(());
    }

    let raw = fs::read_to_string(&snapshot_path)
        .map_err(|error| format!("No se pudo leer snapshot de integridad: {error}"))?;
    let previous: SnapshotData = serde_json::from_str(&raw)
        .map_err(|error| format!("Snapshot de integridad inválido: {error}"))?;

    if previous.state_hash != current.state_hash {
        issues.push("Inconsistencia cliente ↔ servidor o cambios de estado detectados".to_string());
        write_snapshot(&snapshot_path, current)?;
    }

    Ok(())
}

fn write_snapshot(path: &Path, data: &SnapshotData) -> Result<(), String> {
    let serialized = serde_json::to_string_pretty(data)
        .map_err(|error| format!("No se pudo serializar snapshot: {error}"))?;
    fs::write(path, serialized).map_err(|error| format!("No se pudo guardar snapshot: {error}"))
}

fn list_mods(mods_dir: PathBuf) -> Result<Vec<String>, String> {
    if !mods_dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut mods = fs::read_dir(mods_dir)
        .map_err(|error| format!("No se pudo listar mods para integridad: {error}"))?
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) == Some("jar") {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.to_string())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    mods.sort();
    Ok(mods)
}
