export interface ModpackInstallRequest {
  id: string;
  name: string;
  source: "curseforge" | "modrinth" | "ftb";
}

export const installModpack = async (_request: ModpackInstallRequest) => {
  return Promise.resolve();
};

export const removeModpack = async (_modpackId: string) => {
  return Promise.resolve();
};
