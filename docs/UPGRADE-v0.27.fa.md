# ارتقا به YouTV v0.27.0 — حذف Google DNS از مرورگر

در نسخه‌های پیشین، پس از خطای HTTP یا CORS، مرورگر درخواست‌هایی به `https://dns.google/resolve` می‌فرستاد. این آدرس در برخی شبکه‌های ایران بدون VPN قابل دسترسی نیست و باعث درخواست‌های اضافی یا تأخیر در پایش می‌شد.

در این نسخه **هیچ درخواست DNS-over-HTTPS از سمت مرورگر** به Google یا سرویس عمومی دیگری ارسال نمی‌شود. تشخیص قطعی NXDOMAIN و دامنه‌های فاقد رکورد A/AAAA صرفاً با **گزارش واقعی DNS تولیدشده در GitHub Actions** انجام می‌شود؛ این گزارش در مسیر همان وب‌سایت (`sources/_verified/dns-status.json`) منتشر و با مکانیزم موجود IndexedDB تا ۶ ساعت کش می‌شود.

- اگر دامنه در گزارش `nxdomain` یا `noAddress` باشد، خطای بررسی به «قطع» با توضیح DNS تبدیل می‌شود.
- اگر در گزارش نباشد یا گزارش در دسترس نباشد، وضعیت از نتیجه واقعی HTTP/Worker تعیین می‌شود: `Failed to fetch` طبق سیاست برنامه «قطع» و timeout یا لغو اسکن «نامشخص» است.
- برای نصب **نیازی به تغییر Cloudflare Worker** نیست و URL خارجی جدیدی در فرانت‌اند افزوده نشده است.
- بررسی DNS دسته‌ای در GitHub Actions همچنان از Resolver سیستم اجراکننده استفاده می‌کند و به Google DoH وابسته نیست.

## نصب

```bash
cd /Users/more/dev/youtv
git apply --check ~/Downloads/YouTV-v0.26.0-to-v0.27.0.patch
git apply ~/Downloads/YouTV-v0.26.0-to-v0.27.0.patch
bun run check
bun run test
bun run build
git add .
git commit -m "fix: remove browser dependency on public Google DNS"
git push origin main
```

پس از انتشار نسخه جدید GitHub Pages، در نسخه نصب‌شده PWA به‌روزرسانی برنامه را دریافت کنید؛ نسخه قدیمی JavaScript ممکن است هنوز در کش مرورگر وجود داشته باشد.
