import { API_CONFIG } from "../config/api";

const STORAGE_KEY = "frutilauncher.curseforgeApiKey";

export const getCurseforgeApiKey = () => {
  if (typeof window === "undefined") {
    return API_CONFIG.curseforgeApiKey;
  }

  const fromStorage = window.localStorage.getItem(STORAGE_KEY)?.trim() ?? "";
  return fromStorage || API_CONFIG.curseforgeApiKey;
};

export const saveCurseforgeApiKey = (apiKey: string) => {
  if (typeof window === "undefined") {
    return;
  }
  const trimmed = apiKey.trim();
  if (trimmed.length === 0) {
    window.localStorage.removeItem(STORAGE_KEY);
  } else {
    window.localStorage.setItem(STORAGE_KEY, trimmed);
  }
};
