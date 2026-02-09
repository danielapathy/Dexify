const DEFAULT_STORAGE_KEY = "spotify.artistCache.v1";
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 24;

export function createArtistCache({ storageKey = DEFAULT_STORAGE_KEY, ttlMs = DEFAULT_TTL_MS, limit = DEFAULT_LIMIT } = {}) {
  const key = String(storageKey || DEFAULT_STORAGE_KEY);
  const ttl = Number.isFinite(Number(ttlMs)) && Number(ttlMs) > 0 ? Number(ttlMs) : DEFAULT_TTL_MS;
  const maxEntries = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : DEFAULT_LIMIT;

  const loadStore = () => {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };

  const saveStore = (store) => {
    try {
      localStorage.setItem(key, JSON.stringify(store));
    } catch {}
  };

  const trimArtistPayload = (data) => {
    const take = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : []);
    return {
      ...(data && typeof data === "object" ? data : {}),
      topTracks: take(data?.topTracks, 60),
      radio: take(data?.radio, 60),
      albums: take(data?.albums, 80),
      related: take(data?.related, 40),
      playlists: take(data?.playlists, 40),
    };
  };

  const readArtistCache = (artistId) => {
    const id = String(artistId || "").trim();
    if (!id) return null;
    const store = loadStore();
    const entry = store[id];
    if (!entry || typeof entry !== "object") return null;
    const at = Number(entry.at) || 0;
    const data = entry.data && typeof entry.data === "object" ? entry.data : null;
    if (!data) return null;
    return { at, data, fresh: Boolean(at && Date.now() - at < ttl) };
  };

  const writeArtistCache = (artistId, data) => {
    const id = String(artistId || "").trim();
    if (!id) return;
    const store = loadStore();
    store[id] = { at: Date.now(), data: trimArtistPayload(data) };

    const entries = Object.entries(store).sort((a, b) => Number(b[1]?.at || 0) - Number(a[1]?.at || 0));
    const next = {};
    for (const [k, v] of entries.slice(0, maxEntries)) {
      next[k] = v;
    }
    saveStore(next);
  };

  return { readArtistCache, writeArtistCache };
}
