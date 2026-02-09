export interface InstanceConfig {
  id: string;
  name: string;
  gameVersion: string;
  loader?: string;
  javaPath?: string;
  memoryMb?: number;
}

export const createInstance = async (_config: InstanceConfig) => {
  return Promise.resolve();
};

export const updateInstance = async (_config: InstanceConfig) => {
  return Promise.resolve();
};

export const removeInstance = async (_instanceId: string) => {
  return Promise.resolve();
};
