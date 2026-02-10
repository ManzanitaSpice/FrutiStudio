import { fetchCurseforgeFilesByIds } from "./apiClients/curseforge";

export interface CurseforgeManifest {
  minecraft: {
    version: string;
    modLoaders: Array<{ id: string; primary?: boolean }>;
  };
  files: Array<{ projectID: number; fileID: number; required?: boolean }>;
  overrides?: string;
}

interface CurseforgeFile {
  id: number;
  modId: number;
  fileName: string;
  downloadUrl?: string;
  dependencies?: Array<{ modId: number; relationType: number }>;
}

export interface ResolvedModpackMod {
  projectID: number;
  fileID: number;
  fileName: string;
  downloadUrl: string;
  dependencies: number[];
  missingDependencies: number[];
}

export interface ResolvedCurseforgeModpack {
  minecraftVersion: string;
  loader: string;
  overridesDir: string;
  mods: ResolvedModpackMod[];
}

const REQUIRED_RELATIONS = new Set([1, 2, 3]);

const parseFile = (item: unknown): CurseforgeFile => {
  const record = item as Record<string, unknown>;
  return {
    id: Number(record.id ?? 0),
    modId: Number(record.modId ?? 0),
    fileName: String(record.fileName ?? ""),
    downloadUrl: record.downloadUrl ? String(record.downloadUrl) : undefined,
    dependencies:
      (record.dependencies as
        | Array<{ modId: number; relationType: number }>
        | undefined) ?? [],
  };
};

export const resolveCurseforgeManifest = async (
  manifest: CurseforgeManifest,
  apiKey?: string,
): Promise<ResolvedCurseforgeModpack> => {
  const fileIds = manifest.files.map((file) => file.fileID);
  const filesResponse = await fetchCurseforgeFilesByIds(fileIds, apiKey);
  const files = (filesResponse.data ?? []).map(parseFile);

  const filesById = new Map(files.map((file) => [file.id, file]));
  const filesByProject = new Map(files.map((file) => [file.modId, file]));

  const mods = manifest.files
    .map((entry) => {
      const file = filesById.get(entry.fileID);
      if (!file?.downloadUrl) {
        return null;
      }

      const dependencyProjects = (file.dependencies ?? [])
        .filter((dependency) => REQUIRED_RELATIONS.has(dependency.relationType))
        .map((dependency) => dependency.modId);

      const installedDependencies = dependencyProjects.filter((projectId) =>
        filesByProject.has(projectId),
      );
      const missingDependencies = dependencyProjects.filter(
        (projectId) => !filesByProject.has(projectId),
      );

      return {
        projectID: entry.projectID,
        fileID: file.id,
        fileName: file.fileName,
        downloadUrl: file.downloadUrl,
        dependencies: installedDependencies,
        missingDependencies,
      };
    })
    .filter((item): item is ResolvedModpackMod => Boolean(item));

  if (mods.length === 0 && manifest.files.length > 0) {
    throw new Error(
      "No se pudieron resolver archivos descargables del manifest CurseForge.",
    );
  }

  const loader =
    manifest.minecraft.modLoaders.find((item) => item.primary)?.id ??
    manifest.minecraft.modLoaders[0]?.id ??
    "vanilla";

  return {
    minecraftVersion: manifest.minecraft.version,
    loader,
    overridesDir: manifest.overrides ?? "overrides",
    mods,
  };
};
