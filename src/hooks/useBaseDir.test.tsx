import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { BaseDirContext } from "../context/BaseDirContext";
import { useBaseDir } from "./useBaseDir";

describe("useBaseDir", () => {
  it("lanza error si no está dentro del provider", () => {
    expect(() => renderHook(() => useBaseDir())).toThrow(
      "useBaseDir debe usarse dentro de BaseDirProvider",
    );
  });

  it("expone el contexto cuando existe", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <BaseDirContext.Provider
        value={{
          baseDir: "/tmp/base",
          status: "valid",
          validation: { ok: true, errors: [] },
          setBaseDir: async () => undefined,
        }}
      >
        {children}
      </BaseDirContext.Provider>
    );

    const { result } = renderHook(() => useBaseDir(), { wrapper });

    expect(result.current.baseDir).toBe("/tmp/base");
    expect(result.current.status).toBe("valid");
  });
});
