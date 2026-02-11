use serde::{Deserialize, Serialize};

pub const MINECRAFT_SERVICES_BASE: &str = "https://api.minecraftservices.com";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchAuth {
    pub username: String,
    pub uuid: String,
    pub access_token: String,
    pub user_type: String,
}

pub trait AuthProvider {
    fn resolve_launch_auth(&self) -> Result<LaunchAuth, String>;
}
