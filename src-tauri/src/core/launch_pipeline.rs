use std::fs;
use std::path::{Path, PathBuf};

pub(crate) const CANONICAL_LAUNCHER_DIRS: [&str; 11] = [
    "runtime",
    "versions",
    "libraries",
    "assets",
    "instances",
    "downloads",
    "logs",
    ".fruti_cache",
    ".fruti_cache/assets",
    ".fruti_cache/libraries",
    ".fruti_cache/versions",
];

#[derive(Debug, Clone)]
pub(crate) struct LauncherDataLayout {
    pub(crate) root: PathBuf,
    pub(crate) runtime: PathBuf,
    pub(crate) versions: PathBuf,
    pub(crate) libraries: PathBuf,
    pub(crate) assets: PathBuf,
    pub(crate) instances: PathBuf,
}

impl LauncherDataLayout {
    pub(crate) fn from_root(root: &Path) -> Self {
        Self {
            root: root.to_path_buf(),
            runtime: root.join("runtime"),
            versions: root.join("versions"),
            libraries: root.join("libraries"),
            assets: root.join("assets"),
            instances: root.join("instances"),
        }
    }

    pub(crate) fn ensure(&self) -> Result<(), String> {
        fs::create_dir_all(&self.root)
            .map_err(|error| format!("No se pudo crear launcher_data raíz: {error}"))?;

        for path in [
            &self.runtime,
            &self.versions,
            &self.libraries,
            &self.assets,
            &self.instances,
            &self.root.join("downloads"),
            &self.root.join("logs"),
            &self.root.join(".fruti_cache"),
            &self.root.join(".fruti_cache").join("assets"),
            &self.root.join(".fruti_cache").join("libraries"),
            &self.root.join(".fruti_cache").join("versions"),
        ] {
            fs::create_dir_all(path).map_err(|error| {
                format!(
                    "No se pudo crear carpeta de launcher_data {}: {error}",
                    path.display()
                )
            })?;
        }

        Ok(())
    }
}
