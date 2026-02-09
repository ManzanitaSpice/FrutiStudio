export const fetchMinecraftVersions = async () => {
  const { apiFetch } = await import("./apiClients/client");
  const response = await apiFetch<{ versions: string[] }>(
    "https://launchermeta.mojang.com/mc/game/version_manifest.json",
    { ttl: 60_000 * 10 },
  );
  return response.versions ?? [];
};
