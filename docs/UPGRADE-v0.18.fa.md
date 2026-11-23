# YouTV v0.18 — PWA و رفع زوم iOS

## ارتقا

```bash
cd ~/Downloads/YouTV-Core-v0.3.0/youtv-core-v0.3.0
git apply --check ~/Downloads/YouTV-v0.17.0-to-v0.18.0.patch
git apply ~/Downloads/YouTV-v0.17.0-to-v0.18.0.patch
bun install
bun run check
bun run test
bun run build
bun run dev
```

برای تست PWA، نسخه production را اجرا کن:

```bash
bun run --cwd apps/web preview
```

سپس در مرورگر `http://localhost:4173/` را باز کن. Service Worker عمداً در Vite dev فعال نمی‌شود تا کش توسعه باعث خطای Build و HMR نشود.

## GitHub Pages

PWA Manifest و Service Worker در Build با `VITE_BASE_PATH` مناسب تولید می‌شوند. GitHub Actions اصلی پروژه همین متغیر را برای مسیر `/REPO/` یا `/` تنظیم می‌کند. GitHub Pages باید HTTPS باشد (به‌صورت پیش‌فرض هست).

## iOS

- در Safari، از Share > Add to Home Screen استفاده کن؛ iOS مانند Chrome الزاماً Prompt نصب اختصاصی ندارد.
- برنامه را از آیکون Home Screen باز کن.
- برای جلوگیری از زوم فوکوس، Input و Textarea موبایل حداقل `16px` هستند و زوم دستی غیرفعال نشده است.
- هنگام تایپ، نوار پایین پنهان می‌شود تا زیر کیبورد نرود.
- قبل از نصب روی Home Screen یک Backup تهیه کن؛ داده‌های Safari و برنامه نصب‌شده ممکن است محیط ذخیره‌سازی جدا داشته باشند.

## رفتار آفلاین

- UI و کدهای JS/CSS و آیکون‌ها آفلاین از کش نسخه‌بندی‌شده بارگذاری می‌شوند.
- شبکه‌ها و تنظیماتی که قبلاً در IndexedDB ذخیره شده‌اند قابل مشاهده‌اند، اما پخش زنده و دریافت منابع نیاز به اینترنت دارند.
- درخواست‌های IPTV، فایل‌های M3U/M3U8، Worker، API، TS/M4S و داده‌های دارای توکن در کش اپ ذخیره نمی‌شوند.
- به‌روزرسانی اپ فقط با تأیید کاربر در Settings فعال می‌شود تا وسط پخش، صفحه Reload نشود.
