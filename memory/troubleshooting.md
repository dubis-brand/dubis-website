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
