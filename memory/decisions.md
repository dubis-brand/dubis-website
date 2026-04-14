# Architecture Decisions Log — DUBIS

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
