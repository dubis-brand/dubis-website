#!/usr/bin/env node
/**
 * DUBIS Virtual Office — manifest generator
 * ==========================================
 * Scans the Dubis config repo (agents + skills frontmatter) and this repo
 * (vercel.json crons), merges with the curated edge map below, and writes
 * office.json — the single map of the whole operation.
 *
 * Two clients read office.json:
 *   1. office.html — the visual Virtual Office at dubis.net/office.html
 *   2. Claude sessions — "which capability already exists? who is connected to X?"
 *
 * Usage:  node scripts/generate-office-manifest.js --root "C:\...\Dubis"
 * Freshness contract: re-run after adding/renaming any agent, skill or cron.
 * pg_cron + GHA entries are snapshots (stamped below) — refresh via
 * `SELECT jobname, schedule FROM cron.job` when they change.
 */
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const rootIdx = argv.indexOf('--root');
const ROOT = rootIdx >= 0 ? argv[rootIdx + 1] : path.join(__dirname, '..', '..');
const SITE = path.join(__dirname, '..');

// ---------- curated layer (edges change rarely; scanned layer keeps names/descriptions live) ----------

const DEPARTMENTS = [
  { id: 'hanhala',  name: 'הנהלה — המוח', en: 'Management — The Brain',        color: '#C17E3A', icon: '🧠' },
  { id: 'shivuk',   name: 'שיווק', en: 'Marketing',                color: '#3d7a4f', icon: '📣' },
  { id: 'studio',   name: 'הסטודיו — תוכן ווידאו', en: 'The Studio — Content & Video', color: '#8a5a9e', icon: '🎬' },
  { id: 'tiful',    name: 'תפעול וטכנולוגיה', en: 'Operations & Tech',      color: '#4a5a8a', icon: '⚙️' },
  { id: 'lakohot',  name: 'לקוחות ודיווח', en: 'Customers & Reporting',         color: '#a3595e', icon: '🤝' },
];

// body agents: file base -> {he, dept, avatar (images/team/*.jpg), skills, knowledge, connections, tables}
const BODY = {
  'boss':          { he: 'הבוס — דוח יומי', en: 'The Boss — daily report', dept: 'lakohot', avatar: 'boss',
                     skills: ['boss'], knowledge: ['status', 'memory-index'],
                     connections: ['resend', 'meta', 'supabase'], tables: ['boss_reports', 'agent_runs', 'agent_tasks', 'standing_commitments', 'daily_snapshots'] },
  'content':       { he: 'תוכן — פוסטים', en: 'Content — posts', dept: 'studio', avatar: 'content',
                     skills: ['instagram-publish', 'image-variety-rules', 'agent-personas', 'content-pipeline'],
                     knowledge: ['voice-dna', 'copy-playbook', 'company-glossary'],
                     connections: ['meta', 'supabase'], tables: ['agent_tasks', 'dubis_images', 'post_metrics', 'weekly_marketing_plans', 'dubis_products'] },
  'cto':           { he: 'CTO — קוד ופריסות', en: 'CTO — code & deploys', dept: 'tiful', avatar: 'cto',
                     skills: ['autonomous-ops', 'deploy', 'edge-function-deploy'],
                     knowledge: ['checkout-guardrails', 'runbook', 'troubleshooting'],
                     connections: ['vercel', 'github', 'supabase'], tables: ['agent_runs'] },
  'design':        { he: 'עיצוב', en: 'Design', dept: 'studio', avatar: 'design',
                     skills: ['dubis-design'], knowledge: ['brand-identity'],
                     connections: ['higgsfield', 'gelato'], tables: ['dubis_images'] },
  'email-monitor': { he: 'סורק המיילים', en: 'Email Monitor', dept: 'lakohot', avatar: 'email',
                     skills: ['email-monitor'], knowledge: [],
                     connections: ['gmail'], tables: ['agent_tasks'] },
  'marketing':     { he: 'שיווק — ידיים + משפך', en: 'Marketing — hands + funnel', dept: 'shivuk', avatar: 'marketing',
                     skills: ['meta-ads'], knowledge: ['copy-playbook', 'icp-profile'],
                     connections: ['meta', 'moltbook', 'google-merchant', 'supabase'],
                     tables: ['weekly_marketing_plans', 'ad_campaigns', 'content_learnings', 'abandoned_carts', 'page_views'] },
  'product':       { he: 'מוצר — קטלוג', en: 'Product — catalog', dept: 'tiful', avatar: 'product',
                     skills: ['add-product', 'gelato-draft'], knowledge: ['checkout-guardrails'],
                     connections: ['gelato', 'github'], tables: ['dubis_products', 'product_variant_stock', 'slogan_candidates'] },
  'security':      { he: 'אבטחה', en: 'Security', dept: 'tiful', avatar: 'security',
                     skills: ['security-scan'], knowledge: [],
                     connections: ['github', 'supabase', 'vercel'], tables: ['security_scans'] },
  'site-audit':    { he: 'ביקורת האתר', en: 'Site Audit', dept: 'tiful', avatar: 'siteaudit',
                     skills: ['site-audit'], knowledge: [],
                     connections: ['clarity', 'vercel'], tables: ['page_views'] },
  'supply':        { he: 'אספקה — הזמנות', en: 'Supply — orders', dept: 'tiful', avatar: 'supply',
                     skills: ['debug-order'], knowledge: ['checkout-guardrails'],
                     connections: ['gelato', 'paypal'], tables: ['orders', 'product_variant_stock'] },
  'video':         { he: 'וידאו — רילים', en: 'Video — reels', dept: 'studio', avatar: 'video',
                     skills: ['higgsfield-reels', 'video-reel-pipeline'], knowledge: ['brand-identity'],
                     connections: ['higgsfield', 'late', 'supabase'], tables: ['agent_tasks'] },
};

