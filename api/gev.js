import '../server/vercel/tmp-cwd.js';
import { createApiApp, restoreApiUrl } from '../server/vercel/app.js';

const app = createApiApp();

/** Vercel entry point: every /api request is rewritten here. */
export default function handler(req, res) {
  req.url = restoreApiUrl(req.url);
  app(req, res);
}
