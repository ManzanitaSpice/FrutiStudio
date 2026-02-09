import { createContext, useMemo, useState } from "react";

import { InstanceConfig } from "../services/instanceService";

export interface InstanceContextValue {
  instances: InstanceConfig[];
  setInstances: (instances: InstanceConfig[]) => void;
}

export const InstanceContext = createContext<InstanceContextValue | undefined>(
  undefined,
);

export const InstanceProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [instances, setInstances] = useState<InstanceConfig[]>([]);
  const value = useMemo(() => ({ instances, setInstances }), [instances]);

  return (
    <InstanceContext.Provider value={value}>
      {children}
    </InstanceContext.Provider>
  );
};
