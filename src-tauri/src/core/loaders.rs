use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoaderCompatibilityEntry {
    pub(crate) minecraft_version: String,
    pub(crate) loader: String,
    pub(crate) min_loader_version_prefix: Option<String>,
}

pub(crate) fn profile_id_for_loader(
    loader: &str,
    minecraft_version: &str,
    loader_version: &str,
) -> String {
    match loader {
        "fabric" => format!("fabric-loader-{loader_version}-{minecraft_version}"),
        "quilt" => format!("quilt-loader-{loader_version}-{minecraft_version}"),
        "forge" | "neoforge" => loader_version.to_string(),
        _ => minecraft_version.to_string(),
    }
}

pub(crate) fn validate_loader_request(loader: &str, minecraft_version: &str) -> Result<(), String> {
    if loader.trim().is_empty() {
        return Err("Loader requerido".to_string());
    }
    if minecraft_version.trim().is_empty() {
        return Err("Versión de Minecraft requerida".to_string());
    }
    Ok(())
}
