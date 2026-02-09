import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => "/tmp/base"),
}));

describe("tauri service", () => {
  it("invoca el comando select_folder", async () => {
    const { selectFolder } = await import("./tauri");
    const { invoke } = await import("@tauri-apps/api/core");

    const result = await selectFolder();

    expect(invoke).toHaveBeenCalledWith("select_folder");
    expect(result).toBe("/tmp/base");
  });
});
