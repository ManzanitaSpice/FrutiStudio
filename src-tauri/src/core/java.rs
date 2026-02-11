use std::path::PathBuf;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JavaRuntime {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) version: String,
    pub(crate) major: u32,
    pub(crate) architecture: String,
    pub(crate) source: String,
    pub(crate) recommended: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JavaResolution {
    pub(crate) minecraft_version: String,
    pub(crate) required_major: u32,
    pub(crate) selected: Option<JavaRuntime>,
    pub(crate) runtimes: Vec<JavaRuntime>,
}

pub(crate) struct JavaManager {
    pub(crate) launcher_root: PathBuf,
}
