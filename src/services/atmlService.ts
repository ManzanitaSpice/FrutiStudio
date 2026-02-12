import { API_CONFIG } from "../config/api";
import { apiFetch } from "./apiClients/client";

const ATLAUNCHER_LEGACY_BASE = "https://api.atlauncher.com";

export interface ATLauncherPackSummary {
  id: number;
  name: string;
  description?: string;
  versions?: number;
}

interface ATLauncherGraphqlPack {
  id?: number;
  name?: string;
  description?: string;
  versions?: unknown[];
}

interface ATLauncherGraphqlResponse {
  data?: {
    packs?: ATLauncherGraphqlPack[];
    pack?: ATLauncherGraphqlPack;
  };
  errors?: Array<{ message?: string }>;
}

const requestAtlauncherGraphql = async <T>(query: string, variables?: Record<string, unknown>) => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (API_CONFIG.atlauncherApiToken) {
    headers.Authorization = `Bearer ${API_CONFIG.atlauncherApiToken}`;
  }

  return apiFetch<T>(API_CONFIG.atlauncherGraphqlBase, {
    ttl: 60_000 * 5,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
    },
  });
};

const mapPack = (pack: ATLauncherGraphqlPack): ATLauncherPackSummary => ({
  id: Number(pack.id ?? 0),
  name: String(pack.name ?? ""),
  description: pack.description,
  versions: Array.isArray(pack.versions) ? pack.versions.length : undefined,
});

const fetchLegacyPacks = async () => {
  const response = (await apiFetch<{
    packs?: Array<Record<string, unknown>>;
  }>(ATLAUNCHER_LEGACY_BASE, { ttl: 60_000 * 5 })) as {
    packs?: Array<Record<string, unknown>>;
  };

  return (response.packs ?? []).map((pack) => ({
    id: Number(pack.id ?? 0),
    name: String(pack.name ?? ""),
    description: pack.description as string | undefined,
    versions: pack.versions as number | undefined,
  }));
};

export const fetchATLauncherPacks = async () => {
  try {
    const response = await requestAtlauncherGraphql<ATLauncherGraphqlResponse>(
      `query FrutiLauncherPacks { packs { id name description versions { id } } }`,
    );

    if (response.errors && response.errors.length > 0) {
      throw new Error(response.errors.map((error) => error.message ?? "unknown").join("; "));
    }

    const packs = response.data?.packs;
    if (!packs) {
      throw new Error("ATLauncher no devolvió packs.");
    }

    return packs.map(mapPack);
  } catch (error) {
    console.warn("[atlauncher] GraphQL fallback to legacy REST", error);
    return fetchLegacyPacks();
  }
};

export const fetchATLauncherPackDetails = async (packId: number) => {
  try {
    const response = await requestAtlauncherGraphql<ATLauncherGraphqlResponse>(
      `query FrutiLauncherPack($id: Int!) { pack(id: $id) { id name description versions { id } } }`,
      { id: packId },
    );

    if (response.errors && response.errors.length > 0) {
      throw new Error(response.errors.map((error) => error.message ?? "unknown").join("; "));
    }

    const pack = response.data?.pack;
    if (!pack) {
      throw new Error("ATLauncher no devolvió el pack solicitado.");
    }

    return {
      id: Number(pack.id ?? packId),
      name: String(pack.name ?? ""),
      description: pack.description,
      versions: pack.versions,
    };
  } catch (error) {
    console.warn("[atlauncher] GraphQL pack detail fallback to legacy REST", error);
    const url = `${ATLAUNCHER_LEGACY_BASE}/modpacks/${packId}`;
    const response = (await apiFetch<Record<string, unknown>>(url, {
      ttl: 60_000 * 5,
    })) as Record<string, unknown>;

    return {
      id: Number(response.id ?? packId),
      name: String(response.name ?? ""),
      description: response.description as string | undefined,
      versions: response.versions as unknown[] | undefined,
    };
  }
};
