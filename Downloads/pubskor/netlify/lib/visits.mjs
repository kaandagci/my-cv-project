// Pub Skor ortak arşiv API'si (Netlify Blobs üzerinde)
// Depolama nesneleri dışarıdan verilir; böylece mantık yerelde sahte depoyla test edilebilir.
import { createHash, timingSafeEqual } from 'node:crypto';

export const METRICS = [
    { id: 'beer_temp_gas', weight: 12 }, { id: 'draft_lacing', weight: 12 },
    { id: 'service_speed', weight: 12 }, { id: 'price_transparency', weight: 12 },
    { id: 'acoustics_talk', weight: 10 }, { id: 'interior_design', weight: 10 },
    { id: 'ambiance_air', weight: 8 }, { id: 'restroom_queue', weight: 7 },
    { id: 'restroom_hygiene', weight: 7 }, { id: 'snacks_food', weight: 5 },
    { id: 'vibe_comfort', weight: 5 }
];

const MAX_VISITS = 2000;
const MAX_BODY_CHARS = 450000;
const MAX_PHOTO_B64 = 340000;
const ID_RE = /^pub_[A-Za-z0-9_-]{4,40}$/;
const PID_RE = /^[\w-]{1,32}$/;
const CTRL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});
const fail = (status, message) => json({ error: message }, status);
const sha = (t) => createHash('sha256').update(String(t)).digest('hex');
const safeEq = (a, b) => {
    const x = Buffer.from(String(a)), y = Buffer.from(String(b));
    return x.length === y.length && timingSafeEqual(x, y);
};
const str = (v, max) => (typeof v === 'string' ? v.replace(CTRL_RE, '').trim().slice(0, max) : '');

function publicRecord(r) {
    const { ownerHash, ...rest } = r;
    return { ...rest, photoUrl: r.hasPhoto ? `/api/photo/${r.id}?v=${r.updatedAt}` : null };
}

// Gelen veriyi doğrular, skoru sunucuda yeniden hesaplar (istemciye güvenilmez)
export function validate(b) {
    if (!b || typeof b !== 'object') return { error: 'Geçersiz veri' };
    const name = str(b.name, 80);
    if (!name) return { error: 'Mekan adı gerekli' };
    const location = str(b.location, 80);
    if (typeof b.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) || isNaN(Date.parse(b.date))) return { error: 'Geçersiz tarih' };
    const notes = typeof b.notes === 'string' ? b.notes.replace(CTRL_RE, '').trim().slice(0, 2000) : '';

    if (!Array.isArray(b.participants) || b.participants.length < 1 || b.participants.length > 12) return { error: 'Katılımcı sayısı 1-12 olmalı' };
    const participants = [], seen = new Set();
    for (const p of b.participants) {
        const id = p && String(p.id);
        const pname = str(p && p.name, 20);
        if (!id || !PID_RE.test(id) || seen.has(id) || !pname) return { error: 'Geçersiz katılımcı' };
        seen.add(id);
        participants.push({ id, name: pname, colorIdx: Number.isInteger(p.colorIdx) && p.colorIdx >= 0 && p.colorIdx < 6 ? p.colorIdx : 0 });
    }

    const metrics = {};
    let totalW = 0, wSum = 0;
    for (const m of METRICS) {
        const src = (b.metrics && b.metrics[m.id]) || {};
        const active = src.active !== false;
        const scores = {};
        let sum = 0, cnt = 0;
        for (const p of participants) {
            const v = src.scores ? src.scores[p.id] : undefined;
            if (Number.isInteger(v) && v >= 1 && v <= 10) { scores[p.id] = v; sum += v; cnt++; }
        }
        if (active) {
            if (cnt !== participants.length) return { error: 'Tüm aktif kriterler için tüm puanlar girilmeli' };
            totalW += m.weight; wSum += (sum / cnt) * m.weight;
        }
        metrics[m.id] = { active, scores };
    }
    if (totalW === 0) return { error: 'En az bir kriter aktif olmalı' };

    return { clean: { name, location, date: b.date, notes, participants, metrics, consensus: Math.round(wSum / totalW * 10) / 10 } };
}

function decodePhoto(dataUrl) {
    const prefix = 'data:image/jpeg;base64,';
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix)) return { error: 'Fotoğraf JPEG olmalı' };
    if (dataUrl.length > MAX_PHOTO_B64) return { error: 'Fotoğraf çok büyük' };
    const buf = Buffer.from(dataUrl.slice(prefix.length), 'base64');
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return { error: 'Geçersiz fotoğraf' };
    return { ab: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
}

