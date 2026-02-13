use std::borrow::Cow;

#[derive(Debug, Clone)]
pub(crate) struct LoaderCompatibilityRoute {
    pub(crate) loader: &'static str,
    pub(crate) minecraft_prefix: &'static str,
    pub(crate) metadata_endpoint: &'static str,
    pub(crate) jar_published: bool,
}

pub(crate) const MINECRAFT_MANIFEST_URLS: [&str; 1] =
    ["https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"];

pub(crate) fn version_metadata_urls(primary_url: &str) -> Vec<String> {
    dedupe(vec![primary_url.to_string()])
}

pub(crate) fn asset_index_urls(primary_url: &str) -> Vec<String> {
    version_metadata_urls(primary_url)
}

pub(crate) fn fabric_like_profile_urls(
    loader: &str,
    minecraft_version: &str,
    loader_version: &str,
) -> Vec<String> {
    if loader == "quilt" {
        return vec![
            format!(
                "https://meta.quiltmc.org/v3/versions/loader/{minecraft_version}/{loader_version}/profile/json"
            ),
            format!(
                "https://meta.quiltmc.org/v3/versions/loader/{minecraft_version}/latest/profile/json"
            ),
        ];
    }

    vec![
        format!(
            "https://meta.fabricmc.net/v2/versions/loader/{minecraft_version}/{loader_version}/profile/json"
        ),
        format!(
            "https://meta.fabricmc.net/v2/versions/loader/{minecraft_version}/stable/profile/json"
        ),
    ]
}

pub(crate) fn forge_promotions_urls() -> Vec<String> {
    vec![
        "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json"
            .to_string(),
        "https://maven.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json"
            .to_string(),
    ]
}

pub(crate) fn forge_like_metadata_urls(loader: &str) -> Vec<String> {
    if loader == "neoforge" {
        return vec![
            "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge"
                .to_string(),
            "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml"
                .to_string(),
        ];
    }

    vec![
        "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml".to_string(),
        "https://files.minecraftforge.net/maven/net/minecraftforge/forge/maven-metadata.xml"
            .to_string(),
    ]
}

pub(crate) fn forge_like_installer_urls(loader: &str, resolved_version: &str) -> Vec<String> {
    let mut urls = Vec::new();

    if loader == "neoforge" {
        urls.push(format!(
            "https://maven.neoforged.net/releases/net/neoforged/neoforge/{resolved_version}/neoforge-{resolved_version}-installer.jar"
        ));
        return urls;
    }

    urls.push(format!(
        "https://maven.minecraftforge.net/net/minecraftforge/forge/{resolved_version}/forge-{resolved_version}-installer.jar"
    ));
    urls.push(format!(
        "https://files.minecraftforge.net/maven/net/minecraftforge/forge/{resolved_version}/forge-{resolved_version}-installer.jar"
    ));
    dedupe(urls)
}

