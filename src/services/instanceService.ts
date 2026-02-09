import { instanceFixtures } from "../fixtures/instances";
import type { Instance, LocalInstance } from "../types/models";

let cachedInstances: Instance[] | null = null;

export const fetchInstances = async (): Promise<Instance[]> => {
  if (cachedInstances) {
    return cachedInstances;
  }
  cachedInstances = instanceFixtures;
  return cachedInstances;
};

export const clearInstanceCache = () => {
  cachedInstances = null;
};

export const fetchLocalInstances = async (): Promise<LocalInstance[]> => {
  const { invokeWithHandling } = await import("./tauriClient");
  return invokeWithHandling<LocalInstance[]>("list_instances");
};

export const createInstance = async (_config: Instance) => Promise.resolve();

export const updateInstance = async (_config: Instance) => Promise.resolve();

export const removeInstance = async (_instanceId: string) => Promise.resolve();
