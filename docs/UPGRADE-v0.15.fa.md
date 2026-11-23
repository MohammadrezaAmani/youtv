# YouTV v0.15 — اصلاح Import، پوشه‌ها و README

## اعمال Patch روی v0.14

```bash
cd ~/Downloads/YouTV-Core-v0.3.0/youtv-core-v0.3.0

git apply --check ~/Downloads/YouTV-v0.14.0-to-v0.15.0.patch
git apply ~/Downloads/YouTV-v0.14.0-to-v0.15.0.patch

bun install
bun run sources:check
bun run check
bun run test
bun run build
bun run dev
```

## ساختار منابع

```text
apps/web/public/sources/
├── README.md
├── Iran/
│   ├── README.md
│   ├── news.m3u8
│   └── Sports/
│       ├── README.md
│       └── live.m3u
└── world.m3u8
```

صفحه Playlists پوشه‌ها را به‌شکل درختی نمایش می‌دهد. با بازکردن پوشه، `README.md` همان پوشه به‌صورت Markdown امن رندر می‌شود (تیتر، فهرست، جدول، لینک، تصویر و کد). فایل‌ها مستقل از پوشه قابل فعال/غیرفعال‌کردن هستند. فایل HLS تک‌استریم نیز به‌عنوان یک کانال مستقل قابل فعال‌سازی است؛ پخش قطعات نسبی فقط زمانی ممکن است که فایل‌های ارجاع‌شده هم از همان مسیر سرو شوند.

## خطای GitHub Actions

در `apps/web/sourceCatalog.ts` از `fileURLToPath(new URL(..., import.meta.url))` استفاده نمی‌شود؛ در محیط Vitest این URL ممکن است از نوع `file:` نباشد. مسیر از ریشه واقعی Vite یا ریشه Monorepo محاسبه می‌شود.

## واردکردن منابع

- M3U بدون `#EXTM3U`، فهرست URL خالی از تگ و M3U استاندارد پذیرفته می‌شوند.
- تشخیص HLS به‌صورت مستقل انجام می‌شود.
- محدودیت مصنوعی ۱۵ مگابایت حذف شده است.
- پیش‌نمایش دستی ۵۰تایی صفحه‌بندی می‌شود و امکان دیدن همه شبکه‌ها وجود دارد؛ تعداد کانال‌های واردشدنی محدود نشده است.
- در مرورگر محدودیت طبیعی RAM/Storage باقی است؛ بدون سرور نمی‌توان ذخیره‌سازی نامحدود را تضمین کرد.

بعد از اضافه‌کردن فایل جدید در حالت Development، فهرست منابع خودکار بازخوانی می‌شود. در GitHub Pages باید Push و Build/Deploy جدید انجام شود. فایل‌های داخل `public` به‌صورت عمومی قابل دریافت‌اند؛ رمز و توکن را داخلشان قرار ندهید.

## به‌روزرسانی Worker

برای Import پلی‌لیست‌های حجیم از طریق Worker، Endpoint `/text` اکنون پاسخ را به‌صورت Stream منتقل می‌کند و محدودیت ۱۵ مگابایتی قبلی را ندارد. اگر Worker را قبلاً Deploy کرده‌ای، باید کد نسخه جدید را از داخل YouTV کپی و در ویرایشگر Cloudflare Deploy کنی، یا `bun run worker:deploy` را اجرا کنی. محدودیت حافظه و منابع Cloudflare همچنان وجود دارد؛ Proxy همچنان فقط دامنه‌های مجاز را می‌پذیرد.
