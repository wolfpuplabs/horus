import '../server/vercel/tmp-cwd.js';
import {
  createApiApp,
  restoreApiUrl,
  vercelClientAddress,
} from '../server/vercel/app.js';

const app = createApiApp();

/** Vercel entry point: every /api request is rewritten here. */
export default function handler(req, res) {
  const url = restoreApiUrl(req.url);
  if (String(req.url).includes('weather'))
    console.log('[gev-debug] raw', req.url, '->', url);
  if (url === null) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid_path' }));
    return;
  }
  req.url = url;
  req.gevClientAddress = vercelClientAddress(req.headers);
  app(req, res);
}