// brain agents: file base (without -agent) -> {he, dept, emoji, skills, knowledge, connections}
const BRAIN = {
  'adam':             { he: 'DUBIS — המנכ"ל', en: 'DUBIS — the CEO', dept: 'ceo', emoji: '🐻', avatar: 'dubis',
                        skills: ['plan', 'hebrew-output'], knowledge: ['doctrine', 'operating-contract', 'snapshot-core', 'snapshot-memory', 'feedback-system', 'status', 'memory-index'],
                        connections: ['gmail', 'moltbook', 'supabase', 'higgsfield'],
                        tables: ['standing_commitments', 'management_decisions'] },
  'dana':             { he: 'דנה — בעלת השיווק', en: 'Dana — marketing owner', dept: 'shivuk', emoji: '👩‍💼',
                        skills: [], knowledge: ['voice-dna', 'icp-profile', 'copy-playbook'], connections: [], tables: ['content_learnings'] },
  'copywriter':       { he: 'קופירייטר', en: 'Copywriter', dept: 'shivuk', emoji: '✍️',
                        skills: [], knowledge: ['voice-dna', 'company-glossary', 'copy-playbook'], connections: [], tables: [] },
  'researcher':       { he: 'חוקר', en: 'Researcher', dept: 'shivuk', emoji: '🔎',
                        skills: [], knowledge: ['icp-profile'], connections: ['supabase'], tables: ['page_views', 'post_metrics'] },
  'screenwriter':     { he: 'תסריטאי — הסיטקום', en: 'Screenwriter — the sitcom', dept: 'studio', emoji: '🎭',
                        skills: [], knowledge: ['voice-dna', 'brand-identity'], connections: ['higgsfield'], tables: [] },
  'strategist':       { he: 'סטרטג', en: 'Strategist', dept: 'hanhala', emoji: '🧭',
                        skills: [], knowledge: ['snapshot-core'], connections: [], tables: [] },
  'devils-advocate':  { he: 'פרקליט השטן', en: "Devil's Advocate", dept: 'hanhala', emoji: '😈',
                        skills: [], knowledge: [], connections: [], tables: [] },
  'chief-of-staff':   { he: 'ראש הסגל — תוכניות', en: 'Chief of Staff — plans', dept: 'hanhala', emoji: '📋',
                        skills: ['plan'], knowledge: ['status'], connections: [], tables: [] },
  'gatekeeper':       { he: 'השוער — בקרת איכות', en: 'Gatekeeper — quality gate', dept: 'hanhala', emoji: '🚧',
                        skills: [], knowledge: ['voice-dna', 'company-glossary', 'feedback-system'], connections: [], tables: [] },
  'analyst':          { he: 'אנליסט — דאטה וכלכלה', en: 'Analyst — data & economics', dept: 'hanhala', emoji: '📊',
                        skills: [], knowledge: [], connections: ['supabase', 'clarity'], tables: ['orders', 'page_views', 'ad_campaigns'] },
  'customer-care':    { he: 'שירות לקוחות', en: 'Customer Care', dept: 'lakohot', emoji: '💬',
                        skills: [], knowledge: ['checkout-guardrails'], connections: ['whatsapp', 'gmail'], tables: ['orders'] },
  'tom':              { he: 'טום — עזרה על המערכת', en: 'Tom — system help', dept: 'hanhala', emoji: '🛟',
                        skills: [], knowledge: ['doctrine'], connections: [], tables: [] },
};

