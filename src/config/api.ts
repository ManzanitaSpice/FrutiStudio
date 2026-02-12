const normalizeBase = (value: string | undefined, fallback: string) => {
  const candidate = (value ?? "").trim();
  if (!candidate) {
    return fallback;
  }
  return candidate.replace(/\/+$/, "");
};

const splitCsv = (value: string | undefined, fallback: string[]) => {
  const raw = (value ?? "").trim();
  if (!raw) {
    return fallback;
  }
  const entries = raw
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return entries.length > 0 ? entries : fallback;
};

const env = import.meta.env;

export const API_CONFIG = {
  curseforgeBase: normalizeBase(env.VITE_CURSEFORGE_API_BASE, "https://api.curseforge.com/v1"),
  curseforgeProxyBases: splitCsv(env.VITE_CURSEFORGE_PROXY_BASES, [
    "https://api.curse.tools/v1",
    "https://cfproxy.bmpm.workers.dev/v1",
  ]),
  fabricMetaBase: normalizeBase(env.VITE_FABRIC_META_BASE, "https://meta.fabricmc.net/v2"),
  quiltMetaBase: normalizeBase(env.VITE_QUILT_META_BASE, "https://meta.quiltmc.org/v3"),
  forgePromotionsUrl: normalizeBase(
    env.VITE_FORGE_PROMOTIONS_URL,
    "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json",
  ),
  forgeMavenMetadataUrl: normalizeBase(
    env.VITE_FORGE_MAVEN_METADATA_URL,
    "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml",
  ),
  neoforgeApiUrl: normalizeBase(
    env.VITE_NEOFORGE_API_URL,
    "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge",
  ),
  neoforgeMavenMetadataUrl: normalizeBase(
    env.VITE_NEOFORGE_MAVEN_METADATA_URL,
    "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml",
  ),
} as const;
