# Despliegue del backend de Capote Voice

## ¿Qué es el "hosting" y por qué lo necesito?

Tu backend es un pequeño programa (Node.js) que tiene que estar **encendido 24/7 en internet**
para que la app pueda hablar con él. Tu Mac no sirve para eso (se apaga, cambia de IP, no tiene
dominio). El **hosting** es simplemente **un servidor en la nube que lo mantiene encendido y
accesible por HTTPS**.

Para producción necesitas 3 cosas:

1. **Un host** (servidor en la nube) que ejecute el backend. → Recomiendo **Render** (fácil y barato).
2. **Un dominio/subdominio** con **HTTPS**. Ya elegimos `voice-api.capotesolutions.com`.
3. **Las variables de entorno** (los secrets del `.env`) puestas **en el panel del host**, no en el código.

Coste aproximado: Render tiene plan gratuito para probar y ~7 USD/mes para producción sin que se
"duerma". El dominio ya lo tienes (capotesolutions.com); solo añadimos un subdominio.

---

## Opción recomendada: Render (paso a paso)

1. Sube la carpeta `backend/` a un repositorio de GitHub (privado).
2. En [render.com](https://render.com) → **New → Web Service** → conecta el repo.
3. Render detecta el `Dockerfile`. Deja el puerto en **8080**.
4. En **Environment** añade las variables (copiadas de tu `.env` local):
   - `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`
   - `SERVICE_ACCOUNT_CLIENT_ID`, `SERVICE_ACCOUNT_CLIENT_SECRET`
   - `OAUTH_REDIRECT_URI=https://voice-api.capotesolutions.com/auth/callback`
   - `PUBLIC_BASE_URL=https://voice-api.capotesolutions.com`
   - `APP_JWT_SECRET=` (genera uno largo aleatorio)
   - los `INTERMEDIA_*` (cuando confirmemos los reales)
5. **Deploy**. Render te da una URL tipo `https://capote-voice.onrender.com`.
6. **Custom domain** → añade `voice-api.capotesolutions.com`. Render te dará un registro **CNAME**.
7. En tu DNS (donde gestionas capotesolutions.com) crea:
   ```
   CNAME   voice-api   →   <valor-que-te-da-render>
   ```
   Render emite el certificado HTTPS automáticamente en unos minutos.
8. Verifica: `https://voice-api.capotesolutions.com/health` → debe responder `{"ok":true,...}`.

> El `OAUTH_REDIRECT_URI` del host debe coincidir **exactamente** con el que registramos en el
> portal de Intermedia. Ya coinciden.

---

## Alternativas equivalentes
- **Railway** (railway.app) — igual de simple, detecta el Dockerfile.
- **Fly.io** — `fly launch` desde la carpeta.
- **Un VPS** (DigitalOcean/Hetzner) con Docker — más control, más mantenimiento.

## Probar la imagen en local (opcional)
```bash
cd ~/Desktop/CapoteVoice/backend
docker build -t capote-voice-backend .
docker run --env-file .env -p 8080:8080 capote-voice-backend
curl http://localhost:8080/health
```

## Checklist antes de "go live"
- [ ] Endpoints/scopes reales de Intermedia confirmados en developer.intermedia.com
- [ ] Backend desplegado y `/health` responde por HTTPS
- [ ] Subdominio `voice-api` con certificado válido
- [ ] Variables de entorno cargadas en el host (no en el repo)
- [ ] App iOS apuntando `PUBLIC_BASE_URL` (LiveIntermediaClient)
