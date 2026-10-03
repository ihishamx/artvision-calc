// كل ما يخص سلة معزول هنا. STAFF-VERIFY = يتحقق منه الموظف من توثيق سلة الحي قبل التشغيل.
export const PRODUCT_ID = '1715612554';

// قراءة حية من سلة (3 أكتوبر 2026)
export const SIZE_OPTION_ID = '1453855955';
export const FRAME_OPTION_ID = '544551900';
export const SIZE_VALUES = { '70x100': '1536352256', '80x120': '897519361', '100x150': '121908738', '60x90': '1662163186' };
export const NO_FRAME_VALUE = '1611281675';
export const FRAME_COLORS = {
  champagne:     { id: '1361136899', label: 'شامبين مجوف' },
  white:         { id: '588147724',  label: 'أبيض مجوف' },
  black:         { id: '2094304013', label: 'أسود مجوف' },
  gold:          { id: '1320266254', label: 'ذهبي مجوف' },
  brown:         { id: '413059343',  label: 'بني مجوف' },
  fullChampagne: { id: '1786505224', label: 'فل شامبين مجوف' },
};

// STAFF-VERIFY: عنوان وشكل Admin API الحي لإنشاء منتج
export const SALLA_API_BASE = 'https://api.salla.dev/admin/v2';

export function stockKey(l, w) { return [l, w].sort((a, b) => a - b).join('x'); }
