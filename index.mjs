// نقطة التشغيل على Render. كل الأسرار من متغيرات البيئة فقط.
//   TAP_SECRET_KEY        مفتاح Tap السري (sk_test_... للتجربة، sk_live_... للتشغيل) — يضعه Art بنفسه في Render
//   PUBLIC_BASE_URL       عنوان الخدمة العام، مثل https://artvision-free-size.onrender.com (للعودة من الدفع وإشعارات Tap)
//   SALLA_ACCESS_TOKEN    اختياري: مسار سلة عند توفر التوكن
//   ALLOWED_ORIGINS       اختياري: أصول إضافية مسموحة (مثل https://artvisionksa.com)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './server.mjs';
import { createSallaClient } from './salla-admin.mjs';
import { createItemStore } from './item-store.mjs';
import { createTapClient } from './tap.mjs';

const env = process.env;
const here = path.dirname(fileURLToPath(import.meta.url));
const tap = env.TAP_SECRET_KEY ? { secretKey: env.TAP_SECRET_KEY, client: createTapClient({ secretKey: env.TAP_SECRET_KEY }) } : null;
const salla = env.SALLA_ACCESS_TOKEN ? createSallaClient({ token: env.SALLA_ACCESS_TOKEN }) : null;
const app = createApp({
  tap, salla,
  store: createItemStore({ file: env.ITEMS_FILE }),
  publicBaseUrl: env.PUBLIC_BASE_URL || '',
  staticDir: path.join(here, 'public'),
  allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  dailyCap: Number(env.DAILY_NEW_ITEMS_CAP || 200),
  trustProxy: env.TRUST_PROXY === '1',
});
app.listen(Number(env.PORT || 8787), () => console.log(`up: tap=${Boolean(tap)} salla=${Boolean(salla)}`));
