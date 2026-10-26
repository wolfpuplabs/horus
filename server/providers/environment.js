import {
  normalizeEonetEvents,
  normalizeGdacsEvents,
} from '../../src/layers/disasters/records.js';
import {
  coalesceProxyRequest,
  readResponseBytesCapped,
  readResponseJsonCapped,
} from './common/http.js';
import { clientKey, makeRateLimiter } from './common/rate-limit.js';
import { admitSameSiteKeyless } from './common/same-site.js';

// Keyless environmental feeds for the Horus environment layers:
//   /api/disasters   GDACS + NASA EONET current natural disasters, merged.
//   /api/gbif-tiles  GBIF occurrence-density map tiles for flora and fauna.

// The app list holds only the latest 100 events, so each hazard type is also
// searched over the last 30 days; floods and droughts would otherwise fall
// behind fire alerts.
const GDACS_BASE = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist';
const GDACS_EVENT_TYPES = Object.freeze(['FL', 'DR', 'VO', 'TC', 'EQ', 'WF']);
const GDACS_SEARCH_DAYS = 30;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
export function gdacsUrls(nowMs) {
  const from = isoDay(nowMs - GDACS_SEARCH_DAYS * 86_400_000);
  const to = isoDay(nowMs);
  return [
    `${GDACS_BASE}/EVENTS4APP`,
    ...GDACS_EVENT_TYPES.map(
      (type) =>
        `${GDACS_BASE}/SEARCH?eventlist=${type}&fromDate=${from}&toDate=${to}&alertlevel=Green;Orange;Red`,
    ),
  ];
}
const EONET_URL =
  'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=60';
const USER_AGENT = 'horus-environment-proxy/1.0';
const DISASTER_CACHE_MS = 10 * 60_000;
/** A last good snapshot keeps answering for a day while both feeds fail. */
const DISASTER_STALE_MS = 24 * 60 * 60_000;
const MAX_FEED_BYTES = 16 * 1024 * 1024;
const FEED_TIMEOUT_MS = 15_000;

/** GBIF kingdom keys behind each habitat layer, with its tile style. */
export const GBIF_GROUPS = Object.freeze({
  flora: Object.freeze({ taxonKey: 6, style: 'green.poly' }),
  fauna: Object.freeze({ taxonKey: 1, style: 'purpleYellow.poly' }),
});
const GBIF_MAX_ZOOM = 14;
const GBIF_TILES_PER_MINUTE = 600;
const MAX_TILES_IN_FLIGHT = 32;
const MAX_TILE_BYTES = 2 * 1024 * 1024;
const TILE_TIMEOUT_MS = 10_000;
// GBIF answers 204 for a tile with no records; Cesium needs an image.
const EMPTY_TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNgYGBgAAAABQABeqhXUAAAAABJRU5ErkJggg==',
  'base64',
);

