// خادم المقاس الحر: يعيد حساب السعر من التسعيرة ثم يجهّز عنصرًا مخفيًا في سلة ويعيد معرّفه للواجهة.
// لا بطاقات ولا بيانات عملاء هنا. الدفع كله في Checkout سلة.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { evaluate, verifyQuote } from './pricing-core.mjs';
import { FRAME_COLORS, stockKey } from './config.mjs';
import { buildItemPayload } from './salla-admin.mjs';

const MAX_BODY = 2048;
const MIME = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.otf': 'font/otf', '.woff2': 'font/woff2', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
function serveStatic(root, pathname, res) {
  let rel; try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end(); }
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.join(root, path.normalize(rel));
  if (!file.startsWith(path.resolve(root) + path.sep) && file !== path.resolve(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    res.end(buf);
  });
}

export function createApp({ salla, store, allowedOrigins = [], rate = { windowMs: 60000, max: 20 }, dailyCap = 200, trustProxy = false, now = () => Date.now(), publicDir = null }) {
  const hits = new Map();
  let day = { d: new Date(now()).toISOString().slice(0, 10), n: 0 };

  const ipOf = (req) => (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'x';
  const limited = (ip) => {
    const t = now(); const arr = (hits.get(ip) || []).filter((x) => t - x < rate.windowMs);
    arr.push(t); hits.set(ip, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] > rate.windowMs) hits.delete(k);
    return arr.length > rate.max;
  };
  const send = (res, code, obj, origin) => {
    const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (origin) { h['Access-Control-Allow-Origin'] = origin; h['Vary'] = 'Origin'; }
    res.writeHead(code, h); res.end(JSON.stringify(obj));
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0, over = false; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 65536) { req.destroy(); return; }          // سقف صلب: نقطع الاتصال
      if (size > MAX_BODY) over = true; else chunks.push(c);  // فوق الحد: نستهلك ونرد 413
    });
    req.on('end', () => (over ? reject(Object.assign(new Error('big'), { code: 413 })) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });

  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const originOk = !origin || allowedOrigins.includes(origin);
    const o = origin && originOk ? origin : undefined;
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true }, o);
      if (publicDir && req.method === 'GET' && !url.pathname.startsWith('/api/')) return serveStatic(publicDir, url.pathname, res);
      if (url.pathname !== '/api/free-size') return send(res, 404, { error: 'not_found' }, o);
      if (!originOk) return send(res, 403, { error: 'origin_not_allowed' });
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': o || '', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600', Vary: 'Origin' });
        return res.end();
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' }, o);
      if (limited(ipOf(req))) return send(res, 429, { error: 'rate_limited' }, o);
      if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'json_only' }, o);

      let body;
      try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, e.code === 413 ? 413 : 400, { error: e.code === 413 ? 'too_large' : 'bad_json' }, o); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'bad_json' }, o);

      const { length, width, framed, frameColor, claimedPrice } = body;
      if (typeof framed !== 'boolean') return send(res, 422, { error: 'missing_frame_option' }, o);
      const color = framed ? FRAME_COLORS[typeof frameColor === 'string' && Object.hasOwn(FRAME_COLORS, frameColor) ? frameColor : ''] : null;
      if (framed && !color) return send(res, 422, { error: 'missing_frame_color' }, o);

      const r = evaluate({ lengthRaw: length, widthRaw: width, framed });
      if (r.status !== 'ok') return send(res, 422, { error: r.status }, o);
      const q = verifyQuote({ lengthRaw: length, widthRaw: width, framed, claimedPrice });
      if (!q.ok) return send(res, 409, { error: 'price_mismatch', expected: q.expected }, o);

      // مقاس مطابق لمتغير حي في سلة: لا يُنشأ عنصر جديد، الواجهة تضيف المتغير.
      if (stockKey(r.lengthCm, r.widthCm) in { '70x100': 1, '80x120': 1, '100x150': 1, '60x90': 1 }) return send(res, 200, { route: 'variant', price: r.price }, o);

      const key = `${[r.lengthCm, r.widthCm].sort((a, b) => a - b).join('x')}|${framed ? 'f:' + frameColor : 'u'}|${r.price}`;
      const cached = store.get(key);
      if (!cached) {
        const d = new Date(now()).toISOString().slice(0, 10);
        if (day.d !== d) day = { d, n: 0 };
        if (day.n >= dailyCap) return send(res, 503, { error: 'daily_cap' }, o);
        day.n++;
      }
      const { id } = await store.getOrCreate(key, async () => (await salla.createHiddenItem(buildItemPayload({ lengthCm: r.lengthCm, widthCm: r.widthCm, framed, frameLabel: color?.label, price: r.price }))).id);
      return send(res, 200, { route: 'item', itemId: id, quantity: 1, price: r.price }, o);
    } catch (e) {
      // رسالة عامة فقط: لا تفاصيل داخلية ولا توكنات
      return send(res, 502, { error: 'upstream_failed' }, o);
    }
  });
}
