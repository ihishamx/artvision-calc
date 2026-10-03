// مصدر واحد للتسعير والتحقق — إقرار Art الرسمي 3 أكتوبر 2026 (المرجع الوحيد؛ لا أسعار سلة ولا Variants)
// بإطار: (L×W×400/10000)+25 · بدون إطار: ((L+2)×(W+2)×200/10000)+25 · تقريب واحد لأقرب ريال
export const RATE = Object.freeze({ framed: 400, unframed: 200 });
export const EMBEDDED_SHIPPING = 25;
export const UNFRAMED_PAD_MM = 20; // +2 سم لكل بُعد في سعر بدون إطار فقط (يلغي +4 السابق)
export const MIN_SIDE_CM = 20;
export const LIMITS = Object.freeze({
  framed:   { long: 290, short: 150 },
  unframed: { long: 330, short: 150 },
});
export function parseCm(raw) {
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
export function evaluate({ lengthRaw, widthRaw, framed }) {
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

// الخادم: أعد الحساب ولا تثق بسعر العميل
export function verifyQuote({ lengthRaw, widthRaw, framed, claimedPrice }) {
  const r = evaluate({ lengthRaw, widthRaw, framed });
  if (r.status !== 'ok') return { ok: false, reason: r.status };
  if (Number(claimedPrice) !== r.price) return { ok: false, reason: 'price_mismatch', expected: r.price };
  return { ok: true, expected: r.price };
}
