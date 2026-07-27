import { Router } from 'express';
import crypto from 'node:crypto';
import { config, oauthConfigured } from '../config.js';
import { authorizeUrl, exchangeCode } from '../lib/intermedia.js';
import { createSession } from '../lib/session.js';

export const authRouter = Router();

// Short-lived store for the CSRF state between /login and /callback.
const pending = new Map();

/**
 * GET /auth/login
 * The app opens this in an ASWebAuthenticationSession. We start the
 * Authorization Code + PKCE flow and redirect the user to Intermedia.
 */
authRouter.get('/login', (req, res) => {
  if (!oauthConfigured()) {
    return res.status(503).json({ error: 'oauth_not_configured',
      hint: 'Fill OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET in .env from the Intermedia portal.' });
  }
  const state = crypto.randomBytes(16).toString('hex');
  pending.set(state, { ts: Date.now() });
  res.redirect(authorizeUrl({ state }));
});

/**
 * GET /auth/callback
 * Intermedia redirects here with ?code&state. We exchange the code for user
 * tokens (kept server-side), mint an app session JWT, and hand it to the app
 * via the custom scheme.
 */
authRouter.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect(`${config.appRedirectScheme}?error=${encodeURIComponent(String(error))}`);
  const entry = pending.get(String(state));
  if (!code || !entry) return res.status(400).send('Invalid state');
  pending.delete(String(state));

  try {
    const tokens = await exchangeCode(String(code));
    const appJwt = createSession(tokens);
    res.redirect(`${config.appRedirectScheme}?token=${encodeURIComponent(appJwt)}`);
  } catch (e) {
    req.log?.error(e);
    res.redirect(`${config.appRedirectScheme}?error=exchange_failed`);
  }
});
