// يمنع تكرار إنشاء نفس العنصر: ذاكرة + ملف اختياري يصمد عبر إعادة التشغيل. لا يخزن بيانات عملاء.
import fs from 'node:fs';

export function createItemStore({ file } = {}) {
  const map = new Map();
  const inflight = new Map();
  if (file && fs.existsSync(file)) {
    try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')))) map.set(k, v); } catch { /* ملف تالف: نبدأ فارغين */ }
  }
  const persist = () => {
    if (!file) return;
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(map)));
    fs.renameSync(tmp, file);
  };
  return {
    get: (k) => map.get(k),
    async getOrCreate(k, create) {
      if (map.has(k)) return { id: map.get(k), created: false };
      if (inflight.has(k)) return { id: await inflight.get(k), created: false };
      const p = (async () => { const id = await create(); map.set(k, id); persist(); return id; })();
      inflight.set(k, p);
      try { return { id: await p, created: true }; } finally { inflight.delete(k); }
    },
    size: () => map.size,
  };
}
