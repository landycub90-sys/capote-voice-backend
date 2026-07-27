import { config, oauthConfigured } from '../config.js';
import { getSession, updateTokens } from '../lib/session.js';
import { apiGet, refreshToken } from '../lib/intermedia.js';
import { mock } from '../lib/mock.js';
import { Router } from 'express';

export const apiRouter = Router();

/** Bearer-JWT middleware: resolves the app session → Intermedia user token. */
apiRouter.use(async (req, res, next) => {
  if (!oauthConfigured()) return next(); // dev mode → mock

  const auth = req.headers.authorization ?? '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const session = jwt ? getSession(jwt) : null;
  if (!session?.tokens) return res.status(401).json({ error: 'unauthorized' });

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

// ── Mappers: Intermedia Extend shapes → app models ──────────────────────────
function mapContact(c) {
  return {
    name: c.displayName || c.email || 'Sin nombre',
    extensionNumber: c.pbx?.extension ?? null,
    phone: c.phoneNumbers?.[0]?.internationalFormatNumber || c.phoneNumbers?.[0]?.number || '',
    title: c.title ?? c.department ?? null,
    presence: 'available',            // TODO: real presence via /messaging/v1/presence
    isFavorite: false,
  };
}

// ── Endpoints ───────────────────────────────────────────────────────────────

/** Current account, built from the user's own address-book contact. */
apiRouter.get('/me', async (req, res) => {
  try {
    const me = await apiGet('/address-book/v3/contacts/_me', req.userToken); // { id }
    const book = await apiGet('/address-book/v3/contacts', req.userToken);
    const self = (book.results || []).find((c) => c.id === me.id) || (book.results || [])[0] || {};
    res.json({
      id: me.id,
      displayName: self.displayName || 'Usuario',
      extensionNumber: self.pbx?.extension || '',
      email: self.email || '',
      presence: 'available',
    });
  } catch (e) {
    req.log?.warn(e);
    res.json(oauthConfigured() ? { id: '', displayName: 'Usuario', extensionNumber: '', email: '', presence: 'offline' } : mock.account);
  }
});

/** Company directory (real data). */
apiRouter.get('/contacts', async (req, res) => {
  try {
    const book = await apiGet('/address-book/v3/contacts', req.userToken);
    res.json((book.results || []).map(mapContact));
  } catch (e) {
    req.log?.warn(e);
    res.json(oauthConfigured() ? [] : mock.contacts);
  }
});

// Endpoints whose exact Intermedia paths / provisioning are still being confirmed.
// They degrade to an empty list so the app shows clean empty states (no errors).
// TODO: confirm the correct paths in the OpenAPI specs and map the shapes:
//   call history → developer.intermedia.com/api/spec/calling
//   voicemail    → calling spec (voicemail 403 = check scope / mailbox provisioning)
//   meetings     → developer.intermedia.com/api/spec/meeting
//   messaging    → developer.intermedia.com/api/spec/messaging
apiRouter.get('/call-history',  (req, res) => res.json(oauthConfigured() ? [] : mock.calls));
apiRouter.get('/voicemails',    (req, res) => res.json(oauthConfigured() ? [] : mock.voicemails));
apiRouter.get('/conversations', (req, res) => res.json(oauthConfigured() ? [] : mock.conversations));
apiRouter.get('/meetings',      (req, res) => res.json(oauthConfigured() ? [] : mock.meetings));

/** POST /api/calls { to } → click-to-call (path pending confirmation). */
apiRouter.post('/calls', async (req, res) => {
  const { to } = req.body ?? {};
  if (!to) return res.status(400).json({ error: 'missing_destination' });
  res.json({ status: 'accepted', to, note: 'click-to-call wiring pending' });
});
