pub mod asset_downloader;
pub mod auth;
pub mod config;
pub mod downloader;
pub mod external_discovery;
pub mod instance;
pub mod instance_config;
pub mod instance_runner;
pub mod java;
pub mod java_manager;
pub mod java_resolver;
pub mod launch_pipeline;
pub mod launcher;
pub mod launcher_discovery;
pub mod loader_normalizer;
pub mod modloader_resolver;
pub mod network;
pub mod runtime_manager;
pub mod validator;
pub mod version_resolver;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LaunchState {
    Idle,
    Resolving,
    Downloading,
    Verifying,
    Preparing,
    Launching,
    Running,
    Crashed,
    Finished,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchOrchestrationOrder {
    pub steps: Vec<String>,
}

impl Default for LaunchOrchestrationOrder {
    fn default() -> Self {
        Self {
            steps: vec![
                "resolve_version".to_string(),
                "download_version_json".to_string(),
                "resolve_modloader".to_string(),
                "merge_version_json".to_string(),
                "download_client_jar".to_string(),
                "download_libraries".to_string(),
                "download_assets".to_string(),
                "resolve_java".to_string(),
                "extract_natives".to_string(),
                "build_launch_args".to_string(),
                "run_instance".to_string(),
                "monitor_runtime".to_string(),
            ],
        }
    }
}
