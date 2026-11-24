# YouTV v0.29 — پشتیبانی از منابع HTTP در وب‌سایت HTTPS

برای استریم‌های HTTP، آدرس اصلی `http://...` را به HTTPS تغییر ندهید؛ این کار تنها زمانی درست است که سرور واقعاً HTTPS داشته باشد. مرورگر در `https://mohammadrezaamani.github.io/youtv/` اجازه دریافت مستقیم بسیاری از منابع HTTP را نمی‌دهد. YouTV به‌طور خودکار منابع HTTP را از طریق **Cloudflare Worker با آدرس HTTPS** دریافت می‌کند.

- مسیر انتخابی Proxy و Auto برای استریم HTTPS همچنان مطابق تنظیمات قبلی است. حالت Direct برای یک منبع HTTP روی سایت HTTPS قابل اجرا نیست؛ با Worker فعال، آن منبع به‌صورت خودکار پروکسی می‌شود.
- Import و Refresh فایل‌های `.m3u` با HTTP و دریافت Teletext با HTTP نیز از Worker عبور می‌کنند. نشانی واقعی در کتابخانه تغییری نمی‌کند.
- هنگام پایش، برای HTTP روی HTTPS به‌جای درخواست مستقیم، `/probe` Worker استفاده می‌شود. اگر Worker تنظیم نشده باشد نتیجه نامشخص است؛ HTTP بودن به‌تنهایی به معنی قطع بودن شبکه نیست.
- در تنظیمات پروکسی، Worker باید `https://...workers.dev` باشد. برای Worker دارای `PROXY_TOKEN` کلید را در فرانت‌اند تعریف کنید؛ بدون آن، کلید اجباری نیست.
- محدودیت Cloudflare: `fetch()` داخل Worker نمی‌تواند مستقیماً به آدرس‌های IP (مثلاً `http://1.2.3.4:8080/live.m3u8`) متصل شود. برای این منابع به یک پروکسی HTTPS مستقل با پشتیبانی IP و کنترل SSRF نیاز است. IPهای خصوصی و لوکال نیز همچنان مسدودند.

## نصب

```bash
cd /Users/more/dev/youtv
git apply --check ~/Downloads/YouTV-v0.28.0-to-v0.29.0.patch
git apply ~/Downloads/YouTV-v0.28.0-to-v0.29.0.patch
bun run check
bun run test
bun run build
```

تنها برای دریافت پیام خطای واضح‌تر در Worker باید فایل `apps/worker/dashboard-worker.mjs` جدید را روی Worker Cloudflare نیز Deploy کنید. عبور دادن HTTP از طریق Worker فعلی v0.25 برای دامنه‌های عمومی از قبل پشتیبانی می‌شد؛ بنابراین در بیشتر موارد بروزرسانی فرانت‌اند کافی است.
