import { rankEvents, scoreEvent } from '../../src/jev/priority.js';
import {
  readResponseBytesCapped,
  readResponseJsonCapped,
} from './common/http.js';
import { clientKey, makeRateLimiter } from './common/rate-limit.js';

// /api/priority — the JEV decision layer: current disasters inside the
// priority area, scored by hazard, nearby biodiversity (GBIF occurrence
// count) and forest pressure (Global Forest Change loss share), ranked.

/** Indonesia and its neighbours; PRIORITY_AREA overrides (west,south,east,north). */
const DEFAULT_AREA = Object.freeze({
  west: 90,
  south: -15,
  east: 145,
  north: 25,
});
const MAX_EVENTS = 60;
const LOOKUP_CONCURRENCY = 3;
const LOOKUP_TIMEOUT_MS = 8_000;
const RESULT_CACHE_MS = 30 * 60_000;
/** Occurrences and forest loss change slowly; lookups keep for a day. */
const LOOKUP_CACHE_MS = 24 * 60 * 60_000;
const LOOKUP_CACHE_MAX = 2_000;
/** Half-width of the biodiversity box in degrees (about 50 km). */
const BIODIVERSITY_HALF_DEGREES = 0.45;
/** Zoom of the forest tile sampled around an event (about 78 km wide). */
const FOREST_ZOOM = 9;
const FOREST_TILES =
  'https://storage.googleapis.com/earthenginepartners-hansen/tiles/gfc_v1.13/loss_alpha';
const USER_AGENT = 'horus-priority/1.0';

/** Read PRIORITY_AREA, falling back to the default for anything unreadable. */
export function priorityArea(value) {
  const parts = String(value || '')
    .split(',')
    .map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part)))
    return DEFAULT_AREA;
  const [west, south, east, north] = parts;
  if (west < -180 || east > 180 || south < -90 || north > 90)
    return DEFAULT_AREA;
  if (west >= east || south >= north) return DEFAULT_AREA;
  return { west, south, east, north };
}

export const inArea = (event, area) =>
  event.lon >= area.west &&
  event.lon <= area.east &&
  event.lat >= area.south &&
  event.lat <= area.north;

/** Web Mercator tile holding a point. */
export function tileFor(lat, lon, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
  );
  return {
    z,
    x: Math.min(n - 1, Math.max(0, x)),
    y: Math.min(n - 1, Math.max(0, y)),
  };
}

