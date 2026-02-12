use std::fs;
use std::path::Path;

pub fn repair_loader(
    minecraft_root: &Path,
    loader_name: Option<&str>,
    force_reinstall: bool,
    issues: &mut Vec<String>,
) -> Result<bool, String> {
    let loader = loader_name.unwrap_or("vanilla").to_ascii_lowercase();
    if loader == "vanilla" {
        return Ok(false);
    }

    let versions_dir = minecraft_root.join("versions");
    let mut valid = false;
    if versions_dir.exists() {
        for entry in fs::read_dir(&versions_dir)
            .map_err(|error| format!("No se pudo leer versions: {error}"))?
            .flatten()
        {
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            if name.contains(&loader) {
                valid = true;
                break;
            }
        }
    }

    if valid && !force_reinstall {
        return Ok(false);
    }

    issues.push(format!(
        "Loader {} incompleto o forzado a reinstalar",
        loader
    ));
    Ok(force_reinstall || !valid)
}
