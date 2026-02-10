const cache = new Map<string, { value: unknown; expiresAt: number }>();
let lastRequest = 0;

const RATE_LIMIT_MS = 200;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 220;
const REQUEST_TIMEOUT_MS = 10_000;

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

const isRetryableStatus = (status: number) =>
  status === 408 || status === 425 || status === 429 || status >= 500;

const fetchWithTimeout = async (url: string, init?: RequestInit) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: init?.signal ?? controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
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

  let lastError: unknown;

  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
    const now = Date.now();
    if (now - lastRequest < RATE_LIMIT_MS) {
      await wait(RATE_LIMIT_MS - (now - lastRequest));
    }
    lastRequest = Date.now();

    try {
      const response = await fetchWithTimeout(url, init);
      if (!response.ok) {
        if (!isRetryableStatus(response.status) || attempt === RETRY_ATTEMPTS - 1) {
          throw new Error(`Error API ${response.status}`);
        }
        await wait(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      const data = (await response.json()) as T;
      cache.set(cacheKey, { value: data, expiresAt: Date.now() + ttl });
      return data;
    } catch (error) {
      lastError = error;
      if (attempt === RETRY_ATTEMPTS - 1) {
        break;
      }
      await wait(RETRY_DELAY_MS * (attempt + 1));
    }
  }

  if (cached) {
    return cached.value as T;
  }

  throw new Error(
    lastError instanceof Error
      ? `No se pudo conectar con la API: ${lastError.message}`
      : "No se pudo conectar con la API.",
  );
};
