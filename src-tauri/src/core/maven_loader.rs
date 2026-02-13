use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;

use regex::Regex;
use serde_json::Value;

#[derive(Debug, Clone, Eq, PartialEq, Hash)]
pub struct MavenCoordinate {
    pub group: String,
    pub artifact: String,
    pub version: String,
    pub classifier: Option<String>,
    pub extension: String,
}

impl MavenCoordinate {
    pub fn parse(value: &str) -> Option<Self> {
        let mut parts = value.split(':');
        let group = parts.next()?.trim();
        let artifact = parts.next()?.trim();
        let version = parts.next()?.trim();
        let fourth = parts.next().map(str::trim);
        let fifth = parts.next().map(str::trim);
        if parts.next().is_some() || group.is_empty() || artifact.is_empty() || version.is_empty() {
            return None;
        }

        let (classifier, extension) = match (fourth, fifth) {
            (None, _) => (None, "jar".to_string()),
            (Some(raw), None) => {
                if let Some((classifier, ext)) = raw.split_once('@') {
                    let classifier = classifier.trim();
                    (
                        (!classifier.is_empty()).then_some(classifier.to_string()),
                        normalize_extension(ext),
                    )
                } else {
                    match raw {
                        "jar" | "zip" | "pom" => (None, raw.to_string()),
                        _ => (Some(raw.to_string()), "jar".to_string()),
                    }
                }
            }
            (Some(classifier), Some(ext)) => (
                (!classifier.is_empty()).then_some(classifier.to_string()),
                normalize_extension(ext),
            ),
        };

        Some(Self {
            group: group.to_string(),
            artifact: artifact.to_string(),
            version: version.to_string(),
            classifier,
            extension,
        })
    }

    pub fn to_rel_path(&self) -> PathBuf {
        let mut out = PathBuf::new();
        for part in self.group.split('.') {
            out.push(part);
        }
        out.push(&self.artifact);
        out.push(&self.version);
        let file = if let Some(classifier) = &self.classifier {
            format!(
                "{}-{}-{}.{}",
                self.artifact, self.version, classifier, self.extension
            )
        } else {
            format!("{}-{}.{}", self.artifact, self.version, self.extension)
        };
        out.push(file);
        out
    }

    pub fn pom_rel_path(&self) -> PathBuf {
        let mut pom = self.clone();
        pom.classifier = None;
        pom.extension = "pom".to_string();
        pom.to_rel_path()
    }

    pub fn key_without_ext(&self) -> String {
        format!("{}:{}:{}", self.group, self.artifact, self.version)
    }
}

fn normalize_extension(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        "jar".to_string()
    } else {
        trimmed.to_string()
    }
}

fn official_repository_for_group(group: &str) -> Option<&'static str> {
    if group == "com.mojang" || group.starts_with("com.mojang.") {
        return Some("https://libraries.minecraft.net");
    }
    if group == "net.fabricmc" || group.starts_with("net.fabricmc.") {
        return Some("https://maven.fabricmc.net");
    }
    if group == "org.quiltmc" || group.starts_with("org.quiltmc.") {
        return Some("https://maven.quiltmc.org/repository/release");
    }
    if group == "net.minecraftforge" || group.starts_with("net.minecraftforge.") {
        return Some("https://maven.minecraftforge.net");
    }
    if group == "net.neoforged"
        || group.starts_with("net.neoforged.")
        || group == "cpw.mods"
        || group.starts_with("cpw.mods.")
    {
        return Some("https://maven.neoforged.net/releases");
    }
    if group == "org.jetbrains" || group.starts_with("org.jetbrains.") {
        return Some("https://repo.maven.apache.org/maven2");
    }

    None
}

pub fn repositories_for_library(library: &Value, declared: &[String]) -> Vec<String> {
    let mut repos = declared.to_vec();

    if let Some(name) = library.get("name").and_then(Value::as_str) {
        if let Some(group) = name.split(':').next() {
            if let Some(official) = official_repository_for_group(group) {
                let official = official.to_string();
                repos.retain(|repo| repo != &official);
                repos.insert(0, official);
            }
        }
    }

    if let Some(url) = library.get("url").and_then(Value::as_str) {
        let normalized = url.trim().trim_end_matches('/').to_string();
        if !normalized.is_empty() && !repos.contains(&normalized) {
            repos.insert(0, normalized);
        }
    }
    if repos.is_empty() {
        repos = default_repositories();
    }
    repos
}

pub fn default_repositories() -> Vec<String> {
    vec![
        "https://libraries.minecraft.net".to_string(),
        "https://maven.minecraftforge.net".to_string(),
        "https://maven.neoforged.net/releases".to_string(),
        "https://maven.fabricmc.net".to_string(),
        "https://maven.quiltmc.org/repository/release".to_string(),
        "https://repo.maven.apache.org/maven2".to_string(),
        "https://maven.pkg.jetbrains.space/kotlin/p/kotlin/dev".to_string(),
        "https://maven.pkg.jetbrains.space/kotlin/p/kotlin/eap".to_string(),
        "https://maven.pkg.jetbrains.space/kotlin/p/kotlin/bootstrap".to_string(),
    ]
}

