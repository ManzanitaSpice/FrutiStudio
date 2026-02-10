import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-opener";

import { apiFetch } from "./apiClients/client";
import { shouldUpdate } from "../utils/semver";

import packageJson from "../../package.json";

export interface VersionManifest {
  version: string;
  url: string;
  notes: string[];
  date: string;
  sha256?: string;
}

export interface UpdateHistoryEntry extends VersionManifest {
  checkedAt: string;
}

export interface UpdateStatus {
  localVersion: string;
  latest: VersionManifest | null;
  updateAvailable: boolean;
  history: UpdateHistoryEntry[];
  lastCheckedAt?: string;
}

export interface DownloadProgress {
  loaded: number;
  total?: number;
  percent?: number;
}

const RELEASE_MANIFEST_URL =
  "https://github.com/ManzanitaSpice/FrutiStudio/releases/latest/download/version.json";
const HISTORY_KEY = "frutistudio.update.history";
const LAST_CHECK_KEY = "frutistudio.update.lastCheck";

const readHistory = (): UpdateHistoryEntry[] => {
  const raw = localStorage.getItem(HISTORY_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as UpdateHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeHistory = (history: UpdateHistoryEntry[]) => {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
};

const upsertHistory = (entry: UpdateHistoryEntry) => {
  const history = readHistory();
  const existingIndex = history.findIndex(
    (item) => item.version === entry.version,
  );
  if (existingIndex >= 0) {
    history[existingIndex] = { ...history[existingIndex], ...entry };
  } else {
    history.unshift(entry);
  }
  writeHistory(history.slice(0, 25));
};

const safeGetVersion = async () => {
  try {
    return await getVersion();
  } catch {
    return packageJson.version ?? "0.0.0";
  }
};

export const fetchLatestManifest = async (): Promise<VersionManifest> =>
  apiFetch<VersionManifest>(RELEASE_MANIFEST_URL, { ttl: 300_000 });

export const getUpdateStatus = async (): Promise<UpdateStatus> => {
  const [localVersion, latest] = await Promise.all([
    safeGetVersion(),
    fetchLatestManifest().catch(() => null),
  ]);
  const updateAvailable = latest
    ? shouldUpdate(localVersion, latest.version)
    : false;

  const lastCheckedAt = new Date().toISOString();
  localStorage.setItem(LAST_CHECK_KEY, lastCheckedAt);

  if (latest) {
    upsertHistory({ ...latest, checkedAt: lastCheckedAt });
  }

  return {
    localVersion,
    latest,
    updateAvailable,
    history: readHistory(),
    lastCheckedAt,
  };
};

export const getStoredUpdateHistory = () => readHistory();

const getFileName = (url: string, version: string) => {
  const fromUrl = url.split("?")[0].split("/").pop();
  if (fromUrl && fromUrl.includes(".")) {
    return fromUrl;
  }
  return `FrutiLauncher-${version}`;
};

const digestSha256 = async (data: ArrayBuffer) => {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const downloadUpdate = async (
  manifest: VersionManifest,
  onProgress?: (progress: DownloadProgress) => void,
) => {
  const response = await fetch(manifest.url);
  if (!response.ok) {
    throw new Error(`Error descargando actualización (${response.status}).`);
  }
  if (!response.body) {
    await open(manifest.url);
    return;
  }

  const total = Number(response.headers.get("content-length") ?? "0") || undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      chunks.push(value);
      loaded += value.length;
      if (onProgress) {
        onProgress({
          loaded,
          total,
          percent: total ? Math.round((loaded / total) * 100) : undefined,
        });
      }
    }
  }

  const blob = new Blob(chunks);
  if (manifest.sha256) {
    const buffer = await blob.arrayBuffer();
    const hash = await digestSha256(buffer);
    if (hash.toLowerCase() !== manifest.sha256.toLowerCase()) {
      throw new Error("El checksum SHA256 no coincide.");
    }
  }

  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = getFileName(manifest.url, manifest.version);
  anchor.rel = "noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(blobUrl);
};
