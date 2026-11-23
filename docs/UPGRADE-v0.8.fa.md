# ارتقا به YouTV v0.8.0

## تغییرات این نسخه

- بازطراحی هدر و سایدبار در سبک نزدیک‌تر به داشبورد نمونه
- انتقال سایدبار به سمت راست در دسکتاپ
- بهبود حالت بسته‌ی سایدبار
- حذف متن‌های اضافه در هدر و صفحه پخش
- Auto-hide واقعی برای کنترل‌های پایین پلیر
- حذف متن «برای شروع، پخش را اجرا و دکمه ضبط را بزنید.»
- قابل دانلود شدن فایل‌های Worker از داخل کلاینت:
  - `dashboard-worker.mjs`
  - `wrangler.worker.jsonc`

## اعمال Patch

```bash
cd ~/Downloads/YouTV-Core-v0.3.0/youtv-core-v0.3.0

git apply --check ~/Downloads/YouTV-v0.7.0-to-v0.8.0.patch
git apply ~/Downloads/YouTV-v0.7.0-to-v0.8.0.patch

bun install
bun run check
bun run build
bun run dev
```
