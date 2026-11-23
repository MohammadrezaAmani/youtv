# YouTV v0.16 — IPTV Parser & Playback Hints

## نصب Patch (فقط روی نسخه v0.15)

```bash
cd ~/Downloads/YouTV-Core-v0.3.0/youtv-core-v0.3.0

git apply --check ~/Downloads/YouTV-v0.15.0-to-v0.16.0.patch
git apply ~/Downloads/YouTV-v0.15.0-to-v0.16.0.patch

bun install
bun run sources:check
bun run check
bun run test
bun run build
bun run dev
```

## اصلاح فایل mix.m3u

فایل آپلودشده 770 ورودی کانال دارد که 13 مورد آن شامل این قالب غیراستاندارد است:

```m3u
#EXTINF:-1,#EXTVLCOPT:http-user-agent=smartlabs
https://hls.goodgame.ru/hls/5346.m3u8
```

این خط دیگر نام کانال نیست. عنوان نمایشی از URL گرفته می‌شود (`hls.goodgame.ru · 5346`) و `smartlabs` به‌عنوان HTTP User-Agent ذخیره می‌شود. واردکردن دوباره فایل بدون حذف یا محدودکردن ورودی‌های واقعی ممکن است. نام‌های اشتباه قدیمی هم هنگام بازیابی LocalStorage ترمیم می‌شوند.

## متادیتای پشتیبانی‌شده

- `#EXTINF` با خصوصیات پیش یا پس از ویرگول؛ UTF-8 BOM و فهرست‌های فاقد `#EXTM3U`
- `tvg-id`, `tvg-name`, `tvg-logo`, `tvg-language`, `tvg-country`, `group-title`, `tvg-chno`, `radio`
- `#EXTGRP`, `#EXTALBUMARTURL`, `#EXTIMG`, `#PLAYLIST`
- `#EXTM3U x-tvg-url`, `url-tvg`, `tvg-shift`, `timeshift`
- `catchup`, `catchup-type`, `catchup-days`, `catchup-source`
- `#EXTVLCOPT` و `#KODIPROP` با نگهداری تنظیمات برای Export/Import مجدد
- `#WEBPROP` به‌عنوان متادیتا؛ اجرای regexهای اختصاصی آن در پلیر مرورگر انجام نمی‌شود
- User-Agent و Referer از `#EXTVLCOPT`, `#EXTHTTP` و URLهای pipe-style (`|User-Agent=...&Referer=...`)
- نام خالی/دستور به‌جای عنوان: عنوان جایگزین از URL واقعی، نه عنوان ساختگی
- HLS و IPTV همچنان تفکیک می‌شوند؛ `#EXT-X-PLAYLIST-TYPE` اختیاری در فایل Kodi باعث رد اشتباه IPTV نمی‌شود

در فرم ویرایش کانال یک بخش جمع‌شونده «مشخصات پیشرفته IPTV» برای EPG، شماره کانال، Radio، Catch-up، User-Agent و Referer اضافه شده است.

## ارسال هدرها در پخش

Cloudflare Worker شخصی اکنون فقط دو مقدار `User-Agent` و `Referer` را در درخواست‌های عبوری به دامنه‌های مجاز قرار می‌دهد و روی URLهای قطعات HLS هم حفظ می‌کند. برای این قابلیت **Worker را مجدداً Deploy کن** یا کد جدید `dashboard-worker.mjs` را از صفحه مدیریت پروکسی کپی و جایگزین کن.

در حالت Direct امکان اعمال دلخواه User-Agent در مرورگرهای مختلف تضمین نمی‌شود. سایر دستورات VLC/Kodi (مثل network-caching، inputstream properties و DRM) برای سازگاری قالب نگهداری می‌شوند، اما اجرای آن‌ها در پلیر مرورگر، دورزدن DRM، رمزگشایی Teletext یا Transcoding در این Patch اضافه نشده است. EPG و Catch-up به‌عنوان متادیتا ثبت می‌شوند؛ رابط جامع XMLTV / TV Guide و پخش آرشیو هنوز در این نسخه پیاده‌سازی نشده‌اند.

تنها منابع HTTP(S) می‌توانند مستقیماً توسط پلیر تحت وب پخش شوند؛ RTMP/RTSP/UDP و پروتکل‌های Kodi نیازمند Gateway/Decoder مجزا هستند.

## اعتبارسنجی

- فایل واقعی `mix.m3u`: 770 کانال، 13 تنظیم `smartlabs`، صفر نام حاوی دستور
- Export و Import مجدد 770 کانال: موفق
- Worker: انتقال هدرهای User-Agent/Referer به Manifest و قطعات HLS، رد CRLF و عدم عبور Cookie
- بررسی نحوی فایل‌های TypeScript/TSX جدید: موفق

اجرا و Build کامل با Bun در محیط ساخت حاضر تأیید نشده است؛ روی سیستم خودت `bun run check`, `bun run test`, `bun run build` را اجرا کن.
