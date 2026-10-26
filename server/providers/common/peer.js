/**
 * The client address a request came from. A local server reads the socket
 * peer. The Vercel entry (`api/gev.js`) stamps `gevClientAddress` from the
 * platform's `x-real-ip`, because there every socket peer is Vercel's own
 * proxy: keying limits on it would make all visitors one client, and a
 * loopback-looking proxy address must never pass a loopback-only check.
 * @param {import('node:http').IncomingMessage} req
 * @returns {string}
 */
export function peerAddress(req) {
  if (typeof req?.gevClientAddress === 'string') return req.gevClientAddress;
  return String(req?.socket?.remoteAddress || '');
}
