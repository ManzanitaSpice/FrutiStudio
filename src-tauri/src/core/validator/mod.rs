use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchValidationReport {
    pub ok: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

pub trait Validator {
    fn validate_sha1(&self) -> Result<(), String>;
    fn validate_java(&self) -> Result<(), String>;
    fn validate_version_json(&self) -> Result<(), String>;
    fn validate_classpath(&self) -> Result<(), String>;
    fn validate_main_class(&self) -> Result<(), String>;
    fn validate_access_token(&self) -> Result<(), String>;
}