const KNOWLEDGE = {
  'voice-dna':          { he: 'DNA הקול של המותג', en: 'Brand voice DNA', path: 'C-core/voice-dna.md' },
  'icp-profile':        { he: 'פרופיל הקהל (ICP)', en: 'Audience profile (ICP)', path: 'C-core/icp-profile.md' },
  'company-glossary':   { he: 'מילים אסורות ומאושרות', en: 'Banned & approved words', path: 'C-core/company-glossary.md' },
  'copy-playbook':      { he: 'פלייבוק הקופי', en: 'Copy playbook', path: 'C-core/copy-playbook.md' },
  'brand-identity':     { he: 'זהות ויזואלית', en: 'Visual identity', path: 'C-core/brand-identity.md' },
  'snapshot-core':      { he: 'תמצית הזהות', en: 'Identity snapshot', path: 'C-core/snapshot.md' },
  'snapshot-memory':    { he: 'תמצית הזיכרון', en: 'Memory snapshot', path: 'M-memory/snapshot.md' },
  'doctrine':           { he: 'הדוקטרינה', en: 'The doctrine', path: 'B-brain/01-context/doctrine.md' },
  'operating-contract': { he: 'חוזה מוח-גוף', en: 'Brain-body contract', path: 'B-brain/01-context/operating-contract.md' },
  'feedback-system':    { he: 'תיקוני אורן (feedback)', en: 'Founder feedback corrections', path: 'M-memory/feedback-system.md' },
  'status':             { he: 'לוח המצב החי', en: 'Live status board', path: 'M-memory/status.md' },
  'memory-index':       { he: 'אינדקס הזיכרון', en: 'Memory index', path: 'M-memory/MEMORY.md' },
  'checkout-guardrails':{ he: 'חוקי הקופה (כתובים בדם)', en: 'Checkout guardrails (written in blood)', path: 'M-memory/checkout-guardrails.md' },
  'runbook':            { he: 'ראנבוק — נהלים', en: 'Runbook — procedures', path: 'M-memory/runbook.md' },
  'troubleshooting':    { he: 'פוסטמורטמים', en: 'Postmortems', path: 'M-memory/troubleshooting.md' },
};

