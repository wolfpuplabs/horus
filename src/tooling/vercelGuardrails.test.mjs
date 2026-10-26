import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreApiUrl, vercelClientAddress } from '../../server/vercel/app.js';
import { peerAddress } from '../../server/providers/common/peer.js';
import { clientKey } from '../../server/providers/common/rate-limit.js';
import { gbifTilesProxy } from '../../server/providers/environment.js';

test('the rewrite restores /api paths and refuses climbing out of /api', () => {
  assert.equal(
    restoreApiUrl('/api/gev?__gevpath=gbif-tiles/flora/1/0/0.png&q=1'),
    '/api/gbif-tiles/flora/1/0/0.png?q=1',
  );
  assert.equal(restoreApiUrl('/api/disasters'), '/api/disasters');
  assert.equal(
    restoreApiUrl(
      '/api/gev?__gevpath=weather/manifest&product=radar&_vercel_share=t&path=weather/manifest',
    ),
    '/api/weather/manifest?product=radar',
  );
  assert.equal(restoreApiUrl('/api/gev?__gevpath=a/../setup/keys'), null);
});

test('on Vercel every visitor is keyed by the platform address, never loopback', () => {
  assert.equal(
    vercelClientAddress({ 'x-real-ip': '203.0.113.9' }),
    'vercel:203.0.113.9',
  );
  assert.equal(vercelClientAddress({}), 'vercel:unknown');
  const proxied = {
    gevClientAddress: vercelClientAddress({ 'x-real-ip': '127.0.0.1' }),
    socket: { remoteAddress: '127.0.0.1' },
  };
  assert.notEqual(peerAddress(proxied), '127.0.0.1');
  assert.equal(clientKey(proxied), 'vercel:127.0.0.1');
  assert.equal(peerAddress({ socket: { remoteAddress: '::1' } }), '::1');
});

function callTile(proxy, url, headers = {}) {
  const routes = [];
  proxy.configureServer({
    middlewares: { use: (route, handler) => routes.push(handler) },
  });
  return new Promise((resolve) => {
    let status = 0;
    routes[0](
      { method: 'GET', url, headers, socket: { remoteAddress: '10.0.0.1' } },
      {
        destroyed: false,
        headersSent: false,
        statusCode: 200,
        setHeader() {},
        writeHead(code) {
          status = code;
        },
        end() {
          resolve(status || this.statusCode);
        },
      },
    );
  });
}

test('GBIF tiles refuse cross-site hotlinks and unknown paths', async () => {
  let upstreamCalls = 0;
  const fetchImpl = async () => {
    upstreamCalls++;
    return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 });
  };
  const proxy = () => gbifTilesProxy({ fetchImpl });
  assert.equal(
    await callTile(proxy(), '/flora/1/0/0.png', {
      host: 'horus.example',
      'sec-fetch-site': 'cross-site',
    }),
    403,
  );
  assert.equal(await callTile(proxy(), '/fungi/1/0/0.png'), 404);
  assert.equal(upstreamCalls, 0);
  assert.equal(await callTile(proxy(), '/fauna/1/0/0.png'), 200);
  assert.equal(upstreamCalls, 1);
});
