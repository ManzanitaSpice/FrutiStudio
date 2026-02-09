const cache = new Map<string, { value: unknown; expiresAt: number }>();
let lastRequest = 0;

const RATE_LIMIT_MS = 400;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const apiFetch = async <T>(
  url: string,
  { ttl = 60_000 } = {},
): Promise<T> => {
  const cached = cache.get(url);
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
  if (now - lastRequest < RATE_LIMIT_MS) {
    await wait(RATE_LIMIT_MS - (now - lastRequest));
  }
  lastRequest = Date.now();

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Error API ${response.status}`);
  }
  const data = (await response.json()) as T;
  cache.set(url, { value: data, expiresAt: Date.now() + ttl });
  return data;
};
