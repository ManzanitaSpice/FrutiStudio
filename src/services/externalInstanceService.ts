import { invokeWithHandling } from "./tauriClient";
import type { LocalInstance } from "../types/models";

export interface ExternalInstance {
  id: string;
  name: string;
  version: string;
  launcher: string;
  path: string;
  gameDir: string;
  loaderName: string;
  loaderVersion: string;
  details?: string;
}

export interface ImportExternalInstanceArgs {
  externalId: string;
  customName?: string;
}

export const fetchExternalInstances = async (): Promise<ExternalInstance[]> => {
  return invokeWithHandling<ExternalInstance[]>("list_external_instances");
};

export const importExternalInstance = async (
  args: ImportExternalInstanceArgs,
): Promise<LocalInstance> => {
  return invokeWithHandling<LocalInstance>("import_external_instance", {
    args,
  });
};
