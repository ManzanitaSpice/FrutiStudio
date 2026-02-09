import { createContext, useMemo, useState } from "react";

export interface ModSummary {
  id: string;
  name: string;
  version: string;
}

export interface ModContextValue {
  mods: ModSummary[];
  setMods: (mods: ModSummary[]) => void;
}

export const ModContext = createContext<ModContextValue | undefined>(undefined);

export const ModProvider = ({ children }: { children: React.ReactNode }) => {
  const [mods, setMods] = useState<ModSummary[]>([]);
  const value = useMemo(() => ({ mods, setMods }), [mods]);

  return <ModContext.Provider value={value}>{children}</ModContext.Provider>;
};
