import { apiFetch } from "./apiClients/client";
import { API_CONFIG } from "../config/api";

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

const uniqueSortedByNumericVersion = (values: string[]) => {
  const parse = (value: string) =>
    value
      .split(/[^0-9]+/)
      .filter(Boolean)
      .map((segment) => Number.parseInt(segment, 10));

  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => {
    const leftParts = parse(left);
    const rightParts = parse(right);
    const maxLength = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < maxLength; index += 1) {
      const leftPart = leftParts[index] ?? 0;
      const rightPart = rightParts[index] ?? 0;
      if (leftPart !== rightPart) {
        return rightPart - leftPart;
      }
    }

    return right.localeCompare(left);
  });
};

const neoforgeChannelForMinecraft = (mcVersion: string) => {
  const [, minor = "", patch = "0"] = mcVersion.split(".");
  return `${minor}.${patch}.`;
};

const loadFabricVersions = async (mcVersion: string) => {
  const url = `${API_CONFIG.fabricMetaBase}/versions/loader/${mcVersion}`;
  const data = await apiFetch<FabricLoaderVersion[]>(url, { ttl: 120_000 });
  return uniqueSorted(data.map((entry) => entry.loader.version));
};

const loadQuiltVersions = async (mcVersion: string) => {
  const url = `${API_CONFIG.quiltMetaBase}/versions/loader/${mcVersion}`;
  const data = await apiFetch<QuiltLoaderVersion[]>(url, { ttl: 120_000 });
  return uniqueSorted(data.map((entry) => entry.loader.version));
};

const parseForgeMetadata = (xml: string) => {
  const matches = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
  return matches.filter((entry) => /^\d+(?:\.\d+)+(?:-.+)?$/.test(entry));
};

const loadForgeVersions = async (mcVersion: string) => {
  const mirrors = [
    API_CONFIG.forgePromotionsUrl,
    API_CONFIG.forgeMavenMetadataUrl,
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
  const channelPrefix = neoforgeChannelForMinecraft(mcVersion);
  const mirrors = [
    API_CONFIG.neoforgeApiUrl,
    API_CONFIG.neoforgeMavenMetadataUrl,
  ];

  for (const url of mirrors) {
    try {
      if (url.includes("/api/maven/")) {
        const data = await apiFetch<{ versions?: string[] } | string[]>(url, {
          ttl: 120_000,
        });
        const entries = Array.isArray(data) ? data : (data.versions ?? []);
        const versions = entries.filter((entry) => entry.startsWith(channelPrefix));
        if (versions.length) return uniqueSortedByNumericVersion(versions);
      } else {
        const xml = await apiFetch<string>(url, { ttl: 120_000, parseJson: false });
        const versions = parseForgeMetadata(xml).filter((entry) =>
          entry.startsWith(channelPrefix),
        );
        if (versions.length) return uniqueSortedByNumericVersion(versions);
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
