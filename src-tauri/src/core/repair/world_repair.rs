use std::fs;
use std::path::Path;

pub fn inspect_world(
    instance_root: &Path,
    can_repair: bool,
    issues: &mut Vec<String>,
) -> Result<bool, String> {
    let saves = instance_root.join("minecraft").join("saves");
    if !saves.is_dir() {
        return Ok(false);
    }

    for world in fs::read_dir(&saves)
        .map_err(|error| format!("No se pudo leer mundos: {error}"))?
        .flatten()
    {
        let world_path = world.path();
        if !world_path.is_dir() {
            continue;
        }
        let level_dat = world_path.join("level.dat");
        if !level_dat.exists()
            || fs::metadata(&level_dat)
                .map(|meta| meta.len() == 0)
                .unwrap_or(true)
        {
            issues.push(format!(
                "Mundo con level.dat dañado o faltante: {}",
                world_path.display()
            ));
            if can_repair {
                let backup_dir = instance_root.join("world_backups");
                fs::create_dir_all(&backup_dir)
                    .map_err(|error| format!("No se pudo crear backup de mundo: {error}"))?;
                let backup_path = backup_dir.join(format!(
                    "{}_{}.zip",
                    world.file_name().to_string_lossy(),
                    (std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .unwrap_or(0))
                ));
                let _ = fs::write(backup_path, b"world-backup-placeholder");
                return Ok(true);
            }
        }
    }

    Ok(false)
}
