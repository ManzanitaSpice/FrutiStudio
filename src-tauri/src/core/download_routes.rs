use std::borrow::Cow;

pub(crate) const MINECRAFT_MANIFEST_URLS: [&str; 2] = [
    "https://launchermeta.mojang.com/mc/game/version_manifest.json",
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
];

pub(crate) fn version_metadata_urls(primary_url: &str) -> Vec<String> {
    let mut urls = vec![primary_url.to_string()];
    if primary_url.contains("piston-meta.mojang.com") {
        urls.push(primary_url.replace("piston-meta.mojang.com", "launchermeta.mojang.com"));
    } else if primary_url.contains("launchermeta.mojang.com") {
        urls.push(primary_url.replace("launchermeta.mojang.com", "piston-meta.mojang.com"));
    }
    dedupe(urls)
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
            "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml"
                .to_string(),
            "https://maven.neoforged.net/net/neoforged/neoforge/maven-metadata.xml".to_string(),
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
        urls.push(format!(
            "https://maven.neoforged.net/net/neoforged/neoforge/{resolved_version}/neoforge-{resolved_version}-installer.jar"
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
    let mirrors = [
        (
            "https://libraries.minecraft.net",
            [
                "https://bmclapi2.bangbang93.com/maven",
                "https://download.mcbbs.net/maven",
            ],
        ),
        (
            "https://maven.minecraftforge.net",
            ["https://files.minecraftforge.net/maven", ""],
        ),
        (
            "https://maven.fabricmc.net",
            ["https://maven.fabricmc.net", ""],
        ),
        (
            "https://maven.quiltmc.org/repository/release",
            ["https://maven.quiltmc.org/repository/release", ""],
        ),
        (
            "https://maven.neoforged.net/releases",
            ["https://maven.neoforged.net/net", ""],
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

fn dedupe(urls: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    urls.into_iter()
        .filter(|value| {
            let normalized: Cow<'_, str> = Cow::Owned(value.trim().to_string());
            !normalized.is_empty() && seen.insert(normalized.to_string())
        })
        .collect()
}
