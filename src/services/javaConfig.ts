import type { JavaProfile } from "../types/models";
import { invokeWithHandling } from "./tauriClient";

export interface JavaRuntimeConfig {
  path: string;
  maxMemoryMb: number;
  extraArgs?: string[];
}

interface JavaRuntimeRecord {
  id: string;
  name: string;
  path: string;
  version: string;
  major: number;
  architecture: string;
  source: string;
  recommended: boolean;
}

export interface JavaResolution {
  minecraftVersion: string;
  requiredMajor: number;
  selected: JavaRuntimeRecord | null;
  runtimes: JavaRuntimeRecord[];
}

export const validateJavaRuntime = async (config: JavaRuntimeConfig) => {
  if (!config.path.trim()) {
    return false;
  }

  const runtimes = await listInstalledJavaRuntimes();
  return runtimes.some((runtime) => runtime.path === config.path);
};

export const listInstalledJavaRuntimes = async (): Promise<JavaRuntimeRecord[]> =>
  invokeWithHandling<JavaRuntimeRecord[]>("list_java_runtimes");

export const getJavaForMinecraft = async (
  minecraftVersion: string,
): Promise<JavaResolution> =>
  invokeWithHandling<JavaResolution>("resolve_java_for_minecraft", {
    minecraftVersion,
  });

export const detectJavaProfiles = async (): Promise<JavaProfile[]> => {
  const runtimes = await listInstalledJavaRuntimes();
  return runtimes.map((runtime) => ({
    id: runtime.id,
    name: runtime.name,
    path: runtime.path,
    version: runtime.version,
    detected: true,
    source: runtime.source,
    architecture: runtime.architecture,
    recommended: runtime.recommended,
  }));
};
