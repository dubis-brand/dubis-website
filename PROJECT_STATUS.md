# DUBIS — Project Status
> עדכון אחרון: 2026-04-01
> **עדכן קובץ זה בכל שינוי משמעותי** כדי ש-Claude Code, Cowork, וכלים אחרים יהיו מסונכרנים.

---

## 🟢 מצב כללי: PRODUCTION — פעיל
- **URL**: https://www.dubis.net
- **Repo**: github.com/dubis-brand/dubis-website (branch: `main`)
- **Hosting**: Vercel Hobby (auto-deploy מ-GitHub)
- **DB**: Supabase `ntzwvqtpdmvvavbhuyeb`
- **Payments**: PayPal
- **Print**: Gelato (API only, לא storefront)

---

## 📊 Vercel Functions: 11/12

| # | קובץ | תפקיד |
|---|------|--------|
| 1 | `api/analytics/track.js` | מעקב צפיות |
| 2 | `api/create-gelato-order.js` | יצירת הזמנה ב-Gelato |
| 3 | `api/coupons/` | ניהול קופונים |
| 4 | `api/cron/morning-report.js` | דוח בוקר יומי (05:00 UTC) |
| 5 | `api/email/confirm-order.js` | אישור הזמנה במייל |
| 6 | `api/orders/save.js` | שמירת הזמנה ב-Supabase |
| 7 | `api/webhooks/gelato.js` | webhook סטטוס הזמנה |
| 8 | `api/admin/analytics.js` | דשבורד אנליטיקס |
| 9 | `api/admin/gelato-sync.js` | סנכרון סטטוס Gelato |
| 10 | `api/admin/orders.js` | ניהול הזמנות |
| 11 | `api/admin/users.js` | ניהול משתמשים |
| — | *(slot פנוי)* | — |

**⚠️ אסור להוסיף קבצי `.js` חדשים ב-`/api/` ללא מחיקת קיים!**

---

## ☁️ Supabase Edge Functions

| Function | URL | תפקיד |
|----------|-----|--------|
| `agents` | `https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/agents` | 21 routes — agents, tasks, runs, image gen, social publish, HeyGen |

---

## 🗄️ Supabase — טבלאות

| טבלה | תפקיד | RLS |
|------|--------|-----|
| `orders` | הזמנות לקוחות | ✅ |
| `profiles` | פרופילי משתמשים (role: admin/customer) | ✅ |
| `coupons` | קופוני הנחה | ✅ |
| `page_views` | מעקב צפיות | ✅ |
| `product_prices` | עקיפות מחירים + תמונות Gelato | ✅ |
| `agent_tasks` | משימות סוכני AI | ✅ |
| `agent_runs` | ריצות סוכנים | ✅ |
| `newsletter_subscribers` | מנויי ניוזלטר | ✅ |
| `product_reviews` | ביקורות מוצרים | ✅ |
| `app_config` | קונפיגורציה כללית | ✅ |
| `webhook_events` | dedup webhooks (idempotency) | ✅ |
| `daily_snapshots` | snapshot יומי לאנליטיקס | — |

---

## 👤 משתמש אדמין
- **Email**: dubis.brand@gmail.com
- **Role**: `admin` (בטבלת `profiles`)
- **Admin panel**: https://www.dubis.net/admin

---

## 🛠️ Env Vars נדרשים

### Vercel
| משתנה | סטטוס |
|--------|--------|
| `SUPABASE_URL` | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ |
| `SUPABASE_ANON_KEY` | ✅ |
| `PAYPAL_CLIENT_ID` / `PAYPAL_SECRET` | ✅ |
| `GELATO_API_KEY` | ✅ |
| `GELATO_WEBHOOK_SECRET` | ✅ |
| `RESEND_API_KEY` | ✅ |
| `AGENT_SECRET` | ✅ |
| `CRON_SECRET` | ✅ |
| `ADMIN_EMAILS` | ✅ |
| `INSTAGRAM_ACCESS_TOKEN` | ⚠️ פג תוקף — צריך חידוש |
| `INSTAGRAM_ACCOUNT_ID` | ✅ |
| `GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN` | ❌ חסר |

