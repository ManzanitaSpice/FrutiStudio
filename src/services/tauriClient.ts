import { invoke } from "@tauri-apps/api/core";

export class TauriError extends Error {
  constructor(message: string, public details?: unknown) {
    super(message);
  }
}

const resolveTauriErrorMessage = (error: unknown) => {
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return null;
};

export const invokeWithHandling = async <T>(
  command: string,
  payload?: Record<string, unknown>,
): Promise<T> => {
  try {
    return await invoke<T>(command, payload);
  } catch (error) {
    const details = resolveTauriErrorMessage(error);
    throw new TauriError(
      details ? `No se pudo ejecutar ${command}: ${details}` : `No se pudo ejecutar ${command}.`,
      error,
    );
  }
};
