import { invoke } from "@tauri-apps/api/core";

export type LogScope = "instances" | "downloads";

export const logMessage = async (scope: LogScope, message: string) => {
  await invoke<void>("append_log", { scope, message });
};
