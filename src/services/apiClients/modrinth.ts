import { apiFetch } from "./client";

const MODRINTH_BASE = "https://api.modrinth.com/v2";

export const searchModrinthMods = async (query: string) => {
  const url = `${MODRINTH_BASE}/search?query=${encodeURIComponent(query)}`;
  return apiFetch<{ hits: unknown[] }>(url);
};

export const fetchModrinthVersions = async (projectId: string) => {
  const url = `${MODRINTH_BASE}/project/${projectId}/version`;
  return apiFetch<unknown[]>(url);
};
