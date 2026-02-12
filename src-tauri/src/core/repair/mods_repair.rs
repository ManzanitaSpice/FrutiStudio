use std::fs;
use std::path::Path;

use zip::ZipArchive;

pub fn repair_mods(
    minecraft_root: &Path,
    can_repair: bool,
    issues: &mut Vec<String>,
) -> Result<u32, String> {
    let mods_dir = minecraft_root.join("mods");
    if !mods_dir.is_dir() {
        return Ok(0);
    }

    let mut fixed = 0;
    for entry in fs::read_dir(&mods_dir)
        .map_err(|error| format!("No se pudo leer carpeta de mods: {error}"))?
        .flatten()
    {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("jar") {
            continue;
        }

        let file = match fs::File::open(&path) {
            Ok(file) => file,
            Err(_) => {
                issues.push(format!("Mod inaccesible: {}", path.display()));
                continue;
            }
        };
        let mut archive = match ZipArchive::new(file) {
            Ok(archive) => archive,
            Err(_) => {
                issues.push(format!("Mod corrupto (zip inválido): {}", path.display()));
                if can_repair {
                    let _ = fs::remove_file(&path);
                    fixed += 1;
                }
                continue;
            }
        };

        let has_fabric = archive.by_name("fabric.mod.json").is_ok();
        let has_forge = archive.by_name("META-INF/mods.toml").is_ok();
        if !has_fabric && !has_forge {
            issues.push(format!("Mod sin metadata válida: {}", path.display()));
        }
    }

    Ok(fixed)
}
