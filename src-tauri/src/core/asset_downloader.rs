use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::Semaphore;

#[derive(Debug, Clone)]
pub(crate) struct AssetDownloadTask {
    pub(crate) url_candidates: Vec<String>,
    pub(crate) destination: PathBuf,
    pub(crate) expected_sha1: Option<String>,
}

pub(crate) async fn download_assets_parallel<F, Fut>(
    tasks: Vec<AssetDownloadTask>,
    concurrency: usize,
    downloader: F,
) -> Result<(), String>
where
    F: Fn(AssetDownloadTask) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = Result<(), String>> + Send,
{
    if tasks.is_empty() {
        return Ok(());
    }

    let permit_count = concurrency.max(1);
    let semaphore = Arc::new(Semaphore::new(permit_count));
    let downloader = Arc::new(downloader);

    let mut handles = Vec::with_capacity(tasks.len());
    for task in tasks {
        let semaphore = Arc::clone(&semaphore);
        let downloader = Arc::clone(&downloader);
        handles.push(tokio::spawn(async move {
            let _permit = semaphore
                .acquire_owned()
                .await
                .map_err(|error| format!("No se pudo adquirir semáforo de assets: {error}"))?;
            downloader(task).await
        }));
    }

    for handle in handles {
        let outcome = handle
            .await
            .map_err(|error| format!("La tarea de descarga de assets falló: {error}"))?;
        outcome?;
    }

    Ok(())
}
