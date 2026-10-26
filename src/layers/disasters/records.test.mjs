import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDisasterSnapshot,
  normalizeEonetEvents,
  normalizeGdacsEvents,
} from './records.js';
import {
  disastersProxy,
  gbifTileUrl,
  parseGbifTilePath,
} from '../../../server/providers/environment.js';

const gdacsPayload = {
  features: [
    {
      geometry: { type: 'Point', coordinates: [110.4, -7.8] },
      properties: {
        eventtype: 'FL',
        eventid: 1102,
        name: 'Flood in Indonesia',
        alertlevel: 'Orange',
        country: 'Indonesia',
        fromdate: '2026-10-20T00:00:00',
        todate: '2026-10-25T00:00:00',
        severitydata: { severitytext: 'Magnitude 2.1' },
        url: { report: 'https://www.gdacs.org/report.aspx?eventid=1102' },
      },
    },
    {
      // The affected-area polygon of the same event is not a second marker.
      geometry: { type: 'Polygon', coordinates: [[[110, -8]]] },
      properties: { eventtype: 'FL', eventid: 1102 },
    },
    {
      geometry: { type: 'Point', coordinates: [10, 10] },
      properties: { eventtype: 'XX', eventid: 1 },
    },
  ],
};

test('GDACS keeps one point per known event type with its alert', () => {
  const rows = normalizeGdacsEvents(gdacsPayload);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    id: 'gdacs:FL:1102',
    source: 'GDACS',
    kind: 'flood',
    title: 'Flood in Indonesia',
    lat: -7.8,
    lon: 110.4,
    alert: 'orange',
    severity: 'Magnitude 2.1',
    country: 'Indonesia',
    startMs: Date.parse('2026-10-20T00:00:00'),
    endMs: Date.parse('2026-10-25T00:00:00'),
    url: 'https://www.gdacs.org/report.aspx?eventid=1102',
  });
  assert.equal(normalizeGdacsEvents({}), null);
});

test('EONET places each event at its latest geometry and skips unmapped categories', () => {
  const rows = normalizeEonetEvents({
    events: [
      {
        id: 'EONET_1',
        title: 'Wildfire Riau',
        categories: [{ id: 'wildfires' }],
        sources: [{ url: 'https://example.org/fire' }],
        geometry: [
          {
            date: '2026-10-01T00:00:00Z',
            type: 'Point',
            coordinates: [101, 0.5],
          },
          {
            date: '2026-10-03T00:00:00Z',
            type: 'Point',
            coordinates: [101.5, 0.6],
            magnitudeValue: 1200,
            magnitudeUnit: 'acres',
          },
        ],
      },
      {
        id: 'EONET_2',
        title: 'Sea ice',
        categories: [{ id: 'seaLakeIce' }],
        geometry: [{ type: 'Point', coordinates: [0, 80] }],
      },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'wildfire');
  assert.equal(rows[0].lon, 101.5);
  assert.equal(rows[0].severity, '1200 acres');
  assert.equal(rows[0].startMs, Date.parse('2026-10-01T00:00:00Z'));
});

test('the browser snapshot drops invalid rows and unknown kinds', () => {
  const rows = normalizeDisasterSnapshot({
    events: [
      { id: 'a', kind: 'flood', lat: 1, lon: 2, title: 'ok' },
      { id: 'a', kind: 'flood', lat: 1, lon: 2 },
      { id: 'b', kind: 'meteor', lat: 1, lon: 2 },
      { id: 'c', kind: 'flood', lat: 95, lon: 2 },
    ],
  });
  assert.deepEqual(
    rows.map((row) => row.id),
    ['a'],
  );
  assert.equal(normalizeDisasterSnapshot(null), null);
});

test('GBIF tile paths are bounded to the two habitat groups and valid tiles', () => {
  assert.deepEqual(parseGbifTilePath('/flora/4/12/8.png'), {
    group: 'flora',
    z: 4,
    x: 12,
    y: 8,
  });
  assert.equal(parseGbifTilePath('/fungi/4/12/8.png'), null);
  assert.equal(parseGbifTilePath('/fauna/4/16/8.png'), null);
  assert.equal(parseGbifTilePath('/fauna/15/0/0.png'), null);
  assert.match(
    gbifTileUrl({ group: 'fauna', z: 1, x: 0, y: 1 }),
    /^https:\/\/api\.gbif\.org\/v2\/map\/occurrence\/density\/1\/0\/1@1x\.png\?.*taxonKey=1/,
  );
});

test('the disaster proxy answers with one feed when the other fails', async () => {
  const fetchImpl = async (url) =>
    String(url).includes('eonet')
      ? new Response(JSON.stringify({ events: [] }), { status: 200 })
      : new Response('down', { status: 503 });
  const routes = [];
  disastersProxy({ fetchImpl }).configureServer({
    middlewares: { use: (route, handler) => routes.push({ route, handler }) },
  });
  assert.deepEqual(
    routes.map(({ route }) => route),
    ['/api/disasters'],
  );
  let status = 0;
  let body = '';
  await routes[0].handler(
    { method: 'GET', url: '/', socket: {} },
    {
      writeHead: (code) => {
        status = code;
      },
      end: (text) => {
        body = text;
      },
    },
  );
  assert.equal(status, 200);
  const payload = JSON.parse(body);
  assert.equal(payload.feeds.gdacs.ok, false);
  assert.equal(payload.feeds.eonet.ok, true);
  assert.deepEqual(payload.events, []);
});
