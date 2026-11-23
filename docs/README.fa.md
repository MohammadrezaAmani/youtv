# راهنمای اجرای YouTV Core 0.3.0

این نسخه **فقط سورس Core** است و باید روی سیستم خودتان با Bun و مرورگر تست شود. وب‌سایت بک‌اند یا دیتابیس سروری ندارد؛ Worker شخصی اختیاری است. هیچ کانال ساختگی به اپلیکیشن اضافه نشده است.

## ۱) اجرای پروژه با Bun

نسخه پیشنهادی Bun: `1.4.5`. راهنمای رسمی: https://bun.com/docs/installation

```bash
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
bun --version
unzip YouTV-Core-v0.3.0.zip
cd youtv-core-v0.3.0
bun install
bun run check
bun run test
bun run smoke
bun run dev
```

آدرس پروژه: `http://localhost:5173`.

برای ساخت نسخه استاتیک:

```bash
bun run build
```

در محیط تولید بسته، دسترسی به npm registry وجود نداشت و دستور `bun install` اجرا نشد. بعد از اولین نصب موفق، `bun.lock` ساخته می‌شود؛ آن را داخل Git commit کنید و در CI از `bun install --frozen-lockfile` استفاده کنید. ادعای تأیید Build یا مرورگر نداریم.

## ۲) افزودن کانال و زیرنویس

از «افزودن کانال»، آدرس واقعی HTTPS، فرمت (`HLS` برای استریم‌های بدون پسوند)، گروه، تگ‌ها، زبان و لوگو را وارد کنید.

در همان فرم، برای هر زبان زیرنویس یک URL از نوع `.vtt` یا `.srt` ثبت کنید. فایل SRT هنگام پخش به WebVTT تبدیل می‌شود. در پلیر نیز می‌توان فایل SRT/VTT محلی را برای همان نشست بارگذاری کرد. اگر داخل HLS زبان صوتی، Subtitle Rendition یا چند کیفیت وجود داشته باشد، پلیر فهرست واقعی آن‌ها را نمایش می‌دهد.

تنظیمات سراسری شامل زبان صوتی ترجیحی، زبان زیرنویس، ظاهر زیرنویس، حجم صدا، سرعت پخش و Autoplay است. امکان تغییر کیفیت Auto / Manual، PiP، تمام‌صفحه، theater و نمایش Diagnostics هم قرار داده شده است.

## ۳) Teletext

برای مشاهده صفحه‌های Teletext **فقط در صورتی که ارائه‌دهنده endpoint HTTP مستقل عرضه کند**، در تنظیمات کانال چنین Templateای را ثبت کنید:

```text
https://provider.example/api/teletext/{page}.txt
```

در پنجره Teletext می‌توانید شماره صفحه از ۱۰۰ تا ۸۹۹ را انتخاب کنید. پاسخ متنی یا JSON (`text`/`content`/`body`) نمایش داده می‌شود. HTML فقط به متن ساده تبدیل می‌شود و اجرا نمی‌شود.

**محدودیت مهم:** Teletext واقعی DVB/EBU در PIDهای MPEG-TS معمولاً به مرورگر به‌عنوان ترک متن ارائه نمی‌شود. Worker یک Proxy HTTP است، Decoder یا Transcoder نیست. برای آن نوع Teletext باید در سمت منبع استخراج و به WebVTT یا یک API صفحه‌های Teletext تبدیل شود. هیچ گزینه‌ای در YouTV وانمود نمی‌کند که این مشکل به‌طور خودکار حل شده است.

## ۴) GitHub Pages

فایل‌ها را در مخزن GitHub قرار دهید، در Settings → Pages گزینه GitHub Actions را انتخاب کنید و به شاخه `main` پوش کنید. Workflow مسیر پروژه را خودکار تنظیم می‌کند. برای دامنه سفارشی، متغیر Repository با نام `YOUTV_BASE_PATH` را روی `/` بگذارید.

## ۵) Worker شخصی

فایل `apps/worker/wrangler.jsonc` را باز کنید و دامنه‌های مجاز منبع و Origin وب‌سایت را وارد کنید.

```bash
cd apps/worker
bunx wrangler login
bunx wrangler secret put PROXY_TOKEN
bunx wrangler deploy
```

آدرس و Token Worker را در بخش Proxy Manager وارد کنید. هر کانال می‌تواند Direct، Proxy یا Auto و Worker مشخص داشته باشد. حالت Auto پس از خطای قابل بازیابی اتصال مستقیم به Worker سوئیچ می‌کند. اگر URL منبع چند CDN یا دامنه برای قطعات داشته باشد، همه دامنه‌های مورد نیاز باید در Allowlist تعریف شوند.

توجه: Cloudflare ممکن است کاربرد CDN برای انتقال حجم بالای ویدئو را با استناد به سیاست سرویس محدود کند. این سیستم DRM و احراز هویت ارائه‌دهنده را دور نمی‌زند و هیچ مجوزی برای بازپخش کانال‌ها ایجاد نمی‌کند.

## ۶) کلیدهای میانبر پلیر

- `Space` یا `K`: پخش/توقف
- `F`: تمام‌صفحه
- `M`: بی‌صدا
- `C`: زیرنویس
- `← / →`: ۱۰ ثانیه عقب/جلو در بازه قابل Seek
- `↑ / ↓`: حجم صدا

## ۷) تست‌ها و محدودیت‌ها

`bun run smoke` تست‌های مستقل را اجرا می‌کند. `bun run check` و `bun run build` را روی سیستمی با دسترسی پکیج‌ها اجرا کنید. برای پذیرش نسخه عملیاتی، عملکرد HLS واقعی، تغییر زبان صدا، تغییر زیرنویس، Safari/iOS و نمای موبایل را روی دستگاه خود امتحان کنید. گزارش کامل: `docs/VALIDATION.md`.
