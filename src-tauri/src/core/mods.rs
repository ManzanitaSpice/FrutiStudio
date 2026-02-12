use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModDownloadIntegrity {
    pub(crate) expected_sha1: Option<String>,
    pub(crate) expected_md5: Option<String>,
    pub(crate) actual_sha1: String,
    pub(crate) actual_md5: String,
}

pub(crate) fn normalize_mod_file_name(file_name: &str, fallback: &str) -> String {
    let candidate = file_name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .trim();
    if candidate.is_empty() {
        fallback.to_string()
    } else {
        candidate.to_string()
    }
}

pub(crate) fn validate_mod_loader_compatibility(
    loader: &str,
    mod_loader_hint: Option<&str>,
) -> Result<(), String> {
    let Some(hint) = mod_loader_hint
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };
    if hint.eq_ignore_ascii_case(loader) {
        return Ok(());
    }
    Err(format!(
        "El mod requiere loader '{hint}' y la instancia usa '{loader}'"
    ))
}
