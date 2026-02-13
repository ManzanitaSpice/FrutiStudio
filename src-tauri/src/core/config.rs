use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NetworkTuning {
    pub(crate) connect_timeout_secs: u64,
    pub(crate) request_timeout_secs: u64,
    pub(crate) retries: u8,
}

impl Default for NetworkTuning {
    fn default() -> Self {
        Self {
            connect_timeout_secs: 12,
            request_timeout_secs: 120,
            retries: 4,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppConfig {
    #[serde(alias = "base_dir")]
    pub(crate) base_dir: Option<String>,
    pub(crate) ui_scale: Option<f32>,
    pub(crate) theme: Option<String>,
    pub(crate) version: Option<u32>,
    pub(crate) telemetry_opt_in: Option<bool>,
    pub(crate) auto_updates: Option<bool>,
    pub(crate) background_downloads: Option<bool>,
    pub(crate) active_section: Option<String>,
    pub(crate) focus_mode: Option<bool>,
    pub(crate) show_verification_window: Option<bool>,
    pub(crate) never_rename_folder: Option<bool>,
    pub(crate) replace_toolbar_by_menu: Option<bool>,
    pub(crate) update_check_interval_hours: Option<u32>,
    pub(crate) mods_track_metadata: Option<bool>,
    pub(crate) mods_install_dependencies: Option<bool>,
    pub(crate) mods_suggest_pack_updates: Option<bool>,
    pub(crate) mods_check_blocked_subfolders: Option<bool>,
    pub(crate) mods_move_blocked_mods: Option<bool>,
    pub(crate) downloads_path: Option<String>,
    pub(crate) mods_path: Option<String>,
    pub(crate) icons_path: Option<String>,
    pub(crate) java_path: Option<String>,
    pub(crate) java_mode: Option<String>,
    pub(crate) minecraft_root: Option<String>,
    pub(crate) skins_path: Option<String>,
    pub(crate) explorer_filters: Option<Value>,
    pub(crate) network_tuning: Option<NetworkTuning>,
    pub(crate) pterodactyl_url: Option<String>,
    pub(crate) pterodactyl_api_key: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartupFileEntry {
    pub(crate) relative_path: String,
    pub(crate) size_bytes: u64,
}

#[derive(Debug, Serialize)]
pub(crate) struct BaseDirValidationResult {
    pub(crate) ok: bool,
    pub(crate) errors: Vec<String>,
    pub(crate) warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LauncherFactoryResetArgs {
    pub(crate) confirmation_phrase: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LauncherFactoryResetResult {
    pub(crate) cleared_roots: Vec<String>,
    pub(crate) removed_entries: Vec<String>,
}
