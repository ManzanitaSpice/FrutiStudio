import { invoke } from "@tauri-apps/api/core";

type TauriWindow = typeof window & {
  __TAURI__?: {
    core?: {
      invoke?: unknown;
    };
  };
};

const isTauriAvailable = () => {
  if (typeof window === "undefined") {
    return false;
  }
  return Boolean((window as TauriWindow).__TAURI__?.core?.invoke);
};

const CONFIG_STORAGE_KEY = "fruti.config";

const readConfigCache = (): Record<string, unknown> => {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch (error) {
    console.warn("No se pudo leer la configuración local.", error);
    return {};
  }
};

const writeConfigCache = (config: Record<string, unknown>) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch (error) {
    console.warn("No se pudo guardar la configuración local.", error);
  }
};

const fallbackInvoke = async <T>(
  command: string,
  payload?: Record<string, unknown>,
): Promise<T> => {
  switch (command) {
    case "load_config":
      return readConfigCache() as T;
    case "save_config": {
      const config = (payload?.config as Record<string, unknown>) ?? {};
      writeConfigCache(config);
      return undefined as T;
    }
    case "default_base_dir":
      return "" as T;
    case "validate_base_dir":
      return { ok: true, errors: [] } as T;
    case "list_instances":
      return [] as T;
    case "create_instance":
    case "init_discord_rpc":
    case "set_discord_activity":
    case "clear_discord_activity":
      return undefined as T;
    default:
      throw new TauriError(
        `El comando ${command} requiere la app de escritorio.`,
      );
  }
};

export class TauriError extends Error {
  constructor(message: string, public details?: unknown) {
    super(message);
  }
}

export const invokeWithHandling = async <T>(
  command: string,
  payload?: Record<string, unknown>,
): Promise<T> => {
  try {
    if (!isTauriAvailable()) {
      return await fallbackInvoke<T>(command, payload);
    }
    return await invoke<T>(command, payload);
  } catch (error) {
    throw new TauriError(
      `No se pudo ejecutar ${command}.`,
      error,
    );
  }
};