async function fetchFeed(fetchImpl, url, normalize) {
  const signal = AbortSignal.timeout(FEED_TIMEOUT_MS);
  const response = await fetchImpl(url, {
    signal,
    redirect: 'follow',
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status}`);
  }
  const rows = normalize(
    await readResponseJsonCapped(response, MAX_FEED_BYTES, signal),
  );
  if (!rows) throw new Error('malformed feed');
  return rows;
}

/** The app list and every per-type search in parallel; any answer counts. */
async function fetchGdacs(fetchImpl, nowMs) {
  const results = await Promise.allSettled(
    gdacsUrls(nowMs).map((url) =>
      fetchFeed(fetchImpl, url, normalizeGdacsEvents),
    ),
  );
  const answered = results.filter((result) => result.status === 'fulfilled');
  if (!answered.length) throw results[0].reason;
  const rows = new Map();
  for (const { value } of answered)
    for (const row of value) rows.set(row.id, row);
  return [...rows.values()];
}

/**
 * The merged GDACS + EONET snapshot, cached and shared: /api/disasters and
 * /api/priority read the same upstream fetch. One feed failing still answers
 * with the other; a last good snapshot answers for a day while both fail.
 */
export function createDisasterFeed({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const inFlight = new Map();
  let cached = null;

  async function load() {
    const [gdacs, eonet] = await Promise.allSettled([
      fetchGdacs(fetchImpl, now()),
      fetchFeed(fetchImpl, EONET_URL, normalizeEonetEvents),
    ]);
    const status = (result) =>
      result.status === 'fulfilled'
        ? { ok: true, count: result.value.length }
        : { ok: false, error: String(result.reason?.message || 'failed') };
    if (gdacs.status === 'rejected' && eonet.status === 'rejected')
      throw new Error('all_feeds_unavailable');
    return {
      generatedAt: now(),
      feeds: { gdacs: status(gdacs), eonet: status(eonet) },
      events: [
        ...(gdacs.status === 'fulfilled' ? gdacs.value : []),
        ...(eonet.status === 'fulfilled' ? eonet.value : []),
      ],
    };
  }

  return {
    /** True when a call would reach upstream rather than the cache. */
    needsFetch: () =>
      !cached || now() - cached.generatedAt >= DISASTER_CACHE_MS,
    /** @returns {Promise<{ snapshot: object, stale: boolean }>} */
    async get() {
      if (cached && now() - cached.generatedAt < DISASTER_CACHE_MS)
        return { snapshot: cached, stale: false };
      try {
        const { promise } = coalesceProxyRequest(inFlight, 'disasters', load);
        cached = await promise;
        return { snapshot: cached, stale: false };
      } catch (error) {
        if (cached && now() - cached.generatedAt < DISASTER_STALE_MS)
          return { snapshot: cached, stale: true };
        throw error;
      }
    },
  };
}

/** Serve the merged disaster snapshot. */
export function disastersProxy({
  fetchImpl,
  now,
  feed = createDisasterFeed({ fetchImpl, now }),
} = {}) {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 30, globalMax: 600 });

  async function handler(req, res) {
    const json = (status, value, extra = {}) => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control':
          status === 200
            ? 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600'
            : 'no-store',
        ...extra,
      });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    const path = (req.url || '/').split('?')[0];
    if (path !== '/' && path !== '')
      return json(404, { error: 'unknown_route' });
    if (feed.needsFetch() && !allow(clientKey(req)))
      return json(429, { error: 'rate_limited' }, { 'Retry-After': '60' });
    try {
      const { snapshot, stale } = await feed.get();
      return json(200, snapshot, stale ? { 'X-Data-Stale': 'true' } : {});
    } catch (error) {
      console.warn('[disasters] feeds unavailable:', error?.message || error);
      return json(502, { error: 'Natural disaster feeds unavailable' });
    }
  }

  const install = (server) => {
    server.middlewares.use('/api/disasters', handler);
  };
  return {
    name: 'disasters-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}

/**
 * Parse `/<group>/<z>/<x>/<y>.png` into a GBIF tile request.
 * @returns {{ group: string, z: number, x: number, y: number } | null}
 */
export function parseGbifTilePath(path) {
  const match = /^\/(flora|fauna)\/(\d{1,2})\/(\d{1,6})\/(\d{1,6})\.png$/.exec(
    path,
  );
  if (!match) return null;
  const [, group, ...numbers] = match;
  const [z, x, y] = numbers.map(Number);
  const span = 2 ** z;
  if (z > GBIF_MAX_ZOOM || x >= span || y >= span) return null;
  return { group, z, x, y };
}

/** GBIF density tile URL for one habitat group (Web Mercator, hex bins). */
export function gbifTileUrl({ group, z, x, y }) {
  const { taxonKey, style } = GBIF_GROUPS[group];
  const params = new URLSearchParams({
    srs: 'EPSG:3857',
    taxonKey: String(taxonKey),
    bin: 'hex',
    hexPerTile: '48',
    style,
  });
  return `https://api.gbif.org/v2/map/occurrence/density/${z}/${x}/${y}@1x.png?${params}`;
}

/** Same-origin GBIF tiles, so the CDN can cache them and WebGL can read them. */
export function gbifTilesProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  admit = admitSameSiteKeyless,
} = {}) {
  const inFlight = new Map();
  // A map view loads a few dozen tiles and panning loads more; the per-client
  // cap only stops a scraper walking the tile pyramid through this proxy.
  const allow = makeRateLimiter({
    windowMs: 60_000,
    max: GBIF_TILES_PER_MINUTE,
    globalMax: GBIF_TILES_PER_MINUTE * 20,
  });

  async function handler(req, res) {
    const send = (status, body, type, cache) => {
      if (res.destroyed) return;
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': cache });
      res.end(body);
    };
    if (req.method !== 'GET')
      return send(405, 'method_not_allowed', 'text/plain', 'no-store');
    // Hotlinking from another site would spend this deployment's functions.
    if (admit(req, res)) return undefined;
    if (inFlight.size >= MAX_TILES_IN_FLIGHT || !allow(clientKey(req)))
      return send(429, 'rate_limited', 'text/plain', 'no-store');
    const tile = parseGbifTilePath((req.url || '/').split('?')[0]);
    if (!tile) return send(404, 'unknown_tile', 'text/plain', 'no-store');
    const url = gbifTileUrl(tile);
    try {
      const { promise } = coalesceProxyRequest(inFlight, url, async () => {
        const signal = AbortSignal.timeout(TILE_TIMEOUT_MS);
        const response = await fetchImpl(url, {
          signal,
          headers: { Accept: 'image/png', 'User-Agent': USER_AGENT },
        });
        if (response.status === 204 || response.status === 404) {
          await response.body?.cancel();
          return EMPTY_TILE;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`HTTP ${response.status}`);
        }
        const bytes = await readResponseBytesCapped(
          response,
          MAX_TILE_BYTES,
          signal,
        );
        return bytes.byteLength ? Buffer.from(bytes) : EMPTY_TILE;
      });
      return send(
        200,
        await promise,
        'image/png',
        'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800',
      );
    } catch {
      return send(502, 'tile_unavailable', 'text/plain', 'no-store');
    }
  }

  const install = (server) => {
    server.middlewares.use('/api/gbif-tiles', handler);
  };
  return {
    name: 'gbif-tiles-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
