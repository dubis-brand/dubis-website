# DUBIS Memory Index
> Updated: 2026-06-13

## Project Status
- Production: https://www.dubis.net — LIVE
- Vercel: 12/12 functions (AT LIMIT)
- Agents: 8 active, all operational
- Last major change: Hebrew checkout charged in ILS (שער יציג + transparent ~3% PayPal fee line) + order-save reliability fixes (2026-06-13)

## Known Issues
| Issue | Status | Notes |
|-------|--------|-------|
| US Last Run — 6 מודעות Cold כבויות ידנית | 🔴 ACTION | כובו ב-Ads Manager ‏27.07 בזמן שהקמפיין היה PAUSED; מאז ההדלקה (01.08) רץ רק רימרקטינג על קהל ריק (₪0.31 סה"כ). להדליק את המודעות בקבוצת US Cold. פירוט: troubleshooting.md 2026-08-05 |
| INSTAGRAM_ACCESS_TOKEN expired | ⚠️ OPEN | Renew in Meta Business Manager |
| GMAIL_* env vars missing | ❌ OPEN | Email Monitor agent can't scan Gmail |
| 42 product images need regeneration | ⚠️ BACKLOG | Low priority |
| API keys in git history | ⚠️ ROTATE | Commit 18d0c2d removed them, but history exposed |
| FBIA checkout still charges USD | ⚠️ FOLLOW-UP | ILS charging covers the SDK path only; the FB/IG in-app redirect flow (create-paypal-order) still USD. Touch the guarded money path carefully. |
| Sweep past dropped orders | ⚠️ FOLLOW-UP | save.js drop (now fixed, 2026-06-13) may have lost earlier orders. Pull Vercel logs / compare Gelato vs `orders` to recover. Needs Vercel-log MCP approval. |

## Quick Glossary
| Term | Meaning |
|------|---------|
| קפוצון | Hoodie (NEVER "הודי") |
| Edge Function | supabase/functions/agents/index.ts — all agent routes |
| Boss Agent | Daily report 05:00 UTC → Supabase daily_snapshots |
| Content Agent | 2 posts/day (HE 10:00 + EN 16:00 UTC) |
| Gelato | Print-on-demand partner — API integration |
| POWER WORD | Huge text in slogan typography (3-5x larger) |
| COLOR_MAP | Color name → Gelato code in create-gelato-order.js |
| auto-content | Cron route that creates daily content tasks automatically |
| baseUid | Gelato product identifier in products.js |
| designRef | Cross-reference to shared back design between products |

## Key People
| Who | Role |
|-----|------|
| **oren** | Owner, admin, sole operator |
| **dubis.brand@gmail.com** | Admin account, Supabase auth |

## Active Projects
→ Details: memory/decisions.md

## Integration Notes
→ memory/integrations/gelato.md
→ memory/integrations/paypal.md
→ memory/integrations/instagram.md

## Troubleshooting Log
→ memory/troubleshooting.md
