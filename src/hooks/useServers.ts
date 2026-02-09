import { useContext } from "react";

import { ServerContext } from "../context/serverContext";

export const useServers = () => {
  const context = useContext(ServerContext);
  if (!context) {
    throw new Error("useServers debe usarse dentro de ServerProvider");
  }
  return context;
};
