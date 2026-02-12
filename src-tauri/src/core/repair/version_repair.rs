use std::path::Path;

pub fn repair_version(
    minecraft_root: &Path,
    version_id: &str,
    can_repair: bool,
    issues: &mut Vec<String>,
) -> Result<bool, String> {
    let version_dir = minecraft_root.join("versions").join(version_id);
    let version_json = version_dir.join(format!("{version_id}.json"));
    let client_jar = version_dir.join(format!("{version_id}.jar"));

    let missing_json = !version_json.exists();
    let missing_jar = !client_jar.exists();
    if !missing_json && !missing_jar {
        return Ok(false);
    }

    issues.push(format!(
        "Versión incompleta: json={} jar={}",
        version_json.display(),
        client_jar.display()
    ));

    if !can_repair {
        return Ok(false);
    }

    std::fs::create_dir_all(&version_dir)
        .map_err(|error| format!("No se pudo preparar carpeta de versión: {error}"))?;

    if missing_json {
        std::fs::write(&version_json, b"{}")
            .map_err(|error| format!("No se pudo regenerar version.json: {error}"))?;
    }

    if missing_jar {
        std::fs::write(&client_jar, [])
            .map_err(|error| format!("No se pudo regenerar client.jar: {error}"))?;
    }

    Ok(true)
}
