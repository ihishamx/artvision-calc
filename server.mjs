// خادم صفحة الهبوط: يعيد حساب سعر كل سطر من معادلة آرت فيجن (لا يثق بسعر المتصفح) ثم يدفع عبر أحد مسارين:
//  - Tap Payments (مفعّل عند وجود TAP_SECRET_KEY): ينشئ عملية دفع بالمبلغ المحسوب ويحوّل العميل لصفحة الدفع الآمنة في Tap.
//  - سلة (مفعّل عند وجود SALLA_ACCESS_TOKEN): عناصر مخفية بالسعر المحسوب تُضاف لسلة المتجر.
// لا بيانات بطاقات هنا إطلاقًا، ولا تُكتب بيانات العملاء في السجلات.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { checkCustomer, buildChargePayload, newOrderRef, verifyWebhook, payState } from './tap.mjs';
import { evaluate, verifyQuote } from './pricing-core.mjs';
import { FRAME_COLORS, PRODUCTS, MAX_LINES, MAX_QTY, PAGES } from './config.mjs';
import { buildItemPayload } from './salla-admin.mjs';

const MAX_BODY = 16384, MAX_WEBHOOK_BODY = 131072;

// يتحقق من سطر واحد. لا ينشئ شيئًا. يعيد { line } أو { code, error }.
export function checkLine(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { code: 400, error: 'bad_line' };
  const { productId, length, width, framed, frameColor, quantity = 1, claimedPrice } = raw;
  const pid = String(productId ?? '');
  if (!Object.hasOwn(PRODUCTS, pid)) return { code: 422, error: 'unknown_product' };
  if (typeof framed !== 'boolean') return { code: 422, error: 'missing_frame_option' };
  const color = framed ? (typeof frameColor === 'string' && Object.hasOwn(FRAME_COLORS, frameColor) ? FRAME_COLORS[frameColor] : null) : null;
  if (framed && !color) return { code: 422, error: 'missing_frame_color' };
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) return { code: 422, error: 'bad_quantity' };
  const r = evaluate({ lengthRaw: length, widthRaw: width, framed });
  if (r.status !== 'ok') return { code: 422, error: r.status };
  const pieces = PRODUCTS[pid].pieces || 1;
  const unit = r.price, setPrice = unit * pieces;   // الطقم: كل قطعة تُقرَّب على حدة ثم تُضرب
  if (Number(claimedPrice) !== setPrice) return { code: 409, error: 'price_mismatch', expected: setPrice };
  // الاتجاه مهم للإنتاج: 80×120 ليس 120×80، فلا يُرتَّب المفتاح
  const key = `${pid}|${r.lengthCm}x${r.widthCm}|${framed ? 'f:' + frameColor : 'u'}|${setPrice}`;
  const payload = buildItemPayload({ productName: PRODUCTS[pid].name, lengthCm: r.lengthCm, widthCm: r.widthCm, framed, frameLabel: color?.label, price: setPrice });
  return { line: { key, payload, quantity, price: setPrice, pieces, unitPrice: unit, productName: PRODUCTS[pid].name, lengthCm: r.lengthCm, widthCm: r.widthCm, framed, frameLabel: color?.label } };
}

const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.otf': 'font/otf', '.woff2': 'font/woff2', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.ico': 'image/x-icon' };

