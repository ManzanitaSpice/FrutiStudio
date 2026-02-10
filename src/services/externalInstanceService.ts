import { invokeWithHandling } from "./tauriClient";

export interface ExternalInstance {
  id: string;
  name: string;
  version: string;
  launcher: string;
  path?: string;
}

export const fetchExternalInstances = async (): Promise<ExternalInstance[]> => {
  return invokeWithHandling<ExternalInstance[]>("list_external_instances");
};
