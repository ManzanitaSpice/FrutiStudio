export interface LocalServerEntry {
  id: string;
  name: string;
  host: string;
  port?: number;
  icon?: string;
}

const LOCAL_SERVERS_KEY = "interface.local-servers.v1";

export const loadLocalServers = (): LocalServerEntry[] => {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = window.localStorage.getItem(LOCAL_SERVERS_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as LocalServerEntry[];
    return parsed.filter((item) => item.id && item.name && item.host);
  } catch {
    return [];
  }
};

export const saveLocalServers = (servers: LocalServerEntry[]) => {
  window.localStorage.setItem(LOCAL_SERVERS_KEY, JSON.stringify(servers));
};

export const addLocalServer = (server: Omit<LocalServerEntry, "id">) => {
  const nextServer: LocalServerEntry = {
    ...server,
    id: crypto.randomUUID(),
  };
  const existing = loadLocalServers();
  saveLocalServers([nextServer, ...existing]);
  return nextServer;
};