const CONNECTIONS = {
  'meta':           { he: 'Meta — אינסטגרם ופייסבוק', icon: '📷', en: 'Meta — Instagram & Facebook', what_en: 'Posts & reels publishing, paid campaigns, engagement metrics, community reply loop', what: 'פרסום פוסטים ורילים, קמפיינים בתשלום, מדדי מעורבות, לולאת תגובות' },
  'gelato':         { he: 'Gelato — הדפסה ומשלוח', icon: '👕', en: 'Gelato — print & fulfillment', what_en: 'Print-on-demand garments, stock, mockups, delivery to the customer', what: 'הדפסת הבגדים לפי הזמנה, מלאי, מוקאפים, משלוח עד הלקוח' },
  'paypal':         { he: 'PayPal — סליקה', icon: '💳', en: 'PayPal — payments', what_en: 'Checkout payments + automatic refunds', what: 'קבלת תשלומים בקופה + החזרים אוטומטיים' },
  'gmail':          { he: 'Gmail — dubis.brand', icon: '✉️', en: 'Gmail — dubis.brand', what_en: "Scanning the founder's idea emails, drafts (Neo), report replies", what: 'סריקת רעיונות של אורן, טיוטות (ניאו), תשובות לדוח' },
  'resend':         { he: 'Resend — דיוור', icon: '📨', en: 'Resend — email delivery', what_en: 'Daily report, order confirmations, cart recovery', what: 'הדוח היומי, מיילי אישור הזמנה, שחזור עגלות' },
  'higgsfield':     { he: 'Higgsfield — סטודיו AI', icon: '🎥', en: 'Higgsfield — AI studio', what_en: 'Reels, avatars, the sitcom, persona photos (main session only)', what: 'רילים, אווטארים, הסיטקום, תמונות פרסונה (סשן ראשי בלבד)' },
  'late':           { he: 'Late — פרסום טיקטוק', icon: '🎵', en: 'Late — TikTok publishing', what_en: 'Uploads the daily reel to TikTok', what: 'העלאת הריל היומי לטיקטוק' },
  'moltbook':       { he: 'Moltbook — רשת הסוכנים', icon: '🦞', en: 'Moltbook — the agent network', what_en: '3 posts/day on the story channel, u/dubis', what: '3 פוסטים ביום בערוץ הסיפור, u/dubis' },
  'github':         { he: 'GitHub — קוד ואוטומציות', icon: '🐙', en: 'GitHub — code & automations', what_en: 'Both repos + GHA pipelines: new product, catalog sync, daily TikTok', what: 'שני הריפו + צינורות GHA: מוצר חדש, סנכרון קטלוג, טיקטוק יומי' },
  'vercel':         { he: 'Vercel — האתר', icon: '▲', en: 'Vercel — the website', what_en: 'Hosts dubis.net + 12 crons + 12/12 functions', what: 'אירוח dubis.net + ‏12 קרונים + ‏12/12 פונקציות' },
  'supabase':       { he: 'Supabase — הדאטהבייס', icon: '🗄️', en: 'Supabase — the database', what_en: 'All tables, edge functions, 22 pg_cron jobs', what: 'כל הטבלאות, פונקציות הענן, ‏22 עבודות pg_cron' },
  'clarity':        { he: 'Microsoft Clarity', icon: '🎞️', en: 'Microsoft Clarity', what_en: 'Session recordings of site visits', what: 'הקלטות ביקורים באתר' },
  'google-merchant':{ he: 'Google Merchant', icon: '🛍️', en: 'Google Merchant', what_en: 'Shopping feed — products in Google search', what: 'פיד הקניות — המוצרים בחיפוש גוגל' },
  'whatsapp':       { he: 'WhatsApp — 052-3662526', icon: '💬', en: 'WhatsApp — direct line', what_en: 'Fast orders + size exchanges (the human answers)', what: 'ערוץ ההזמנות המהיר והחלפות מידה (אורן עונה)' },
};

const TABLES = {
  'dubis_products':        { he: 'קטלוג המוצרים', en: 'Product catalog' },
  'orders':                { he: 'הזמנות', en: 'Orders' },
  'agent_tasks':           { he: 'תור המשימות', en: 'Task queue' },
  'agent_runs':            { he: 'יומן הריצות', en: 'Run log' },
  'standing_commitments':  { he: 'פנקס ההתחייבויות', en: 'Commitments ledger' },
  'management_decisions':  { he: 'החלטות השולחן', en: 'Board decisions' },
  'weekly_marketing_plans':{ he: 'התוכנית השבועית', en: 'Weekly plan' },
  'post_metrics':          { he: 'מדדי פוסטים', en: 'Post metrics' },
  'content_learnings':     { he: 'למידות תוכן', en: 'Content learnings' },
  'dubis_images':          { he: 'מאגר התמונות', en: 'Image library' },
  'page_views':            { he: 'ביקורים באתר', en: 'Site visits' },
  'product_variant_stock': { he: 'מלאי ומחירים', en: 'Stock & prices' },
  'ad_campaigns':          { he: 'קמפיינים', en: 'Ad campaigns' },
  'boss_reports':          { he: 'ארכיון הדוחות', en: 'Report archive' },
  'daily_snapshots':       { he: 'צילומי יום', en: 'Daily snapshots' },
  'abandoned_carts':       { he: 'עגלות נטושות', en: 'Abandoned carts' },
  'slogan_candidates':     { he: 'סלוגנים מהקהל', en: 'Crowd slogans' },
  'security_scans':        { he: 'סריקות אבטחה', en: 'Security scans' },
};

