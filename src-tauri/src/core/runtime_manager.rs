use std::fs;
use std::path::{Path, PathBuf};

use flate2::read::GzDecoder;
use serde_json::Value;
use tar::Archive;

use crate::{download_with_retries, java_bin_name, launcher_root};

const ADOPTIUM_RELEASES: &str = "https://api.adoptium.net/v3/assets/latest";

pub(crate) struct RuntimeManager {
    runtime_root: PathBuf,
}

impl RuntimeManager {
    pub(crate) fn new(app: &tauri::AppHandle) -> Result<Self, String> {
        Ok(Self {
            runtime_root: launcher_root(app)?.join("runtime"),
        })
    }

    pub(crate) async fn ensure_runtime_for_java_major(
        &self,
        java_major: u32,
    ) -> Result<PathBuf, String> {
        let runtime_id = runtime_folder_name(java_major);
        let destination_root = self.runtime_root.join(runtime_id);
        let java_path = destination_root.join("bin").join(java_bin_name());
        if java_path.is_file() {
            return Ok(java_path);
        }

        fs::create_dir_all(&self.runtime_root)
            .map_err(|error| format!("No se pudo crear carpeta runtime: {error}"))?;

        let package_url = self.resolve_runtime_package(java_major).await?;
        let archive_name = package_url
            .split('/')
            .next_back()
            .unwrap_or("runtime-download.tar.gz");
        let cache_path = self
            .runtime_root
            .join("downloads")
            .join(runtime_id)
            .join(archive_name);

        if let Some(parent) = cache_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("No se pudo crear carpeta de caché runtime: {error}"))?;
        }

        download_with_retries(
            &[package_url],
            &cache_path,
            None,
            3,
            cache_path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("zip")),
        )
        .await?;

        if destination_root.exists() {
            let _ = fs::remove_dir_all(&destination_root);
        }
        fs::create_dir_all(&destination_root)
            .map_err(|error| format!("No se pudo preparar carpeta del runtime: {error}"))?;

        unpack_runtime_archive(&cache_path, &destination_root)?;
        let resolved_java = find_java_in_runtime(&destination_root).ok_or_else(|| {
            format!(
                "No se encontró binario Java en {}",
                destination_root.display()
            )
        })?;

        if resolved_java != java_path {
            if let Some(parent) = java_path.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    format!("No se pudo crear carpeta bin del runtime: {error}")
                })?;
            }
            fs::copy(&resolved_java, &java_path).map_err(|error| {
                format!(
                    "No se pudo normalizar ruta Java {} -> {}: {error}",
                    resolved_java.display(),
                    java_path.display()
                )
            })?;
        }

        validate_java_runtime(&java_path)?;

        Ok(java_path)
    }

    async fn resolve_runtime_package(&self, java_major: u32) -> Result<String, String> {
        let arch = match std::env::consts::ARCH {
            "x86_64" => "x64",
            "aarch64" => "aarch64",
            "x86" => "x86-32",
            other => {
                return Err(format!(
                    "Arquitectura no soportada para runtime embebido: {other}"
                ))
            }
        };

        let image = "jre";
        let os = if cfg!(target_os = "windows") {
            "windows"
        } else if cfg!(target_os = "macos") {
            "mac"
        } else {
            "linux"
        };

        let url = format!(
            "{ADOPTIUM_RELEASES}/{java_major}/hotspot?architecture={arch}&heap_size=normal&image_type={image}&jvm_impl=hotspot&os={os}&project=jdk"
        );
        let assets = reqwest::get(url)
            .await
            .map_err(|error| format!("No se pudo consultar runtimes de Adoptium: {error}"))?
            .json::<Vec<Value>>()
            .await
            .map_err(|error| format!("No se pudo parsear respuesta de Adoptium: {error}"))?;

        let package = assets.into_iter().find_map(|asset| {
            asset
                .get("binary")
                .and_then(|binary| binary.get("package"))
                .and_then(|package| package.get("link"))
                .and_then(|link| link.as_str())
                .map(str::to_string)
        });

        package.ok_or_else(|| {
            format!("No hay runtime Java {java_major} disponible para esta plataforma")
        })
    }
}

fn validate_java_runtime(java_path: &Path) -> Result<(), String> {
    let output = std::process::Command::new(java_path)
        .arg("-version")
        .output()
        .map_err(|error| {
            format!(
                "No se pudo ejecutar Java embebido {}: {error}",
                java_path.display()
            )
        })?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    Err(format!(
        "Java embebido inválido ({}). stdout: {} stderr: {}",
        java_path.display(),
        stdout.trim(),
        stderr.trim()
    ))
}

fn runtime_folder_name(java_major: u32) -> &'static str {
    match java_major {
        8 => "java8",
        17 => "java17",
        _ => "java21",
    }
}

fn unpack_runtime_archive(archive_path: &Path, destination: &Path) -> Result<(), String> {
    let extension = archive_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_lowercase();

    if extension == "zip" {
        let file = fs::File::open(archive_path)
            .map_err(|error| format!("No se pudo abrir runtime zip: {error}"))?;
        let mut zip = zip::ZipArchive::new(file)
            .map_err(|error| format!("No se pudo leer runtime zip: {error}"))?;
        for i in 0..zip.len() {
            let mut entry = zip
                .by_index(i)
                .map_err(|error| format!("No se pudo leer entrada zip: {error}"))?;
            let name = entry.name();
            let relative = trim_archive_root(name);
            if relative.is_empty() {
                continue;
            }
            let target = destination.join(relative);
            if entry.is_dir() {
                fs::create_dir_all(&target)
                    .map_err(|error| format!("No se pudo crear carpeta runtime: {error}"))?;
            } else {
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent).map_err(|error| {
                        format!("No se pudo crear carpeta para archivo runtime: {error}")
                    })?;
                }
                let mut out = fs::File::create(&target)
                    .map_err(|error| format!("No se pudo crear archivo runtime: {error}"))?;
                std::io::copy(&mut entry, &mut out)
                    .map_err(|error| format!("No se pudo extraer runtime: {error}"))?;
            }
        }
        return Ok(());
    }

    let file = fs::File::open(archive_path)
        .map_err(|error| format!("No se pudo abrir runtime archive: {error}"))?;
    let decoder = GzDecoder::new(file);
    let mut archive = Archive::new(decoder);

    for entry in archive
        .entries()
        .map_err(|error| format!("No se pudo leer entradas tar runtime: {error}"))?
    {
        let mut entry = entry.map_err(|error| format!("Entrada tar inválida: {error}"))?;
        let raw_path = entry
            .path()
            .map_err(|error| format!("No se pudo leer path tar runtime: {error}"))?;
        let relative = trim_archive_root(raw_path.to_string_lossy().as_ref());
        if relative.is_empty() {
            continue;
        }

        let target = destination.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("No se pudo crear carpeta runtime: {error}"))?;
        }
        entry
            .unpack(&target)
            .map_err(|error| format!("No se pudo descomprimir runtime: {error}"))?;
    }

    Ok(())
}

fn trim_archive_root(path: &str) -> String {
    let mut components = path.split('/');
    components.next();
    components.collect::<Vec<_>>().join("/")
}

fn find_java_in_runtime(root: &Path) -> Option<PathBuf> {
    let direct = root.join("bin").join(java_bin_name());
    if direct.is_file() {
        return Some(direct);
    }

    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let nested = path.join("bin").join(java_bin_name());
        if nested.is_file() {
            return Some(nested);
        }
    }

    None
}
