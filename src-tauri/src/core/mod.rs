pub mod auth;
pub mod downloader;
pub mod instance_runner;
pub mod java_manager;
pub mod modloader_resolver;
pub mod validator;
pub mod version_resolver;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LaunchState {
    Resolving,
    Downloading,
    Verifying,
    Ready,
    Running,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchOrchestrationOrder {
    pub steps: Vec<&'static str>,
}

impl Default for LaunchOrchestrationOrder {
    fn default() -> Self {
        Self {
            steps: vec![
                "resolve_version",
                "download_version_json",
                "resolve_modloader",
                "merge_version_json",
                "download_client_jar",
                "download_libraries",
                "download_assets",
                "resolve_java",
                "extract_natives",
                "build_launch_args",
                "run_instance",
                "monitor_runtime",
            ],
        }
    }
}