// pg_cron snapshot — from live `SELECT jobname, schedule FROM cron.job` (2026-08-01)
const PG_CRON = [
  ['dubis-boss-cloud', '30 16 * * *', 'boss', 'הדוח היומי לאורן (19:30 IL)', 'Daily report to the founder (19:30 IL)'],
  ['dubis-community-morning', '40 7 * * *', 'marketing', 'לולאת קהילה — תגובות בוקר', 'Community loop — morning replies'],
  ['dubis-community-evening', '40 17 * * *', 'marketing', 'לולאת קהילה — תגובות ערב', 'Community loop — evening replies'],
  ['dubis-content-analyze', '30 3 * * 0', 'content', 'ניתוח תוכן שבועי', 'Weekly content analysis'],
  ['dubis-content-auto-approve', '*/30 * * * *', 'content', 'אישור אוטומטי (QA≥75)', 'Auto-approve (QA≥75)'],
  ['dubis-content-backfill', '0 9 * * *', 'content', 'השלמת קישורי פוסטים', 'Post-permalink backfill'],
  ['dubis-content-metrics', '0 16 * * *', 'content', 'איסוף מדדי פוסטים', 'Post metrics collection'],
  ['dubis-design-cloud', '0 11 * * 4', 'design', 'ריצת עיצוב שבועית', 'Weekly design run'],
  ['dubis-email-monitor', '30 4 * * *', 'email-monitor', 'סריקת Gmail', 'Gmail scan'],
  ['dubis-gelato-stock-cloud', '0 5 * * *', 'supply', 'בדיקת מלאי Gelato', 'Gelato stock check'],
  ['dubis-marketing-cloud', '0 8 * * *', 'marketing', 'ריצת שיווק יומית', 'Daily marketing run'],
  ['dubis-meta-spend-sync', '0 16 * * *', 'marketing', 'סנכרון הוצאות Meta', 'Meta spend sync'],
  ['dubis-moltbook-morning', '10 6 * * *', 'marketing', 'פוסט Moltbook בוקר', 'Moltbook morning post'],
  ['dubis-moltbook-noon', '10 11 * * *', 'marketing', 'פוסט Moltbook צהריים', 'Moltbook noon post'],
  ['dubis-moltbook-evening', '10 17 * * *', 'marketing', 'פוסט Moltbook ערב', 'Moltbook evening post'],
  ['dubis-persona-daily', '0 9 * * 0,2,4', 'content', 'מאחורי הקוד — פוסט דמות', 'Behind-the-code persona post'],
  ['dubis-product-cloud', '30 7 * * *', 'product', 'ריצת מוצר יומית', 'Daily product run'],
  ['dubis-reconcile-orders', '*/2 * * * *', 'supply', 'התאמת הזמנות (כל 2 דק\')', 'Order reconciliation (every 2 min)'],
  ['dubis-site-audit-cloud', '0 11 * * 3', 'site-audit', 'ביקורת אתר שבועית', 'Weekly site audit'],
  ['dubis-supply-cloud', '0 9 * * *', 'supply', 'ריצת אספקה יומית', 'Daily supply run'],
  ['dubis-weekly-team-meeting-cloud', '30 4 * * 0', 'boss', 'ישיבת השבוע (ראשון)', 'Weekly team meeting (Sunday)'],
  ['gelato-snapshot-retention', '30 3 * * *', 'supply', 'ניקוי צילומי קטלוג', 'Catalog snapshot retention'],
];

