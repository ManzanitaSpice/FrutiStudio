const cache = new Map<string, { value: unknown; expiresAt: number }>();
const hostLimits = new Map<string, number>();

const RATE_LIMIT_MS = 160;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const buildCacheKey = (url: string, init?: RequestInit) => {
  const headers = init?.headers ? new Headers(init.headers) : undefined;
  const headerEntries = headers ? Array.from(headers.entries()) : [];
  const headerKey = headerEntries.length
    ? JSON.stringify(headerEntries)
    : "no-headers";
  const method = init?.method ?? "GET";
  return `${method}:${url}:${headerKey}`;
};

export const apiFetch = async <T>(
  url: string,
  { ttl = 60_000, init }: { ttl?: number; init?: RequestInit } = {},
): Promise<T> => {
  const cacheKey = buildCacheKey(url, init);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T;
  }

  if (!navigator.onLine && cached) {
    return cached.value as T;
  }

  if (!navigator.onLine) {
    throw new Error("Modo offline: sin datos en caché.");
  }

  const now = Date.now();
  const host = new URL(url).host;
  const lastRequest = hostLimits.get(host) ?? 0;
  if (now - lastRequest < RATE_LIMIT_MS) {
    await wait(RATE_LIMIT_MS - (now - lastRequest));
  }
  hostLimits.set(host, Date.now());

  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Error API ${response.status}`);
  }
  const data = (await response.json()) as T;
  cache.set(cacheKey, { value: data, expiresAt: Date.now() + ttl });
  return data;
};