### Supabase Edge Function Secrets
| משתנה | סטטוס |
|--------|--------|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` | ✅ אוטומטי |
| `GEMINI_API_KEY` | ✅ |
| `HEYGEN_API_KEY` | ✅ |
| `INSTAGRAM_ACCESS_TOKEN` | ⚠️ פג תוקף |
| `INSTAGRAM_ACCOUNT_ID` | ✅ |
| `AGENT_SECRET` | ✅ |
| `CRON_SECRET` | ✅ |
| `ADMIN_EMAILS` | ✅ |

---

## ✅ שיפורים שהושלמו (2026-04-01)

| # | שיפור | commit |
|---|-------|--------|
| ✅ | Product JSON-LD structured data (SEO) | — |
| ✅ | Cart localStorage persistence — תיקון `saveCart()` אחרי רכישה | `34e4c7d` |
| ✅ | robots.txt + sitemap.xml עם lastmod | `ed6d6c5` |
| ✅ | agents.js → Supabase Edge Function (21 routes) | `3179c3d` |
| ✅ | api/agents.js נמחק (Vercel 11/12) | `598507b` |
| ✅ | vercel.json תוקן (הסרת agents.js) | `c8eba70` |
| ✅ | RLS על app_config | migration |
| ✅ | dubis.brand@gmail.com → role=admin | SQL |
| ✅ | loadPriceOverrides() — fetch במקום createClient | `9f80165` |
| ✅ | loading=lazy על תמונות modal | `9f80165` |
| ✅ | defer ל-reviews.js + engage.js | `9f80165` |
| ✅ | Webhook idempotency (webhook_events table) | `9f80165` |
| ✅ | review_request_sent_at column on orders (Supabase migration) | migration |
| ✅ | Review request emails — 7 ימים אחרי delivery (morning cron) | `a77287c` |
| ✅ | Auto-content pipeline — route `auto-content` ב-Edge Function | `a77287c` |
| ✅ | Morning cron → auto-content → content-run (אוטונומי יומי) | `a77287c` |

---

## 📋 Backlog — עדיין לביצוע

| עדיפות | פריט | הערה |
|---------|-------|------|
| P2 | 3.4 הסרת `unsafe-inline` מ-CSP | דורש העברת 30+ onclick handlers |
| P3 | Phase 4: esbuild bundle + minify | ביצועים |
| P3 | Phase 5.1: Approval Workflow System | תשתית AI |
| P3 | Phase 5.2: Content Generation Pipeline — Approval UI באדמין | שיווק אוטומטי |
| P3 | Phase 5.3: Order Monitoring אוטומטי | תפעול |
| P4 | Phase 6.1: דפי מוצר נפרדים (SEO) | build script |
| P4 | Phase 6.2: Email Marketing Automation | |
| P4 | Instagram token renewal automation | |

---

## 🐛 בעיות ידועות

| בעיה | סטטוס |
|------|--------|
| `INSTAGRAM_ACCESS_TOKEN` פג תוקף | ⚠️ לחדש ב-Meta Business Manager |
| `GMAIL_*` env vars חסרים | ❌ Gmail scan בבוקר לא עובד |
| 42 תמונות מוצר צריכות רגנרציה | ⚠️ backlog |

---

## 🔑 קבצים מרכזיים

| קובץ | תפקיד |
|------|--------|
| `js/products.js` | קטלוג מוצרים |
| `js/main.js` | רנדור, פילטרים, עגלה |
| `js/paypal.js` | checkout + cart snapshot |
| `js/auth.js` | Supabase auth לאדמין |
| `js/reviews.js` | ביקורות לקוחות |
| `js/engage.js` | cart recovery, ניוזלטר |
| `api/create-gelato-order.js` | buildProductUid(), COLOR_MAP |
| `api/admin/orders.js` | הזמנות (מוציא cancelled מהכנסות) |
| `supabase/functions/agents/index.ts` | Edge Function — 22 routes (כולל auto-content) |
| `admin.html` | לוח ניהול |
| `vercel.json` | crons, rewrites, headers |
