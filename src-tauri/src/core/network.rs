use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModpackAction {
    pub(crate) action: String,
    pub(crate) id: String,
    pub(crate) name: Option<String>,
    pub(crate) version: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SelectFolderResult {
    pub(crate) ok: bool,
    pub(crate) path: Option<String>,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FingerprintScanResult {
    pub(crate) files: Vec<FingerprintFileResult>,
    pub(crate) unmatched_fingerprints: Vec<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FingerprintFileResult {
    pub(crate) path: String,
    pub(crate) file_name: String,
    pub(crate) fingerprint: u32,
    pub(crate) matched: bool,
    pub(crate) mod_id: Option<u32>,
    pub(crate) file_id: Option<u32>,
    pub(crate) mod_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CurseforgeDownloadResolution {
    pub(crate) mod_id: u32,
    pub(crate) file_id: u32,
    pub(crate) can_auto_download: bool,
    pub(crate) download_url: Option<String>,
    pub(crate) website_url: Option<String>,
    pub(crate) reason: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct FingerprintsRequestBody {
    pub(crate) fingerprints: Vec<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CurseforgeFingerprintsEnvelope {
    pub(crate) data: CurseforgeFingerprintsData,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CurseforgeFingerprintsData {
    pub(crate) exact_matches: Vec<CurseforgeFingerprintMatch>,
    #[serde(default)]
    pub(crate) unmatched_fingerprints: Vec<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CurseforgeFingerprintMatch {
    pub(crate) id: u32,
    pub(crate) file: CurseforgeMatchedFile,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CurseforgeMatchedFile {
    pub(crate) id: u32,
    pub(crate) file_name: String,
    #[serde(default)]
    pub(crate) file_fingerprint: u32,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CurseforgeModEnvelope {
    pub(crate) data: CurseforgeModData,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CurseforgeModData {
    pub(crate) name: Option<String>,
    pub(crate) links: Option<CurseforgeModLinks>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CurseforgeModLinks {
    pub(crate) website_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CurseforgeFileEnvelope {
    pub(crate) data: CurseforgeFileData,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CurseforgeFileData {
    pub(crate) download_url: Option<String>,
    pub(crate) is_available: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct MojangVersionManifest {
    pub(crate) versions: Vec<MojangVersionEntry>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct MojangVersionEntry {
    pub(crate) id: String,
    pub(crate) url: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct MojangVersionDetail {
    pub(crate) downloads: MojangVersionDownloads,
}

#[derive(Debug, Deserialize)]
pub(crate) struct MojangVersionDownloads {
    pub(crate) client: MojangDownload,
}

#[derive(Debug, Deserialize)]
pub(crate) struct MojangDownload {
    pub(crate) url: String,
}
