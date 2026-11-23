import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import {useYoutv} from '../stores/useYoutv';

const en = {
  home:'Home',channels:'Live TV',favorites:'Favorites',recent:'Recently watched',playlists:'Playlists',proxy:'Proxy manager',settings:'Settings',
  search:'Search your channels...', addChannel:'Add channel',importPlaylist:'Import playlist',emptyTitle:'Your TV, your channels',
  emptySubtitle:'Add a live stream or import your own IPTV playlist to get started.',all:'All channels',groups:'Groups',
  watch:'Watch',edit:'Edit',delete:'Delete',save:'Save',cancel:'Cancel',name:'Name',url:'Stream URL',logo:'Logo URL',group:'Group',
  language:'Language',country:'Country',tvgId:'EPG ID',required:'Required',invalidUrl:'Enter a valid HTTP(S) URL',
  chooseChannel:'Choose a channel',chooseSubtitle:'Your selected channel will play here.',live:'Live',stream:'Stream',favorite:'Favorite',
  addFirst:'Add your first channel',noResults:'No channels match your search.',channelsCount:'channels',
  refresh:'Refresh',playlistUrl:'Playlist URL',playlistName:'Playlist name',uploadFile:'Choose M3U / M3U8 file',
  preview:'Preview',foundChannels:'Channels discovered',import:'Import channels',urlImport:'Import from URL',fileImport:'Import file',
  importing:'Importing...',removeSource:'Remove source',removeChannels:'Also remove its channels',
  workerName:'Worker name',workerUrl:'Worker URL',accessToken:'Access token',addWorker:'Add worker',
  defaultWorker:'Default Worker',proxyMode:'Default proxy mode',direct:'Direct',automatic:'Auto fallback',viaProxy:'Proxy',
  healthCheck:'Test connection',proxyHelp:'The Worker must allow your Pages origin and each upstream hostname.',
  notConfigured:'No Worker profiles configured.',appearance:'Appearance',theme:'Theme',
  exportBackup:'Export complete backup',restoreBackup:'Restore backup',exportM3u:'Export M3U',
  clearData:'Reset local data',confirmReset:'Delete all locally saved channels, playlists and settings?',
  about:'All data stays in this browser. Clearing site storage removes it.',
  playerError:'Playback failed. Check the stream address, source availability and CORS or proxy settings.',
  tryProxy:'Try Worker',retry:'Retry playback',security:'Worker access tokens are kept only in your browser and excluded from exports.',
  back:'Back',noPlaylists:'No playlists imported yet.',noFavorite:'No favorite channels yet.',noRecent:'You have not watched any channels yet.',
  duplicates:'Duplicates are merged by exact stream URL.',deleteConfirm:'Delete this channel?', editChannel:'Edit channel',
  noWorker:'Select an enabled Worker before using proxy mode.',testOk:'Worker is reachable.',testFail:'Cannot reach Worker from this browser.',
  sourceRequiresCors:'Direct imports require CORS from the source. Use your Worker for an allowlisted source.',
  importUsingProxy:'Fetch playlist using Worker',or:'or',status:'Status',source:'Source',clearSearch:'Clear search',
  importSuccess:'Channels imported successfully.',settingsSaved:'Settings saved locally.',
  playerNote:'Playback depends on source accessibility and browser codec support.',
  resetWarning:'This cannot be undone. Export a backup first.',
  openSettings:'Open settings',copyUrl:'Copy stream URL',copySuccess:'Copied',selectProfile:'Select Worker',
  playlistImportNote:'Only channel lists can be imported here. Add a single HLS manifest as a channel.',
  active:'Active',viewChannels:'View channels',totalChannels:'Total channels',selectedMode:'Connection mode',
  testStream:'Play selected channel',selectFile:'Select local file',error:'Error',success:'Success',
  install:'Install app',madeFor:'Your private TV library',warning:'Warning',close:'Close'
};
const fa:typeof en = {
  home:'خانه',channels:'تلویزیون زنده',favorites:'علاقه‌مندی‌ها',recent:'اخیراً دیده‌شده',playlists:'پلی‌لیست‌ها',proxy:'مدیریت پروکسی',settings:'تنظیمات',
  search:'جست‌وجو در شبکه‌ها...',addChannel:'افزودن شبکه',importPlaylist:'واردکردن پلی‌لیست',emptyTitle:'تلویزیون تو، شبکه‌های تو',
  emptySubtitle:'برای شروع یک استریم زنده یا پلی‌لیست IPTV شخصی اضافه کن.',all:'همه شبکه‌ها',groups:'گروه‌ها',
  watch:'تماشا',edit:'ویرایش',delete:'حذف',save:'ذخیره',cancel:'انصراف',name:'نام',url:'آدرس استریم',logo:'آدرس لوگو',group:'دسته‌بندی',
  language:'زبان',country:'کشور',tvgId:'شناسه EPG',required:'ضروری',invalidUrl:'آدرس HTTP(S) معتبر وارد کنید',
  chooseChannel:'یک شبکه انتخاب کنید',chooseSubtitle:'شبکه انتخاب‌شده در اینجا پخش می‌شود.',live:'زنده',stream:'استریم',favorite:'علاقه‌مندی',
  addFirst:'اولین شبکه را اضافه کن',noResults:'شبکه‌ای مطابق جست‌وجو پیدا نشد.',channelsCount:'شبکه',
  refresh:'به‌روزرسانی',playlistUrl:'آدرس پلی‌لیست',playlistName:'نام پلی‌لیست',uploadFile:'انتخاب فایل M3U / M3U8',
  preview:'پیش‌نمایش',foundChannels:'شبکه‌های شناسایی‌شده',import:'واردکردن شبکه‌ها',urlImport:'واردکردن از URL',fileImport:'بارگذاری فایل',
  importing:'در حال واردکردن...',removeSource:'حذف منبع',removeChannels:'شبکه‌های منبع هم حذف شوند',
  workerName:'نام ورکر',workerUrl:'آدرس ورکر',accessToken:'توکن دسترسی',addWorker:'افزودن ورکر',
  defaultWorker:'ورکر پیش‌فرض',proxyMode:'حالت پیش‌فرض اتصال',direct:'مستقیم',automatic:'خودکار با بازگشت به پروکسی',viaProxy:'پروکسی',
  healthCheck:'تست اتصال',proxyHelp:'ورکر باید دامنه GitHub Pages شما و دامنه منبع استریم را مجاز بداند.',
  notConfigured:'هنوز ورکری اضافه نشده است.',appearance:'ظاهر',theme:'تم',
  exportBackup:'خروجی پشتیبان کامل',restoreBackup:'بازیابی پشتیبان',exportM3u:'خروجی M3U',
  clearData:'پاک‌کردن داده‌های محلی',confirmReset:'همه شبکه‌ها، پلی‌لیست‌ها و تنظیمات محلی پاک شوند؟',
  about:'اطلاعات فقط در همین مرورگر ذخیره می‌شود. با حذف داده‌های سایت، اطلاعات از بین می‌روند.',
  playerError:'پخش ناموفق بود؛ آدرس استریم، دسترسی به منبع و تنظیمات CORS یا پروکسی را بررسی کنید.',
  tryProxy:'تلاش با ورکر',retry:'تلاش دوباره',security:'توکن‌ها فقط در مرورگر ذخیره می‌شوند و در خروجی پشتیبان قرار نمی‌گیرند.',
  back:'بازگشت',noPlaylists:'هنوز پلی‌لیستی وارد نشده است.',noFavorite:'هنوز شبکه محبوبی ندارید.',noRecent:'هنوز شبکه‌ای تماشا نکرده‌اید.',
  duplicates:'شبکه‌های تکراری بر اساس URL یکسان ادغام می‌شوند.',deleteConfirm:'این شبکه حذف شود؟',editChannel:'ویرایش شبکه',
  noWorker:'پیش از فعال‌کردن پروکسی، یک ورکر فعال انتخاب کنید.',testOk:'ورکر در دسترس است.',testFail:'مرورگر به ورکر دسترسی ندارد.',
  sourceRequiresCors:'واردکردن مستقیم به CORS منبع نیاز دارد. برای منابع مجاز از Worker استفاده کنید.',
  importUsingProxy:'دریافت پلی‌لیست از طریق ورکر',or:'یا',status:'وضعیت',source:'منبع',clearSearch:'پاک‌کردن جست‌وجو',
  importSuccess:'شبکه‌ها با موفقیت وارد شدند.',settingsSaved:'تنظیمات محلی ذخیره شد.',
  playerNote:'پخش به دسترسی منبع و پشتیبانی کدک در مرورگر وابسته است.',
  resetWarning:'این عملیات قابل بازگشت نیست؛ ابتدا پشتیبان بگیرید.',
  openSettings:'بازکردن تنظیمات',copyUrl:'کپی لینک استریم',copySuccess:'کپی شد',selectProfile:'انتخاب ورکر',
  playlistImportNote:'این قسمت مخصوص لیست کانال‌ها است. فایل HLS یک شبکه را باید جداگانه اضافه کنید.',
  active:'فعال',viewChannels:'نمایش شبکه‌ها',totalChannels:'تعداد شبکه‌ها',selectedMode:'حالت اتصال',
  testStream:'پخش شبکه انتخاب‌شده',selectFile:'انتخاب فایل محلی',error:'خطا',success:'موفق',
  install:'نصب برنامه',madeFor:'کتابخانه شخصی تلویزیون شما',warning:'هشدار',close:'بستن'
};
const ar={...en,home:'الرئيسية',channels:'البث المباشر',favorites:'المفضلة',recent:'شوهد مؤخرًا',playlists:'قوائم التشغيل',proxy:'إدارة الوكيل',settings:'الإعدادات',search:'ابحث عن قناة...',addChannel:'إضافة قناة',importPlaylist:'استيراد قائمة',chooseChannel:'اختر قناة',all:'كل القنوات',save:'حفظ',cancel:'إلغاء',delete:'حذف',name:'الاسم',url:'رابط البث',group:'المجموعة',direct:'مباشر',viaProxy:'وكيل',theme:'السمة',language:'اللغة',emptyTitle:'تلفازك، قنواتك',emptySubtitle:'أضف قناة أو قائمة IPTV خاصة بك للبدء.'};
const tr={...en,home:'Ana sayfa',channels:'Canlı TV',favorites:'Favoriler',recent:'Son izlenenler',playlists:'Oynatma listeleri',proxy:'Proxy yönetimi',settings:'Ayarlar',search:'Kanal ara...',addChannel:'Kanal ekle',importPlaylist:'Liste içe aktar',chooseChannel:'Kanal seç',all:'Tüm kanallar',save:'Kaydet',cancel:'İptal',delete:'Sil',name:'Ad',url:'Yayın URL',group:'Grup',direct:'Doğrudan',viaProxy:'Proxy',theme:'Tema',language:'Dil',emptyTitle:'Televizyonun, kanalların',emptySubtitle:'Başlamak için IPTV listeni veya canlı yayınını ekle.'};
const ru={...en,home:'Главная',channels:'Прямой эфир',favorites:'Избранное',recent:'Недавно просмотрено',playlists:'Плейлисты',proxy:'Прокси',settings:'Настройки',search:'Поиск каналов...',addChannel:'Добавить канал',importPlaylist:'Импорт плейлиста',chooseChannel:'Выберите канал',all:'Все каналы',save:'Сохранить',cancel:'Отмена',delete:'Удалить',name:'Название',url:'URL потока',group:'Группа',direct:'Напрямую',viaProxy:'Прокси',theme:'Тема',language:'Язык',emptyTitle:'Ваше ТВ, ваши каналы',emptySubtitle:'Добавьте свой поток или плейлист IPTV для начала.'};
export type TranslationKey=keyof typeof en;
const settings=useYoutv.getState().settings;
void i18n.use(initReactI18next).init({lng:settings.language, fallbackLng:'en',resources:{en:{translation:en},fa:{translation:fa},ar:{translation:ar},tr:{translation:tr},ru:{translation:ru}},interpolation:{escapeValue:false}});
export default i18n;
