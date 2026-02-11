import { invokeWithHandling } from "./tauriClient";

export interface LauncherFactoryResetResult {
  clearedRoots: string[];
  removedEntries: string[];
}

export const launcherFactoryReset = async (confirmationPhrase: string) =>
  invokeWithHandling<LauncherFactoryResetResult>("launcher_factory_reset", {
    args: {
      confirmationPhrase,
    },
  });
