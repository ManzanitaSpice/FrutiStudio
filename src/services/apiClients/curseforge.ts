import { apiFetch } from "./client";

const CURSEFORGE_BASE = "https://api.curseforge.com/v1";

const buildHeaders = (apiKey?: string) =>
  apiKey ? { "x-api-key": apiKey } : undefined;

const buildSearchParams = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params).reduce<Record<string, string>>((acc, [key, value]) => {
      if (value === undefined || value === "") {
        return acc;
      }
      acc[key] = String(value);
      return acc;
    }, {}),
  ).toString();

export interface CurseforgeSearchFilters {
  query: string;
  gameVersion?: string;
  modLoaderType?: number;
  classId?: number;
  sortField?: number;
  sortOrder?: "asc" | "desc";
  pageSize?: number;
  index?: number;
}

export const searchCurseforgeMods = async (
  filters: CurseforgeSearchFilters,
  apiKey?: string,
) => {
  const params = buildSearchParams({
    searchFilter: filters.query,
    gameVersion: filters.gameVersion,
    modLoaderType: filters.modLoaderType,
    classId: filters.classId,
    sortField: filters.sortField,
    sortOrder: filters.sortOrder,
    pageSize: filters.pageSize,
    index: filters.index,
  });
  const url = `${CURSEFORGE_BASE}/mods/search?${params}`;
  return apiFetch<{ data: unknown[] }>(url, { init: { headers: buildHeaders(apiKey) } });
};

export const fetchCurseforgeMod = async (modId: number, apiKey?: string) => {
  const url = `${CURSEFORGE_BASE}/mods/${modId}`;
  return apiFetch<{ data: unknown }>(url, { init: { headers: buildHeaders(apiKey) } });
};

export const fetchCurseforgeFiles = async (modId: number, apiKey?: string) => {
  const url = `${CURSEFORGE_BASE}/mods/${modId}/files`;
  return apiFetch<{ data: unknown[] }>(url, { init: { headers: buildHeaders(apiKey) } });
};

export const fetchCurseforgeGameVersions = async (apiKey?: string) => {
  const url = `${CURSEFORGE_BASE}/games/432/gameVersions`;
  return apiFetch<{ data: unknown[] }>(url, { init: { headers: buildHeaders(apiKey) } });
};

export const fetchCurseforgeModLoaders = async (apiKey?: string) => {
  const url = `${CURSEFORGE_BASE}/games/432/modloaders`;
  return apiFetch<{ data: unknown[] }>(url, { init: { headers: buildHeaders(apiKey) } });
};
