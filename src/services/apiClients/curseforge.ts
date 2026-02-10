import { apiFetch } from "./client";
import { invokeWithHandling } from "../tauriClient";

const CURSEFORGE_BASE = "https://api.curseforge.com/v1";

const buildHeaders = (apiKey?: string) =>
  apiKey ? { "x-api-key": apiKey } : undefined;

const isTauriRuntime = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const requestCurseforgeV1 = async <T>(
  path: string,
  apiKey?: string,
  query?: Record<string, string>,
): Promise<T> => {
  const params = query
    ? `?${new URLSearchParams(query).toString()}`
    : "";

  if (isTauriRuntime() && apiKey) {
    return invokeWithHandling<T>("curseforge_v1_get", {
      path,
      query,
      apiKey,
    });
  }

  return apiFetch<T>(`${CURSEFORGE_BASE}${path}${params}`, {
    init: { headers: buildHeaders(apiKey) },
  });
};

export interface CurseforgeSearchFilters {
  query: string;
  gameId?: number;
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
  const query = Object.entries({
    gameId: (filters.gameId ?? 432).toString(),
    searchFilter: filters.query,
    gameVersion: filters.gameVersion,
    modLoaderType: filters.modLoaderType?.toString(),
    classId: filters.classId?.toString(),
    sortField: filters.sortField?.toString(),
    sortOrder: filters.sortOrder,
    pageSize: filters.pageSize?.toString(),
    index: filters.index?.toString(),
  }).reduce<Record<string, string>>((acc, [key, value]) => {
    if (value !== undefined && value !== "") {
      acc[key] = value;
    }
    return acc;
  }, {});

  return requestCurseforgeV1<{ data: unknown[] }>("/mods/search", apiKey, query);
};

export const fetchCurseforgeMod = async (modId: number, apiKey?: string) => {
  return requestCurseforgeV1<{ data: unknown }>(`/mods/${modId}`, apiKey);
};

export const fetchCurseforgeFiles = async (modId: number, apiKey?: string) => {
  return requestCurseforgeV1<{ data: unknown[] }>(`/mods/${modId}/files`, apiKey);
};

export const fetchCurseforgeGameVersions = async (apiKey?: string) => {
  return requestCurseforgeV1<{ data: unknown[] }>("/games/432/gameVersions", apiKey);
};

export const fetchCurseforgeModLoaders = async (apiKey?: string) => {
  return requestCurseforgeV1<{ data: unknown[] }>("/games/432/modloaders", apiKey);
};
