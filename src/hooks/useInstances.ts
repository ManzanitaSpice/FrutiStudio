import { useContext } from "react";

import { InstanceContext } from "../context/instanceContext";

export const useInstances = () => {
  const context = useContext(InstanceContext);
  if (!context) {
    throw new Error("useInstances debe usarse dentro de InstanceProvider");
  }
  return context;
};
