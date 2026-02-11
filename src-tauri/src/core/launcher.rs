use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LaunchInstanceResult {
    pub(crate) pid: u32,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum StartupFailureClassification {
    CorruptMinecraftJar,
    LoaderProfileMismatch,
    ModEarlyBootIncompatibility,
    UnknownEarlyLoaderFailure,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoaderCrashDiagnostic {
    pub(crate) timestamp: u64,
    pub(crate) instance_id: String,
    pub(crate) version: String,
    pub(crate) loader: String,
    pub(crate) loader_version: Option<String>,
    pub(crate) main_class: String,
    pub(crate) exit_code: i32,
    pub(crate) classification: StartupFailureClassification,
    pub(crate) fingerprint: String,
    pub(crate) jar_path: String,
    pub(crate) jar_size_bytes: Option<u64>,
    pub(crate) jar_sha1: Option<String>,
    pub(crate) expected_client_sha1: Option<String>,
    pub(crate) jar_is_zip: bool,
    pub(crate) jar_has_client_markers: bool,
    pub(crate) version_json_path: String,
    pub(crate) version_json_inherits_from: Option<String>,
    pub(crate) version_json_jar: Option<String>,
    pub(crate) stack_excerpt: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeLogSnapshot {
    pub(crate) status: Option<String>,
    pub(crate) state_details: Option<Value>,
    pub(crate) state_updated_at: Option<u64>,
    pub(crate) stdout_path: Option<String>,
    pub(crate) stderr_path: Option<String>,
    pub(crate) command: Option<String>,
    pub(crate) lines: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeRepairResult {
    pub(crate) removed_paths: Vec<String>,
    pub(crate) removed_partial_files: u64,
    pub(crate) killed_processes: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LaunchPlan {
    pub(crate) java_path: String,
    pub(crate) java_args: Vec<String>,
    pub(crate) game_args: Vec<String>,
    pub(crate) main_class: String,
    pub(crate) classpath_entries: Vec<String>,
    pub(crate) classpath_separator: String,
    pub(crate) game_dir: String,
    pub(crate) assets_dir: String,
    pub(crate) libraries_dir: String,
    pub(crate) natives_dir: String,
    pub(crate) version_json: String,
    pub(crate) asset_index: String,
    #[serde(default)]
    pub(crate) required_java_major: u32,
    #[serde(default)]
    pub(crate) resolved_java_major: u32,
    pub(crate) loader: String,
    pub(crate) loader_profile_resolved: bool,
    pub(crate) auth: LaunchAuth,
    pub(crate) env: HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LaunchAuth {
    pub(crate) username: String,
    pub(crate) uuid: String,
    pub(crate) access_token: String,
    pub(crate) user_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ValidationReport {
    pub(crate) ok: bool,
    pub(crate) errors: Vec<String>,
    pub(crate) warnings: Vec<String>,
    pub(crate) checks: HashMap<String, bool>,
}

#[derive(Debug)]
pub(crate) struct MinecraftJarValidation {
    pub(crate) ok: bool,
    pub(crate) reason: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ModLoaderKind {
    Vanilla,
    Fabric,
    Quilt,
    Forge,
    NeoForge,
    Unknown,
}

#[derive(Debug, Clone)]
pub(crate) struct ModInspection {
    pub(crate) id: Option<String>,
    pub(crate) loader: ModLoaderKind,
    pub(crate) dependencies: Vec<String>,
    pub(crate) minecraft_constraint: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct InstanceLaunchConfig {
    pub(crate) minecraft_version: String,
    pub(crate) modloader: String,
    pub(crate) modloader_version: String,
    pub(crate) java_version_required: Option<u32>,
    pub(crate) game_dir: PathBuf,
    pub(crate) java_mode: Option<String>,
    pub(crate) java_path: Option<String>,
}
