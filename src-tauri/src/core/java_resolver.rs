use serde_json::Value;

pub(crate) fn required_java_major_for_version(minecraft_version: &str) -> u32 {
    let clean = minecraft_version.trim().trim_start_matches('v');
    let mut parts = clean.split('.');

    let major = parts
        .next()
        .and_then(|p| p.parse::<u32>().ok())
        .unwrap_or_default();
    let minor = parts
        .next()
        .and_then(|p| p.parse::<u32>().ok())
        .unwrap_or_default();
    let patch = parts
        .next()
        .and_then(|p| p.parse::<u32>().ok())
        .unwrap_or_default();

    if major == 1 && (minor > 20 || (minor == 20 && patch >= 5)) {
        21
    } else if major == 1 && minor <= 16 {
        8
    } else if major == 1 && minor >= 17 {
        17
    } else if major > 1 {
        if major > 20 || (major == 20 && minor >= 5) {
            21
        } else if major >= 17 {
            17
        } else {
            8
        }
    } else {
        17
    }
}

pub(crate) fn required_java_major(
    minecraft_version: &str,
    version_json: Option<&Value>,
    loader_version_json: Option<&Value>,
) -> u32 {
    loader_version_json
        .and_then(extract_java_major)
        .or_else(|| version_json.and_then(extract_java_major))
        .unwrap_or_else(|| required_java_major_for_version(minecraft_version))
}

fn extract_java_major(version_json: &Value) -> Option<u32> {
    version_json
        .get("javaVersion")
        .and_then(|v| v.get("majorVersion"))
        .and_then(|v| v.as_u64())
        .map(|v| v as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_minecraft_ranges_to_expected_java() {
        assert_eq!(required_java_major_for_version("1.16.5"), 8);
        assert_eq!(required_java_major_for_version("1.17.1"), 17);
        assert_eq!(required_java_major_for_version("1.20.4"), 17);
        assert_eq!(required_java_major_for_version("1.20.5"), 21);
    }

    #[test]
    fn prefers_java_version_from_profile_metadata() {
        let base = serde_json::json!({"javaVersion": {"majorVersion": 17}});
        let loader = serde_json::json!({"javaVersion": {"majorVersion": 21}});
        assert_eq!(
            required_java_major("1.20.1", Some(&base), Some(&loader)),
            21
        );
    }
}
