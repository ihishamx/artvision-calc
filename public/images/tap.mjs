// الوحيد الذي يكلّم Tap Payments. المفتاح السري من متغير بيئة فقط (TAP_SECRET_KEY)، ولا يظهر في الواجهة ولا في السجلات.
// المرجع: developers.tap.company — Create a Charge / Retrieve a Charge / Webhook (hashstring).
// STAFF-VERIFY: حدود طول description وmetadata، وتفعيل طرق الدفع (مدى، Apple Pay، STC Pay، تمارا) في حساب Tap.
import crypto from 'node:crypto';

export const TAP_API_BASE = 'https://api.tap.company/v2';

// رقم جوال سعودي: 05XXXXXXXX أو 5XXXXXXXX أو +9665XXXXXXXX أو 009665XXXXXXXX (يقبل الأرقام العربية)
export function normalizeSaPhone(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[\s\-()]/g, '');
  s = s.replace(/^(\+|00)966/, '').replace(/^0/, '');
  return /^5\d{8}$/.test(s) ? s : null;
}

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

// يتحقق من بيانات العميل. يعيد { customer } أو { error }
export function checkCustomer(raw) {
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

export function newOrderRef(now = Date.now()) {
  return 'AV-' + now.toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
}

// lines: [{ productName, lengthCm, widthCm, framed, frameLabel, quantity, price }]
export function buildChargePayload({ lines, customer, orderRef, baseUrl }) {
  const total = lines.reduce((s, l) => s + l.price * l.quantity, 0);
  const lineText = (l) => `${l.quantity}× ${l.productName} ${l.lengthCm}×${l.widthCm} سم ${l.framed ? 'بإطار ' + l.frameLabel : 'بدون إطار'} (${l.price} ر.س)`;
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
    redirect: { url: `${base}/?paid=1` },
  };
}

// يحسب hashstring كما في توثيق Tap للـ Charge (SAR بخانتين عشريتين)
export function chargeHash(charge, secretKey) {
  const amount = Number(charge.amount).toFixed(2);
  const s = 'x_id' + charge.id + 'x_amount' + amount + 'x_currency' + charge.currency
    + 'x_gateway_reference' + (charge.reference?.gateway ?? '') + 'x_payment_reference' + (charge.reference?.payment ?? '')
    + 'x_status' + charge.status + 'x_created' + (charge.transaction?.created ?? '') + '';
  return crypto.createHmac('sha256', secretKey).update(s).digest('hex');
}
export function verifyWebhook(charge, postedHash, secretKey) {
  if (typeof postedHash !== 'string' || !charge || typeof charge !== 'object') return false;
  const a = Buffer.from(chargeHash(charge, secretKey)), b = Buffer.from(postedHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createTapClient({ secretKey, baseUrl = TAP_API_BASE, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
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
export function payState(status) {
  if (status === 'CAPTURED') return 'paid';
  if (['INITIATED', 'IN_PROGRESS', 'AUTHORIZED', 'PENDING'].includes(status)) return 'pending';
  return 'failed';
}
