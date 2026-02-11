use serde::{Deserialize, Serialize};

pub const ADOPTIUM_BASE: &str = "https://api.adoptium.net/v3/assets/latest";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaRuntimePolicy {
    pub mc_version_range: &'static str,
    pub java_major: u32,
}

pub const JAVA_POLICIES: [JavaRuntimePolicy; 3] = [
    JavaRuntimePolicy {
        mc_version_range: "1.20.5+",
        java_major: 21,
    },
    JavaRuntimePolicy {
        mc_version_range: "1.18-1.20.4",
        java_major: 17,
    },
    JavaRuntimePolicy {
        mc_version_range: "<=1.16.5",
        java_major: 8,
    },
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedJavaRuntime {
    pub java_path: String,
    pub java_major: u32,
}

pub trait JavaManager {
    fn resolve_runtime(&self, mc_version: &str) -> Result<ResolvedJavaRuntime, String>;
}
