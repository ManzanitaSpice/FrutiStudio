import { createContext, useMemo, useReducer } from "react";

import type { Instance } from "../types/models";

type InstanceAction =
  | { type: "set"; payload: Instance[] }
  | { type: "clear" };

const reducer = (state: Instance[], action: InstanceAction): Instance[] => {
  switch (action.type) {
    case "set":
      return action.payload;
    case "clear":
      return [];
    default:
      return state;
  }
};

export interface InstanceContextValue {
  instances: Instance[];
  setInstances: (instances: Instance[]) => void;
  clearInstances: () => void;
}

export const InstanceContext = createContext<InstanceContextValue | undefined>(
  undefined,
);

export const InstanceProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [instances, dispatch] = useReducer(reducer, []);

  const value = useMemo(
    () => ({
      instances,
      setInstances: (items: Instance[]) =>
        dispatch({ type: "set", payload: items }),
      clearInstances: () => dispatch({ type: "clear" }),
    }),
    [instances],
  );

  return (
    <InstanceContext.Provider value={value}>
      {children}
    </InstanceContext.Provider>
  );
};
