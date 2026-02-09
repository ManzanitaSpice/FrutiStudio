import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BaseDirProvider } from "../context/BaseDirContext";
import { SelectFolderButton } from "./SelectFolderButton";

vi.mock("../services/tauri", () => ({
  selectFolder: vi.fn(async () => ({ ok: true, path: "/tmp/base" })),
}));

vi.mock("../services/configService", () => ({
  loadConfig: vi.fn(async () => ({})),
  saveConfig: vi.fn(async () => undefined),
  saveBaseDir: vi.fn(async () => undefined),
}));

vi.mock("../services/baseDirService", () => ({
  validateBaseDir: vi.fn(async () => ({ ok: true, errors: [] })),
}));

describe("SelectFolderButton", () => {
  it("permite seleccionar carpeta base", async () => {
    render(
      <BaseDirProvider>
        <SelectFolderButton />
      </BaseDirProvider>,
    );

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(screen.getByText(/\/tmp\/base/)).toBeInTheDocument(),
    );
  });
});
