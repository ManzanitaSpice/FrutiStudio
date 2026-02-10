import { apiFetch } from "./apiClients/client";

export interface MinecraftVersion {
  id: string;
  type: "release" | "snapshot" | "old_alpha" | "old_beta";
}

interface MinecraftManifest {
  versions: MinecraftVersion[];
}

const MANIFEST_URL =
  "https://launchermeta.mojang.com/mc/game/version_manifest.json";

export const fetchMinecraftVersions = async (): Promise<MinecraftVersion[]> => {
  const data = await apiFetch<MinecraftManifest>(MANIFEST_URL, { ttl: 300_000 });
  return data.versions;
};
