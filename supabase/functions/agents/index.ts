// DUBIS — Agents Edge Function (Supabase)
// Deno/TypeScript port of /api/agents.js — all 21 routes via ?type= param
// Deploy: npx supabase functions deploy agents --project-ref ntzwvqtpdmvvavbhuyeb
// =====================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

// ── In-memory rate limiter ──
const _rateLimitMap = new Map<string, { count: number; reset: number }>();
function checkRateLimit(ip: string, max = 30, windowMs = 60_000): boolean {
  const now = Date.now();
  const entry = _rateLimitMap.get(ip);
  if (!entry || now > entry.reset) {
    _rateLimitMap.set(ip, { count: 1, reset: now + windowMs });
    return false;
  }
  entry.count++;
  return entry.count > max;
}

// ── CORS ──
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://www.dubis.net',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-agent-secret',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// ── Supabase client ──
function sbAdmin() {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
}

// ── Auth helpers ──
function getAdminEmails(): string[] {
  return (Deno.env.get('ADMIN_EMAILS') ?? 'dubis.brand@gmail.com')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

async function verifyAdmin(req: Request): Promise<Record<string, unknown> | null> {
  const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '').trim();
  if (!token) return null;
  const sbAnon = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  );
  const { data: { user }, error } = await sbAnon.auth.getUser(token);
  if (error || !user) return null;
  if (!getAdminEmails().includes(user.email!.toLowerCase())) return null;
  return user as Record<string, unknown>;
}

function isAgentSecret(req: Request): boolean {
  const secret = Deno.env.get('AGENT_SECRET') ?? '';
  return !!(secret && req.headers.get('x-agent-secret') === secret);
}

// ── Hebrew normalization ──
function fixHebrew(text: string): string {
  return text
    .replace(/זיפ\s+הודי/g, 'קפוצון זיפ')
    .replace(/הודי\s+זיפ/g, 'קפוצון זיפ')
    .replace(/ההודי/g, 'הקפוצון')
    .replace(/הודי[זם]/g, 'קפוצונים')
    .replace(/הודי/g, 'קפוצון');
}

// ── Slogan typography map ──
const SLOGAN_TYPOGRAPHY: Record<string, { small: string; big: string; after: string; layout: string }> = {
  "I'm not fat, I'm a limited edition":   { small: 'I am not fat, I am a', big: 'LIMITED', after: 'edition.', layout: 'top-bottom' },
  "More of me to love":                   { small: 'more of me', big: 'LOVE', after: '', layout: 'top-bottom' },
  "Napping is my cardio":                 { small: 'NAPPING IS MY', big: 'CARDIO', after: '', layout: 'top-bottom' },
  "I survived. That's enough.":           { small: '', big: 'I survived.', after: "That's enough.", layout: 'top-bottom' },
  "Low maintenance, high value":          { small: 'low maintenance', big: 'VALUE', after: 'high', layout: 'top-bottom' },
  "Not a model. Never wanted to be.":     { small: 'Not a model.', big: 'NEVER.', after: 'wanted to be.', layout: 'top-bottom' },
  "Born to nap, forced to work":          { small: '', big: 'NAP', after: 'Born to nap, forced to work', layout: 'big-top' },
  "Certified overthinker":                { small: 'certified', big: 'OVER', after: 'thinker.', layout: 'top-bottom' },
  "Serial napper":                        { small: 'serial', big: 'NAPPER', after: '', layout: 'top-bottom' },
  "She believed she could, so she took a nap": { small: 'She believed she could,\nso she took a', big: 'NAP.', after: '', layout: 'top-bottom' },
  "I run on coffee and sarcasm":          { small: '', big: 'COFFEE', after: 'I run on coffee and sarcasm.', layout: 'big-top' },
  "Zero Motivation Club":                 { small: 'Zero Motivation', big: 'CLUB', after: '', layout: 'top-bottom' },
  "Emotionally attached to my couch":     { small: 'emotionally attached to my', big: 'COUCH', after: '', layout: 'top-bottom' },
  "DUBIS — For the rest of us":           { small: 'DUBIS — For the rest of', big: 'US', after: '', layout: 'top-bottom' },
};

function getSloganTypographyPrompt(slogan: string): string {
  const key = Object.keys(SLOGAN_TYPOGRAPHY).find(
    (k) => k.toLowerCase() === (slogan || '').toLowerCase(),
  );
  const t = key ? SLOGAN_TYPOGRAPHY[key] : null;
  if (!t) return `the text "${(slogan || '').toUpperCase()}" in LARGE bold white sans-serif capital letters`;
  if (t.layout === 'big-top') {
    return `the word "${t.big}" in EXTREMELY LARGE bold white condensed sans-serif capital letters at the top, with "${t.after}" in much smaller white text underneath`;
  }
  const parts: string[] = [];
  if (t.small) parts.push(`"${t.small}" in smaller white text`);
  parts.push(`"${t.big}" in EXTREMELY LARGE bold white condensed sans-serif capital letters (3-5x bigger than the other text)`);
  if (t.after) parts.push(`"${t.after}" in smaller white text below`);
  return parts.join(', then ');
}

