# YouTV v0.33.0 — تکمیل مسیر بازنویسی HLS

این نسخه از یک Patch واحد استفاده می‌کند. فایل Worker جداگانه لازم نیست؛ دکمه‌های «کپی کد Worker» و «دانلود کد» فایل `apps/web/public/dashboard-worker.mjs` را که Build خودکار تولید می‌کند تحویل می‌دهند.

## تغییرات

- بازنویسی URI فقط در تگ‌های شناخته‌شده HLS، شامل Master/Media، URI کلید AES، Map، LL-HLS Part/Preload، Rendition-Report، Image Playlist و Prefetch.
- اصلاح تگ‌های HLS با `#` حذف‌شده، مانند Manifest تلوبیون.
- جایگزینی `EXT-X-DEFINE:NAME/VALUE`، `QUERYPARAM` و `IMPORT` و انتقال محدود متغیرهای Master به Media Playlistهای تو‌در‌تو.
- انتقال پارامترهای `_HLS_msn`، `_HLS_part` و `_HLS_skip` از آدرس Worker به آدرس upstream.
- پشتیبانی از `SERVER-URI` و Content Steering JSON با حفظ دامنه Worker برای CDNهای جایگزین.
- بازنویسی URL رسانه‌های داخل فهرست JSON از نوع HLS Interstitial Asset List.
- امکان انتخاب «پایدار» یا «کم‌تأخیر» در تنظیمات پلیر؛ پیش‌فرض همچنان «پایدار» است.
- حفاظت از IP مستقیم/خصوصی، نامعتبر بودن schemeهای خطرناک و اندازه داده‌های ورودی.
- تنظیم `WORKER_RELEASE` و خروجی عمومی Worker روی v0.33.0.

## نصب

در ریشه پروژه روی مک:

```bash
cd /Users/more/dev/youtv
PATCH="$HOME/Downloads/YouTV-v0.32.0-to-v0.33.0.patch"
git apply --check "$PATCH" || exit 1
git apply "$PATCH" || exit 1
bun run check && bun run test && bun run build || exit 1
cmp apps/worker/dashboard-worker.mjs apps/web/public/dashboard-worker.mjs || exit 1
git add -A -- apps/worker apps/web/src apps/web/public/dashboard-worker.mjs apps/web/package.json packages/shared/src apps/worker/package.json docs/UPGRADE-v0.33.fa.md
git diff --cached --check || exit 1
git diff --cached --stat
# پس از بررسی فایل‌های stage شده:
git commit -m "feat: complete HLS proxy URI and low-latency support"
git push origin main
```

**مهم:** این Patch نیازمند سورس v0.32 مطابق نسخه مبنای Patch است. اگر `git apply --check` خطا داد، از `--reject`، `--force` یا `git restore` استفاده نکن. همچنین تغییر شخصی `apps/web/public/sources/Playlist.m3u` را Stage نکن.

## Deploy

بعد از انتشار GitHub Pages، بخش «مدیریت پروکسی» را باز کن و از همان‌جا کد v0.33.0 را کپی کن. سپس در Cloudflare Worker موجود از Edit code استفاده کن و Deploy بزن. `https://<worker>.workers.dev/health` باید `version: "0.33.0"` برگرداند.

## محدودیت‌های باقی‌مانده

Worker مجوز DRM، دسترسی جغرافیایی، توکن‌های منقضی‌شده یا مسدودسازی IP سرور را رفع نمی‌کند. این اصلاحات بازنویسی استاندارد HLS را بهبود می‌دهند، اما پشتیبانی از DRM وابسته به مرورگر، سیستم‌عامل و مجوز سرویس است. اجرای end-to-end استریم‌های زنده از شبکه ایران و آزمایش فیزیکی Safari/iOS همچنان مورد نیاز است.
