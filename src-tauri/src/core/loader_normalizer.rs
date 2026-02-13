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
            "forgeclient"
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

    let has_main_class = profile_obj
        .get("mainClass")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty());
    if !has_main_class {
        if let Some(main_class) = expected_main_class_for_loader(loader) {
            profile_obj.insert(
                "mainClass".to_string(),
                Value::String(main_class.to_string()),
            );
        }
    }

    // Sanitiza coordenadas maven en libraries que tengan versiones MC con typos
    // conocidos (p.ej. 1.21.11 en vez de 1.21.1).
    sanitize_library_version_typos(profile_obj, minecraft_version);
}

/// Sanitiza las coordenadas maven de todas las libraries en un version.json
/// (o cualquier Value con campo `libraries`). Corrige typos de versión MC
/// como 1.21.11 → 1.21.1.
pub(crate) fn sanitize_version_json_library_typos(version_json: &mut Value, mc_version: &str) {
    let Some(obj) = version_json.as_object_mut() else {
        return;
    };
    sanitize_library_version_typos(obj, mc_version);
}

/// Detecta y corrige typos de versión Minecraft en coordenadas de libraries.
///
/// Patrón: la versión MC correcta tiene un dígito extra pegado al final,
/// p.ej. "1.21.11" cuando debería ser "1.21.1". Esto puede ocurrir en el campo
/// `name`, en `downloads.artifact.path` y en `downloads.artifact.url`.
fn sanitize_library_version_typos(
    profile_obj: &mut serde_json::Map<String, Value>,
    mc_version: &str,
) {
    // Genera posibles typos: "1.21.1" → ["1.21.10", "1.21.11", ..., "1.21.19"]
    let typo_candidates: Vec<String> = (0..=9)
        .map(|digit| format!("{mc_version}{digit}"))
        .collect();

    let Some(libraries) = profile_obj
        .get_mut("libraries")
        .and_then(Value::as_array_mut)
    else {
        return;
    };

    for lib in libraries.iter_mut() {
        let Some(lib_obj) = lib.as_object_mut() else {
            continue;
        };

        // Sanitiza "name"
        if let Some(name_val) = lib_obj.get_mut("name") {
            if let Some(name) = name_val.as_str() {
                for typo in &typo_candidates {
                    if name.contains(typo.as_str()) {
                        *name_val = Value::String(name.replace(typo.as_str(), mc_version));
                        break;
                    }
                }
            }
        }

        // Sanitiza "downloads.artifact.path" y "downloads.artifact.url"
        if let Some(artifact) = lib_obj
            .get_mut("downloads")
            .and_then(Value::as_object_mut)
            .and_then(|d| d.get_mut("artifact"))
            .and_then(Value::as_object_mut)
        {
            for field in ["path", "url"] {
                if let Some(field_val) = artifact.get_mut(field) {
                    if let Some(text) = field_val.as_str() {
                        for typo in &typo_candidates {
                            if text.contains(typo.as_str()) {
                                *field_val = Value::String(text.replace(typo.as_str(), mc_version));
                                break;
                            }
                        }
                    }
                }
            }
        }
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
            Some("broken.Main")
        );
    }

    #[test]
    fn injects_expected_main_class_when_missing() {
        let mut profile = serde_json::json!({
            "inheritsFrom": "1.21.1",
            "jar": "1.21.1"
        });

        normalize_loader_profile(&mut profile, "1.21.1", "fabric");

        assert_eq!(
            profile.get("mainClass").and_then(Value::as_str),
            Some("net.fabricmc.loader.impl.launch.knot.KnotClient")
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
            Some("forgeclient")
        );
        assert_eq!(
            profile.get("mainClass").and_then(Value::as_str),
            Some("broken.Main")
        );
    }

    #[test]
    fn sanitizes_version_typo_in_library_names() {
        let mut profile = serde_json::json!({
            "inheritsFrom": "1.21.1",
            "jar": "1.21.1",
            "mainClass": "cpw.mods.bootstraplauncher.BootstrapLauncher",
            "libraries": [
                {
                    "name": "net.minecraftforge:forge:1.21.11-61.0.8:client",
                    "downloads": {
                        "artifact": {
                            "path": "net/minecraftforge/forge/1.21.11-61.0.8/forge-1.21.11-61.0.8-client.jar",
                            "url": "https://maven.example.com/net/minecraftforge/forge/1.21.11-61.0.8/forge-1.21.11-61.0.8-client.jar"
                        }
                    }
                },
                {
                    "name": "org.lwjgl:lwjgl:3.3.3",
                    "downloads": {
                        "artifact": {
                            "path": "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3.jar",
                            "url": "https://libraries.minecraft.net/org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3.jar"
                        }
                    }
                }
            ]
        });

        normalize_loader_profile(&mut profile, "1.21.1", "forge");

        let libs = profile["libraries"].as_array().unwrap();
        // Forge lib should have typo fixed
        assert_eq!(
            libs[0]["name"].as_str().unwrap(),
            "net.minecraftforge:forge:1.21.1-61.0.8:client"
        );
        assert_eq!(
            libs[0]["downloads"]["artifact"]["path"].as_str().unwrap(),
            "net/minecraftforge/forge/1.21.1-61.0.8/forge-1.21.1-61.0.8-client.jar"
        );
        assert!(libs[0]["downloads"]["artifact"]["url"]
            .as_str()
            .unwrap()
            .contains("1.21.1-61.0.8"));
        assert!(!libs[0]["downloads"]["artifact"]["url"]
            .as_str()
            .unwrap()
            .contains("1.21.11"));
        // Unrelated lib should be untouched
        assert_eq!(libs[1]["name"].as_str().unwrap(), "org.lwjgl:lwjgl:3.3.3");
    }

    #[test]
    fn sanitize_version_json_fixes_neoforge_metadata_libraries() {
        use super::sanitize_version_json_library_typos;

        let mut version_json = serde_json::json!({
            "libraries": [
                {"name": "net.neoforged:minecraft-dependencies:1.21.11"},
                {"name": "net.neoforged:neoforge:21.1.77"},
                {
                    "name": "releases.net.neoforged:minecraft-dependencies:1.21.11",
                    "downloads": {
                        "artifact": {
                            "path": "net/neoforged/minecraft-dependencies/1.21.11/minecraft-dependencies-1.21.11.jar",
                            "url": "https://maven.neoforged.net/releases/net/neoforged/minecraft-dependencies/1.21.11/minecraft-dependencies-1.21.11.jar"
                        }
                    }
                }
            ]
        });

        sanitize_version_json_library_typos(&mut version_json, "1.21.1");

        let libs = version_json["libraries"].as_array().unwrap();
        assert_eq!(
            libs[0]["name"].as_str().unwrap(),
            "net.neoforged:minecraft-dependencies:1.21.1"
        );
        // Unrelated neoforge lib untouched
        assert_eq!(
            libs[1]["name"].as_str().unwrap(),
            "net.neoforged:neoforge:21.1.77"
        );
        // releases-prefixed lib fixed
        assert_eq!(
            libs[2]["name"].as_str().unwrap(),
            "releases.net.neoforged:minecraft-dependencies:1.21.1"
        );
        assert_eq!(
            libs[2]["downloads"]["artifact"]["path"].as_str().unwrap(),
            "net/neoforged/minecraft-dependencies/1.21.1/minecraft-dependencies-1.21.1.jar"
        );
        assert!(!libs[2]["downloads"]["artifact"]["url"]
            .as_str()
            .unwrap()
            .contains("1.21.11"));
    }
}
