use serde::{Deserialize, Serialize};

pub const FABRIC_META_BASE: &str = "https://meta.fabricmc.net/v2";
pub const QUILT_META_BASE: &str = "https://meta.quiltmc.org/v3";
pub const FORGE_MAVEN_BASE: &str = "https://maven.minecraftforge.net";
pub const NEOFORGE_MAVEN_BASE: &str = "https://maven.neoforged.net/releases";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ModLoader {
    Vanilla,
    Fabric,
    Forge,
    NeoForge,
    Quilt,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModLoaderResolution {
    pub loader: ModLoader,
    pub minecraft_version: String,
    pub loader_version: Option<String>,
    pub profile_url: Option<String>,
}

pub trait ModLoaderResolver {
    fn resolve(
        &self,
        loader: ModLoader,
        minecraft_version: &str,
    ) -> Result<ModLoaderResolution, String>;
}
