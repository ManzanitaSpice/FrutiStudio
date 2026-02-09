import { createContext, useMemo, useReducer } from "react";

import type { Server } from "../types/models";

export interface ServerContextValue {
  servers: Server[];
  setServers: (servers: Server[]) => void;
  clearServers: () => void;
}

export const ServerContext = createContext<ServerContextValue | undefined>(
  undefined,
);

export const ServerProvider = ({ children }: { children: React.ReactNode }) => {
  type Action = { type: "set"; payload: Server[] } | { type: "clear" };
  const reducer = (_state: Server[], action: Action): Server[] => {
    switch (action.type) {
      case "set":
        return action.payload;
      case "clear":
        return [];
      default:
        return [];
    }
  };

  const [servers, dispatch] = useReducer(reducer, []);
  const value = useMemo(
    () => ({
      servers,
      setServers: (items: Server[]) =>
        dispatch({ type: "set", payload: items }),
      clearServers: () => dispatch({ type: "clear" }),
    }),
    [servers],
  );

  return (
    <ServerContext.Provider value={value}>{children}</ServerContext.Provider>
  );
};
