import { invokeWithHandling } from "./tauriClient";

export interface CurseforgeFingerprintFile {
  path: string;
  fileName: string;
  fingerprint: number;
  matched: boolean;
  modId?: number;
  fileId?: number;
  modName?: string;
}

export interface CurseforgeFingerprintScanResult {
  files: CurseforgeFingerprintFile[];
  unmatchedFingerprints: number[];
}

export interface CurseforgeDownloadResolution {
  modId: number;
  fileId: number;
  canAutoDownload: boolean;
  downloadUrl?: string;
  websiteUrl?: string;
  reason: string;
}

export type CurseforgeDownloadAction =
  | {
      kind: "auto";
      downloadUrl: string;
      reason: string;
    }
  | {
      kind: "manual";
      websiteUrl?: string;
      reason: string;
    };

export const scanLocalModsWithCurseforgeFingerprints = async (
  modsDir: string,
): Promise<CurseforgeFingerprintScanResult> =>
  invokeWithHandling<CurseforgeFingerprintScanResult>("curseforge_scan_fingerprints", {
    modsDir,
  });

export const resolveCurseforgeDownloadAction = async (
  modId: number,
  fileId: number,
): Promise<CurseforgeDownloadAction> => {
  const resolution = await invokeWithHandling<CurseforgeDownloadResolution>(
    "curseforge_resolve_download",
    {
      modId,
      fileId,
    },
  );

  if (resolution.canAutoDownload && resolution.downloadUrl) {
    return {
      kind: "auto",
      downloadUrl: resolution.downloadUrl,
      reason: resolution.reason,
    };
  }

  return {
    kind: "manual",
    websiteUrl: resolution.websiteUrl,
    reason: resolution.reason,
  };
};
