# YouTV v0.10 — رنگ‌بندی، اتصال هدر و انتشار Cloudflare Worker

- تم پیش‌فرض دوباره از رنگ صورتی اصلی YouTV (`--accent`) استفاده می‌کند؛ انتخاب تم‌های دیگر همچنان کار می‌کند.
- خط زیر هدر و سایه/خط عمودی لبه محتوای اصلی حذف شده‌اند؛ انحنای بالای سایدبار حفظ شده است.
- در صفحه Proxy، دکمه **کپی کد Worker** اضافه شده و مستقیم از فایل استاتیک همراه وب‌سایت می‌خواند.

## راه درست ایجاد Worker بدون ترمینال

**از Upload and deploy استفاده نکن.** آن صفحه فایل‌های استاتیک را دریافت می‌کند و برای کد JavaScript مناسب نیست.

1. در Cloudflare Dashboard به Workers & Pages و سپس Create application برو.
2. از گزینه **Create Worker / Hello World** استفاده کن؛ Worker را یک بار Deploy کن.
3. Worker ایجادشده را باز کن و **Edit code** را بزن.
4. داخل YouTV در صفحه مدیریت پروکسی، **کپی کد Worker** را بزن.
5. در ویرایشگر Cloudflare محتوای `index.js` را کامل انتخاب و با کد کپی‌شده جایگزین کن؛ سپس **Deploy** بزن.
6. در Settings > Variables and Secrets، `ALLOWED_HOSTS` و `ALLOWED_ORIGINS` و Secretهای `PROXY_TOKEN` و `ADMIN_TOKEN` را تنظیم کن. سپس URL مربوط به `workers.dev` و `PROXY_TOKEN` را در YouTV وارد کن.

دکمه «دانلود کد» صرفاً برای بازکردن فایل در یک ویرایشگر متن است؛ فایل `.mjs` را در بخش آپلود استاتیک Cloudflare نگذار.

## اعمال Patch

```bash
cd ~/Downloads/YouTV-Core-v0.3.0/youtv-core-v0.3.0

git apply --check ~/Downloads/YouTV-v0.9.0-to-v0.10.0.patch
git apply ~/Downloads/YouTV-v0.9.0-to-v0.10.0.patch

bun run check
bun run build
bun run dev
```
