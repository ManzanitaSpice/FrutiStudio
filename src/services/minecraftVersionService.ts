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
  const response = await fetch(MANIFEST_URL);
  if (!response.ok) {
    throw new Error("No se pudieron cargar las versiones de Minecraft.");
  }
  const data = (await response.json()) as MinecraftManifest;
  return data.versions;
};
