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

## 2026-08-08 — FB campaign attribution broken: real ad traffic arrives with no UTM + null session_id
**Symptom:** Campaign `us_last_run` (meta/paid, 5–8 Aug) looked dead in attribution — only 7 UTM-tagged sessions, all 0-second bounces (some country_code=AF → Meta ad-review/preview bots). Meanwhile ~114 real visitors arrived via `l.facebook.com`/`m.facebook.com` referrer with NO utm_* and NULL session_id (FB in-app Android WebView).
**Impact:** 5 distinct FB visitors did add_to_cart (9 events) but would have shown as `(direct)` if they'd ordered — ROAS/attribution unusable. Also `campaign_daily_metrics` is EMPTY (Meta token expired → Boss agent pulls nothing, no spend data).
**Funnel found:** ~114 visitors → 5 ATC (~4.4%, fine) → 0 orders. Death zone = post-ATC inside FB in-app browser (same flow as the open FBIA-USD issue). One user clicked ATC 5x in a minute → button feedback likely invisible in WebView.
**Root cause (confirmed):** FB/IG in-app WebView runs storage in quota-0 mode — `getItem` works, `setItem` THROWS. So `dubis-sid` was never written (→ session_id null) and `dubis-attr` was never written (→ utm_* null). Bots persist storage fine, which is why only they looked attributed.
**Fix (SHIPPED 2026-08-08, same branch):**
  - In-memory fallbacks: `window.__dubisMemSid` + `__dubisMemAttr` used when storage writes throw; `dubisGetSid()` is now the single sid accessor.
  - Referrer promotion: no utm/clickid but FB/IG/TikTok/Google referrer → `utm_source=<domain>`, `utm_medium='inapp'` (inside WebView) or `'referral'`. NOT 'paid' — a bare referrer can't prove an ad click. Campaign-level credit still requires UTMs on the ad URL in Ads Manager (verify there!).
  - `dubisTrack` cookie-consent read guarded separately so a throwing localStorage can't swallow events.
  - Add-to-cart feedback rebuilt: big toast (product + count + view-cart CTA, tap opens cart), cart-icon bump, and a 1.2s duplicate-add guard (same variant → replay confirmation instead of pushing another line).
**Verified:** Playwright with setItem-throwing storage + l.facebook.com referer + Android wv UA → session_id present, attr = facebook/inapp on add_to_cart beacons; 3 rapid clicks = 1 cart line + visible toast; intentional re-add after 1.4s works.
**Still open:** confirm the ad destination URL in Ads Manager carries utm_campaign — without it campaign-level (not just source-level) attribution stays blind.
**Report:** docs/plans/FB_CAMPAIGN_ANALYSIS_2026-08-08.html
