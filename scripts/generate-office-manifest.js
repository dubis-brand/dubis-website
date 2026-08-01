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
  { id: 'hanhala',  name: 'הנהלה — המוח',        color: '#C17E3A', icon: '🧠' },
  { id: 'shivuk',   name: 'שיווק',                color: '#3d7a4f', icon: '📣' },
  { id: 'studio',   name: 'הסטודיו — תוכן ווידאו', color: '#8a5a9e', icon: '🎬' },
  { id: 'tiful',    name: 'תפעול וטכנולוגיה',      color: '#4a5a8a', icon: '⚙️' },
  { id: 'lakohot',  name: 'לקוחות ודיווח',         color: '#a3595e', icon: '🤝' },
];

// body agents: file base -> {he, dept, avatar (images/team/*.jpg), skills, knowledge, connections, tables}
const BODY = {
  'boss':          { he: 'הבוס — דוח יומי', dept: 'lakohot', avatar: 'boss',
                     skills: ['boss'], knowledge: ['status', 'memory-index'],
                     connections: ['resend', 'meta', 'supabase'], tables: ['boss_reports', 'agent_runs', 'agent_tasks', 'standing_commitments', 'daily_snapshots'] },
  'content':       { he: 'תוכן — פוסטים', dept: 'studio', avatar: 'content',
                     skills: ['instagram-publish', 'image-variety-rules', 'agent-personas', 'content-pipeline'],
                     knowledge: ['voice-dna', 'copy-playbook', 'company-glossary'],
                     connections: ['meta', 'supabase'], tables: ['agent_tasks', 'dubis_images', 'post_metrics', 'weekly_marketing_plans', 'dubis_products'] },
  'cto':           { he: 'CTO — קוד ופריסות', dept: 'tiful', avatar: 'cto',
                     skills: ['autonomous-ops', 'deploy', 'edge-function-deploy'],
                     knowledge: ['checkout-guardrails', 'runbook', 'troubleshooting'],
                     connections: ['vercel', 'github', 'supabase'], tables: ['agent_runs'] },
  'design':        { he: 'עיצוב', dept: 'studio', avatar: 'design',
                     skills: ['dubis-design'], knowledge: ['brand-identity'],
                     connections: ['higgsfield', 'gelato'], tables: ['dubis_images'] },
  'email-monitor': { he: 'סורק המיילים', dept: 'lakohot', avatar: 'email',
                     skills: ['email-monitor'], knowledge: [],
                     connections: ['gmail'], tables: ['agent_tasks'] },
  'marketing':     { he: 'שיווק — ידיים + משפך', dept: 'shivuk', avatar: 'marketing',
                     skills: ['meta-ads'], knowledge: ['copy-playbook', 'icp-profile'],
                     connections: ['meta', 'moltbook', 'google-merchant', 'supabase'],
                     tables: ['weekly_marketing_plans', 'ad_campaigns', 'content_learnings', 'abandoned_carts', 'page_views'] },
  'product':       { he: 'מוצר — קטלוג', dept: 'tiful', avatar: 'product',
                     skills: ['add-product', 'gelato-draft'], knowledge: ['checkout-guardrails'],
                     connections: ['gelato', 'github'], tables: ['dubis_products', 'product_variant_stock', 'slogan_candidates'] },
  'security':      { he: 'אבטחה', dept: 'tiful', avatar: 'security',
                     skills: ['security-scan'], knowledge: [],
                     connections: ['github', 'supabase', 'vercel'], tables: ['security_scans'] },
  'site-audit':    { he: 'ביקורת האתר', dept: 'tiful', avatar: 'siteaudit',
                     skills: ['site-audit'], knowledge: [],
                     connections: ['clarity', 'vercel'], tables: ['page_views'] },
  'supply':        { he: 'אספקה — הזמנות', dept: 'tiful', avatar: 'supply',
                     skills: ['debug-order'], knowledge: ['checkout-guardrails'],
                     connections: ['gelato', 'paypal'], tables: ['orders', 'product_variant_stock'] },
  'video':         { he: 'וידאו — רילים', dept: 'studio', avatar: 'video',
                     skills: ['higgsfield-reels', 'video-reel-pipeline'], knowledge: ['brand-identity'],
                     connections: ['higgsfield', 'late', 'supabase'], tables: ['agent_tasks'] },
};

