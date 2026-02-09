import { invoke } from "@tauri-apps/api/core";

export interface BaseDirValidationResult {
  ok: boolean;
  errors: string[];
}

export const validateBaseDir = async (
  baseDir: string,
): Promise<BaseDirValidationResult> => {
  return invoke<BaseDirValidationResult>("validate_base_dir", { baseDir });
};
