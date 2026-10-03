import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './server.mjs';
import { createItemStore } from './item-store.mjs';
import { evaluate } from './pricing-core.mjs';
import { normalizeSaPhone, checkCustomer, buildChargePayload, chargeHash, verifyWebhook, createTapClient, payState } from './tap.mjs';

const BASE_URL = 'https://av.example.com';
const SK = 'sk_test_XXXX';
function boot(over = {}) {
  const created = [], logs = [];
  const charges = new Map();
  const client = {
    async createCharge(p) { created.push(p); const id = 'chg_TS' + String(created.length).padStart(8, '0'); charges.set(id, { id, status: 'INITIATED', amount: p.amount, currency: 'SAR', reference: { order: p.reference.order } }); return { id, url: 'https://checkout.tap.company/?mode=page&token=' + id }; },
    async retrieveCharge(id) { const c = charges.get(id); if (!c) throw new Error('tap_http_404'); return c; },
  };
  const app = createApp({ tap: { secretKey: SK, client }, store: createItemStore(), publicBaseUrl: BASE_URL, rate: { windowMs: 60000, max: 1000 }, log: (m) => logs.push(m), ...over });
  return new Promise((r) => app.listen(0, '127.0.0.1', () => r({ app, created, charges, logs, base: `http://127.0.0.1:${app.address().port}` })));
}
const line = (l, w, framed, qty = 1, color = 'black') => ({ productId: '1306890256', length: String(l), width: String(w), framed, frameColor: framed ? color : undefined, quantity: qty, claimedPrice: evaluate({ lengthRaw: String(l), widthRaw: String(w), framed }).price });
const cust = { name: 'سارة أحمد', phone: '0551234567', email: 'a@b.co', city: 'الرياض', address: 'حي النرجس، شارع 12، منزل 4', notes: '' };
const post = (base, p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE_URL, ...headers }, body: JSON.stringify(body) });

