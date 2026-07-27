import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { config, oauthConfigured, serviceAccountConfigured } from './config.js';
import { authRouter } from './routes/auth.js';
import { apiRouter } from './routes/api.js';

const app = express();
app.use(helmet());
app.use(cors());               // tighten to the app's origin in production
app.use(express.json());
app.use(pinoHttp());

app.get('/health', (_req, res) => res.json({
  ok: true,
  oauthConfigured: oauthConfigured(),
  serviceAccountConfigured: serviceAccountConfigured(),
  redirectUri: config.oauth.redirectUri,
}));

app.use('/auth', authRouter);
app.use('/api', apiRouter);

app.listen(config.port, () => {
  console.log(`\n  Capote Voice backend → http://localhost:${config.port}`);
  console.log(`  Health:   /health`);
  console.log(`  Login:    /auth/login`);
  console.log(`  Redirect: ${config.oauth.redirectUri}`);
  if (!oauthConfigured())         console.log('  ⚠ OAuth client not configured — serving MOCK data.');
  if (!serviceAccountConfigured()) console.log('  ⚠ Service account not configured — click-to-call is mocked.');
  console.log('');
});
