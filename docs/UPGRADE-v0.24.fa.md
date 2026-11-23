# YouTV v0.24 — Safari / iOS fullscreen and player overlays

این Patch روی YouTV **v0.23** اعمال می‌شود. برای این تغییر، نیاز به تغییر Cloudflare Worker نیست.

## تغییرات

- تمام‌صفحه استاندارد در مرورگرهای سازگار، و `webkitRequestFullscreen` در Safari قدیمی.
- در iPhone Safari، به‌جای تمام‌صفحه روی `<div>`، از `video.webkitEnterFullscreen()` و کنترل‌های بومی iOS استفاده می‌شود.
- خروج از تمام‌صفحه iOS با `webkitendfullscreen` شناسایی می‌شود تا دکمه و حالت پلیر به‌روز بمانند.
- نشان LIVE و تأخیر از بالای تصویر حذف شده‌اند.
- تأخیر استریم زنده پایین، کنار زمان پخش و در نوار کنترل‌ها نمایش داده می‌شود. کلیک روی مقدار تأخیر به لبه زنده بازمی‌گردد.
- در حالت پخش، نوار کنترل‌ها و نشانگر موس پس از ۲٫۲ ثانیه بی‌حرکتی مخفی می‌شوند و با حرکت/لمس دوباره ظاهر می‌شوند. بازشدن منو یا مکث باعث باقی‌ماندن کنترل‌ها می‌شود.
- پشتیبانی CSS حالت `:-webkit-full-screen` برای Safari قدیمی افزوده شده است.

## نصب

```bash
cd /Users/more/dev/youtv
git apply --check ~/Downloads/YouTV-v0.23.0-to-v0.24.0.patch
git apply ~/Downloads/YouTV-v0.23.0-to-v0.24.0.patch
bun run check
bun run test
bun run build
git add .
git commit -m 'fix: Safari iOS fullscreen and player chrome auto-hide'
git push origin main
```

## نکته iPhone

روی iPhone، WebKit اجازه نمایش یک div با کنترل‌های سفارشی در Fullscreen استاندارد را نمی‌دهد؛ بنابراین تمام‌صفحه بومی ویدئو نمایش داده می‌شود و کنترل‌های داخل YouTV در این حالت دیده نمی‌شوند. این یک محدودیت پلتفرم است، نه مشکل استریم یا Cloudflare.
