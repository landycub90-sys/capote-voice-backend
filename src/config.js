import 'dotenv/config';

function req(name, fallback = undefined) {
  const v = process.env[name] ?? fallback;
  return v;
}

export const config = {
  port: Number(req('PORT', 8080)),
  publicBaseUrl: req('PUBLIC_BASE_URL', 'http://localhost:8080'),

  oauth: {
    clientId: req('OAUTH_CLIENT_ID'),
    clientSecret: req('OAUTH_CLIENT_SECRET'),
    redirectUri: req('OAUTH_REDIRECT_URI', 'http://localhost:8080/auth/callback'),
    scopes: req('OAUTH_SCOPES', 'offline_access'),
    // Intermedia requires acr_values=deviceId:<id> on the token exchange.
    deviceId: req('DEVICE_ID', 'capote-voice-ios'),
  },

  serviceAccount: {
    clientId: req('SERVICE_ACCOUNT_CLIENT_ID'),
    clientSecret: req('SERVICE_ACCOUNT_CLIENT_SECRET'),
    scopes: req('SERVICE_SCOPES', 'api.service.analytics.main'),
  },

  intermedia: {
    authUrl: req('INTERMEDIA_AUTH_URL', 'https://login.intermedia.net/user/connect/authorize'),
    tokenUrl: req('INTERMEDIA_TOKEN_URL', 'https://login.intermedia.net/user/connect/token'),
    apiBase: req('INTERMEDIA_API_BASE', 'https://api.intermedia.net'),
  },

  appRedirectScheme: req('APP_REDIRECT_SCHEME', 'capotevoice://auth/callback'),
  appJwtSecret: req('APP_JWT_SECRET', 'change-me'),
};

/** True when the Intermedia OAuth client is fully configured. */
export const oauthConfigured = () =>
  Boolean(config.oauth.clientId && config.oauth.clientSecret);

/** True when the service account is fully configured. */
export const serviceAccountConfigured = () =>
  Boolean(config.serviceAccount.clientId && config.serviceAccount.clientSecret);