// brain agents: file base (without -agent) -> {he, dept, emoji, skills, knowledge, connections}
const BRAIN = {
  'adam':             { he: 'DUBIS — המנכ"ל', dept: 'ceo', emoji: '🐻', avatar: 'dubis',
                        skills: ['plan', 'hebrew-output'], knowledge: ['doctrine', 'operating-contract', 'snapshot-core', 'snapshot-memory', 'feedback-system', 'status', 'memory-index'],
                        connections: ['gmail', 'moltbook', 'supabase', 'higgsfield'],
                        tables: ['standing_commitments', 'management_decisions'] },
  'dana':             { he: 'דנה — בעלת השיווק', dept: 'shivuk', emoji: '👩‍💼',
                        skills: [], knowledge: ['voice-dna', 'icp-profile', 'copy-playbook'], connections: [], tables: ['content_learnings'] },
  'copywriter':       { he: 'קופירייטר', dept: 'shivuk', emoji: '✍️',
                        skills: [], knowledge: ['voice-dna', 'company-glossary', 'copy-playbook'], connections: [], tables: [] },
  'researcher':       { he: 'חוקר', dept: 'shivuk', emoji: '🔎',
                        skills: [], knowledge: ['icp-profile'], connections: ['supabase'], tables: ['page_views', 'post_metrics'] },
  'screenwriter':     { he: 'תסריטאי — הסיטקום', dept: 'studio', emoji: '🎭',
                        skills: [], knowledge: ['voice-dna', 'brand-identity'], connections: ['higgsfield'], tables: [] },
  'strategist':       { he: 'סטרטג', dept: 'hanhala', emoji: '🧭',
                        skills: [], knowledge: ['snapshot-core'], connections: [], tables: [] },
  'devils-advocate':  { he: 'פרקליט השטן', dept: 'hanhala', emoji: '😈',
                        skills: [], knowledge: [], connections: [], tables: [] },
  'chief-of-staff':   { he: 'ראש הסגל — תוכניות', dept: 'hanhala', emoji: '📋',
                        skills: ['plan'], knowledge: ['status'], connections: [], tables: [] },
  'gatekeeper':       { he: 'השוער — בקרת איכות', dept: 'hanhala', emoji: '🚧',
                        skills: [], knowledge: ['voice-dna', 'company-glossary', 'feedback-system'], connections: [], tables: [] },
  'analyst':          { he: 'אנליסט — דאטה וכלכלה', dept: 'hanhala', emoji: '📊',
                        skills: [], knowledge: [], connections: ['supabase', 'clarity'], tables: ['orders', 'page_views', 'ad_campaigns'] },
  'customer-care':    { he: 'שירות לקוחות', dept: 'lakohot', emoji: '💬',
                        skills: [], knowledge: ['checkout-guardrails'], connections: ['whatsapp', 'gmail'], tables: ['orders'] },
  'tom':              { he: 'טום — עזרה על המערכת', dept: 'hanhala', emoji: '🛟',
                        skills: [], knowledge: ['doctrine'], connections: [], tables: [] },
};

const KNOWLEDGE = {
  'voice-dna':          { he: 'DNA הקול של המותג', path: 'C-core/voice-dna.md' },
  'icp-profile':        { he: 'פרופיל הקהל (ICP)', path: 'C-core/icp-profile.md' },
  'company-glossary':   { he: 'מילים אסורות ומאושרות', path: 'C-core/company-glossary.md' },
  'copy-playbook':      { he: 'פלייבוק הקופי', path: 'C-core/copy-playbook.md' },
  'brand-identity':     { he: 'זהות ויזואלית', path: 'C-core/brand-identity.md' },
  'snapshot-core':      { he: 'תמצית הזהות', path: 'C-core/snapshot.md' },
  'snapshot-memory':    { he: 'תמצית הזיכרון', path: 'M-memory/snapshot.md' },
  'doctrine':           { he: 'הדוקטרינה', path: 'B-brain/01-context/doctrine.md' },
  'operating-contract': { he: 'חוזה מוח-גוף', path: 'B-brain/01-context/operating-contract.md' },
  'feedback-system':    { he: 'תיקוני אורן (feedback)', path: 'M-memory/feedback-system.md' },
  'status':             { he: 'לוח המצב החי', path: 'M-memory/status.md' },
  'memory-index':       { he: 'אינדקס הזיכרון', path: 'M-memory/MEMORY.md' },
  'checkout-guardrails':{ he: 'חוקי הקופה (כתובים בדם)', path: 'M-memory/checkout-guardrails.md' },
  'runbook':            { he: 'ראנבוק — נהלים', path: 'M-memory/runbook.md' },
  'troubleshooting':    { he: 'פוסטמורטמים', path: 'M-memory/troubleshooting.md' },
};

