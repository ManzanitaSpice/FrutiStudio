export interface ModpackInstallRequest {
  id: string;
  name: string;
  source: "curseforge" | "modrinth" | "ftb";
}

export const installModpack = async (_request: ModpackInstallRequest) => {
  return Promise.resolve();
};

export const removeModpack = async (_modpackId: string) => Promise.resolve();

export const manageModpack = async (action: {
  action: "create" | "duplicate" | "delete";
  id: string;
  name?: string;
  version?: string;
}) => {
  const { invokeWithHandling } = await import("./tauriClient");
  await invokeWithHandling<void>("manage_modpack", { action });
};
