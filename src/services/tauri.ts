import { invokeWithHandling } from "./tauriClient";

export interface SelectFolderResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export const selectFolder = async () =>
  invokeWithHandling<SelectFolderResult>("select_folder");
