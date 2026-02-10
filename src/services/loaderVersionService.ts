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
  const mirrors = [
    `https://bmclapi2.bangbang93.com/forge/minecraft/${mcVersion}`,
    `https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json`,
  ];

  for (const url of mirrors) {
    try {
      if (url.includes("promotions_slim")) {
        const data = await apiFetch<{ promos: Record<string, string> }>(url, {
          ttl: 120_000,
        });
        const versions = Object.entries(data.promos)
          .filter(([key]) => key.startsWith(`${mcVersion}-`))
          .map(([, value]) => value);
        if (versions.length) return versions;
      } else {
        const data = await apiFetch<Array<{ version: string }>>(url, { ttl: 120_000 });
        const versions = data.map((entry) => entry.version);
        if (versions.length) return versions;
      }
    } catch {
      // Intentar siguiente mirror.
    }
  }

  return [];
};

const loadNeoForgeVersions = async (mcVersion: string) => {
  const mirrors = [
    `https://bmclapi2.bangbang93.com/neoforge/${mcVersion}`,
    `https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge`,
  ];

  for (const url of mirrors) {
    try {
      if (url.includes("maven.neoforged.net")) {
        const data = await apiFetch<string[]>(url, { ttl: 120_000 });
        const versions = data.filter((entry) => entry.startsWith(mcVersion));
        if (versions.length) return versions;
      } else {
        const data = await apiFetch<Array<{ version: string }>>(url, { ttl: 120_000 });
        const versions = data.map((entry) => entry.version);
        if (versions.length) return versions;
      }
    } catch {
      // Intentar siguiente mirror.
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
