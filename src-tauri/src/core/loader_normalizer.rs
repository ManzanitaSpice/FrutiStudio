use serde_json::Value;

use crate::core::launcher_discovery::expected_main_class_for_loader;

pub(crate) fn normalize_loader_profile(profile: &mut Value, minecraft_version: &str, loader: &str) {
    let Some(profile_obj) = profile.as_object_mut() else {
        return;
    };

    if loader != "forge" && loader != "neoforge" {
        profile_obj.insert(
            "inheritsFrom".to_string(),
            Value::String(minecraft_version.to_string()),
        );
        profile_obj.insert(
            "jar".to_string(),
            Value::String(minecraft_version.to_string()),
        );
    } else {
        let launch_target = if loader == "neoforge" {
            "neoforgeclient"
        } else {
            "forge_client"
        };
        let has_launch_target = profile_obj
            .get("launchTarget")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty());
        if !has_launch_target {
            profile_obj.insert(
                "launchTarget".to_string(),
                Value::String(launch_target.to_string()),
            );
        }

        let has_inherits_from = profile_obj
            .get("inheritsFrom")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty());
        if !has_inherits_from {
            profile_obj.insert(
                "inheritsFrom".to_string(),
                Value::String(minecraft_version.to_string()),
            );
        }
    }

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

    #[test]
    fn keeps_forge_like_chain_and_sets_launch_target_when_missing() {
        let mut profile = serde_json::json!({
            "inheritsFrom": "forge-loader-1.21.1",
            "jar": "forge-loader-1.21.1",
            "mainClass": "broken.Main"
        });

        normalize_loader_profile(&mut profile, "1.21.1", "forge");

        assert_eq!(
            profile.get("inheritsFrom").and_then(Value::as_str),
            Some("forge-loader-1.21.1")
        );
        assert_eq!(
            profile.get("jar").and_then(Value::as_str),
            Some("forge-loader-1.21.1")
        );
        assert_eq!(
            profile.get("launchTarget").and_then(Value::as_str),
            Some("forge_client")
        );
        assert_eq!(
            profile.get("mainClass").and_then(Value::as_str),
            Some("cpw.mods.bootstraplauncher.BootstrapLauncher")
        );
    }
}
