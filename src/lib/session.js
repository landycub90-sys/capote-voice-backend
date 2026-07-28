import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Session store: app session id → Intermedia user tokens.
 * Persisted to a JSON file so sessions survive container restarts/redeploys
 * (set SESSION_STORE_PATH to a path on a mounted volume for full durability).
 * The app only ever holds an opaque signed JWT, never the Intermedia tokens.
 */
const STORE_PATH = process.env.SESSION_STORE_PATH || '/app/data/sessions.json';

const store = new Map(loadFromDisk());

function loadFromDisk() {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    return Object.entries(JSON.parse(raw));
  } catch {
    return []; // no file yet (first run) → empty store
  }
}

let saveTimer = null;
function persist() {
  // Debounced write so bursts of requests don't hammer the disk.
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
      fs.writeFileSync(STORE_PATH, JSON.stringify(Object.fromEntries(store)));
    } catch (e) {
      console.warn('session persist failed:', e.message);
    }
  }, 250);
}

export function createSession(tokens) {
  const sid = cryptoRandom();
  store.set(sid, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  });
  persist();
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
  persist();
}

export function destroySession(sid) { store.delete(sid); persist(); }

function cryptoRandom() {
  return [...crypto.getRandomValues(new Uint8Array(24))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}
