import { invoke } from "@tauri-apps/api/core";

export interface AppConfig {
  baseDir?: string;
}

export const loadConfig = async (): Promise<AppConfig> => {
  return invoke<AppConfig>("load_config");
};

export const saveBaseDir = async (baseDir: string) => {
  await invoke<void>("save_base_dir", { baseDir });
};