// ── base64 → Uint8Array (replaces Node Buffer) ──
function b64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ═══════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS_HEADERS });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (checkRateLimit(ip)) return json({ error: 'Too many requests' }, 429);

  const url = new URL(req.url);
  const type     = url.searchParams.get('type') ?? '';
  const id       = url.searchParams.get('id') ?? '';
  const status   = url.searchParams.get('status') ?? '';
  const agent    = url.searchParams.get('agent') ?? '';
  const priority = url.searchParams.get('priority') ?? '';

  const sb = sbAdmin();

  // Parse body once for POST/PATCH
  let body: Record<string, unknown> = {};
  if (req.method !== 'GET' && req.method !== 'DELETE') {
    try { body = await req.json(); } catch { /* empty body */ }
  }

  // ── TASKS ─────────────────────────────────────────────────────────
  if (type === 'tasks') {
    if (req.method === 'GET') {
      const admin = await verifyAdmin(req);
      if (!admin) return json({ error: 'Unauthorized' }, 401);
      let q = sb.from('agent_tasks').select('*').order('created_at', { ascending: false });
      if (status)   q = q.eq('status', status);
      if (agent)    q = q.eq('agent_id', agent);
      if (priority) q = q.eq('priority', priority);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      return json({ tasks: data });
    }

    if (req.method === 'POST') {
      const isAdmin = await verifyAdmin(req);
      if (!isAdmin && !isAgentSecret(req)) return json({ error: 'Unauthorized' }, 401);
      const { title, agent_id, priority: pri, category, description, content_data, due_date, notes } = body;
      if (!title || !agent_id) return json({ error: 'title and agent_id required' }, 400);
      const { data, error } = await sb.from('agent_tasks').insert({
        title, agent_id, priority: pri ?? 'medium', status: 'backlog',
        category: category ?? null, description: description ?? null,
        content_data: content_data ?? {}, due_date: due_date ?? null, notes: notes ?? null,
      }).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ task: data }, 201);
    }

    if (req.method === 'PATCH') {
      const admin = await verifyAdmin(req);
      if (!admin) return json({ error: 'Unauthorized' }, 401);
      if (!id) return json({ error: 'id required' }, 400);
      const allowed = ['backlog', 'in_progress', 'pending_approval', 'approved', 'done', 'rejected'];
      const newStatus = body?.status as string | undefined;
      if (newStatus && !allowed.includes(newStatus)) return json({ error: 'Invalid status' }, 400);
      const update: Record<string, unknown> = { ...body, updated_at: new Date().toISOString() };
      if (newStatus === 'approved') update.approved_at = new Date().toISOString();
      const { data, error } = await sb.from('agent_tasks').update(update).eq('id', id).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ task: data });
    }

    if (req.method === 'DELETE') {
      const admin = await verifyAdmin(req);
      if (!admin) return json({ error: 'Unauthorized' }, 401);
      if (!id) return json({ error: 'id required' }, 400);
      const { error } = await sb.from('agent_tasks').delete().eq('id', id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }
  }

  // ── RUNS ──────────────────────────────────────────────────────────
  if (type === 'runs') {
    if (req.method === 'GET') {
      const admin = await verifyAdmin(req);
      if (!admin) return json({ error: 'Unauthorized' }, 401);
      const { data, error } = await sb.from('agent_runs')
        .select('*').order('created_at', { ascending: false }).limit(100);
      if (error) return json({ error: error.message }, 500);
      return json({ runs: data });
    }

    if (req.method === 'POST') {
      if (!isAgentSecret(req)) return json({ error: 'Unauthorized' }, 401);
      const { agent_id, status: runStatus, summary, tasks_created, duration_ms, error_message } = body;
      if (!agent_id) return json({ error: 'agent_id required' }, 400);
      const { data, error } = await sb.from('agent_runs').insert({
        agent_id, status: runStatus ?? 'completed', summary: summary ?? null,
        tasks_created: tasks_created ?? 0, duration_ms: duration_ms ?? null, error_message: error_message ?? null,
      }).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ run: data }, 201);
    }
  }

  // ── RUN ──────────────────────────────────────────────────────────
  if (type === 'run') {
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    const admin = await verifyAdmin(req);
    const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
    const isCron = (req.headers.get('authorization') ?? '') === `Bearer ${cronSecret}`;
    if (!admin && !isCron) return json({ error: 'Unauthorized' }, 401);

    const { data: allApproved, error: fetchErr } = await sb.from('agent_tasks')
      .select('id, title, agent_id, category, description, notes, priority, content_data')
      .eq('status', 'approved')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true });

    if (fetchErr) return json({ error: fetchErr.message }, 500);
    type Task = Record<string, unknown>;
    const tasks = (allApproved || []).filter((t: Task) => !(t.content_data as Task)?.content_approved);

    if (!tasks.length) {
      const readyCount = (allApproved || []).filter((t: Task) => (t.content_data as Task)?.content_approved).length;
      return json({ queued: 0, ready_to_publish: readyCount, summary: readyCount > 0
        ? `✅ ${readyCount} משימות מוכנות לפרסום (תוכן אושר). אין משימות חדשות לעיבוד.`
        : 'אין משימות approved הממתינות לעיבוד.' });
    }

    const byAgent: Record<string, Task[]> = {};
    for (const t of tasks) {
      const aid = t.agent_id as string;
      if (!byAgent[aid]) byAgent[aid] = [];
      byAgent[aid].push(t);
    }

    const now = new Date().toISOString();
    const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
    let queued = 0;
    const summaryLines: string[] = [];

    for (const [agent_id, agentTasks] of Object.entries(byAgent)) {
      const ids = agentTasks.map((t: Task) => t.id);
      let runStatus = 'completed';
      const taskResults: string[] = [];

      if (agent_id === 'content' && geminiKey) {
        for (const task of agentTasks) {
          try {
            const cd = (task.content_data as Task) || {};
            const hasPermImg = cd.generated_image_url && (cd.generated_image_url as string).includes('supabase.co');
            if (cd.caption_he && hasPermImg) {
              await sb.from('agent_tasks').update({ status: 'pending_approval', updated_at: now }).eq('id', task.id);
              taskResults.push(`✅ ${task.title}: content קיים → pending_approval`);
              continue;
            }
            let gen: Record<string, string> = {};
            if (!cd.caption_he) {
              const isStory = cd.format === 'story';
              const captionPrompt = isStory
                ? `You are a social media manager for DUBIS — Israeli clothing brand. Tagline: "For the rest of us."
IMPORTANT: Write caption_he in Hebrew ONLY. Use "קפוצון" NOT "הודי" for hoodie.
Task: "${task.title}"
Description: "${task.description || ''}"
Format: STORY. Caption must be SHORT: 1-2 punchy sentences max.
Return ONLY valid JSON: {"caption_he":"...","caption_en":"...","hashtags":"#DUBIS #ForTheRestOfUs","image_prompt":"..."}`
                : `You are a social media manager for DUBIS — Israeli clothing brand. Tagline: "For the rest of us."
IMPORTANT: Write caption_he in Hebrew ONLY. Use "קפוצון" NOT "הודי".
Task: "${task.title}"
Description: "${task.description || ''}"
Format: ${cd.format || 'feed_post'}
Return ONLY valid JSON: {"caption_he":"...","caption_en":"...","hashtags":"#DUBIS ...5-10 tags","image_prompt":"..."}`;
              const cRes = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ contents: [{ parts: [{ text: captionPrompt }] }] }) },
              );
              const cData = await cRes.json();
              const raw = cData.candidates?.[0]?.content?.parts?.[0]?.text || '';
              try { gen = JSON.parse(raw.replace(/```json|```/g, '').trim()); } catch { gen = { caption_en: raw.substring(0, 200) }; }
              if (gen.caption_he) gen.caption_he = fixHebrew(gen.caption_he);
            } else {
              gen = { caption_he: cd.caption_he as string, caption_en: cd.caption_en as string, hashtags: cd.hashtags as string };
            }

            let imageUrl = hasPermImg ? (cd.generated_image_url as string) : '';
            if (!imageUrl) {
              const imgPromptText = gen.image_prompt ||
                `${task.title}, authentic urban lifestyle, DUBIS Israeli clothing brand, real diverse people, dark minimal aesthetic`;
              const prompt = encodeURIComponent(imgPromptText + '. Fashion photography. No text. No watermark. Square 1:1. Photorealistic.');
              const seed = parseInt((task.id as string).replace(/-/g, '').substring(0, 8), 16) % 999999 + 1;
              try {
                const imgRes = await fetch(`https://image.pollinations.ai/prompt/${prompt}?width=1080&height=1080&model=flux&seed=${seed}`, { signal: AbortSignal.timeout(25000) });
                if (imgRes.ok) {
                  const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
                  await sb.storage.createBucket('ig-images', { public: true }).catch(() => {});
                  const fname = `ig-${task.id}.jpg`;
                  await sb.storage.from('ig-images').upload(fname, imgBytes, { contentType: 'image/jpeg', upsert: true });
                  const { data: { publicUrl } } = sb.storage.from('ig-images').getPublicUrl(fname);
                  imageUrl = publicUrl;
                }
              } catch { /* timeout — proceed without image */ }
            }
            await sb.from('agent_tasks').update({
              content_data: { ...cd, caption_he: gen.caption_he || cd.caption_he || '', caption_en: gen.caption_en || cd.caption_en || '', hashtags: gen.hashtags || cd.hashtags || '', ...(imageUrl ? { generated_image_url: imageUrl } : {}) },
              status: 'pending_approval',
              notes: ((task.notes as string) || '') + `\n✍️ תוכן נוצר ע"י AI — ${new Date().toLocaleDateString('he-IL')}`,
              updated_at: now,
            }).eq('id', task.id);
            taskResults.push(`✅ ${task.title}: תוכן${imageUrl ? ' + תמונה' : ' (ללא תמונה)'} → pending_approval`);
          } catch (e) {
            await sb.from('agent_tasks').update({ status: 'in_progress', updated_at: now }).eq('id', task.id);
            taskResults.push(`❌ ${task.title}: ${(e as Error).message}`);
            runStatus = 'completed_with_errors';
          }
        }

      } else if (agent_id === 'marketing' && geminiKey) {
        const { data: orders } = await sb.from('orders').select('total_price')
          .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString());
        const rev = (orders || []).reduce((s: number, o: Task) => s + ((o.total_price as number) || 0), 0);
        for (const task of agentTasks) {
          try {
            const mRes = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
              { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: `אתה אנליסט שיווק של DUBIS.\nמשימה: ${task.title}\nתיאור: ${task.description || ''}\n7 ימים: ${(orders || []).length} הזמנות, $${rev.toFixed(2)} הכנסה.\nספק 3-5 המלצות שיווק בעברית.` }] }] }) },
            );
            const analysis = (await mRes.json()).candidates?.[0]?.content?.parts?.[0]?.text || '';
            await sb.from('agent_tasks').update({ notes: analysis, status: 'pending_approval', updated_at: now }).eq('id', task.id);
            taskResults.push(`✅ ${task.title}: ניתוח נוצר`);
          } catch (e) {
            await sb.from('agent_tasks').update({ status: 'in_progress', updated_at: now }).eq('id', task.id);
            taskResults.push(`❌ ${task.title}: ${(e as Error).message}`);
            runStatus = 'completed_with_errors';
          }
        }

      } else if (agent_id === 'cto' && geminiKey) {
        for (const task of agentTasks) {
          try {
            const tRes = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
              { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: `אתה מפתח full-stack בכיר של DUBIS. Stack: Vercel, Supabase, Vanilla JS, PayPal, Gelato.\nמשימה: ${task.title}\nתיאור: ${task.description || ''}\nקטגוריה: ${task.category || ''}\nספק תוכנית יישום טכנית בעברית.` }] }] }) },
            );
            const plan = (await tRes.json()).candidates?.[0]?.content?.parts?.[0]?.text || '';
            await sb.from('agent_tasks').update({ notes: plan, status: 'in_progress', updated_at: now }).eq('id', task.id);
            taskResults.push(`✅ ${task.title}: תוכנית טכנית נוצרה`);
          } catch (e) {
            await sb.from('agent_tasks').update({ status: 'in_progress', updated_at: now }).eq('id', task.id);
            taskResults.push(`❌ ${task.title}: ${(e as Error).message}`);
            runStatus = 'completed_with_errors';
          }
        }

      } else if (agent_id === 'supply') {
        await sb.from('agent_tasks').update({ status: 'in_progress', updated_at: now }).in('id', ids);
        for (const t of agentTasks) taskResults.push(`📦 ${t.title}: בתהליך — סנכרון Gelato רץ אוטומטי בחצות`);

      } else {
        await sb.from('agent_tasks').update({ status: 'in_progress', updated_at: now }).in('id', ids);
        for (const t of agentTasks) taskResults.push(`⏳ ${t.title}`);
      }

      await sb.from('agent_runs').insert({ agent_id, status: runStatus, summary: taskResults.join('\n'), tasks_created: agentTasks.length });
      queued += agentTasks.length;
      summaryLines.push(`${agent_id}: ${agentTasks.length} tasks`);
    }

    return json({ queued, agents: Object.keys(byAgent), summary: summaryLines.join(', ') });
  }

  // ── GENERATE-IMAGE ──────────────────────────────────────────────────
  if (type === 'generate-image') {
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    const admin = await verifyAdmin(req);
    if (!admin) return json({ error: 'Unauthorized' }, 401);
    const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
    if (!geminiKey) return json({ error: 'GEMINI_API_KEY not configured' }, 503);

    const { task_id, prompt: customPrompt } = body as { task_id?: string; prompt?: string };
    let imagePrompt = customPrompt ?? '';

    if (task_id && !customPrompt) {
      const { data: task } = await sb.from('agent_tasks').select('title, description, content_data').eq('id', task_id).single();
      if (task) {
        type Task = Record<string, unknown>;
        const cd = (task.content_data as Task) || {};
        const format = (cd.format as string) || 'feed_post';
        const slogan = (cd.product_slogan as string) || '';
        const productType = (cd.product_type as string) || '';
        const searchText = ((task.title as string) + ' ' + (cd.caption_en || '') + ' ' + (cd.caption_he || '') + ' ' + slogan).toLowerCase();

        let garmentDesc = 'oversized casual black t-shirt';
        if (productType.includes('zip') || searchText.includes('zip') || searchText.includes('זיפ')) garmentDesc = 'dark charcoal zip-up hoodie';
        else if (productType.includes('hoodie') || searchText.includes('hoodie') || searchText.includes('קפוצון')) garmentDesc = 'oversized dark hoodie (pullover)';
        else if (productType.includes('long') || searchText.includes('long sleeve') || searchText.includes('שרוול')) garmentDesc = 'casual long sleeve shirt';
        else if (productType.includes('cap') || searchText.includes('cap') || searchText.includes('כובע')) garmentDesc = 'casual dark cap/hat';

        let phraseOnClothing = slogan;
        if (!phraseOnClothing) {
          if (searchText.includes('overthinker')) phraseOnClothing = 'Certified Overthinker';
          else if (searchText.includes('nap') || searchText.includes('cardio')) phraseOnClothing = 'Napping is my cardio';
          else if (searchText.includes('limited edition')) phraseOnClothing = "I'm not fat, I'm a limited edition";
          else if (searchText.includes('more of me') || searchText.includes('love')) phraseOnClothing = 'More of me to love';
          else if (searchText.includes('survived')) phraseOnClothing = "I survived... That's enough";
          else if (searchText.includes('not a model')) phraseOnClothing = 'Not a model. Never wanted to be.';
        }

        let settingDesc = 'urban street setting, warm city background, golden hour';
        if (searchText.includes('behind') || searchText.includes('scenes')) settingDesc = 'clothing workshop or design studio, industrial space';
        else if (searchText.includes('relax') || searchText.includes('couch') || searchText.includes('nap')) settingDesc = 'cozy home interior, relaxing on sofa, warm ambient lighting';
        else if (searchText.includes('coffee') || searchText.includes('morning')) settingDesc = 'morning coffee scene, kitchen or cafe, warm sunlight';

        const modelDesc = cd.language === 'he'
          ? 'Israeli man or woman aged 40-50, olive skin, natural body, genuine smile'
          : 'diverse person aged 35-55, natural body type, authentic confidence';
        const brandRules = 'Photorealistic lifestyle photo, square 1:1 format. DUBIS Israeli streetwear brand. Warm natural lighting. NOT a professional model. Candid authentic pose.';

        if (cd.image_prompt) imagePrompt = `${cd.image_prompt}. ${brandRules}`;
        else if (format === 'quote_card') imagePrompt = `Minimalist dark charcoal textured background, concrete wall, moody warm lighting, no people. ${brandRules}`;
        else if (phraseOnClothing) {
          const typoDesc = getSloganTypographyPrompt(phraseOnClothing);
          imagePrompt = `${modelDesc} wearing a ${garmentDesc}. FRONT: small "DUBIS™" text on left chest only. BACK of garment shows MIXED-SIZE TYPOGRAPHY: ${typoDesc}. Small "DUBIS" at bottom hem of back. ${settingDesc}. ${brandRules}. The power word must be 3-5x larger than surrounding text. Bold condensed sans-serif font.`;
        } else {
          imagePrompt = `${modelDesc} wearing a ${garmentDesc} with "DUBIS" small logo on chest, ${settingDesc}. ${brandRules}`;
        }
      }
    }
    if (!imagePrompt) return json({ error: 'prompt or task_id required' }, 400);

    const gRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${geminiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: imagePrompt + '. Fashion photography. Square 1:1. No watermark. Photorealistic.' }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }),
        signal: AbortSignal.timeout(60000) },
    );
    if (!gRes.ok) return json({ error: `Gemini error ${gRes.status}: ${(await gRes.text()).substring(0, 200)}` }, 500);
    const gData = await gRes.json();
    type Part = Record<string, unknown>;
    const imgPart = gData.candidates?.[0]?.content?.parts?.find((p: Part) => (p.inlineData as Part)?.mimeType?.toString().startsWith('image/'));
    if (!imgPart?.inlineData) return json({ error: 'Gemini did not return an image. Try a different prompt.' }, 500);

    const imgBytes = b64ToBytes(imgPart.inlineData.data as string);
    await sb.storage.createBucket('ig-images', { public: true }).catch(() => {});
    const fileName = `ig-${task_id || 'gen'}-${Date.now()}.jpg`;
    const { error: upErr } = await sb.storage.from('ig-images').upload(fileName, imgBytes, { contentType: 'image/jpeg', upsert: true });
    if (upErr) return json({ error: upErr.message }, 500);
    const { data: { publicUrl } } = sb.storage.from('ig-images').getPublicUrl(fileName);

    if (task_id) {
      const { data: tsk } = await sb.from('agent_tasks').select('content_data').eq('id', task_id).single();
      const cd = ((tsk as Record<string, unknown>)?.content_data as Record<string, unknown>) || {};
      await sb.from('agent_tasks').update({ content_data: { ...cd, generated_image_url: publicUrl }, updated_at: new Date().toISOString() }).eq('id', task_id);
    }
    return json({ image_url: publicUrl, prompt_used: imagePrompt });
  }

  // ── GENERATE-PRODUCT-IMAGE ──────────────────────────────────────────
  if (type === 'generate-product-image') {
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    const admin = await verifyAdmin(req);
    if (!admin) return json({ error: 'Unauthorized' }, 401);
    const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
    if (!geminiKey) return json({ error: 'GEMINI_API_KEY not configured' }, 503);

    const b = body as Record<string, string>;
    const product_id = b.product_id;
    if (!product_id) return json({ error: 'product_id required' }, 400);

    const { data: product } = await sb.from('dubis_products').select('*').eq('id', product_id).single();
    if (!product) return json({ error: 'Product not found' }, 404);

    type Product = Record<string, unknown>;
    const p = product as Product;

    const scenes: Record<string, string> = {
      street: 'Cobblestone European city street with cafes, old stone buildings, warm golden hour sunset light',
      home: 'Cozy modern living room, person on sofa, soft natural window light',
      studio: 'Clean minimal photo studio, light gray background, soft even professional lighting',
      nature: 'Forest trail with dappled sunlight through trees, earthy natural atmosphere',
      cafe: 'Outdoor cafe seating area, wooden tables, urban background, warm morning light',
      urban: 'Concrete walls with subtle graffiti, industrial urban area, dramatic directional lighting',
    };
    const models: Record<string, string> = {
      man: 'an average build male in his early 30s, light stubble, relaxed casual posture, friendly expression',
      large_man: 'a larger build confident male in his 30s-40s, full beard, comfortable in his body, warm smile',
      woman: 'an average build woman in her early 30s, natural minimal makeup, genuine warm smile',
      curvy_woman: 'a curvy confident woman in her 30s, body-positive energy, natural look, radiant smile',
      couple: 'a couple walking together side by side, both wearing matching DUBIS clothing, shot from behind',
      older_man: 'a distinguished man in his late 50s, gray hair, weathered face, dignified authentic expression',
    };

    const scenePref = (p.scene_preferences || ['street']) as string[];
    const modelPref = (p.model_preferences || ['man']) as string[];
    const colors = (p.colors || ['Black']) as string[];
    const sceneKey = b.scene_type || b.scene || scenePref[Math.floor(Math.random() * scenePref.length)];
    const modelKey = b.model_type || b.model || modelPref[Math.floor(Math.random() * modelPref.length)];
    const color   = b.color_variant || b.color || colors[Math.floor(Math.random() * colors.length)];

    const sloganTypo  = getSloganTypographyPrompt(p.slogan as string);
    const clothingMap: Record<string, string> = { 't-shirt': 't-shirt', 'hoodie': 'hoodie', 'zip-hoodie': 'zip-up hoodie', 'long-sleeve': 'long sleeve shirt', 'cap': 'baseball cap' };
    const clothingName = clothingMap[p.clothing_type as string] || (p.clothing_type as string);

    const comps = [
      `Create a photorealistic DSLR-quality diptych: LEFT=FRONT of ${color} ${clothingName} worn by ${models[modelKey] || models.man}, small "DUBIS™" on left chest only; RIGHT=BACK showing MIXED-SIZE TYPOGRAPHY: ${sloganTypo}. Small "DUBIS" at bottom hem. SETTING: ${scenes[sceneKey] || scenes.street}`,
      `Create a photorealistic DSLR-quality photo of ${models[modelKey] || models.man} from behind in a ${color} ${clothingName}. BACK shows MIXED-SIZE TYPOGRAPHY: ${sloganTypo}. Small "DUBIS" at bottom hem. Person looking slightly over shoulder. SETTING: ${scenes[sceneKey] || scenes.street}. Shallow depth of field.`,
      `Create a photorealistic DSLR-quality lifestyle photo of ${models[modelKey] || models.man} wearing ${color} ${clothingName}. BACK partially visible showing: ${sloganTypo}. SETTING: ${scenes[sceneKey] || scenes.street}. Candid, unposed, authentic.`,
      `Create a photorealistic DSLR-quality flat-lay of ${color} ${clothingName} showing BACK with MIXED-SIZE TYPOGRAPHY: ${sloganTypo}. Small "DUBIS" at bottom hem. Top-down angle, minimalist styling.`,
      `Create a photorealistic DSLR-quality close-up of BACK of ${color} ${clothingName} worn by ${models[modelKey] || models.man}, focused on MIXED-SIZE TYPOGRAPHY: ${sloganTypo}. Small "DUBIS" at bottom hem. Bokeh background. 85mm f/2.0.`,
    ];
    const compIdx = ((p.slogan as string).length + modelKey.length + sceneKey.length + color.length) % comps.length;
    const prompt = comps[compIdx] + `\n\nCRITICAL:\n- ${clothingName} MUST be ${color} color\n- Slogan MIXED-SIZE TYPOGRAPHY — power word 3-5x larger\n- Slogan on BACK only; front has ONLY small "DUBIS™" on left chest\n- Real diverse person, NOT a fashion model\n- Bold condensed sans-serif font (Impact/Helvetica Condensed)\n- Photorealistic DSLR, not illustration`;

    const gRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${geminiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }),
        signal: AbortSignal.timeout(90000) },
    );
    if (!gRes.ok) return json({ error: `Gemini error ${gRes.status}: ${(await gRes.text()).substring(0, 200)}` }, 500);
    const gData = await gRes.json();
    type Part = Record<string, unknown>;
    const imgPart = gData.candidates?.[0]?.content?.parts?.find((p: Part) => (p.inlineData as Part)?.mimeType?.toString().startsWith('image/'));
    if (!imgPart?.inlineData) return json({ error: 'Gemini did not return an image. Try again.' }, 500);

    const imgBytes = b64ToBytes(imgPart.inlineData.data as string);
    await sb.storage.createBucket('product-images', { public: true }).catch(() => {});
    const slug = (p.slogan as string).toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 30);
    const fileName = `${slug}-${sceneKey}-${modelKey}-${Date.now()}.jpg`;
    const { error: upErr } = await sb.storage.from('product-images').upload(fileName, imgBytes, { contentType: 'image/jpeg', upsert: true });
    if (upErr) return json({ error: upErr.message }, 500);
    const { data: { publicUrl } } = sb.storage.from('product-images').getPublicUrl(fileName);
    const { data: imgRecord } = await sb.from('dubis_images').insert({
      product_id: p.id, image_url: publicUrl, storage_path: fileName,
      scene_type: sceneKey, model_type: modelKey, color_variant: color, prompt_used: prompt,
      tags: [p.category, p.clothing_type, sceneKey, modelKey],
    }).select().single();
    return json({ image_url: publicUrl, image_id: (imgRecord as Record<string, unknown>)?.id, product: p.slogan, scene: sceneKey, model: modelKey, color });
  }

  // ── PRODUCT-IMAGES ──────────────────────────────────────────────────
  if (type === 'product-images') {
    const admin = await verifyAdmin(req);
    if (!admin) return json({ error: 'Unauthorized' }, 401);

    if (req.method === 'GET') {
      const productId = url.searchParams.get('product_id');
      const approvedParam = url.searchParams.get('approved');
      let q = sb.from('dubis_images').select('*, dubis_products(slogan, clothing_type, category)').order('created_at', { ascending: false });
      if (productId) q = q.eq('product_id', productId);
      if (approvedParam === 'true')  q = q.eq('approved', true);
      if (approvedParam === 'false') q = q.eq('approved', false);
      const { data } = await q.limit(100);
      return json(data || []);
    }

    if (req.method === 'PATCH') {
      const imgId = url.searchParams.get('id');
      if (!imgId) return json({ error: 'id required' }, 400);
      const updates: Record<string, unknown> = {};
      if (body.approved !== undefined) updates.approved = body.approved;
      if (body.quality_score !== undefined) updates.quality_score = body.quality_score;
      if (body.tags) updates.tags = body.tags;
      const { data, error } = await sb.from('dubis_images').update(updates).eq('id', imgId).select().single();
      return json(data || { error: error?.message });
    }

    if (req.method === 'DELETE') {
      const imgId = url.searchParams.get('id');
      if (!imgId) return json({ error: 'id required' }, 400);
      const { data: img } = await sb.from('dubis_images').select('storage_path').eq('id', imgId).single();
      if ((img as Record<string, unknown>)?.storage_path) await sb.storage.from('product-images').remove([(img as Record<string, unknown>).storage_path as string]);
      await sb.from('dubis_images').delete().eq('id', imgId);
      return json({ deleted: true });
    }

    if (req.method === 'POST') {
      const { image_base64, product_id, filename } = body as { image_base64?: string; product_id?: string; filename?: string };
      if (!image_base64) return json({ error: 'image_base64 is required' }, 400);
      try {
        const matches = image_base64.match(/^data:(.+?);base64,(.+)$/);
        if (!matches) return json({ error: 'Invalid base64 data' }, 400);
        const contentType = matches[1];
        const imgBytes = b64ToBytes(matches[2]);
        const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
        const safeName = (filename || 'upload').replace(/[^a-zA-Z0-9._-]/g, '').substring(0, 30);
        const storagePath = `uploads/${Date.now()}_${safeName}.${ext}`;
        await sb.storage.createBucket('product-images', { public: true }).catch(() => {});
        const { error: upErr } = await sb.storage.from('product-images').upload(storagePath, imgBytes, { contentType, upsert: true });
        if (upErr) return json({ error: upErr.message }, 500);
        const { data: { publicUrl } } = sb.storage.from('product-images').getPublicUrl(storagePath);
        const insertData: Record<string, unknown> = { image_url: publicUrl, storage_path: storagePath, scene_type: 'uploaded', model_type: 'uploaded', tags: JSON.stringify(['uploaded', 'manual']) };
        if (product_id) insertData.product_id = product_id;
        const { data: imgRecord, error: insertErr } = await sb.from('dubis_images').insert(insertData).select().single();
        if (insertErr) return json({ error: 'DB insert failed: ' + insertErr.message }, 500);
        return json({ success: true, image_url: publicUrl, image_id: (imgRecord as Record<string, unknown>)?.id });
      } catch (e) {
        return json({ error: 'Upload failed: ' + (e as Error).message }, 500);
      }
    }
    return json([]);
  }

  // ── PRODUCTS-CATALOG ────────────────────────────────────────────────
  if (type === 'products-catalog') {
    const admin = await verifyAdmin(req);
    if (!admin) return json({ error: 'Unauthorized' }, 401);
    const { data } = await sb.from('dubis_products').select('*').eq('active', true).order('category');
    return json(data || []);
  }

  // ── SMART-MATCH ─────────────────────────────────────────────────────
  if (type === 'smart-match') {
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    const admin = await verifyAdmin(req);
    if (!admin) return json({ error: 'Unauthorized' }, 401);
    const { caption } = body as { caption?: string };
    const { data: images } = await sb.from('dubis_images')
      .select('*, dubis_products(slogan, clothing_type, category)')
      .eq('approved', true).order('quality_score', { ascending: false });
    if (!images?.length) return json({ matches: [], message: 'אין תמונות מאושרות בבנק.' });

    type Img = Record<string, unknown>;
    const captionLower = (caption || '').toLowerCase();
    const scored = (images as Img[]).map((img) => {
      let score = (img.quality_score as number) || 1;
      const slogan = ((img.dubis_products as Img)?.slogan as string)?.toLowerCase() || '';
      if (captionLower.includes(slogan) || slogan.includes(captionLower.substring(0, 20))) score += 10;
      slogan.split(/\s+/).forEach((kw: string) => { if (kw.length > 3 && captionLower.includes(kw)) score += 2; });
      score -= ((img.times_used as number) || 0) * 0.5;
      const tags = (img.tags as string[]) || [];
      if (captionLower.includes('nap') && tags.includes('home')) score += 3;
      if (captionLower.includes('coffee') && tags.includes('cafe')) score += 3;
      if (captionLower.includes('model') && tags.includes('urban')) score += 2;
      return { ...img, relevance_score: Math.max(0, score) };
    });
    scored.sort((a: Img, b: Img) => (b.relevance_score as number) - (a.relevance_score as number));
    return json({ matches: scored.slice(0, 5) });
  }

  // ── PUBLISH ─────────────────────────────────────────────────────────
  if (type === 'publish') {
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    const admin = await verifyAdmin(req);
    if (!admin && !isAgentSecret(req)) return json({ error: 'Unauthorized' }, 401);
    const { caption, image_url, task_id, platforms = {} } = body as { caption?: string; image_url?: string; task_id?: string; platforms?: Record<string, boolean> };
    if (!caption || !image_url) return json({ error: 'caption and image_url required' }, 400);

    const doIG = (platforms as Record<string, boolean>).instagram !== false && ((platforms as Record<string, boolean>).instagram === true || !Object.keys(platforms).length);
    const doFB = (platforms as Record<string, boolean>).facebook === true;
    const doTT = (platforms as Record<string, boolean>).tiktok === true;
    const result: Record<string, unknown> = { success: false, errors: [] };

    if (doIG) {
      const igToken = Deno.env.get('INSTAGRAM_ACCESS_TOKEN') ?? '';
      const igAccount = Deno.env.get('INSTAGRAM_ACCOUNT_ID') ?? '';
      if (!igToken || !igAccount) {
        (result.errors as string[]).push('Instagram: env vars חסרים');
      } else {
        try {
          const igBase = `https://graph.facebook.com/v19.0/${igAccount}`;
          const cRes = await fetch(`${igBase}/media`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_url, caption, access_token: igToken }) });
          const container = await cRes.json();
          if (!cRes.ok || container.error) {
            (result.errors as string[]).push('Instagram container: ' + (container.error?.message || 'failed'));
          } else {
            const pRes = await fetch(`${igBase}/media_publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creation_id: container.id, access_token: igToken }) });
            const published = await pRes.json();
            if (!pRes.ok || published.error) (result.errors as string[]).push('Instagram publish: ' + (published.error?.message || 'failed'));
            else result.instagram_post_id = published.id;
          }
        } catch (e) { (result.errors as string[]).push('Instagram: ' + (e as Error).message); }
      }
    }

    if (doFB) {
      const fbToken = Deno.env.get('FACEBOOK_PAGE_TOKEN') ?? '';
      const igToken = Deno.env.get('INSTAGRAM_ACCESS_TOKEN') ?? '';
      const allTokens = [fbToken ? { name: 'FACEBOOK_PAGE_TOKEN', val: fbToken } : null, igToken ? { name: 'INSTAGRAM_ACCESS_TOKEN', val: igToken } : null].filter(Boolean) as { name: string; val: string }[];
      if (!allTokens.length) {
        (result.errors as string[]).push('Facebook: חסר FACEBOOK_PAGE_TOKEN');
      } else {
        let fbPublished = false;
        for (const tokenObj of allTokens) {
          if (fbPublished) break;
          try {
            const meData = await (await fetch(`https://graph.facebook.com/v21.0/me?access_token=${tokenObj.val}`)).json();
            if (meData.error?.message?.includes('expired')) {
              if (tokenObj === allTokens[allTokens.length - 1]) { (result.errors as string[]).push(`Facebook: הטוקן פג תוקף`); result.facebook_manual_needed = true; }
              continue;
            }
            let fbPageId: string | null = null;
            let pageToken = tokenObj.val;
            try {
              const acctData = await (await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${tokenObj.val}`)).json();
              if (acctData.data?.length) {
                const envId = Deno.env.get('FACEBOOK_PAGE_ID') ?? '';
                const pg = (envId && acctData.data.find((p: Record<string, string>) => p.id === envId)) || acctData.data[0];
                fbPageId = pg.id; pageToken = pg.access_token || tokenObj.val;
              }
            } catch { /* ignore */ }
            if (!fbPageId) fbPageId = Deno.env.get('FACEBOOK_PAGE_ID') ?? null;
            if (!fbPageId) { if (tokenObj === allTokens[allTokens.length - 1]) { (result.errors as string[]).push('Facebook: לא נמצא דף פייסבוק.'); result.facebook_manual_needed = true; } continue; }

            const fbRes = await fetch(`https://graph.facebook.com/v21.0/${fbPageId}/photos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: image_url, message: caption, published: true, access_token: pageToken }) });
            const fbData = await fbRes.json();
            if (!fbRes.ok || fbData.error) {
              const feedRes = await fetch(`https://graph.facebook.com/v21.0/${fbPageId}/feed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: caption, link: image_url, published: true, access_token: pageToken }) });
              const feedData = await feedRes.json();
              if (!feedRes.ok || feedData.error) { if (tokenObj === allTokens[allTokens.length - 1]) { (result.errors as string[]).push('Facebook: ' + (feedData.error?.message || 'publish failed')); result.facebook_manual_needed = true; } }
              else { result.facebook_post_id = feedData.id; fbPublished = true; }
            } else { result.facebook_post_id = fbData.post_id || fbData.id; fbPublished = true; }
          } catch (e) { if (tokenObj === allTokens[allTokens.length - 1]) { (result.errors as string[]).push('Facebook: ' + (e as Error).message); result.facebook_manual_needed = true; } }
        }
      }
    }

    if (doTT) result.tiktok_note = 'TikTok Content API עדיין לא ממומש — בקרוב';

    const anyPublished = !!(result.instagram_post_id || result.facebook_post_id);
    if ((doIG || doFB) && !anyPublished && (result.errors as string[]).length) return json({ ...result, error: (result.errors as string[]).join('; ') }, 500);
    result.success = true;
    if (task_id && anyPublished) {
      const notes = [result.instagram_post_id ? `Instagram: ${result.instagram_post_id}` : null, result.facebook_post_id ? `Facebook: ${result.facebook_post_id}` : null].filter(Boolean).join(' | ');
      await sb.from('agent_tasks').update({ status: 'done', notes: `Published. ${notes}`, updated_at: new Date().toISOString() }).eq('id', task_id);
    }
    return json(result);
  }

  // ── GEMINI-MODELS ────────────────────────────────────────────────────
  if (type === 'gemini-models') {
    const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const token = url.searchParams.get('token') || req.headers.get('x-agent-secret') || '';
    if (!svcKey || token !== svcKey) return json({ error: 'Unauthorized' }, 401);
    const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
    if (!geminiKey) return json({ error: 'No GEMINI_API_KEY' });
    const mRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}&pageSize=100`);
    const mData = await mRes.json();
    type GModel = Record<string, unknown>;
    const imageModels = (mData.models || []).filter((m: GModel) => (m.name as string)?.toLowerCase().includes('image') || (m.supportedGenerationMethods as string[])?.includes('generateContent'))
      .map((m: GModel) => ({ name: m.name, methods: m.supportedGenerationMethods, description: (m.description as string)?.substring(0, 80) }));
    return json({ total: mData.models?.length, imageRelated: imageModels });
  }

  // ── CONTENT-RUN ─────────────────────────────────────────────────────
  if (type === 'content-run') {
    const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const token = url.searchParams.get('token') || req.headers.get('x-agent-secret') || '';
    if (!svcKey || token !== svcKey) return json({ error: 'Unauthorized' }, 401);

    const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
    const [{ data: approvedTasks }, { data: pendingTasks }] = await Promise.all([
      sb.from('agent_tasks').select('id, title, agent_id, category, description, notes, priority, content_data').eq('status', 'approved').eq('agent_id', 'content').order('created_at', { ascending: true }),
      sb.from('agent_tasks').select('id, title, agent_id, category, description, notes, priority, content_data').eq('status', 'pending_approval').eq('agent_id', 'content').order('created_at', { ascending: true }),
    ]);
    type Task = Record<string, unknown>;
    const allTasks = [...(approvedTasks || []), ...(pendingTasks || [])];
    const tasks = allTasks.filter((t: Task) => !((t.content_data as Task)?.generated_image_url as string)?.includes('supabase.co'));
    if (!tasks.length) return json({ queued: 0, summary: 'All content tasks already have Supabase images ✅' });

    const batch = tasks.slice(0, 1);
    const now = new Date().toISOString();
    const taskResults: string[] = [];

    for (const task of batch) {
      try {
        const cd = (task.content_data as Task) || {};
        const hasPermImg = (cd.generated_image_url as string)?.includes('supabase.co');
        if (cd.caption_he && hasPermImg) {
          await sb.from('agent_tasks').update({ status: 'pending_approval', updated_at: now }).eq('id', task.id);
          taskResults.push(`✅ ${task.title}: content קיים → pending_approval`);
          continue;
        }

        let gen: Record<string, string> = {};
        if (!cd.caption_he && geminiKey) {
          const isStory = cd.format === 'story';
          const captionPrompt = isStory
            ? `You are a social media manager for DUBIS — Israeli clothing brand. Tagline: "For the rest of us."
IMPORTANT: caption_he in Hebrew ONLY. Use "קפוצון" NOT "הודי" for hoodie.
Task: "${task.title}"
Description: "${task.description || ''}"
Notes: "${task.notes || ''}"
Format: STORY. Caption SHORT: 1-2 punchy sentences.
Return ONLY valid JSON: {"caption_he":"...","caption_en":"...","hashtags":"#DUBIS #ForTheRestOfUs","image_prompt":"..."}`
            : `You are a social media manager for DUBIS — Israeli clothing brand. Tagline: "For the rest of us."
IMPORTANT: caption_he in Hebrew ONLY. Use "קפוצון" NOT "הודי".
Task: "${task.title}"
Description: "${task.description || ''}"
Notes: "${task.notes || ''}"
Format: ${cd.format || 'feed_post'}
Return ONLY valid JSON: {"caption_he":"...","caption_en":"...","hashtags":"#DUBIS ...5-10 tags","image_prompt":"..."}`;
          const cRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: captionPrompt }] }] }) },
          );
          const raw = (await cRes.json()).candidates?.[0]?.content?.parts?.[0]?.text || '';
          try { gen = JSON.parse(raw.replace(/```json|```/g, '').trim()); } catch { gen = { caption_en: raw.substring(0, 200) }; }
          if (gen.caption_he) gen.caption_he = fixHebrew(gen.caption_he);
        } else {
          gen = { caption_he: cd.caption_he as string, caption_en: cd.caption_en as string, hashtags: cd.hashtags as string };
        }

        let imageUrl = hasPermImg ? (cd.generated_image_url as string) : '';
        let imgError = '';

        if (!imageUrl && geminiKey) {
          const titleLower = (task.title as string).toLowerCase();
          const dubisRule = 'Israeli streetwear brand aesthetic. Real diverse body types, authentic candid look. Plain black/dark oversized clothing, NO visible text or logos. Dark minimal urban tones. IMPORTANT: Do NOT render any text, words, letters, or logos anywhere in the image.';
          const defaultImgPrompt = cd.format === 'quote_card'
            ? 'Minimalist dark charcoal textured background. Moody low-key lighting. No people. No text. No logos. Square 1:1.'
            : cd.format === 'story'
            ? 'Clean minimal dark urban background. No people. No text. No logos. Suitable for Instagram Story text overlay.'
            : titleLower.includes('nap') || titleLower.includes('cardio')
            ? `Person relaxing on couch wearing oversized dark hoodie. Cozy apartment, soft warm lighting. ${dubisRule}`
            : `Authentic people wearing DUBIS streetwear, urban minimal setting, dark aesthetic, natural lighting, square 1:1. ${dubisRule}`;
          const fullPrompt = (gen.image_prompt || defaultImgPrompt) + '. Fashion photography. Square 1:1. No watermark. Photorealistic.';

          try {
            const gRes = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${geminiKey}`,
              { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }), signal: AbortSignal.timeout(55000) },
            );
            if (gRes.ok) {
              const gData = await gRes.json();
              type Part = Record<string, unknown>;
              const imgPart = gData.candidates?.[0]?.content?.parts?.find((p: Part) => (p.inlineData as Part)?.mimeType?.toString().startsWith('image/'));
              if (imgPart?.inlineData) {
                const imgBytes = b64ToBytes(imgPart.inlineData.data as string);
                await sb.storage.createBucket('ig-images', { public: true }).catch(() => {});
                const fname = `ig-${task.id}.jpg`;
                const { error: upErr } = await sb.storage.from('ig-images').upload(fname, imgBytes, { contentType: imgPart.inlineData.mimeType || 'image/jpeg', upsert: true });
                if (upErr) imgError = `gemini_upload:${upErr.message}`;
                else { const { data: { publicUrl } } = sb.storage.from('ig-images').getPublicUrl(fname); imageUrl = publicUrl; }
              } else imgError = 'gemini_no_img';
            } else { const errBody = await gRes.text().catch(() => ''); imgError = `gemini_${gRes.status}:${errBody.substring(0, 80)}`; }
          } catch (gErr) { imgError = `gemini_catch:${(gErr as Error).message}`; }
        }

        // Fallback: Pollinations
        const polToken = Deno.env.get('POLLINATIONS_TOKEN') ?? '';
        if (!imageUrl && polToken) {
          try {
            const titleLower = (task.title as string).toLowerCase();
            const imgPromptText = gen.image_prompt || `${task.title}, authentic urban lifestyle, DUBIS streetwear, dark minimal aesthetic`;
            const fullPrompt = imgPromptText + '. Fashion photography. Square 1:1. No watermark. Photorealistic.';
            const prompt = encodeURIComponent(fullPrompt);
            const seed = parseInt((task.id as string).replace(/-/g, '').substring(0, 8), 16) % 999999 + 1;
            const imgRes = await fetch(`https://image.pollinations.ai/prompt/${prompt}?width=1080&height=1080&model=flux&seed=${seed}&token=${polToken}`, { signal: AbortSignal.timeout(55000) });
            if (imgRes.ok) {
              const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
              await sb.storage.createBucket('ig-images', { public: true }).catch(() => {});
              const fname = `ig-${task.id}.jpg`;
              const { error: upErr } = await sb.storage.from('ig-images').upload(fname, imgBytes, { contentType: 'image/jpeg', upsert: true });
              if (upErr) imgError += ` pol_upload:${upErr.message}`;
              else { const { data: { publicUrl } } = sb.storage.from('ig-images').getPublicUrl(fname); imageUrl = publicUrl; }
            } else imgError += ` pol_${imgRes.status}`;
          } catch (polErr) { imgError += ` pol_catch:${(polErr as Error).message}`; }
        }

        await sb.from('agent_tasks').update({ status: 'pending_approval', content_data: { ...cd, ...gen, generated_image_url: imageUrl || (cd.generated_image_url as string) || '' }, updated_at: now }).eq('id', task.id);
        taskResults.push(`✅ ${task.title}: ${imageUrl ? '🖼 תמונה+כיתוב' : `⚠️ כיתוב בלבד [${imgError}]`} → pending_approval`);
      } catch (e) {
        taskResults.push(`❌ ${task.title}: ${(e as Error).message}`);
      }
    }

    return json({ queued: taskResults.length, remaining: tasks.length - batch.length, results: taskResults });
  }

  // ── FB-DEBUG ─────────────────────────────────────────────────────────
  if (type === 'fb-debug') {
    const admin = await verifyAdmin(req);
    if (!admin && !isAgentSecret(req)) return json({ error: 'Unauthorized' }, 401);
    type TokenInfo = Record<string, unknown>;
    const diag: Record<string, unknown> = {
      has_fb_page_token: !!(Deno.env.get('FACEBOOK_PAGE_TOKEN')),
      has_ig_token: !!(Deno.env.get('INSTAGRAM_ACCESS_TOKEN')),
      fb_page_id_env: Deno.env.get('FACEBOOK_PAGE_ID') || '(not set)',
      tokens_checked: [],
    };
    const allTokens = [
      { name: 'FACEBOOK_PAGE_TOKEN', val: Deno.env.get('FACEBOOK_PAGE_TOKEN') ?? '' },
      { name: 'INSTAGRAM_ACCESS_TOKEN', val: Deno.env.get('INSTAGRAM_ACCESS_TOKEN') ?? '' },
    ].filter((t) => t.val);

    for (const t of allTokens) {
      const info: Record<string, unknown> = { token_name: t.name, results: {} };
      try { (info.results as TokenInfo).me = await (await fetch(`https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${t.val}`)).json(); } catch (e) { (info.results as TokenInfo).me = { error: (e as Error).message }; }
      try {
        const acctData = await (await fetch(`https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token&access_token=${t.val}`)).json();
        (info.results as TokenInfo).pages = acctData.data?.map((p: Record<string, unknown>) => ({ id: p.id, name: p.name, has_page_token: !!p.access_token })) || acctData.error || 'no data';
      } catch (e) { (info.results as TokenInfo).pages = { error: (e as Error).message }; }
      try {
        const debugData = await (await fetch(`https://graph.facebook.com/v21.0/debug_token?input_token=${t.val}&access_token=${t.val}`)).json();
        (info.results as TokenInfo).token_info = debugData.data
          ? { app_id: debugData.data.app_id, type: debugData.data.type, is_valid: debugData.data.is_valid, expires_at: debugData.data.expires_at ? new Date(debugData.data.expires_at * 1000).toISOString() : 'never', scopes: debugData.data.scopes }
          : debugData.error || debugData;
      } catch (e) { (info.results as TokenInfo).token_info = { error: (e as Error).message }; }
      (diag.tokens_checked as unknown[]).push(info);
    }
    return json(diag);
  }

  // ── PUBLISH-READY ────────────────────────────────────────────────────
  if (type === 'publish-ready') {
    const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const agentSecret = Deno.env.get('AGENT_SECRET') ?? '';
    const authHeader = req.headers.get('authorization') ?? '';
    const token = url.searchParams.get('token') || req.headers.get('x-agent-secret') || authHeader.replace('Bearer ', '').trim() || '';
    const isAuthed = (svcKey && token === svcKey) || (agentSecret && token === agentSecret);
    const adminOk = await verifyAdmin(req);
    if (!isAuthed && !adminOk) return json({ error: 'Unauthorized', debug: { token_len: token.length } }, 401);

    const igToken   = Deno.env.get('INSTAGRAM_ACCESS_TOKEN') ?? '';
    const igAccount = Deno.env.get('INSTAGRAM_ACCOUNT_ID') ?? '';
    if (!igToken || !igAccount) return json({ error: 'Instagram env vars חסרים' }, 503);

    const { data: candidates, error: fetchErr } = await sb.from('agent_tasks').select('id, title, content_data').eq('status', 'pending_approval').eq('agent_id', 'content').order('created_at', { ascending: true });
    if (fetchErr) return json({ error: fetchErr.message }, 500);

    type Task = Record<string, unknown>;
    const batchSize = parseInt(url.searchParams.get('batch') || '1', 10);
    const readyTasks = (candidates || []).filter((t: Task) => {
      const cd = (t.content_data as Task) || {};
      return cd.content_approved && (cd.generated_image_url as string)?.includes('supabase.co');
    }).slice(0, batchSize);

    if (!readyTasks.length) return json({ published: 0, summary: 'אין משימות מוכנות לפרסום עדיין' });

    const igBase = `https://graph.facebook.com/v19.0/${igAccount}`;
    const results: unknown[] = [];
    const now = new Date().toISOString();

    for (const task of readyTasks) {
      const cd = (task.content_data as Task) || {};
      const caption = `${(cd.caption_he as string) || (cd.caption_en as string) || task.title}\n\n${(cd.hashtags as string) || '#DUBIS #ForTheRestOfUs'}`;
      const image_url = cd.generated_image_url as string;
      try {
        const cRes = await fetch(`${igBase}/media`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_url, caption, access_token: igToken }) });
        const container = await cRes.json();
        if (!cRes.ok || container.error) { results.push({ id: task.id, title: task.title, status: 'error', error: container.error?.message || 'container failed' }); continue; }
        await new Promise((r) => setTimeout(r, 7000));
        const pRes = await fetch(`${igBase}/media_publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creation_id: container.id, access_token: igToken }) });
        const pub = await pRes.json();
        if (!pRes.ok || pub.error) { results.push({ id: task.id, title: task.title, status: 'error', error: pub.error?.message || 'publish failed' }); continue; }
        await sb.from('agent_tasks').update({ status: 'done', content_data: { ...cd, instagram_post_id: pub.id, published_at: now }, updated_at: now }).eq('id', task.id);
        results.push({ id: task.id, title: task.title, status: 'published', ig_id: pub.id });
      } catch (e) {
        results.push({ id: task.id, title: task.title, status: 'error', error: (e as Error).message });
      }
    }

    const published = (results as { status: string }[]).filter((r) => r.status === 'published').length;
    return json({ published, total_ready: readyTasks.length, results });
  }

  // ══════════════════════════════════════════════════════════
  // HEYGEN
  // ══════════════════════════════════════════════════════════
  const HEYGEN_BASE = 'https://api.heygen.com';
  const heygenKey = Deno.env.get('HEYGEN_API_KEY') ?? '';

  if (type === 'avatars') {
    const admin = await verifyAdmin(req);
    if (!admin && !isAgentSecret(req)) return json({ error: 'Unauthorized' }, 401);
    if (!heygenKey) return json({ error: 'HEYGEN_API_KEY not configured' }, 500);
    try {
      const r = await fetch(`${HEYGEN_BASE}/v2/avatars`, { headers: { 'X-Api-Key': heygenKey, 'Accept': 'application/json' } });
      const data = await r.json();
      if (!r.ok || data.error) return json({ error: data.error?.message || 'Failed to list avatars' }, r.status);
      type AvatarRaw = Record<string, unknown>;
      const avatars = (data.data?.avatars || []).map((a: AvatarRaw) => ({ avatar_id: a.avatar_id, avatar_name: a.avatar_name, gender: a.gender, preview_image_url: a.preview_image_url, preview_video_url: a.preview_video_url }));
      return json({ avatars, total: avatars.length });
    } catch (e) { return json({ error: 'HeyGen avatars: ' + (e as Error).message }, 500); }
  }

  if (type === 'voices') {
    const admin = await verifyAdmin(req);
    if (!admin && !isAgentSecret(req)) return json({ error: 'Unauthorized' }, 401);
    if (!heygenKey) return json({ error: 'HEYGEN_API_KEY not configured' }, 500);
    const lang = url.searchParams.get('lang') ?? '';
    try {
      const r = await fetch(`${HEYGEN_BASE}/v2/voices`, { headers: { 'X-Api-Key': heygenKey, 'Accept': 'application/json' } });
      const data = await r.json();
      if (!r.ok || data.error) return json({ error: data.error?.message || 'Failed to list voices' }, r.status);
      type VoiceRaw = Record<string, unknown>;
      let voices = (data.data?.voices || []) as VoiceRaw[];
      if (lang) voices = voices.filter((v) => ((v.language as string) || '').toLowerCase().includes(lang.toLowerCase()));
      return json({ voices: voices.map((v) => ({ voice_id: v.voice_id, name: v.name || v.display_name, language: v.language, gender: v.gender, preview_audio: v.preview_audio })), total: voices.length });
    } catch (e) { return json({ error: 'HeyGen voices: ' + (e as Error).message }, 500); }
  }

  if (type === 'heygen-status') {
    if (!heygenKey) return json({ error: 'HEYGEN_API_KEY not configured' });
    const results: Record<string, unknown> = {};
    try { const r = await fetch(`${HEYGEN_BASE}/v2/user/remaining_quota`, { headers: { 'X-Api-Key': heygenKey } }); results.quota = { status: r.status, data: await r.json() }; } catch (e) { results.quota = { error: (e as Error).message }; }
    try { const r = await fetch(`${HEYGEN_BASE}/v2/video/generate`, { method: 'POST', headers: { 'X-Api-Key': heygenKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ test: true, video_inputs: [], dimension: { width: 100, height: 100 } }) }); results.video_generate = { status: r.status, data: await r.json() }; } catch (e) { results.video_generate = { error: (e as Error).message }; }
    try { const r = await fetch(`${HEYGEN_BASE}/v1/video_list.get?limit=1`, { headers: { 'X-Api-Key': heygenKey } }); results.video_list = { status: r.status, data: await r.json() }; } catch (e) { results.video_list = { error: (e as Error).message }; }
    try {
      const r = await fetch(`${HEYGEN_BASE}/v1/talking_photo.list`, { headers: { 'X-Api-Key': heygenKey } });
      const r4data = await r.json();
      type PhotoRaw = Record<string, unknown>;
      const items = Array.isArray(r4data.data) ? (r4data.data as PhotoRaw[]) : [];
      results.talking_photos = { status: r.status, totalItems: items.length, customCount: items.filter((p) => !p.is_preset).length, customIds: items.filter((p) => !p.is_preset).map((p) => p.id) };
    } catch (e) { results.talking_photos = { error: (e as Error).message }; }
    return json({ heygen_key_prefix: heygenKey.substring(0, 12) + '...', results });
  }

  if (type === 'upload-reel-photo') {
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    const admin = await verifyAdmin(req);
    if (!admin && !isAgentSecret(req)) return json({ error: 'Unauthorized' }, 401);
    const { image_base64, filename } = body as { image_base64?: string; filename?: string };
    if (!image_base64) return json({ error: 'image_base64 is required' }, 400);
    try {
      const matches = image_base64.match(/^data:(.+?);base64,(.+)$/);
      if (!matches) return json({ error: 'Invalid base64 data URL' }, 400);
      const contentType = matches[1];
      const imgBytes = b64ToBytes(matches[2]);
      const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
      const storagePath = `reel-photos/${Date.now()}_${(filename || 'photo').replace(/[^a-zA-Z0-9._-]/g, '')}.${ext}`;
      const { error } = await sb.storage.from('ig-images').upload(storagePath, imgBytes, { contentType, upsert: true });
      if (error) throw new Error(error.message);
      const { data: { publicUrl } } = sb.storage.from('ig-images').getPublicUrl(storagePath);
      return json({ success: true, url: publicUrl, path: storagePath });
    } catch (e) { return json({ error: 'Upload failed: ' + (e as Error).message }, 500); }
  }

  if (type === 'upload-talking-photo') {
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    const admin = await verifyAdmin(req);
    if (!admin && !isAgentSecret(req)) return json({ error: 'Unauthorized' }, 401);
    if (!heygenKey) return json({ error: 'HEYGEN_API_KEY not configured' }, 500);
    const { image_url } = body as { image_url?: string };
    if (!image_url) return json({ error: 'image_url is required' }, 400);
    try {
      const { data: cfgRows } = await sb.from('app_config').select('value').eq('key', 'heygen_talking_photo_id').single();
      const storedPhotoId = (cfgRows as Record<string, unknown>)?.value || null;
      if (storedPhotoId) {
        await (await fetch(`${HEYGEN_BASE}/v1/talking_photo/${storedPhotoId}`, { method: 'DELETE', headers: { 'X-Api-Key': heygenKey } })).text();
        await sb.from('app_config').upsert({ key: 'heygen_talking_photo_id', value: null, updated_at: new Date().toISOString() });
      }
      const imgResponse = await fetch(image_url);
      if (!imgResponse.ok) return json({ error: 'Failed to download image from URL' }, 400);
      const imgBytes = new Uint8Array(await imgResponse.arrayBuffer());
      const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';
      const r = await fetch('https://upload.heygen.com/v1/talking_photo', { method: 'POST', headers: { 'X-Api-Key': heygenKey, 'Content-Type': contentType }, body: imgBytes });
      const data = await r.json();
      if (data.data?.talking_photo_id) {
        const newId = data.data.talking_photo_id;
        await sb.from('app_config').upsert({ key: 'heygen_talking_photo_id', value: newId, updated_at: new Date().toISOString() });
        return json({ success: true, talking_photo_id: newId, talking_photo_url: data.data.talking_photo_url || null });
      }
      const errMsg = data.error?.message || data.message || '';
      if (errMsg.toLowerCase().includes('exceeded') || errMsg.toLowerCase().includes('limit')) return json({ success: false, retry: true, deleted: storedPhotoId ? 1 : 0, message: 'HeyGen delete is processing. Wait and retry.' });
      return json({ error: errMsg || 'Upload failed' }, 400);
    } catch (e) { return json({ error: 'Upload failed: ' + (e as Error).message }, 500); }
  }

  if (type === 'generate-reel') {
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    const admin = await verifyAdmin(req);
    if (!admin && !isAgentSecret(req)) {
      const hasAuth = !!(req.headers.get('authorization') || '').replace('Bearer ', '').trim();
      return json({ error: hasAuth ? 'Token פג תוקף — רענן את הדף ונסה שוב' : 'Unauthorized — חסר token' }, 401);
    }
    if (!heygenKey) return json({ error: 'HEYGEN_API_KEY not configured' }, 500);
    const { task_id, script, avatar_id, talking_photo_id, voice_id, voice_gender, language, motion_prompt } = body as Record<string, string>;
    if (!script) return json({ error: 'script is required' }, 400);

    const cleanScript = script.split('\n')
      .filter((line) => { const t = line.trim(); return t && !t.startsWith('#') && !t.startsWith('🔗') && !t.match(/^https?:\/\//) && !t.match(/^[#@🔗📸🎬💛🔥✨💪👆👇]+$/); })
      .join('\n').replace(/#\w+/g, '').replace(/🔗\s*קישור\s*בביו/g, '').replace(/\s+/g, ' ').trim();
    if (!cleanScript) return json({ error: 'Script is empty after cleanup — only hashtags/links found' }, 400);

    const useTalkingPhoto = !!talking_photo_id;
    const chosenAvatar = avatar_id || 'Daisy-inskirt-20220818';
    let chosenVoice = voice_id;

    if (!chosenVoice || chosenVoice === 'default') {
      try {
        const lang = language === 'he' ? 'Hebrew' : (language || 'English');
        type VoiceRaw = Record<string, unknown>;
        const vdata = await (await fetch(`${HEYGEN_BASE}/v2/voices`, { headers: { 'X-Api-Key': heygenKey } })).json();
        const allVoices = (vdata.data?.voices || []) as VoiceRaw[];
        const langVoices = allVoices.filter((v) => ((v.language as string) || '').toLowerCase().includes(lang.toLowerCase()));
        if (langVoices.length > 0) {
          const genderMatch = voice_gender ? langVoices.find((v) => ((v.gender as string) || '').toLowerCase() === voice_gender.toLowerCase()) : null;
          chosenVoice = ((genderMatch || langVoices[0]).voice_id as string);
        } else if (allVoices.length > 0) {
          const enVoices = allVoices.filter((v) => ((v.language as string) || '').toLowerCase().includes('english'));
          chosenVoice = ((enVoices[0] || allVoices[0]).voice_id as string);
        } else return json({ error: 'No voices available from HeyGen' }, 500);
      } catch (e) { return json({ error: 'Failed to resolve voice: ' + (e as Error).message }, 500); }
    }

    try {
      const character = useTalkingPhoto
        ? { type: 'talking_photo', talking_photo_id, talking_style: 'expressive' }
        : { type: 'avatar', avatar_id: chosenAvatar, avatar_style: 'normal' };
      const motionText = motion_prompt || 'The person speaks naturally with hand gestures, slight body movement, and genuine facial expressions.';
      const videoPayload = {
        video_inputs: [{ character: { ...character, ...(useTalkingPhoto ? {} : { motion_prompt: motionText }) }, voice: { type: 'text', input_text: cleanScript, voice_id: chosenVoice, speed: 1.0 }, background: { type: 'color', value: '#1a1a1a' } }],
        dimension: { width: 1080, height: 1920 },
        callback_id: task_id || `reel_${Date.now()}`,
      };
      const r = await fetch(`${HEYGEN_BASE}/v2/video/generate`, { method: 'POST', headers: { 'X-Api-Key': heygenKey, 'Content-Type': 'application/json' }, body: JSON.stringify(videoPayload) });
      const data = await r.json();
      if (!r.ok || data.error) return json({ error: data.error?.message || data.message || 'Video generation failed' }, r.status || 500);
      const videoId = data.data?.video_id;
      if (task_id) {
        try {
          const { data: taskRow } = await sb.from('agent_tasks').select('content_data').eq('id', task_id).single();
          const cd = ((taskRow as Record<string, unknown>)?.content_data as Record<string, unknown>) || {};
          await sb.from('agent_tasks').update({ content_data: { ...cd, post_type: 'reel', reel_script: script, reel_avatar_id: chosenAvatar, reel_voice_id: chosenVoice, heygen_video_id: videoId, reel_status: 'processing' } }).eq('id', task_id);
        } catch { /* non-critical */ }
      }
      return json({ success: true, video_id: videoId, status: 'processing', message: 'הסרטון בתהליך יצירה. זה לוקח 2-5 דקות.' });
    } catch (e) { return json({ error: 'HeyGen: ' + (e as Error).message }, 500); }
  }

  if (type === 'reel-status') {
    const admin = await verifyAdmin(req);
    if (!admin && !isAgentSecret(req)) return json({ error: 'Unauthorized' }, 401);
    if (!heygenKey) return json({ error: 'HEYGEN_API_KEY not configured' }, 500);
    const videoId = url.searchParams.get('video_id');
    if (!videoId) return json({ error: 'video_id required' }, 400);
    try {
      const r = await fetch(`${HEYGEN_BASE}/v1/video_status.get?video_id=${videoId}`, { headers: { 'X-Api-Key': heygenKey } });
      const data = await r.json();
      if (!r.ok || data.error) return json({ error: data.error?.message || 'Status check failed' }, r.status);
      const vd = data.data || {};
      const result: Record<string, unknown> = { video_id: vd.video_id || videoId, status: vd.status, video_url: vd.video_url || null, thumbnail_url: vd.thumbnail_url || null, duration: vd.duration || null, gif_url: vd.gif_url || null, callback_id: vd.callback_id || null };
      if (result.status === 'completed' && result.video_url && result.callback_id) {
        try {
          const taskId = result.callback_id as string;
          if (taskId.match(/^[0-9a-f-]{36}$/)) {
            const { data: taskRow } = await sb.from('agent_tasks').select('content_data').eq('id', taskId).single();
            if (taskRow) await sb.from('agent_tasks').update({ content_data: { ...(taskRow as Record<string, unknown>).content_data as Record<string, unknown>, reel_status: 'ready', video_url: result.video_url, video_thumbnail: result.thumbnail_url } }).eq('id', taskId);
          }
        } catch { /* non-critical */ }
      }
      return json(result);
    } catch (e) { return json({ error: 'HeyGen status: ' + (e as Error).message }, 500); }
  }

  if (type === 'reel-webhook') {
    if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS_HEADERS });
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    const event = body || {};
    const eventType = (event.event_type as string) || (event.event as string);
    const eventData = (event.data as Record<string, unknown>) || event;

    if (eventType === 'avatar_video.success' || (eventData.status as string) === 'completed') {
      const videoUrl = ((eventData.url || eventData.video_url) as string);
      const callbackId = eventData.callback_id as string;
      const thumbnailUrl = eventData.thumbnail_url as string;
      if (videoUrl && callbackId && callbackId.match(/^[0-9a-f-]{36}$/)) {
        try {
          const vidRes = await fetch(videoUrl);
          if (vidRes.ok) {
            const vidBytes = new Uint8Array(await vidRes.arrayBuffer());
            const fname = `reel_${callbackId}_${Date.now()}.mp4`;
            const { error: upErr } = await sb.storage.from('ig-images').upload(fname, vidBytes, { contentType: 'video/mp4', upsert: false });
            let permanentUrl = videoUrl;
            if (!upErr) { const { data: { publicUrl } } = sb.storage.from('ig-images').getPublicUrl(fname); permanentUrl = publicUrl; }
            const { data: taskRow } = await sb.from('agent_tasks').select('content_data').eq('id', callbackId).single();
            if (taskRow) await sb.from('agent_tasks').update({ content_data: { ...(taskRow as Record<string, unknown>).content_data as Record<string, unknown>, reel_status: 'ready', video_url: permanentUrl, heygen_video_url: videoUrl, video_thumbnail: thumbnailUrl } }).eq('id', callbackId);
          }
        } catch { /* webhook processing error */ }
      }
      return json({ received: true });
    }

    if (eventType === 'avatar_video.fail' || (eventData.status as string) === 'failed') {
      const callbackId = eventData.callback_id as string;
      if (callbackId && callbackId.match(/^[0-9a-f-]{36}$/)) {
        try {
          const { data: taskRow } = await sb.from('agent_tasks').select('content_data').eq('id', callbackId).single();
          if (taskRow) await sb.from('agent_tasks').update({ content_data: { ...(taskRow as Record<string, unknown>).content_data as Record<string, unknown>, reel_status: 'failed', reel_error: (eventData.error as string) || 'Video generation failed' } }).eq('id', callbackId);
        } catch { /* non-critical */ }
      }
      return json({ received: true });
    }

    return json({ received: true, note: 'unhandled event type' });
  }

  // ── AUTO-CONTENT ─────────────────────────────────────────────────────
  if (type === 'auto-content') {
    const cronSecret  = Deno.env.get('CRON_SECRET') ?? '';
    const agentSecret = Deno.env.get('AGENT_SECRET') ?? '';
    const svcKey      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const authHeader  = req.headers.get('authorization') ?? '';
    const token       = authHeader.replace('Bearer ', '').trim()
                     || req.headers.get('x-agent-secret') || '';
    const isAuthed = (cronSecret && token === cronSecret)
                  || (agentSecret && token === agentSecret)
                  || (svcKey && token === svcKey);
    const adminOk = await verifyAdmin(req);
    if (!isAuthed && !adminOk) return json({ error: 'Unauthorized' }, 401);

    // Product catalog for rotation (matches Typography Map in CLAUDE.md)
    type ProductDef = { slogan: string; type: string; gender: string; format: string };
    const PRODUCTS: ProductDef[] = [
      { slogan: "I am not fat, I am a LIMITED edition.",       type: 'tshirt',     gender: 'unisex', format: 'feed_post'  },
      { slogan: "more of me to LOVE",                          type: 'tshirt',     gender: 'unisex', format: 'feed_post'  },
      { slogan: "NAPPING IS MY CARDIO",                        type: 'hoodie',     gender: 'unisex', format: 'feed_post'  },
      { slogan: "I survived. That's enough.",                  type: 'tshirt',     gender: 'unisex', format: 'feed_post'  },
      { slogan: "low maintenance VALUE high",                  type: 'tshirt',     gender: 'unisex', format: 'quote_card' },
      { slogan: "Not a model. NEVER. wanted to be.",           type: 'hoodie',     gender: 'unisex', format: 'feed_post'  },
      { slogan: "NAP — Born to nap, forced to work",           type: 'tshirt',     gender: 'unisex', format: 'feed_post'  },
      { slogan: "certified OVER thinker",                      type: 'ziphoodie',  gender: 'unisex', format: 'feed_post'  },
      { slogan: "serial NAPPER",                               type: 'longsleeve', gender: 'unisex', format: 'feed_post'  },
      { slogan: "She believed she could, so she took a NAP.",  type: 'tshirt',     gender: 'women',  format: 'feed_post'  },
      { slogan: "COFFEE — I run on coffee and sarcasm.",       type: 'tshirt',     gender: 'women',  format: 'feed_post'  },
      { slogan: "Zero Motivation CLUB",                        type: 'hoodie',     gender: 'women',  format: 'feed_post'  },
      { slogan: "emotionally attached to my COUCH",            type: 'longsleeve', gender: 'women',  format: 'feed_post'  },
    ];

    // Skip if a content task was already created today
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const { data: todayTask } = await sb.from('agent_tasks')
      .select('id')
      .eq('agent_id', 'content')
      .gte('created_at', todayStart.toISOString())
      .limit(1);
    if (todayTask?.length) {
      return json({ skipped: true, reason: 'Content task already created today', task_id: (todayTask[0] as Record<string, unknown>).id });
    }

    // Find product not recently featured (check last N tasks)
    type TaskRow = Record<string, unknown>;
    const { data: recentTasks } = await sb.from('agent_tasks')
      .select('content_data')
      .eq('agent_id', 'content')
      .order('created_at', { ascending: false })
      .limit(PRODUCTS.length);
    const recentSlogans = new Set<string>((recentTasks || []).map((t: TaskRow) => {
      const cd = (t.content_data as TaskRow) || {};
      return (cd.product_slogan as string) || '';
    }).filter(Boolean));

    let picked = PRODUCTS.find(p => !recentSlogans.has(p.slogan));
    if (!picked) {
      // All products recently used — cycle by day of week
      picked = PRODUCTS[new Date().getDay() % PRODUCTS.length];
    }

    const typeLabels: Record<string, string> = {
      tshirt: 'חולצה', hoodie: 'קפוצון', ziphoodie: 'קפוצון זיפ', longsleeve: 'ארוכת שרוול', cap: 'כובע',
    };
    const { data: newTask, error: insertErr } = await sb.from('agent_tasks').insert({
      agent_id:     'content',
      title:        `Instagram Post — ${picked.slogan.substring(0, 50)}`,
      description:  `פוסט אוטומטי: ${typeLabels[picked.type] || picked.type} — "${picked.slogan}"`,
      category:     'social_post',
      status:       'approved',
      priority:     'medium',
      content_data: {
        format:         picked.format,
        product_type:   picked.type,
        product_slogan: picked.slogan,
        product_gender: picked.gender,
        language:       'he',
        auto_created:   true,
        created_by:     'auto-content-cron',
      },
    }).select('id').single();

    if (insertErr) return json({ error: insertErr.message }, 500);

    return json({
      success: true,
      task_id: (newTask as Record<string, unknown>)?.id,
      product: picked.slogan,
      format:  picked.format,
      message: 'Content task created ✅ — content-run will generate caption and image',
    });
  }

  return json({
    error: 'Invalid type. Valid types: tasks, runs, run, generate-image, generate-product-image, product-images, products-catalog, smart-match, publish, gemini-models, content-run, fb-debug, publish-ready, avatars, voices, heygen-status, upload-reel-photo, upload-talking-photo, generate-reel, reel-status, reel-webhook, auto-content',
  }, 400);
});
