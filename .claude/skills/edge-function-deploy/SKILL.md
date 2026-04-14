---
name: edge-function-deploy
description: Deploy the agents Edge Function to Supabase
---

# Deploy Edge Function to Supabase

Deploy the agents Edge Function after making changes to `supabase/functions/agents/index.ts`.

## Deploy Command
```bash
npx supabase functions deploy agents --project-ref ntzwvqtpdmvvavbhuyeb
```

## Pre-Deploy Checks
1. Verify TypeScript compiles without errors
2. Check that no hardcoded secrets are in the code
3. Ensure all new routes are registered in the router switch/case

## Post-Deploy Verification
1. Test a simple route: `curl https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/agents?type=tasks -H "x-agent-secret: <secret>"`
2. Check Supabase dashboard → Edge Functions → agents → Logs
3. If route was modified, test the specific route

## Rollback
Supabase Edge Functions don't have built-in rollback. If deploy breaks:
1. Revert changes in git: `git checkout -- supabase/functions/agents/index.ts`
2. Redeploy: run the deploy command again

## Note
This is separate from Vercel deployment. Edge Function changes do NOT deploy via `git push` — they require the explicit `npx supabase functions deploy` command.
