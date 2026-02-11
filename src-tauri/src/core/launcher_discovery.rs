use std::collections::HashSet;
use std::path::PathBuf;

use serde_json::Value;

use crate::core::instance::LauncherInstallation;

fn fast_volume_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();

    #[cfg(target_os = "windows")]
    {
        for letter in b'A'..=b'Z' {
            let root = PathBuf::from(format!("{}:/", char::from(letter)));
            if root.is_dir() {
                roots.push(root);
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        roots.push(PathBuf::from("/"));
        for mount_parent in ["/mnt", "/media", "/Volumes"] {
            let parent = PathBuf::from(mount_parent);
            let Ok(entries) = std::fs::read_dir(&parent) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    roots.push(path);
                }
            }
        }
    }

    roots
}

fn official_minecraft_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            roots.push(PathBuf::from(&appdata).join(".minecraft"));
        }
        for volume in fast_volume_roots() {
            roots.push(volume.join(".minecraft"));
            roots.push(volume.join("Users").join("Public").join(".minecraft"));
            roots.push(volume.join("Minecraft").join(".minecraft"));
            roots.push(
                volume
                    .join("XboxGames")
                    .join("Minecraft Launcher")
                    .join("Content")
                    .join(".minecraft"),
            );
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let home = PathBuf::from(home);
            roots.push(
                home.join("Library")
                    .join("Application Support")
                    .join("minecraft"),
            );
        }
        for volume in fast_volume_roots() {
            roots.push(
                volume
                    .join("Users")
                    .join("Shared")
                    .join("Library")
                    .join("Application Support")
                    .join("minecraft"),
            );
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Ok(home) = std::env::var("HOME") {
            roots.push(PathBuf::from(home).join(".minecraft"));
        }
        for volume in fast_volume_roots() {
            roots.push(volume.join(".minecraft"));
        }
    }

    roots
}

pub(crate) fn detect_minecraft_launcher_installations() -> Vec<LauncherInstallation> {
    let mut installations = Vec::new();

    if let Ok(path) = std::env::var("MINECRAFT_HOME") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            let root = PathBuf::from(trimmed);
            let usable = root.join("versions").is_dir();
            installations.push(LauncherInstallation {
                launcher: "minecraft".to_string(),
                root: root.to_string_lossy().to_string(),
                kind: "env".to_string(),
                usable,
            });
        }
    }

    if let Ok(path) = std::env::var("MODRINTH_HOME") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            let root = PathBuf::from(trimmed);
            let usable = root.join("versions").is_dir();
            installations.push(LauncherInstallation {
                launcher: "modrinth".to_string(),
                root: root.to_string_lossy().to_string(),
                kind: "env".to_string(),
                usable,
            });
        }
    }

    for root in official_minecraft_roots() {
        let usable = root.join("versions").is_dir()
            || root.join("launcher_profiles.json").is_file()
            || root.join("launcher_accounts.json").is_file();
        installations.push(LauncherInstallation {
            launcher: "minecraft".to_string(),
            root: root.to_string_lossy().to_string(),
            kind: "official".to_string(),
            usable,
        });
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let prism = PathBuf::from(&local_app_data)
                .join("Programs")
                .join("PrismLauncher");
            let prism_instances = prism.join("instances");
            installations.push(LauncherInstallation {
                launcher: "prism".to_string(),
                root: prism.to_string_lossy().to_string(),
                kind: "third-party".to_string(),
                usable: prism_instances.is_dir(),
            });

            let cf = PathBuf::from(local_app_data)
                .join("CurseForge")
                .join("minecraft")
                .join("Install")
                .join(".minecraft");
            installations.push(LauncherInstallation {
                launcher: "curseforge".to_string(),
                root: cf.to_string_lossy().to_string(),
                kind: "third-party".to_string(),
                usable: cf.join("versions").is_dir(),
            });
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let home = PathBuf::from(home);
            let prism = home
                .join("Library")
                .join("Application Support")
                .join("PrismLauncher");
            installations.push(LauncherInstallation {
                launcher: "prism".to_string(),
                root: prism.to_string_lossy().to_string(),
                kind: "third-party".to_string(),
                usable: prism.join("instances").is_dir(),
            });

            let cf = home
                .join("Library")
                .join("Application Support")
                .join("CurseForge")
                .join("minecraft")
                .join("Install")
                .join(".minecraft");
            installations.push(LauncherInstallation {
                launcher: "curseforge".to_string(),
                root: cf.to_string_lossy().to_string(),
                kind: "third-party".to_string(),
                usable: cf.join("versions").is_dir(),
            });
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Ok(home) = std::env::var("HOME") {
            let home = PathBuf::from(home);
            let prism = home.join(".local").join("share").join("PrismLauncher");
            installations.push(LauncherInstallation {
                launcher: "prism".to_string(),
                root: prism.to_string_lossy().to_string(),
                kind: "third-party".to_string(),
                usable: prism.join("instances").is_dir(),
            });

            let cf = home
                .join(".local")
                .join("share")
                .join("CurseForge")
                .join("minecraft")
                .join("Install")
                .join(".minecraft");
            installations.push(LauncherInstallation {
                launcher: "curseforge".to_string(),
                root: cf.to_string_lossy().to_string(),
                kind: "third-party".to_string(),
                usable: cf.join("versions").is_dir(),
            });
        }
    }

    let mut dedup = HashSet::new();
    installations
        .into_iter()
        .filter(|entry| dedup.insert((entry.launcher.clone(), entry.root.clone())))
        .collect()
}

pub(crate) fn expected_main_class_for_loader(loader: &str) -> Option<&'static str> {
    match loader {
        "fabric" => Some("net.fabricmc.loader.launch.knot.KnotClient"),
        "quilt" => Some("org.quiltmc.loader.impl.launch.knot.KnotClient"),
        "forge" => Some("cpw.mods.modlauncher.Launcher"),
        "neoforge" => Some("net.neoforged.fml.loading.targets.ClientLaunchHandler"),
        "vanilla" => Some("net.minecraft.client.main.Main"),
        _ => None,
    }
}

pub(crate) fn detect_loader_from_version_json(version_json: &Value) -> Option<&'static str> {
    let libraries = version_json.get("libraries")?.as_array()?;

    for library in libraries {
        let Some(name) = library.get("name").and_then(Value::as_str) else {
            continue;
        };
        let normalized = name.to_ascii_lowercase();
        if normalized.contains("net.fabricmc:fabric-loader") {
            return Some("fabric");
        }
        if normalized.contains("org.quiltmc:quilt-loader") {
            return Some("quilt");
        }
        if normalized.contains("net.neoforged:neoforge") || normalized.contains("net.neoforged:fml")
        {
            return Some("neoforge");
        }
        if normalized.contains("net.minecraftforge:forge")
            || normalized.contains("net.minecraftforge:fmlloader")
        {
            return Some("forge");
        }
    }

    Some("vanilla")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn official_roots_include_default_home_location() {
        let roots = official_minecraft_roots();
        assert!(!roots.is_empty());
        #[cfg(target_os = "windows")]
        {
            assert!(roots.iter().any(|root| root.ends_with(".minecraft")));
        }
        #[cfg(target_os = "macos")]
        {
            assert!(roots.iter().any(|root| {
                root.to_string_lossy()
                    .contains("Library/Application Support/minecraft")
            }));
        }
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            assert!(roots.iter().any(|root| root.ends_with(".minecraft")));
        }
    }
}
