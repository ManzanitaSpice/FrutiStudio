import { createContext, useMemo, useState } from "react";

export interface ServerSummary {
  id: string;
  name: string;
  address: string;
  lastSeen: string;
}

export interface ServerContextValue {
  servers: ServerSummary[];
  setServers: (servers: ServerSummary[]) => void;
}

export const ServerContext = createContext<ServerContextValue | undefined>(
  undefined,
);

export const ServerProvider = ({ children }: { children: React.ReactNode }) => {
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const value = useMemo(() => ({ servers, setServers }), [servers]);

  return (
    <ServerContext.Provider value={value}>{children}</ServerContext.Provider>
  );
};