pub fn parse_install_profile_libraries(install_profile: &Value) -> Vec<Value> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for node in [
        install_profile.get("libraries"),
        install_profile
            .get("versionInfo")
            .and_then(|v| v.get("libraries")),
    ]
    .into_iter()
    .flatten()
    {
        let Some(items) = node.as_array() else {
            continue;
        };
        for item in items {
            if !library_allowed_for_os(item) {
                continue;
            }
            let key = item
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| {
                    item.get("downloads")
                        .and_then(|d| d.get("artifact"))
                        .and_then(|a| a.get("path"))
                        .and_then(Value::as_str)
                        .map(str::to_string)
                });
            if let Some(key) = key {
                if seen.insert(key) {
                    out.push(item.clone());
                }
            }
        }
    }
    out
}

pub fn library_allowed_for_os(library: &Value) -> bool {
    let Some(rules) = library.get("rules").and_then(Value::as_array) else {
        return true;
    };
    let mut allowed = false;
    let current = current_os();
    for rule in rules {
        let action = rule
            .get("action")
            .and_then(Value::as_str)
            .unwrap_or("allow");
        let os_name = rule
            .get("os")
            .and_then(|v| v.get("name"))
            .and_then(Value::as_str);
        let matches = os_name.map(|v| v == current).unwrap_or(true);
        if matches {
            allowed = action == "allow";
        }
    }
    allowed
}

fn current_os() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    }
}

pub async fn resolve_transitive_dependencies(
    client: &reqwest::Client,
    roots: &[MavenCoordinate],
    repositories: &[String],
) -> Vec<MavenCoordinate> {
    let mut queue: VecDeque<MavenCoordinate> = roots.iter().cloned().collect();
    let mut seen = HashSet::new();
    let mut resolved = Vec::new();
    let mut cache = HashMap::<String, Vec<MavenCoordinate>>::new();

    while let Some(current) = queue.pop_front() {
        if !seen.insert(current.key_without_ext()) {
            continue;
        }

        resolved.push(current.clone());
        let deps = if let Some(cached) = cache.get(&current.key_without_ext()) {
            cached.clone()
        } else {
            let parsed = fetch_pom_dependencies(client, &current, repositories)
                .await
                .unwrap_or_default();
            cache.insert(current.key_without_ext(), parsed.clone());
            parsed
        };

        for dep in deps {
            if !seen.contains(&dep.key_without_ext()) {
                queue.push_back(dep);
            }
        }
    }

    resolved
}

async fn fetch_pom_dependencies(
    client: &reqwest::Client,
    coordinate: &MavenCoordinate,
    repositories: &[String],
) -> Result<Vec<MavenCoordinate>, String> {
    let rel = coordinate
        .pom_rel_path()
        .to_string_lossy()
        .replace('\\', "/");
    let mut pom_raw = None;

    for repo in repositories {
        let url = format!("{}/{}", repo.trim_end_matches('/'), rel);
        let Ok(resp) = client.get(&url).send().await else {
            continue;
        };
        if !resp.status().is_success() {
            continue;
        }
        let Ok(text) = resp.text().await else {
            continue;
        };
        if text.contains("<project") {
            pom_raw = Some(text);
            break;
        }
    }

    let Some(raw) = pom_raw else {
        return Ok(Vec::new());
    };

    Ok(parse_dependencies_from_pom(&raw))
}

fn parse_dependencies_from_pom(raw: &str) -> Vec<MavenCoordinate> {
    let mut out = Vec::new();
    let dep_block_re = Regex::new(r"(?s)<dependency>(.*?)</dependency>").expect("regex dep");
    let comment_re = Regex::new(r"(?s)<!--.*?-->").expect("regex comment");
    let tag_value = |block: &str, tag: &str| -> Option<String> {
        let re = Regex::new(&format!(r"(?s)<{tag}>\s*(.*?)\s*</{tag}>")).ok()?;
        re.captures(block)
            .and_then(|cap| cap.get(1))
            .map(|value| {
                comment_re
                    .replace_all(value.as_str(), "")
                    .trim()
                    .to_string()
            })
            .filter(|value| !value.is_empty())
    };

    for cap in dep_block_re.captures_iter(raw) {
        let Some(block) = cap.get(1).map(|m| m.as_str()) else {
            continue;
        };
        let scope = tag_value(block, "scope").unwrap_or_default();
        if matches!(scope.as_str(), "test" | "provided" | "system" | "import") {
            continue;
        }
        if tag_value(block, "optional")
            .map(|value| value.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
        {
            continue;
        }

        let Some(group) = tag_value(block, "groupId") else {
            continue;
        };
        let Some(artifact) = tag_value(block, "artifactId") else {
            continue;
        };
        let Some(version) = tag_value(block, "version") else {
            continue;
        };
        if version.contains("${") {
            continue;
        }
        let classifier = tag_value(block, "classifier");
        let extension = tag_value(block, "type").unwrap_or_else(|| "jar".to_string());

        out.push(MavenCoordinate {
            group,
            artifact,
            version,
            classifier,
            extension,
        });
    }

    out
}

#[cfg(test)]
mod tests {
    use super::parse_dependencies_from_pom;

    #[test]
    fn parse_dependencies_strips_xml_comments_in_versions() {
        let pom = r#"
            <project>
              <dependencies>
                <dependency>
                  <groupId>org.checkerframework</groupId>
                  <artifactId>javacutil</artifactId>
                  <version><!-- checker-framework-version -->1.8.10<!-- /checker-framework-version --></version>
                </dependency>
              </dependencies>
            </project>
        "#;

        let deps = parse_dependencies_from_pom(pom);
        assert_eq!(deps.len(), 1);
        assert_eq!(deps[0].version, "1.8.10");
    }
}
