use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use std::process::Command;

pub fn repair_libraries(
    libraries_root: &Path,
    can_repair: bool,
    issues: &mut Vec<String>,
) -> Result<u32, String> {
    if !libraries_root.exists() {
        if can_repair {
            fs::create_dir_all(&libraries_root)
                .map_err(|error| format!("No se pudo crear carpeta de librerías: {error}"))?;
            issues.push("Carpeta libraries faltante; se recreó".to_string());
            return Ok(1);
        }
        issues.push("Carpeta libraries no existe".to_string());
        return Ok(0);
    }

    let mut fixed = 0;
    let entries = walk_files(&libraries_root)?;
    for entry in entries {
        let metadata = match fs::metadata(&entry) {
            Ok(meta) => meta,
            Err(error) if error.kind() == ErrorKind::PermissionDenied => {
                issues.push(permission_denied_message(&entry));
                if can_repair {
                    attempt_unlock_windows();
                }
                continue;
            }
            Err(_) => continue,
        };
        if metadata.len() == 0 {
            issues.push(format!("Librería vacía detectada: {}", entry.display()));
            if can_repair {
                let _ = fs::remove_file(&entry);
                fixed += 1;
            }
        }
    }
    Ok(fixed)
}

fn walk_files(root: &Path) -> Result<Vec<std::path::PathBuf>, String> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(next) = stack.pop() {
        for entry in fs::read_dir(&next)
            .map_err(|error| format!("No se pudo inspeccionar {}: {error}", next.display()))?
            .flatten()
        {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().and_then(|ext| ext.to_str()) == Some("jar") {
                out.push(path);
            }
        }
    }
    Ok(out)
}

fn permission_denied_message(path: &Path) -> String {
    format!(
        "No se pudo ejecutar repair_instance: Librería {} falló: No hay permisos de escritura. Cierra procesos Java/Minecraft, ejecuta Interface como administrador y revisa antivirus/Acceso controlado a carpetas.",
        path.display()
    )
}

fn attempt_unlock_windows() {
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .args(["/F", "/IM", "java.exe"])
            .status();
        let _ = Command::new("taskkill")
            .args(["/F", "/IM", "javaw.exe"])
            .status();
    }
}
