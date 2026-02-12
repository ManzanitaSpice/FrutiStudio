use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstanceRecord {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) version: String,
    #[serde(default)]
    pub(crate) loader_name: Option<String>,
    #[serde(default)]
    pub(crate) loader_version: Option<String>,
    #[serde(default)]
    pub(crate) source_launcher: Option<String>,
    #[serde(default)]
    pub(crate) source_path: Option<String>,
    #[serde(default)]
    pub(crate) source_instance_name: Option<String>,
    #[serde(default)]
    pub(crate) java_mode: Option<String>,
    #[serde(default)]
    pub(crate) java_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LauncherInstallation {
    pub(crate) launcher: String,
    pub(crate) root: String,
    pub(crate) kind: String,
    pub(crate) usable: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstalledModEntry {
    pub(crate) file_name: String,
    pub(crate) path: String,
    pub(crate) loader_hint: String,
    pub(crate) size_bytes: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExternalDetectedInstance {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) version: String,
    pub(crate) launcher: String,
    pub(crate) path: String,
    pub(crate) game_dir: String,
    pub(crate) loader_name: String,
    pub(crate) loader_version: String,
    pub(crate) details: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExternalDiscoveryRoot {
    pub(crate) launcher: String,
    pub(crate) root: String,
    pub(crate) source: String,
    pub(crate) last_seen_unix: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManualExternalRoot {
    pub(crate) path: String,
    pub(crate) launcher_hint: Option<String>,
    pub(crate) label: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExternalDiscoveryCache {
    pub(crate) schema_version: u32,
    pub(crate) manual_roots: Vec<ManualExternalRoot>,
    pub(crate) discovered_roots: Vec<ExternalDiscoveryRoot>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegisterExternalRootArgs {
    pub(crate) path: String,
    pub(crate) launcher_hint: Option<String>,
    pub(crate) label: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoveExternalRootArgs {
    pub(crate) path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstanceCommandArgs {
    #[serde(alias = "instance_id", alias = "id")]
    pub(crate) instance_id: Option<String>,
    #[serde(alias = "playerName")]
    pub(crate) username: Option<String>,
    #[serde(alias = "playerUuid")]
    pub(crate) uuid: Option<String>,
    #[serde(alias = "access_token")]
    pub(crate) access_token: Option<String>,
    #[serde(alias = "user_type")]
    pub(crate) user_type: Option<String>,
    #[serde(default)]
    pub(crate) java_mode: Option<String>,
    #[serde(default)]
    pub(crate) java_path: Option<String>,
    #[serde(default)]
    pub(crate) repair_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstancePathArgs {
    #[serde(alias = "instance_id", alias = "id")]
    pub(crate) instance_id: Option<String>,
    pub(crate) sub_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstanceArchiveArgs {
    #[serde(alias = "instance_id", alias = "id", alias = "uuid")]
    pub(crate) instance_id: Option<String>,
    pub(crate) archive_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExternalImportArgs {
    pub(crate) external_id: String,
    pub(crate) custom_name: Option<String>,
}
