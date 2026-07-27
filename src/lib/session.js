import jwt from 'jsonwebtoken';
import { config } from '../config.js';

/**
 * In-memory store mapping the app session id → Intermedia user tokens.
 * Swap for Redis/DB in production so sessions survive restarts and scale out.
 */
const store = new Map();

export function createSession(tokens) {
  const sid = cryptoRandom();
  store.set(sid, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  });
  // The app only ever sees this opaque JWT, never the Intermedia tokens.
  return jwt.sign({ sid }, config.appJwtSecret, { expiresIn: '30d' });
}

export function getSession(appJwt) {
  try {
    const { sid } = jwt.verify(appJwt, config.appJwtSecret);
    return { sid, tokens: store.get(sid) };
  } catch {
    return null;
  }
}

export function updateTokens(sid, tokens) {
  const cur = store.get(sid) ?? {};
  store.set(sid, {
    access_token: tokens.access_token ?? cur.access_token,
    refresh_token: tokens.refresh_token ?? cur.refresh_token,
    expires_at: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  });
}

export function destroySession(sid) { store.delete(sid); }

function cryptoRandom() {
  return [...crypto.getRandomValues(new Uint8Array(24))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}
