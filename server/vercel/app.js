import connect from 'connect';
import { localProviderPlugins } from '../providers/local.js';
import { apiNotFoundPlugin } from '../standalone/api-not-found.js';
import { standaloneVoiceTools } from '../standalone/voiceTools.js';

// Writes .env and restarts the dev server: neither exists on a serverless host.
// Keys come from the project's environment variables instead.
const SERVERLESS_EXCLUDED_PLUGINS = new Set(['gev-key-setup']);

/**
 * Mount the standalone server's /api middleware on a plain connect app, the
 * same stack Vite hands each plugin's configureServer hook.
 */
export function createApiApp() {
  const app = connect();
  const server = { middlewares: app, httpServer: null };
  const tools = standaloneVoiceTools();
  const plugins = [
    ...localProviderPlugins({ realtime: { tools }, gemini: { tools } }),
    apiNotFoundPlugin(),
  ].filter((plugin) => !SERVERLESS_EXCLUDED_PLUGINS.has(plugin.name));
  const postHooks = [];
  for (const plugin of plugins) {
    const hook = plugin.configureServer;
    const install = typeof hook === 'function' ? hook : hook?.handler;
    const post = install?.call(plugin, server);
    if (typeof post === 'function') postHooks.push(post);
  }
  for (const post of postHooks) post();
  return app;
}

/**
 * Restore the public path from a `/api/:path*` rewrite to the single function.
 * Vercel may hand the function either the original URL or the destination.
 * @returns {string|null} null for a path that tries to climb out of /api.
 */
export function restoreApiUrl(rawUrl) {
  const url = new URL(rawUrl || '/', 'http://localhost');
  const forwarded = url.searchParams.get('__gevpath');
  if (forwarded === null) return rawUrl;
  if (forwarded.split('/').some((segment) => segment === '..')) return null;
  url.searchParams.delete('__gevpath');
  // Vercel also appends the rewrite's named segment (`path`) to the query;
  // routes with an exact query allowlist (weather) reject it as unknown.
  url.searchParams.delete('path');
  const search = url.searchParams.toString();
  return `/api/${forwarded.replace(/^\/+/, '')}${search ? `?${search}` : ''}`;
}

/**
 * The visitor's address as Vercel reports it. Vercel overwrites `x-real-ip`
 * with the connecting client, so it cannot be supplied by the caller; the
 * marker string keeps a missing header from reading as loopback.
 * @param {import('node:http').IncomingHttpHeaders} headers
 * @returns {string}
 */
export function vercelClientAddress(headers = {}) {
  const value = String(headers['x-real-ip'] || '').trim();
  return value ? `vercel:${value}` : 'vercel:unknown';
}
