use serde::{Deserialize, Serialize};

pub const MINECRAFT_LIBRARIES_BASE: &str = "https://libraries.minecraft.net";
pub const MINECRAFT_ASSETS_BASE: &str = "https://resources.download.minecraft.net";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadItem {
    pub url: String,
    pub destination: String,
    pub sha1: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadConfig {
    pub max_parallel_downloads: usize,
    pub max_retries: u8,
}

pub trait Downloader {
    fn download(&self, item: &DownloadItem) -> Result<(), String>;
}
