// _worker.js — صفحات هبوط آرت فيجن على Cloudflare Pages. يُولَّد آليًا من pricing-core.mjs وconfig.mjs وtap.mjs (لا تعدّله يدويًا).
// السر الوحيد TAP_SECRET_KEY يضعه Art في إعدادات المشروع على Cloudflare. لا بيانات بطاقات ولا بيانات عملاء في السجلات.

// ===== التسعير (pricing-core.mjs) =====
// مصدر واحد للتسعير والتحقق — إقرار Art الرسمي 3 أكتوبر 2026 (المرجع الوحيد؛ لا أسعار سلة ولا Variants)
// بإطار: (L×W×400/10000)+25 · بدون إطار: ((L+2)×(W+2)×200/10000)+25 · تقريب واحد لأقرب ريال
const RATE = Object.freeze({ framed: 400, unframed: 200 });
const EMBEDDED_SHIPPING = 25;
const UNFRAMED_PAD_MM = 20; // +2 سم لكل بُعد في سعر بدون إطار فقط (يلغي +4 السابق)
const MIN_SIDE_CM = 20;
const LIMITS = Object.freeze({
  framed:   { long: 290, short: 150 },
  unframed: { long: 330, short: 150 },
});
function parseCm(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const s = String(raw).trim()
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٫,]/g, '.');
  const m = /^(\d{1,4})(?:\.(\d))?$/.exec(s);
  if (!m) return null;
  const mm = Number(m[1]) * 10 + Number(m[2] || 0);
  return mm > 0 ? mm : null;
}
function evaluate({ lengthRaw, widthRaw, framed }) {
  if (typeof framed !== 'boolean') return { status: 'missing_frame_option' };
  const l = parseCm(lengthRaw), w = parseCm(widthRaw);
  if (l === null || w === null) return { status: 'invalid_input' };
  const lim = framed ? LIMITS.framed : LIMITS.unframed;
  if (Math.max(l, w) > lim.long * 10 || Math.min(l, w) > lim.short * 10)
    return { status: framed ? 'too_large_framed' : 'too_large_unframed' };
  if (Math.min(l, w) < MIN_SIDE_CM * 10) return { status: 'too_small' };
  const rate = framed ? RATE.framed : RATE.unframed;
  const pad = framed ? 0 : UNFRAMED_PAD_MM;
  const price = Math.floor(((l + pad) * (w + pad) * rate + 500000) / 1000000) + EMBEDDED_SHIPPING;
  return { status: 'ok', price, currency: 'SAR', framed, lengthCm: l / 10, widthCm: w / 10 };
}


// ===== الإعدادات (config.mjs) =====
// كل ما يخص سلة معزول هنا. STAFF-VERIFY = يتحقق منه الموظف من توثيق سلة الحي قبل التشغيل.
// التسعير لا يقرأ أي سعر أو Variant من سلة (إقرار Art 3 أكتوبر 2026): المعادلة وحدها في pricing-core.mjs.

// المنتجات المسموح بيعها بالمقاس الخاص عبر هذا الخادم. الاسم يظهر في عنصر السلة.
const PRODUCTS = Object.freeze({
  '1306890256': { name: 'لوحة كانفس تجريدية رمادي داكن فاخرة' },
  '1715612554': { name: 'لوحة ركن القهوة' },
  // طقم 3 لوحات بنفس المقاس: سعر الطقم = 3 × سعر القطعة المقرّب (04 §13: لا خصم تلقائي، كل لوحة تُسعَّر على حدة). تقريب المجموع بدل القطعة = Needs Owner Input.
  '1181218623': { name: 'طقم تجريدي بلمسات ذهبية (3 لوحات)', pieces: 3 },
});

// ألوان البرواز (قراءة حية من سلة، 3 أكتوبر 2026). الاسم فقط يُستخدم؛ اللون لا يغيّر السعر (04 §14).
const FRAME_COLORS = Object.freeze({
  black:         { label: 'أسود مجوف' },
  white:         { label: 'أبيض مجوف' },
  brown:         { label: 'بني مجوف' },
  gold:          { label: 'ذهبي مجوف' },
  champagne:     { label: 'شامبين مجوف' },
  fullChampagne: { label: 'فل شامبين مجوف' },
});

