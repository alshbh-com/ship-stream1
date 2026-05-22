## نظام قراءة الباركود (Barcode Scanning System)

طلبك كبير ويغطي عدة أنظمة. سأبنيه على مراحل واضحة. الأوردرات الحالية لديها بالفعل عمود `barcode` (تسلسل رقمي صارم حسب memory)، وعمود `tracking_id`. سنبني فوق ذلك.

### المرحلة 1 — قاعدة البيانات (Supabase Migration)

جداول جديدة:
- `scan_sessions`: من بدأ الجلسة، وقت البداية/النهاية، عدد الأوردرات، الحالة (active/completed).
- `scan_session_items`: ربط الجلسة بالأوردرات (session_id, order_id, scanned_at).
- `scan_logs`: سجل كل عملية سكان (user_id, barcode, order_id, action, success, error_reason).
- `order_status_history`: تاريخ تغيير حالة كل أوردر (order_id, old_status, new_status, changed_by, changed_at, source).

لن نضيف `tracking_code` / `qr_value` جديدة — سنستخدم `barcode` و `tracking_id` الموجودين. الـ QR يُولَّد من قيمة `barcode` نفسها (لا حاجة لتخزينه).

RLS: مفتوحة للـ authenticated مثل باقي الجداول، مع التحقق من الدور في التطبيق.

### المرحلة 2 — صفحة "قراءة الباركود" `/barcode-scan`

- زر كبير "ابدأ الاسكان" → ينشئ `scan_session` جديدة ويفتح Input مركّز تلقائياً (يُعاد التركيز بعد كل سكان).
- Input ضخم RTL يستقبل من المسدس (كأنه Keyboard، Enter = إرسال).
- صوت نجاح/خطأ (Web Audio API، بدون أصول خارجية).
- جدول Live بالأوردرات الممسوحة: رقم/باركود، اسم العميل، المندوب، الحالة، المبلغ، المدينة، زر حذف من القائمة.
- Counter حي + Toast لكل عملية.
- منع التكرار، منع الملغية/المسلمة مسبقاً، التحقق من وجود الأوردر.
- زر "انتهيت" → يفتح Dialog الـ Bulk Actions.

### المرحلة 3 — Bulk Actions Dialog

- تغيير الحالة (Select من `order_statuses` الموجودة + الحالات المطلوبة).
- تعيين/إزالة مندوب.
- إقفال الأوردرات (`is_closed = true`).
- طباعة فواتير/ملصقات جماعية (يفتح صفحة طباعة بكل الأوردرات).
- تصدير Excel (exceljs الموجود) و PDF (jspdf).
- حذف من القائمة الحالية (إزالة من السيشن فقط).

كل تغيير حالة:
1. يحدّث `orders.status_id`.
2. يُسجَّل في `order_status_history`.
3. يُسجَّل في `scan_logs`.
4. يُنهي السيشن بعد التطبيق.

### المرحلة 4 — Realtime

اشتراك على `orders` و `scan_sessions` عبر Supabase Realtime channel — أي تحديث يظهر فوراً في صفحة السكان وقوائم الأوردرات المفتوحة.

### المرحلة 5 — Barcode/QR في الأوردر والفاتورة

- في صفحة تفاصيل الأوردر: عرض Barcode + QR (jsbarcode + qrcode.react).
- في الملصق (PrintSticker الموجود) و فاتورة الطباعة: إضافة QR إلى جانب الباركود الحالي.
- زر "طباعة باركود" في صفحة الأوردرات.

### المكتبات المضافة

`jsbarcode`, `qrcode`, `react-qr-code`.

### الراوت والقائمة

إضافة `/barcode-scan` في `App.tsx` وفي `AppSidebar` تحت قسم العمليات.

### ملاحظات

- العمود `barcode` يبقى التسلسل الرقمي الصارم (1, 2, 3...) حسب ذاكرة المشروع — لن نغيّره.
- الـ QR يُولَّد من `barcode` فقط؛ المسح يبحث عن `barcode = scanned_value` أو `tracking_id = scanned_value`.
- لو وُجدت `partial_amount` أو `shipping_paid` ستُحفظ كما هي عند التغيير الجماعي للحالة.

هل أبدأ التنفيذ بهذا المخطط؟