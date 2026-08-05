# Resolved Issues — DUBIS

## 2026-03 — Gelato prints wrong design ("J B" instead of DUBIS logo)
**Symptom:** Customer received garment with wrong front print.
**Root cause:** Front design file was under 200KB → Gelato silently used fallback/placeholder.
**Fix:** Regenerated front_logo_white.png at 3,600×4,200px (~500KB). Added HEAD request validation in create-gelato-order.js.
**Prevention:** Every order now validates: HTTP 200 + Content-Length ≥ 200KB for all design files.
**Commit:** Part of Gelato integration fixes.

## 2026-03 — Cart not clearing after PayPal purchase
**Symptom:** After successful payment, cart still showed items.
**Root cause:** `saveCart()` was called before `localStorage.clear()` in paypal.js success handler.
**Fix:** Reversed order — clear first, then save empty cart.
**Commit:** 34e4c7d

## 2026-03 — Duplicate webhook processing
**Symptom:** Order status updated multiple times, confusing admin dashboard.
**Root cause:** Gelato sends webhooks with retries. No dedup mechanism existed.
**Fix:** Created webhook_events table with unique event_id. Check exists before processing.
**Commit:** 9f80165

## 2026-04 — PROJECT_STATUS.md showing 11/12 but CLAUDE.md showing 12/12
**Symptom:** Claude getting conflicting information about Vercel function count.
**Root cause:** Two separate status documents not kept in sync.
**Fix:** Consolidated into single source of truth (CLAUDE.md + memory/MEMORY.md). Deleted PROJECT_STATUS.md.

## 2026-06-13 — Stale USD→ILS rate: open.er-api.com blocked by CSP
**Symptom:** Hebrew prices stuck — every shopper saw the stale 3.63 fallback; ₪ never tracked the live rate.
**Root cause:** `js/main.js` fetched `https://open.er-api.com/...` but that host was NOT in the CSP `connect-src` (`vercel.json`) → browser silently blocked every fetch → fallback used forever. Same failure mode as the 2026-06-07 Clarity block.
**Fix:** Whitelisted `https://open.er-api.com` in `connect-src`; fallback lowered 3.63→2.9 (the real June-2026 rate is ~2.92, NOT 3.6 — verify before assuming). Rate now re-fetched when checkout opens.
**Prevention:** Rule already in `.claude/rules/security.md` — every external host MUST be in the CSP in the same change. `curl -sD- https://www.dubis.net/ | grep -i content-security` to confirm.

## 2026-06-13 — Paid orders silently dropped from DB (Hila's order invisible)
**Symptom:** Hila paid (PayPal ₪357) + Gelato printed, but the order was NOT in `orders` and didn't show in "My Orders". Confirmation email DID arrive.
**Root cause (two layers):**
  1. **Frontend:** cart lines persist in localStorage with the price captured when ADDED. Catalog price had moved $21→$26; 3 of her 6 lines still carried the old $21. Customer was UNDERCHARGED, and…
  2. **Server:** `save.js` ran its price validation AFTER PayPal capture + Gelato dispatch. The $21 sent vs $26 in DB → variant-mismatch → it returned `400` and the order row was never written. The email fires after save, so it still went out. This is the mechanism behind the chronic "(restored from Gelato)" placeholder orders — every mismatch-dropped order was later reconstructed from Gelato with a fake (cost) price + lost slogan.
**Diagnosis path:** DB query showed newest order was 2026-05-22 (a "restored" placeholder) → order missing entirely. A manual backfill INSERT succeeded → ruled out the insert/RLS path. Catalog query showed prices clean ($26=$26) → the drift was frontend-vs-DB, not within the DB. The confirmation email's mixed ₪61/₪75 lines (=$21 stale / $26 current) confirmed the stale-cart-price trigger.
**Fix (two-layer, both live):**
  - **PR #2 (server):** `save.js` price checks now DETECT + LOG (`price-anomaly-saved-anyway`) but NEVER reject — a captured+dispatched order is ALWAYS persisted. Anti-fraud belongs pre-capture (stock-probe), not here.
  - **PR #3 (frontend):** `reconcileCartPrices()` re-prices every cart line from the live catalog (`getVariantPrice`) at init/renderCart/checkout/createOrder — kills both the undercharge and the mismatch at source.
**Recovery:** Hila's order manually backfilled to `orders` (id `5f54b38f…`), matched to her `user_id` + the email breakdown (6 items, $141 sub, DUBIS15 −$21.15, $119.85 total).
**Still open:** Could not pull Vercel runtime logs (MCP tool needs oren's approval) to scan for OTHER past orders dropped the same way. Worth a sweep.

## 2026-08-05 — US Last Run "לא רץ": כל מודעות ה-Cold כבויות ידנית מ-27.07
**Symptom:** הקמפיין הודלק 01.08, אחרי 4 ימים: 0 קליקים, 0 תנועה לאתר (page_views: 0 hits ל-utm us_last_run), אין חיובים. ‎spend כל-הזמנים: ₪0.31, 10 חשיפות, reach=1.
**Root cause (שתי שכבות):**
  1. ב-27.07 19:27 UTC, actor "Dubis Brand" (Ads Manager UI, לא ה-API) כיבה את כל 6 המודעות בקבוצה הקרה — בזמן שהקמפיין עוד היה PAUSED, אז לא נראה שינוי. ההדלקה ב-01.08 הדליקה קמפיין+קבוצות, אבל סטטוס מודעה מוגדר PAUSED גובר.
  2. הקבוצה היחידה שנשארה חיה — הרימרקטינג (₪15/יום) — מטרגטת Site Visitors 30d בתוך US, אבל מבקרי האתר כמעט כולם ישראלים → estimate_dau=0. אין למי להגיש.
**Diagnosis path:** ad_campaigns (spend 0.14 מסונכרן) → page_views (0 תנועה) → Meta Graph דרך Edge Function אבחון זמני (campaign-diag, הוסר) + pg_net מה-DB (הסביבה חסמה curl ישיר ל-supabase.co): effective_status של 12 המודעות + account activities עם extra_data חשפו את ה-toggle-off ואת התאריך המדויק.
**Fix:** בוצע 05.08 — כל 6 המודעות הודלקו: 3 ע"י oren ב-Ads Manager, ו-3 שנשארו מתחת לקו הגלילה (US Reel #23, US Image #23, US Reel #31 — ה-toast אמר "3 ads were updated") הודלקו דרך ה-API. אומת חי: 12/12 ACTIVE. החשבון תקין (account_status=1, אין חוב).
**Prevention:** "הקמפיין ACTIVE" לא אומר שמשהו מוגש — צריך לוודא effective_status=ACTIVE בשלוש הרמות (campaign/adset/ad) אחרי כל הדלקה. כדאי route בדיקת-בריאות שמתריע כשקמפיין active מגיש 0 חשיפות יום שלם.
