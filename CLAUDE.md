# DUBIS Website — dubis.net

## Quick Reference
- Production: https://www.dubis.net
- Admin: https://www.dubis.net/admin
- Supabase project: ntzwvqtpdmvvavbhuyeb
- Deploy: push to `main` → auto-deploy via Vercel
- Edge Function deploy: `npx supabase functions deploy agents --project-ref ntzwvqtpdmvvavbhuyeb`
- Dev server: `npx vercel dev --listen 3000`

## Critical Constraints
- **Vercel Hobby = MAX 12 Serverless Functions. AT 12/12. NEVER add .js files to /api/.**
- To add functionality → add routes inside existing API files using query params (e.g., `?type=newroute`).
- Agents are on Supabase Edge Functions, NOT Vercel.

## Tech Stack
- Frontend: Static HTML + vanilla JS (no framework)
- Backend: Vercel Serverless Functions (Node.js 24)
- AI Agents: Supabase Edge Functions (Deno/TypeScript) — 8 agents, 22 routes
- Database: Supabase PostgreSQL + RLS on ALL tables
- Payments: PayPal | Print: Gelato API | Email: Resend | AI: Gemini

## Code Style
- Vanilla JS, ES modules where possible
- Hebrew comments OK in frontend code
- All API responses: JSON `{ success, data?, error? }`
- Auth: Supabase JWT (admin), `x-agent-secret` header (agents), `Bearer CRON_SECRET` (cron)

## Memory System
- **Hot cache (this file):** Critical constraints + quick reference only.
- **Rules (.claude/rules/):** Path-scoped context — brand, API, Supabase, agents, Gelato, security.
- **Deep memory (memory/):** MEMORY.md index → glossary, decisions, troubleshooting, integrations.
- **Always check memory/ before asking user** for project history or past decisions.
- When something important is resolved or decided → update memory/.

## When Compacting, Always Preserve
- Current task description and all modified files
- Vercel 12/12 function limit — NEVER add new API files
- Edge Function deploy command
- Active agent schedule (8 agents, cron times)
- Any unresolved errors or pending user decisions
- File paths that were being edited

## Auto-Memory Instructions
- Save debugging insights → memory/troubleshooting.md
- Save architecture decisions → memory/decisions.md
- Update memory/MEMORY.md status section when project state changes
- Keep MEMORY.md under 200 lines — promote/demote as needed

## User Preferences (oren)
- Plans & proposals → Always deliver as RTL Hebrew HTML file
- Language → Match input language (Hebrew ↔ English)
- Style → Direct, professional, opinionated. Say the hard truth.
