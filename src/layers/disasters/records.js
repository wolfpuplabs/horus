/**
 * Natural-disaster records from GDACS and NASA EONET, normalized to one shape
 * so the server merges them and the layer renders them without caring which
 * feed a row came from.
 *
 * Row: { id, source, kind, title, lat, lon, alert, severity, country,
 *        startMs, endMs, url }
 */

/** Disaster kinds the layer knows how to colour, in legend order. */
export const DISASTER_KINDS = Object.freeze([
  'flood',
  'wildfire',
  'cyclone',
  'storm',
  'volcano',
  'earthquake',
  'drought',
  'landslide',
  'extreme-temperature',
  'other',
]);

const GDACS_KINDS = Object.freeze({
  EQ: 'earthquake',
  TC: 'cyclone',
  FL: 'flood',
  VO: 'volcano',
  DR: 'drought',
  WF: 'wildfire',
});

const EONET_KINDS = Object.freeze({
  floods: 'flood',
  wildfires: 'wildfire',
  severeStorms: 'storm',
  volcanoes: 'volcano',
  earthquakes: 'earthquake',
  drought: 'drought',
  landslides: 'landslide',
  tempExtremes: 'extreme-temperature',
  dustHaze: 'other',
  snow: 'other',
});

const ALERTS = new Set(['green', 'orange', 'red']);

const text = (value, max = 300) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

const time = (value) => {
  if (typeof value !== 'string' && !Number.isFinite(value)) return null;
  const ms = typeof value === 'string' ? Date.parse(value) : value;
  return Number.isFinite(ms) ? ms : null;
};

const validPoint = (lon, lat) =>
  Number.isFinite(lon) &&
  Number.isFinite(lat) &&
  Math.abs(lon) <= 180 &&
  Math.abs(lat) <= 90;

const httpsUrl = (value) => {
  const candidate = text(value, 1000);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : null;
  } catch {
    return null;
  }
};

/** Average of a polygon's outer ring, enough to place one marker. */
function ringCentre(coordinates) {
  const ring = Array.isArray(coordinates?.[0]) ? coordinates[0] : null;
  if (!ring?.length) return null;
  let lon = 0;
  let lat = 0;
  let count = 0;
  for (const point of ring) {
    if (!validPoint(point?.[0], point?.[1])) continue;
    lon += point[0];
    lat += point[1];
    count++;
  }
  return count ? [lon / count, lat / count] : null;
}

/**
 * GDACS event list (GeoJSON FeatureCollection). The map list also carries
 * affected-area polygons for each event; only the event points are kept.
 * @returns {Array<object>|null} null when the payload is not a feature list.
 */
export function normalizeGdacsEvents(payload) {
  if (!Array.isArray(payload?.features)) return null;
  const rows = [];
  const ids = new Set();
  for (const feature of payload.features) {
    const properties = feature?.properties;
    const geometry = feature?.geometry;
    if (!properties || geometry?.type !== 'Point') continue;
    const [lon, lat] = geometry.coordinates || [];
    if (!validPoint(lon, lat)) continue;
    const type = String(properties.eventtype || '').toUpperCase();
    const kind = GDACS_KINDS[type];
    if (!kind) continue;
    const eventId = properties.eventid ?? properties.eventId;
    if (eventId == null || eventId === '') continue;
    const id = `gdacs:${type}:${eventId}`;
    if (ids.has(id)) continue;
    ids.add(id);
    const alert = String(properties.alertlevel || '').toLowerCase();
    rows.push({
      id,
      source: 'GDACS',
      kind,
      title:
        text(properties.name) ||
        text(properties.eventname) ||
        text(properties.description) ||
        kind,
      lat,
      lon,
      alert: ALERTS.has(alert) ? alert : null,
      severity: text(properties.severitydata?.severitytext),
      country: text(properties.country, 200),
      startMs: time(properties.fromdate),
      endMs: time(properties.todate),
      url: httpsUrl(properties.url?.report),
    });
  }
  return rows;
}

/**
 * NASA EONET v3 events. Each event keeps its latest dated geometry.
 * @returns {Array<object>|null} null when the payload is not an event list.
 */
export function normalizeEonetEvents(payload) {
  if (!Array.isArray(payload?.events)) return null;
  const rows = [];
  const ids = new Set();
  for (const event of payload.events) {
    const category = event?.categories?.[0]?.id;
    const kind = EONET_KINDS[category];
    if (!kind || event?.id == null) continue;
    const id = `eonet:${event.id}`;
    if (ids.has(id)) continue;
    const geometries = Array.isArray(event.geometry) ? event.geometry : [];
    let latest = null;
    for (const geometry of geometries) {
      const at = time(geometry?.date);
      if (!latest || (at ?? -Infinity) >= (latest.at ?? -Infinity))
        latest = { geometry, at };
    }
    if (!latest) continue;
    const { geometry } = latest;
    const point =
      geometry.type === 'Point'
        ? geometry.coordinates
        : geometry.type === 'Polygon'
          ? ringCentre(geometry.coordinates)
          : null;
    if (!validPoint(point?.[0], point?.[1])) continue;
    ids.add(id);
    const magnitude = Number.isFinite(geometry.magnitudeValue)
      ? `${geometry.magnitudeValue} ${text(geometry.magnitudeUnit, 40) || ''}`.trim()
      : null;
    rows.push({
      id,
      source: 'NASA EONET',
      kind,
      title: text(event.title) || kind,
      lat: point[1],
      lon: point[0],
      alert: null,
      severity: magnitude,
      country: null,
      startMs: time(geometries[0]?.date),
      endMs: event.closed ? time(event.closed) : null,
      url: httpsUrl(event.sources?.[0]?.url) || httpsUrl(event.link),
    });
  }
  return rows;
}

/**
 * Validate the merged server payload before it replaces what the layer shows.
 * @returns {Array<object>|null}
 */
export function normalizeDisasterSnapshot(payload) {
  if (!Array.isArray(payload?.events)) return null;
  const rows = [];
  const ids = new Set();
  for (const row of payload.events) {
    if (
      typeof row?.id !== 'string' ||
      ids.has(row.id) ||
      !DISASTER_KINDS.includes(row.kind) ||
      !validPoint(row.lon, row.lat)
    )
      continue;
    ids.add(row.id);
    rows.push({
      id: row.id,
      source: text(row.source, 40) || '',
      kind: row.kind,
      title: text(row.title) || row.kind,
      lat: row.lat,
      lon: row.lon,
      alert: ALERTS.has(row.alert) ? row.alert : null,
      severity: text(row.severity),
      country: text(row.country, 200),
      startMs: Number.isFinite(row.startMs) ? row.startMs : null,
      endMs: Number.isFinite(row.endMs) ? row.endMs : null,
      url: httpsUrl(row.url),
    });
  }
  return rows;
}
