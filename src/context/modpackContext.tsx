import { createContext, useMemo, useState } from "react";

export interface ModpackSummary {
  id: string;
  name: string;
  source: string;
}

export interface ModpackContextValue {
  modpacks: ModpackSummary[];
  setModpacks: (modpacks: ModpackSummary[]) => void;
}

export const ModpackContext = createContext<ModpackContextValue | undefined>(
  undefined,
);

export const ModpackProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [modpacks, setModpacks] = useState<ModpackSummary[]>([]);
  const value = useMemo(() => ({ modpacks, setModpacks }), [modpacks]);

  return (
    <ModpackContext.Provider value={value}>
      {children}
    </ModpackContext.Provider>
  );
};
