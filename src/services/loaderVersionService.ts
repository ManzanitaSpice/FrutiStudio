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
  const endpoints = [
    `https://bmclapi2.bangbang93.com/forge/minecraft/${mcVersion}`,
    "https://bmclapi2.bangbang93.com/forge/list",
  ];
  for (const endpoint of endpoints) {
    try {
      const data = await apiFetch<unknown>(endpoint, { ttl: 120_000 });
      if (Array.isArray(data)) {
        const versions = data
          .flatMap((entry) => {
            if (typeof entry === "string") {
              return [entry];
            }
            if (typeof entry === "object" && entry !== null) {
              const record = entry as Record<string, unknown>;
              const entryVersion = record.version;
              const entryMc = record.mcversion ?? record.mcVersion;
              if (!entryVersion || typeof entryVersion !== "string") {
                return [];
              }
              if (!entryMc || entryMc === mcVersion) {
                return [entryVersion];
              }
            }
            return [];
          })
          .filter((version) => version.includes(mcVersion));
        if (versions.length) {
          return versions;
        }
      }
    } catch (error) {
      console.warn("Forge: endpoint sin respuesta", endpoint, error);
    }
  }
  return [];
};

const loadNeoForgeVersions = async (mcVersion: string) => {
  const endpoints = [
    `https://bmclapi2.bangbang93.com/neoforge/${mcVersion}`,
    "https://bmclapi2.bangbang93.com/neoforge/list",
  ];
  for (const endpoint of endpoints) {
    try {
      const data = await apiFetch<unknown>(endpoint, { ttl: 120_000 });
      if (Array.isArray(data)) {
        const versions = data
          .flatMap((entry) => {
            if (typeof entry === "string") {
              return [entry];
            }
            if (typeof entry === "object" && entry !== null) {
              const record = entry as Record<string, unknown>;
              const entryVersion = record.version;
              const entryMc = record.mcversion ?? record.mcVersion;
              if (!entryVersion || typeof entryVersion !== "string") {
                return [];
              }
              if (!entryMc || entryMc === mcVersion) {
                return [entryVersion];
              }
            }
            return [];
          })
          .filter((version) => version.includes(mcVersion));
        if (versions.length) {
          return versions;
        }
      }
    } catch (error) {
      console.warn("NeoForge: endpoint sin respuesta", endpoint, error);
    }
  }
  return [];
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
