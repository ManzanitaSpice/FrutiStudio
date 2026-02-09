import { useContext } from "react";

import { ModpackContext } from "../context/modpackContext";

export const useModpacks = () => {
  const context = useContext(ModpackContext);
  if (!context) {
    throw new Error("useModpacks debe usarse dentro de ModpackProvider");
  }
  return context;
};
