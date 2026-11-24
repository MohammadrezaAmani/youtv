# ارتقای YouTV v0.3 → v0.4 (Patch)

## نکته درباره نسخه پایه

این Patch برای پوشه v0.3 که Patch قبلی `YouTV-v0.3.0-fix-lucide-captions.patch` **روی آن اعمال شده** تهیه شده است. اگر قبلاً مشکل `ClosedCaption` را رفع نکرده‌ای، ابتدا Patch قبلی را اعمال کن.

## نصب Patch

```bash
cd ~/Downloads/youtv-core-v0.3.0
# نام Patch جدید در مسیر Downloads قرار می‌گیرد
git apply --check ~/Downloads/YouTV-v0.3.0-to-v0.4.0.patch
git apply ~/Downloads/YouTV-v0.3.0-to-v0.4.0.patch
bun install
bun run check
bun run test
bun run build
bun run dev
```

اگر پوشه پروژه نام دیگری دارد، تنها دستور `cd` را تغییر بده؛ **بقیه مسیرها نسبت به ریشه پروژه‌اند**. از `patch -p1 <...` نیز می‌توان استفاده کرد. برای اعمال Patch لزوماً به مخزن Git نیاز نیست؛ دستور `git apply` در فولدر فاقد `.git` هم کار می‌کند.

## ۱. کانال‌های پیش‌فرض

- فایل `apps/web/public/default.m3u8` دقیقاً از ورودی ارسالی کاربر کپی شده است؛ ۲۲۰۳ خط `EXTINF` دارد.
- هنگام اجرای برنامه، اگر منبع پیش‌فرض فعال و هنوز بارگیری نشده باشد، از `import.meta.env.BASE_URL + 'default.m3u8'` خوانده می‌شود.
- در Settings یا Playlists گزینه `Enable default.m3u8` را روشن/خاموش کن. خاموش‌کردن فقط منبع را از نمایش پنهان می‌کند و Favorites / Tags / History حفظ می‌شوند.
- اضافه‌کردن کانال‌های تکراری به شکل شخصی و غیرشخصی بر اساس URL مدیریت می‌شود؛ واردشدن منبع پیش‌فرض به یک کانال شخصی مالکیت آن را تغییر نمی‌دهد.
- برای پشتیبانی از ۲۲۰۳ کانال، کتابخانه ابتدا ۱۲۰ کارت می‌سازد و ادامه با «Load more» بارگذاری می‌شود.
- این فایل فقط فهرست URLهای کاربران است؛ سالم یا مجاز بودن تمام استریم‌ها تضمین نمی‌شود.

## ۲. پخش و کیفیت

- Settings → Player: `Automatically reconnect` و حداکثر تلاش مجدد را تنظیم کن.
- در صورت خطای شبکه، HLS با Backoff افزایشی و سقف تلاش مجدد بازسازی می‌شود. توقف دریافت داده هم تشخیص داده می‌شود؛ نیازی به فشردن مکرر Continue برای خطاهای موقت نیست.
- منوی Quality داخل Player فقط کیفیت‌های واقعی Master HLS را نشان می‌دهد؛ انتخاب `Auto` از ABR استفاده می‌کند. کیفیت ترجیحی در Settings قابل انتخاب است و بین کانال‌ها بر اساس ارتفاع Rendition اعمال می‌شود.
- برای استریم‌های Single-rendition یا HLS بومی Safari نمی‌توان کیفیت‌های موجودنبود را تحمیل کرد.
- محدودیت DRM/Codec/URL انقضا یا خطاهای پایدار 403/404 با Retry رفع نمی‌شوند.

## ۳. تست اتصال شبکه‌ها

- منوی Connectivity → Scan all enabled channels. اجرای اسکن ۲۲۰۳ کانال می‌تواند چند دقیقه طول بکشد و مصرف درخواست دارد؛ اسکن خودکار هنگام اجرا به صورت پیش‌فرض خاموش است و با چک‌باکس روشن می‌شود.
- تست، `HEAD` یا `GET` محدود و در صورت نیاز `Worker /probe` است؛ **ICMP Ping نیست**.
- `unknown` برای CORS، قطع ارتباط Worker، Timeout یا موارد نامشخص است، نه الزاماً قطع واقعی کانال.
- نتایج ثبت‌شده را در Library → Advanced Filters → Connection Status فیلتر کن.
- وضعیت «online» به معنای دریافت پاسخ HTTP است، نه تضمین Decode تصویر/صدا در مرورگر.

## ۴. مدیریت Cloudflare با رابط وب (بدون ترمینال)

### راه‌اندازی یک‌باره با داشبورد Cloudflare

