use serde_json::Value;

use crate::core::launcher_discovery::expected_main_class_for_loader;

pub(crate) fn normalize_loader_profile(profile: &mut Value, minecraft_version: &str, loader: &str) {
    let Some(profile_obj) = profile.as_object_mut() else {
        return;
    };

    profile_obj.insert(
        "inheritsFrom".to_string(),
        Value::String(minecraft_version.to_string()),
    );
    profile_obj.insert(
        "jar".to_string(),
        Value::String(minecraft_version.to_string()),
    );

    if let Some(main_class) = expected_main_class_for_loader(loader) {
        profile_obj.insert(
            "mainClass".to_string(),
            Value::String(main_class.to_string()),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_loader_profile;
    use serde_json::Value;

    #[test]
    fn normalizes_loader_profile_to_vanilla_chain() {
        let mut profile = serde_json::json!({
            "inheritsFrom": "broken-parent",
            "jar": "broken-jar",
            "mainClass": "broken.Main"
        });

        normalize_loader_profile(&mut profile, "1.21.1", "fabric");

        assert_eq!(
            profile.get("inheritsFrom").and_then(Value::as_str),
            Some("1.21.1")
        );
        assert_eq!(profile.get("jar").and_then(Value::as_str), Some("1.21.1"));
        assert_eq!(
            profile.get("mainClass").and_then(Value::as_str),
            Some("net.fabricmc.loader.launch.knot.KnotClient")
        );
    }
}
