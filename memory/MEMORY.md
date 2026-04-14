# DUBIS Memory Index
> Updated: 2026-04-09

## Project Status
- Production: https://www.dubis.net — LIVE
- Vercel: 12/12 functions (AT LIMIT)
- Agents: 8 active, all operational
- Last major change: Auto-content pipeline (2026-04-01)

## Known Issues
| Issue | Status | Notes |
|-------|--------|-------|
| INSTAGRAM_ACCESS_TOKEN expired | ⚠️ OPEN | Renew in Meta Business Manager |
| GMAIL_* env vars missing | ❌ OPEN | Email Monitor agent can't scan Gmail |
| 42 product images need regeneration | ⚠️ BACKLOG | Low priority |
| API keys in git history | ⚠️ ROTATE | Commit 18d0c2d removed them, but history exposed |

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
