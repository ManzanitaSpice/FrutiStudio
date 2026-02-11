import type { Instance, LocalInstance } from "../types/models";
import { invokeWithHandling } from "./tauriClient";
import { getActiveAccount } from "./accountService";

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
      loaderName: local.loaderName ?? local.loader_name ?? "Vanilla",
      loaderVersion: local.loaderVersion ?? local.loader_version ?? "latest",
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
  const isVanilla = config.loaderName.toLowerCase() === "vanilla";
  await invokeWithHandling("create_instance", {
    instance: {
      id: config.id,
      name: config.name,
      version: config.version,
      loaderName: config.loaderName,
      loaderVersion: isVanilla ? "latest" : config.loaderVersion,
    },
  });
  if (cachedInstances) {
    cachedInstances = [config, ...cachedInstances];
  }
};

export const updateInstance = async (config: Instance) => {
  await invokeWithHandling("update_instance", {
    instance: {
      id: config.id,
      name: config.name,
      version: config.version,
      loaderName: config.loaderName,
      loaderVersion:
        config.loaderName.toLowerCase() === "vanilla"
          ? "latest"
          : config.loaderVersion,
    },
  });

  if (cachedInstances) {
    cachedInstances = cachedInstances.map((entry) =>
      entry.id === config.id
        ? {
            ...entry,
            name: config.name,
            version: config.version,
            loaderName: config.loaderName,
            loaderVersion:
              config.loaderName.toLowerCase() === "vanilla"
                ? "latest"
                : config.loaderVersion,
          }
        : entry,
    );
  }
};

export const removeInstance = async (instanceId: string) => {
  const validInstanceId = assertValidInstanceId(instanceId);
  await invokeWithHandling<void>("delete_instance", {
    args: {
      instanceId: validInstanceId,
    },
  });
  if (cachedInstances) {
    cachedInstances = cachedInstances.filter((instance) => instance.id !== validInstanceId);
  }
};

const assertValidInstanceId = (instanceId: string) => {
  if (typeof instanceId !== "string" || instanceId.trim().length === 0) {
    throw new Error("No hay una instancia válida seleccionada.");
  }
  return instanceId.trim();
};

export const launchInstance = async (instanceId: string) => {
  const validInstanceId = assertValidInstanceId(instanceId);
  const activeAccount = getActiveAccount();
  return invokeWithHandling<{ pid: number }>("launch_instance", {
    args: {
      instanceId: validInstanceId,
      username: activeAccount?.username,
      uuid: activeAccount?.uuid,
      accessToken: activeAccount?.session?.accessToken,
      userType: activeAccount?.type === "msa" ? "msa" : "offline",
    },
  });
};

export const repairInstance = async (instanceId: string) => {
  const validInstanceId = assertValidInstanceId(instanceId);
  return invokeWithHandling<void>("repair_instance", {
    args: {
      instanceId: validInstanceId,
    },
  });
};

export const exportInstance = async (instanceId: string, archivePath: string) => {
  const validInstanceId = assertValidInstanceId(instanceId);
  const targetPath = archivePath.trim();
  if (!targetPath) {
    throw new Error("Debes seleccionar una ruta de destino para exportar.");
  }
  return invokeWithHandling<string>("export_instance", {
    args: {
      instanceId: validInstanceId,
      archivePath: targetPath,
    },
  });
};

export const importInstance = async (archivePath: string, instanceId?: string) => {
  const sourcePath = archivePath.trim();
  if (!sourcePath) {
    throw new Error("Debes seleccionar un archivo para importar.");
  }
  return invokeWithHandling<LocalInstance>("import_instance", {
    args: {
      archivePath: sourcePath,
      instanceId: instanceId?.trim() || undefined,
    },
  });
};

export interface InstancePreflightReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  checks: Record<string, boolean>;
}

export interface InstanceRuntimeLogSnapshot {
  status?: string;
  stateDetails?: Record<string, unknown>;
  stateUpdatedAt?: number;
  stdoutPath?: string;
  stderrPath?: string;
  command?: string;
  lines: string[];
}

export const preflightInstance = async (instanceId: string) => {
  const validInstanceId = assertValidInstanceId(instanceId);
  return invokeWithHandling<InstancePreflightReport>("preflight_instance", {
    args: {
      instanceId: validInstanceId,
    },
  });
};

export const readInstanceRuntimeLogs = async (instanceId: string) => {
  const validInstanceId = assertValidInstanceId(instanceId);
  return invokeWithHandling<InstanceRuntimeLogSnapshot>("read_instance_runtime_logs", {
    args: {
      instanceId: validInstanceId,
    },
  });
};
