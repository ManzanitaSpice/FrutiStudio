import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./accountService", () => ({
  loadAccountStore: vi.fn(() => ({
    activeAccountId: "a-1",
    accounts: [
      {
        id: "a-1",
        type: "msa",
        username: "Arthur",
        uuid: "uuid-1",
        lastUsedAt: 1700000000,
      },
    ],
  })),
}));

import {
  loadProfileStore,
  setActiveProfile,
  syncProfilesWithAccounts,
} from "./profileService";

describe("profileService", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("sincroniza perfiles desde cuentas", () => {
    const store = syncProfilesWithAccounts();
    expect(store.profiles).toHaveLength(1);
    expect(store.profiles[0].username).toBe("Arthur");
    expect(store.profiles[0].auth).toBe("microsoft");
  });

  it("actualiza perfil activo", () => {
    const synced = syncProfilesWithAccounts();
    setActiveProfile(synced.profiles[0].id);

    const loaded = loadProfileStore();
    expect(loaded.activeProfileId).toBe(synced.profiles[0].id);
  });
});