// Vercel cron path -> owner agent + Hebrew label
const VERCEL_CRON_OWNERS = {
  '/api/admin/gelato-sync': ['supply', 'סנכרון סטטוס הזמנות מ-Gelato', 'Order status sync from Gelato'],
  '/api/cron/morning-report?type=gelato-discovery': ['product', 'סריקת קטלוג Gelato', 'Gelato catalog discovery'],
  '/api/cron/morning-report?type=agents': ['email-monitor', 'הפעלת סורק המיילים + ביקורת האתר', 'Email monitor + site audit dispatch'],
  '/api/cron/morning-report': ['boss', 'איסוף בוקר לדוח', 'Morning collection for the report'],
  '/api/cron/review-requests': ['marketing', 'בקשות ביקורת מלקוחות', 'Customer review requests'],
  '/api/cron/morning-report?type=auto-run': ['boss', 'מריץ המשימות האוטונומי', 'Autonomous task runner'],
  '/api/cron/morning-report?type=content': ['content', 'צינור התוכן (פוסטים)', 'Content pipeline (posts)'],
  '/api/cron/morning-report?type=security': ['security', 'סריקת אבטחה שבועית', 'Weekly security scan'],
  '/api/cron/morning-report?type=weekly-marketing-plan': ['marketing', 'התוכנית השבועית (17 משבצות)', 'Weekly plan (17 slots)'],
  '/api/cron/morning-report?type=weekly-slogan-product': ['product', 'מוצר חדש אוטומטי (ג\'+ה\')', 'Auto new product (Tue+Thu)'],
};

const GHA = [
  ['dubis-tiktok-daily', '0 15 * * *', 'video', 'הריל היומי לטיקטוק (דרך Late)', 'Daily TikTok reel (via Late)'],
  ['dubis-product-pipeline', 'on-demand', 'product', 'צינור מוצר חדש: עיצוב→מוקאפים→טיוטה', 'New-product pipeline: design→mockups→draft'],
  ['dubis-sync-products', 'on approve + 03:30', 'product', 'סנכרון הקטלוג הסטטי לאתר', 'Static catalog sync to the site'],
  ['dubis-security-scan', 'on push', 'security', 'סריקת דליפות בקוד', 'Code leak scan'],
];

// ---------- scanned layer ----------

function frontmatter(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return {};
    const out = {};
    let cur = null;
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
      if (kv) { cur = kv[1]; out[cur] = kv[2]; }
      else if (cur && line.trim()) out[cur] += ' ' + line.trim();
    }
    return out;
  } catch { return {}; }
}