pub(crate) fn mirror_candidates_for_url(url: &str) -> Vec<String> {
    let mut urls = vec![url.to_string()];
    let includes_experimental_jetbrains = is_experimental_jetbrains_url(url);

    if let Some(rest) = url.strip_prefix("https://libraries.minecraft.net") {
        let mut prioritized = vec![format!("https://libraries.minecraft.net{rest}")];

        if rest.contains("/org/apache/") {
            prioritized.insert(0, format!("https://repo.maven.apache.org/maven2{rest}"));
            prioritized.insert(1, format!("https://repo1.maven.org/maven2{rest}"));
        } else if rest.contains("/org/jetbrains/") {
            prioritized.insert(0, format!("https://repo.maven.apache.org/maven2{rest}"));
            prioritized.insert(1, format!("https://repo1.maven.org/maven2{rest}"));
            prioritized.insert(
                2,
                format!("https://packages.jetbrains.team/maven/p/ij/intellij-dependencies{rest}"),
            );
        } else if rest.starts_with("/net/neoforged/") || rest.starts_with("/cpw/mods/") {
            prioritized.insert(0, format!("https://maven.neoforged.net/releases{rest}"));
        } else if rest.starts_with("/net/minecraftforge/") {
            prioritized.insert(0, format!("https://maven.minecraftforge.net{rest}"));
        }

        prioritized.push(format!("https://repo.maven.apache.org/maven2{rest}"));
        prioritized.push(format!("https://repo1.maven.org/maven2{rest}"));
        prioritized.push(format!(
            "https://packages.jetbrains.team/maven/p/ij/intellij-dependencies{rest}"
        ));
        prioritized.push(format!("https://maven.neoforged.net/releases{rest}"));
        prioritized.push(format!("https://maven.minecraftforge.net{rest}"));
        prioritized.push(format!("https://bmclapi2.bangbang93.com/maven{rest}"));

        urls = prioritized;
    }

    if let Some(rest) = url
        .strip_prefix("https://repo.maven.apache.org/maven2")
        .or_else(|| url.strip_prefix("https://repo1.maven.org/maven2"))
    {
        let is_kotlin = rest.starts_with("/org/jetbrains/kotlin/")
            || rest.starts_with("/org/jetbrains/kotlinx/");
        if is_kotlin {
            urls = vec![
                format!("https://repo.maven.apache.org/maven2{rest}"),
                format!("https://repo1.maven.org/maven2{rest}"),
                format!("https://packages.jetbrains.team/maven/p/ij/intellij-dependencies{rest}"),
            ];
        }
    }

    if let Some(rest) = url
        .strip_prefix("https://maven.pkg.jetbrains.space/kotlin/p/kotlin/dev")
        .or_else(|| url.strip_prefix("https://maven.pkg.jetbrains.space/kotlin/p/kotlin/eap"))
        .or_else(|| url.strip_prefix("https://maven.pkg.jetbrains.space/kotlin/p/kotlin/bootstrap"))
    {
        urls = vec![
            url.to_string(),
            format!("https://repo.maven.apache.org/maven2{rest}"),
            format!("https://repo1.maven.org/maven2{rest}"),
            format!("https://packages.jetbrains.team/maven/p/ij/intellij-dependencies{rest}"),
        ];
        if includes_experimental_jetbrains {
            urls.push(format!(
                "https://maven.pkg.jetbrains.space/kotlin/p/kotlin/dev{rest}"
            ));
            urls.push(format!(
                "https://maven.pkg.jetbrains.space/kotlin/p/kotlin/eap{rest}"
            ));
            urls.push(format!(
                "https://maven.pkg.jetbrains.space/kotlin/p/kotlin/bootstrap{rest}"
            ));
        }
    }

    let mirrors: [(&str, &[&str]); 4] = [
        (
            "https://libraries.minecraft.net",
            &[
                "https://bmclapi2.bangbang93.com/maven",
                "https://repo.maven.apache.org/maven2",
                "https://repo1.maven.org/maven2",
            ],
        ),
        (
            "https://maven.minecraftforge.net",
            &[
                "https://files.minecraftforge.net/maven",
                "https://maven.neoforged.net/releases",
            ],
        ),
        (
            "https://maven.fabricmc.net",
            &["https://maven.fabricmc.net"],
        ),
        (
            "https://maven.quiltmc.org/repository/release",
            &["https://maven.quiltmc.org/repository/release"],
        ),
    ];

    for (origin, replacements) in mirrors {
        if let Some(rest) = url.strip_prefix(origin) {
            for replacement in replacements {
                if replacement.is_empty() {
                    continue;
                }
                urls.push(format!("{replacement}{rest}"));
            }
        }
    }

    dedupe(urls)
}

#[cfg(test)]
mod tests {
    use super::mirror_candidates_for_url;

    #[test]
    fn neoforged_library_url_prioritizes_neoforge_maven() {
        let urls = mirror_candidates_for_url(
            "https://libraries.minecraft.net/net/neoforged/neoforge/21.1.0/neoforge-21.1.0.jar",
        );

        assert_eq!(
            urls.first().map(String::as_str),
            Some(
                "https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.0/neoforge-21.1.0.jar"
            )
        );
        assert!(urls.iter().any(|value| {
            value
                == "https://libraries.minecraft.net/net/neoforged/neoforge/21.1.0/neoforge-21.1.0.jar"
        }));
    }

    #[test]
    fn cpw_mods_library_url_prioritizes_neoforge_maven() {
        let urls = mirror_candidates_for_url(
            "https://libraries.minecraft.net/cpw/mods/bootstraplauncher/2.0.2/bootstraplauncher-2.0.2.jar",
        );

        assert_eq!(
            urls.first().map(String::as_str),
            Some(
                "https://maven.neoforged.net/releases/cpw/mods/bootstraplauncher/2.0.2/bootstraplauncher-2.0.2.jar",
            )
        );
    }

    #[test]
    fn apache_library_url_prioritizes_maven_central() {
        let urls = mirror_candidates_for_url(
            "https://libraries.minecraft.net/org/apache/commons/commons-lang3/3.17.0/commons-lang3-3.17.0.jar",
        );

        assert_eq!(
            urls.first().map(String::as_str),
            Some(
                "https://repo.maven.apache.org/maven2/org/apache/commons/commons-lang3/3.17.0/commons-lang3-3.17.0.jar",
            )
        );
        assert!(urls.iter().any(|value| {
            value
                == "https://libraries.minecraft.net/org/apache/commons/commons-lang3/3.17.0/commons-lang3-3.17.0.jar"
        }));
    }

