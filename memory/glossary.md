# DUBIS Glossary — Complete Decoder Ring

## Product Terms (Hebrew ↔ English)
| עברית | English | Notes |
|-------|---------|-------|
| קפוצון | Hoodie | NEVER "הודי" or "הודיז" |
| קפוצון זיפ | Zip Hoodie | NEVER "זיפ הודי" |
| חולצה | T-Shirt | |
| ארוכת שרוול | Long Sleeve | |
| כובע | Hat/Cap | |

## Slogan Products (14 active)
| # | POWER WORD | Product Type | Gender |
|---|-----------|-------------|--------|
| 1 | LIMITED | T-Shirt | Unisex |
| 2 | LOVE | T-Shirt | Unisex |
| 3 | CARDIO | Hoodie | Unisex |
| 4 | — (I survived) | T-Shirt | Unisex |
| 5 | VALUE | T-Shirt | Unisex |
| 6 | NEVER | Hoodie | Unisex |
| 7 | NAP | T-Shirt | Unisex |
| 8 | OVER | Zip Hoodie | Unisex |
| 9 | NAPPER | Long-Sleeve | Unisex |
| 10 | NAP | T-Shirt | Women |
| 11 | COFFEE | T-Shirt | Women |
| 12 | CLUB | Hoodie | Women |
| 13 | COUCH | Long-Sleeve | Women |
| 14 | SIZE | Brand slogan | — |

## Technical Terms
| Term | Meaning |
|------|---------|
| baseUid | Gelato product identifier format in products.js |
| designRef | Pointer to shared back design (avoids duplicate PNGs) |
| DARK_COLORS | Black, Navy, Charcoal, Forest Green → white text designs |
| COLOR_MAP | js object mapping color names → Gelato product codes |
| _rateLimit.js | Shared utility — underscore prefix = NOT a serverless function |
| query param routing | ?type=X inside single API file to add routes without new files |
| auto-content | Cron route creating daily HE+EN content tasks automatically |
| content-run | Route generating captions + image prompts for pending tasks |
| publish-ready | Route checking if content passed QA and is ready for Instagram |
| Edge Function | Supabase serverless function (Deno runtime) — all agents here |

## Architecture Terms
| Term | Meaning |
|------|---------|
| Hobby Plan | Vercel free tier — 12 serverless function limit |
| RLS | Row Level Security — Supabase policy per table |
| CSP | Content Security Policy — controls allowed script/style sources |
| HSTS | HTTP Strict Transport Security — forces HTTPS |

## Agent Nicknames
| Short | Full | Schedule |
|-------|------|----------|
| Boss | Boss Agent | 05:00 UTC daily |
| Content | Content Agent | 10:00+16:00 UTC daily |
| CTO | CTO Agent | Manual only |
| Email Mon | Email Monitor Agent | 06:45 UTC Cowork |
| Product | Product Agent | Manual only |
| Security | Security Agent | Mon 03:00 UTC weekly |
| Supply | Supply Agent | 00:00 UTC daily |
| Site Audit | Site Audit Agent | 06:50 UTC Cowork |
