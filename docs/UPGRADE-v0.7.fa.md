# ارتقای YouTV به v0.7.0

این Patch روی نسخه `v0.6.0` اعمال می‌شود و سه هدف اصلی دارد:

1. حذف کامل Focus Ringهای بصری از کنترل‌های سفارشی.
2. بازطراحی Search، Header و Sidebar.
3. یکدست‌سازی جست‌وجو در Header، صفحه دسته‌بندی‌ها و صفحه تست سیگنال.

## تغییرات مهم

- حذف حلقه‌های Focus از Input، Select، Checkbox، Radio، Slider و Search.
- افزودن `SearchBox` اختصاصی و جایگزینی جست‌وجوهای قدیمی در Header، Categories و Connectivity.
- بازطراحی Header با جست‌وجوی اصلی یک‌تکه و بدون ورودی تو در تو.
- بازطراحی Sidebar با بخش‌بندی Browse / Tools / Settings.
- بهبود چیدمان موبایل برای Header و Search.

## اعمال Patch

```bash
cd ~/Downloads/YouTV-Core-v0.3.0/youtv-core-v0.3.0

git apply --check ~/Downloads/YouTV-v0.6.0-to-v0.7.0.patch
git apply ~/Downloads/YouTV-v0.6.0-to-v0.7.0.patch

bun install
bun run check
bun run build
bun run dev
```

## نکته

این Patch عمداً Focus Ring را از کل رابط حذف می‌کند. اگر بعداً بخواهی حالت قابل‌دسترس‌تر برگردد، باید یک حالت Optional برای Focus Style اضافه شود.
