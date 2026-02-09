import { createContext, useMemo, useState } from "react";

export interface BaseDirContextValue {
  baseDir: string;
  setBaseDir: (dir: string) => void;
}

export const BaseDirContext = createContext<BaseDirContextValue | undefined>(
  undefined,
);

export const BaseDirProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [baseDir, setBaseDir] = useState("");

  const value = useMemo(() => ({ baseDir, setBaseDir }), [baseDir]);

  return (
    <BaseDirContext.Provider value={value}>
      {children}
    </BaseDirContext.Provider>
  );
};
