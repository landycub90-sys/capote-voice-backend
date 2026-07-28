import { config, oauthConfigured, serviceAccountConfigured } from '../config.js';
import { getSession, updateTokens } from '../lib/session.js';
import { apiGet, apiPost, apiPut, refreshToken, serviceAccountToken } from '../lib/intermedia.js';
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
    userId: c.id || null,             // Intermedia unified user id (target for chat)
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
  const jidId = {};
  for (const c of results) if (c.messaging?.jid) {
    jidName[c.messaging.jid] = c.displayName || c.email;
    jidId[c.messaging.jid] = c.id;               // jid → unified user id (chat send target)
  }
  return { myJid: self.messaging?.jid || '', jidName, jidId };
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
    const { myJid, jidName, jidId } = await contactContext(req.userToken);
    const [chat, sms] = await Promise.all([
      apiGet('/messaging/v2/accounts/_me/chat/users/history', req.userToken).catch((e) => (req.log?.warn(e), { records: [] })),
      apiGet('/messaging/v2/accounts/_me/sms/users/history', req.userToken).catch((e) => (req.log?.warn(e), { records: [] })),
    ]);
    const convos = {};
    // Team chat — targetId is the other user's unified id (for sending replies)
    for (const m of chat.records || []) {
      const mine = m.from === myJid;
      const other = mine ? m.to : m.from;
      const text = m.payload?.text || m.payload?.formattedText || '';
      if (!other || !text) continue;
      (convos[other] ??= { contactName: jidName[other] || String(other).split('@')[0], presence: 'available', targetId: jidId[other] || null, messages: [] })
        .messages.push({ text, date: iso(m.dateTime), isMine: mine });
    }
    // SMS — no chat targetId (distinto canal)
    for (const m of sms.records || []) {
      const key = 'sms:' + m.phoneNumber;
      const mine = ['outbound', 'out', 'outgoing'].includes(String(m.direction || '').toLowerCase());
      if (!m.text) continue;
      (convos[key] ??= { contactName: m.phoneNumber || 'SMS', presence: 'offline', targetId: null, messages: [] })
        .messages.push({ text: m.text, date: iso(m.dateTime), isMine: mine });
    }
    // Newest conversations first (by last message)
    const list = Object.values(convos).sort((a, b) =>
      String(b.messages.at(-1)?.date || '').localeCompare(String(a.messages.at(-1)?.date || '')));
    res.json(list);
  } catch (e) { req.log?.warn(e); res.json([]); }
});

/** Recent call history via the Analytics API (service-account, account-wide),
 *  filtered to the logged-in user.
 *  POST /analytics/calls/call/detail?dateFrom&dateTo → { calls:[{ direction, duration,
 *    from:{name,number,userUniqueId}, to:{name,number,userUniqueId}, start }] } */
apiRouter.get('/call-history', async (req, res) => {
  if (!oauthConfigured()) return res.json(mock.calls);
  if (!serviceAccountConfigured()) return res.json([]);
  try {
    const me = await apiGet('/address-book/v3/contacts/_me', req.userToken); // { id }
    const saToken = await serviceAccountToken();
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 3600 * 1000); // last 30 days
    const q = new URLSearchParams({
      dateFrom: from.toISOString(),
      dateTo: to.toISOString(),
      sortColumn: 'start',
      descending: 'true',
      size: '100',
    });
    const data = await apiPost(`/analytics/calls/call/detail?${q}`, saToken, {});
    const records = (data.calls || [])
      .map((c) => {
        const iAmCaller = c.from?.userUniqueId === me.id;
        const iAmCallee = c.to?.userUniqueId === me.id;
        if (!iAmCaller && !iAmCallee) return null;            // only my calls
        const other = iAmCaller ? c.to : c.from;
        const dur = c.duration || 0;
        const direction = iAmCaller ? 'outgoing' : (dur === 0 ? 'missed' : 'incoming');
        return {
          contactName: other?.name || other?.number || 'Desconocido',
          number: other?.number || '',
          direction,
          date: iso(c.start),
          duration: dur,
        };
      })
      .filter(Boolean);
    res.json(records);
  } catch (e) { req.log?.warn(e); res.json([]); }
});

// Meetings: not exposed as a documented Extend API spec → clean empty list.
apiRouter.get('/meetings', (req, res) => res.json(oauthConfigured() ? [] : mock.meetings));

/** POST /api/presence { presence } → publish the user's presence.
 *  PUT /messaging/v1/presence/accounts/_me/users/{unifiedUserId} { presence }.
 *  Best-effort: always 200 so the app's optimistic UI is never blocked. */
apiRouter.post('/presence', async (req, res) => {
  const presence = String(req.body?.presence || '').toLowerCase();
  if (!presence) return res.status(400).json({ error: 'missing_presence' });
  if (!oauthConfigured()) return res.json({ status: 'ok', presence });
  try {
    const me = await apiGet('/address-book/v3/contacts/_me', req.userToken); // { id }
    await apiPut(`/messaging/v1/presence/accounts/_me/users/${me.id}`, req.userToken, { presence });
    res.json({ status: 'ok', presence });
  } catch (e) {
    req.log?.warn(e);
    res.json({ status: 'accepted', presence, note: 'not published upstream' });
  }
});

/** POST /api/messages { to, text } → send a team-chat message.
 *  POST /messaging/v2/accounts/_me/users/_me/chat/message { target:{id}, payload:{text} }.
 *  `to` is the recipient's unified user id (contact.userId / conversation.targetId). */
apiRouter.post('/messages', async (req, res) => {
  const { to, text } = req.body ?? {};
  if (!to || !text) return res.status(400).json({ error: 'missing_to_or_text' });
  if (!oauthConfigured()) return res.json({ status: 'ok' });
  try {
    await apiPost('/messaging/v2/accounts/_me/users/_me/chat/message', req.userToken, {
      target: { id: to },
      payload: { text },
    });
    res.json({ status: 'ok' });
  } catch (e) {
    req.log?.warn(e);
    res.status(502).json({ error: 'send_failed' });
  }
});

/** POST /api/calls { to } → click-to-call (path pending confirmation). */
apiRouter.post('/calls', async (req, res) => {
  const { to } = req.body ?? {};
  if (!to) return res.status(400).json({ error: 'missing_destination' });
  res.json({ status: 'accepted', to, note: 'click-to-call wiring pending' });
});
