export interface ExportFileEntry {
  path: string;
  sha1?: string;
  sha256?: string;
  size?: number;
  url?: string;
  projectId?: string;
  versionId?: string;
  curseforgeProjectId?: number;
  curseforgeFileId?: number;
}

export interface ExportManifestBase {
  name: string;
  version: string;
  minecraftVersion: string;
  loader: string;
  loaderVersion?: string;
  files: ExportFileEntry[];
}

export const buildCurseforgeManifest = ({
  name,
  version,
  minecraftVersion,
  loader,
  loaderVersion,
  files,
}: ExportManifestBase) => ({
  manifestType: "minecraftModpack",
  manifestVersion: 1,
  name,
  version,
  minecraft: {
    version: minecraftVersion,
    modLoaders: [
      {
        id: loaderVersion ? `${loader}-${loaderVersion}` : loader,
        primary: true,
      },
    ],
  },
  files: files
    .filter((file) => file.curseforgeProjectId && file.curseforgeFileId)
    .map((file) => ({
      projectID: file.curseforgeProjectId,
      fileID: file.curseforgeFileId,
      required: true,
    })),
  overrides: "overrides",
});

export const buildModrinthIndex = ({
  name,
  version,
  minecraftVersion,
  loader,
  files,
}: ExportManifestBase) => ({
  formatVersion: 1,
  game: "minecraft",
  versionId: version,
  name,
  summary: `${name} - ${version}`,
  files: files
    .filter((file) => file.sha1 && file.path)
    .map((file) => ({
      path: file.path,
      hashes: {
        sha1: file.sha1,
        sha256: file.sha256,
      },
      downloads: file.url ? [file.url] : [],
      fileSize: file.size,
    })),
  dependencies: {
    minecraft: minecraftVersion,
    [loader]: loader,
  },
});

export const buildATLauncherInstance = ({
  name,
  version,
  minecraftVersion,
  loader,
  loaderVersion,
  files,
}: ExportManifestBase) => ({
  manifestType: "ATLauncher",
  name,
  version,
  minecraftVersion,
  loader,
  loaderVersion,
  mods: files.map((file) => ({
    path: file.path,
    sha1: file.sha1,
    sha256: file.sha256,
  })),
});

export const validateExportFiles = (files: ExportFileEntry[]) =>
  files.every((file) => Boolean(file.path) && (file.sha1 || file.sha256));
