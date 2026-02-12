import { API_CONFIG } from "../config/api";

export const getCurseforgeApiKey = () => API_CONFIG.curseforgeApiKey ?? "";

export const saveCurseforgeApiKey = (_apiKey: string) => {
  // Las API keys de CurseForge ya no se guardan en frontend para evitar exposición.
};
