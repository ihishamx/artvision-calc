// معادلات Art الرسمية (3 أكتوبر 2026). القيم مشتقة من المعادلة، مقرّبة مرة واحدة لأقرب ريال.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from './pricing-core.mjs';
const P = (l, w, f) => evaluate({ lengthRaw: String(l), widthRaw: String(w), framed: f }).price;
const S = (l, w, f) => evaluate({ lengthRaw: String(l), widthRaw: String(w), framed: f }).status;

test('أمثلة Art', () => {
  assert.equal(P(100, 100, true), 425);   // 400 + 25
  assert.equal(P(100, 100, false), 233);  // 102×102×200/10000 = 208.08 + 25 = 233.08
});
test('مستطيل وعكسه بنفس السعر', () => {
  assert.equal(P(120, 80, true), 409); assert.equal(P(80, 120, true), 409);
  assert.equal(P(120, 80, false), 225); assert.equal(P(80, 120, false), 225); // 122×82: 200.08 + 25
});
test('حالات أخرى', () => {
  assert.equal(P(100, 70, true), 305); assert.equal(P(100, 70, false), 172);   // 102×72: 146.88 + 25 = 171.88
  assert.equal(P(150, 150, false), 487);  // 152×152: 462.08 + 25 = 487.08
  assert.equal(P(20, 20, false), 35);     // 22×22: 9.68 + 25 = 34.68
  assert.equal(P(25, 20.5, true), 46);    // 20.5 + 25 = 45.5 → 46 (نصف لأعلى)
});
test('الحدود والمدخلات', () => {
  assert.equal(S(290, 150, true), 'ok'); assert.equal(S(291, 150, true), 'too_large_framed');
  assert.equal(S(330, 150, false), 'ok'); assert.equal(S(331, 150, false), 'too_large_unframed');
  assert.equal(S(19.9, 50, true), 'too_small');
  for (const bad of ['0', '-10', 'abc', '', '1e2', '10.55']) assert.equal(S(bad, 100, true), 'invalid_input');
  assert.equal(evaluate({ lengthRaw: '١٠٠', widthRaw: '١٠٠', framed: false }).price, 233);
});
