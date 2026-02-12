use std::fs;
use std::path::Path;

pub fn repair_assets(
    minecraft_root: &Path,
    can_repair: bool,
    issues: &mut Vec<String>,
) -> Result<u32, String> {
    let indexes = minecraft_root.join("assets").join("indexes");
    if !indexes.exists() {
        issues.push("Falta assets/indexes".to_string());
        if can_repair {
            fs::create_dir_all(&indexes)
                .map_err(|error| format!("No se pudo recrear assets/indexes: {error}"))?;
            return Ok(1);
        }
    }
    Ok(0)
}
