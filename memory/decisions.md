# Architecture Decisions Log — DUBIS

## 2026-06-13 — Hebrew checkout charged in ILS (not USD) + live-rate CSP fix
**Why:** (1) `open.er-api.com` was never in the CSP `connect-src`, so the live USD→ILS fetch in `js/main.js` was silently blocked and every Hebrew shopper saw the stale `3.63` fallback. (2) oren needs the ₪ we DISPLAY to equal EXACTLY what PayPal charges — impossible while charging USD, because the ILS conversion is done by PayPal-at-confirmation or the buyer's card issuer (+FX fee), neither readable in advance.
**What:**
- CSP: whitelisted `https://open.er-api.com`; fallback `3.63`→`2.9` (last resort only).
- Single source of truth `usdToIlsCharge()` + `buildIlsBreakdown()` in `js/main.js`: product prices use the live **representative (שער יציג) rate, NO markup**, rounded to **whole shekels**; PayPal's ~3% FX spread (on converting our received ILS back to the USD we pay Gelato in) is added as a **separate, transparent fee line at checkout** (`breakdown.handling`), per oren 2026-06-13 — show the honest rate, then a visible surcharge, never a hidden markup. Every ₪ surface (product cards, cart, checkout, PayPal order, email) routes through it → display === charge to the agora. PayPal validates item_total + shipping + handling − discount === amount.value.
- `js/paypal.js`: SDK loads with `currency=ILS` for Hebrew (reloads on language toggle); PayPal order breakdown + checkout summary built from the same `buildIlsBreakdown`. English path byte-for-byte unchanged.
- `api/email/confirm-order.js`: optional `charged` block renders the receipt in the charged currency.
**Canonical accounting stays USD:** `api/orders/save.js` (USD price-validation), GA4 + Meta Pixel events all keep USD — only the PayPal transaction + customer-facing display are ILS. The PayPal order id links the ILS transaction.
**PREREQUISITE (verify before merge):** DUBIS PayPal business account must accept ILS (most accounts auto-convert to the primary balance — confirm in PayPal settings).
**KNOWN LIMITATION (follow-up):** the FBIA redirect checkout (`renderWebViewExternalHandoff` → `?action=create-paypal-order` in `create-gelato-order.js` via `_paypal.js`) still charges USD — the guarded ~500-line money/refund path was intentionally not touched in this PR.
**Margin note:** if the live API is down, the `2.9` fallback is BELOW market — Hebrew ILS charges would under-collect vs the USD we pay Gelato. Keep the fallback close to market, or wire it to `site_settings.ils_usd_rate`.

## 2026-04 — Project restructured with .claude/ rules, skills, and memory
**Why:** CLAUDE.md was 158 lines mixing brand/tech/agents. No memory between sessions.
**What:** Split into .claude/rules/ (10 path-scoped files), memory/ (persistent context), skills/ (6 workflows).
**Impact:** Claude gets relevant context only, remembers across sessions, follows consistent workflows.

## 2026-04 — Auto-content pipeline (fully autonomous)
**Why:** Manual content creation doesn't scale for 2 posts/day.
**What:** Cron → auto-content → content-run → QA → publish chain.
**Impact:** 2 posts/day (HE+EN) to Instagram + Facebook without human intervention.

## 2026-03 — Agents moved to Supabase Edge Functions
**Why:** Vercel hit 12/12 function limit. Needed more routes for agents.
**What:** All 21 agent routes → single Supabase Edge Function with ?type= routing.
**Deploy:** `npx supabase functions deploy agents --project-ref ntzwvqtpdmvvavbhuyeb`
**Impact:** Freed Vercel slots. All agent logic now in supabase/functions/agents/index.ts (3,155 lines).

## 2026-03 — Gelato replaced Printful
**Why:** Better API, global fulfillment network, competitive pricing.
**What:** create-printful-order.js → create-gelato-order.js, new COLOR_MAP, new design specs.
**Impact:** Minimum 3,600×4,200px for front designs. Files must be >200KB or Gelato silently rejects.

## 2026-03 — Webhook idempotency via webhook_events table
**Why:** Gelato sends duplicate webhooks. Orders were being processed twice.
**What:** Added webhook_events table with unique event ID. Check before processing.
**Impact:** No more duplicate order status updates.

## 2026-03 — Review request emails 7 days post-delivery
**Why:** Needed social proof / product reviews.
**What:** review_request_sent_at column on orders. Cron checks delivered orders older than 7 days.
**Impact:** Automated review collection via email.
