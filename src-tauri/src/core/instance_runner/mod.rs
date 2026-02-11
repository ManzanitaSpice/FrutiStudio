use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchClasspath {
    pub entries: Vec<String>,
    pub separator: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchCommand {
    pub java_path: String,
    pub jvm_args: Vec<String>,
    pub main_class: String,
    pub game_args: Vec<String>,
    pub classpath: LaunchClasspath,
    pub natives_path: String,
}

pub trait InstanceRunner {
    fn launch(&self, launch_command: &LaunchCommand) -> Result<u32, String>;
}
