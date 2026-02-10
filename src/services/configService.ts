import { invokeWithHandling } from "./tauriClient";
import { retry } from "../utils/retry";

export interface AppConfig {
  baseDir?: string;
  uiScale?: number;
  theme?:
    | "default"
    | "light"
    | "dark"
    | "chrome"
    | "sunset"
    | "mint"
    | "lavender"
    | "peach"
    | "custom";
  customTheme?: {
    bg: string;
    surface: string;
    surfaceStrong: string;
    border: string;
    text: string;
    muted: string;
    accent: string;
  };
  version?: number;
  telemetryOptIn?: boolean;
  autoUpdates?: boolean;
  backgroundDownloads?: boolean;
  activeSection?: "mis-modpacks" | "novedades" | "explorador" | "servers" | "configuracion";
  focusMode?: boolean;
  explorerFilters?: {
    query?: string;
    gameVersion?: string;
    loader?: string;
    platform?: "all" | "modrinth" | "curseforge";
    sort?: "relevance" | "popular" | "updated";
    category?: "Modpacks" | "Mods" | "Shaders" | "Resource Packs" | "Data Packs" | "Worlds" | "Addons";
  };
}

let cachedConfig: AppConfig | null = null;

export const loadConfig = async (): Promise<AppConfig> => {
  if (cachedConfig) {
    return cachedConfig;
  }
  const config = await retry(() => invokeWithHandling<AppConfig>("load_config"));
  cachedConfig = config;
  return config;
};

export const saveConfig = async (config: AppConfig) => {
  cachedConfig = config;
  await retry(() => invokeWithHandling<void>("save_config", { config }));
};

export const saveBaseDir = async (baseDir: string) => {
  const current = (await loadConfig()) ?? {};
  if (current.baseDir === baseDir) {
    return;
  }
  await saveConfig({ ...current, baseDir });
};
