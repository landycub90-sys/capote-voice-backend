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

/** Normalize any timestamp to strict ISO-8601 without fractional seconds
 *  (the app decodes dates with .iso8601, which rejects milliseconds). */
function iso(v) {
  const d = new Date(v);
  return (isNaN(d.getTime()) ? new Date(0) : d).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Build the user's own JID + a jid→name map from the address book. */
async function contactContext(token) {
  const [me, book] = await Promise.all([
    apiGet('/address-book/v3/contacts/_me', token),
    apiGet('/address-book/v3/contacts', token),
  ]);
  const results = book.results || [];
  const self = results.find((c) => c.id === me.id) || {};
  const jidName = {};
  for (const c of results) if (c.messaging?.jid) jidName[c.messaging.jid] = c.displayName || c.email;
  return { myJid: self.messaging?.jid || '', jidName };
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

/** Visual voicemail with transcription.
 *  GET /voice/v2/voicemails → { records:[{ id, sender, status, duration, whenCreated, hasText, callId }] }
 *  Transcript is a separate call: GET /voice/v2/voicemails/{id}/_transcript → { text }. */
apiRouter.get('/voicemails', async (req, res) => {
  if (!oauthConfigured()) return res.json(mock.voicemails);
  try {
    const vm = await apiGet('/voice/v2/voicemails', req.userToken);
    const records = vm.records || [];
    const items = await Promise.all(records.map(async (r) => {
      const s = r.sender || {};
      const name = typeof s === 'string' ? s : (s.name || s.displayName || s.number || s.phoneNumber || 'Desconocido');
      const number = typeof s === 'string' ? s : (s.number || s.phoneNumber || '');
      let transcript = '';
      if (r.hasText) {
        try { transcript = (await apiGet(`/voice/v2/voicemails/${r.id}/_transcript`, req.userToken)).text || ''; }
        catch (e) { req.log?.warn(e); }
      }
      return {
        contactName: name,
        number,
        date: iso(r.whenCreated),
        duration: r.duration || 0,
        transcript,
        isNew: !['read', 'listened', 'seen'].includes(String(r.status || '').toLowerCase()),
      };
    }));
    res.json(items);
  } catch (e) { req.log?.warn(e); res.json([]); }
});

/** Team chat + SMS grouped into conversations.
 *  Chat: GET /messaging/v2/accounts/_me/chat/users/history → { records:[{ from, to, dateTime, payload:{ text, formattedText } }] }
 *  SMS:  GET /messaging/v2/accounts/_me/sms/users/history  → { records:[{ phoneNumber, direction, dateTime, text }] } */
apiRouter.get('/conversations', async (req, res) => {
  if (!oauthConfigured()) return res.json(mock.conversations);
  try {
    const { myJid, jidName } = await contactContext(req.userToken);
    const [chat, sms] = await Promise.all([
      apiGet('/messaging/v2/accounts/_me/chat/users/history', req.userToken).catch((e) => (req.log?.warn(e), { records: [] })),
      apiGet('/messaging/v2/accounts/_me/sms/users/history', req.userToken).catch((e) => (req.log?.warn(e), { records: [] })),
    ]);
    const convos = {};
    // Team chat
    for (const m of chat.records || []) {
      const mine = m.from === myJid;
      const other = mine ? m.to : m.from;
      const text = m.payload?.text || m.payload?.formattedText || '';
      if (!other || !text) continue;
      (convos[other] ??= { contactName: jidName[other] || String(other).split('@')[0], presence: 'available', messages: [] })
        .messages.push({ text, date: iso(m.dateTime), isMine: mine });
    }
    // SMS
    for (const m of sms.records || []) {
      const key = 'sms:' + m.phoneNumber;
      const mine = ['outbound', 'out', 'outgoing'].includes(String(m.direction || '').toLowerCase());
      if (!m.text) continue;
      (convos[key] ??= { contactName: m.phoneNumber || 'SMS', presence: 'offline', messages: [] })
        .messages.push({ text: m.text, date: iso(m.dateTime), isMine: mine });
    }
    // Newest conversations first (by last message)
    const list = Object.values(convos).sort((a, b) =>
      String(b.messages.at(-1)?.date || '').localeCompare(String(a.messages.at(-1)?.date || '')));
    res.json(list);
  } catch (e) { req.log?.warn(e); res.json([]); }
});

// Call history → Analytics API (service-account scope); meetings spec still pending.
// Both degrade to an empty list so the app shows clean empty states (no errors).
apiRouter.get('/call-history', (req, res) => res.json(oauthConfigured() ? [] : mock.calls));
apiRouter.get('/meetings',     (req, res) => res.json(oauthConfigured() ? [] : mock.meetings));

/** POST /api/calls { to } → click-to-call (path pending confirmation). */
apiRouter.post('/calls', async (req, res) => {
  const { to } = req.body ?? {};
  if (!to) return res.status(400).json({ error: 'missing_destination' });
  res.json({ status: 'accepted', to, note: 'click-to-call wiring pending' });
});
