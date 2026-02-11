use serde::{Deserialize, Serialize};

pub const MOJANG_VERSION_MANIFEST: &str =
    "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionManifestRef {
    pub id: String,
    pub kind: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedVersion {
    pub mc_version: String,
    pub version_json_url: String,
}

pub trait VersionResolver {
    fn resolve(&self, mc_version: &str) -> Result<ResolvedVersion, String>;
}
