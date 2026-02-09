import type { JavaProfile } from "../types/models";

export interface JavaRuntimeConfig {
  path: string;
  maxMemoryMb: number;
  extraArgs?: string[];
}

export const validateJavaRuntime = async (_config: JavaRuntimeConfig) => {
  return Promise.resolve(true);
};

export const detectJavaProfiles = async (): Promise<JavaProfile[]> => {
  const candidates = ["java", "/usr/bin/java", "/opt/java/bin/java"];
  return candidates.map((path, index) => ({
    id: `java-${index}`,
    name: `Java ${index + 1}`,
    path,
    version: "17",
    detected: true,
  }));
};
