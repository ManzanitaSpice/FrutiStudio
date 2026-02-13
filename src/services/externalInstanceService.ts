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
  runtimeHint?: string;
  launchArgs: string[];
  signature: string;
  details?: string;
}

export interface ManualExternalRoot {
  path: string;
  launcherHint?: string;
  label?: string;
}

export interface RegisterExternalRootArgs {
  path: string;
  launcherHint?: string;
  label?: string;
}

export interface ImportExternalInstanceArgs {
  externalId: string;
  customName?: string;
}

export interface ExternalScanArgs {
  mode?: "quick" | "advanced";
  depthLimit?: number;
  includeAllVolumes?: boolean;
  includeManualRoots?: boolean;
}

export interface ExternalScanReport {
  mode: string;
  instances: ExternalInstance[];
  stats: {
    rootsScanned: number;
    rootsDetected: number;
    visitedDirs: number;
    elapsedMs: number;
  };
}

export const fetchExternalInstances = async (): Promise<ExternalInstance[]> => {
  return invokeWithHandling<ExternalInstance[]>("list_external_instances");
};

export const scanExternalInstances = async (
  args: ExternalScanArgs,
): Promise<ExternalScanReport> => {
  return invokeWithHandling<ExternalScanReport>("scan_external_instances_command", {
    args,
  });
};

export const fetchExternalRoots = async (): Promise<ManualExternalRoot[]> => {
  return invokeWithHandling<ManualExternalRoot[]>("list_external_roots");
};

export const registerExternalRoot = async (
  args: RegisterExternalRootArgs,
): Promise<ManualExternalRoot[]> => {
  return invokeWithHandling<ManualExternalRoot[]>("register_external_root", {
    args,
  });
};

export const removeExternalRoot = async (
  path: string,
): Promise<ManualExternalRoot[]> => {
  return invokeWithHandling<ManualExternalRoot[]>("remove_external_root", {
    args: { path },
  });
};

export const importExternalInstance = async (
  args: ImportExternalInstanceArgs,
): Promise<LocalInstance> => {
  return invokeWithHandling<LocalInstance>("import_external_instance", {
    args,
  });
};
