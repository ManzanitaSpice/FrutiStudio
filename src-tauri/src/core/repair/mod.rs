pub mod assets_repair;
pub mod config_repair;
pub mod integrity_check;
pub mod libraries_repair;
pub mod loader_repair;
pub mod mods_repair;
pub mod repair_manager;
pub mod version_repair;
pub mod world_repair;

pub use repair_manager::{RepairError, RepairMode, RepairReport, RepairSummary};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepairCheckResult {
    pub(crate) ok: bool,
    pub(crate) issues: Vec<String>,
}

pub(crate) fn evaluate_instance_repair_needs(
    has_version_json: bool,
    has_client_jar: bool,
) -> RepairCheckResult {
    let mut issues = Vec::new();
    if !has_version_json {
        issues.push("Falta version JSON de la instancia".to_string());
    }
    if !has_client_jar {
        issues.push("Falta minecraft.jar de la instancia".to_string());
    }
    RepairCheckResult {
        ok: issues.is_empty(),
        issues,
    }
}
