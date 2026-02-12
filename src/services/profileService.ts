import { loadAccountStore } from "./accountService";

const PROFILES_STORE_KEY = "interface.profiles.v1";
const PROFILES_EVENT = "interface:profiles-updated";

export interface LauncherProfile {
  id: string;
  uuid: string;
  username: string;
  auth: "microsoft" | "offline";
  lastUsed: number;
}

interface ProfileStore {
  activeProfileId: string | null;
  profiles: LauncherProfile[];
}

const defaultStore: ProfileStore = {
  activeProfileId: null,
  profiles: [],
};

const emitProfilesChanged = () => {
  window.dispatchEvent(new Event(PROFILES_EVENT));
};

export const onProfilesChanged = (listener: () => void) => {
  window.addEventListener(PROFILES_EVENT, listener);
  return () => window.removeEventListener(PROFILES_EVENT, listener);
};

export const loadProfileStore = (): ProfileStore => {
  if (typeof window === "undefined") {
    return defaultStore;
  }

  const raw = window.localStorage.getItem(PROFILES_STORE_KEY);
  if (!raw) {
    return defaultStore;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ProfileStore>;
    return {
      activeProfileId: parsed.activeProfileId ?? null,
      profiles: parsed.profiles ?? [],
    };
  } catch {
    return defaultStore;
  }
};

const saveProfileStore = (store: ProfileStore) => {
  window.localStorage.setItem(PROFILES_STORE_KEY, JSON.stringify(store));
  emitProfilesChanged();
};

const ensureActiveProfile = (store: ProfileStore): ProfileStore => {
  if (!store.profiles.length) {
    return { ...store, activeProfileId: null };
  }

  if (
    store.activeProfileId &&
    store.profiles.some((profile) => profile.id === store.activeProfileId)
  ) {
    return store;
  }

  return {
    ...store,
    activeProfileId: store.profiles[0].id,
  };
};

export const syncProfilesWithAccounts = () => {
  const accountStore = loadAccountStore();
  const current = loadProfileStore();

  const mergedProfiles = accountStore.accounts.map((account) => {
    const existing = current.profiles.find((profile) => profile.uuid === account.uuid);
    return {
      id: existing?.id ?? crypto.randomUUID(),
      uuid: account.uuid,
      username: account.username,
      auth: account.type === "msa" ? "microsoft" : "offline",
      lastUsed: existing?.lastUsed ?? account.lastUsedAt ?? Date.now(),
    } satisfies LauncherProfile;
  });

  const next = ensureActiveProfile({
    activeProfileId: current.activeProfileId,
    profiles: mergedProfiles,
  });

  saveProfileStore(next);
  return next;
};

export const setActiveProfile = (profileId: string) => {
  const store = loadProfileStore();
  const profile = store.profiles.find((item) => item.id === profileId);
  if (!profile) {
    throw new Error("Perfil no encontrado.");
  }

  const updated = ensureActiveProfile({
    activeProfileId: profile.id,
    profiles: store.profiles.map((item) =>
      item.id === profile.id ? { ...item, lastUsed: Date.now() } : item,
    ),
  });

  saveProfileStore(updated);
};
