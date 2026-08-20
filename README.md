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
- **İş arama**: CV'nin tespit edilen rol unvanı ve kariyer seviyesi (öğrenci/stajyer, yeni mezun,
  deneyimli) etrafında **iki kaynağı birden** arar: (1) Jooble (uluslararası, ama Türkiye kapsamı
  zayıf) ve (2) Google Custom Search API üzerinden doğrudan **LinkedIn, Kariyer.net, Indeed,
  SecretCV** sitelerinde hedefli arama — bu ikinci kaynak Türkiye'deki iş bulma oranını asıl
  artıran kısımdır. Sonuçlar tekilleştirilip (aynı ilan iki kaynaktan gelmişse tek gösterilir) tek
  bir skora göre sıralanır; öğrenci/yeni mezun CV'lerinde staj ve giriş seviyesi ilanlar otomatik
  önceliklendirilir. Şehir, serbest metin yerine bir **dropdown**'dan seçilir (yaygın Türkiye
  şehirleri + "Diğer" ile özel giriş).
- **Çift format indirme**: Onaylanan son hal, hem **PDF** hem **Word (.docx)** olarak, hem
  **Türkçe** hem **İngilizce** (Gemini ile otomatik çeviri) seçenekleriyle indirilebilir. İkisi de
  aynı paylaşılan ayrıştırıcıyı (`lib/cvParser.ts`) kullandığı için isim/iletişim/başlık/madde
  biçimlendirmesi tutarlıdır ve ATS-uyumlu, profesyonel görünümlüdür.

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
| `JOOBLE_API_KEY` | (opsiyonel) https://jooble.org/api/about adresinden **ücretsiz** kayıt olarak alınır |
| `JOOBLE_LOCATION` | (opsiyonel) Jooble için varsayılan konum, varsayılan `Turkey`. |
| `SERPER_API_KEY` | **Türkiye iş arama kaynağı için gerekli.** https://serper.dev adresinden **tek adımda** alınır — aşağıdaki nota bakın. |

> Not: `GEMINI_API_KEY` kendi Google hesabınıza ait bir anahtardır. Google AI Studio, ücretsiz bir
> kullanım kotası sunar (bkz. https://ai.google.dev/gemini-api/docs/pricing); kotayı aşarsanız
> faturalandırma devreye girer. Bu proje anahtarı client tarafına hiç göndermez; tüm çağrılar
> sunucu tarafındaki API route'ları üzerinden yapılır.

### Türkiye iş arama kaynağı kurulumu (LinkedIn / Kariyer.net / Indeed / SecretCV)

Jooble'ın Türkiye kapsamı zayıf olduğu için "Türkiye'den hiç iş bulunamıyor" sorununu asıl çözen
kaynak budur.

**Bu kaynak Google'ın kendi "Custom Search JSON API"sini KULLANMIYOR.** İlk sürümde onu
kullanıyordu, ama Google bu API'yi **2025'te yeni müşterilere tamamen kapattı** — yeni oluşturulan
bir Google Cloud projesi, API'yi doğru şekilde etkinleştirseniz, key'i kısıtlamasız bıraksanız,
billing açsanız bile kalıcı olarak `"This project does not have the access to Custom Search JSON
API"` hatası alır. Bu bir yapılandırma hatası değil, Google'ın 2027'de tamamen kapatacağı bu
API için verdiği bilinçli bir karar; hiçbir ayarla düzeltilemez.

Bunun yerine **Serper.dev** kullanılıyor — Google arama sonuçlarını JSON olarak döndüren, tek bir
API key ile çalışan, proje/CSE derdi olmayan bir servis:

1. https://serper.dev adresinden ücretsiz kayıt olun (kredi kartı gerekmez).
2. Dashboard'dan API key'inizi kopyalayın.
3. Vercel'de `SERPER_API_KEY` olarak ekleyin.

Yeni hesaplar **2.500 sorguluk ücretsiz deneme kredisi** alır — bu proje her aramada 4 sorgu
kullanır (LinkedIn, Kariyer.net, Indeed, SecretCV için birer tane), yani deneme kredisiyle ~600
arama yapılabilir. Bu değişken eksikse uygulama hata vermez — sadece bu kaynağı atlar ve (varsa)
Jooble ile devam eder; arayüzde bunu bildiren bir uyarı gösterilir.

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
  fonksiyonlarında sorunsuz çalışan sade/ATS-dostu bir şablon kullanılır. Türkçe karakterlerin
  (ı, İ, ş, Ş, ğ, Ğ vb.) doğru görünmesi için proje kökündeki `fonts/NotoSans-Regular.ttf` ve
  `fonts/NotoSans-Bold.ttf` dosyaları PDF'e gömülür (`lib/gemini.ts` değil, doğrudan
  `app/api/generate-pdf/route.ts` içinde `Font.register` ile). **Bu iki font dosyasını projeden
  silmeyin / .gitignore'a eklemeyin** — silinirse PDF üretimi hata verir.
- **Eşleşme skoru**: `lib/jobScoring.ts` içindeki tek bir paylaşılan fonksiyon, Jooble ve Google
  kaynaklı (LinkedIn/Kariyer.net/Indeed/SecretCV) sonuçları AYNI ölçekte puanlar — bu sayede iki
  kaynaktan gelen ilanlar birleştirilip adil şekilde sıralanabilir. Skor; anahtar kelime örtüşmesi,
  rol unvanı eşleşmesi ve kariyer seviyesi uyumuna (staj/junior önceliklendirme) dayanır.

## Klasör yapısı

```
app/
  page.tsx                 → Tek sayfalık sihirbaz arayüzü (upload → analiz → review → iş arama)
  api/
    parse-cv/route.ts      → PDF/DOCX → düz metin
    analyze-cv/route.ts    → Genel CV analizi (Gemini)
    target-job/route.ts    → Hedef pozisyona göre uyarlama (Gemini)
    revise-change/route.ts → Tek bir öneriyi kullanıcı talimatına göre yeniden yazma (Gemini)
    job-search/route.ts    → Jooble + Google (LinkedIn/Kariyer.net/Indeed/SecretCV) birleşik arama
    generate-pdf/route.ts  → Nihai CV'yi PDF'e render etme (Noto Sans, Türkçe destekli)
    generate-docx/route.ts → Nihai CV'yi Word (.docx) belgesine render etme
    translate-cv/route.ts  → CV'yi TR↔EN çevirme (Gemini)
components/
  DiffCard.tsx              → Tek değişiklik: strikethrough/highlight + kabul/reddet/revize UI
  JobMatchCard.tsx           → Tek iş ilanı kartı
lib/
  gemini.ts                  → Gemini API çağrı yardımcıları
  jooble.ts                  → Jooble API çağrı yardımcıları
  googleJobSearch.ts         → Google Custom Search ile LinkedIn/Kariyer.net/Indeed/SecretCV taraması
  jobScoring.ts               → Her iki kaynak için paylaşılan eşleşme skoru mantığı
  cvParser.ts                → PDF/DOCX ortak biçimlendirme ayrıştırıcısı (isim, başlık, madde tespiti)
  types.ts                   → Paylaşılan TypeScript tipleri
fonts/
  NotoSans-Regular.ttf, NotoSans-Bold.ttf → PDF'de Türkçe karakter desteği için gömülü fontlar
```