test('جوال سعودي: صيغ مقبولة ومرفوضة', () => {
  for (const ok of ['0551234567', '551234567', '+966551234567', '00966551234567', '055 123 4567', '٠٥٥١٢٣٤٥٦٧']) assert.equal(normalizeSaPhone(ok), '551234567', ok);
  for (const bad of ['0451234567', '05512345', '+971551234567', '', 'abc', null]) assert.equal(normalizeSaPhone(bad), null, String(bad));
});
test('بيانات العميل الناقصة تُرفض', () => {
  assert.equal(checkCustomer({ ...cust, name: 'س' }).error, 'bad_name');
  assert.equal(checkCustomer({ ...cust, phone: '123' }).error, 'bad_phone');
  assert.equal(checkCustomer({ ...cust, email: 'x@' }).error, 'bad_email');
  assert.equal(checkCustomer({ ...cust, city: '' }).error, 'bad_city');
  assert.equal(checkCustomer({ ...cust, address: 'حي' }).error, 'bad_address');
  assert.ok(checkCustomer({ ...cust, email: '' }).customer);
  assert.equal(checkCustomer({ ...cust, name: '<script>x</script> علي' }).customer.name.includes('<'), false);
});
test('tap checkout: المبلغ من المعادلة، والطلب كامل في وصف العملية', async () => {
  const { app, created, base, logs } = await boot();
  const r = await post(base, '/api/tap/checkout', { lines: [line(100, 100, true, 2, 'gold'), line(100, 100, false), line(80, 120, true)], customer: cust, claimedTotal: 850 + 233 + 409 });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j)); assert.match(j.url, /^https:\/\/checkout\.tap\.company\//); assert.equal(j.total, 1492); assert.match(j.order, /^AV-/);
  const p = created[0];
  assert.equal(p.amount, 1492); assert.equal(p.currency, 'SAR'); assert.deepEqual(p.source, { id: 'src_all' });
  assert.equal(p.redirect.url, BASE_URL + '/?paid=1'); assert.equal(p.post.url, BASE_URL + '/api/tap/webhook');
  assert.deepEqual(p.customer.phone, { country_code: '966', number: '551234567' }); assert.equal(p.customer.first_name, 'سارة');
  assert.match(p.metadata.l1, /2× لوحة كانفس تجريدية رمادي داكن فاخرة 100×100 سم بإطار ذهبي مجوف \(425 ر\.س\)/);
  assert.match(p.metadata.l3, /80×120 سم/); assert.equal(p.metadata.city, 'الرياض');
  assert.ok(!/102|\+2/.test(JSON.stringify(p)));
  assert.ok(logs.every((m) => !/0551234567|551234567|سارة|النرجس/.test(m)), 'لا بيانات عميل في السجلات');
  app.close();
});
test('tap checkout: سعر مزوَّر أو إجمالي مزوَّر يُرفض ولا تُنشأ عملية', async () => {
  const { app, created, base } = await boot();
  const r1 = await post(base, '/api/tap/checkout', { lines: [{ ...line(100, 100, false), claimedPrice: 1 }], customer: cust });
  assert.equal(r1.status, 409); assert.equal((await r1.json()).expected, 233);
  const r2 = await post(base, '/api/tap/checkout', { lines: [line(100, 100, false)], customer: cust, claimedTotal: 10 });
  assert.equal(r2.status, 409);
  const r3 = await post(base, '/api/tap/checkout', { lines: [line(100, 100, false)], customer: { ...cust, phone: '1' } });
  assert.equal((await r3.json()).error, 'bad_phone');
  assert.equal(created.length, 0); app.close();
});
test('tap status: حالات الدفع وبلا بيانات عميل', async () => {
  const { app, base, charges } = await boot();
  const j = await (await post(base, '/api/tap/checkout', { lines: [line(100, 100, true)], customer: cust })).json();
  const id = [...charges.keys()][0];
  let s = await (await fetch(base + '/api/tap/status?tap_id=' + id)).json();
  assert.equal(s.state, 'pending'); assert.equal(s.order, j.order);
  charges.get(id).status = 'CAPTURED';
  s = await (await fetch(base + '/api/tap/status?tap_id=' + id)).json();
  assert.deepEqual(Object.keys(s).sort(), ['amount', 'currency', 'order', 'state']); assert.equal(s.state, 'paid'); assert.equal(s.amount, 425);
  charges.get(id).status = 'DECLINED';
  assert.equal((await (await fetch(base + '/api/tap/status?tap_id=' + id)).json()).state, 'failed');
  assert.equal((await fetch(base + '/api/tap/status?tap_id=../../x')).status, 422);
  app.close();
});
test('webhook: توقيع صحيح يُقبل ويُعاد جلب العملية، والمزوَّر 401', async () => {
  const { app, base, charges, logs } = await boot();
  await post(base, '/api/tap/checkout', { lines: [line(100, 100, true)], customer: cust });
  const id = [...charges.keys()][0]; charges.get(id).status = 'CAPTURED';
  const hook = { id, amount: 425, currency: 'SAR', status: 'CAPTURED', reference: { gateway: 'G1', payment: 'P1', order: 'x' }, transaction: { created: '1791000000000' } };
  const good = await fetch(base + '/api/tap/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', hashstring: chargeHash(hook, SK) }, body: JSON.stringify(hook) });
  assert.equal(good.status, 200); assert.ok(logs.some((m) => m.startsWith('TAP PAID') && m.includes(id)));
  const bad = await fetch(base + '/api/tap/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', hashstring: 'deadbeef' }, body: JSON.stringify({ ...hook, amount: 1 }) });
  assert.equal(bad.status, 401);
  app.close();
});
test('hashstring: صيغة المبلغ بخانتين للريال', () => {
  const c = { id: 'chg_1', amount: 425, currency: 'SAR', status: 'CAPTURED', reference: { gateway: 'g', payment: 'p' }, transaction: { created: '1' } };
  const h = chargeHash(c, 'k');
  assert.ok(verifyWebhook({ ...c, amount: '425.00' }, h, 'k')); assert.ok(!verifyWebhook({ ...c, amount: 426 }, h, 'k')); assert.ok(!verifyWebhook(c, h, 'other'));
});
test('عميل Tap: الترويسات والمسارات', async () => {
  const seen = [];
  const f = async (url, init) => { seen.push({ url, init }); return { ok: true, json: async () => (init.method === 'POST' ? { id: 'chg_1', status: 'INITIATED', transaction: { url: 'https://checkout.tap.company/x' } } : { id: 'chg_1', status: 'CAPTURED' }) }; };
  const c = createTapClient({ secretKey: 'sk_test_1', fetchImpl: f });
  assert.deepEqual(await c.createCharge({}), { id: 'chg_1', url: 'https://checkout.tap.company/x', status: 'INITIATED' });
  assert.equal((await c.retrieveCharge('chg_1')).status, 'CAPTURED');
  assert.equal(seen[0].url, 'https://api.tap.company/v2/charges/'); assert.equal(seen[0].init.headers.Authorization, 'Bearer sk_test_1');
  assert.equal(seen[1].url, 'https://api.tap.company/v2/charges/chg_1');
  await assert.rejects(createTapClient({ secretKey: 'k', fetchImpl: async () => ({ ok: false, status: 401 }) }).createCharge({}), /tap_http_401/);
  assert.throws(() => createTapClient({}), /مفقود/);
  assert.equal(payState('CAPTURED'), 'paid'); assert.equal(payState('INITIATED'), 'pending'); assert.equal(payState('CANCELLED'), 'failed');
});
test('بدون مفاتيح: المسارات ترد 503 واضحة، والصحة تبيّن الحالة', async () => {
  const app = createApp({ store: createItemStore() });
  await new Promise((r) => app.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${app.address().port}`;
  assert.deepEqual(await (await fetch(base + '/api/health')).json(), { ok: true, tap: false, salla: false });
  assert.equal((await (await fetch(base + '/api/tap/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()).error, 'tap_not_configured');
  assert.equal((await (await fetch(base + '/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()).error, 'salla_not_configured');
  app.close();
});
test('الملفات الثابتة: الصفحة والصور فقط، ولا تسلل للمسارات', async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-')); fs.writeFileSync(path.join(dir, 'index.html'), '<p>ok</p>'); fs.writeFileSync(path.join(dir, 'old.html'), '<p>old</p>'); fs.writeFileSync(path.join(dir, 'secret.env'), 'X');
  const app = createApp({ store: createItemStore(), staticDir: dir });
  await new Promise((r) => app.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${app.address().port}`;
  const r = await fetch(base + '/'); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/html/);
  assert.equal((await fetch(base + '/secret.env')).status, 404);
  assert.equal((await fetch(base + '/old.html')).status, 404);
  assert.equal((await fetch(base + '/..%2F..%2Fetc%2Fpasswd')).status, 404);
  assert.equal((await fetch(base + '/%2e%2e/server.mjs')).status, 404);
  app.close();
});
