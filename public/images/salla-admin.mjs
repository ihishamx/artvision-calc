// الوحيد الذي يكلّم Admin API في سلة. لا أسرار في الواجهة: التوكن من متغير بيئة فقط.
// STAFF-VERIFY: عنوان الإنشاء، أسماء الحقول (status/product_type/quantity/require_shipping)، وشكل الاستجابة data.id.
import { SALLA_API_BASE } from './config.mjs';

export function buildItemPayload({ productName, lengthCm, widthCm, framed, frameLabel, price }) {
  const spec = framed ? `بإطار ${frameLabel}` : 'بدون إطار';
  return {
    name: `${productName} — مقاس ${lengthCm}×${widthCm} سم — ${spec}`,
    price,                        // ريال سعودي، محسوب من تسعيرة آرت فيجن (السعر يشمل الشحن المجاني)
    product_type: 'product',
    status: 'hidden',             // غير ظاهر في المتجر، يُضاف للسلة عبر المعرّف فقط
    quantity: 1000,               // STAFF-VERIFY: دعم الكمية غير المحدودة عبر الـAPI
    require_shipping: true,
    weight: 0.5,
    weight_type: 'kg',
    // STAFF-VERIFY: إضافة صورة المنتج الأصلي للعنصر حتى تظهر في سلة العميل (اسم الحقل/المسار في API الحي)
    description: `${productName}. طلب من حاسبة صفحة الهبوط: ${lengthCm}×${widthCm} سم، ${spec}. الشحن مجاني داخل المملكة.`,
  };
}

export function createSallaClient({ token, baseUrl = SALLA_API_BASE, fetchImpl = globalThis.fetch, timeoutMs = 10000 }) {
  if (!token) throw new Error('SALLA_ACCESS_TOKEN مفقود');
  return {
    async createHiddenItem(payload) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`${baseUrl}/products`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`salla_http_${res.status}`);
        const body = await res.json();
        const id = body?.data?.id;
        if (!id) throw new Error('salla_no_id');
        return { id: String(id) };
      } finally { clearTimeout(t); }
    },
  };
}
