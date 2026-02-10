const STORAGE_KEY = "frutilauncher.curseforgeApiKey";

export const getCurseforgeApiKey = () =>
  typeof window === "undefined" ? "" : window.localStorage.getItem(STORAGE_KEY) ?? "";

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
