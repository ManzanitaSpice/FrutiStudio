import { invokeWithHandling } from "./tauriClient";
import { retry } from "../utils/retry";

export interface BaseDirValidationResult {
  ok: boolean;
  errors: string[];
  warnings?: string[];
}

export const validateBaseDir = async (
  baseDir: string,
  dryRun = false,
): Promise<BaseDirValidationResult> => {
  return retry(() =>
    invokeWithHandling<BaseDirValidationResult>("validate_base_dir", {
      baseDir,
      dryRun,
    }),
  );
};
