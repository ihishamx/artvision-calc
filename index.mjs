import { fileURLToPath } from 'node:url';
import { createApp } from './server.mjs';
import { createSallaClient } from './salla-admin.mjs';
import { createItemStore } from './item-store.mjs';

const env = process.env;
const app = createApp({
  salla: createSallaClient({ token: env.SALLA_ACCESS_TOKEN }),
  store: createItemStore({ file: env.ITEMS_FILE }),
  allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  dailyCap: Number(env.DAILY_NEW_ITEMS_CAP || 200),
  trustProxy: env.TRUST_PROXY === '1',
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
});
app.listen(Number(env.PORT || 8787), () => console.log('free-size server up'));
