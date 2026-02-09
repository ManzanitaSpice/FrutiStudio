import { useContext } from "react";

import { BaseDirContext } from "../context/BaseDirContext";

export const useBaseDir = () => {
  const context = useContext(BaseDirContext);

  if (!context) {
    throw new Error("useBaseDir debe usarse dentro de BaseDirProvider");
  }

  return context;
};
