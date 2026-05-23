---
name: deploy
description: Deploy DUBIS website changes — branch first, Preview review, then merge to main
---

# Deploy DUBIS — Branch-Preview-Merge workflow

> **The rule (post 2026-05-23, after the Hila II catastrophe):** NEVER push directly to `main` for customer-facing code changes. ALWAYS branch first, push to get a Vercel Preview URL, share the URL with oren for review, merge only after approval. Push-to-main = ship-to-customer's-wallet — that's how the 6 stuck PayPal captures + 2 site outages happened during 2026-05-21/22.

## Three deployment lanes — pick the right one

| Lane | When to use | How |
|---|---|---|
| **Branch + Preview** (DEFAULT) | Any customer-facing change: UI, checkout, paypal.js, products.js, designs, copy, anything visible on dubis.net | Steps below |
| **Direct-to-main HOTFIX** | Critical bug that's actively losing money RIGHT NOW (e.g. save.js silent rejection on 2026-05-23) | Same `git push origin main` as before, but commit message MUST start with `hotfix:` and oren must be notified within the same message |
| **Memory / docs only** | Files under `memory/`, `docs/plans/`, `.claude/`, READMEs | Push direct — no Vercel build runs against these anyway |

When in doubt → branch + Preview. The 40-second overhead is cheaper than any stuck capture.

## Standard workflow (branch + Preview + merge)

1. **Branch from main**
   ```bash
   git checkout main && git pull
   git checkout -b feat/<short-kebab-description>
   ```
   Naming: `feat/...` for features, `fix/...` for bugs, `chore/...` for refactors. NEVER a date in the branch name (Vercel truncates to ~25 chars).

2. **Make + commit changes**
   ```bash
   git add <specific files — never `git add .`>
   git commit -m "..."
   ```
   Stage SPECIFIC files. `git add .` has caused secret leaks before (Gelato keys, PayPal tokens).

3. **Push to origin — Vercel auto-creates a Preview deployment**
   ```bash
   git push -u origin feat/<branch>
   ```

4. **Get the Preview URL** (40-60 sec build time)
   - Stable branch alias (RECOMMENDED for sharing — auto-updates on every push to the branch):
     `https://dubis-website-git-<branch-truncated>-dubis-brands-projects.vercel.app`
   - Vercel preview URLs have SSO protection by default. Use the MCP `get_access_to_vercel_url` to generate a 23h shareable link (`?_vercel_share=<token>`).
   - Verify build succeeded: `mcp__vercel__get_deployment` with the deployment ID. State must be `READY` before sharing.

5. **Share URL with oren + wait for approval**
   - Send him the shareable URL + 1-line description of what changed.
   - List 2-4 things to check (visible UI changes, not invisible refactors).
   - Wait for explicit `👍 / approve / merge`.

6. **If oren says "fix X"** → push another commit to the SAME branch. The Preview URL updates automatically in 40 sec. Re-send if URL needs a fresh share token.

7. **On approval → merge to main**
   ```bash
   git checkout main && git pull
   git merge feat/<branch> --no-ff -m "merge: feat/<branch> — approved by oren"
   git push origin main
   ```
   `--no-ff` preserves the branch history in the log. Vercel auto-deploys main to dubis.net in ~40 sec.

8. **Delete the merged branch** (optional cleanup)
   ```bash
   git branch -d feat/<branch>
   git push origin :feat/<branch>
   ```

## Pre-deploy checklist (applies to either lane)

- [ ] No `.key.txt`, `.env`, or `*-secret-*` files staged
- [ ] No NEW `.js` files in `/api/` (12/12 limit — shared helpers must use `_` prefix)
- [ ] No NEW `public/` directory anywhere (`.vercelignore` should catch it, but verify) — Vercel auto-detects `public/` as a static-export framework and breaks site routing. See troubleshooting.md § "Hila Catastrophe Round II" round 9.
- [ ] `vercel.json` valid JSON if modified
- [ ] Any referenced design file exists and is >200KB
- [ ] If touching `api/create-gelato-order.js` or `js/paypal.js` → re-read `memory/checkout-guardrails.md` first. 13 protection layers must all stay intact.

## Edge Function deploy (separate flow)

The Supabase Edge Function at `dubis-website/supabase/functions/agents/index.ts` doesn't go through Vercel — it deploys via Supabase CLI:

```bash
cd dubis-website
npx --yes supabase functions deploy agents --project-ref ntzwvqtpdmvvavbhuyeb
```

Or use `deploy-edge-only.bat` (clean script that doesn't auto-commit). The function code IS still in the same git repo, so it benefits from the branch-Preview review for code-review purposes — but Vercel won't run it. To smoke-test an Edge Function change, deploy it to staging-mode by passing `?type=...&dry_run=1` on the request — handlers should check that flag and short-circuit before making external API calls.

## Common deploy failures + fixes

| Symptom | Cause | Fix |
|---|---|---|
| Vercel build fails with "12 functions exceeded" | New `.js` added to `/api/` without `_` prefix | Rename to `_name.js` or fold logic into existing file with `?type=foo` |
| Preview shows 404 on root + `/designs/*.png` | New `public/` dir tripped framework auto-detect | Remove `public/`, ensure `.vercelignore` contains `public/`, re-push |
| Preview build succeeds but page shows pre-fix behavior | Browser cache | Hard-refresh (Ctrl+Shift+R). If still stale, bump `?v=` on the script tag in `index.html` |
| Preview URL returns 401 | Vercel SSO protection (default on paid teams) | Use MCP `get_access_to_vercel_url` to generate a `?_vercel_share=...` token (23h valid) |
| Push rejected with "non-fast-forward" | Branch is behind | `git pull --rebase origin <branch>` then push again |

## After-deploy verification (production deploys only)

1. Visit `https://www.dubis.net` — page renders, no console errors
2. Open product modal — color swatches + cart-add work
3. Check `https://www.dubis.net/api/cron/morning-report?type=geo` returns `{country, region, city}` from request IP
4. Boss daily report next morning should reflect any new orders correctly

## Files this skill touches
- `git` only (no direct Vercel API calls — Vercel auto-deploys on push)
- For Preview URL retrieval: Vercel MCP `list_deployments` + `get_deployment` + `get_access_to_vercel_url`

## References
- `memory/checkout-guardrails.md` — the 13 protection layers (read before touching checkout code)
- `memory/troubleshooting.md` § "Hila Catastrophe Round II" — why this workflow exists
- `memory/runbook.md` — Create a Preview deploy step-by-step
- `dubis-website/.claude/rules/vercel-constraints.md` — 12/12 function limit details
