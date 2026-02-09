export interface JavaRuntimeConfig {
  path: string;
  maxMemoryMb: number;
  extraArgs?: string[];
}

export const validateJavaRuntime = async (_config: JavaRuntimeConfig) => {
  return Promise.resolve(true);
};
