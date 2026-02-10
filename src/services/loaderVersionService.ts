import { apiFetch } from "./apiClients/client";

type LoaderType = "Vanilla" | "NeoForge" | "Forge" | "Fabric" | "Quilt";

interface FabricLoaderVersion {
  loader: {
    version: string;
  };
}

interface QuiltLoaderVersion {
  loader: {
    version: string;
  };
}

const loadFabricVersions = async (mcVersion: string) => {
  const url = `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}`;
  const data = await apiFetch<FabricLoaderVersion[]>(url, { ttl: 120_000 });
  return data.map((entry) => entry.loader.version);
};

const loadQuiltVersions = async (mcVersion: string) => {
  const url = `https://meta.quiltmc.org/v3/versions/loader/${mcVersion}`;
  const data = await apiFetch<QuiltLoaderVersion[]>(url, { ttl: 120_000 });
  return data.map((entry) => entry.loader.version);
};

const loadForgeVersions = async (mcVersion: string) => {
  const url = `https://bmclapi2.bangbang93.com/forge/minecraft/${mcVersion}`;
  const data = await apiFetch<Array<{ version: string }>>(url, { ttl: 120_000 });
  return data.map((entry) => entry.version);
};

const loadNeoForgeVersions = async (mcVersion: string) => {
  const url = `https://bmclapi2.bangbang93.com/neoforge/${mcVersion}`;
  const data = await apiFetch<Array<{ version: string }>>(url, { ttl: 120_000 });
  return data.map((entry) => entry.version);
};

export const fetchLoaderVersions = async (
  loader: LoaderType,
  mcVersion: string,
): Promise<string[]> => {
  if (!mcVersion || loader === "Vanilla") {
    return [];
  }
  switch (loader) {
    case "Fabric":
      return loadFabricVersions(mcVersion);
    case "Quilt":
      return loadQuiltVersions(mcVersion);
    case "Forge":
      return loadForgeVersions(mcVersion);
    case "NeoForge":
      return loadNeoForgeVersions(mcVersion);
    default:
      return [];
  }
};
