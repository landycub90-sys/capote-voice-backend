# Capote Voice — Backend proxy

Secure bridge between the **Capote Voice** iOS app and the **Intermedia Extend API**.
It exists for one reason: the **service-account secret can reach _all_ your user data**
(per the warning in the Intermedia portal), so it must **never** ship inside the app.
This backend holds the secrets and exposes only safe, per-user endpoints.

```
iOS app  ──Bearer app-JWT──▶  backend  ──OAuth user token / service account──▶  Intermedia Extend API
```

## What runs where
- **OAuth client ID** (user login, Authorization Code + PKCE) → secret lives here.
- **Service account** (server-to-server, click-to-call) → secret lives here.
- The app only ever receives an opaque session JWT this backend signs.

## Setup

1. `cp .env.example .env`
2. In the Intermedia Reseller Portal → **Partner Account → Integrations → Elevate API**:
   - **OAuth client IDs → Add client ID**
     - Redirect URI: **`http://localhost:8080/auth/callback`** (dev) or `https://<your-domain>/auth/callback` (prod)
     - Copy `client_id` / `client_secret` → `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET`
   - **Service accounts → Add account**
     - Copy `client_id` / `client_secret` → `SERVICE_ACCOUNT_CLIENT_ID` / `SERVICE_ACCOUNT_CLIENT_SECRET`
   - Paste the secrets **straight into `.env`** — do not share them anywhere else.
3. Confirm the real `INTERMEDIA_AUTH_URL` / `INTERMEDIA_TOKEN_URL` / `INTERMEDIA_API_BASE`
   and the exact **scope** names at <https://developer.intermedia.com>.
4. `npm install`
5. `npm start`  → http://localhost:8080/health

Until the OAuth client is configured, every endpoint returns **mock data**, so the
app (and this backend) run end-to-end before Intermedia is wired.

## Endpoints
| Method | Path                | Purpose                                  |
|--------|---------------------|------------------------------------------|
| GET    | `/health`           | status + which credentials are configured|
| GET    | `/auth/login`       | start user login (opened by the app)     |
| GET    | `/auth/callback`    | OAuth redirect → hands app its JWT        |
| GET    | `/api/me`           | current account                          |
| GET    | `/api/contacts`     | directory + presence                     |
| GET    | `/api/call-history` | recent calls                            |
| GET    | `/api/voicemails`   | visual voicemail + transcript            |
| GET    | `/api/conversations`| messages                                 |
| GET    | `/api/meetings`     | upcoming meetings                        |
| POST   | `/api/calls`        | click-to-call `{ "to": "+1305..." }`     |

## iOS side
Point `LiveIntermediaClient` at `PUBLIC_BASE_URL` and send the session JWT as
`Authorization: Bearer <jwt>`. The app opens `/auth/login` in an
`ASWebAuthenticationSession` with callback scheme `capotevoice://auth/callback`.

## Production notes
- Move the in-memory session store (`src/lib/session.js`) to Redis/DB.
- Restrict `cors()` to the app and set secure cookies/headers.
- Rotate `APP_JWT_SECRET`; store real secrets in a secret manager, not `.env`.
