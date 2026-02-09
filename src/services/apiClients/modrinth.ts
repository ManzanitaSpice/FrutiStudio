import { apiFetch } from "./client";

const MODRINTH_BASE = "https://api.modrinth.com/v2";

export interface ModrinthSearchParams {
  query: string;
  facets?: string[][];
  limit?: number;
  offset?: number;
}

const buildModrinthSearchUrl = ({ query, facets, limit, offset }: ModrinthSearchParams) => {
  const params = new URLSearchParams({ query });
  if (facets && facets.length > 0) {
    params.set("facets", JSON.stringify(facets));
  }
  if (limit !== undefined) {
    params.set("limit", String(limit));
  }
  if (offset !== undefined) {
    params.set("offset", String(offset));
  }
  return `${MODRINTH_BASE}/search?${params.toString()}`;
};

export const searchModrinthMods = async (params: ModrinthSearchParams) => {
  const url = buildModrinthSearchUrl(params);
  return apiFetch<{ hits: unknown[] }>(url);
};

export const fetchModrinthProject = async (projectId: string) => {
  const url = `${MODRINTH_BASE}/project/${projectId}`;
  return apiFetch<unknown>(url);
};

export const fetchModrinthVersions = async (projectId: string) => {
  const url = `${MODRINTH_BASE}/project/${projectId}/version`;
  return apiFetch<unknown[]>(url);
};

export const fetchModrinthVersionFiles = async (versionId: string) => {
  const url = `${MODRINTH_BASE}/version/${versionId}`;
  return apiFetch<unknown>(url);
};
