use std::fs;
use std::path::Path;

pub fn repair_config_files(
    instance_root: &Path,
    can_repair: bool,
    issues: &mut Vec<String>,
) -> Result<bool, String> {
    let config_dir = instance_root.join("minecraft").join("config");
    if !config_dir.is_dir() {
        return Ok(false);
    }

    for entry in fs::read_dir(&config_dir)
        .map_err(|error| format!("No se pudo leer config: {error}"))?
        .flatten()
    {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let raw = fs::read_to_string(&path).unwrap_or_default();
        if serde_json::from_str::<serde_json::Value>(&raw).is_err() {
            issues.push(format!("Config JSON corrupto: {}", path.display()));
            if can_repair {
                let backup = path.with_extension("json.bak");
                let _ = fs::copy(&path, backup);
                fs::write(&path, "{}")
                    .map_err(|error| format!("No se pudo regenerar config: {error}"))?;
                return Ok(true);
            }
        }
    }

    Ok(false)
}