async function mapLimit(items, limit, run) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await run(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export function priorityProxy({
  feed,
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  decodeAlpha = defaultDecodeAlpha,
} = {}) {
  if (!feed?.get)
    throw new TypeError('The priority layer needs a disaster feed');
  const allow = makeRateLimiter({ windowMs: 60_000, max: 20, globalMax: 300 });
  const lookups = new Map();
  let result = null;
  let inFlight = null;

  const remember = (key, value) => {
    lookups.set(key, { value, at: now() });
    while (lookups.size > LOOKUP_CACHE_MAX)
      lookups.delete(lookups.keys().next().value);
    return value;
  };
  const recall = (key) => {
    const hit = lookups.get(key);
    return hit && now() - hit.at < LOOKUP_CACHE_MS ? hit : null;
  };

  async function occurrenceCount(lat, lon) {
    const key = `gbif:${lat.toFixed(1)},${lon.toFixed(1)}`;
    const hit = recall(key);
    if (hit) return hit.value;
    const d = BIODIVERSITY_HALF_DEGREES;
    const params = new URLSearchParams({
      limit: '0',
      hasCoordinate: 'true',
      decimalLatitude: `${(lat - d).toFixed(3)},${(lat + d).toFixed(3)}`,
      decimalLongitude: `${(lon - d).toFixed(3)},${(lon + d).toFixed(3)}`,
    });
    try {
      const signal = AbortSignal.timeout(LOOKUP_TIMEOUT_MS);
      const response = await fetchImpl(
        `https://api.gbif.org/v1/occurrence/search?${params}`,
        {
          signal,
          headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        return null;
      }
      const body = await readResponseJsonCapped(response, 64 * 1024, signal);
      return remember(key, Number.isFinite(body?.count) ? body.count : null);
    } catch {
      return null;
    }
  }

  async function forestLossShare(lat, lon) {
    const { z, x, y } = tileFor(lat, lon, FOREST_ZOOM);
    const key = `forest:${z}/${x}/${y}`;
    const hit = recall(key);
    if (hit) return hit.value;
    try {
      const signal = AbortSignal.timeout(LOOKUP_TIMEOUT_MS);
      const response = await fetchImpl(`${FOREST_TILES}/${z}/${x}/${y}.png`, {
        signal,
        headers: { 'User-Agent': USER_AGENT },
      });
      // No tile means no tree cover was lost there (sea, desert, ice).
      if (response.status === 404) {
        await response.body?.cancel();
        return remember(key, 0);
      }
      if (!response.ok) {
        await response.body?.cancel();
        return null;
      }
      const bytes = await readResponseBytesCapped(
        response,
        2 * 1024 * 1024,
        signal,
      );
      return remember(key, await decodeAlpha(bytes));
    } catch {
      return null;
    }
  }

  async function build() {
    const { snapshot, stale } = await feed.get();
    const area = priorityArea(process.env.PRIORITY_AREA);
    const candidates = snapshot.events
      .filter((event) => inArea(event, area))
      .sort(
        (a, b) =>
          ({ red: 3, orange: 2, green: 1 })[b.alert] -
            { red: 3, orange: 2, green: 1 }[a.alert] ||
          (b.startMs ?? 0) - (a.startMs ?? 0),
      )
      .slice(0, MAX_EVENTS);
    const scored = await mapLimit(
      candidates,
      LOOKUP_CONCURRENCY,
      async (event) => {
        const [occurrences, lossShare] = await Promise.all([
          occurrenceCount(event.lat, event.lon),
          forestLossShare(event.lat, event.lon),
        ]);
        return {
          ...event,
          occurrenceCount: occurrences,
          forestLossShare: lossShare,
          priority: scoreEvent({
            alert: event.alert,
            occurrenceCount: occurrences,
            forestLossShare: lossShare,
          }),
        };
      },
    );
    return {
      generatedAt: now(),
      area,
      stale,
      method:
        'score = 100 × (0.5 hazard + 0.25 biodiversity + 0.25 forest pressure); heuristic triage, not an official priority',
      events: rankEvents(scored),
    };
  }

  async function handler(req, res) {
    const json = (status, value) => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control':
          status === 200
            ? 'public, max-age=600, s-maxage=1800, stale-while-revalidate=3600'
            : 'no-store',
      });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    const path = (req.url || '/').split('?')[0];
    if (path !== '/' && path !== '')
      return json(404, { error: 'unknown_route' });
    if (result && now() - result.generatedAt < RESULT_CACHE_MS)
      return json(200, result);
    if (!inFlight && !allow(clientKey(req)))
      return json(429, { error: 'rate_limited' });
    try {
      inFlight ??= build().finally(() => {
        inFlight = null;
      });
      result = await inFlight;
      return json(200, result);
    } catch (error) {
      if (result) return json(200, result);
      console.warn('[priority] unavailable:', error?.message || error);
      return json(502, { error: 'Priority ranking unavailable' });
    }
  }

  const install = (server) => {
    server.middlewares.use('/api/priority', handler);
  };
  return {
    name: 'priority-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}

/**
 * Share of a tile's area with tree-cover loss. Overview tiles are averaged
 * down from 30 m pixels, so each pixel's alpha is the lost fraction of its
 * area: the mean alpha is the tile's loss share.
 */
async function defaultDecodeAlpha(bytes) {
  const { default: sharp } = await import('sharp');
  const { data, info } = await sharp(Buffer.from(bytes))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  if (!pixels) return 0;
  let alpha = 0;
  for (let i = info.channels - 1; i < data.length; i += info.channels)
    alpha += data[i];
  return alpha / (pixels * 255);
}
