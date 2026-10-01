# Pub Skor – Ortak Arşiv (Netlify)

Herkesin ziyaret ekleyip görebildiği Pub Skor. Statik site + tek bir Netlify Function + Netlify Blobs (ek veritabanı gerekmez).

```
public/index.html            → uygulama
netlify/functions/api.mjs    → /api/visits ve /api/photo uçları
netlify/lib/visits.mjs       → doğrulama, sahiplik, skor hesabı
netlify.toml, package.json
```

## Yayına alma (önerilen: Git)
1. Bu klasörü bir GitHub deposuna yükle.
2. Netlify → **Add new site → Import from Git** → depoyu seç. Ayarlar `netlify.toml`'dan gelir, hiçbir şey doldurma.
3. (İsteğe bağlı) **Site configuration → Environment variables** → `ADMIN_KEY` = kendi seçtiğin uzun bir parola. Yönetici modu için gerekir.
4. Deploy et. Bitti.

## Yayına alma (alternatif: CLI)
```
npm install
npx netlify login
npx netlify deploy --prod
```
İlk seferde "create & configure a new site" seçeneğini seç. Publish dizini: `public`.

> Sürükle-bırak (Netlify Drop) ile yüklemek önerilmez: function bağımlılığı (`@netlify/blobs`) kurulmayabilir.

## Yerelde deneme
`npx netlify dev` → http://localhost:8888 (Blobs yerelde otomatik simüle edilir).

## Kim ne yapabilir?
- **Herkes:** tüm ziyaretleri görür, yeni ziyaret ekler, PDF/WhatsApp çıktısı alır.
- **Kaydı ekleyen (aynı tarayıcı/cihaz):** kendi kaydını düzenler ve siler. Sahiplik anahtarı o tarayıcının `localStorage`'ında durur; tarayıcı verisi silinirse o kayıt üzerindeki yetki kaybolur.
- **Yönetici:** sayfanın altındaki "Yönetici" düğmesine `ADMIN_KEY`'i girer; her kaydı düzenler/siler (uygunsuz içerik temizliği için).

## Sınırlar
- En fazla 2000 kayıt, fotoğraf ~250 KB (uygulama otomatik küçültür), not 2000 karakter, en çok 12 katılımcı.
- Skor sunucuda yeniden hesaplanır; eksik puanlı kayıt kabul edilmez.
- Yazma ucu herkese açıktır. Kötüye kullanım görürsen Netlify panelinden **Rate limiting** kuralı ekleyebilir veya `ADMIN_KEY` ile kayıtları silebilirsin.
