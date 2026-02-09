import { createContext, useMemo, useReducer } from "react";

import type { Mod } from "../types/models";

export interface ModContextValue {
  mods: Mod[];
  setMods: (mods: Mod[]) => void;
  clearMods: () => void;
}

export const ModContext = createContext<ModContextValue | undefined>(undefined);

type ModAction = { type: "set"; payload: Mod[] } | { type: "clear" };

const reducer = (_state: Mod[], action: ModAction): Mod[] => {
  switch (action.type) {
    case "set":
      return action.payload;
    case "clear":
      return [];
    default:
      return [];
  }
};

export const ModProvider = ({ children }: { children: React.ReactNode }) => {
  const [mods, dispatch] = useReducer(reducer, []);
  const value = useMemo(
    () => ({
      mods,
      setMods: (items: Mod[]) => dispatch({ type: "set", payload: items }),
      clearMods: () => dispatch({ type: "clear" }),
    }),
    [mods],
  );

  return <ModContext.Provider value={value}>{children}</ModContext.Provider>;
};