const CONNECTIONS = {
  'meta':           { he: 'Meta — אינסטגרם ופייסבוק', icon: '📷', what: 'פרסום פוסטים ורילים, קמפיינים בתשלום, מדדי מעורבות, לולאת תגובות' },
  'gelato':         { he: 'Gelato — הדפסה ומשלוח', icon: '👕', what: 'הדפסת הבגדים לפי הזמנה, מלאי, מוקאפים, משלוח עד הלקוח' },
  'paypal':         { he: 'PayPal — סליקה', icon: '💳', what: 'קבלת תשלומים בקופה + החזרים אוטומטיים' },
  'gmail':          { he: 'Gmail — dubis.brand', icon: '✉️', what: 'סריקת רעיונות של אורן, טיוטות (ניאו), תשובות לדוח' },
  'resend':         { he: 'Resend — דיוור', icon: '📨', what: 'הדוח היומי, מיילי אישור הזמנה, שחזור עגלות' },
  'higgsfield':     { he: 'Higgsfield — סטודיו AI', icon: '🎥', what: 'רילים, אווטארים, הסיטקום, תמונות פרסונה (סשן ראשי בלבד)' },
  'late':           { he: 'Late — פרסום טיקטוק', icon: '🎵', what: 'העלאת הריל היומי לטיקטוק' },
  'moltbook':       { he: 'Moltbook — רשת הסוכנים', icon: '🦞', what: '3 פוסטים ביום בערוץ הסיפור, u/dubis' },
  'github':         { he: 'GitHub — קוד ואוטומציות', icon: '🐙', what: 'שני הריפו + צינורות GHA: מוצר חדש, סנכרון קטלוג, טיקטוק יומי' },
  'vercel':         { he: 'Vercel — האתר', icon: '▲', what: 'אירוח dubis.net + ‏12 קרונים + ‏12/12 פונקציות' },
  'supabase':       { he: 'Supabase — הדאטהבייס', icon: '🗄️', what: 'כל הטבלאות, פונקציות הענן, ‏22 עבודות pg_cron' },
  'clarity':        { he: 'Microsoft Clarity', icon: '🎞️', what: 'הקלטות ביקורים באתר' },
  'google-merchant':{ he: 'Google Merchant', icon: '🛍️', what: 'פיד הקניות — המוצרים בחיפוש גוגל' },
  'whatsapp':       { he: 'WhatsApp — 052-3662526', icon: '💬', what: 'ערוץ ההזמנות המהיר והחלפות מידה (אורן עונה)' },
};

const TABLES = {
  'dubis_products':        { he: 'קטלוג המוצרים' },
  'orders':                { he: 'הזמנות' },
  'agent_tasks':           { he: 'תור המשימות' },
  'agent_runs':            { he: 'יומן הריצות' },
  'standing_commitments':  { he: 'פנקס ההתחייבויות' },
  'management_decisions':  { he: 'החלטות השולחן' },
  'weekly_marketing_plans':{ he: 'התוכנית השבועית' },
  'post_metrics':          { he: 'מדדי פוסטים' },
  'content_learnings':     { he: 'למידות תוכן' },
  'dubis_images':          { he: 'מאגר התמונות' },
  'page_views':            { he: 'ביקורים באתר' },
  'product_variant_stock': { he: 'מלאי ומחירים' },
  'ad_campaigns':          { he: 'קמפיינים' },
  'boss_reports':          { he: 'ארכיון הדוחות' },
  'daily_snapshots':       { he: 'צילומי יום' },
  'abandoned_carts':       { he: 'עגלות נטושות' },
  'slogan_candidates':     { he: 'סלוגנים מהקהל' },
  'security_scans':        { he: 'סריקות אבטחה' },
};

// pg_cron snapshot — from live `SELECT jobname, schedule FROM cron.job` (2026-08-01)
const PG_CRON = [
  ['dubis-boss-cloud', '30 16 * * *', 'boss', 'הדוח היומי לאורן (19:30 IL)'],
  ['dubis-community-morning', '40 7 * * *', 'marketing', 'לולאת קהילה — תגובות בוקר'],
  ['dubis-community-evening', '40 17 * * *', 'marketing', 'לולאת קהילה — תגובות ערב'],
  ['dubis-content-analyze', '30 3 * * 0', 'content', 'ניתוח תוכן שבועי'],
  ['dubis-content-auto-approve', '*/30 * * * *', 'content', 'אישור אוטומטי (QA≥75)'],
  ['dubis-content-backfill', '0 9 * * *', 'content', 'השלמת קישורי פוסטים'],
  ['dubis-content-metrics', '0 16 * * *', 'content', 'איסוף מדדי פוסטים'],
  ['dubis-design-cloud', '0 11 * * 4', 'design', 'ריצת עיצוב שבועית'],
  ['dubis-email-monitor', '30 4 * * *', 'email-monitor', 'סריקת Gmail'],
  ['dubis-gelato-stock-cloud', '0 5 * * *', 'supply', 'בדיקת מלאי Gelato'],
  ['dubis-marketing-cloud', '0 8 * * *', 'marketing', 'ריצת שיווק יומית'],
  ['dubis-meta-spend-sync', '0 16 * * *', 'marketing', 'סנכרון הוצאות Meta'],
  ['dubis-moltbook-morning', '10 6 * * *', 'marketing', 'פוסט Moltbook בוקר'],
  ['dubis-moltbook-noon', '10 11 * * *', 'marketing', 'פוסט Moltbook צהריים'],
  ['dubis-moltbook-evening', '10 17 * * *', 'marketing', 'פוסט Moltbook ערב'],
  ['dubis-persona-daily', '0 9 * * 0,2,4', 'content', 'מאחורי הקוד — פוסט דמות'],
  ['dubis-product-cloud', '30 7 * * *', 'product', 'ריצת מוצר יומית'],
  ['dubis-reconcile-orders', '*/2 * * * *', 'supply', 'התאמת הזמנות (כל 2 דק\')'],
  ['dubis-site-audit-cloud', '0 11 * * 3', 'site-audit', 'ביקורת אתר שבועית'],
  ['dubis-supply-cloud', '0 9 * * *', 'supply', 'ריצת אספקה יומית'],
  ['dubis-weekly-team-meeting-cloud', '30 4 * * 0', 'boss', 'ישיבת השבוע (ראשון)'],
  ['gelato-snapshot-retention', '30 3 * * *', 'supply', 'ניקוי צילומי קטלוג'],
];

