import { loginWithMicrosoftDeviceCode } from "./minecraftAuthService";
import { refreshAccountSkin } from "./skinService";
import type { AccountStore, LauncherAccount } from "../types/account";

const STORE_KEY = "interface.accounts.v1";
const ACCOUNT_EVENT = "interface:accounts-updated";

const defaultStore: AccountStore = { activeAccountId: null, accounts: [] };

const emitChanged = () => {
  window.dispatchEvent(new Event(ACCOUNT_EVENT));
};

export const onAccountsChanged = (listener: () => void) => {
  window.addEventListener(ACCOUNT_EVENT, listener);
  return () => window.removeEventListener(ACCOUNT_EVENT, listener);
};

export const loadAccountStore = (): AccountStore => {
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return defaultStore;
  try {
    const parsed = JSON.parse(raw) as AccountStore;
    return {
      activeAccountId: parsed.activeAccountId ?? null,
      accounts: parsed.accounts ?? [],
    };
  } catch {
    return defaultStore;
  }
};

const saveStore = (store: AccountStore) => {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
  emitChanged();
};

const resolveNextActiveId = (accounts: LauncherAccount[], requestedId: string | null) => {
  if (!accounts.length) return null;
  if (requestedId && accounts.some((item) => item.id === requestedId)) {
    return requestedId;
  }
  return accounts[0].id;
};

export const getActiveAccount = () => {
  const store = loadAccountStore();
  return store.accounts.find((account) => account.id === store.activeAccountId) ?? null;
};

export const setActiveAccount = (accountId: string) => {
  const store = loadAccountStore();
  saveStore({ ...store, activeAccountId: resolveNextActiveId(store.accounts, accountId) });
};

export const removeAccount = (accountId: string) => {
  const store = loadAccountStore();
  const accounts = store.accounts.filter((account) => account.id !== accountId);
  saveStore({
    accounts,
    activeAccountId: resolveNextActiveId(accounts, store.activeAccountId === accountId ? null : store.activeAccountId),
  });
};

export const addOfflineAccount = async (username: string) => {
  const trimmed = username.trim();
  if (!trimmed) {
    throw new Error("El nombre offline no puede estar vacío.");
  }

  const account = await refreshAccountSkin({
    id: crypto.randomUUID(),
    type: "offline",
    username: trimmed,
    uuid: crypto.randomUUID().replace(/-/g, ""),
    status: "ready",
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  });

  const store = loadAccountStore();
  saveStore({
    accounts: [account, ...store.accounts],
    activeAccountId: account.id,
  });
  return account;
};

export const addMicrosoftAccount = async () => {
  const created = await loginWithMicrosoftDeviceCode();
  const account = await refreshAccountSkin(created);
  const store = loadAccountStore();
  saveStore({ accounts: [account, ...store.accounts], activeAccountId: account.id });
  return account;
};

export const refreshAccount = async (accountId: string) => {
  const store = loadAccountStore();
  const found = store.accounts.find((item) => item.id === accountId);
  if (!found) {
    throw new Error("Cuenta no encontrada.");
  }
  const refreshed = await refreshAccountSkin({ ...found, lastUsedAt: Date.now(), status: "loading" });
  saveStore({
    ...store,
    accounts: store.accounts.map((item) => (item.id === accountId ? refreshed : item)),
  });
  return refreshed;
};

export const logoutActiveAccount = () => {
  const store = loadAccountStore();
  if (!store.activeAccountId) return;
  removeAccount(store.activeAccountId);
};
