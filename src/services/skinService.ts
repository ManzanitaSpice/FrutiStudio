import type { LauncherAccount } from "../types/account";

const SKIN_CACHE_KEY = "frutilauncher.skinCache.v1";
const MAX_CACHE_ITEMS = 80;

interface CachedSkinRecord {
  uuid: string;
  skinUrl: string;
  avatarUrl: string;
  updatedAt: number;
}

const getCache = (): CachedSkinRecord[] => {
  const raw = localStorage.getItem(SKIN_CACHE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as CachedSkinRecord[];
  } catch {
    return [];
  }
};

const saveCache = (items: CachedSkinRecord[]) => {
  localStorage.setItem(SKIN_CACHE_KEY, JSON.stringify(items.slice(0, MAX_CACHE_ITEMS)));
};

const updateCache = (record: CachedSkinRecord) => {
  const next = getCache().filter((item) => item.uuid !== record.uuid);
  next.unshift(record);
  saveCache(next);
};

export const resolveCachedSkin = (uuid: string) =>
  getCache().find((item) => item.uuid === uuid) ?? null;

export const resolveAvatarUrl = (uuid: string) => `https://crafatar.com/avatars/${uuid}?size=64&overlay=true`;

export const resolveSkinUrl = (uuid: string) => `https://crafatar.com/skins/${uuid}`;

export const refreshAccountSkin = async (account: LauncherAccount): Promise<LauncherAccount> => {
  const avatarUrl = resolveAvatarUrl(account.uuid);
  const skinUrl = resolveSkinUrl(account.uuid);
  try {
    const response = await fetch(`${skinUrl}?t=${Date.now()}`);
    if (!response.ok) {
      throw new Error(`Skin no disponible (${response.status})`);
    }
    updateCache({ uuid: account.uuid, skinUrl, avatarUrl, updatedAt: Date.now() });
    return { ...account, skinUrl, avatarUrl, status: "ready", errorMessage: undefined };
  } catch (error) {
    const cached = resolveCachedSkin(account.uuid);
    if (cached) {
      return {
        ...account,
        skinUrl: cached.skinUrl,
        avatarUrl: cached.avatarUrl,
        status: "ready",
      };
    }
    return {
      ...account,
      status: "error",
      errorMessage: error instanceof Error ? error.message : "No se pudo cargar la skin",
    };
  }
};
