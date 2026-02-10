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

const uniqueSorted = (values: string[]) =>
  Array.from(new Set(values.filter(Boolean))).sort((a, b) => b.localeCompare(a));

const loadFabricVersions = async (mcVersion: string) => {
  const url = `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}`;
  const data = await apiFetch<FabricLoaderVersion[]>(url, { ttl: 120_000 });
  return uniqueSorted(data.map((entry) => entry.loader.version));
};

const loadQuiltVersions = async (mcVersion: string) => {
  const url = `https://meta.quiltmc.org/v3/versions/loader/${mcVersion}`;
  const data = await apiFetch<QuiltLoaderVersion[]>(url, { ttl: 120_000 });
  return uniqueSorted(data.map((entry) => entry.loader.version));
};

const parseForgeMetadata = (xml: string) => {
  const matches = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
  return matches.filter((entry) => /^\d+(?:\.\d+)+(?:-.+)?$/.test(entry));
};

const loadForgeVersions = async (mcVersion: string) => {
  const mirrors = [
    `https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json`,
    `https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml`,
  ];

  for (const url of mirrors) {
    try {
      if (url.endsWith("json")) {
        const data = await apiFetch<{ promos: Record<string, string> }>(url, {
          ttl: 120_000,
        });
        const versions = Object.entries(data.promos)
          .filter(([key]) => key.startsWith(`${mcVersion}-`))
          .map(([, value]) => `${mcVersion}-${value}`);
        if (versions.length) return uniqueSorted(versions);
      } else {
        const xml = await apiFetch<string>(url, { ttl: 120_000, parseJson: false });
        const versions = parseForgeMetadata(xml).filter((entry) =>
          entry.startsWith(`${mcVersion}-`),
        );
        if (versions.length) return uniqueSorted(versions);
      }
    } catch {
      // Intentar siguiente mirror.
    }
  }

  return [];
};

const loadNeoForgeVersions = async (mcVersion: string) => {
  const mirrors = [
    `https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge`,
    `https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml`,
  ];

  for (const url of mirrors) {
    try {
      if (url.includes("/api/maven/")) {
        const data = await apiFetch<string[]>(url, { ttl: 120_000 });
        const versions = data.filter((entry) => entry.startsWith(mcVersion));
        if (versions.length) return uniqueSorted(versions);
      } else {
        const xml = await apiFetch<string>(url, { ttl: 120_000, parseJson: false });
        const versions = parseForgeMetadata(xml).filter((entry) =>
          entry.startsWith(mcVersion),
        );
        if (versions.length) return uniqueSorted(versions);
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
