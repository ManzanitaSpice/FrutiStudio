import { useContext } from "react";

import { ModContext } from "../context/modContext";

export const useMods = () => {
  const context = useContext(ModContext);
  if (!context) {
    throw new Error("useMods debe usarse dentro de ModProvider");
  }
  return context;
};
