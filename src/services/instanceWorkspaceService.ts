import { invokeWithHandling } from "./tauriClient";

export const openInstancePath = async (
  instanceId: string,
  subPath?: string,
): Promise<void> => {
  await invokeWithHandling<void>("open_instance_path", {
    instanceId,
    subPath,
  });
};

export const createInstanceDesktopShortcut = async (
  instanceId: string,
): Promise<string> => {
  return invokeWithHandling<string>("create_instance_shortcut", { instanceId });
};
