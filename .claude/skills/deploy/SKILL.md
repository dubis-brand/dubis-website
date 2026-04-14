---
name: deploy
description: Deploy DUBIS website to Vercel production
---

# Deploy to Production

Deploy the DUBIS website by pushing to the main branch on GitHub.

## Steps

1. Check for uncommitted changes: `git status`
2. Stage relevant files: `git add <files>` (never use `git add .` — avoid secrets)
3. Commit with descriptive message
4. Push to main: `git push origin main`
5. Monitor deploy: check Vercel dashboard or use `npx vercel ls`
6. Verify production: open https://www.dubis.net and check changes

## Pre-Deploy Checklist
- [ ] No `.key.txt` or `.env` files staged
- [ ] No new files in `/api/` (12/12 limit!)
- [ ] vercel.json valid JSON
- [ ] All referenced design files exist and are >200KB

## If Deploy Fails
- Check Vercel build logs
- Common issue: new API file added → exceeds 12 function limit
- Fix: remove the new file, add route to existing file instead