export function createHandler({ visits, photos, adminKey }) {
    const isAdmin = (req) => !!adminKey && safeEq(req.headers.get('x-admin-key') || '', adminKey);
    const canModify = (req, rec) => {
        if (isAdmin(req)) return true;
        const token = req.headers.get('x-owner-token') || '';
        return token.length >= 16 && !!rec.ownerHash && safeEq(sha(token), rec.ownerHash);
    };
    const readBody = async (req) => {
        const text = await req.text();
        if (text.length > MAX_BODY_CHARS) return { status: 413 };
        try { return { body: JSON.parse(text) }; } catch (e) { return { status: 400 }; }
    };
    const applyPhoto = async (id, photo) => {
        if (photo === undefined) return { keep: true };
        if (photo === null) { await photos.delete(id); return { has: false }; }
        const d = decodePhoto(photo);
        if (d.error) return d;
        await photos.set(id, d.ab);
        return { has: true };
    };

    return async function handle(req) {
        const url = new URL(req.url);
        const parts = url.pathname.split('/').filter(Boolean); // ['api','visits',id?]
        const kind = parts[1];
        let id = parts[2] ? decodeURIComponent(parts[2]) : null;

        try {
            // --- Fotoğraf ---
            if (kind === 'photo') {
                if (req.method !== 'GET' || !id || !ID_RE.test(id)) return fail(404, 'Bulunamadı');
                const ab = await photos.get(id, { type: 'arrayBuffer' });
                if (!ab) return fail(404, 'Bulunamadı');
                return new Response(ab, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' } });
            }
            if (kind !== 'visits') return fail(404, 'Bulunamadı');

            // --- Liste ---
            if (req.method === 'GET' && !id) {
                const { blobs } = await visits.list();
                const keys = blobs.map(b => b.key).slice(0, MAX_VISITS);
                const out = [];
                for (let i = 0; i < keys.length; i += 40) {
                    const chunk = await Promise.all(keys.slice(i, i + 40).map(k => visits.get(k, { type: 'json' }).catch(() => null)));
                    chunk.forEach(r => { if (r) out.push(publicRecord(r)); });
                }
                out.sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
                return json({ visits: out, admin: isAdmin(req) });
            }

            // --- Oluştur ---
            if (req.method === 'POST' && !id) {
                const token = req.headers.get('x-owner-token') || '';
                if (token.length < 16 || token.length > 128) return fail(401, 'Sahiplik anahtarı eksik');
                const rb = await readBody(req);
                if (rb.status) return fail(rb.status, rb.status === 413 ? 'Veri çok büyük' : 'Geçersiz JSON');
                const b = rb.body;
                if (!b || typeof b.id !== 'string' || !ID_RE.test(b.id)) return fail(400, 'Geçersiz kayıt kimliği');
                const v = validate(b);
                if (v.error) return fail(400, v.error);
                if (await visits.get(b.id, { type: 'json' })) return fail(409, 'Bu kayıt zaten var');
                if ((await visits.list()).blobs.length >= MAX_VISITS) return fail(507, 'Arşiv dolu');
                const now = Date.now();
                const rec = { id: b.id, ...v.clean, createdAt: now, updatedAt: now, hasPhoto: false, ownerHash: sha(token) };
                const ph = await applyPhoto(rec.id, b.photo);
                if (ph.error) return fail(400, ph.error);
                rec.hasPhoto = !!ph.has;
                await visits.setJSON(rec.id, rec);
                return json(publicRecord(rec), 201);
            }

            // --- Güncelle ---
            if (req.method === 'PUT' && id && ID_RE.test(id)) {
                const rec = await visits.get(id, { type: 'json' });
                if (!rec) return fail(404, 'Kayıt bulunamadı');
                if (!canModify(req, rec)) return fail(403, 'Bu kaydı düzenleme yetkin yok');
                const rb = await readBody(req);
                if (rb.status) return fail(rb.status, rb.status === 413 ? 'Veri çok büyük' : 'Geçersiz JSON');
                const v = validate(rb.body);
                if (v.error) return fail(400, v.error);
                const ph = await applyPhoto(id, rb.body.photo);
                if (ph.error) return fail(400, ph.error);
                const next = { ...rec, ...v.clean, id, updatedAt: Date.now(), hasPhoto: ph.keep ? rec.hasPhoto : !!ph.has };
                await visits.setJSON(id, next);
                return json(publicRecord(next));
            }

            // --- Sil ---
            if (req.method === 'DELETE' && id && ID_RE.test(id)) {
                const rec = await visits.get(id, { type: 'json' });
                if (!rec) return fail(404, 'Kayıt bulunamadı');
                if (!canModify(req, rec)) return fail(403, 'Bu kaydı silme yetkin yok');
                await visits.delete(id);
                await photos.delete(id);
                return json({ ok: true });
            }

            return fail(405, 'Desteklenmeyen istek');
        } catch (e) {
            console.error('API hatası:', e);
            return fail(500, 'Sunucu hatası');
        }
    };
}
