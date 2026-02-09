import { apiFetch } from "./apiClients/client";

const ATLAUNCHER_BASE = "https://api.atlauncher.com";

export interface ATLauncherPackSummary {
  id: number;
  name: string;
  description?: string;
  versions?: number;
}

export const fetchATLauncherPacks = async () => {
  const response = (await apiFetch<{
    packs?: Array<Record<string, unknown>>;
  }>(ATLAUNCHER_BASE, { ttl: 60_000 * 5 })) as {
    packs?: Array<Record<string, unknown>>;
  };
  return (response.packs ?? []).map((pack) => ({
    id: Number(pack.id ?? 0),
    name: String(pack.name ?? ""),
    description: pack.description as string | undefined,
    versions: pack.versions as number | undefined,
  }));
};

export const fetchATLauncherPackDetails = async (packId: number) => {
  const url = `${ATLAUNCHER_BASE}/modpacks/${packId}`;
  const response = (await apiFetch<Record<string, unknown>>(url, {
    ttl: 60_000 * 5,
  })) as Record<string, unknown>;
  return {
    id: Number(response.id ?? packId),
    name: String(response.name ?? ""),
    description: response.description as string | undefined,
    versions: response.versions as unknown[] | undefined,
  };
};
