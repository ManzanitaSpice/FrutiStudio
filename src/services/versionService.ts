export interface MinecraftVersion {
  id: string;
  type: "release" | "snapshot" | "old_alpha" | "old_beta";
  url: string;
  time?: string;
  releaseTime?: string;
}

export const fetchMinecraftVersions = async () => {
  const { apiFetch } = await import("./apiClients/client");
  const response = await apiFetch<{ versions: MinecraftVersion[] }>(
    "https://launchermeta.mojang.com/mc/game/version_manifest.json",
    { ttl: 60_000 * 10 },
  );
  return response.versions ?? [];
};

export const fetchForgeVersions = async () => {
  const { apiFetch } = await import("./apiClients/client");
  return apiFetch<unknown[]>(
    "https://files.minecraftforge.net/net/minecraftforge/forge/json",
    { ttl: 60_000 * 10 },
  );
};

export const fetchFabricLoaders = async () => {
  const { apiFetch } = await import("./apiClients/client");
  return apiFetch<unknown[]>("https://meta.fabricmc.net/v2/versions/loader", {
    ttl: 60_000 * 10,
  });
};

export const fetchQuiltLoaders = async () => {
  const { apiFetch } = await import("./apiClients/client");
  return apiFetch<unknown[]>("https://meta.quiltmc.org/v3/versions/loader", {
    ttl: 60_000 * 10,
  });
};

export const fetchNeoForgeLoaders = async (endpoint: string) => {
  const { apiFetch } = await import("./apiClients/client");
  return apiFetch<unknown[]>(endpoint, { ttl: 60_000 * 10 });
};
