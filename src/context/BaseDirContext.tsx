import { createContext, useCallback, useEffect, useMemo, useState } from "react";

import {
  loadConfig,
  saveBaseDir,
} from "../services/configService";
import {
  type BaseDirValidationResult,
  validateBaseDir,
} from "../services/baseDirService";

export interface BaseDirContextValue {
  baseDir: string;
  status: "idle" | "validating" | "valid" | "invalid";
  validation: BaseDirValidationResult | null;
  setBaseDir: (dir: string) => Promise<void>;
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
  const [status, setStatus] =
    useState<BaseDirContextValue["status"]>("idle");
  const [validation, setValidation] =
    useState<BaseDirValidationResult | null>(null);

  const applyBaseDir = useCallback(async (dir: string) => {
    if (!dir.trim()) {
      setBaseDir("");
      setValidation(null);
      setStatus("idle");
      return;
    }

    if (dir === baseDir) {
      return;
    }

    setStatus("validating");
    try {
      const result = await validateBaseDir(dir, true);
      setValidation(result);

      if (result.ok) {
        setStatus("validating");
        const confirm = await validateBaseDir(dir);
        setValidation(confirm);
        if (confirm.ok) {
          setBaseDir(dir);
          await saveBaseDir(dir);
          setStatus("valid");
          return;
        }
      }

      setStatus("invalid");
    } catch (error) {
      console.error("Error validando carpeta base", error);
      setValidation({
        ok: false,
        errors: ["No se pudo validar la carpeta base."],
      });
      setStatus("invalid");
    }
  }, [baseDir]);

  useEffect(() => {
    const loadBaseDir = async () => {
      const config = await loadConfig();
      if (config.baseDir) {
        await applyBaseDir(config.baseDir);
      }
    };

    void loadBaseDir();
  }, [applyBaseDir]);

  const value = useMemo(
    () => ({ baseDir, setBaseDir: applyBaseDir, status, validation }),
    [applyBaseDir, baseDir, status, validation],
  );

  return (
    <BaseDirContext.Provider value={value}>
      {children}
    </BaseDirContext.Provider>
  );
};
