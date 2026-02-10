export type InstanceStatus = "ready" | "pending-update" | "stopped";

export interface Instance {
  id: string;
  name: string;
  version: string;
  loaderName: string;
  loaderVersion: string;
  mods: number;
  memory: string;
  status: InstanceStatus;
  group: string;
  lastPlayed: string;
  playtime: string;
  playtimeMinutes: number;
  isDownloading: boolean;
  isRunning: boolean;
  resources?: {
    ramMin: string;
    ramMax: string;
    gpu: string;
    cpu: string;
  };
  downloadLabel?: string;
  downloadProgress?: number;
  downloadStage?: "descargando" | "instalando" | "finalizando";
  processId?: number;
}

export interface Modpack {
  id: string;
  name: string;
  summary: string;
  version: string;
  source: "curseforge" | "modrinth" | "local";
  updatedAt: string;
}

export interface Mod {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  source: "curseforge" | "modrinth" | "local";
}

export interface Server {
  id: string;
  name: string;
  host: string;
  version: string;
  status: "online" | "offline" | "unknown";
}

export interface JavaProfile {
  id: string;
  name: string;
  path: string;
  version: string;
  detected: boolean;
  source?: string;
  architecture?: string;
  recommended?: boolean;
}

export interface LocalInstance {
  id: string;
  name: string;
  version: string;
  loaderName?: string;
  loaderVersion?: string;
  loader_name?: string;
  loader_version?: string;
}

export interface FeatureFlags {
  explorer: boolean;
  news: boolean;
  servers: boolean;
  settings: boolean;
  community: boolean;
}
