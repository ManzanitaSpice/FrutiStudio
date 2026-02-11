use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::core::instance::InstanceRecord;
use crate::core::launcher::InstanceLaunchConfig;

pub(crate) fn instance_game_dir(instance_root: &Path) -> PathBuf {
    let metadata_path = instance_root.join("instance.json");
    let explicit = fs::read_to_string(&metadata_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|value| {
            value
                .get("game_dir")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
        });

    if let Some(path) = explicit {
        return path;
    }

    let canonical = instance_root.join("minecraft");
    if canonical.exists() {
        return canonical;
    }

    let legacy = instance_root.join(".minecraft");
    if legacy.exists() {
        return legacy;
    }

    canonical
}

pub(crate) fn resolve_instance_launch_config(
    instance_root: &Path,
    instance: &InstanceRecord,
) -> InstanceLaunchConfig {
    let metadata_path = instance_root.join("instance.json");
    let metadata = fs::read_to_string(&metadata_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .unwrap_or(Value::Null);

    let minecraft_version = metadata
        .get("minecraft_version")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(instance.version.as_str())
        .to_string();

    let modloader = metadata
        .get("modloader")
        .or_else(|| metadata.get("loader"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| instance.loader_name.as_deref().unwrap_or("vanilla"))
        .to_lowercase();

    let modloader_version = metadata
        .get("modloader_version")
        .or_else(|| metadata.get("loader_version"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| instance.loader_version.as_deref().unwrap_or("latest"))
        .to_string();

    let java_version_required = metadata
        .get("java_version_required")
        .and_then(Value::as_u64)
        .map(|value| value as u32);

    let java_mode = metadata
        .get("java")
        .and_then(|value| value.get("mode"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            instance
                .java_mode
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        });

    let java_path = metadata
        .get("java")
        .and_then(|value| value.get("path"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            instance
                .java_path
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        });

    InstanceLaunchConfig {
        minecraft_version,
        modloader,
        modloader_version,
        java_version_required,
        game_dir: instance_game_dir(instance_root),
        java_mode,
        java_path,
    }
}
