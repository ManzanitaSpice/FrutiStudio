import { invokeWithHandling } from "./tauriClient";
import { fetchExplorerItems } from "./explorerService";
import { fetchMinecraftVersions } from "./versionService";
import { fetchLoaderVersions } from "./loaderVersionService";

export interface StartupFile {
  relativePath: string;
  sizeBytes: number;
}

export const collectStartupFiles = async () =>
  invokeWithHandling<StartupFile[]>("collect_startup_files");

const warmupLoaderCatalog = async () => {
  const versions = await fetchMinecraftVersions();
  const releaseCandidates = versions
    .filter((item) => item.type === "release")
    .slice(0, 2)
    .map((item) => item.id);

  if (!releaseCandidates.length) {
    return;
  }

  const loaders: Array<"Forge" | "Fabric" | "Quilt" | "NeoForge"> = [
    "Forge",
    "Fabric",
    "Quilt",
    "NeoForge",
  ];

  const requests: Promise<unknown>[] = [];
  for (const version of releaseCandidates) {
    for (const loader of loaders) {
      requests.push(fetchLoaderVersions(loader, version));
    }
  }

  await Promise.allSettled(requests);
};

export const preloadStartupCatalogs = async () => {
  await Promise.allSettled([
    fetchExplorerItems("Modpacks"),
    fetchExplorerItems("Mods"),
    warmupLoaderCatalog(),
  ]);
};
