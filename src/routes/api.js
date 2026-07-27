import { Router } from 'express';
import { config, oauthConfigured } from '../config.js';
import { getSession, updateTokens } from '../lib/session.js';
import { apiGet, refreshToken } from '../lib/intermedia.js';
import { mock } from '../lib/mock.js';

export const apiRouter = Router();

/** Bearer-JWT middleware: resolves the app session → Intermedia user token. */
apiRouter.use(async (req, res, next) => {
  // Dev mode: no Intermedia OAuth configured → skip auth and serve mock data.
  if (!oauthConfigured()) return next();

  const auth = req.headers.authorization ?? '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const session = jwt ? getSession(jwt) : null;
  if (!session?.tokens) return res.status(401).json({ error: 'unauthorized' });

  // Refresh the Intermedia token if it is about to expire.
  let { access_token, refresh_token, expires_at } = session.tokens;
  if (Date.now() > expires_at - 60_000 && refresh_token) {
    try {
      const t = await refreshToken(refresh_token);
      updateTokens(session.sid, t);
      access_token = t.access_token;
    } catch (e) { req.log?.warn(e); }
  }
  req.userToken = access_token;
  next();
});

/**
 * Each endpoint maps an Extend API response to the shape the iOS app expects
 * (see IntermediaClient.swift). Paths are placeholders — confirm the exact ones
 * at developer.intermedia.com, then remove the mock fallback.
 */
function handler(fetcher, mockData) {
  return async (req, res) => {
    if (!oauthConfigured()) return res.json(mockData); // dev fallback
    try {
      const data = await fetcher(req);
      // TEMP: log real Intermedia shape to build the mappers, then remove.
      req.log?.info({ shape: req.path, raw: JSON.stringify(data).slice(0, 1500) }, 'UPSTREAM_SHAPE');
      res.json(data);
    } catch (e) {
      req.log?.error(e);
      res.status(502).json({ error: 'upstream_error', message: String(e.message) });
    }
  };
}

// Confirmed against the Intermedia Extend OpenAPI specs (developer.intermedia.com)
// and SDK. Base host: api.intermedia.net.
// Messaging IS available (scope api.user.messaging): chat channels + DMs + SMS + presence.
apiRouter.get('/me',            handler((r) => apiGet('/address-book/v3/contacts/_me', r.userToken), mock.account));
apiRouter.get('/contacts',      handler((r) => apiGet('/address-book/v3/contacts', r.userToken), mock.contacts));
apiRouter.get('/call-history',  handler((r) => apiGet('/voice/v2/accounts/_me/calls', r.userToken), mock.calls));
apiRouter.get('/voicemails',    handler((r) => apiGet('/voice/v2/accounts/_me/voicemails', r.userToken), mock.voicemails));
apiRouter.get('/conversations', handler((r) => apiGet('/messaging/v2/accounts/_me/chat/users/history', r.userToken), mock.conversations));
apiRouter.get('/channels',      handler((r) => apiGet('/messaging/v2/accounts/_me/chat/channels', r.userToken), []));
apiRouter.get('/sms',           handler((r) => apiGet('/messaging/v2/accounts/_me/sms/users/history', r.userToken), []));
apiRouter.get('/meetings',      handler((r) => apiGet('/video/v1/accounts/_me/meetings', r.userToken), mock.meetings));

/** POST /api/messages { to, text } → send a chat message to a user. */
apiRouter.post('/messages', async (req, res) => {
  const { to, text } = req.body ?? {};
  if (!to || !text) return res.status(400).json({ error: 'missing_fields' });
  if (!oauthConfigured() || !req.userToken) return res.json({ status: 'sent', mock: true });
  try {
    const r = await fetch(`${config.intermedia.apiBase}/messaging/v2/accounts/_me/users/_me/chat/message`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${req.userToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, text }),
    });
    res.status(r.status).json(await r.json().catch(() => ({})));
  } catch (e) {
    req.log?.error(e);
    res.status(502).json({ error: 'send_failed' });
  }
});

/**
 * POST /api/calls  { to: "+1305..." }
 * Click-to-call: rings the user's line then connects to the destination.
 * Uses the USER token (scope api.user.voice.calls) — calls are user-scoped in the
 * Extend API, so the service account is not used here.
 */
apiRouter.post('/calls', async (req, res) => {
  const { to } = req.body ?? {};
  if (!to) return res.status(400).json({ error: 'missing_destination' });
  if (!oauthConfigured() || !req.userToken) return res.json({ status: 'accepted', mock: true, to });
  try {
    const r = await fetch(`${config.intermedia.apiBase}/voice/v2/accounts/_me/calls`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${req.userToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to }),
    });
    res.status(r.status).json(await r.json().catch(() => ({})));
  } catch (e) {
    req.log?.error(e);
    res.status(502).json({ error: 'call_failed' });
  }
});
