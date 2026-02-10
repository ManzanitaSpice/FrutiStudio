import type { Instance, LocalInstance } from "../types/models";
import { invokeWithHandling } from "./tauriClient";

let cachedInstances: Instance[] | null = null;

export const fetchInstances = async (): Promise<Instance[]> => {
  if (cachedInstances) {
    return cachedInstances;
  }
  try {
    const locals = await fetchLocalInstances();
    cachedInstances = locals.map((local) => ({
      id: local.id,
      name: local.name,
      version: local.version,
      loaderName: "Vanilla",
      loaderVersion: "—",
      mods: 0,
      memory: "4 GB",
      status: "ready",
      group: "No agrupado",
      lastPlayed: "Nunca",
      playtime: "0 min",
      playtimeMinutes: 0,
      isDownloading: false,
      isRunning: false,
    }));
  } catch (error) {
    console.error("No se pudieron cargar instancias locales", error);
    cachedInstances = [];
  }
  return cachedInstances;
};

export const clearInstanceCache = () => {
  cachedInstances = null;
};

export const fetchLocalInstances = async (): Promise<LocalInstance[]> => {
  const { invokeWithHandling } = await import("./tauriClient");
  return invokeWithHandling<LocalInstance[]>("list_instances");
};

export const createInstance = async (config: Instance) => {
  await invokeWithHandling("create_instance", {
    instance: {
      id: config.id,
      name: config.name,
      version: config.version,
      loader_name: config.loaderName,
      loader_version: config.loaderVersion,
    },
  });
  if (cachedInstances) {
    cachedInstances = [config, ...cachedInstances];
  }
};

export const updateInstance = async (_config: Instance) => Promise.resolve();

export const removeInstance = async (_instanceId: string) => Promise.resolve();


export const launchInstance = async (instanceId: string) => {
  return invokeWithHandling<{ pid: number }>("launch_instance", {
    instance_id: instanceId,
  });
};

export const repairInstance = async (instanceId: string) => {
  return invokeWithHandling<void>("repair_instance", {
    instance_id: instanceId,
  });
};
