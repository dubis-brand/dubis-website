/* DUBIS admin — English layer (2026-08-01, oren request for the US workshop)
 * Zero-logic-touch translation layer: exact-match dictionary + digit-pattern
 * matching + prefix rules, applied to text nodes/attributes via a live
 * MutationObserver, so dynamically rendered tabs translate too.
 * Toggle: floating pill (bottom-left). Persistence: localStorage['dubis-admin-lang'].
 * Switching back to Hebrew reloads the page (originals are not stored).
 */
(function () {
  'use strict';

  // ---------- exact dictionary (normalized whitespace) ----------
  const D = {
    // nav / tabs
    '📋 הזמנות': '📋 Orders', '📊 אנליטיקס': '📊 Analytics', '👥 משתמשים': '👥 Users',
    '🏷️ קופונים': '🏷️ Coupons', '🛍️ מוצרים': '🛍️ Products', '⭐ ביקורות': '⭐ Reviews',
    '🤖 משימות': '🤖 Tasks', '🧠 סוכנים': '🧠 Agents', '📣 קמפיינים': '📣 Campaigns',
    '🖼 גלריה': '🖼 Gallery', '✅ תוכן לאישור': '✅ Content approval', 'התנתק': 'Log out',
    // orders
    'הזמנות פעילות': 'Active orders', 'סה״כ הכנסות': 'Total revenue', 'הכנסות היום': 'Revenue today',
    'ממתינות': 'Pending', 'בייצור': 'In production', 'נשלחו': 'Shipped',
    'הכנסות — 30 ימים אחרונים': 'Revenue — last 30 days', 'לפי סטטוס': 'By status',
    'מוצרים שנמכרו': 'Products sold', 'הכל': 'All', 'נמסרו': 'Delivered', 'בוטלו': 'Cancelled',
    'חיפוש לפי אימייל או מספר הזמנה…': 'Search by email or order number…',
    'טוען הזמנות… 🐾': 'Loading orders… 🐾', 'תאריך': 'Date', 'מס׳ הזמנה': 'Order #',
    'אימייל': 'Email', 'פריטים': 'Items', 'סטטוס': 'Status', 'סכום': 'Amount', 'מעקב': 'Tracking',
    'לא נמצאו הזמנות.': 'No orders found.',
    // US test card
    '🇺🇸 המבחן האמריקאי — המסע האחרון (01.08 → 08.09)': '🇺🇸 The US Test — The Last Run (Aug 1 → Sep 8)',
    'פסק-דין חתום מראש · 08-09.09: ‏≥10 רכישות-זרים = מרחיבים · 1-9 = ישיבת פיבוט · 0 = סגירה מסודרת של זרוע המסחר':
      'Pre-signed verdict · Sep 8-9: ≥10 stranger purchases = scale · 1-9 = pivot meeting · 0 = orderly commerce shutdown',
    '(קופון PALRAM15 = רכישת-חברים, לא נספרת בפסק-הדין)': '(PALRAM15 coupon = friendly purchase, not counted in the verdict)',
    'רכישות-זרים: —': 'Stranger purchases: —', 'קמפיין Meta': 'Meta campaign', 'הוצאת מדיה': 'Media spend',
    'ביקורים ממוקדים': 'Targeted visits', 'עגלות / קופה': 'Carts / checkout',
    '📣 קמפיינים פעילים': '📣 Active campaigns', 'טוען קמפיינים…': 'Loading campaigns…',
    // content & ROI
    '✍️ צינור תוכן': '✍️ Content pipeline', 'פורסמו': 'Published', 'ממתינים לאישור': 'Awaiting approval',
    'נדחו': 'Rejected', 'ציון QA ממוצע': 'Avg QA score', 'סה״כ פריטים': 'Total items',
    '💹 החזר על השקעה': '💹 Return on investment', 'הוצאות פרסום': 'Ad spend', 'תקציב כולל': 'Total budget',
    'קמפיינים פעילים': 'Active campaigns', 'לוח תוכן — 7 ימים הקרובים': 'Content calendar — next 7 days',
    // traffic
    '📊 סקירת תנועה באתר': '📊 Site traffic overview', 'סה״כ צפיות': 'Total views', 'צפיות היום': 'Views today',
    '30 ימים אחרונים': 'Last 30 days', 'מגמת 7 ימים': '7-day trend',
    'צפיות בעמודים — 30 ימים אחרונים': 'Page views — last 30 days',
    'העמודים הפופולריים (30 ימים)': 'Top pages (30 days)', 'עמוד': 'Page', 'צפיות': 'Views', 'נתח': 'Share',
    'מקורות תנועה': 'Traffic sources', 'מקור': 'Source', 'ביקורים': 'Visits',
    // sales
    '💰 מכירות והכנסות': '💰 Sales & revenue', 'סה״כ הזמנות': 'Total orders', 'ממוצע להזמנה': 'Avg per order',
    'ROAS (החזר על פרסום)': 'ROAS (return on ad spend)', 'המוצרים הנמכרים ביותר': 'Best-selling products',
    'מוצר': 'Product', 'כמות': 'Qty', 'הכנסה': 'Revenue', 'הזמנות לפי סטטוס': 'Orders by status',
    // marketing & engagement
    '📢 שיווק ומעורבות': '📢 Marketing & engagement', 'מנויי ניוזלטר': 'Newsletter subscribers',
    'ביקורות לקוחות': 'Customer reviews', 'דירוג ממוצע': 'Avg rating',
    'צמיחת מנויים — 30 ימים אחרונים': 'Subscriber growth — last 30 days', 'ביצועי קופונים': 'Coupon performance',
    'קוד': 'Code', 'שימושים': 'Uses', 'הנחות שניתנו': 'Discounts given',
    // reviews
    '⭐ ביקורות לקוחות': '⭐ Customer reviews', 'כל הביקורות': 'All reviews', 'ממתינות לאישור': 'Awaiting approval',
    'מאושרות': 'Approved', 'מומלצות': 'Featured', 'טוען ביקורות… ⭐': 'Loading reviews… ⭐',
    'אין ביקורות עדיין. ביקורות מלקוחות יופיעו כאן לאישור.': 'No reviews yet. Customer reviews will appear here for approval.',
    '✓ מאושר': '✓ Approved', '⏳ ממתין': '⏳ Pending', '⭐ מומלץ': '⭐ Featured',
    '✓ רכישה מאומתת': '✓ Verified purchase', '✓ אשר': '✓ Approve', '✕ בטל אישור': '✕ Unapprove',
    '⭐ הדגש': '⭐ Feature', 'בטל הדגשה': 'Unfeature', '🗑 מחק': '🗑 Delete',
    'שגיאה בעדכון ביקורת:': 'Error updating review:', 'למחוק את הביקורת הזו לצמיתות?': 'Delete this review permanently?',
    'שגיאה במחיקת ביקורת:': 'Error deleting review:',
    // tasks
    '🔄 הכל': '🔄 All', '📤 פרסום': '📤 Publishing', '⚙️ ביצוע': '⚙️ Execution', '📩 מידע': '📩 Info',
    'כל הסטטוסים': 'All statuses', 'בביצוע': 'In progress', 'ממתין לאישור': 'Awaiting approval',
    'מאושר': 'Approved', 'בוצע': 'Done', 'נדחה': 'Rejected', 'כל הסוכנים': 'All agents',
    'כל העדיפויות': 'All priorities', '🔴 קריטי': '🔴 Critical', '🟠 גבוה': '🟠 High',
    '🟡 בינוני': '🟡 Medium', '⚪ נמוך': '⚪ Low', 'חיפוש...': 'Search…',
    'הרץ משימות מאושרות לכל הסוכנים': 'Run approved tasks for all agents', '▶ הרץ סוכנים': '▶ Run agents',
    '+ הוסף משימה': '+ Add task', '⏳ לאישורך': '⏳ For your approval', '+ הוסף משימה חדשה': '+ Add a new task',
    'כותרת *': 'Title *', 'תיאור קצר וברור של המשימה': 'Short, clear task description',
    'סוכן מבצע *': 'Executing agent *', '🔧 CTO — קוד / טכני': '🔧 CTO — code / technical',
    '✍️ Content — תוכן / כתיבה': '✍️ Content — content / writing', '📣 Marketing — שיווק / קמפיינים': '📣 Marketing — campaigns',
    '🎨 Design — עיצוב / תמונות': '🎨 Design — visuals', '👤 Manual — אני מטפל': '👤 Manual — I handle it',
    'עדיפות': 'Priority', '🔴 Critical — דחוף מאוד': '🔴 Critical — very urgent', '🟠 High — גבוה': '🟠 High',
    '🟡 Medium — בינוני': '🟡 Medium', '⚪ Low — נמוך': '⚪ Low', 'קטגוריה': 'Category', '👤 ידני': '👤 Manual',
    "פיצ'ר חדש": 'New feature', '✨ פיצ׳ר חדש': '✨ New feature', '🐛 תיקון באג': '🐛 Bug fix',
    '✍️ תוכן': '✍️ Content', '🎨 עיצוב': '🎨 Design', '📣 שיווק': '📣 Marketing', '⚙️ תפעול': '⚙️ Operations',
    '📧 תובנת מייל': '📧 Email insight', 'סטטוס התחלתי': 'Initial status',
    '✅ Approved — מוכן להרצה': '✅ Approved — ready to run', 'תיאור מפורט': 'Detailed description',
    'פרטים, הנחיות, מה בדיוק צריך לעשות...': 'Details, instructions, exactly what to do…',
    'הערות / הקשר': 'Notes / context', 'לינקים רלוונטיים, הערות, סיבת המשימה...': 'Relevant links, notes, why this task…',
    'תאריך יעד (אופציונלי)': 'Due date (optional)',
    // publish / reels modal
    '📤 פרסם פוסט': '📤 Publish post', 'תצוגה מקדימה': 'Preview',
    'אין תמונה — לחץ ייצר או הזן URL': 'No image — click Generate or paste a URL',
    '🎨 מייצר תמונה...': '🎨 Generating image…', '🎨 ייצר תמונה עם AI': '🎨 Generate image with AI',
    '🎬 צור רילס': '🎬 Create a reel', '🎬 יצירת רילס עם HeyGen AI': '🎬 Create a reel with HeyGen AI',
    '📸 Talking Photo (מומלץ!)': '📸 Talking Photo (recommended!)', '🤖 אווטאר HeyGen': '🤖 HeyGen avatar',
    '📸 בחר תמונה לדמות — לחץ על תמונה מהגלריה למטה:': '📸 Pick a character image — click a gallery image below:',
    '👇 בחר תמונה מהגלריה למטה, או העלה תמונה חדשה דרך כפתור': '👇 Pick an image from the gallery below, or upload a new one via',
    'העלה תמונה': 'Upload image', 'בגלריה': 'in the gallery', 'בחר אווטאר:': 'Pick an avatar:',
    'טוען אווטארים...': 'Loading avatars…', 'סקריפט (מה הדמות תגיד):': 'Script (what the character says):',
    '✨ צור סקריפט AI': '✨ Generate AI script',
    'היי! ראיתם כבר את הקפוצון החדש שלנו?...': 'Hey! Have you seen our new hoodie yet?…',
    '~0 שניות': '~0 seconds', '🇮🇱 עברית': '🇮🇱 Hebrew', '🇺🇸 אנגלית': '🇺🇸 English', '👩 אישה': '👩 Female',
    '👨 גבר': '👨 Male', '🎤 קול אוטומטי': '🎤 Auto voice', '🎬 ייצר רילס': '🎬 Generate reel',
    '⏳ מייצר סרטון... זה לוקח 2-5 דקות': '⏳ Generating video… takes 2-5 minutes',
    '✅ השתמש ברילס הזה לפרסום': '✅ Use this reel for publishing', 'פתח בחלון חדש': 'Open in a new window',
    '📷 בחר תמונה מהגלריה': '📷 Pick from gallery', '📁 העלה תמונה': '📁 Upload image',
    'URL תמונה (ציבורי)': 'Image URL (public)', 'כיתוב הפוסט, האשטאגים...': 'Post caption, hashtags…',
    'דורש הגדרת TIKTOK_ACCESS_TOKEN': 'Requires TIKTOK_ACCESS_TOKEN', '(בקרוב)': '(coming soon)',
    '📤 פרסם': '📤 Publish', '👁 תצוגה מקדימה': '👁 Preview', '🎨 יצור תמונה AI': '🎨 Generate AI image',
    '📷 בחר מגלריה ▾': '📷 Pick from gallery ▾', 'עברית': 'Hebrew', '✏️ ערוך': '✏️ Edit', '💾 שמור': '💾 Save',
    '✕ בטל': '✕ Cancel', '✅ אשר ופרסם': '✅ Approve & publish', '❌ דחה': '❌ Reject',
    '⏳ פרסום לוקח עד 30 שניות': '⏳ Publishing takes up to 30 seconds',
    // products
    '📋 הצעות ממתינות': '📋 Pending suggestions', '👀 ממתינים לאישור ויזואלי': '👀 Awaiting visual approval',
    '+ סלוגן חדש': '+ New slogan', '📦 הכל': '📦 All', '✅ במלאי': '✅ In stock', '❌ אזל': '❌ Out of stock',
    '✨ חדשים (30 ימים)': '✨ New (30 days)', 'מבוססים': 'Established', 'כל הסוגים': 'All types',
    // agents tab
    '🧠 מבנה סוכנים': '🧠 Agent structure', '▶ הרץ כל הסוכנים': '▶ Run all agents',
    'ממתינות להרצה': 'Waiting to run', 'הושלמו השבוע': 'Completed this week', 'בתהליך': 'In progress',
    'ניהול צוות + דוח יומי': 'Team management + daily report',
    'מנהל הצוות. מרכז את כל הסוכנים, מכריע המלצות בשולחן-ההנהלה, ושולח דוח-מנהל יומי (19:30) + דוח שבועי ביום ראשון. אפשר להשיב לדוח במייל — התשובה הופכת להנחיה.':
      "Team manager. Coordinates all agents, decides board recommendations, and sends a daily manager report (19:30) + a weekly one on Sunday. Replying to the report email becomes a directive.",
    'יצירת תוכן לרשתות': 'Social content creation', '▶ הרץ': '▶ Run',
    'מבצע את התוכנית השבועית: קפשן + מוקאפ-קטלוג או תמונת-דמות אמיתית (אפס AI על בגדים). ‏QA ≥ 75 מתפרסם אוטומטית ל-IG+FB; ‏60-74 ממתין לאישורך.':
      'Executes the weekly plan: caption + catalog mockup or a real persona photo (zero AI on garments). QA ≥ 75 auto-publishes to IG+FB; 60-74 waits for your approval.',
    'מוקאפים אמיתיים': 'Real mockups', 'ניהול טכני ובאגים': 'Tech management & bugs',
    'מנתח משימות טכניות ובאגים, מייצר תוכנית יישום מפורטת בעברית (קבצים לשינוי, שלבי פיתוח, בדיקות). שומר כ-notes במשימה.':
      'Analyzes technical tasks and bugs, produces a detailed implementation plan (files to change, steps, tests). Saved as task notes.',
    'אסטרטגיה ושיווק': 'Strategy & marketing',
    'תמונות AI ועיצוב': 'AI images & design',
    'מוקאפי-קטלוג אמיתיים מ-Gelato + תמונות-דמות ICP דרך Higgsfield (try-on עם המוצר המדויק). עיצובי הדפסה נוצרים ב-canvas דטרמיניסטי — אפס AI על טקסט-בגדים.':
      'Real Gelato catalog mockups + ICP persona photos via Higgsfield (try-on with the exact product). Print designs are deterministic canvas — zero AI on garment text.',
    'שרשרת אספקה': 'Supply chain',
    'מסנכרן סטטוס הזמנות מ-Gelato (ייצור, משלוח, מסירה). רץ אוטומטית כל יום בחצות. עדכון ידני אפשרי.':
      'Syncs order status from Gelato (production, shipping, delivery). Runs nightly at midnight. Manual update available.',
    'סריקת Gmail יומית': 'Daily Gmail scan',
    'סורק את dubis.brand@gmail.com, מסנן רעש-ספקים, מנתח רעיונות שהעברת במייל (Gemini, 4 חלקים בעברית) ומזין את הדוח היומי ואת שולחן-ההנהלה. תשובה שלך לדוח = הנחיה.':
      'Scans dubis.brand@gmail.com, filters vendor noise, analyzes ideas you forwarded (Gemini, 4-part analysis) and feeds the daily report + management board. Your reply to the report = a directive.',
    'סריקת SEO/UX יומית': 'Daily SEO/UX scan',
    'סורק את dubis.net כל בוקר. בודק SEO (title, meta, OG, H1), UX (lazy loading, viewport), ומזהה הזדמנויות עסקיות חדשות.':
      'Scans dubis.net every morning. Checks SEO (title, meta, OG, H1), UX (lazy loading, viewport), and spots new business opportunities.',
    'יצירת סלוגנים ומוצרים': 'Slogans & product creation',
    'סריקת אבטחה שבועית': 'Weekly security scan', '🔍 סרוק': '🔍 Scan',
    'סורק headers אבטחה, HTTPS, מפתחות חשופים בקוד JS, מצב PayPal (sandbox/production). רץ אוטומטית כל יום שני.':
      'Scans security headers, HTTPS, exposed keys in JS, PayPal mode (sandbox/production). Runs every Monday.',
    'שני 03:00 UTC': 'Mon 03:00 UTC', 'רילים + טיקטוק יומי': 'Reels + daily TikTok',
    'טיקטוק יומי מבנק-הרילים (רוטציית least-recently-posted, ‏22 מוצרים) דרך GitHub Actions + Late.com. הפקת רילים חדשים + פרקי הסיטקום רצה בסשן הראשי דרך Higgsfield (פרק/שבוע).':
      'Daily TikTok from the reel bank (least-recently-posted rotation, 22 products) via GitHub Actions + Late.com. New reels + sitcom episodes are produced in the main session via Higgsfield (episode/week).',
    '⏱ ריצות אחרונות': '⏱ Recent runs', 'טוען...': 'Loading…',
    // campaigns tab
    '📣 קמפיינים והוצאות': '📣 Campaigns & spend', '💱 שער': '💱 Rate', '+ קמפיין': '+ Campaign',
    'הושלמו': 'Completed', 'תקציב פרסום (₪)': 'Ad budget (₪)', 'הוצא פרסום (₪)': 'Ad spend (₪)',
    'הוצאות תפעול (₪)': 'Operating costs (₪)', 'סה״כ הכל (₪)': 'Grand total (₪)', 'שער דולר': 'USD rate',
    'טוען קמפיינים...': 'Loading campaigns…', 'הוספת קמפיין חדש': 'Add a new campaign', 'פלטפורמה': 'Platform',
    'Instagram בלבד': 'Instagram only', 'Facebook בלבד': 'Facebook only', 'מטרה': 'Objective',
    'Reach / מודעות': 'Reach / awareness', 'Sales / המרות': 'Sales / conversions', 'תקציב': 'Budget',
    'מטבע': 'Currency', 'משך (ימים)': 'Duration (days)', 'קהל יעד': 'Target audience',
    'תאריך התחלה': 'Start date', 'אמצעי תשלום': 'Payment method', 'הערות': 'Notes',
    'שמור קמפיין': 'Save campaign', 'ביטול': 'Cancel', '🔧 הוספת הוצאה תפעולית': '🔧 Add an operating cost',
    'שירות / ספק': 'Service / vendor', 'שמור הוצאה': 'Save cost',
    // gallery
    '🖼 גלריית תמונות DUBIS': '🖼 DUBIS image gallery', 'כל המוצרים': 'All products', '✅ מאושרות': '✅ Approved',
    '⏳ ממתינות': '⏳ Pending', '🎨 ייצור תמונה חדשה': '🎨 Generate a new image', '🚀 ייצור אצווה': '🚀 Batch generation',
    'טוען גלריה...': 'Loading gallery…', 'מוצר *': 'Product *', 'סצנה': 'Scene', '🏙 רחוב אירופאי': '🏙 European street',
    '🏠 בית נעים': '🏠 Cozy home', '📸 סטודיו': '📸 Studio', '🌿 טבע': '🌿 Nature', '☕ בית קפה': '☕ Café',
    '🌆 אורבני': '🌆 Urban', 'דמות': 'Persona', '👨‍🦰 גבר גדול': '👨‍🦰 Big guy', '👩‍🦱 אישה בגוף מלא': '👩‍🦱 Full-figured woman',
    '👫 זוג': '👫 Couple', '🧔 גבר מבוגר': '🧔 Older man', 'צבע': 'Color', '🎨 ייצור': '🎨 Generate',
    // content approval
    '✅ תוכן ממתין לאישור': '✅ Content awaiting approval', 'רענן': 'Refresh', 'טוען תוכן...': 'Loading content…',
    'אין תוכן ממתין לאישור': 'No content awaiting approval',
    // gelato tools
    'חינם · לא נשלח לייצור · רק מוקאפ': 'Free · not sent to production · mockup only',
    'בחר מוצר קודם': 'Pick a product first', 'מידה': 'Size', 'כתובת יעד (לבדיקת facility)': 'Destination (facility check)',
    '🇮🇱 ישראל (רמת יוחנן)': '🇮🇱 Israel (Ramat Yohanan)',
    '👁 תצוגה מקדימה (מה הלקוח רואה באתר)': '👁 Preview (what the customer sees on the site)',
    '✓ צור Draft Order (חינם)': '✓ Create a Draft Order (free)', 'תוצאה אחרונה:': 'Last result:',
    '💡 איך זה עובד:': '💡 How it works:',
    'Draft order נוצר ב-Gelato ללא חיוב וללא ייצור.': 'A draft order is created in Gelato with no charge and no production.',
    'התגובה תציג את מיקום ה-facility שבו Gelato תייצר (לראות שזה באמת מיוצר ב-US עבור לקוחות אמריקאים).':
      'The response shows which facility Gelato would print at (verify it really prints in the US for US customers).',
    'אחרי יצירת ה-draft, תוכל לראות את המוקאפ ב-': 'After creating the draft, you can view the mockup at ',
    'Drafts נמחקים אוטומטית אחרי ~30 יום.': 'Drafts auto-delete after ~30 days.',
    // funnel
    '📊 Conversion Funnel — 30 ימים אחרונים': '📊 Conversion Funnel — last 30 days',
    'תנועה חיצונית בלבד (פילטרנו בוטים, ביקורי-עצמי, תנועת admin). זה הכלי הכי חשוב ב-4.5 חודשים הבאים — כל פעם שאתה רואה ירידה בין שלבים, זה מוקד ההתערבות הבא.':
      'External traffic only (bots, self-visits and admin traffic filtered out). Every drop between stages is the next intervention point.',
    'אורן — לסמן את הביקורים שלך כפנימיים:': 'Founder — mark your own visits as internal:',
    'תיכנס פעם אחת ל-': 'Visit once: ', 'מכל מכשיר שאתה משתמש בו. מאותו רגע כל הביקורים שלך מסומנים': 'from every device you use. From that moment your visits are tagged',
    'ולא מזהמים את ה-funnel.': 'and stop polluting the funnel.',
    '🎯 הצוואר בקבוק הגדול ביותר': '🎯 Biggest bottleneck',
    '30 ימים אחרונים — pageviews חיצוניים יומיים': 'Last 30 days — daily external pageviews',
    // errors / auth
    'אין הרשאה — רענן את הדף ונסה שוב.': 'No permission — refresh the page and try again.',
    'תוקף ההזדהות פג. רענן את הדף והתחבר מחדש.': 'Your session expired. Refresh the page and sign in again.',
    'המשתמש שלך אינו מנהל מערכת.': 'Your user is not an admin.',
    'להזמנה אין מזהה Gelato — לא ניתן לסנכרן אוטומטית.': 'This order has no Gelato ID — cannot auto-sync.',
    'GELATO_API_KEY לא מוגדר ב-Vercel env. עדכן ופרסם מחדש.': 'GELATO_API_KEY is not set in Vercel env. Update and redeploy.',
    'ה-API של Gelato לא הגיב בזמן (8 שניות). נסה שוב בעוד דקה.': 'Gelato API timed out (8s). Try again in a minute.',
    'הזמנה לא נמצאה ב-Gelato (404). ייתכן שמזהה ההזמנה שגוי.': 'Order not found in Gelato (404). The order ID may be wrong.',
    'שגיאה בקריאה ל-Gelato API.': 'Error calling the Gelato API.',
    'ההזדהות פגה. רענן את הדף והתחבר מחדש.': 'Session expired. Refresh and sign in again.',
    'כבר מעודכן — אין שינוי ב-Gelato': 'Already up to date — no change in Gelato',
    'הקריאה ל-API פסקה אחרי 12 שניות. נסה שוב.': 'API call stopped after 12 seconds. Try again.',
    'products.js לא נטען': 'products.js failed to load', '? לא נבדק': '? Not checked', 'אזל': 'Out of stock',
    'במלאי': 'In stock', '⚠ אין נתוני עלות — הרץ sync': '⚠ No cost data — run sync',
    'ערוך מחיר פר (color, size)': 'Edit price per (color, size)', '💵 מחירים פר variant': '💵 Per-variant prices',
    'צור תמונת FRONT חדשה עם DUBIS™': 'Generate a new FRONT image with DUBIS™', '🔄 חדש': '🔄 New',
    'ראה את כל התמונות שעולות לאתר — חזית + גב לכל צבע — ואמת מול Gelato': 'See every image served to the site — front + back per color — and verify against Gelato',
    '📸 תמונות המוצר': '📸 Product images', 'צפה באתר →': 'View on site →',
    '(לחיצה כפולה להעתקה)': '(double-click to copy)',
    'שמור שינויים': 'Save changes', 'יש שינויים לא שמורים. לסגור בכל זאת?': 'You have unsaved changes. Close anyway?',
    '● שינויים לא שמורים': '● Unsaved changes', 'שומר…': 'Saving…', 'variants נשמרו': 'Variants saved',
    'נשמר — כל ה-variants עודכנו': 'Saved — all variants updated', '❌ שגיאת שמירה:': '❌ Save error:',
    'אין מספיק data. צריך לחכות שהאירועים יזרמו (24-48 שעות).': 'Not enough data yet. Wait for events to flow (24-48 hours).',
    'אין הזמנות עדיין': 'No orders yet', 'ממתין': 'Pending', 'נשלח': 'Shipped', 'נמסר': 'Delivered',
    'בוטל': 'Cancelled', 'החודש': 'This month', 'אין ביקורות': 'No reviews', 'פעיל': 'Active', 'כבוי': 'Off',
    'אין קופונים': 'No coupons',
    'הקמפיין בנוי וממתין להדלקה — יוצא לדרך ב-01.08 (עוד': 'Campaign built and armed — launches Aug 1 (in',
    'ימים': 'days', ') · פסק-דין 08-09.09': ') · verdict Sep 8-9', 'יום': 'day', 'למבחן · נותרו': 'to the test · remaining',
    'עד 08.09': 'until Sep 8', 'המבחן הסתיים ב-08.09 — פסק-הדין על השולחן': 'Test ended Sep 8 — verdict on the table',
    '🟢 רץ': '🟢 Running', '⏸️ ממתין להדלקה': '⏸️ Armed, awaiting launch', 'הסתיים': 'Ended', 'לא נמצא': 'Not found',
    '🚧 שער יום-7: עד 07.08 נדרשים ≥200 ביקורים ממוקדים — אחרת עוצרים ומתקנים תנועה לפני ששורפים את החודש.':
      '🚧 Day-7 gate: ≥200 targeted visits required by Aug 7 — otherwise stop and fix traffic before burning the month.',
    '🚧 שער יום-7 (עד 07.08):': '🚧 Day-7 gate (by Aug 7):',
    'אין הוצאה': 'No spend', 'אין נתונים': 'No data', 'אין קמפיינים פעילים כרגע': 'No active campaigns right now',
    'קמפיין': 'Campaign', 'הוצאה עד כה': 'Spend so far', 'ימים שנותרו': 'Days left', '% נוצל': '% used',
    'ראשון': 'Sun', 'שני': 'Mon', 'שלישי': 'Tue', 'רביעי': 'Wed', 'חמישי': 'Thu', 'שישי': 'Fri', 'שבת': 'Sat',
    'פוסט': 'post', 'נוספים': 'more', 'ביקורות': 'reviews',
    'פרסום': 'Publishing', 'ביצוע': 'Execution', 'מידע': 'Info', '👁 צפה ואשר': '👁 View & approve',
    '✕ דחה': '✕ Reject', '✓ בוצע': '✓ Done', '💰 אשר הוצאה': '💰 Approve spend',
    '🤖 ירוץ אוטומטית': '🤖 Will run automatically', '✓ בוצע ידנית': '✓ Done manually',
    '⏳ ממתין להרצת סוכן': '⏳ Waiting for agent run', '👁 ראיתי': '👁 Seen', '📊 תוצר': '📊 Output',
    '📋 נתונים נוספים': '📋 More data', '✓ אשר תוכן': '✓ Approve content', '✓ סמן בוצע': '✓ Mark done',
    '↩ חזרה ל-Backlog': '↩ Back to backlog', '🤖 ירוץ אוטומטית בהרצה הבאה': '🤖 Will run on the next cycle',
    '✕ לא רלוונטי': '✕ Not relevant', '👍 אהבתי': '👍 Liked', '👎 לא מתאים': '👎 Not a fit', '💡 שמור': '💡 Keep',
    '↩ חזרה': '↩ Back', 'תאריך:': 'Date:',
    '⏳ טוען תמונה... (עד 30 שניות)': '⏳ Loading image… (up to 30s)',
    '⚠️ לא ניתן לטעון — הזן URL אחר': '⚠️ Could not load — try another URL',
    '✅ תמונה נבחרה — מוכן ליצירת רילס': '✅ Image selected — ready to create a reel',
    'אין תמונות זמינות': 'No images available', 'תמונות — גלול ◀ ▶': 'Images — scroll ◀ ▶',
    '⏳ מעלה תמונה...': '⏳ Uploading image…', '✅ תמונה הועלתה!': '✅ Image uploaded!',
    'שגיאה ביצירת תמונה:': 'Error generating image:', 'שגיאת רשת:': 'Network error:',
    'בחר קודם תמונה מהגלריה למטה (לחץ על תמונה ברשת הגלריה)': 'First pick an image from the gallery below',
    '❌ שגיאה:': '❌ Error:', '⏳ מכין תמונה...': '⏳ Preparing image…', '⏳ מעלה תמונה לאחסון...': '⏳ Uploading to storage…',
    '⏳ מעלה ל-HeyGen...': '⏳ Uploading to HeyGen…', '⏳ טוען אווטארים...': '⏳ Loading avatars…',
    '⏳ טוען קולות...': '⏳ Loading voices…', '⚠️ שגיאה בטעינת קולות': '⚠️ Error loading voices',
    'קולות (כולם)': 'Voices (all)', 'שניות': 'seconds', '✨ מייצר סקריפט...': '✨ Generating script…',
    '. קישור בביו!': '. Link in bio!', '📝 סקריפט מוכן (ערוך לפי הצורך)': '📝 Script ready (edit as needed)',
    'חובה לכתוב סקריפט': 'A script is required', 'הסקריפט ארוך מדי (מקסימום 5000 תווים)': 'Script too long (max 5000 chars)',
    'בחר אווטאר': 'Pick an avatar',
    'בחר תמונה מהגלריה למטה (לחץ על תמונה ברשת) ואז לחץ ייצר רילס': 'Pick a gallery image below, then click Generate reel',
    'השרת לא הגיב בזמן (timeout). נסה שוב.': 'Server timed out. Try again.',
    'השרת לא הגיב בזמן. נסה שוב בעוד 30 שניות.': 'Server timed out. Try again in 30 seconds.',
    'שגיאה בהעלאת תמונה:': 'Error uploading image:', '⏳ יוצר סרטון...': '⏳ Creating video…', 'שגיאה:': 'Error:',
    '✅ הסרטון מוכן! ▶️ לחץ Play לצפייה': '✅ Video ready! ▶️ Press Play to watch',
    '❌ יצירת הסרטון נכשלה': '❌ Video creation failed', '⚠️ בודק שוב...': '⚠️ Checking again…',
    'הסרטון לא נטען — לחץ 🔗 לצפייה בחלון חדש': 'Video did not load — click 🔗 to open in a new window',
    '✅ הרילס נבחר! לחץ': '✅ Reel selected! Click', 'כדי לפרסם.': 'to publish.',
    'נדרש URL של תמונה': 'An image URL is required', 'נדרש כיתוב': 'A caption is required',
    'יש לבחור לפחות פלטפורמה אחת': 'Pick at least one platform', 'מפרסם...': 'Publishing…',
    'תוצאות פרסום:\n': 'Publish results:\n', 'פורסם!\n': 'Published!\n', 'שגיאה לא ידועה': 'Unknown error',
    '✅ נשמר!': '✅ Saved!', 'אין תמונה — לחץ על': 'No image — click', 'יצור תמונה': 'Generate image', 'קודם': 'first',
    '⏳ מפרסם...': '⏳ Publishing…', 'פורסם בהצלחה!': 'Published successfully!',
    '⏳ מייצר תמונה… (עד 60 שניות)': '⏳ Generating image… (up to 60s)', 'שגיאה ביצירת תמונה': 'Image generation error',
    '✅ תמונה מוכנה!': '✅ Image ready!', '✅ תמונה נבחרה': '✅ Image selected', 'תמונות': 'images',
    'כותרת המשימה חובה': 'Task title is required', 'שומר...': 'Saving…', '⏳ מריץ 12 סוכנים...': '⏳ Running 12 agents…',
    'אין משימות': 'No tasks', 'אין משימות משויכות': 'No linked tasks', 'לאישור': 'for approval', 'משימות:': 'Tasks:',
    'עדיין לא רצו סוכנים': 'No agent runs yet', 'לא מחובר': 'Not signed in', '⏳ רץ...': '⏳ Running…', 'שגיאה': 'Error',
    'משימות עובדו': 'tasks processed', 'הושלם': 'Completed', 'אין קמפיינים עדיין': 'No campaigns yet',
    '🟢 פעיל': '🟢 Active', '✅ הסתיים': '✅ Ended', '⏸ מושהה': '⏸ Paused', 'עדכן': 'Update', 'סיים': 'End',
    'הפעל': 'Activate', 'מחק': 'Delete', 'תקציב / משך': 'Budget / duration', 'קהל': 'Audience',
    'תאריכים': 'Dates', 'עלות עד היום': 'Cost to date', 'תשלום': 'Payment', 'פעולות': 'Actions',
    'אין קמפיינים פעילים': 'No active campaigns', '+ הוסף הוצאה': '+ Add cost', 'שירות': 'Service', 'פירוט': 'Details',
    'אין הוצאות תפעוליות': 'No operating costs', 'נא למלא תקציב, משך ותאריך': 'Fill in budget, duration and date',
    'ערך לא תקין': 'Invalid value', 'נא למלא שירות וסכום': 'Fill in service and amount',
    'למחוק הוצאה זו?': 'Delete this cost?', 'שער דולר חדש (לדוגמה: 3.7):': 'New USD rate (e.g. 3.7):',
    'שער לא תקין': 'Invalid rate',
    'שחור': 'Black', 'לבן': 'White', 'כחול כהה': 'Navy', 'אפור': 'Gray', 'זית': 'Olive', "בז'": 'Beige',
    'פחם': 'Charcoal', 'חולי': 'Sand', 'ירוק יער': 'Forest Green', 'בורדו': 'Burgundy', 'קרם': 'Cream',
    'חאקי': 'Khaki', 'אפור בהיר': 'Light Gray', 'אפור כהה': 'Dark Gray',
    '⏳ טוען...': '⏳ Loading…', 'אין תמונות עדיין. לחץ': 'No images yet. Click', 'ייצור תמונה חדשה': 'Generate a new image',
    'להתחלה! 🎨': 'to start! 🎨', '✅ מאושר': '✅ Approved', 'לא ידוע': 'Unknown', '✅ אשר': '✅ Approve',
    '↩ בטל אישור': '↩ Unapprove', '📋 העתק URL': '📋 Copy URL', 'למחוק את התמונה? לא ניתן לשחזר.': 'Delete this image? Cannot be undone.',
    '✅ URL הועתק ללוח!': '✅ URL copied!', 'העתק URL:': 'Copy URL:',
    '⏳ מייצר... (עד 90 שניות)': '⏳ Generating… (up to 90s)',
    '🎨 Gemini מייצר את התמונה, אנא המתן...': '🎨 Gemini is generating the image, please wait…',
    'שגיאה ביצירה': 'Generation error', '✅ תמונה נוצרה בהצלחה!': '✅ Image generated!', 'פתח': 'Open',
    '🎨 ייצור נוספת': '🎨 Generate another', '🎨 נסה שוב': '🎨 Try again',
    'תמונות הועלו בהצלחה!': 'images uploaded!', '❌ לא הצליח להעלות תמונות - בדוק קונסול': '❌ Upload failed — check console',
    '🤖 Smart Match — תמונות מומלצות...': '🤖 Smart Match — recommended images…', 'תמונה': 'Image',
    'להריץ את כל הסוכנים?': 'Run all agents?', '⏳ מריץ...': '⏳ Running…', '✅ הסוכנים סיימו!\n': '✅ Agents finished!\n',
    'משימות': 'tasks', 'לא מחובר.': 'Not signed in.', 'ממתינים': 'Pending', 'שגיאה בטעינה:': 'Load error:',
    'תמונה שנוצרה': 'Generated image', 'קאפשן': 'Caption', 'אשר לפרסום': 'Approve for publishing', 'דחה': 'Reject',
    '...שומר': 'Saving…', 'שגיאת אימות': 'Auth error', '...מפרסם': 'Publishing…', '✅ פורסם!': '✅ Published!',
    '✅ אושר': '✅ Approved', 'שגיאה באישור:': 'Approval error:', 'לדחות את המשימה הזו?': 'Reject this task?',
    '...דוחה': 'Rejecting…', 'שגיאה בדחייה:': 'Rejection error:',
    'לייצר מחדש תמונת FRONT עם הלוגו? (עד 90 שניות)': 'Regenerate the FRONT image with the logo? (up to 90s)',
    '✅ תמונה חדשה נוצרה. רענן Ctrl+F5.': '✅ New image created. Refresh with Ctrl+F5.',
    '...מייצר': 'Generating…', 'לייצר 3 הצעות סלוגנים חדשים?': 'Generate 3 new slogan suggestions?',
    '...מייצר (עד 90 שניות)': 'Generating… (up to 90s)', 'נוצרו': 'Created',
    'הצעות סלוגנים! עבור ללשונית מוצרים לאישור.': 'slogan suggestions! Go to the Products tab to approve.',
    'שגיאה ביצירת סלוגנים:': 'Slogan generation error:', 'להריץ סריקת אבטחה?': 'Run a security scan?',
    '...סורק': 'Scanning…', '✅ אין הצעות ממתינות': '✅ No pending suggestions',
    'הצעות ממתינות לאישור — לחץ לצפייה': 'Suggestions awaiting approval — click to view',
    'הצעות ממתינות לאישור': 'Suggestions awaiting approval',
    'חולצה': 'T-shirt', 'קפוצון': 'Hoodie', 'קפוצון זיפ': 'Zip hoodie', 'ארוכת שרוול': 'Long sleeve', 'כובע': 'Cap',
    'יוניסקס': 'Unisex', 'גברים': 'Men', 'נשים': 'Women', '🎨 הצעות סלוגנים חדשים': '🎨 New slogan suggestions',
    'טיפוגרפיה': 'Typography', '✅ אשר מוצר': '✅ Approve product', '✏️ ערוך ואשר': '✏️ Edit & approve',
    'לאשר': 'Approve', 'לדחות': 'Reject', 'את המוצר?': 'this product?',
    '❌ המוצר נדחה.': '❌ Product rejected.', 'ערוך סלוגן (או השאר ריק לבטל):': 'Edit the slogan (or leave empty to cancel):',
    '✅ המוצר עודכן ואושר!': '✅ Product updated and approved!',
    '✅ אין מוצרים שממתינים לאישור ויזואלי כרגע.': '✅ No products awaiting visual approval right now.',
    'חזית': 'Front', 'גב': 'Back', '✅ אשר ופרסם באתר': '✅ Approve & publish to the site',
    '❌ דחה (פתח מחדש)': '❌ Reject (reopen)',
    'בטוח לאשר ולפרסם את המוצר באתר? תופיע ב-dubis.net תוך שניות.': 'Approve and publish this product? It goes live on dubis.net within seconds.',
    '⏳ מעבד...': '⏳ Processing…', 'הסשן האדמין שלך פג. רענן את הדף והתחבר שוב.': 'Your admin session expired. Refresh and sign in again.',
    'סיבת דחייה (לתיעוד):': 'Rejection reason (for the record):', 'מוצר לא נמצא': 'Product not found',
    '🎨 פתח את ה-Draft האמיתי ב-Gelato (להשוואה)': '🎨 Open the real Gelato draft (for comparison)',
    'אין תמונות צבע — בדוק שה-mockups נוצרו': 'No color images — check that mockups were generated',
    'בחר מוצר...': 'Pick a product…', 'אין צבעים': 'No colors', '⚠️ בחר מוצר וצבע': '⚠️ Pick a product and color',
    '⚠️ פסק זמן — נסה שוב או רענן דף': '⚠️ Timed out — try again or refresh',
    '⏳ מכין בקשה...': '⏳ Preparing request…', '⏳ שולח ל-Gelato...': '⏳ Sending to Gelato…',
    '✅ Draft נוצר. עיין בתוצאה למטה.': '✅ Draft created. See the result below.', 'כשל. ראה תוצאה.': 'Failed. See result.',
    'הבקשה נחסמה אחרי 20 שניות': 'Request blocked after 20 seconds',
    'Supabase session תקוע — רענן דף ונסה שוב': 'Supabase session stuck — refresh and try again',
    'אין session פעיל — התחבר מחדש': 'No active session — sign in again',
  };

  // ---------- digit-pattern entries (numbers replaced by #) ----------
  const P = {
    'עוד # ימים': 'in # days', 'נותרו # ימים': '# days left', '~# שניות': '~# seconds', '# שניות': '# seconds',
    'עודכן: #': 'Updated: #', 'שימושים: #': 'Uses: #', 'קולות #': 'Voices #', '⏳ מעבד... (# שניות)': '⏳ Processing… (#s)',
    '✅ שער יום-7 עבר (# ביקורים ממוקדים)': '✅ Day-7 gate passed (# targeted visits)',
    '🔴 שער יום-7 נכשל — #/200 ביקורים. לפי ההחלטה: עוצרים ומתקנים תנועה.': '🔴 Day-7 gate failed — #/200 visits. Per the decision: stop and fix traffic.',
    '# פוסט': '# post', '# נוספים': '# more', '# ביקורות': '# reviews', '# משימות': '# tasks',
    '# משימות עובדו': '# tasks processed', '⏳ מעלה # תמונות...': '⏳ Uploading # images…',
    '⏳ הועלו #': '⏳ Uploaded #', '# תמונות הועלו בהצלחה!': '# images uploaded!', '# תמונות': '# images',
    '# יום למבחן · נותרו # עד 08.09': 'day # of the test · # left until Sep 8',
  };

  // ---------- prefix rules (startsWith → replace prefix, keep the rest) ----------
  const PRE = [
    ['שגיאה בטעינה: ', 'Load error: '], ['שגיאת שרת (HTTP ', 'Server error (HTTP '],
    ['סנכרון נכשל: ', 'Sync failed: '], ['עודכן: ', 'Updated: '], ['שגיאת רשת: ', 'Network error: '],
    ['❌ שגיאה: ', '❌ Error: '], ['שגיאה: ', 'Error: '], ['מותג: ', 'Brand: '], ['הועתק: ', 'Copied: '],
    ['נוצר: ', 'Created: '], ['רכישות-זרים: ', 'Stranger purchases: '], ['⏳ מייצר ', '⏳ Generating '],
    ['✅ ייצור אצווה הסתיים: ', '✅ Batch finished: '], ['✅ מוצר #', '✅ Product #'],
    ['📸 תמונות מוצר #', '📸 Product images #'], ['🎨 פתח ', '🎨 Open '], ['להריץ את ', 'Run '],
    ['תוצאות פרסום:', 'Publish results:'], ['סריקה הושלמה!', 'Scan complete!'], ['ממצאים: ', 'Findings: '],
    ['קריטי: ', 'Critical: '], ['גבוה: ', 'High: '], ['בינוני: ', 'Medium: '], ['נמוך: ', 'Low: '],
    ['הסתיים!', 'Finished!'], ['🇺🇸 ארה"ב', '🇺🇸 USA'], ['🇺🇸 ארה', '🇺🇸 USA'],
  ];

  const HEB = /[֐-׿]/;
  let missCount = 0;

  function tr(raw) {
    if (!raw || !HEB.test(raw)) return null;
    const lead = raw.match(/^\s*/)[0], trail = raw.match(/\s*$/)[0];
    const t = raw.trim().replace(/\s+/g, ' ');
    if (D[t] !== undefined) return lead + D[t] + trail;
    // digit-pattern
    const dig = t.replace(/\d+(?:[.,]\d+)?/g, '#');
    if (P[dig] !== undefined) {
      const nums = t.match(/\d+(?:[.,]\d+)?/g) || [];
      let i = 0;
      return lead + P[dig].replace(/#/g, () => (nums[i++] ?? '#')) + trail;
    }
    // prefix rules
    for (const [he, en] of PRE) {
      if (t.startsWith(he)) {
        const rest = t.slice(he.length);
        const restTr = tr(rest);
        return lead + en + (restTr !== null ? restTr.trim() : rest) + trail;
      }
    }
    missCount++;
    return null;
  }

  const ATTRS = ['placeholder', 'title', 'aria-label'];
  function translateEl(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.parentElement && ['SCRIPT', 'STYLE'].includes(n.parentElement.tagName)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      const out = tr(n.nodeValue);
      if (out !== null) n.nodeValue = out;
    }
    const els = root.nodeType === 1 ? [root, ...root.querySelectorAll('*')] : [...root.querySelectorAll?.('*') || []];
    for (const el of els) {
      for (const a of ATTRS) {
        if (el.hasAttribute && el.hasAttribute(a)) {
          const out = tr(el.getAttribute(a));
          if (out !== null) el.setAttribute(a, out);
        }
      }
      if (el.tagName === 'INPUT' && ['button', 'submit'].includes(el.type)) {
        const out = tr(el.value);
        if (out !== null) el.value = out;
      }
    }
  }

  let observer = null;
  function enableEnglish() {
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
    document.title = 'DUBIS Admin';
    translateEl(document.body);
    observer = new MutationObserver(muts => {
      observer.disconnect();
      for (const m of muts) {
        if (m.type === 'characterData') { const o = tr(m.target.nodeValue); if (o !== null) m.target.nodeValue = o; }
        for (const n of m.addedNodes || []) {
          if (n.nodeType === 3) { const o = tr(n.nodeValue); if (o !== null) n.nodeValue = o; }
          else if (n.nodeType === 1) translateEl(n);
        }
      }
      observe();
    });
    const observe = () => observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    observe();
    // translate native dialogs line-by-line
    for (const fn of ['alert', 'confirm', 'prompt']) {
      const orig = window[fn].bind(window);
      window[fn] = (msg, ...rest) => orig(String(msg ?? '').split('\n').map(l => { const o = tr(l); return o !== null ? o : l; }).join('\n'), ...rest);
    }
    window.__adminI18n = { misses: () => missCount };
  }

  // ---------- toggle pill ----------
  function addToggle() {
    const lang = localStorage.getItem('dubis-admin-lang') || 'he';
    const pill = document.createElement('button');
    pill.id = 'admin-lang-toggle';
    pill.textContent = lang === 'en' ? 'עברית' : 'English';
    pill.style.cssText = 'position:fixed;bottom:14px;inset-inline-start:14px;z-index:99999;background:#2C2C2C;color:#C17E3A;border:1.5px solid #C17E3A;border-radius:20px;padding:6px 16px;font-family:inherit;font-size:.85rem;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.3)';
    pill.onclick = () => {
      const next = (localStorage.getItem('dubis-admin-lang') || 'he') === 'en' ? 'he' : 'en';
      localStorage.setItem('dubis-admin-lang', next);
      location.reload();
    };
    document.body.appendChild(pill);
    if (lang === 'en') enableEnglish();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addToggle);
  else addToggle();
})();