// Vercel cron path -> owner agent + Hebrew label
const VERCEL_CRON_OWNERS = {
  '/api/admin/gelato-sync': ['supply', 'סנכרון סטטוס הזמנות מ-Gelato'],
  '/api/cron/morning-report?type=gelato-discovery': ['product', 'סריקת קטלוג Gelato'],
  '/api/cron/morning-report?type=agents': ['email-monitor', 'הפעלת סורק המיילים + ביקורת האתר'],
  '/api/cron/morning-report': ['boss', 'איסוף בוקר לדוח'],
  '/api/cron/review-requests': ['marketing', 'בקשות ביקורת מלקוחות'],
  '/api/cron/morning-report?type=auto-run': ['boss', 'מריץ המשימות האוטונומי'],
  '/api/cron/morning-report?type=content': ['content', 'צינור התוכן (פוסטים)'],
  '/api/cron/morning-report?type=security': ['security', 'סריקת אבטחה שבועית'],
  '/api/cron/morning-report?type=weekly-marketing-plan': ['marketing', 'התוכנית השבועית (17 משבצות)'],
  '/api/cron/morning-report?type=weekly-slogan-product': ['product', 'מוצר חדש אוטומטי (ג\'+ה\')'],
};

const GHA = [
  ['dubis-tiktok-daily', '0 15 * * *', 'video', 'הריל היומי לטיקטוק (דרך Late)'],
  ['dubis-product-pipeline', 'on-demand', 'product', 'צינור מוצר חדש: עיצוב→מוקאפים→טיוטה'],
  ['dubis-sync-products', 'on approve + 03:30', 'product', 'סנכרון הקטלוג הסטטי לאתר'],
  ['dubis-security-scan', 'on push', 'security', 'סריקת דליפות בקוד'],
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
      id, kind: 'agent', layer: 'brain', dept: cfg.dept, he: cfg.he,
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
      id, kind: 'agent', layer: 'body', dept: cfg.dept, he: cfg.he,
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
    nodes.push({ id: `doc:${k}`, kind: 'doc', he: v.he, file: v.path, desc: '' });
  }

  // connections
  for (const [c, v] of Object.entries(CONNECTIONS)) {
    nodes.push({ id: `conn:${c}`, kind: 'conn', he: v.he, icon: v.icon, desc: v.what });
  }

  // tables
  for (const [t, v] of Object.entries(TABLES)) {
    nodes.push({ id: `table:${t}`, kind: 'table', he: v.he, name: t, desc: '' });
  }

  // workflows: vercel crons (scanned) + pg_cron + GHA (snapshots)
  let vc = [];
  try { vc = JSON.parse(fs.readFileSync(path.join(SITE, 'vercel.json'), 'utf8')).crons || []; } catch {}
  for (const c of vc) {
    const [owner, he] = VERCEL_CRON_OWNERS[c.path] || [null, c.path];
    const id = `wf:vercel:${c.path}@${c.schedule}`;
    nodes.push({ id, kind: 'wf', src: 'Vercel', he, schedule: c.schedule, desc: c.path });
    if (owner) addEdge(`agent:${owner}`, id);
    addEdge(id, 'conn:vercel');
  }
  for (const [name, sched, owner, he] of PG_CRON) {
    const id = `wf:pg:${name}`;
    nodes.push({ id, kind: 'wf', src: 'pg_cron', he, schedule: sched, desc: name });
    addEdge(`agent:${owner}`, id);
    addEdge(id, 'conn:supabase');
  }
  for (const [name, sched, owner, he] of GHA) {
    const id = `wf:gha:${name}`;
    nodes.push({ id, kind: 'wf', src: 'GitHub Actions', he, schedule: sched, desc: name });
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
