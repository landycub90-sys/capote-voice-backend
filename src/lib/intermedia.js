import { config } from '../config.js';
import crypto from 'node:crypto';

/**
 * Minimal client for the Intermedia Extend OAuth2/OIDC token endpoints.
 * Uses the global `fetch` (Node >= 20).
 */

// ── PKCE helpers ────────────────────────────────────────────────────────────
export function createPkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function authorizeUrl({ state }) {
  // Confidential client (secret kept server-side) → standard Authorization Code
  // flow, no PKCE, matching the Intermedia Extend SDK.
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: config.oauth.clientId ?? '',
    redirect_uri: config.oauth.redirectUri,
    scope: config.oauth.scopes,
    state,
    // Required by Intermedia; the SAME value must be sent on the token request.
    acr_values: `deviceId:${config.oauth.deviceId}`,
  });
  return `${config.intermedia.authUrl}?${p.toString()}`;
}

// ── Token exchanges ─────────────────────────────────────────────────────────
async function postToken(body) {
  // Client authentication via HTTP Basic (matches the Intermedia Extend SDK /
  // IdentityModel default). Intermedia resolves the tenant from this header.
  // client_secret goes ONLY in the Basic header; client_id stays in the body too
  // (per the Intermedia auth guide example).
  const { client_secret, ...rest } = body;
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (rest.client_id && client_secret) {
    headers.Authorization =
      'Basic ' + Buffer.from(`${rest.client_id}:${client_secret}`).toString('base64');
  }
  const res = await fetch(config.intermedia.tokenUrl, {
    method: 'POST',
    headers,
    body: new URLSearchParams(rest).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Intermedia token error ${res.status}: ${text}`);
  }
  return res.json();
}

/** Exchange an authorization code for user tokens.
 *  Intermedia requires `acr_values=deviceId:<id>` (else it returns invalid_tenant). */
export function exchangeCode(code) {
  return postToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.oauth.redirectUri,
    client_id: config.oauth.clientId,
    client_secret: config.oauth.clientSecret,
    scope: config.oauth.scopes,                       // same scope as /authorize
    acr_values: `deviceId:${config.oauth.deviceId}`,  // same deviceId as /authorize
  });
}

/** Refresh a user access token. */
export function refreshToken(refresh_token) {
  return postToken({
    grant_type: 'refresh_token',
    refresh_token,
    client_id: config.oauth.clientId,
    client_secret: config.oauth.clientSecret,
    acr_values: `deviceId:${config.oauth.deviceId}`,
  });
}

/** Get a service-account token (client_credentials) for server-to-server calls. */
let saCache = { token: null, exp: 0 };
export async function serviceAccountToken() {
  if (saCache.token && Date.now() < saCache.exp - 60_000) return saCache.token;
  const t = await postToken({
    grant_type: 'client_credentials',
    client_id: config.serviceAccount.clientId,
    client_secret: config.serviceAccount.clientSecret,
    scope: config.serviceAccount.scopes,
  });
  saCache = { token: t.access_token, exp: Date.now() + (t.expires_in ?? 3600) * 1000 };
  return saCache.token;
}

/** Call an Extend API endpoint with a bearer token. */
export async function apiGet(path, accessToken) {
  const res = await fetch(`${config.intermedia.apiBase}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Extend API ${path} → ${res.status}`);
  return res.json();
}

/** POST to an Extend API endpoint with a bearer token and JSON body. */
export async function apiPost(path, accessToken, body = {}) {
  const res = await fetch(`${config.intermedia.apiBase}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Extend API POST ${path} → ${res.status}`);
  return res.json();
}
