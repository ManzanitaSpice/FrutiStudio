import { invoke } from "@tauri-apps/api/core";

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
    return await invoke<T>(command, payload);
  } catch (error) {
    throw new TauriError(
      `No se pudo ejecutar ${command}.`,
      error,
    );
  }
};
