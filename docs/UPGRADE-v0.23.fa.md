# راهنمای ارتقای YouTV به v0.23 — پشتیبانی از `*` و پروکسی بدون توکن

## مشکل نسخه قبلی

نسخه قبلی `ALLOWED_HOSTS=*` را فقط به‌عنوان متن معمولی می‌دید و برای هر دامنه دیگری `403 host_not_allowed` برمی‌گرداند. از طرف دیگر `PROXY_TOKEN` در Worker و فرم افزودن Worker اجباری بود. تغییر Variable در داشبورد به‌تنهایی **کد قدیمی Worker را اصلاح نمی‌کند**.

## نصب و Deploy

1. Patch `YouTV-v0.22.0-to-v0.23.0.patch` را با `git apply --check` و سپس `git apply` روی ریشه مخزن نصب کن.
2. اگر Worker را از داخل Cloudflare Dashboard ساخته‌ای (همان `round-fog-...workers.dev`)، در **Workers & Pages → Worker → Edit code** محتویات قبلی `index.js` را **کامل** با نسخه جدید `apps/worker/dashboard-worker.mjs` جایگزین و **Deploy** کن. **Push به GitHub Pages به‌تنهایی Worker ساخته‌شده در داشبورد را آپدیت نمی‌کند.** فایل آماده همچنین در `apps/web/public/dashboard-worker.mjs` برای دانلود از سایت قرار دارد.
3. اگر با Wrangler همان Worker را منتشر می‌کنی، در فایل `apps/worker/wrangler.jsonc` نام (`name`) را به نام واقعی Worker خودت تغییر بده و سپس `bun run worker:deploy` اجرا کن؛ در غیر این صورت Worker دیگری ایجاد می‌شود. پیکربندی شامل `keep_vars: true` است تا مقادیر تنظیم‌شده در داشبورد حفظ شوند.
4. در Cloudflare → Settings → Variables and Secrets: `ALLOWED_HOSTS` را `*` قرار بده یا کاملاً پاک کن. `ALLOWED_ORIGINS` برای سایت اصلی و localhost ضروری نیست؛ برای دامنه‌های دیگری که خودت می‌خواهی اضافه کنی، Origin کامل با پروتکل `https://` و جداشده با `,` وارد کن. مقادیر دیگر اضافه می‌شوند و جای مقادیر پیش‌فرض را نمی‌گیرند.
5. **بدون رمز:** متغیر/Secret به نام `PROXY_TOKEN` را در Cloudflare **حذف** کن؛ سپس در YouTV → Proxy Manager مقدار توکن همان Worker را **خالی ذخیره کن**. **با رمز:** یک Secret قوی `PROXY_TOKEN` تعریف کن و همان را در YouTV وارد کن. وجود متغیر با مقدار غیرخالی همیشه احراز هویت را فعال می‌کند.
6. پس از Deploy از `/capabilities` چک کن `authentication` برابر `none` (بدون Secret) یا `query-token` (با Secret) باشد؛ `/health` نسخه `0.23.0` را برمی‌گرداند. سپس از بخش «تست استریم» وضعیت مبدأ را بررسی کن.

## نمونه‌های بررسی

در نبود توکن:

```bash
curl -i 'https://YOUR-WORKER.workers.dev/health'
curl -i 'https://YOUR-WORKER.workers.dev/capabilities'
curl -i 'https://YOUR-WORKER.workers.dev/probe?url=https%3A%2F%2Flive.presstv.co.uk%2Fhls%2Fifilmfa.m3u8'
```

اگر پاسخ `/probe` مقدار `ok:false` و `status:403` داشت یعنی **سرور اصلی استریم** جواب 403 داده، نه فیلتر دامنه Worker. خطای مستقیم `403 host_not_allowed` به معنی Worker قدیمی یا Allowlist محدودشده است. URLهای `proxy` نیز باید `/proxy?url=...` بدون `key` باشند وقتی توکنی تعریف نشده است.

## محدودیت‌های امنیتی

`*` فقط میزبان‌های DNS عمومی را مجاز می‌کند؛ اتصال مستقیم به IP، میزبان محلی، `.internal`، `.local` و پروتکل‌های غیراز HTTP(S) رد می‌شود. رفتار بدون توکن به معنی سرویس عمومی است و هرکس آدرس Worker را بداند می‌تواند از سهمیه و ترافیک آن استفاده کند. محدودیت‌های مبدأ، مجوز پخش، Cloudflare و منطقه جغرافیایی همچنان پابرجاست. `ALLOWED_ORIGINS` **به‌تنهایی راهکار احراز هویت نیست**، زیرا کلاینت‌های غیرمرورگری می‌توانند Origin را جعل یا حذف کنند.
