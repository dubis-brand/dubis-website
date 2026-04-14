# Instagram Integration — DUBIS

## Connection
- Account: @dubis.brand
- Account ID: `17841442639622598` (Vercel + Supabase env var `INSTAGRAM_ACCOUNT_ID`)
- Access Token: `INSTAGRAM_ACCESS_TOKEN` — ✅ ACTIVE (System User token, permanent, set 2026-04-13)

## Token Details
- Type: **System User Token (does NOT expire)**
- System User: dubis-publisher
- App: DUBIS Publisher
- Permissions: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `ads_read`
- Stored in: Vercel env vars + Supabase Edge Function secrets + .env.agents (as META_ACCESS_TOKEN)
- Same token used for both Instagram publishing AND Meta Ads API

## How It Works
- Content Agent generates captions + image prompts
- Images generated via Gemini/Pollinations
- Published via Instagram Graph API through Edge Function route `?type=publish-ready`
- Also cross-posts to Facebook
- Schedule: Hebrew post 10:00 UTC, English post 16:00 UTC

## Token Renewal Process
Token is permanent (System User), but if ever needed:
1. Go to Meta Business Manager → Business Settings → System Users
2. Select dubis-publisher → Generate new token
3. Select DUBIS Publisher app
4. Check ALL permissions: instagram_basic, instagram_content_publish, pages_show_list, ads_read
5. Update in THREE places:
   - Vercel env vars (INSTAGRAM_ACCESS_TOKEN + META_ACCESS_TOKEN)
   - Supabase secrets (npx supabase secrets set ... --project-ref ntzwvqtpdmvvavbhuyeb)
   - .env.agents (META_ACCESS_TOKEN)
6. NOTE: Generating new token invalidates the old one — update ALL locations

## History
| Date | Event |
|------|-------|
| 2026-04-13 | Switched to System User permanent token. Updated all 3 locations. |
| Pre-2026-04 | Was using User token that expired after 60 days |
