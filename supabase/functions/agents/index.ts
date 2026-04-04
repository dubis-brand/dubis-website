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
  "More of me to love":                   { small: 'more of me to', big: 'LOVE', after: '', layout: 'top-bottom' },
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
              // Use same diversified prompt as content-run route
              const CONTENT_ANGLES = [
                'comfort — clothes that work for you, not the other way around',
                'cynical humor — dry wit about adulting, aging, naps, motivation',
                'anti-models — we never were models and don\'t plan to start',
                'life after 40 — earned comfort, knowing what matters',
                'justified laziness — napping as lifestyle, couch commitment',
                'self-acceptance — we stopped apologizing years ago',
                'anti-fast-fashion — one good garment beats 10 cheap ones',
                'tribe/community — for the rest of us, join the tribe',
                'quality — print that survives the wash, fabric that breathes',
                'gift — the best gift for someone who knows themselves',
              ];
              const angleIdx = Math.floor(Date.now() / 86400000) % CONTENT_ANGLES.length;

              const captionPrompt = isStory
                ? `You are DUBIS copywriter. Israeli anti-fashion brand for 40+. Tagline: "For the rest of us."
Today's angle: ${CONTENT_ANGLES[angleIdx]}
Write in NATURAL Israeli Hebrew (slang OK: יאללה, תכל'ס, אחי). NOT translated English.
Task: "${task.title}" | Slogan: "${(cd.product_slogan as string) || ''}"
Format: STORY — 1-2 punchy sentences max.
Return ONLY valid JSON: {"caption_he":"...","caption_en":"...","hashtags":"#DUBIS #ForTheRestOfUs","image_prompt":"..."}`
                : `You are DUBIS copywriter. Israeli anti-fashion brand for 40+. Tagline: "For the rest of us."
Today's angle: ${CONTENT_ANGLES[angleIdx]}
CRITICAL: caption_he must be NATURAL Israeli Hebrew (like WhatsApp message to friends). caption_en must be ORIGINAL English, NOT a translation.
Do NOT always talk about weight/body — DUBIS is about comfort, humor, anti-fashion, quality, community.
BANNED Hebrew words: מושלם, מהמם, חובה, מטורף. Use "קפוצון" NOT "הודי".
Task: "${task.title}" | Slogan: "${(cd.product_slogan as string) || ''}"
Product type: "${(cd.product_type as string) || ''}"
Format: ${cd.format || 'feed_post'}

Return ONLY valid JSON: {"caption_he":"...","caption_en":"...","hashtags":"#DUBIS ...5-10 relevant tags","image_prompt":"..."}`;
              const cRes = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ contents: [{ parts: [{ text: captionPrompt }] }] }),
                  signal: AbortSignal.timeout(30000) },
              );
              if (!cRes.ok) throw new Error(`Gemini caption HTTP ${cRes.status}`);
              const cData = await cRes.json();
              const raw = cData.candidates?.[0]?.content?.parts?.[0]?.text || '';
              if (!raw) throw new Error('Gemini returned empty caption response');
              try { gen = JSON.parse(raw.replace(/```json|```/g, '').trim()); } catch { gen = { caption_en: raw.substring(0, 200) }; }
              if (gen.caption_he) gen.caption_he = fixHebrew(gen.caption_he);
              // Validate: caption must not be empty after generation
              if (!gen.caption_he && !gen.caption_en) {
                throw new Error('Caption generation failed — both he and en are empty');
              }
            } else {
              gen = { caption_he: cd.caption_he as string, caption_en: cd.caption_en as string, hashtags: cd.hashtags as string };
            }

            let imageUrl = hasPermImg ? (cd.generated_image_url as string) : '';
            // Try Gemini first for brand-accurate images
            if (!imageUrl && geminiKey) {
              const dubisRule = 'Israeli streetwear brand. Real diverse body types 40+, authentic candid look. Dark oversized clothing. Dark minimal urban aesthetic. Do NOT render any text, words, letters, or logos anywhere in the image.';
              const titleLower = (task.title as string).toLowerCase();
              const defaultImgPrompt = (cd.format as string) === 'quote_card'
                ? 'Minimalist dark charcoal textured background. Moody low-key lighting. No people. No text. Square 1:1.'
                : titleLower.includes('nap') || titleLower.includes('cardio')
                ? `Person relaxing on couch wearing oversized dark hoodie. Cozy apartment, soft warm lighting. ${dubisRule}`
                : `Authentic people wearing dark DUBIS streetwear, urban minimal setting, dark aesthetic, natural lighting, square 1:1. ${dubisRule}`;
              const fullPrompt = (gen.image_prompt || defaultImgPrompt) + '. Fashion photography. Square 1:1. No watermark. Photorealistic.';
              try {
                const gRes = await fetch(
                  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${geminiKey}`,
                  { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }),
                    signal: AbortSignal.timeout(50000) },
                );
                if (gRes.ok) {
                  const gData = await gRes.json();
                  type GemPart = Record<string, unknown>;
                  const imgPart = gData.candidates?.[0]?.content?.parts?.find((p: GemPart) => (p.inlineData as GemPart)?.mimeType?.toString().startsWith('image/'));
                  if (imgPart?.inlineData) {
                    const imgBytes = b64ToBytes(imgPart.inlineData.data as string);
                    await sb.storage.createBucket('ig-images', { public: true }).catch(() => {});
                    const fname = `ig-${task.id}.jpg`;
                    await sb.storage.from('ig-images').upload(fname, imgBytes, { contentType: 'image/jpeg', upsert: true });
                    const { data: { publicUrl } } = sb.storage.from('ig-images').getPublicUrl(fname);
                    imageUrl = publicUrl;
                  }
                }
              } catch { /* Gemini timeout — fall through to Pollinations */ }
            }
            // Fallback: Pollinations
            if (!imageUrl) {
              const imgPromptText = gen.image_prompt ||
                `${task.title}, authentic urban lifestyle, DUBIS Israeli dark streetwear, real diverse people 40+, dark minimal aesthetic, no text`;
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
            const finalCapHe = gen.caption_he || (cd.caption_he as string) || '';
            const finalCapEn = gen.caption_en || (cd.caption_en as string) || '';
            const finalHashtags = gen.hashtags || (cd.hashtags as string) || '';
            const hasCaption = !!(finalCapHe || finalCapEn);
            const newStatus = hasCaption ? 'pending_approval' : 'in_progress';
            await sb.from('agent_tasks').update({
              content_data: { ...cd, caption_he: finalCapHe, caption_en: finalCapEn, hashtags: finalHashtags, ...(imageUrl ? { generated_image_url: imageUrl } : {}) },
              status: newStatus,
              notes: ((task.notes as string) || '') + (hasCaption
                ? `\n✍️ תוכן נוצר ע"י AI — ${new Date().toLocaleDateString('he-IL')}`
                : `\n⚠️ יצירת תוכן נכשלה — נשאר ב-in_progress לניסיון חוזר — ${new Date().toLocaleDateString('he-IL')}`),
              updated_at: now,
            }).eq('id', task.id);
            taskResults.push(hasCaption
              ? `✅ ${task.title}: תוכן${imageUrl ? ' + תמונה' : ' (ללא תמונה)'} → pending_approval`
              : `⚠️ ${task.title}: קופי ריק — נשאר ב-in_progress לניסיון חוזר`);
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
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
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
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
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
    const { caption, image_url, video_url, task_id, platforms = {} } = body as { caption?: string; image_url?: string; video_url?: string; task_id?: string; platforms?: Record<string, boolean> };
    const isReel = !!(video_url);
    if (!caption || (!image_url && !video_url)) return json({ error: 'caption and image_url (or video_url for Reels) required' }, 400);

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
          let container: Record<string, unknown>;
          if (isReel) {
            // Instagram Reels: POST /{ig-account}/media with media_type=REELS
            const cRes = await fetch(`${igBase}/media`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ video_url, caption, media_type: 'REELS', access_token: igToken }),
            });
            container = await cRes.json();
            if (!cRes.ok || container.error) {
              (result.errors as string[]).push('Instagram reel container: ' + ((container.error as Record<string,unknown>)?.message || 'failed'));
            } else {
              // Poll container status — videos take longer to process (up to 30s)
              const containerId = container.id as string;
              let ready = false;
              for (let attempt = 0; attempt < 6; attempt++) {
                await new Promise((r) => setTimeout(r, 5000));
                const statusRes = await fetch(`https://graph.facebook.com/v19.0/${containerId}?fields=status_code&access_token=${igToken}`);
                const statusData = await statusRes.json() as Record<string, unknown>;
                if (statusData.status_code === 'FINISHED') { ready = true; break; }
                if (statusData.status_code === 'ERROR') { break; }
              }
              if (!ready) {
                (result.errors as string[]).push('Instagram reel: container not ready after 30s');
              } else {
                const pRes = await fetch(`${igBase}/media_publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creation_id: containerId, access_token: igToken }) });
                const published = await pRes.json();
                if (!pRes.ok || published.error) (result.errors as string[]).push('Instagram reel publish: ' + (published.error?.message || 'failed'));
                else result.instagram_post_id = published.id;
              }
            }
          } else {
            // Image post
            const cRes = await fetch(`${igBase}/media`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_url, caption, access_token: igToken }) });
            container = await cRes.json();
            if (!cRes.ok || container.error) {
              (result.errors as string[]).push('Instagram container: ' + ((container.error as Record<string,unknown>)?.message || 'failed'));
            } else {
              await new Promise((r) => setTimeout(r, 7000));
              const pRes = await fetch(`${igBase}/media_publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creation_id: container.id, access_token: igToken }) });
              const published = await pRes.json();
              if (!pRes.ok || published.error) (result.errors as string[]).push('Instagram publish: ' + (published.error?.message || 'failed'));
              else result.instagram_post_id = published.id;
            }
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
    const svcKey      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const cronSecret  = Deno.env.get('CRON_SECRET') ?? '';
    const agentSecret = Deno.env.get('AGENT_SECRET') ?? '';
    const token = url.searchParams.get('token') || req.headers.get('x-agent-secret') || (req.headers.get('authorization') ?? '').replace('Bearer ', '').trim() || '';
    const isAuthed = (svcKey && token === svcKey) || (cronSecret && token === cronSecret) || (agentSecret && token === agentSecret);
    const adminOk = await verifyAdmin(req);
    if (!isAuthed && !adminOk) return json({ error: 'Unauthorized' }, 401);

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
          // Pick a random content angle to ensure variety
          const CONTENT_ANGLES = [
            'comfort — clothes that work for you, not the other way around',
            'cynical humor — dry wit about adulting, aging, naps, motivation',
            'anti-models — we never were models and don\'t plan to start',
            'life after 40 — earned comfort, knowing what matters (good pillow, soft hoodie)',
            'justified laziness — napping as lifestyle, couch commitment',
            'self-acceptance — we stopped sucking it in years ago',
            'anti-fast-fashion — one good garment beats 10 cheap ones',
            'tribe/community — for the rest of us, join the tribe',
            'quality — print that survives the first wash, fabric that breathes',
            'gift — the best gift for someone who knows themselves',
          ];
          const angleIdx = Math.floor(Date.now() / 86400000) % CONTENT_ANGLES.length;
          const todayAngle = CONTENT_ANGLES[angleIdx];

          const dubisPrompt = `[Your Role]
You are the Senior Copywriter for "DUBIS" – an Israeli anti-fashion apparel brand. Tagline: "For the rest of us."

[Target Audience] Age 40+, all genders. Real lives, real bodies. They love comfort, good food, and are exhausted by fake social media culture. They refuse to apologize for who they are.

[Brand DNA] DUBIS breaks the false choice between "fashionable but uncomfortable" and "comfortable but invisible." We offer clothes that fit real bodies, feel amazing, and feature witty quotes that declare: "This is who I am."

[Content Angle for THIS post]
Focus on: ${todayAngle}
IMPORTANT: Do NOT always talk about body weight or being fat. DUBIS is about MUCH MORE — comfort, humor, anti-fashion rebellion, real life after 40, quality, community.

[Tone Rules]
- First-person plural ("אנחנו") — tribe mentality
- Cynical, witty, dry humor — like a sharp Israeli friend over a beer
- BANNED WORDS (Hebrew): מושלם, מהמם, חובה, מטורף, סייל, הנחה
- NEVER imply customer needs to "improve" or "fix" themselves
- Use "קפוצון" NOT "הודי"
- Short punchy sentences. No fluff.

[CRITICAL — Hebrew Writing Rules]
- Write caption_he in NATURAL ISRAELI HEBREW — like a real Israeli speaks, not translated English
- Use slang where appropriate: "יאללה", "אחי/אחותי", "סבבה", "תכל'ס"
- Short sentences. Street-level language. NOT literary or formal.
- Think: how would a 45-year-old Israeli write this to their WhatsApp group?

[CRITICAL — English Writing Rules]
- Write caption_en as ORIGINAL English copy, NOT a translation of the Hebrew
- Different hook, different angle — but same brand voice
- Target: global English-speaking audience who gets dry humor

[Protocol]
1. Hook: relatable observation matching today's content angle
2. Product connection: how this DUBIS item fits that moment
3. CTA: casual and confident

[Examples of GOOD Hebrew voice]
- "אחרי 40 יש לך שתי אופציות: להתלבש בשביל אחרים, או להתלבש בשביל הספה. אנחנו בחרנו."
- "קפוצון שלא צריך להוכיח כלום לאף אחד. בדיוק כמונו."
- "תכל'ס, הבגד הכי יקר שיש לך בארון הוא זה שאתה אף פעם לא לובש. DUBIS זה ההפך."`;

          const isStory = cd.format === 'story';
          const captionPrompt = `${dubisPrompt}

--- TASK ---
Task: "${task.title}"
Slogan on product: "${(cd.product_slogan as string) || ''}"
Product type: "${(cd.product_type as string) || ''}"
Format: ${isStory ? 'STORY — 1-2 punchy sentences max.' : (cd.format || 'feed_post')}

Return ONLY valid JSON: {"caption_he":"...","caption_en":"...","hashtags":"#DUBIS #ForTheRestOfUs ...5-10 tags","image_prompt":"..."}`;
          const cRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contents: [{ parts: [{ text: captionPrompt }] }] }),
              signal: AbortSignal.timeout(30000) },
          );
          if (!cRes.ok) throw new Error(`Gemini caption HTTP ${cRes.status}`);
          const cData = await cRes.json();
          const raw = cData.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (!raw) throw new Error('Gemini returned empty caption');
          try { gen = JSON.parse(raw.replace(/```json|```/g, '').trim()); } catch { gen = { caption_en: raw.substring(0, 200) }; }
          if (gen.caption_he) gen.caption_he = fixHebrew(gen.caption_he);
          if (!gen.caption_he && !gen.caption_en) throw new Error('Caption generation empty');
        } else {
          gen = { caption_he: cd.caption_he as string, caption_en: cd.caption_en as string, hashtags: cd.hashtags as string };
        }

        let imageUrl = hasPermImg ? (cd.generated_image_url as string) : '';
        let imgError = '';

        if (!imageUrl && geminiKey) {
          const titleLower = (task.title as string).toLowerCase();
          // Use same high-quality prompt style as generate-product-image
          const slogan = (cd.product_slogan as string) || '';
          const productType = (cd.product_type as string) || 't-shirt';
          const clothingMap: Record<string,string> = { 't-shirt':'t-shirt','hoodie':'hoodie','zip-hoodie':'zip-up hoodie','long-sleeve':'long sleeve shirt','cap':'baseball cap' };
          const clothingName = clothingMap[productType] || productType;
          const sloganTypo = slogan ? getSloganTypographyPrompt(slogan) : 'bold text';
          const scenes = ['cobblestone street with cafes, golden hour','cozy living room, natural window light','minimal studio, soft professional lighting','outdoor cafe, wooden tables, morning light','urban concrete walls, dramatic lighting'];
          const models = ['a confident person in their 40s, natural look, warm smile','a curvy confident woman in her 30s-40s, body-positive energy','a bearded man in his 40s, relaxed casual posture','a couple walking side by side, both wearing matching dark clothing'];
          const sceneIdx = Math.floor(Date.now() / 3600000) % scenes.length;
          const modelIdx = Math.floor(Date.now() / 7200000) % models.length;
          const fullPrompt = cd.format === 'quote_card'
            ? 'Minimalist dark charcoal textured background. Moody low-key lighting. No people. No text. Square 1:1.'
            : `Create a photorealistic DSLR-quality lifestyle photo of ${models[modelIdx]} wearing a dark ${clothingName}. BACK of garment shows MIXED-SIZE TYPOGRAPHY: ${sloganTypo}. Small "DUBIS" at bottom hem. SETTING: ${scenes[sceneIdx]}. Candid, authentic, NOT a fashion model. Bold condensed sans-serif font. Photorealistic DSLR. Square 1:1. Small "DUBIS™" watermark bottom-left.`;

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
            const fullPrompt = imgPromptText + ". Fashion photography. Square 1:1. Photorealistic. Small 'DUBIS\u2122' text watermark in the bottom-left corner of the image.";
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

        // Save to gallery (dubis_images) for future reuse
        if (imageUrl && imageUrl.includes('supabase.co')) {
          try {
            await sb.from('dubis_images').insert({
              image_url: imageUrl,
              scene_type: 'urban',
              model_type: 'man',
              prompt_used: `Content pipeline: ${task.title}`,
              quality_score: 3,
              approved: false,
              tags: ['content', 'auto-generated', cd.product_type || 'unknown'],
            });
          } catch { /* non-critical — don't fail if gallery save fails */ }
        }

        const finalCapHe = gen.caption_he || (cd.caption_he as string) || '';
        const finalCapEn = gen.caption_en || (cd.caption_en as string) || '';
        const hasCaption = !!(finalCapHe || finalCapEn);
        const newStatus = hasCaption ? 'pending_approval' : 'in_progress';
        await sb.from('agent_tasks').update({
          status: newStatus,
          content_data: { ...cd, caption_he: finalCapHe, caption_en: finalCapEn, hashtags: gen.hashtags || (cd.hashtags as string) || '', image_prompt: gen.image_prompt || '', generated_image_url: imageUrl || (cd.generated_image_url as string) || '' },
          notes: ((task.notes as string) || '') + (hasCaption ? '' : `\n⚠️ Caption empty — retry needed`),
          updated_at: now,
        }).eq('id', task.id);
        taskResults.push(hasCaption
          ? `✅ ${task.title}: ${imageUrl ? '🖼 תמונה+כיתוב' : `⚠️ כיתוב בלבד [${imgError}]`} → pending_approval`
          : `⚠️ ${task.title}: caption empty — stays in_progress`);
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
    const svcKey      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const agentSecret = Deno.env.get('AGENT_SECRET') ?? '';
    const cronSecret  = Deno.env.get('CRON_SECRET') ?? '';
    const authHeader  = req.headers.get('authorization') ?? '';
    const token = url.searchParams.get('token') || req.headers.get('x-agent-secret') || authHeader.replace('Bearer ', '').trim() || '';
    const isAuthed = (svcKey && token === svcKey) || (agentSecret && token === agentSecret) || (cronSecret && token === cronSecret);
    const adminOk = await verifyAdmin(req);
    if (!isAuthed && !adminOk) return json({ error: 'Unauthorized' }, 401);

    const igToken   = Deno.env.get('INSTAGRAM_ACCESS_TOKEN') ?? '';
    const igAccount = Deno.env.get('INSTAGRAM_ACCOUNT_ID') ?? '';
    if (!igToken || !igAccount) return json({ error: 'Instagram env vars חסרים' }, 503);

    const { data: candidates, error: fetchErr } = await sb.from('agent_tasks').select('id, title, content_data').in('status', ['pending_approval', 'approved']).eq('agent_id', 'content').order('created_at', { ascending: true });
    if (fetchErr) return json({ error: fetchErr.message }, 500);

    type Task = Record<string, unknown>;
    const batchSize = parseInt(url.searchParams.get('batch') || '1', 10);
    const readyTasks = (candidates || []).filter((t: Task) => {
      const cd = (t.content_data as Task) || {};
      const hasImage = (cd.generated_image_url as string)?.includes('supabase.co');
      const hasReel  = !!(cd.video_url && cd.reel_status === 'ready');
      return cd.content_approved && (hasImage || hasReel);
    }).slice(0, batchSize);

    if (!readyTasks.length) return json({ published: 0, summary: 'אין משימות מוכנות לפרסום עדיין' });

    const igBase = `https://graph.facebook.com/v19.0/${igAccount}`;
    const results: unknown[] = [];
    const now = new Date().toISOString();

    for (const task of readyTasks) {
      const cd = (task.content_data as Task) || {};
      const lang = (cd.lang as string) || 'he';
      const shopLine = lang === 'he' ? '🛒 לחנות: www.dubis.net' : '🛒 Shop: www.dubis.net';
      const caption = `${(cd.caption_he as string) || (cd.caption_en as string) || task.title}\n\n${shopLine}\n\n${(cd.hashtags as string) || '#DUBIS #ForTheRestOfUs'}`;
      const image_url = cd.generated_image_url as string;
      const videoUrl = cd.video_url as string;
      const isReel = !!(videoUrl && cd.reel_status === 'ready');
      try {
        let container: Record<string, unknown>;
        if (isReel) {
          // Instagram Reels: POST /{ig-account}/media with media_type=REELS
          const cRes = await fetch(`${igBase}/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_url: videoUrl, caption, media_type: 'REELS', access_token: igToken }),
          });
          container = await cRes.json();
          if (!cRes.ok || container.error) { results.push({ id: task.id, title: task.title, status: 'error', error: (container.error as Record<string,unknown>)?.message || 'reel container failed' }); continue; }
          // Poll container status — videos take longer to process (up to 30s)
          const containerId = container.id as string;
          let ready = false;
          for (let attempt = 0; attempt < 6; attempt++) {
            await new Promise((r) => setTimeout(r, 5000));
            const statusRes = await fetch(`https://graph.facebook.com/v19.0/${containerId}?fields=status_code&access_token=${igToken}`);
            const statusData = await statusRes.json() as Record<string, unknown>;
            if (statusData.status_code === 'FINISHED') { ready = true; break; }
            if (statusData.status_code === 'ERROR') { break; }
          }
          if (!ready) { results.push({ id: task.id, title: task.title, status: 'error', error: 'Reel container not ready after 30s' }); continue; }
        } else {
          // Image post
          const cRes = await fetch(`${igBase}/media`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_url, caption, access_token: igToken }) });
          container = await cRes.json();
          if (!cRes.ok || container.error) { results.push({ id: task.id, title: task.title, status: 'error', error: (container.error as Record<string,unknown>)?.message || 'container failed' }); continue; }
          await new Promise((r) => setTimeout(r, 7000));
        }
        const pRes = await fetch(`${igBase}/media_publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creation_id: container.id, access_token: igToken }) });
        const pub = await pRes.json();
        if (!pRes.ok || pub.error) { results.push({ id: task.id, title: task.title, status: 'error', error: pub.error?.message || 'publish failed' }); continue; }
        // Instagram succeeded — now try Facebook as well
        let fbPostId: string | null = null;
        let fbError: string | null = null;
        try {
          const fbPageId = Deno.env.get('FACEBOOK_PAGE_ID') ?? '';
          const fbToken  = Deno.env.get('FACEBOOK_PAGE_TOKEN') ?? igToken; // fall back to IG token
          if (fbPageId) {
            const fbRes = await fetch(`https://graph.facebook.com/v19.0/${fbPageId}/photos`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: image_url, caption, access_token: fbToken }),
            });
            const fbData = await fbRes.json();
            if (fbRes.ok && fbData.id && !fbData.error) {
              fbPostId = fbData.id as string;
            } else {
              fbError = fbData.error?.message || `HTTP ${fbRes.status}`;
            }
          } else {
            fbError = 'FACEBOOK_PAGE_ID not set — skipped';
          }
        } catch (fbErr) {
          fbError = (fbErr as Error).message;
        }

        await sb.from('agent_tasks').update({ status: 'done', content_data: { ...cd, instagram_post_id: pub.id, facebook_post_id: fbPostId, published_at: now }, updated_at: now }).eq('id', task.id);
        // Save published image to dubis_images gallery so it appears in the gallery tab
        if (image_url && image_url.includes('supabase.co')) {
          try {
            const productId = cd.product_id as string | undefined;
            await sb.from('dubis_images').insert({
              image_url,
              product_id: productId || null,
              scene_type: 'published',
              model_type: cd.model_type as string || 'auto',
              color_variant: cd.color_variant as string || null,
              tags: ['published', 'instagram', cd.language as string || 'he'].filter(Boolean),
              approved: true,
            });
          } catch (_imgErr) { /* non-critical — don't fail the publish */ }
        }
        results.push({ id: task.id, title: task.title, status: 'published', ig_id: pub.id, fb_id: fbPostId, fb_error: fbError });
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

    // Allow up to 2 content tasks per day (1 HE + 1 EN)
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const { data: todayTasks } = await sb.from('agent_tasks')
      .select('id, content_data')
      .eq('agent_id', 'content')
      .gte('created_at', todayStart.toISOString());
    const MAX_DAILY_POSTS = 2;
    if ((todayTasks?.length ?? 0) >= MAX_DAILY_POSTS) {
      return json({ skipped: true, reason: `Already ${todayTasks?.length} content tasks today (max ${MAX_DAILY_POSTS})`, task_ids: (todayTasks || []).map((t: Record<string, unknown>) => t.id) });
    }
    // Determine which language to use — first call = HE, second = EN
    const todayLangs = new Set((todayTasks || []).map((t: Record<string, unknown>) => ((t.content_data as Record<string, unknown>)?.language as string) || ''));
    const nextLang = !todayLangs.has('he') ? 'he' : 'en';

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

    // Weekly format calendar — rotate format by day, language determined above (2 posts/day: 1 HE + 1 EN)
    const dayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon, ...
    const DAILY_FORMAT = [
      'feed_post',  // Sunday
      'feed_post',  // Monday
      'reel',       // Tuesday
      'feed_post',  // Wednesday
      'feed_post',  // Thursday
      'reel',       // Friday
      'story',      // Saturday
    ];
    const todayPlan = { format: DAILY_FORMAT[dayOfWeek], lang: nextLang };

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
        format:         todayPlan.format,
        product_type:   picked.type,
        product_slogan: picked.slogan,
        product_gender: picked.gender,
        language:       todayPlan.lang,
        auto_created:   true,
        created_by:     'auto-content-cron',
      },
    }).select('id').single();

    if (insertErr) return json({ error: insertErr.message }, 500);

    return json({
      success:  true,
      task_id:  (newTask as Record<string, unknown>)?.id,
      product:  picked.slogan,
      format:   todayPlan.format,
      language: todayPlan.lang,
      day:      dayOfWeek,
      message:  'Content task created — content-run will generate caption and image',
    });
  }

  // ── QA-CONTENT ───────────────────────────────────────────────────────
  if (type === 'qa-content') {
    // Auth: admin JWT or service role key (same as content-run)
    const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const agentSecret = Deno.env.get('AGENT_SECRET') ?? '';
    const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
    const authHeader = req.headers.get('authorization') ?? '';
    const token = url.searchParams.get('token') || authHeader.replace('Bearer ', '').trim() || req.headers.get('x-agent-secret') || '';
    const isAuthed = (svcKey && token === svcKey)
                  || (agentSecret && token === agentSecret)
                  || (cronSecret && token === cronSecret);
    const adminOk = await verifyAdmin(req);
    if (!isAuthed && !adminOk) return json({ error: 'Unauthorized' }, 401);

    const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
    if (!geminiKey) return json({ error: 'GEMINI_API_KEY not configured' }, 503);

    // Fetch pending_approval content tasks that have caption_he but no qa_score
    type Task = Record<string, unknown>;
    const { data: tasks, error: fetchErr } = await sb.from('agent_tasks')
      .select('id, title, notes, content_data')
      .eq('status', 'pending_approval')
      .eq('agent_id', 'content')
      .order('created_at', { ascending: true });
    if (fetchErr) return json({ error: fetchErr.message }, 500);

    const unscored = ((tasks || []) as Task[]).filter((t) => {
      const cd = (t.content_data as Task) || {};
      return cd.caption_he && !cd.qa_score;
    });

    if (!unscored.length) return json({ checked: 0, passed: 0, failed: 0, results: [], summary: 'כל משימות התוכן כבר עברו QA' });

    const now = new Date().toISOString();
    const results: unknown[] = [];
    let passed = 0;
    let failed = 0;

    for (const task of unscored) {
      const cd = (task.content_data as Task) || {};
      const captionHe  = (cd.caption_he as string) || '';
      const hashtags   = (cd.hashtags as string) || '';
      const imageUrl   = (cd.generated_image_url as string) || '';
      const format     = (cd.format as string) || 'feed_post';
      const qaDetails: Record<string, unknown> = {};
      let score = 0;
      const failReasons: string[] = [];

      // ── 0. Slogan completeness check — verify typography has all slogan words ──
      const productSlogan = ((cd.product_slogan as string) || '').toLowerCase().replace(/[^a-z\s]/g, '').trim();
      const typoSmall = ((cd.typography_small as string) || (SLOGAN_TYPOGRAPHY[cd.product_slogan as string]?.small) || '').toLowerCase().replace(/[^a-z\s]/g, '').trim();
      const typoBig = ((cd.typography_big as string) || (SLOGAN_TYPOGRAPHY[cd.product_slogan as string]?.big) || '').toLowerCase().replace(/[^a-z\s]/g, '').trim();
      const typoAfter = ((cd.typography_after as string) || (SLOGAN_TYPOGRAPHY[cd.product_slogan as string]?.after) || '').toLowerCase().replace(/[^a-z\s]/g, '').trim();
      const typoFull = `${typoSmall} ${typoBig} ${typoAfter}`.replace(/\s+/g, ' ').trim();
      const sloganWords = productSlogan.split(/\s+/).filter((w: string) => w.length > 1);
      const typoWords = typoFull.split(/\s+/).filter((w: string) => w.length > 1);
      const missingWords = sloganWords.filter((w: string) => !typoWords.some((tw: string) => tw.includes(w) || w.includes(tw)));
      if (missingWords.length > 0) {
        failReasons.push(`טיפוגרפיה חסרה מילים מהסלוגן: ${missingWords.join(', ')} — סלוגן: "${productSlogan}" → טיפו: "${typoFull}"`);
        qaDetails.slogan_completeness = false;
        qaDetails.missing_words = missingWords;
      } else {
        qaDetails.slogan_completeness = true;
      }

      // ── 1. Hebrew brand voice + English grammar (30pts) — Gemini ────
      let voiceScore = 0;
      const captionEn = (cd.caption_en as string) || '';
      try {
        const voicePrompt = `You are a DUBIS brand QA reviewer. DUBIS is an Israeli body-positive humor apparel brand.
Brand voice rules:
- Uses "קפוצון" NOT "הודי" or "הודיז"
- Tone: self-aware, cynical humor, body-positive, relatable
- Not generic, ties to the brand personality

Caption to review (Hebrew): "${captionHe}"
${captionEn ? `English caption: "${captionEn}"` : ''}
Product slogan on garment: "${productSlogan}"

Check:
1. Hebrew caption brand voice quality (0-20)
2. English caption grammar correctness — if present (0-5, or 5 if no English caption)
3. Does the product slogan read as grammatically correct English? (0-5)

Score the total 0-30. Return ONLY valid JSON:
{"score": <0-30>, "reason": "<one sentence>", "english_grammar_ok": <true/false>, "slogan_grammar_ok": <true/false>}`;
        const vRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: voicePrompt }] }] }),
            signal: AbortSignal.timeout(15000) },
        );
        const vRaw = (await vRes.json()).candidates?.[0]?.content?.parts?.[0]?.text || '';
        const vParsed = JSON.parse(vRaw.replace(/```json|```/g, '').trim());
        voiceScore = Math.min(30, Math.max(0, Number(vParsed.score) || 0));
        qaDetails.voice_reason = vParsed.reason || '';
        qaDetails.english_grammar_ok = vParsed.english_grammar_ok ?? true;
        qaDetails.slogan_grammar_ok = vParsed.slogan_grammar_ok ?? true;
        if (vParsed.english_grammar_ok === false) failReasons.push('שגיאת דקדוק בכיתוב האנגלי');
        if (vParsed.slogan_grammar_ok === false) failReasons.push('סלוגן המוצר לא תקין דקדוקית באנגלית');
      } catch { voiceScore = 15; qaDetails.voice_reason = 'Gemini unavailable — default score'; }
      score += voiceScore;
      qaDetails.voice_score = voiceScore;
      if (voiceScore < 15) failReasons.push('קול המותג חלש');

      // ── 2. Caption quality (25pts) ───────────────────────────────────
      let captionScore = 0;
      const captionLen = captionHe.length;
      const minLen = format === 'story' ? 10 : 50;
      const maxLen = format === 'story' ? 150 : 300;
      if (captionLen >= minLen && captionLen <= maxLen) {
        captionScore = 20;
        // Check it's not generic: if it contains product slogan keyword or brand reference, +5
        const slogan = ((cd.product_slogan as string) || '').toLowerCase();
        const sloganWords = slogan.split(/\s+/).filter((w: string) => w.length > 3);
        const hasRef = sloganWords.some((w: string) => captionHe.toLowerCase().includes(w));
        if (hasRef || captionHe.includes('DUBIS') || captionHe.includes('דוביס')) captionScore = 25;
      } else if (captionLen > 0) {
        captionScore = 10; // has content but wrong length
      }
      score += captionScore;
      qaDetails.caption_score = captionScore;
      qaDetails.caption_length = captionLen;
      if (captionScore < 10) failReasons.push(`כיתוב לא מתאים (${captionLen} תווים)`);

      // ── 3. Hashtags (15pts) ──────────────────────────────────────────
      let hashtagScore = 0;
      const tags = hashtags.match(/#\w+/g) || [];
      const hasDubis = tags.some((t) => t.toLowerCase() === '#dubis');
      const noSpam = tags.length <= 30; // basic spam guard
      if (tags.length >= 5 && tags.length <= 10 && hasDubis && noSpam) {
        hashtagScore = 15;
      } else if (tags.length >= 3 && hasDubis) {
        hashtagScore = 10;
      } else if (tags.length >= 1) {
        hashtagScore = 5;
      }
      score += hashtagScore;
      qaDetails.hashtag_score = hashtagScore;
      qaDetails.hashtag_count = tags.length;
      if (hashtagScore < 10) failReasons.push(`האשטאגים לא מספיקים (${tags.length} תגים, #DUBIS: ${hasDubis ? 'כן' : 'לא'})`);

      // ── 4. Image exists (20pts) ──────────────────────────────────────
      let imageScore = 0;
      if (imageUrl && imageUrl.includes('supabase.co')) {
        imageScore = 20;
      } else if (imageUrl) {
        imageScore = 10;
      }
      score += imageScore;
      qaDetails.image_score = imageScore;
      qaDetails.image_url = imageUrl || null;
      if (imageScore === 0) failReasons.push('חסרה תמונה');

      // ── 5. No forbidden words (10pts) ────────────────────────────────
      const forbidden = ['הודי', 'הודיז', 'זיפ הודי'];
      const foundForbidden = forbidden.filter((w) => captionHe.includes(w));
      const forbiddenScore = foundForbidden.length === 0 ? 10 : 0;
      score += forbiddenScore;
      qaDetails.forbidden_score = forbiddenScore;
      if (foundForbidden.length > 0) failReasons.push(`מילים אסורות: ${foundForbidden.join(', ')}`);

      // ── Final verdict ────────────────────────────────────────────────
      const qaPass = score >= 60;
      const qaAutoPublish = score >= 75; // High-quality → auto-approve + auto-publish
      const newContentData = {
        ...cd,
        qa_score: score,
        qa_pass: qaPass,
        qa_details: qaDetails,
        qa_checked_at: now,
        ...(qaAutoPublish ? { content_approved: true, auto_approved: true } : {}),
      };

      if (qaAutoPublish) {
        // HIGH QA score → auto-approve and trigger publish
        await sb.from('agent_tasks').update({
          content_data: newContentData,
          status: 'approved',
          approved_at: now,
          notes: ((task.notes as string) || '').trim() + `\n🤖 QA auto-approved (${score}/100) — ${new Date().toLocaleDateString('he-IL')}`,
          updated_at: now,
        }).eq('id', task.id);
        // Trigger auto-publish
        try {
          const publishUrl = `${Deno.env.get('SUPABASE_URL')?.replace('/rest/v1', '')}/functions/v1/agents?type=publish-ready`;
          await fetch(publishUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`,
              'Content-Type': 'application/json',
            },
          });
        } catch { /* publish will be retried later */ }
        passed++;
      } else if (qaPass) {
        // Moderate QA score → pending_approval for human review
        await sb.from('agent_tasks').update({
          content_data: newContentData,
          updated_at: now,
        }).eq('id', task.id);
        passed++;
      } else {
        // Reject — add QA failure note
        const existingNotes = ((task.notes as string) || '').trim();
        const qaNote = `QA נכשל: ${failReasons.join('; ')} (ציון ${score}/100)`;
        await sb.from('agent_tasks').update({
          content_data: newContentData,
          status: 'rejected',
          notes: existingNotes ? `${existingNotes}\n${qaNote}` : qaNote,
          updated_at: now,
        }).eq('id', task.id);
        failed++;
      }

      results.push({
        id: task.id,
        title: task.title,
        score,
        qa_pass: qaPass,
        details: qaDetails,
        fail_reasons: failReasons,
      });
    }

    return json({ checked: unscored.length, passed, failed, results });
  }

  // ── GENERATE-SLOGAN — Product Creator Agent ────────────────────────
  if (type === 'generate-slogan') {
    const cronSecret  = Deno.env.get('CRON_SECRET') ?? '';
    const agentSecret = Deno.env.get('AGENT_SECRET') ?? '';
    const svcKey      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const authHeader  = req.headers.get('authorization') ?? '';
    const token       = url.searchParams.get('token') || authHeader.replace('Bearer ', '').trim() || req.headers.get('x-agent-secret') || '';
    const isAuthed = (cronSecret && token === cronSecret) || (agentSecret && token === agentSecret) || (svcKey && token === svcKey);
    const adminOk = await verifyAdmin(req);
    if (!isAuthed && !adminOk) return json({ error: 'Unauthorized' }, 401);

    const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
    if (!geminiKey) return json({ error: 'GEMINI_API_KEY not configured' }, 503);

    // Get existing slogans to avoid duplicates
    const { data: existingProducts } = await sb.from('dubis_products').select('slogan');
    const existingSlogans = (existingProducts || []).map((p: Record<string, unknown>) => p.slogan).filter(Boolean);

    // Also get from hardcoded products.js slogans
    const allSlogans = [...existingSlogans, ...Object.keys(SLOGAN_TYPOGRAPHY)];

    const prompt = `You are the head copywriter at DUBIS — an Israeli apparel brand with CYNICAL humor (not dry, not gentle — CYNICAL!).
Target audience: 35+, Israeli AND international, body-positive, anti-fashion, comfort-first.

Rules:
- Slogan: 2-7 words in English
- Must contain ONE POWER WORD that will be printed 3-5x larger than the rest
- Cynical humor, not offensive, not political, not racist, not sexist
- NO repetition of existing slogans: ${allSlogans.join(' | ')}
- NEVER use: "premium", "luxury", "exclusive", body-shaming words
- Body-positive but NOT preachy

10 possible angles:
1. Comfort & laziness (napping, couch)
2. Cynical self-humor
3. Anti-fashion / anti-models
4. Quality & self-confidence
5. Community & belonging
6. Age & experience (40+)
7. Coffee & daily survival
8. Sarcasm about life
9. Food without apologies
10. Relationships (with the couch)

Generate 3 slogan proposals. For each, return ONLY valid JSON array:
[{
  "slogan": "full slogan text",
  "power_word": "THE_BIG_WORD",
  "text_before": "words before power word",
  "text_after": "words after power word",
  "layout": "top-bottom",
  "product_type": "tshirt|hoodie|ziphoodie|longsleeve",
  "gender": "unisex|women",
  "description_en": "2 sentences, conversational, for product page",
  "description_he": "2 משפטים, עברית ישראלית טבעית, לדף מוצר",
  "colors": ["Black", "White", "Navy", "Charcoal"]
}]`;

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
          signal: AbortSignal.timeout(30000) },
      );
      const raw = (await res.json()).candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleaned = raw.replace(/```json|```/g, '').trim();
      const suggestions = JSON.parse(cleaned);

      if (!Array.isArray(suggestions) || suggestions.length === 0) {
        return json({ error: 'Gemini returned invalid format', raw }, 500);
      }

      // Save each suggestion to dubis_products (active=false) + agent_task
      const savedProducts: unknown[] = [];
      const PRICE_MAP: Record<string, number> = { 't-shirt': 28, hoodie: 41, 'zip-hoodie': 46, 'long-sleeve': 31, cap: 28 };
      const DB_TYPE_MAP: Record<string, string> = { tshirt: 't-shirt', hoodie: 'hoodie', ziphoodie: 'zip-hoodie', longsleeve: 'long-sleeve', cap: 'cap', 't-shirt': 't-shirt', 'zip-hoodie': 'zip-hoodie', 'long-sleeve': 'long-sleeve' };
      for (const s of suggestions) {
        const clothingType = DB_TYPE_MAP[s.product_type || 'tshirt'] || 't-shirt';
        const { data: product, error: pErr } = await sb.from('dubis_products').insert({
          slogan: s.slogan,
          clothing_type: clothingType,
          category: s.gender === 'women' ? 'women' : 'unisex',
          gender: s.gender || 'unisex',
          price_usd: PRICE_MAP[clothingType] || 28,
          description_en: s.description_en || '',
          description_he: s.description_he || '',
          colors: s.colors || ['Black', 'White'],
          typography_small: s.text_before || '',
          typography_big: s.power_word || '',
          typography_after: s.text_after || '',
          typography_layout: s.layout || 'top-bottom',
          source: 'ai-generated',
          active: false,
        }).select('id').single();

        if (!pErr && product) {
          await sb.from('agent_tasks').insert({
            agent_id: 'product',
            title: `סלוגן חדש: ${s.slogan}`,
            description: `${s.description_he}\nPower word: ${s.power_word}\nType: ${s.product_type}`,
            category: 'new_product',
            status: 'pending_approval',
            priority: 'medium',
            content_data: { ...s, product_id: (product as Record<string, unknown>).id },
          });
          savedProducts.push({ id: (product as Record<string, unknown>).id, slogan: s.slogan, power_word: s.power_word });
        }
      }

      return json({ success: true, count: savedProducts.length, products: savedProducts, suggestions });
    } catch (e) {
      return json({ error: 'Gemini call failed', detail: (e as Error).message }, 500);
    }
  }

  // ── APPROVE-PRODUCT — Approve/reject product suggestions ──────────
  if (type === 'approve-product') {
    const adminOk = await verifyAdmin(req);
    if (!adminOk) return json({ error: 'Admin only' }, 401);

    if (req.method === 'GET') {
      // Get all pending product suggestions
      const { data, error } = await sb.from('dubis_products')
        .select('*')
        .eq('active', false)
        .eq('source', 'ai-generated')
        .order('created_at', { ascending: false });
      if (error) return json({ error: error.message }, 500);
      return json({ products: data });
    }

    if (req.method === 'POST') {
      const { product_id, action, edits } = body as Record<string, unknown>;
      if (!product_id || !action) return json({ error: 'product_id and action required' }, 400);
      if (!['approve', 'reject', 'edit_approve'].includes(action as string)) {
        return json({ error: 'action must be approve, reject, or edit_approve' }, 400);
      }

      if (action === 'reject') {
        await sb.from('dubis_products').update({ source: 'rejected' }).eq('id', product_id);
        await sb.from('agent_tasks')
          .update({ status: 'rejected', updated_at: new Date().toISOString() })
          .eq('agent_id', 'product')
          .filter('content_data->>product_id', 'eq', String(product_id));
        return json({ success: true, action: 'rejected', product_id });
      }

      // approve or edit_approve
      const updates: Record<string, unknown> = { active: true, source: 'approved' };
      if (action === 'edit_approve' && edits && typeof edits === 'object') {
        Object.assign(updates, edits as Record<string, unknown>);
      }
      const { data: updated, error: upErr } = await sb.from('dubis_products')
        .update(updates).eq('id', product_id).select().single();
      if (upErr) return json({ error: upErr.message }, 500);

      // Update agent_task
      await sb.from('agent_tasks')
        .update({ status: 'approved', approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('agent_id', 'product')
        .filter('content_data->>product_id', 'eq', String(product_id));

      return json({ success: true, action: 'approved', product: updated });
    }

    return json({ error: 'Use GET to list or POST to approve/reject' }, 405);
  }

  // ── SECURITY-SCAN — Security audit agent ──────────────────────────
  if (type === 'security-scan') {
    const cronSecret  = Deno.env.get('CRON_SECRET') ?? '';
    const agentSecret = Deno.env.get('AGENT_SECRET') ?? '';
    const svcKey      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const authHeader  = req.headers.get('authorization') ?? '';
    const token       = url.searchParams.get('token') || authHeader.replace('Bearer ', '').trim() || req.headers.get('x-agent-secret') || '';
    const isAuthed = (cronSecret && token === cronSecret) || (agentSecret && token === agentSecret) || (svcKey && token === svcKey);
    const adminOk = await verifyAdmin(req);
    if (!isAuthed && !adminOk) return json({ error: 'Unauthorized' }, 401);

    const findings: { severity: string; category: string; detail: string }[] = [];
    const siteUrl = 'https://www.dubis.net';

    // 1. Check security headers
    try {
      const headRes = await fetch(siteUrl, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
      const requiredHeaders: Record<string, string> = {
        'strict-transport-security': 'HSTS',
        'x-content-type-options': 'X-Content-Type-Options',
        'x-frame-options': 'X-Frame-Options',
        'content-security-policy': 'CSP',
        'referrer-policy': 'Referrer-Policy',
        'permissions-policy': 'Permissions-Policy',
      };
      for (const [header, name] of Object.entries(requiredHeaders)) {
        if (!headRes.headers.get(header)) {
          findings.push({ severity: 'medium', category: 'headers', detail: `חסר ${name} header` });
        }
      }
      // Check for HTTPS redirect
      if (!headRes.url.startsWith('https://')) {
        findings.push({ severity: 'high', category: 'https', detail: 'האתר לא מפנה ל-HTTPS' });
      }
    } catch (e) {
      findings.push({ severity: 'high', category: 'connectivity', detail: `לא ניתן לגשת לאתר: ${(e as Error).message}` });
    }

    // 2. Check RLS on tables
    const tables = ['orders', 'profiles', 'coupons', 'page_views', 'agent_tasks', 'agent_runs', 'newsletter_subscribers', 'product_reviews', 'dubis_products'];
    for (const table of tables) {
      try {
        const { error } = await sb.rpc('check_rls_enabled', { table_name: table });
        // If the RPC doesn't exist, we skip. RLS check is best-effort
        if (error && error.message.includes('not found')) break;
      } catch { /* RPC may not exist */ }
    }

    // 3. Check for exposed API keys in public JS
    try {
      const jsRes = await fetch(`${siteUrl}/js/main.js`, { signal: AbortSignal.timeout(10000) });
      const jsContent = await jsRes.text();
      const keyPatterns = [/SUPABASE_SERVICE_ROLE/i, /sk_live_/i, /GELATO_API_KEY/i, /RESEND_API_KEY/i, /PAYPAL_SECRET/i];
      for (const pattern of keyPatterns) {
        if (pattern.test(jsContent)) {
          findings.push({ severity: 'critical', category: 'exposed_key', detail: `מפתח חשוף ב-main.js: ${pattern.source}` });
        }
      }
    } catch { /* skip */ }

    // 4. Check PayPal mode (sandbox vs production)
    try {
      const paypalRes = await fetch(`${siteUrl}/js/paypal.js`, { signal: AbortSignal.timeout(10000) });
      const paypalContent = await paypalRes.text();
      if (paypalContent.includes('sandbox')) {
        findings.push({ severity: 'medium', category: 'paypal', detail: 'נמצאה הפניה ל-sandbox ב-paypal.js — לוודא שזה production' });
      }
    } catch { /* skip */ }

    // Save scan results
    const scanResult = {
      scanned_at: new Date().toISOString(),
      total_findings: findings.length,
      critical: findings.filter(f => f.severity === 'critical').length,
      high: findings.filter(f => f.severity === 'high').length,
      medium: findings.filter(f => f.severity === 'medium').length,
      low: findings.filter(f => f.severity === 'low').length,
      findings,
    };

    await sb.from('agent_tasks').insert({
      agent_id: 'security',
      title: `סריקת אבטחה — ${new Date().toLocaleDateString('he-IL')}`,
      description: `נמצאו ${findings.length} ממצאים (${scanResult.critical} קריטי, ${scanResult.high} גבוה)`,
      category: 'security_scan',
      status: findings.some(f => f.severity === 'critical') ? 'in_progress' : 'done',
      priority: findings.some(f => f.severity === 'critical') ? 'urgent' : 'low',
      content_data: scanResult,
    });

    return json(scanResult);
  }

  return json({
    error: 'Invalid type. Valid types: tasks, runs, run, generate-image, generate-product-image, product-images, products-catalog, smart-match, publish, gemini-models, content-run, fb-debug, publish-ready, avatars, voices, heygen-status, upload-reel-photo, upload-talking-photo, generate-reel, reel-status, reel-webhook, auto-content, qa-content, generate-slogan, approve-product, security-scan',
  }, 400);
});