    #[test]
    fn jetbrains_library_url_prioritizes_maven_central() {
        let urls = mirror_candidates_for_url(
            "https://libraries.minecraft.net/org/jetbrains/kotlin/kotlin-stdlib-common/1.9.22/kotlin-stdlib-common-1.9.22.jar",
        );

        assert_eq!(
            urls.first().map(String::as_str),
            Some(
                "https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-stdlib-common/1.9.22/kotlin-stdlib-common-1.9.22.jar",
            )
        );
        assert!(urls.iter().any(|value| {
            value
                == "https://repo1.maven.org/maven2/org/jetbrains/kotlin/kotlin-stdlib-common/1.9.22/kotlin-stdlib-common-1.9.22.jar"
        }));
        assert!(urls.iter().any(|value| {
            value
                == "https://packages.jetbrains.team/maven/p/ij/intellij-dependencies/org/jetbrains/kotlin/kotlin-stdlib-common/1.9.22/kotlin-stdlib-common-1.9.22.jar"
        }));
    }

    #[test]
    fn jetbrains_experimental_url_falls_back_to_maven_central() {
        let urls = mirror_candidates_for_url(
            "https://maven.pkg.jetbrains.space/kotlin/p/kotlin/bootstrap/org/jetbrains/kotlin/kotlin-stdlib-common/2.1.0/kotlin-stdlib-common-2.1.0.jar",
        );

        assert_eq!(
            urls.first().map(String::as_str),
            Some(
                "https://maven.pkg.jetbrains.space/kotlin/p/kotlin/bootstrap/org/jetbrains/kotlin/kotlin-stdlib-common/2.1.0/kotlin-stdlib-common-2.1.0.jar",
            )
        );
        assert!(urls.iter().any(|value| {
            value
                == "https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-stdlib-common/2.1.0/kotlin-stdlib-common-2.1.0.jar"
        }));
    }
}

fn dedupe(urls: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    urls.into_iter()
        .filter(|value| {
            let normalized: Cow<'_, str> = Cow::Owned(value.trim().to_string());
            !normalized.is_empty() && seen.insert(normalized.to_string())
        })
        .collect()
}

fn is_experimental_jetbrains_url(url: &str) -> bool {
    url.contains("maven.pkg.jetbrains.space/kotlin/p/kotlin/dev")
        || url.contains("maven.pkg.jetbrains.space/kotlin/p/kotlin/eap")
        || url.contains("maven.pkg.jetbrains.space/kotlin/p/kotlin/bootstrap")
}

pub(crate) fn loader_compatibility_routes() -> Vec<LoaderCompatibilityRoute> {
    vec![
        LoaderCompatibilityRoute {
            loader: "fabric",
            minecraft_prefix: "1.",
            metadata_endpoint: "https://meta.fabricmc.net/v2/versions/loader",
            jar_published: true,
        },
        LoaderCompatibilityRoute {
            loader: "quilt",
            minecraft_prefix: "1.",
            metadata_endpoint: "https://meta.quiltmc.org/v3/versions/loader",
            jar_published: true,
        },
        LoaderCompatibilityRoute {
            loader: "forge",
            minecraft_prefix: "1.",
            metadata_endpoint:
                "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml",
            jar_published: true,
        },
        LoaderCompatibilityRoute {
            loader: "neoforge",
            minecraft_prefix: "1.20",
            metadata_endpoint:
                "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge",
            jar_published: true,
        },
    ]
}

pub(crate) fn endpoint_label(url: &str) -> &'static str {
    if url.contains("meta.fabricmc.net") {
        return "fabric-meta";
    }
    if url.contains("meta.quiltmc.org") {
        return "quilt-meta";
    }
    if url.contains("maven.minecraftforge.net") || url.contains("files.minecraftforge.net") {
        return "forge-maven";
    }
    if url.contains("maven.neoforged.net") {
        return "neoforge-maven";
    }
    if url.contains("launchermeta.mojang.com") || url.contains("piston-meta.mojang.com") {
        return "mojang-meta";
    }
    if url.contains("libraries.minecraft.net") {
        return "minecraft-libraries";
    }
    if url.contains("maven.pkg.jetbrains.space/kotlin") {
        return "jetbrains-kotlin";
    }
    if url.contains("packages.jetbrains.team/maven/p/ij/intellij-dependencies") {
        return "jetbrains-ij";
    }
    "generic"
}
