import { apiFetch } from "./client";

const CURSEFORGE_BASE = "https://api.curseforge.com";

export const searchCurseforge = async (query: string) => {
  const url = `${CURSEFORGE_BASE}/v1/search?searchFilter=${encodeURIComponent(query)}`;
  return apiFetch<unknown>(url);
};
