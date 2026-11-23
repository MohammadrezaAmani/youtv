# ارتقای YouTV از v0.21 به v0.22 — Worker و خطای پخش

## تنظیم Cloudflare Worker

در `Settings → Variables and Secrets`:

- `ALLOWED_HOSTS` باید شامل میزبان استریم واقعی باشد؛ برای iFilm `live.presstv.co.uk`، نه دامنه GitHub Pages. درصورت تغییر مسیر یا درخواست HLS به میزبان جدید، همان میزبان نیز باید جداگانه مجاز شود. از wildcard کلی استفاده نکن.
- `ALLOWED_ORIGINS` باید Origin کامل مرورگر شامل طرح باشد؛ برای نمونه `https://mohammadrezaamani.github.io` (بدون مسیر `/youtv/` و بدون slash انتهایی).
- `PROXY_TOKEN` باید Secret خصوصی و تصادفی، با حداقل ۲۴ کاراکتر باشد؛ دقیقاً همان توکن در پروفایل Worker داخل YouTV وارد شود. هر توکن منتشرشده را تعویض کن.

## عیب‌یابی در برنامه

در بخش مدیریت پروکسی، URL اصلی کانال (`https://live.presstv.co.uk/hls/ifilmfa.m3u8`) را در «تست آدرس استریم» وارد و روی «تست استریم» کنار Worker کلیک کن. خروجی:

- `Worker HTTP 403 (host_not_allowed)`: دامنه استریم در `ALLOWED_HOSTS` نیست.
- `Worker HTTP 403 (origin_not_allowed)`: آدرس سایت با `https://` در `ALLOWED_ORIGINS` ثبت نشده است.
- `Worker HTTP 401 (unauthorized)`: کلید اپ با `PROXY_TOKEN` برابر نیست.
- `Upstream HTTP 403`: Worker به مبدأ رسیده، ولی سرور مبدأ استریم را رد کرده است؛ ممکن است محدودیت جغرافیایی، دسترسی یا سیاست مبدأ باشد.
- نتیجه `Stream reachable · HTTP 200`: آزمون HEAD/Range روی سرور اصلی موفق بود، ولی هنوز تضمینی برای دسترسی به همه Segmentهای HLS نیست؛ میزبان‌های موجود در m3u8 نیز باید مجاز باشند.

تست سلامت `/health` صرفاً روشن‌بودن Worker را نشان می‌دهد و جایگزین تست واقعی استریم نیست.

خطای مرورگر `The play() request was interrupted by a new load request` در تعویض URL / پخش خودکار یک خطای Promise منسوخ است و از این نسخه نباید به‌تنهایی وضعیت شکست قطعی ایجاد کند. خطاهای واقعی استریم، مانند HTTP 403، همچنان گزارش می‌شوند.

**هشدار Wrangler:** متغیرهای `vars` موجود در فایل `apps/worker/wrangler.jsonc` خالی هستند. اگر همان Worker را با Wrangler مجدداً Deploy کنی، تنظیمات داشبورد ممکن است بازنویسی شوند؛ برای استقرار CLI، متغیرها را در پیکربندی استقرار همان محیط مدیریت کن.
