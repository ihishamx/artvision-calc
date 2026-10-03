import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './server.mjs';
import { createItemStore } from './item-store.mjs';
import { createSallaClient, buildItemPayload } from './salla-admin.mjs';
import { evaluate } from './pricing-core.mjs';

const ORIGIN = 'https://artvisionksa.com';
function boot(opts = {}) {
  const calls = [];
  const salla = opts.salla || { async createHiddenItem(p) { calls.push(p); return { id: String(9000 + calls.length) }; } };
  const app = createApp({ salla, store: createItemStore(), allowedOrigins: [ORIGIN], ...opts.app });
  return new Promise((res) => app.listen(0, '127.0.0.1', () => res({ app, calls, base: `http://127.0.0.1:${app.address().port}` })));
}
const post = (base, body, headers = {}) => fetch(base + '/api/free-size', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const good = { length: '100', width: '100', framed: true, frameColor: 'black', claimedPrice: 425 };

test('مقاس حر صحيح: يُنشأ عنصر بالسعر المحسوب فقط', async () => {
  const { app, calls, base } = await boot();
  const r = await post(base, good); const j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.route, 'item'); assert.equal(j.price, 425); assert.ok(j.itemId);
  assert.equal(calls.length, 1); assert.equal(calls[0].price, 425); assert.equal(calls[0].status, 'hidden');
  assert.match(calls[0].name, /100×100/); assert.match(calls[0].name, /أسود مجوف/);
  app.close();
});
test('بدون إطار: 100×100 = 233 (+2 سم داخلي لا يظهر في الاسم أو الوصف)', async () => {
  const { app, calls, base } = await boot();
  const r = await post(base, { length: '100', width: '100', framed: false, claimedPrice: 233 }); const j = await r.json();
  assert.equal(j.price, 233);
  const txt = JSON.stringify(calls[0]); assert.ok(!/102|\+\s?2/.test(txt), txt);
  app.close();
});
test('سعر مزوَّر يُرفض 409 ولا ينشئ شيئًا', async () => {
  const { app, calls, base } = await boot();
  const r = await post(base, { ...good, claimedPrice: 1 }); const j = await r.json();
  assert.equal(r.status, 409); assert.equal(j.expected, 425); assert.equal(calls.length, 0); app.close();
});
test('حدود المقاس والمدخلات', async () => {
  const { app, calls, base } = await boot({ app: { rate: { windowMs: 60000, max: 1000 } } });
  const cases = [
    [{ ...good, length: '291', width: '150' }, 'too_large_framed'],
    [{ length: '331', width: '150', framed: false, claimedPrice: 1 }, 'too_large_unframed'],
    [{ ...good, length: '19', width: '50' }, 'too_small'],
    [{ ...good, length: 'abc' }, 'invalid_input'],
    [{ ...good, framed: 'yes' }, 'missing_frame_option'],
    [{ ...good, frameColor: undefined }, 'missing_frame_color'],
    [{ ...good, frameColor: '__proto__' }, 'missing_frame_color'],
    [{ ...good, frameColor: 'constructor' }, 'missing_frame_color'],
  ];
  for (const [b, err] of cases) { const r = await post(base, b); assert.equal(r.status, 422, err); assert.equal((await r.json()).error, err); }
  assert.equal(calls.length, 0); app.close();
});
test('لا Variants: حتى المقاس القياسي 100×70 يُسعَّر بالمعادلة كعنصر', async () => {
  const { app, calls, base } = await boot();
  const r = await post(base, { length: '100', width: '70', framed: true, frameColor: 'gold', claimedPrice: 305 }); const j = await r.json();
  assert.equal(j.route, 'item'); assert.equal(j.price, 305); assert.equal(calls[0].price, 305); app.close();
});
test('نفس المقاس مرتين وبالتوازي = إنشاء واحد', async () => {
  const { app, calls, base } = await boot();
  const b = { length: '110', width: '85', framed: true, frameColor: 'white', claimedPrice: evaluate({ lengthRaw: '110', widthRaw: '85', framed: true }).price };
  const rs = await Promise.all([post(base, b), post(base, b), post(base, b)]);
  const ids = new Set(); for (const r of rs) ids.add((await r.json()).itemId);
  assert.equal(ids.size, 1); assert.equal(calls.length, 1);
  const again = await (await post(base, b)).json(); assert.equal(again.itemId, [...ids][0]); assert.equal(calls.length, 1); app.close();
});
test('الاتجاه محفوظ: 120×90 و90×120 بنفس السعر وعنصرين مختلفين', async () => {
  const { app, calls, base } = await boot();
  const p = evaluate({ lengthRaw: '120', widthRaw: '90', framed: true }).price;
  const a = await (await post(base, { length: '120', width: '90', framed: true, frameColor: 'black', claimedPrice: p })).json();
  const b = await (await post(base, { length: '90', width: '120', framed: true, frameColor: 'black', claimedPrice: p })).json();
  assert.equal(a.price, b.price); assert.notEqual(a.itemId, b.itemId); assert.equal(calls.length, 2);
  assert.match(calls[0].name, /120×90/); assert.match(calls[1].name, /90×120/); app.close();
});
test('أصل غير مسموح = 403، وبدون Origin يمر', async () => {
  const { app, base } = await boot();
  const bad = await post(base, good, { Origin: 'https://evil.example' }); assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
  const ok = await post(base, good); assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN); app.close();
});
test('Preflight', async () => {
  const { app, base } = await boot();
  const r = await fetch(base + '/api/free-size', { method: 'OPTIONS', headers: { Origin: ORIGIN } });
  assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN); app.close();
});
test('حد المعدل 429', async () => {
  const { app, base } = await boot({ app: { rate: { windowMs: 60000, max: 3 } } });
  const codes = []; for (let i = 0; i < 5; i++) codes.push((await post(base, good)).status);
  assert.deepEqual(codes.slice(0, 3), [200, 200, 200]); assert.equal(codes[4], 429); app.close();
});
test('جسم كبير 413 وJSON تالف 400 ونوع خاطئ 415', async () => {
  const { app, base } = await boot({ app: { rate: { windowMs: 60000, max: 1000 } } });
  assert.equal((await post(base, 'x'.repeat(20000))).status, 413);
  assert.equal((await post(base, '{bad')).status, 400);
  assert.equal((await post(base, '[]')).status, 400);
  assert.equal((await fetch(base + '/api/free-size', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  app.close();
});
test('فشل سلة: 502 عام بلا تسريب، ولا يُخزَّن', async () => {
  let n = 0;
  const salla = { async createHiddenItem() { n++; throw new Error('Bearer SECRET-TOKEN-123 failed'); } };
  const { app, base } = await boot({ salla });
  const r = await post(base, good); const t = await r.text();
  assert.equal(r.status, 502); assert.ok(!/SECRET|Bearer/.test(t));
  await post(base, good); assert.equal(n, 2); app.close();
});
test('السقف اليومي 503', async () => {
  const { app, base } = await boot({ app: { dailyCap: 1, rate: { windowMs: 60000, max: 1000 } } });
  const p = (l) => ({ length: String(l), width: '85', framed: true, frameColor: 'white', claimedPrice: evaluate({ lengthRaw: String(l), widthRaw: '85', framed: true }).price });
  assert.equal((await post(base, p(110))).status, 200);
  assert.equal((await post(base, p(111))).status, 503);
  assert.equal((await post(base, p(110))).status, 200); // موجود مسبقًا لا يُحتسب
  app.close();
});
test('health و404 و405', async () => {
  const { app, base } = await boot();
  assert.equal((await fetch(base + '/api/health')).status, 200);
  assert.equal((await fetch(base + '/nope')).status, 404);
  assert.equal((await fetch(base + '/api/free-size')).status, 405); app.close();
});
test('عميل سلة: ترويسة التفويض وقراءة id وأخطاء HTTP', async () => {
  let seen;
  const f = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ data: { id: 777 } }) }; };
  const c = createSallaClient({ token: 'T', fetchImpl: f });
  assert.deepEqual(await c.createHiddenItem({ a: 1 }), { id: '777' });
  assert.equal(seen.init.headers.Authorization, 'Bearer T'); assert.match(seen.url, /\/products$/);
  const c2 = createSallaClient({ token: 'T', fetchImpl: async () => ({ ok: false, status: 401 }) });
  await assert.rejects(c2.createHiddenItem({}), /salla_http_401/);
  const c3 = createSallaClient({ token: 'T', fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  await assert.rejects(c3.createHiddenItem({}), /salla_no_id/);
  assert.throws(() => createSallaClient({}), /مفقود/);
});
test('الحمولة: مخفي وبالريال ومن غير حقول سر', () => {
  const p = buildItemPayload({ productName: 'لوحة', lengthCm: 100, widthCm: 80, framed: false, price: 194 });
  assert.equal(p.status, 'hidden'); assert.equal(p.price, 194); assert.match(p.name, /بدون إطار/);
});

// ===== /api/checkout (السلة كاملة) =====
const ABS = '1306890256';
const co = (base, body, headers = {}) => fetch(base + '/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers }, body: JSON.stringify(body) });
const line = (l, w, framed, qty = 1, extra = {}) => ({ productId: ABS, length: String(l), width: String(w), framed, frameColor: framed ? 'black' : undefined, quantity: qty, claimedPrice: evaluate({ lengthRaw: String(l), widthRaw: String(w), framed }).price, ...extra });

test('checkout: عدة أسطر وكميات، الإجمالي من الخادم', async () => {
  const { app, calls, base } = await boot();
  const r = await co(base, { lines: [line(100, 100, true, 2), line(100, 100, false, 1), line(120, 80, true, 1), line(80, 120, true, 3)] });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(j.lines.map((x) => [x.price, x.quantity]), [[425, 2], [233, 1], [409, 1], [409, 3]]);
  assert.equal(j.total, 425 * 2 + 233 + 409 + 409 * 3);
  assert.equal(calls.length, 4); assert.match(calls[0].name, /لوحة كانفس تجريدية رمادي داكن فاخرة/);
  app.close();
});
test('checkout: سطر مزوَّر يرفض الطلب كله ولا ينشئ شيئًا', async () => {
  const { app, calls, base } = await boot();
  const r = await co(base, { lines: [line(100, 100, true), { ...line(100, 100, false), claimedPrice: 10 }] }); const j = await r.json();
  assert.equal(r.status, 409); assert.equal(j.index, 1); assert.equal(j.expected, 233); assert.equal(calls.length, 0); app.close();
});
test('checkout: منتج غير مسجل، كمية غير صالحة، سلة فارغة، أسطر كثيرة', async () => {
  const { app, calls, base } = await boot({ app: { rate: { windowMs: 60000, max: 1000 } } });
  const bad = async (b, err) => { const r = await co(base, b); assert.equal((await r.json()).error, err); };
  await bad({ lines: [line(100, 100, true, 1, { productId: '999' })] }, 'unknown_product');
  await bad({ lines: [line(100, 100, true, 0)] }, 'bad_quantity');
  await bad({ lines: [line(100, 100, true, 21)] }, 'bad_quantity');
  await bad({ lines: [line(100, 100, true, 1.5)] }, 'bad_quantity');
  await bad({ lines: [] }, 'empty_cart');
  await bad({}, 'empty_cart');
  await bad({ lines: Array.from({ length: 21 }, () => line(100, 100, true)) }, 'too_many_lines');
  assert.equal(calls.length, 0); app.close();
});
test('checkout: نفس السطر في طلبين = عنصر واحد في سلة', async () => {
  const { app, calls, base } = await boot();
  const a = await (await co(base, { lines: [line(100, 100, true)] })).json();
  const b = await (await co(base, { lines: [line(100, 100, true, 4)] })).json();
  assert.equal(a.lines[0].itemId, b.lines[0].itemId); assert.equal(b.lines[0].quantity, 4); assert.equal(calls.length, 1); app.close();
});
test('checkout: السقف اليومي يُفحص قبل أي إنشاء', async () => {
  const { app, calls, base } = await boot({ app: { dailyCap: 2 } });
  const r = await co(base, { lines: [line(100, 100, true), line(110, 100, true), line(120, 100, true)] });
  assert.equal(r.status, 503); assert.equal(calls.length, 0); app.close();
});