const MAX_LINES = 20;     // أسطر مختلفة في طلب واحد
const MAX_QTY = 20;       // كمية السطر الواحد (أكبر من ذلك عبر واتساب/B2B)

// STAFF-VERIFY: عنوان وشكل Admin API الحي لإنشاء منتج
const SALLA_API_BASE = 'https://api.salla.dev/admin/v2';

// صفحات الهبوط المخدومة: المسار ← ملف HTML. تُستخدم أيضًا كقائمة بيضاء لمسار العودة من Tap.
const PAGES = Object.freeze({ '/': 'index.html', '/bohemian': 'bohemian.html', '/terms': 'terms.html', '/refund': 'refund.html', '/privacy': 'privacy.html' });

// ===== Tap (tap.mjs) =====
// الوحيد الذي يكلّم Tap Payments. المفتاح السري من متغير بيئة فقط (TAP_SECRET_KEY)، ولا يظهر في الواجهة ولا في السجلات.
// المرجع: developers.tap.company — Create a Charge / Retrieve a Charge / Webhook (hashstring).
// STAFF-VERIFY: حدود طول description وmetadata، وتفعيل طرق الدفع (مدى، Apple Pay، STC Pay، تمارا) في حساب Tap.

const TAP_API_BASE = 'https://api.tap.company/v2';

// رقم جوال سعودي: 05XXXXXXXX أو 5XXXXXXXX أو +9665XXXXXXXX أو 009665XXXXXXXX (يقبل الأرقام العربية)
function normalizeSaPhone(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[\s\-()]/g, '');
  s = s.replace(/^(\+|00)966/, '').replace(/^0/, '');
  return /^5\d{8}$/.test(s) ? s : null;
}

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

// يتحقق من بيانات العميل. يعيد { customer } أو { error }
function checkCustomer(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'bad_customer' };
  const name = clean(raw.name, 80), city = clean(raw.city, 60), address = clean(raw.address, 200), notes = clean(raw.notes, 300);
  const email = clean(raw.email, 120);
  const phone = normalizeSaPhone(raw.phone);
  if (name.length < 2) return { error: 'bad_name' };
  if (!phone) return { error: 'bad_phone' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'bad_email' };
  if (city.length < 2) return { error: 'bad_city' };
  if (address.length < 5) return { error: 'bad_address' };
  return { customer: { name, phone, email, city, address, notes } };
}


// lines: [{ productName, lengthCm, widthCm, framed, frameLabel, quantity, price }]
function buildChargePayload({ lines, customer, orderRef, baseUrl, returnPath = '/' }) {
  const total = lines.reduce((s, l) => s + l.price * l.quantity, 0);
  const lineText = (l) => `${l.quantity}× ${l.productName} ${l.pieces > 1 ? 'كل لوحة ' : ''}${l.lengthCm}×${l.widthCm} سم ${l.framed ? 'بإطار ' + l.frameLabel : 'بدون إطار'} (${l.price} ر.س)`;
  const [first, ...rest] = customer.name.split(' ');
  const metadata = { order: orderRef, city: customer.city, address: customer.address };
  if (customer.notes) metadata.notes = customer.notes;
  lines.forEach((l, i) => { metadata['l' + (i + 1)] = lineText(l); });
  const base = baseUrl.replace(/\/$/, '');
  return {
    amount: total,
    currency: 'SAR',
    threeDSecure: true,
    save_card: false,
    description: `آرت فيجن — طلب ${orderRef}: ` + lines.map(lineText).join(' | ').slice(0, 900),
    metadata,
    reference: { transaction: orderRef, order: orderRef },
    receipt: { email: Boolean(customer.email), sms: true },
    customer: {
      first_name: first, last_name: rest.join(' ') || undefined,
      email: customer.email || undefined,
      phone: { country_code: '966', number: customer.phone },
    },
    source: { id: 'src_all' },
    post: { url: `${base}/api/tap/webhook` },
    redirect: { url: `${base}${returnPath === '/' ? '' : returnPath}/?paid=1` },
  };
}

// يحسب hashstring كما في توثيق Tap للـ Charge (SAR بخانتين عشريتين)

