import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => ({ ok: true, path: "/tmp/base" })),
}));

describe("tauri service", () => {
  it("invoca el comando select_folder", async () => {
    const { selectFolder } = await import("./tauri");
    const { invoke } = await import("@tauri-apps/api/core");

    const result = await selectFolder();

    expect(invoke).toHaveBeenCalledWith("select_folder", undefined);
    expect(result).toEqual({ ok: true, path: "/tmp/base" });
  });
});