1. وارد Cloudflare Dashboard → Workers & Pages → Create Worker شو.
2. در صفحه Edit Code محتوای فایل `apps/worker/dashboard-worker.mjs` را **کامل** جایگزین و Deploy کن. این فایل JS مستقل از Bun و آماده Paste در Dashboard است.
3. در Settings → Variables and Secrets:
   - `ALLOWED_HOSTS`: فهرست دقیق میزبان‌های مجاز استریم، با کاما. برای هر میزبان جدید لازم است این مقدار را به‌روزرسانی کنی؛ استفاده عمومی از پروکسی بدون allowlist توصیه نمی‌شود.
   - `ALLOWED_ORIGINS`: آدرس دقیق GitHub Pages با scheme، بدون slash انتهایی (مثلاً `https://mohammadrezaamani.github.io`). برای مدیریت API نباید `*` باشد.
   - `PROXY_TOKEN`: توکن مستقل و تصادفی، حداقل ۲۴ کاراکتر، به‌صورت Secret.
   - `ADMIN_TOKEN`: توکن **متفاوت** و تصادفی، حداقل ۳۲ کاراکتر، به‌صورت Secret.
4. آدرس `https://YOUR-WORKER.workers.dev/` و `PROXY_TOKEN` را در YouTV → Proxy Manager → Add Worker اضافه کن.
5. در بخش Cloudflare management، همان Worker را انتخاب کن. Account ID، **API Token محدود** با دسترسی `Workers Scripts Read/Edit` و `ADMIN_TOKEN` را وارد کن. `Verify API Token` و `List Workers` را بزن. انتخاب Worker Script امکان دیدن Settings و روشن/خاموش کردن workers.dev subdomain را فراهم می‌کند.

**هیچ دستور ترمینالی برای انجام مدیریت‌های فوق لازم نیست.** راه‌اندازی اولیه در داشبورد انجام می‌شود. API Cloudflare لزوماً CORS موردنیاز GitHub Pages را ارائه نمی‌دهد؛ به همین دلیل درخواست‌ها از Worker شخصیِ دارای مجوز عبور داده می‌شود.

### محدودیت‌ها

- API Token حساب Cloudflare هرگز در LocalStorage ذخیره یا در Backup وارد نمی‌شود و با Refresh صفحه از بین می‌رود.
- این UI تأیید توکن، فهرست Workerها، خواندن Settings، مدیریت آدرس workers.dev و **تنظیم PROXY_TOKEN و ADMIN_TOKEN روی Worker انتخابی** را انجام می‌دهد. ایجاد Worker جدید، تغییر ALLOWED_HOSTS/ALLOWED_ORIGINS و آپلود کد هنوز باید از داشبورد انجام شود.
- هنگام تغییر ADMIN_TOKEN سرویس مدیریتی، توکن واردشده در فرم نیز باید به مقدار جدید تغییر داده شود؛ وگرنه درخواست بعدی 401 می‌گیرد. همچنین تغییر PROXY_TOKEN نیازمند به‌روزرسانی پروفایل Worker داخل YouTV است.
- توکن مدیریتی باید **API Token** باشد، نه Global API Key.
- اگر `ADMIN_TOKEN` و allowlist `ALLOWED_ORIGINS` تنظیم نباشند، مدیریت API عمداً غیرفعال می‌ماند.
- اگر از قبل Worker دیگری را با Wrangler Deploy کرده‌ای، فایل جدید Dashboard لازم نیست؛ برای استفاده از بخش مدیریت جدید باید سورس Worker این Patch را Deploy کنی و ADMIN_TOKEN را تنظیم کنی.

## ۵. Backup / Restore

- Settings → `Export complete backup`: فایل JSON نسخه‌دار شامل کانال‌ها، Favorites، Tags، Playlist Sources، Settings (تم، زبان، پلیر، اتصال)، نتایج اسکن، تاریخچه و پروفایل‌های Worker است.
- به‌صورت پیش‌فرض `PROXY_TOKEN` از خروجی حذف می‌شود؛ در صورت انتخاب صریح «Include Worker access tokens» به فایل وارد می‌شود، که حساس است.
- `Import` با پیش‌نمایش و انتخاب `Merge` (ادغام، حفظ داده‌های فعلی و توکن‌های حذف‌شده) یا `Replace` (جایگزینی کامل) انجام می‌شود.
- Backup قدیمی نسخه 0.3 (شیء JSON با version:1) همچنان پذیرفته می‌شود.
- Backup شامل `default.m3u8` منبع توزیع‌شده نمی‌شود، ولی کانال‌های Importشده و تنظیم فعال‌بودن آن داخل داده‌ها هستند.

## تشخیص خطا

- برای خطاهای Compile، `bun run check` و `bun run build` را اجرا کن.
- اگر Default Playlist بارگیری نشد، تب Network را بررسی کن که `default.m3u8` به‌جای HTML صفحه 404 برمی‌گرداند یا خیر. در GitHub Pages، Vite `base` باید دقیق تنظیم شود.
- در صورت خطای 403 Worker، `ALLOWED_HOSTS`، `ALLOWED_ORIGINS` و پروفایل توکن را بررسی کن.
