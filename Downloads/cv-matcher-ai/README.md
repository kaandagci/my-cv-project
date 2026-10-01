# CV Geliştir & İş Eşleştir

Next.js (App Router) tabanlı, Gemini API ile CV analiz/iyileştirme ve Jooble API ile
iş eşleştirme yapan uygulama. Auth yok; her şey tarayıcı oturumunda (React state) tutulur, sunucuda
hiçbir CV verisi kalıcı olarak saklanmaz.

## Özellikler
- **CV yükleme**: PDF (`pdf-parse`) ve DOCX (`mammoth`) ayrıştırma
- **AI analiz**: Google Gemini ile CV'yi inceler, madde madde iyileştirme önerir
- **Diff önizleme**: Her öneri için eski metin üstü çizili (kırmızı), yeni metin vurgulu (yeşil)
- **Şeffaflık**: Her değişikliğin yanında "neden değiştirildi" açıklaması
- **Kabul / Reddet / Yeniden düzenlet**: Her öneriyi tek tek yönetin; "revize et" dediğinizde
  talimatınıza göre Gemini yeni bir versiyon üretir
- **Hedef pozisyon**: Bir iş unvanı/ilanı girerek CV'yi o pozisyona göre uyarlatabilirsiniz
- **İş arama**: CV'den çıkarılan anahtar kelimelerle Jooble'da arama yapar (Türkiye dahil 60+
  ülkeyi destekler), sonuçları CV-iş eşleşme skoruna göre sıralar
- **PDF indirme**: Onaylanan son hal, sade/ATS-uyumlu bir PDF olarak indirilebilir

## Yerel geliştirme

```bash
npm install
cp .env.example .env.local   # sonra .env.local içine kendi anahtarlarınızı girin
npm run dev
```

`http://localhost:3000` adresini açın.

## Gerekli ortam değişkenleri

| Değişken | Açıklama |
|---|---|
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey adresinden **ücretsiz** alınır |
| `GEMINI_MODEL` | (opsiyonel) Kullanılacak model, varsayılan `gemini-3.6-flash`. Google AI Studio'daki ücretsiz kotayla çalışır. |
| `JOOBLE_API_KEY` | https://jooble.org/api/about adresinden **ücretsiz** kayıt olarak alınır |
| `JOOBLE_LOCATION` | (opsiyonel) Varsayılan arama konumu — şehir (`İstanbul`) veya ülke (`Türkiye`) adı. Kullanıcı arayüzden de değiştirebilir; varsayılan `Türkiye`. |

> Not: `GEMINI_API_KEY` kendi Google hesabınıza ait bir anahtardır. Google AI Studio, ücretsiz bir
> kullanım kotası sunar (bkz. https://ai.google.dev/gemini-api/docs/pricing); kotayı aşarsanız
> faturalandırma devreye girer. Bu proje anahtarı client tarafına hiç göndermez; tüm çağrılar
> sunucu tarafındaki API route'ları üzerinden yapılır.
>
> **Neden Jooble, Adzuna değil?** Adzuna, Türkiye'yi desteklemiyor. Jooble ise Türkiye dahil
> 60'tan fazla ülkede aktif çalışan, resmi ve ücretsiz bir REST API sunuyor
> (`POST https://jooble.org/api/{apiKey}` — `{ keywords, location }`).

## Vercel'e deploy etme

1. Bu klasörü bir GitHub reposuna push edin.
2. https://vercel.com adresinde "Add New... → Project" ile bu repoyu import edin.
   (Next.js otomatik algılanır, ek ayar gerekmez.)
3. **Project Settings → Environment Variables** kısmına yukarıdaki değişkenleri (en az `GEMINI_API_KEY`, `JOOBLE_API_KEY`)
   ekleyin ve "Production" (isterseniz Preview/Development de) için işaretleyin.
4. Deploy edin. Vercel size herkese açık bir `https://....vercel.app` linki verecektir —
   bu linki paylaşarak uygulamaya erişim sağlanabilir (auth yok).
5. Ortam değişkeni eklediğinizde veya değiştirdiğinizde projeyi yeniden deploy etmeniz gerekir
   (Vercel dashboard → Deployments → "..." → Redeploy).

## Mimari notları

- **Kalıcı depolama yok**: CV metni, öneriler ve durum bilgisi sadece tarayıcıdaki React state'te
  tutulur. Sayfa yenilenirse veya sekme kapatılırsa veriler kaybolur (kasıtlı tasarım — istenirse
  `sessionStorage`/`localStorage` eklenebilir, ancak bu artifact ortamında değil, kendi projenizde
  serbestçe ekleyebilirsiniz).
- **Diff eşleştirme**: Gemini, her öneri için CV metninden *birebir* bir alıntı (`original`) döndürür.
  Uygulama bu alıntıyı orijinal metinde arar; bulunamayan öneriler otomatik filtrelenir (halüsinasyon
  koruması).
- **PDF üretimi**: `@react-pdf/renderer` ile, headless tarayıcı gerektirmeyen, Vercel serverless
  fonksiyonlarında sorunsuz çalışan sade/ATS-dostu bir şablon kullanılır.
- **Jooble eşleşme skoru**: CV anahtar kelimeleri ile ilan başlığı/açıklaması (snippet) arasındaki
  kelime örtüşme oranına dayalı basit bir skor (0-100). Daha gelişmiş bir skor isterseniz
  `lib/jooble.ts` içindeki `scoreJob` fonksiyonunu Gemini çağrısıyla değiştirebilirsiniz
  (maliyet/gecikme artışına dikkat edin).

## Klasör yapısı

```
app/
  page.tsx                 → Tek sayfalık sihirbaz arayüzü (upload → analiz → review → iş arama)
  api/
    parse-cv/route.ts      → PDF/DOCX → düz metin
    analyze-cv/route.ts    → Genel CV analizi (Gemini)
    target-job/route.ts    → Hedef pozisyona göre uyarlama (Gemini)
    revise-change/route.ts → Tek bir öneriyi kullanıcı talimatına göre yeniden yazma (Gemini)
    job-search/route.ts    → Jooble arama + skorlama
    generate-pdf/route.ts  → Nihai CV'yi PDF'e render etme
components/
  DiffCard.tsx              → Tek değişiklik: strikethrough/highlight + kabul/reddet/revize UI
  JobMatchCard.tsx           → Tek iş ilanı kartı
lib/
  gemini.ts                  → Gemini API çağrı yardımcıları
  jooble.ts                  → Jooble API çağrı + skorlama
  types.ts                   → Paylaşılan TypeScript tipleri
```