function shortDesc(s, max = 220) {
  if (!s) return '';
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function build() {
  const nodes = [];
  const edges = [];
  const addEdge = (a, b) => edges.push([a, b]);

  // CEO + brain agents
  for (const [base, cfg] of Object.entries(BRAIN)) {
    const fm = frontmatter(path.join(ROOT, 'A-agents', `${base}-agent.md`));
    const id = `agent:${base}`;
    nodes.push({
      id, kind: 'agent', layer: 'brain', dept: cfg.dept, he: cfg.he, en: cfg.en,
      emoji: cfg.emoji, avatar: cfg.avatar || null,
      desc: shortDesc(fm.description), file: `A-agents/${base}-agent.md`,
    });
    (cfg.skills || []).forEach(s => addEdge(id, `skill:${s}`));
    (cfg.knowledge || []).forEach(k => addEdge(id, `doc:${k}`));
    (cfg.connections || []).forEach(c => addEdge(id, `conn:${c}`));
    (cfg.tables || []).forEach(t => addEdge(id, `table:${t}`));
  }

  // body agents
  for (const [base, cfg] of Object.entries(BODY)) {
    const fm = frontmatter(path.join(ROOT, '.claude', 'agents', `${base}.md`));
    const id = `agent:${base}`;
    nodes.push({
      id, kind: 'agent', layer: 'body', dept: cfg.dept, he: cfg.he, en: cfg.en,
      avatar: cfg.avatar, desc: shortDesc(fm.description), file: `.claude/agents/${base}.md`,
    });
    (cfg.skills || []).forEach(s => addEdge(id, `skill:${s}`));
    (cfg.knowledge || []).forEach(k => addEdge(id, `doc:${k}`));
    (cfg.connections || []).forEach(c => addEdge(id, `conn:${c}`));
    (cfg.tables || []).forEach(t => addEdge(id, `table:${t}`));
  }

  // skills — scan both skill roots
  const skillRoots = [
    [path.join(ROOT, '.claude', 'skills'), '.claude/skills'],
    [path.join(SITE, '.claude', 'skills'), 'dubis-website/.claude/skills'],
  ];
  for (const [dir, rel] of skillRoots) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const f = path.join(dir, name, 'SKILL.md');
      if (!fs.existsSync(f)) continue;
      const fm = frontmatter(f);
      nodes.push({
        id: `skill:${name}`, kind: 'skill', he: name,
        desc: shortDesc(fm.description), file: `${rel}/${name}/SKILL.md`,
      });
    }
  }
  // root-level skills not under a folder scan (commands-backed)
  for (const extra of ['plan', 'hebrew-output']) {
    if (!nodes.find(n => n.id === `skill:${extra}`)) {
      nodes.push({ id: `skill:${extra}`, kind: 'skill', he: extra, desc: '', file: '' });
    }
  }

  // knowledge docs
  for (const [k, v] of Object.entries(KNOWLEDGE)) {
    nodes.push({ id: `doc:${k}`, kind: 'doc', he: v.he, en: v.en, file: v.path, desc: '' });
  }

  // connections
  for (const [c, v] of Object.entries(CONNECTIONS)) {
    nodes.push({ id: `conn:${c}`, kind: 'conn', he: v.he, en: v.en, icon: v.icon, desc: v.what, desc_en: v.what_en });
  }

  // tables
  for (const [t, v] of Object.entries(TABLES)) {
    nodes.push({ id: `table:${t}`, kind: 'table', he: v.he, en: v.en, name: t, desc: '' });
  }

  // workflows: vercel crons (scanned) + pg_cron + GHA (snapshots)
  let vc = [];
  try { vc = JSON.parse(fs.readFileSync(path.join(SITE, 'vercel.json'), 'utf8')).crons || []; } catch {}
  for (const c of vc) {
    const [owner, he, wen] = VERCEL_CRON_OWNERS[c.path] || [null, c.path, c.path];
    const id = `wf:vercel:${c.path}@${c.schedule}`;
    nodes.push({ id, kind: 'wf', src: 'Vercel', he, en: wen, schedule: c.schedule, desc: c.path });
    if (owner) addEdge(`agent:${owner}`, id);
    addEdge(id, 'conn:vercel');
  }
  for (const [name, sched, owner, he, wen] of PG_CRON) {
    const id = `wf:pg:${name}`;
    nodes.push({ id, kind: 'wf', src: 'pg_cron', he, en: wen, schedule: sched, desc: name });
    addEdge(`agent:${owner}`, id);
    addEdge(id, 'conn:supabase');
  }
  for (const [name, sched, owner, he, wen] of GHA) {
    const id = `wf:gha:${name}`;
    nodes.push({ id, kind: 'wf', src: 'GitHub Actions', he, en: wen, schedule: sched, desc: name });
    addEdge(`agent:${owner}`, id);
    addEdge(id, 'conn:github');
  }

  const counts = {};
  for (const n of nodes) counts[n.kind] = (counts[n.kind] || 0) + 1;

  return {
    generated_at: new Date().toISOString(),
    note: 'DUBIS Virtual Office manifest. Agents+skills scanned from the repos; edges curated in scripts/generate-office-manifest.js; pg_cron/GHA are dated snapshots.',
    departments: DEPARTMENTS,
    counts,
    nodes,
    edges,
  };
}

const manifest = build();
const out = path.join(SITE, 'office.json');
fs.writeFileSync(out, JSON.stringify(manifest, null, 1), 'utf8');
console.log(`office.json written: ${manifest.nodes.length} nodes, ${manifest.edges.length} edges`);
console.log(JSON.stringify(manifest.counts));
