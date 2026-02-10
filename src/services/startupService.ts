import { invokeWithHandling } from "./tauriClient";

export interface StartupFile {
  relativePath: string;
  sizeBytes: number;
}

export const collectStartupFiles = async () =>
  invokeWithHandling<StartupFile[]>("collect_startup_files");
