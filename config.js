// كل ما يخص سلة معزول هنا. STAFF-VERIFY = يتحقق منه الموظف من توثيق سلة الحي قبل التشغيل.
// التسعير لا يقرأ أي سعر أو Variant من سلة (إقرار Art 3 أكتوبر 2026): المعادلة وحدها في pricing-core.mjs.

// المنتجات المسموح بيعها بالمقاس الخاص عبر هذا الخادم. الاسم يظهر في عنصر السلة.
export const PRODUCTS = Object.freeze({
  '1306890256': { name: 'لوحة كانفس تجريدية رمادي داكن فاخرة' },
  '1715612554': { name: 'لوحة ركن القهوة' },
  // طقم 3 لوحات بنفس المقاس: سعر الطقم = 3 × سعر القطعة المقرّب (04 §13: لا خصم تلقائي، كل لوحة تُسعَّر على حدة). تقريب المجموع بدل القطعة = Needs Owner Input.
  '1181218623': { name: 'لوحة كانفس بوهيمي (طقم 3 لوحات)', pieces: 3 },
});

// ألوان البرواز (قراءة حية من سلة، 3 أكتوبر 2026). الاسم فقط يُستخدم؛ اللون لا يغيّر السعر (04 §14).
export const FRAME_COLORS = Object.freeze({
  black:         { label: 'أسود مجوف' },
  white:         { label: 'أبيض مجوف' },
  brown:         { label: 'بني مجوف' },
  gold:          { label: 'ذهبي مجوف' },
  champagne:     { label: 'شامبين مجوف' },
  fullChampagne: { label: 'فل شامبين مجوف' },
});

export const MAX_LINES = 20;     // أسطر مختلفة في طلب واحد
export const MAX_QTY = 20;       // كمية السطر الواحد (أكبر من ذلك عبر واتساب/B2B)

// STAFF-VERIFY: عنوان وشكل Admin API الحي لإنشاء منتج
export const SALLA_API_BASE = 'https://api.salla.dev/admin/v2';

// صفحات الهبوط المخدومة: المسار ← ملف HTML. تُستخدم أيضًا كقائمة بيضاء لمسار العودة من Tap.
export const PAGES = Object.freeze({ '/': 'index.html', '/bohemian': 'bohemian.html', '/terms': 'terms.html', '/refund': 'refund.html', '/privacy': 'privacy.html' });
