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

    pub fn key_without_version(&self) -> String {
        format!("{}:{}", self.group, self.artifact)
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

    if !library_declares_experimental_jetbrains_repo(library) {
        repos.retain(|repo| !is_experimental_jetbrains_repo(repo));
    }

    repos
}

pub fn default_repositories() -> Vec<String> {
    vec![
        "https://libraries.minecraft.net".to_string(),
        "https://repo1.maven.org/maven2".to_string(),
        "https://packages.jetbrains.team/maven/p/ij/intellij-dependencies".to_string(),
        "https://maven.minecraftforge.net".to_string(),
        "https://maven.neoforged.net/releases".to_string(),
        "https://maven.fabricmc.net".to_string(),
        "https://maven.quiltmc.org/repository/release".to_string(),
        "https://repo.maven.apache.org/maven2".to_string(),
    ]
}

fn library_declares_experimental_jetbrains_repo(library: &Value) -> bool {
    library
        .get("url")
        .and_then(Value::as_str)
        .map(is_experimental_jetbrains_repo)
        .unwrap_or(false)
}

fn is_experimental_jetbrains_repo(repo: &str) -> bool {
    let normalized = repo.trim().trim_end_matches('/');
    normalized.starts_with("https://maven.pkg.jetbrains.space/kotlin/p/kotlin/dev")
        || normalized.starts_with("https://maven.pkg.jetbrains.space/kotlin/p/kotlin/eap")
        || normalized.starts_with("https://maven.pkg.jetbrains.space/kotlin/p/kotlin/bootstrap")
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

    if let Some(processors) = install_profile.get("processors").and_then(Value::as_array) {
        for processor in processors {
            let mut register_coordinate = |value: Option<&str>| {
                let Some(raw) = value.map(str::trim).filter(|value| !value.is_empty()) else {
                    return;
                };
                if !seen.insert(raw.to_string()) {
                    return;
                }
                out.push(serde_json::json!({ "name": raw }));
            };

            register_coordinate(processor.get("jar").and_then(Value::as_str));

            if let Some(classpath) = processor.get("classpath").and_then(Value::as_array) {
                for entry in classpath {
                    register_coordinate(entry.as_str());
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
    #[derive(Clone)]
    struct QueueItem {
        coordinate: MavenCoordinate,
        exclusions: HashSet<String>,
    }

    let mut queue: VecDeque<QueueItem> = roots
        .iter()
        .cloned()
        .map(|coordinate| QueueItem {
            coordinate,
            exclusions: HashSet::new(),
        })
        .collect();
    let mut seen = HashSet::new();
    let mut resolved = Vec::new();
    let mut cache = HashMap::<String, ParsedPom>::new();

    while let Some(item) = queue.pop_front() {
        if item
            .exclusions
            .contains(&item.coordinate.key_without_version())
        {
            continue;
        }

        let mut current = item.coordinate;
        if !seen.insert(current.key_without_ext()) {
            continue;
        }

        let parsed = if let Some(cached) = cache.get(&current.key_without_ext()) {
            cached.clone()
        } else {
            let parsed = fetch_pom_model(client, &current, repositories)
                .await
                .unwrap_or_default();
            cache.insert(current.key_without_ext(), parsed.clone());
            parsed
        };

        if parsed.packaging == "pom" && current.classifier.is_none() {
            current.extension = "pom".to_string();
        }

        resolved.push(current.clone());

        for dep in parsed.dependencies {
            if matches!(
                dep.scope.as_str(),
                "test" | "provided" | "system" | "import"
            ) || dep.optional
            {
                continue;
            }
            let Some(version) = dep.version.or_else(|| {
                parsed
                    .managed_versions
                    .get(&dep.key_without_version())
                    .cloned()
            }) else {
                continue;
            };
            if version.contains("${") {
                continue;
            }
            let dep_exclusions = dep.exclusions.clone();
            let dep = MavenCoordinate {
                group: dep.group,
                artifact: dep.artifact,
                version,
                classifier: dep.classifier,
                extension: dep.extension,
            };

            if !seen.contains(&dep.key_without_ext()) {
                let mut nested_exclusions = item.exclusions.clone();
                nested_exclusions.extend(dep_exclusions);
                queue.push_back(QueueItem {
                    coordinate: dep,
                    exclusions: nested_exclusions,
                });
            }
        }
    }

    resolved
}

#[derive(Debug, Clone, Default)]
struct ParsedPom {
    packaging: String,
    managed_versions: HashMap<String, String>,
    dependencies: Vec<DeclaredDependency>,
}

#[derive(Debug, Clone, Default)]
struct DeclaredDependency {
    group: String,
    artifact: String,
    version: Option<String>,
    classifier: Option<String>,
    extension: String,
    scope: String,
    optional: bool,
    exclusions: HashSet<String>,
}

impl DeclaredDependency {
    fn key_without_version(&self) -> String {
        format!("{}:{}", self.group, self.artifact)
    }
}

async fn fetch_pom_model(
    client: &reqwest::Client,
    coordinate: &MavenCoordinate,
    repositories: &[String],
) -> Result<ParsedPom, String> {
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
        return Ok(ParsedPom::default());
    };

    Ok(parse_pom_model(&raw, coordinate))
}

fn parse_pom_model(raw: &str, coordinate: &MavenCoordinate) -> ParsedPom {
    let dep_block_re = Regex::new(r"(?s)<dependency>(.*?)</dependency>").expect("regex dep");
    let dep_mgmt_re = Regex::new(r"(?s)<dependencyManagement>\s*<dependencies>(.*?)</dependencies>\s*</dependencyManagement>").expect("regex dep mgmt");
    let properties_re =
        Regex::new(r"(?s)<properties>(.*?)</properties>").expect("regex properties");
    let exclusions_re = Regex::new(r"(?s)<exclusion>(.*?)</exclusion>").expect("regex exclusion");
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

    let mut properties = HashMap::new();
    properties.insert("project.groupId".to_string(), coordinate.group.clone());
    properties.insert(
        "project.artifactId".to_string(),
        coordinate.artifact.clone(),
    );
    properties.insert("project.version".to_string(), coordinate.version.clone());

    if let Some(block) = properties_re
        .captures(raw)
        .and_then(|cap| cap.get(1).map(|m| m.as_str()))
    {
        let prop_re = Regex::new(r"(?s)<([A-Za-z0-9_.-]+)>\s*(.*?)\s*</([A-Za-z0-9_.-]+)>")
            .expect("regex prop item");
        for prop in prop_re.captures_iter(block) {
            let Some(open_tag) = prop.get(1).map(|m| m.as_str()) else {
                continue;
            };
            let Some(close_tag) = prop.get(3).map(|m| m.as_str()) else {
                continue;
            };
            if open_tag != close_tag {
                continue;
            }
            let Some(value) = prop.get(2).map(|m| m.as_str().trim()) else {
                continue;
            };
            if !value.is_empty() {
                properties.insert(open_tag.to_string(), value.to_string());
            }
        }
    }

    let packaging = tag_value(raw, "packaging")
        .map(|value| substitute_properties(&value, &properties))
        .unwrap_or_else(|| "jar".to_string());

    let mut managed_versions = HashMap::new();
    if let Some(block) = dep_mgmt_re
        .captures(raw)
        .and_then(|cap| cap.get(1).map(|m| m.as_str()))
    {
        for cap in dep_block_re.captures_iter(block) {
            let Some(dep_block) = cap.get(1).map(|m| m.as_str()) else {
                continue;
            };
            let Some(group) = tag_value(dep_block, "groupId") else {
                continue;
            };
            let Some(artifact) = tag_value(dep_block, "artifactId") else {
                continue;
            };
            let Some(version) = tag_value(dep_block, "version") else {
                continue;
            };
            let resolved = substitute_properties(&version, &properties);
            managed_versions.insert(format!("{group}:{artifact}"), resolved);
        }
    }

    let mut dependencies = Vec::new();
    let dependency_sections = dep_mgmt_re.replace_all(raw, "");
    for cap in dep_block_re.captures_iter(dependency_sections.as_ref()) {
        let Some(block) = cap.get(1).map(|m| m.as_str()) else {
            continue;
        };

        let Some(group) = tag_value(block, "groupId") else {
            continue;
        };
        let Some(artifact) = tag_value(block, "artifactId") else {
            continue;
        };
        let version =
            tag_value(block, "version").map(|value| substitute_properties(&value, &properties));
        let classifier = tag_value(block, "classifier");
        let extension = tag_value(block, "type")
            .map(|value| substitute_properties(&value, &properties))
            .unwrap_or_else(|| "jar".to_string());
        let scope = tag_value(block, "scope")
            .map(|value| substitute_properties(&value, &properties))
            .unwrap_or_default();
        let optional = tag_value(block, "optional")
            .map(|value| value.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        let mut exclusions = HashSet::new();
        for exclusion in exclusions_re.captures_iter(block) {
            let Some(exclusion_block) = exclusion.get(1).map(|m| m.as_str()) else {
                continue;
            };
            let Some(ex_group) = tag_value(exclusion_block, "groupId") else {
                continue;
            };
            let Some(ex_artifact) = tag_value(exclusion_block, "artifactId") else {
                continue;
            };
            exclusions.insert(format!("{ex_group}:{ex_artifact}"));
        }

        dependencies.push(DeclaredDependency {
            group,
            artifact,
            version,
            classifier,
            extension,
            scope,
            optional,
            exclusions,
        });
    }

    ParsedPom {
        packaging,
        managed_versions,
        dependencies,
    }
}

fn substitute_properties(value: &str, properties: &HashMap<String, String>) -> String {
    let re = Regex::new(r"\$\{([^}]+)\}").expect("regex property");
    re.replace_all(value, |caps: &regex::Captures<'_>| {
        let key = caps.get(1).map(|m| m.as_str()).unwrap_or_default();
        properties.get(key).cloned().unwrap_or_else(|| {
            caps.get(0)
                .map(|m| m.as_str())
                .unwrap_or_default()
                .to_string()
        })
    })
    .trim()
    .to_string()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{default_repositories, parse_pom_model, repositories_for_library, MavenCoordinate};

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

        let deps = parse_pom_model(
            pom,
            &MavenCoordinate::parse("org.checkerframework:checker-framework:1.0.0").unwrap(),
        );
        assert_eq!(deps.dependencies.len(), 1);
        assert_eq!(deps.dependencies[0].version.as_deref(), Some("1.8.10"));
    }

    #[test]
    fn parse_pom_model_applies_dependency_management_and_packaging() {
        let pom = r#"
            <project>
              <packaging>pom</packaging>
              <properties><lib.ver>2.0.0</lib.ver></properties>
              <dependencyManagement>
                <dependencies>
                  <dependency>
                    <groupId>com.example</groupId>
                    <artifactId>managed-lib</artifactId>
                    <version>${lib.ver}</version>
                  </dependency>
                </dependencies>
              </dependencyManagement>
              <dependencies>
                <dependency>
                  <groupId>com.example</groupId>
                  <artifactId>managed-lib</artifactId>
                </dependency>
              </dependencies>
            </project>
        "#;

        let parsed = parse_pom_model(
            pom,
            &MavenCoordinate::parse("com.example:bundle:1.0.0").unwrap(),
        );
        assert_eq!(parsed.packaging, "pom");
        assert_eq!(
            parsed.managed_versions.get("com.example:managed-lib"),
            Some(&"2.0.0".to_string())
        );
    }

    #[test]
    fn default_repositories_keep_stable_sources_only() {
        let repositories = default_repositories();
        assert!(repositories
            .iter()
            .all(|repo| !repo.contains("maven.pkg.jetbrains.space/kotlin/p/kotlin/")));
        assert!(repositories
            .iter()
            .any(|repo| repo == "https://repo.maven.apache.org/maven2"));
        assert!(repositories
            .iter()
            .any(|repo| repo == "https://repo1.maven.org/maven2"));
        assert!(
            repositories
                .iter()
                .any(|repo| repo
                    == "https://packages.jetbrains.team/maven/p/ij/intellij-dependencies")
        );
    }

    #[test]
    fn repositories_for_library_keep_declared_experimental_repo() {
        let library = json!({
            "name": "org.jetbrains.kotlin:kotlin-stdlib:2.1.0",
            "url": "https://maven.pkg.jetbrains.space/kotlin/p/kotlin/bootstrap/"
        });

        let repositories = repositories_for_library(&library, &default_repositories());
        assert_eq!(
            repositories.first().map(String::as_str),
            Some("https://maven.pkg.jetbrains.space/kotlin/p/kotlin/bootstrap")
        );
        assert!(repositories
            .iter()
            .any(|repo| repo == "https://repo.maven.apache.org/maven2"));
    }
}