export function createApp({ salla = null, store, tap = null, publicBaseUrl = '', staticDir = null, indexFile = 'index.html', allowedOrigins = [], rate = { windowMs: 60000, max: 20 }, dailyCap = 200, trustProxy = false, now = () => Date.now(), log = (m) => console.log(m) }) {
  const hits = new Map();
  let day = { d: new Date(now()).toISOString().slice(0, 10), n: 0 };
  let selfOrigin = '';
  try { selfOrigin = publicBaseUrl ? new URL(publicBaseUrl).origin : ''; } catch { /* عنوان غير صالح */ }
  const origins = new Set([...allowedOrigins, ...(selfOrigin ? [selfOrigin] : [])]);

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
  const readBody = (req, max = MAX_BODY) => new Promise((resolve, reject) => {
    let size = 0, over = false; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max * 4) { req.destroy(); return; }       // سقف صلب: نقطع الاتصال
      if (size > max) over = true; else chunks.push(c);    // فوق الحد: نستهلك ونرد 413
    });
    req.on('end', () => (over ? reject(Object.assign(new Error('big'), { code: 413 })) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
  const readJson = async (req, res, o, max) => {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) { send(res, 415, { error: 'json_only' }, o); return null; }
    let body;
    try { body = JSON.parse(await readBody(req, max)); } catch (e) { send(res, e.code === 413 ? 413 : 400, { error: e.code === 413 ? 'too_large' : 'bad_json' }, o); return null; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) { send(res, 400, { error: 'bad_json' }, o); return null; }
    return body;
  };
  const checkLines = (rawLines) => {
    if (!Array.isArray(rawLines) || rawLines.length < 1) return { code: 422, error: 'empty_cart' };
    if (rawLines.length > MAX_LINES) return { code: 422, error: 'too_many_lines' };
    const lines = [];
    for (let i = 0; i < rawLines.length; i++) {
      const c = checkLine(rawLines[i]);
      if (c.error) return { code: c.code, error: c.error, index: i, expected: c.expected };
      lines.push(c.line);
    }
    return { lines };
  };
  const errBody = (c) => ({ error: c.error, ...(c.index !== undefined ? { index: c.index } : {}), ...(c.expected !== undefined ? { expected: c.expected } : {}) });

  async function itemsFor(lines) {
    // السقف اليومي للعناصر الجديدة يُفحص قبل أي إنشاء
    const fresh = new Set(lines.filter((l) => !store.get(l.key)).map((l) => l.key));
    const d = new Date(now()).toISOString().slice(0, 10);
    if (day.d !== d) day = { d, n: 0 };
    if (day.n + fresh.size > dailyCap) return null;
    day.n += fresh.size;
    const out = [];
    for (const l of lines) {
      const { id } = await store.getOrCreate(l.key, async () => (await salla.createHiddenItem(l.payload)).id);
      out.push({ itemId: id, quantity: l.quantity, price: l.price });
    }
    return out;
  }

  function serveStatic(req, res, pathname) {
    if (!staticDir || (req.method !== 'GET' && req.method !== 'HEAD')) return send(res, 404, { error: 'not_found' });
    const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
    const rel = Object.hasOwn(PAGES, clean) ? (clean === '/' ? indexFile : PAGES[clean]) : decodeURIComponent(pathname).replace(/^\/+/, '');
    const pageFiles = new Set([indexFile, ...Object.values(PAGES).filter((f) => f !== 'index.html')]);
    const file = path.resolve(staticDir, rel);
    const type = STATIC_TYPES[path.extname(file).toLowerCase()];
    // صفحة واحدة فقط تُخدم؛ أي HTML آخر قديم في المجلد لا يظهر
    if (type && type.startsWith('text/html') && !pageFiles.has(rel)) return send(res, 404, { error: 'not_found' });
    if (!file.startsWith(path.resolve(staticDir) + path.sep) || !type || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'not_found' });
    const h = { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control': type.startsWith('text/html') ? 'no-cache' : 'public, max-age=86400' };
    if (type.startsWith('text/html')) { h['X-Frame-Options'] = 'SAMEORIGIN'; h['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'; }
    res.writeHead(200, h);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const originOk = !origin || origins.has(origin);
    const o = origin && originOk ? origin : undefined;
    try {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      if (!p.startsWith('/api/')) return serveStatic(req, res, p);
      if (p === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true, tap: Boolean(tap), salla: Boolean(salla) }, o);

      // ===== Tap: إشعار الدفع (من خوادم Tap، بلا Origin) =====
      if (p === '/api/tap/webhook') {
        if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
        if (!tap) return send(res, 503, { error: 'tap_not_configured' });
        const charge = await readJson(req, res, undefined, MAX_WEBHOOK_BODY); if (!charge) return;
        if (!verifyWebhook(charge, req.headers.hashstring, tap.secretKey)) return send(res, 401, { error: 'bad_signature' });
        // لا نعتمد على الإشعار وحده: نعيد جلب العملية من Tap
        const fresh = await tap.client.retrieveCharge(String(charge.id));
        const st = payState(fresh.status);
        log(`TAP ${st.toUpperCase()} order=${fresh.reference?.order || '-'} charge=${fresh.id} amount=${fresh.amount} ${fresh.currency}`);
        return send(res, 200, { ok: true });
      }

      if (!originOk) return send(res, 403, { error: 'origin_not_allowed' });
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': o || '', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600', Vary: 'Origin' });
        return res.end();
      }

      // ===== Tap: حالة الدفع بعد العودة من صفحة الدفع =====
      if (p === '/api/tap/status') {
        if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' }, o);
        if (!tap) return send(res, 503, { error: 'tap_not_configured' }, o);
        if (limited(ipOf(req))) return send(res, 429, { error: 'rate_limited' }, o);
        const id = url.searchParams.get('tap_id') || '';
        if (!/^chg_[A-Za-z0-9_]{6,80}$/.test(id)) return send(res, 422, { error: 'bad_tap_id' }, o);
        const c = await tap.client.retrieveCharge(id);
        // الحد الأدنى فقط: لا بيانات عميل في الرد
        return send(res, 200, { state: payState(c.status), order: c.reference?.order || null, amount: c.amount, currency: c.currency }, o);
      }

      if (p !== '/api/checkout' && p !== '/api/free-size' && p !== '/api/tap/checkout') return send(res, 404, { error: 'not_found' }, o);
      if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' }, o);
      if (limited(ipOf(req))) return send(res, 429, { error: 'rate_limited' }, o);
      const body = await readJson(req, res, o); if (!body) return;

      // ===== Tap: إنشاء عملية الدفع =====
      if (p === '/api/tap/checkout') {
        if (!tap) return send(res, 503, { error: 'tap_not_configured' }, o);
        const c = checkLines(body.lines);
        if (c.error) return send(res, c.code, errBody(c), o);
        const cu = checkCustomer(body.customer);
        if (cu.error) return send(res, 422, { error: cu.error }, o);
        const total = c.lines.reduce((s, l) => s + l.price * l.quantity, 0);
        if (body.claimedTotal !== undefined && Number(body.claimedTotal) !== total) return send(res, 409, { error: 'price_mismatch', expected: total }, o);
        const order = newOrderRef(now());
        const charge = await tap.client.createCharge(buildChargePayload({ lines: c.lines, customer: cu.customer, orderRef: order, baseUrl: publicBaseUrl, returnPath: Object.hasOwn(PAGES, body.page) ? body.page : '/' }));
        log(`TAP CREATED order=${order} charge=${charge.id} amount=${total} SAR lines=${c.lines.length}`);
        return send(res, 200, { url: charge.url, order, total, currency: 'SAR' }, o);
      }

      // ===== سلة =====
      if (!salla) return send(res, 503, { error: 'salla_not_configured' }, o);
      // /api/free-size: سطر واحد (توافق مع صفحة ركن القهوة). /api/checkout: السلة كاملة.
      const single = p === '/api/free-size';
      const c = checkLines(single ? [{ productId: '1715612554', quantity: 1, ...body }] : body.lines);
      if (c.error) return send(res, c.code, errBody(c), o);
      const items = await itemsFor(c.lines);
      if (!items) return send(res, 503, { error: 'daily_cap' }, o);
      const total = items.reduce((s, x) => s + x.price * x.quantity, 0);
      if (single) return send(res, 200, { route: 'item', itemId: items[0].itemId, quantity: 1, price: items[0].price }, o);
      return send(res, 200, { lines: items, total, currency: 'SAR' }, o);
    } catch (e) {
      // رسالة عامة فقط: لا تفاصيل داخلية ولا مفاتيح
      return send(res, 502, { error: 'upstream_failed' }, o);
    }
  });
}
