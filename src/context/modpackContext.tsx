import { createContext, useMemo, useReducer } from "react";

import type { Modpack } from "../types/models";

export interface ModpackContextValue {
  modpacks: Modpack[];
  setModpacks: (modpacks: Modpack[]) => void;
  clearModpacks: () => void;
}

export const ModpackContext = createContext<ModpackContextValue | undefined>(
  undefined,
);

export const ModpackProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  type Action = { type: "set"; payload: Modpack[] } | { type: "clear" };
  const reducer = (_state: Modpack[], action: Action): Modpack[] => {
    switch (action.type) {
      case "set":
        return action.payload;
      case "clear":
        return [];
      default:
        return [];
    }
  };

  const [modpacks, dispatch] = useReducer(reducer, []);
  const value = useMemo(
    () => ({
      modpacks,
      setModpacks: (items: Modpack[]) =>
        dispatch({ type: "set", payload: items }),
      clearModpacks: () => dispatch({ type: "clear" }),
    }),
    [modpacks],
  );

  return (
    <ModpackContext.Provider value={value}>
      {children}
    </ModpackContext.Provider>
  );
};
