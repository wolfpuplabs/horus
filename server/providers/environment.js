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

// Keyless environmental feeds for the Horus environment layers:
//   /api/disasters   GDACS + NASA EONET current natural disasters, merged.
//   /api/gbif-tiles  GBIF occurrence-density map tiles for flora and fauna.

// The map list returns at most 100 events, so each hazard type is asked for
// on its own; floods and droughts would otherwise fall behind fire alerts.
const GDACS_EVENT_TYPES = Object.freeze(['FL', 'DR', 'VO', 'TC', 'EQ', 'WF']);
const gdacsUrl = (type) =>
  `https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtypes=${type}`;
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

/** Every GDACS hazard type in parallel; succeeds when any type answers. */
async function fetchGdacs(fetchImpl) {
  const results = await Promise.allSettled(
    GDACS_EVENT_TYPES.map((type) =>
      fetchFeed(fetchImpl, gdacsUrl(type), normalizeGdacsEvents),
    ),
  );
  const answered = results.filter((result) => result.status === 'fulfilled');
  if (!answered.length) throw results[0].reason;
  const rows = new Map();
  for (const { value } of answered)
    for (const row of value) rows.set(row.id, row);
  return [...rows.values()];
}

/** Merge GDACS and EONET; one feed failing still answers with the other. */
export function disastersProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const inFlight = new Map();
  const allow = makeRateLimiter({ windowMs: 60_000, max: 30, globalMax: 600 });
  let cached = null;

  async function load() {
    const [gdacs, eonet] = await Promise.allSettled([
      fetchGdacs(fetchImpl),
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
    if (cached && now() - cached.generatedAt < DISASTER_CACHE_MS)
      return json(200, cached);
    try {
      if (!inFlight.size && !allow(clientKey(req)))
        return json(429, { error: 'rate_limited' }, { 'Retry-After': '60' });
      const { promise } = coalesceProxyRequest(inFlight, 'disasters', load);
      cached = await promise;
      return json(200, cached);
    } catch (error) {
      if (cached && now() - cached.generatedAt < DISASTER_STALE_MS)
        return json(200, cached, { 'X-Data-Stale': 'true' });
      return json(502, {
        error: 'Natural disaster feeds unavailable',
        detail: String(error?.message || error),
      });
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
} = {}) {
  const inFlight = new Map();

  async function handler(req, res) {
    const send = (status, body, type, cache) => {
      if (res.destroyed) return;
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': cache });
      res.end(body);
    };
    if (req.method !== 'GET')
      return send(405, 'method_not_allowed', 'text/plain', 'no-store');
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