function createTapClient({ secretKey, baseUrl = TAP_API_BASE, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
  if (!secretKey) throw new Error('TAP_SECRET_KEY مفقود');
  const call = async (method, path, body) => {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(baseUrl + path, {
        method,
        headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json', Accept: 'application/json', lang_code: 'ar' },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`tap_http_${res.status}`);
      return await res.json();
    } finally { clearTimeout(t); }
  };
  return {
    async createCharge(payload) {
      const j = await call('POST', '/charges/', payload);
      const url = j?.transaction?.url;
      if (!j?.id || !url) throw new Error('tap_no_url');
      return { id: String(j.id), url: String(url), status: j.status };
    },
    async retrieveCharge(id) { return call('GET', '/charges/' + encodeURIComponent(id)); },
  };
}

// تصنيف حالة Tap: CAPTURED = مدفوع
function payState(status) {
  if (status === 'CAPTURED') return 'paid';
  if (['INITIATED', 'IN_PROGRESS', 'AUTHORIZED', 'PENDING'].includes(status)) return 'pending';
  return 'failed';
}

// ===== Web Crypto (بدل مكتبة Node حتى يعمل على Cloudflare بلا إعدادات إضافية) =====
function newOrderRef(now = Date.now()) {
  const b = crypto.getRandomValues(new Uint8Array(2));
  return 'AV-' + now.toString(36).toUpperCase() + '-' + [...b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}
async function chargeHash(charge, secretKey) {
  const amount = Number(charge.amount).toFixed(2);
  const s = 'x_id' + charge.id + 'x_amount' + amount + 'x_currency' + charge.currency
    + 'x_gateway_reference' + (charge.reference?.gateway ?? '') + 'x_payment_reference' + (charge.reference?.payment ?? '')
    + 'x_status' + charge.status + 'x_created' + (charge.transaction?.created ?? '') + '';
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secretKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(s)));
  return [...sig].map((x) => x.toString(16).padStart(2, '0')).join('');
}
async function verifyWebhook(charge, postedHash, secretKey) {
  if (typeof postedHash !== 'string' || !charge || typeof charge !== 'object') return false;
  const a = await chargeHash(charge, secretKey);
  if (a.length !== postedHash.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ postedHash.charCodeAt(i);
  return d === 0;
}

// ===== الواجهة البرمجية =====
const MAX_BODY = 16384, MAX_WEBHOOK_BODY = 131072;
const RL = { windowMs: 60000, max: 20 };
const hits = new Map();   // تحديد معدل تقريبي لكل نسخة تشغيل

function checkLine(raw) {
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
  return { line: { quantity, price: setPrice, pieces, unitPrice: unit, productName: PRODUCTS[pid].name, lengthCm: r.lengthCm, widthCm: r.widthCm, framed, frameLabel: color?.label } };
}
function checkLines(rawLines) {
  if (!Array.isArray(rawLines) || rawLines.length < 1) return { code: 422, error: 'empty_cart' };
  if (rawLines.length > MAX_LINES) return { code: 422, error: 'too_many_lines' };
  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const c = checkLine(rawLines[i]);
    if (c.error) return { code: c.code, error: c.error, index: i, expected: c.expected };
    lines.push(c.line);
  }
  return { lines };
}
const errBody = (c) => ({ error: c.error, ...(c.index !== undefined ? { index: c.index } : {}), ...(c.expected !== undefined ? { expected: c.expected } : {}) });
const json = (code, obj, origin) => {
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (origin) { h['Access-Control-Allow-Origin'] = origin; h['Vary'] = 'Origin'; }
  return new Response(JSON.stringify(obj), { status: code, headers: h });
};
function limited(ip, now) {
  const arr = (hits.get(ip) || []).filter((x) => now - x < RL.windowMs);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > RL.windowMs) hits.delete(k);
  return arr.length > RL.max;
}
async function readJson(req, max, origin) {
  if (!/^application\/json\b/i.test(req.headers.get('content-type') || '')) return { res: json(415, { error: 'json_only' }, origin) };
  if (Number(req.headers.get('content-length') || 0) > max) return { res: json(413, { error: 'too_large' }, origin) };
  let text; try { text = await req.text(); } catch { return { res: json(400, { error: 'bad_json' }, origin) }; }
  if (text.length > max) return { res: json(413, { error: 'too_large' }, origin) };
  let body; try { body = JSON.parse(text); } catch { return { res: json(400, { error: 'bad_json' }, origin) }; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { res: json(400, { error: 'bad_json' }, origin) };
  return { body };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    // غير /api/ يُخدم من الملفات الثابتة مباشرة (_routes.json يوجّه /api/* فقط إلى هنا)
    if (!p.startsWith('/api/')) return env.ASSETS.fetch(req);

    const tap = env.TAP_SECRET_KEY ? { secretKey: env.TAP_SECRET_KEY, client: createTapClient({ secretKey: env.TAP_SECRET_KEY }) } : null;
    const base = (env.PUBLIC_BASE_URL || url.origin).replace(/\/$/, '');
    const origins = new Set([url.origin, ...String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)]);
    try { origins.add(new URL(base).origin); } catch { /* عنوان غير صالح */ }
    const origin = req.headers.get('origin');
    const originOk = !origin || origins.has(origin);
    const o = origin && originOk ? origin : undefined;
    const ip = req.headers.get('cf-connecting-ip') || 'x';

    try {
      if (p === '/api/health' && req.method === 'GET') return json(200, { ok: true, tap: Boolean(tap), salla: false }, o);

      // إشعار الدفع من خوادم Tap (بلا Origin). لا نعتمد عليه وحده: نعيد جلب العملية من Tap
      if (p === '/api/tap/webhook') {
        if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
        if (!tap) return json(503, { error: 'tap_not_configured' });
        const r = await readJson(req, MAX_WEBHOOK_BODY); if (r.res) return r.res;
        if (!(await verifyWebhook(r.body, req.headers.get('hashstring'), tap.secretKey))) return json(401, { error: 'bad_signature' });
        const fresh = await tap.client.retrieveCharge(String(r.body.id));
        console.log(`TAP ${payState(fresh.status).toUpperCase()} order=${fresh.reference?.order || '-'} charge=${fresh.id} amount=${fresh.amount} ${fresh.currency}`);
        return json(200, { ok: true });
      }

      if (!originOk) return json(403, { error: 'origin_not_allowed' });
      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': o || '', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600', Vary: 'Origin' } });
      }

      // حالة الدفع بعد العودة من صفحة Tap: الحد الأدنى فقط، بلا بيانات عميل
      if (p === '/api/tap/status') {
        if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' }, o);
        if (!tap) return json(503, { error: 'tap_not_configured' }, o);
        if (limited(ip, Date.now())) return json(429, { error: 'rate_limited' }, o);
        const id = url.searchParams.get('tap_id') || '';
        if (!/^chg_[A-Za-z0-9_]{6,80}$/.test(id)) return json(422, { error: 'bad_tap_id' }, o);
        const c = await tap.client.retrieveCharge(id);
        return json(200, { state: payState(c.status), order: c.reference?.order || null, amount: c.amount, currency: c.currency }, o);
      }

      if (p === '/api/checkout' || p === '/api/free-size') return json(503, { error: 'salla_not_configured' }, o);
      if (p !== '/api/tap/checkout') return json(404, { error: 'not_found' }, o);
      if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' }, o);
      if (limited(ip, Date.now())) return json(429, { error: 'rate_limited' }, o);
      const r = await readJson(req, MAX_BODY, o); if (r.res) return r.res;
      const body = r.body;
      if (!tap) return json(503, { error: 'tap_not_configured' }, o);
      const c = checkLines(body.lines);
      if (c.error) return json(c.code, errBody(c), o);
      const cu = checkCustomer(body.customer);
      if (cu.error) return json(422, { error: cu.error }, o);
      const total = c.lines.reduce((s, l) => s + l.price * l.quantity, 0);
      if (body.claimedTotal !== undefined && Number(body.claimedTotal) !== total) return json(409, { error: 'price_mismatch', expected: total }, o);
      const order = newOrderRef(Date.now());
      const charge = await tap.client.createCharge(buildChargePayload({ lines: c.lines, customer: cu.customer, orderRef: order, baseUrl: base, returnPath: Object.hasOwn(PAGES, body.page) ? body.page : '/' }));
      console.log(`TAP CREATED order=${order} charge=${charge.id} amount=${total} SAR lines=${c.lines.length}`);
      return json(200, { url: charge.url, order, total, currency: 'SAR' }, o);
    } catch (e) {
      return json(502, { error: 'upstream_failed' }, o);   // رسالة عامة فقط
    }
  },
};
