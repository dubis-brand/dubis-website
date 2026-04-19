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
  "Low maintenance, high value":          { small: 'low maintenance, high', big: 'VALUE', after: '', layout: 'top-bottom' },
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

    // Phase 2 autonomy: run ALL actionable tasks (approved + pending_approval)
    // EXCEPT: requires_budget=true stays pending until oren approves manually
    // EXCEPT: content tasks with content_approved=true are ready-to-publish, not re-run
    const { data: allActionable, error: fetchErr } = await sb.from('agent_tasks')
      .select('id, title, agent_id, category, description, notes, priority, content_data, requires_budget')
      .in('status', ['approved', 'pending_approval'])
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true });

    if (fetchErr) return json({ error: fetchErr.message }, 500);
    type Task = Record<string, unknown>;
    // Filter out: budget tasks (need manual approval), content-approved (ready to publish, not re-run)
    const tasks = (allActionable || []).filter((t: Task) => {
      if (t.requires_budget === true) return false;
      if ((t.content_data as Task)?.content_approved) return false;
      return true;
    });

    if (!tasks.length) {
      const readyCount = (allActionable || []).filter((t: Task) => (t.content_data as Task)?.content_approved).length;
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
                body: JSON.stringify({ contents: [{ parts: [{ text: `אתה אנליסט שיווק של DUBIS.\nמשימה: ${task.title}\nתיאור: ${task.description || ''}\n7 ימים: ${(orders || []).length} הזמנות, $${rev.toFixed(2)} הכנסה.\nספק 3-5 המלצות שיווק בעברית. בסוף הפלט הוסף שורת סיכום קצרה של 1-2 משפטים.` }] }] }) },
            );
            const analysis = (await mRes.json()).candidates?.[0]?.content?.parts?.[0]?.text || '';
            // Phase 2: auto-complete — no approval needed
            await sb.from('agent_tasks').update({ notes: analysis, status: 'done', updated_at: now }).eq('id', task.id);
            taskResults.push(`✅ ${task.title}: ניתוח נוצר → done`);
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
                body: JSON.stringify({ contents: [{ parts: [{ text: `אתה מפתח full-stack בכיר של DUBIS. Stack: Vercel, Supabase, Vanilla JS, PayPal, Gelato.\nמשימה: ${task.title}\nתיאור: ${task.description || ''}\nקטגוריה: ${task.category || ''}\nספק תוכנית יישום טכנית בעברית. בסוף הפלט הוסף שורת סיכום קצרה.` }] }] }) },
            );
            const plan = (await tRes.json()).candidates?.[0]?.content?.parts?.[0]?.text || '';
            // Phase 2: auto-complete — plan saved to notes, task done
            await sb.from('agent_tasks').update({ notes: plan, status: 'done', updated_at: now }).eq('id', task.id);
            taskResults.push(`✅ ${task.title}: תוכנית טכנית נוצרה → done`);
          } catch (e) {
            await sb.from('agent_tasks').update({ status: 'in_progress', updated_at: now }).eq('id', task.id);
            taskResults.push(`❌ ${task.title}: ${(e as Error).message}`);
            runStatus = 'completed_with_errors';
          }
        }

      } else if (agent_id === 'supply') {
        // Phase 2: supply tasks auto-complete — Gelato sync runs separately via cron
        for (const task of agentTasks) {
          await sb.from('agent_tasks').update({
            notes: ((task.notes as string) || '') + `\n📦 סנכרון Gelato רץ אוטומטי בחצות — ${new Date().toLocaleDateString('he-IL')}`,
            status: 'done', updated_at: now
          }).eq('id', task.id);
          taskResults.push(`📦 ${task.title}: → done (Gelato sync runs at midnight)`);
        }

      } else {
        // Phase 2: default handler — run Gemini analysis if available, then done
        if (geminiKey) {
          for (const task of agentTasks) {
            try {
              const gRes = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ contents: [{ parts: [{ text: `אתה סוכן AI של DUBIS (מותג אופנה ישראלי).\nמשימה: ${task.title}\nתיאור: ${(task.description as string) || ''}\nקטגוריה: ${(task.category as string) || ''}\nסוכן: ${agent_id}\nנתח את המשימה וספק תובנות + המלצות בעברית. בסוף הפלט הוסף שורת סיכום קצרה.` }] }] }) },
              );
              const result = (await gRes.json()).candidates?.[0]?.content?.parts?.[0]?.text || '';
              await sb.from('agent_tasks').update({ notes: result, status: 'done', updated_at: now }).eq('id', task.id);
              taskResults.push(`✅ ${task.title}: ניתוח נוצר → done`);
            } catch (e) {
              await sb.from('agent_tasks').update({ status: 'done', notes: `⚠️ ניתוח נכשל: ${(e as Error).message}`, updated_at: now }).eq('id', task.id);
              taskResults.push(`⚠️ ${task.title}: error but marked done`);
              runStatus = 'completed_with_errors';
            }
          }
        } else {
          await sb.from('agent_tasks').update({ status: 'done', notes: 'Auto-completed (no Gemini key)', updated_at: now }).in('id', ids);
          for (const t of agentTasks) taskResults.push(`✅ ${t.title}: → done (no analysis)`);
        }
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
    if (!admin && !isAgentSecret(req)) {
      const auth = (req.headers.get('authorization') ?? '').replace('Bearer ', '').trim();
      const svcK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
      const cronK = Deno.env.get('CRON_SECRET') ?? '';
      if (auth !== svcK && auth !== cronK) return json({ error: 'Unauthorized' }, 401);
    }
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

        const pickEarly = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
        const GARMENT_COLORS = ['vintage cream white','washed sage green','burnt orange','dusty pink','mustard yellow','deep burgundy','sky blue','terracotta','forest green','lavender purple','classic black','heather gray','navy blue','cobalt blue','rust red'];
        const garmentColor = pickEarly(GARMENT_COLORS);
        let garmentDesc = `oversized casual ${garmentColor} t-shirt`;
        if (productType.includes('zip') || searchText.includes('zip') || searchText.includes('זיפ')) garmentDesc = `${garmentColor} zip-up hoodie`;
        else if (productType.includes('hoodie') || searchText.includes('hoodie') || searchText.includes('קפוצון')) garmentDesc = `oversized ${garmentColor} hoodie (pullover)`;
        else if (productType.includes('long') || searchText.includes('long sleeve') || searchText.includes('שרוול')) garmentDesc = `casual ${garmentColor} long sleeve shirt`;
        else if (productType.includes('cap') || searchText.includes('cap') || searchText.includes('כובע')) garmentDesc = `casual ${garmentColor} cap/hat`;

        let phraseOnClothing = slogan;
        if (!phraseOnClothing) {
          if (searchText.includes('overthinker')) phraseOnClothing = 'Certified Overthinker';
          else if (searchText.includes('nap') || searchText.includes('cardio')) phraseOnClothing = 'Napping is my cardio';
          else if (searchText.includes('limited edition')) phraseOnClothing = "I'm not fat, I'm a limited edition";
          else if (searchText.includes('more of me') || searchText.includes('love')) phraseOnClothing = 'More of me to love';
          else if (searchText.includes('survived')) phraseOnClothing = "I survived... That's enough";
          else if (searchText.includes('not a model')) phraseOnClothing = 'Not a model. Never wanted to be.';
        }

        // ── RANDOMIZED VARIETY POOLS — every post is visually different ──
        const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

        const SETTINGS = [
          // Nature & outdoors (high priority — bright, fresh)
          'sandy beach at sunrise with gentle waves, bright airy light',
          'mediterranean cliff overlooking turquoise sea, blue sky',
          'pine forest hiking trail with sun rays through trees',
          'mountain viewpoint with valley below, crisp morning air',
          'wildflower meadow in full spring bloom, hazy sun',
          'lakeside dock at golden hour, mirror water reflection',
          'olive grove in northern israel, dappled afternoon light',
          'desert dunes at sunrise, soft pastel sky',
          // Urban outdoors with life
          'tel aviv beachfront promenade with palm trees, midday sun',
          'jaffa flea market alley with colorful textiles, warm light',
          'jerusalem old city stone arches, bright midday',
          'european cobblestone street with outdoor cafés, golden hour',
          'rooftop terrace with string lights and city skyline behind',
          'street food market with food trucks, festival vibe',
          'farmer\'s market with colorful produce stands, sunlit',
          'urban skate park with graffiti walls, bright daylight',
          'pier with fishing boats at golden hour',
          'park lawn during a picnic, blanket and friends, sunny',
          // Bright interiors with windows
          'sunlit minimalist café with huge windows, plants everywhere',
          'bright airy loft with floor-to-ceiling windows and white walls',
          'modern bookstore with skylights and warm wood',
          'plant-filled greenhouse café with diffused daylight',
        ];

        const ANGLES = [
          'front-facing medium shot, eye-level',
          'three-quarter angle from the right side, slight low angle',
          'over-the-shoulder shot showing back of garment in focus',
          'full-body wide shot with environmental context',
          'close-up upper body shot, shallow depth of field',
          'dynamic action shot, subject mid-motion',
          'side profile silhouette against bright window',
          'high angle looking down, subject seated',
          'low angle hero shot looking up at subject',
          'extreme close-up of garment detail with subject partially visible',
          'candid documentary style, subject unaware of camera',
          'mirror selfie reflection style',
        ];

        const POSES = [
          'laughing genuinely with head tilted back',
          'leaning casually against a wall, arms crossed',
          'walking confidently toward camera',
          'sitting cross-legged on the floor with coffee mug',
          'mid-stride with shopping bags',
          'hands in pockets, soft smile, looking off-camera',
          'stretching arms overhead, yawning',
          'reading a book, totally absorbed',
          'caught mid-conversation, animated hand gesture',
          'sitting on stairs, elbows on knees',
          'stretching tired after waking up',
          'pointing at the slogan on their own shirt with a smirk',
          'twirling, garment flowing',
          'jumping in place, joyful',
        ];

        const MODELS = [
          'plus-size woman aged 30-40, curly brown hair, freckles, warm olive skin',
          'athletic man aged 35-45, full beard, tattoo sleeves, warm tan',
          'curvy woman aged 25-35, short pixie cut, bright lipstick, brown skin',
          'older man aged 50-60, salt-and-pepper hair, wireframe glasses, fair skin',
          'young woman aged 22-28, long black hair, bright smile, mediterranean features',
          'middle-aged dad aged 40-50, dad-bod, ginger hair, freckled fair skin',
          'tall lanky guy aged 28-35, messy brown hair, scruffy stubble, olive skin',
          'mom aged 35-45, ponytail, no makeup, natural beauty, light tan',
          'asian woman aged 30-40, straight black bob, minimal jewelry, fair skin',
          'black man aged 35-45, shaved head, full beard, dark brown skin',
          'latina woman aged 28-38, wavy auburn hair, warm smile, golden tan',
          'mature woman aged 55-65, gray bob, statement glasses, fair skin',
        ];

        const TIME_LIGHT = [
          'bright golden hour, warm sunlit glow, lens flare',
          'soft natural daylight, airy and bright',
          'cinematic backlight with sun flare through hair',
          'crisp morning sunshine, vivid colors',
          'dappled sunlight through leaves',
          'open shade, soft even daylight, no harsh shadows',
          'magic hour with pink and orange sky',
          'midday Mediterranean sun, vibrant and high-contrast',
        ];

        // GROUP COMPOSITION pool — break the always-solo default (research shows group/couple shots convert better)
        const GROUP_COMPS = [
          { type: 'solo', desc: 'a single subject in frame', weight: 45 },
          { type: 'couple', desc: 'a couple in their 30s-40s walking side by side, holding hands, both wearing matching DUBIS pieces in different colors, laughing together', weight: 20 },
          { type: 'friends', desc: 'two close friends mid-laugh, candid moment, both wearing DUBIS, one slightly behind the other', weight: 15 },
          { type: 'group3', desc: 'three friends of mixed gender and ethnicity hanging out, all in DUBIS, one pointing or gesturing animatedly', weight: 10 },
          { type: 'family', desc: 'a parent with teen kid, both in DUBIS, candid family moment, warmth and humor', weight: 5 },
          { type: 'crew', desc: 'a small crew of 4 diverse friends shot from slight low angle, hero-style, all in different DUBIS items', weight: 5 },
        ];
        const totalWeight = GROUP_COMPS.reduce((s, g) => s + g.weight, 0);
        let r = Math.random() * totalWeight; let groupComp = GROUP_COMPS[0];
        for (const g of GROUP_COMPS) { r -= g.weight; if (r <= 0) { groupComp = g; break; } }

        // NARRATIVE pool — products in action, not posed (movie-still storytelling)
        const NARRATIVES = [
          'caught mid-laugh during a real conversation',
          'sipping iced coffee on a walk',
          'crossing the street with shopping bags',
          'sitting on a curb eating street food',
          'leaning against a vintage car door',
          'climbing stone stairs in an old city',
          'on a bicycle pausing at a corner',
          'browsing vinyl at an outdoor flea market',
          'reaching to pick fruit at a market stall',
          'mid-stride along the beach with shoes in hand',
          'feeding pigeons in a city square',
          'hiking with a small backpack',
          'watching sunset from a viewpoint',
          'sharing earbuds with a friend',
        ];
        const narrative = pick(NARRATIVES);

        // Use task_id (or current minute) as seed-ish for daily variety in addition to true random
        // 90% outdoor/bright — completely break the cozy-living-room default
        const OUTDOOR_ONLY = SETTINGS.filter(s => !/loft|bookstore|greenhouse|café with huge/i.test(s));
        const setting = Math.random() < 0.9 ? pick(OUTDOOR_ONLY) : pick(SETTINGS);
        const angle = pick(ANGLES);
        const pose = pick(POSES);
        const modelDesc = pick(MODELS);
        const lighting = pick(TIME_LIGHT);

        // Allow context keywords to *bias* (not lock) setting
        let settingDesc = setting;
        if (searchText.includes('behind') || searchText.includes('scenes')) settingDesc = pick(['clothing workshop with sewing machines','design studio with mood boards','print shop with garments hanging']);
        else if (searchText.includes('couch') || searchText.includes('nap')) settingDesc = pick(['cozy living room sofa with throw pillows','unmade bed with morning light','hammock on a balcony']);
        else if (searchText.includes('coffee') || searchText.includes('morning')) settingDesc = pick(['hipster coffee shop with espresso machine','sunny kitchen counter with french press','outdoor café with steam rising']);

        const brandRules = 'Photorealistic editorial lifestyle photo, square 1:1 format. DUBIS Israeli streetwear brand. NOT professional models — REAL authentic people, body diversity, mixed ages and ethnicities. Natural unposed candid moment, mid-action. Cinematic movie-still composition. Bright airy natural lighting (not dark, not moody). Sharp focus on subjects, soft natural background blur. Looks like a real Instagram lifestyle shot, not stock photo.';

        // Decide front vs back showcase randomly (50% back for slogan visibility, 50% front)
        const showBack = !!phraseOnClothing && Math.random() < 0.5;
        const negative = 'STRICT NEGATIVE: do NOT default to a cozy beige living room with bookshelves. do NOT default to gray/charcoal hoodies. do NOT default to a plus-size brunette woman from behind. NO nose rings, NO facial piercings, NO face jewelry, NO septum piercings. VARY everything.';

        if (format === 'quote_card') imagePrompt = `Minimalist textured background — pick from: ${pick(['dark charcoal concrete','warm beige plaster','dusty pink stucco','deep navy painted wood','burnt orange brick'])}, moody directional lighting, no people. ${brandRules}`;
        else if (phraseOnClothing) {
          const typoDesc = getSloganTypographyPrompt(phraseOnClothing);
          const subjectDesc = groupComp.type === 'solo' ? modelDesc : groupComp.desc;
          const header = `MANDATORY SCENE — Setting: ${settingDesc}. Subjects: ${subjectDesc}. Action: ${narrative}. Pose detail: ${pose}. Camera: ${angle}. Lighting: ${lighting}. Garment: ${garmentDesc}. ${negative}`;
          if (showBack) {
            imagePrompt = `${header} Show the BACK of the garment clearly with MIXED-SIZE TYPOGRAPHY: ${typoDesc}. Power word 3-5x larger than surrounding text. Bold condensed sans-serif font. No logo on back. ${brandRules}`;
          } else {
            imagePrompt = `${header} FRONT view of the subject — face and personality visible. Garment is clean with NO visible text or logo (brand mark too small to read). ${brandRules}`;
          }
        } else {
          imagePrompt = `MANDATORY SCENE — Setting: ${settingDesc}. Model: ${modelDesc}. Pose: ${pose}. Camera: ${angle}. Lighting: ${lighting}. Garment: ${garmentDesc} with small "DUBIS" logo on chest. ${negative} ${brandRules}`;
        }
      }
    }
    if (!imagePrompt) return json({ error: 'prompt or task_id required' }, 400);

    // Use fal.ai FLUX (obeys prompts) instead of Gemini (which defaults to stock cozy living room)
    const falKey = Deno.env.get('FAL_API_KEY') ?? Deno.env.get('FAL_KEY') ?? '';
    let imgBytes: Uint8Array | null = null;
    if (falKey) {
      try {
        const falRes = await fetch('https://fal.run/fal-ai/flux/dev', {
          method: 'POST',
          headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: imagePrompt + '. Photorealistic editorial fashion photography, square 1:1.', image_size: 'square_hd', num_inference_steps: 28, guidance_scale: 3.5, num_images: 1, enable_safety_checker: false }),
          signal: AbortSignal.timeout(90000),
        });
        if (falRes.ok) {
          const fd = await falRes.json();
          const url = fd?.images?.[0]?.url;
          if (url) {
            const imgResp = await fetch(url);
            imgBytes = new Uint8Array(await imgResp.arrayBuffer());
          }
        } else {
          console.error('FLUX error', falRes.status, (await falRes.text()).substring(0, 200));
        }
      } catch (e) { console.error('FLUX exception', e); }
    }

    if (!imgBytes) {
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
      if (!imgPart?.inlineData) return json({ error: 'Gemini did not return an image.' }, 500);
      imgBytes = b64ToBytes(imgPart.inlineData.data as string);
    }
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
      `Create a photorealistic DSLR-quality diptych: LEFT=FRONT of ${color} ${clothingName} worn by ${models[modelKey] || models.man}, small "DUBIS™" on left chest only; RIGHT=BACK showing MIXED-SIZE TYPOGRAPHY: ${sloganTypo}. No logo on back, only slogan. SETTING: ${scenes[sceneKey] || scenes.street}`,
      `Create a photorealistic DSLR-quality photo of ${models[modelKey] || models.man} from behind in a ${color} ${clothingName}. BACK shows MIXED-SIZE TYPOGRAPHY: ${sloganTypo}. No logo on back, only slogan. Person looking slightly over shoulder. SETTING: ${scenes[sceneKey] || scenes.street}. Shallow depth of field.`,
      `Create a photorealistic DSLR-quality lifestyle photo of ${models[modelKey] || models.man} wearing ${color} ${clothingName}. BACK partially visible showing: ${sloganTypo}. SETTING: ${scenes[sceneKey] || scenes.street}. Candid, unposed, authentic.`,
      `Create a photorealistic DSLR-quality flat-lay of ${color} ${clothingName} showing BACK with MIXED-SIZE TYPOGRAPHY: ${sloganTypo}. No logo on back, only slogan. Top-down angle, minimalist styling.`,
      `Create a photorealistic DSLR-quality close-up of BACK of ${color} ${clothingName} worn by ${models[modelKey] || models.man}, focused on MIXED-SIZE TYPOGRAPHY: ${sloganTypo}. No logo on back, only slogan. Bokeh background. 85mm f/2.0.`,
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

        // PRODUCT-LINK RULE (2026-04-18): every post must link a real active product.
        // If product_url is missing OR the linked product isn't active, hydrate from dubis_products.
        // If we can't match to an active product at all, block the task.
        let productUrl = (cd.product_url as string) || '';
        let productId  = (cd.product_id  as string) || '';
        let productPriceUsd: number | null = (cd.product_price_usd as number) ?? null;
        let productType = (cd.product_type as string) || '';
        const productSloganRaw = (cd.product_slogan as string) || '';

        // Look up the canonical active product by id (preferred) or slogan
        try {
          type ActiveProduct = { product_id_numeric: number; slogan: string; clothing_type: string; price_usd: number | null };
          let hit: ActiveProduct | null = null;
          if (productId) {
            const { data } = await sb.from('dubis_products')
              .select('product_id_numeric, slogan, clothing_type, price_usd')
              .eq('active', true)
              .eq('product_id_numeric', productId)
              .limit(1);
            if (data?.length) hit = (data as ActiveProduct[])[0];
          }
          if (!hit && productSloganRaw) {
            const { data } = await sb.from('dubis_products')
              .select('product_id_numeric, slogan, clothing_type, price_usd')
              .eq('active', true)
              .ilike('slogan', productSloganRaw);
            if (data?.length) hit = (data as ActiveProduct[])[0];
          }
          if (hit) {
            productId  = String(hit.product_id_numeric);
            productUrl = `https://www.dubis.net/#product-${hit.product_id_numeric}`;
            productPriceUsd = hit.price_usd;
            if (!productType) productType = hit.clothing_type || productType;
          }
        } catch (_lookupErr) { /* continue — validated below */ }

        if (!productUrl || !productId) {
          await sb.from('agent_tasks').update({
            status: 'in_progress',
            notes: ((task.notes as string) || '') + `\n⚠️ PRODUCT-LINK RULE: no active product matched (product_id="${productId}", slogan="${productSloganRaw}") — cannot advance`,
            updated_at: now,
          }).eq('id', task.id);
          taskResults.push(`❌ ${task.title}: no active product match — blocked by product-link rule`);
          continue;
        }

        // US-PIVOT (2026-04-18): gate on caption_en only. HE captions fully retired.
        if (cd.caption_en && hasPermImg) {
          await sb.from('agent_tasks').update({
            status: 'pending_approval',
            content_data: { ...cd, product_url: productUrl, product_id: productId, product_price_usd: productPriceUsd, product_type: productType },
            updated_at: now,
          }).eq('id', task.id);
          taskResults.push(`✅ ${task.title}: content ready → pending_approval (linked → ${productUrl})`);
          continue;
        }

        let gen: Record<string, string> = {};
        if (!cd.caption_en && geminiKey) {
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
You are the Senior Copywriter for "DUBIS" — an anti-fashion apparel brand targeting the US market. Tagline: "For the rest of us."

[Target Audience — US PIVOT 2026-04-18]
Americans aged 35-55, all genders. Real bodies, real lives. They're exhausted by gym-culture, influencer-speak, and clothes that only look good on 22-year-olds. They want comfort that doesn't apologize, and clothes built for the bodies they actually live in. All DUBIS content is in ENGLISH ONLY — no Hebrew, no translations. This is a US-only brand voice.

[Brand DNA]
DUBIS breaks the false choice between "fashionable but uncomfortable" and "comfortable but invisible." We make clothes that fit real bodies, feel amazing, and carry witty one-liners that say: "This is who I am."

[Content Angle for THIS post]
Focus on: ${todayAngle}
IMPORTANT: Do NOT only talk about body weight or being fat. DUBIS is about MUCH MORE — comfort, humor, anti-fashion rebellion, real life after 35, quality, community.

[Tone Rules]
- First-person plural ("we", "us") — tribe mentality, "for the rest of us"
- Cynical, witty, dry humor — like a sharp friend over coffee
- BANNED words: perfect, stunning, must-have, insane, sale, discount, luxurious, premium, exclusive
- NEVER imply the customer needs to "improve" or "fix" themselves
- Short punchy sentences. No fluff. Conversational — not literary.
- Think: how would a 45-year-old American write this to a smart friend over text?

[Protocol]
1. Hook — relatable observation matching today's angle
2. Product connection — how this DUBIS piece fits that moment
3. CTA — casual, confident, NO urgency-language

[Examples of GOOD voice]
- "After 40 you have two options: dress for other people, or dress for your couch. We chose."
- "Built for the body you actually live in. Not the one in the ad."
- "The most expensive thing in your closet is the one you never wear. DUBIS is the opposite."
- "Your cardio is horizontal. Ours too. Welcome to the club."`;

          const isStory = cd.format === 'story';
          const captionPrompt = `${dubisPrompt}

--- TASK ---
Task: "${task.title}"
Slogan on product: "${productSloganRaw}"
Product type: "${productType}"
Product URL: "${productUrl}"
Product price: ${productPriceUsd != null ? `$${productPriceUsd}` : 'see product page'}
Format: ${isStory ? 'STORY — 1-2 punchy sentences max.' : (cd.format || 'feed_post')}

MANDATORY:
1. The product's slogan (e.g. "NAPPING IS MY CARDIO", "more of me to LOVE") MUST appear in the caption exactly as written. The slogan is on the actual garment — echoing it in the caption makes the connection to the product clear.
2. Do NOT invent a URL or add any fake link inside the caption body. The publish pipeline appends the real URL "${productUrl}" to the end automatically. Keep your caption body URL-free.
3. Do NOT include the price inside the caption body either. The shop line appends it.

Return ONLY valid JSON: {"caption_en":"...","hashtags":"#DUBIS #ForTheRestOfUs ...5-10 US-relevant tags","image_prompt":"..."}`;
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
          // US-PIVOT: drop any stray HE content if Gemini returns it
          delete gen.caption_he;
          if (!gen.caption_en) throw new Error('Caption generation empty');
        } else {
          gen = { caption_en: cd.caption_en as string, hashtags: cd.hashtags as string };
        }

        let imageUrl = hasPermImg ? (cd.generated_image_url as string) : '';
        let imgError = '';

        if (!imageUrl) {
          // Use real product photos from dubis_images — AI cannot render readable text on garments
          const productSlogan = ((cd.product_slogan as string) || '').toLowerCase().trim();
          const productId = (cd.product_id as string) || '';

          try {
            type ImgRow = { image_url: string; quality_score: number; dubis_products?: { slogan?: string } | null };
            let matchImg: ImgRow | null = null;

            // 1) Match by product_id (most precise)
            if (productId) {
              const { data } = await sb.from('dubis_images')
                .select('image_url, quality_score, dubis_products(slogan)')
                .eq('product_id', productId)
                .eq('approved', true)
                .order('quality_score', { ascending: false })
                .limit(1);
              if (data?.length) matchImg = (data as ImgRow[])[0];
            }

            // 2) Match by slogan keywords against dubis_products.slogan
            if (!matchImg && productSlogan) {
              const { data: allApproved } = await sb.from('dubis_images')
                .select('image_url, quality_score, dubis_products(slogan)')
                .eq('approved', true)
                .order('quality_score', { ascending: false })
                .limit(80);
              if (allApproved?.length) {
                const sloganWords = productSlogan.split(' ').filter((w: string) => w.length > 3).slice(0, 4);
                const hit = (allApproved as ImgRow[]).find(img => {
                  const s = (img.dubis_products?.slogan || '').toLowerCase();
                  return sloganWords.some((w: string) => s.includes(w));
                });
                if (hit) matchImg = hit;
              }
            }

            // 3) Fallback: any approved image with score ≥ 4, rotated by task id
            if (!matchImg) {
              const { data: best } = await sb.from('dubis_images')
                .select('image_url, quality_score')
                .eq('approved', true)
                .gte('quality_score', 4)
                .order('quality_score', { ascending: false })
                .limit(20);
              if (best?.length) {
                const idx = parseInt((task.id as string).replace(/-/g, '').substring(0, 6), 16) % best.length;
                matchImg = (best as ImgRow[])[idx];
                imgError = 'fallback_any_approved';
              } else {
                imgError = 'no_approved_images_in_gallery';
              }
            }

            if (matchImg) imageUrl = matchImg.image_url;
          } catch (imgLookupErr) {
            imgError = `img_lookup:${(imgLookupErr as Error).message}`;
          }
        }

        // US-PIVOT (2026-04-18): caption_en is the only caption we store/publish.
        const finalCapEn = gen.caption_en || (cd.caption_en as string) || '';
        const hasCaption = !!finalCapEn;
        const newStatus = hasCaption ? 'pending_approval' : 'in_progress';
        await sb.from('agent_tasks').update({
          status: newStatus,
          // Strip any legacy caption_he that may have been saved before the US pivot.
          // Persist the hydrated product link fields so publish + QA can rely on them.
          content_data: {
            ...cd,
            caption_he: '',
            caption_en: finalCapEn,
            hashtags: gen.hashtags || (cd.hashtags as string) || '',
            image_prompt: gen.image_prompt || '',
            generated_image_url: imageUrl || (cd.generated_image_url as string) || '',
            product_url:       productUrl,
            product_id:        productId,
            product_price_usd: productPriceUsd,
            product_type:      productType,
          },
          notes: ((task.notes as string) || '') + (hasCaption ? '' : `\n⚠️ Caption empty — retry needed`),
          updated_at: now,
        }).eq('id', task.id);
        taskResults.push(hasCaption
          ? `✅ ${task.title}: ${imageUrl ? 'image+caption' : `caption only [${imgError}]`} → pending_approval`
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
      const hasImage = !!(cd.generated_image_url as string); // accept dubis.net OR supabase.co images
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
      // Instagram doesn't make URLs clickable in feed/Reel captions — only bio link works.
      // Facebook DOES make URLs clickable, so we link directly to the specific product page.
      // product_url is set by auto-content from dubis_products (active=true only).
      const productUrl = (cd.product_url as string) || 'https://www.dubis.net';
      const priceUsd   = (cd.product_price_usd as number | null) ?? null;
      // PRODUCT-LINK RULE (2026-04-18): both IG + FB must show the specific product URL.
      // IG won't make it clickable in feed/Reel captions, but the user can still see and copy it.
      // Pair with "link in bio" because that bio link IS clickable.
      const priceTag   = priceUsd != null ? ` — $${priceUsd}` : '';
      const shortUrl   = productUrl.replace(/^https?:\/\/(www\.)?/, '');
      const shopLineIG = `🛒 Shop this${priceTag} → ${shortUrl}\n🔗 Tap link in bio @dubis.brand`;
      const shopLineFB = `🛒 Shop this${priceTag} → ${productUrl}`;
      const baseBody = (cd.caption_en as string) || (cd.caption_he as string) || task.title;
      const tags = (cd.hashtags as string) || '#DUBIS #ForTheRestOfUs';
      // Strip any plain "www.dubis.net" the model may have added inside the body
      const cleanBody = baseBody.replace(/https?:\/\/(www\.)?dubis\.net\/?/gi, '').replace(/www\.dubis\.net\/?/gi, '').replace(/\n{3,}/g, '\n\n').trim();
      const captionIG = `${cleanBody}\n\n${shopLineIG}\n\n${tags}`;
      const captionFB = `${cleanBody}\n\n${shopLineFB}\n\n${tags}`;
      const caption = captionIG; // default for IG branch below
      // Serve images through edge function with clean headers for Instagram
      // (Supabase Storage returns X-Robots-Tag:none which blocks FB crawler)
      let image_url = cd.generated_image_url as string;
      if (image_url?.includes('supabase.co/storage/v1/object/public/ig-images/')) {
        const filename = image_url.split('/ig-images/').pop();
        const edgeBase = `${Deno.env.get('SUPABASE_URL')?.replace('/rest/v1', '')}/functions/v1/agents`;
        image_url = `${edgeBase}?type=serve-image&f=${encodeURIComponent(filename || '')}`;
      }
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
          for (let attempt = 0; attempt < 24; attempt++) {
            await new Promise((r) => setTimeout(r, 5000));
            const statusRes = await fetch(`https://graph.facebook.com/v19.0/${containerId}?fields=status_code&access_token=${igToken}`);
            const statusData = await statusRes.json() as Record<string, unknown>;
            if (statusData.status_code === 'FINISHED') { ready = true; break; }
            if (statusData.status_code === 'ERROR') { break; }
          }
          if (!ready) { results.push({ id: task.id, title: task.title, status: 'error', error: 'Reel container not ready after 120s' }); continue; }
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
              body: JSON.stringify({ url: image_url, caption: captionFB, access_token: fbToken }),
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

    // Product catalog — pull ONLY from live dubis_products (active=true)
    // This guarantees every post links to a product that actually exists on the site.
    type ProductDef = { product_id: number; slogan: string; type: string; gender: string; format: string };
    const clothingTypeMap: Record<string, string> = {
      't-shirt': 'tshirt',
      'hoodie': 'hoodie',
      'zip-hoodie': 'ziphoodie',
      'long-sleeve': 'longsleeve',
      'cap': 'cap',
    };
    const { data: liveProducts, error: prodErr } = await sb
      .from('dubis_products')
      .select('product_id_numeric, slogan, clothing_type, gender')
      .eq('active', true)
      .order('product_id_numeric', { ascending: true });
    if (prodErr || !liveProducts?.length) {
      return json({ error: 'No active products found in dubis_products', details: prodErr?.message }, 500);
    }
    const PRODUCTS: ProductDef[] = (liveProducts as Array<Record<string, unknown>>)
      .filter(p => p.product_id_numeric && p.slogan)
      .map(p => ({
        product_id: p.product_id_numeric as number,
        slogan:     p.slogan as string,
        type:       clothingTypeMap[(p.clothing_type as string) || ''] || 'tshirt',
        gender:     (p.gender as string) || 'unisex',
        format:     'feed_post',
      }));
    if (!PRODUCTS.length) {
      return json({ error: 'No active products with slogan in dubis_products' }, 500);
    }

    // US-PIVOT (2026-04-18): ALL posts are EN-only. HE auto-content fully retired.
    // Audience = US 35-55 from Meta campaign 120244081546680267. Site default = EN.
    // Cron 10:00 UTC (06:00 ET) + 16:00 UTC (12:00 ET) — both optimal for US feed engagement.
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const { data: todayTasks } = await sb.from('agent_tasks')
      .select('id, content_data')
      .eq('agent_id', 'content')
      .gte('created_at', todayStart.toISOString());
    const MAX_DAILY_POSTS = 2;
    if ((todayTasks?.length ?? 0) >= MAX_DAILY_POSTS) {
      return json({ skipped: true, reason: `Already ${todayTasks?.length} content tasks today (max ${MAX_DAILY_POSTS})`, task_ids: (todayTasks || []).map((t: Record<string, unknown>) => t.id) });
    }
    const nextLang = 'en'; // US-PIVOT: EN only. No HE generation.

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
        product_id:     picked.product_id,
        product_url:    `https://www.dubis.net/#product-${picked.product_id}`,
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

    // US-PIVOT: QA gate on caption_en. Legacy caption_he rows skipped.
    type Task = Record<string, unknown>;
    const { data: tasks, error: fetchErr } = await sb.from('agent_tasks')
      .select('id, title, notes, content_data')
      .eq('status', 'pending_approval')
      .eq('agent_id', 'content')
      .order('created_at', { ascending: true });
    if (fetchErr) return json({ error: fetchErr.message }, 500);

    const unscored = ((tasks || []) as Task[]).filter((t) => {
      const cd = (t.content_data as Task) || {};
      return cd.caption_en && !cd.qa_score;
    });

    if (!unscored.length) return json({ checked: 0, passed: 0, failed: 0, results: [], summary: 'All content tasks already passed QA' });

    const now = new Date().toISOString();
    const results: unknown[] = [];
    let passed = 0;
    let failed = 0;

    for (const task of unscored) {
     try {
      const cd = (task.content_data as Task) || {};
      // US-PIVOT: QA reviews EN caption only.
      const hashtags   = Array.isArray(cd.hashtags) ? (cd.hashtags as string[]).join(' ') : ((cd.hashtags as string) || '');
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

      // ── 1. English brand voice + grammar (30pts) — Gemini (US-PIVOT) ────
      let voiceScore = 0;
      const captionEn = (cd.caption_en as string) || '';
      try {
        const voicePrompt = `You are a DUBIS brand QA reviewer. DUBIS is a US anti-fashion apparel brand for people aged 35-55, tagline "For the rest of us."
Brand voice rules:
- Tone: self-aware dry humor, body-positive, conversational, anti-hype
- Banned words: perfect, stunning, must-have, insane, sale, discount, luxurious, premium, exclusive
- Short punchy sentences, first-person plural ("we", "us")
- No urgency-language, no salesy CTAs
- Ties to the product slogan and brand personality

English caption to review: "${captionEn}"
Product slogan on garment: "${productSlogan}"

Check:
1. English brand voice quality — is it on-brand, witty, anti-hype? (0-20)
2. Grammar correctness (0-5)
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

      // ── 2. Caption quality (25pts) — US-PIVOT: EN caption only ────
      let captionScore = 0;
      const captionLen = captionEn.length;
      const minLen = format === 'story' ? 10 : 50;
      const maxLen = format === 'story' ? 150 : 500; // EN captions can run a bit longer than the old HE limit
      if (captionLen >= minLen && captionLen <= maxLen) {
        captionScore = 20;
        // +5 if caption references the slogan or brand mark
        const slogan2 = ((cd.product_slogan as string) || '').toLowerCase();
        const sloganWords2 = slogan2.split(/\s+/).filter((w: string) => w.length > 3);
        const hasRef = sloganWords2.some((w: string) => captionEn.toLowerCase().includes(w));
        if (hasRef || captionEn.includes('DUBIS') || captionEn.toLowerCase().includes('dubis')) captionScore = 25;
      } else if (captionLen > 0) {
        captionScore = 10; // has content but wrong length
      }
      // PRODUCT-LINK RULE: caption must include product_url or fail outright
      const productUrlCd = (cd.product_url as string) || '';
      if (productUrlCd && !captionEn.includes(productUrlCd)) {
        captionScore = Math.min(captionScore, 8);
        failReasons.push(`caption missing product_url (${productUrlCd})`);
      }
      score += captionScore;
      qaDetails.caption_score = captionScore;
      qaDetails.caption_length = captionLen;
      if (captionScore < 10) failReasons.push(`caption out of range (${captionLen} chars)`);

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
      if (imageUrl && (imageUrl.includes('supabase.co') || imageUrl.includes('dubis.net'))) {
        imageScore = 20; // full score for both supabase.co AI images and dubis.net real photos
      } else if (imageUrl) {
        imageScore = 10;
      }
      score += imageScore;
      qaDetails.image_score = imageScore;
      qaDetails.image_url = imageUrl || null;
      if (imageScore === 0) failReasons.push('חסרה תמונה');

      // ── 5. No forbidden words (10pts) — US-PIVOT: EN banned list ────
      // Anti-hype brand voice — these are banned in any DUBIS customer-facing copy.
      const forbidden = ['perfect', 'stunning', 'must-have', 'insane', 'sale', 'discount', 'luxurious', 'premium', 'exclusive'];
      const captionEnLower = captionEn.toLowerCase();
      const foundForbidden = forbidden.filter((w) => captionEnLower.includes(w));
      const forbiddenScore = foundForbidden.length === 0 ? 10 : 0;
      score += forbiddenScore;
      qaDetails.forbidden_score = forbiddenScore;
      if (foundForbidden.length > 0) failReasons.push(`banned words: ${foundForbidden.join(', ')}`);

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
     } catch (taskErr) {
      // Catch per-task errors so one failure doesn't crash the entire QA run
      results.push({ id: task.id, title: task.title, score: 0, qa_pass: false, details: {}, fail_reasons: [`QA error: ${(taskErr as Error).message}`] });
      failed++;
     }
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
      // 1. Get next numeric product ID
      const { data: maxRow } = await sb.from('dubis_products')
        .select('product_id_numeric')
        .not('product_id_numeric', 'is', null)
        .order('product_id_numeric', { ascending: false })
        .limit(1)
        .single();
      const nextId = ((maxRow as Record<string, unknown>)?.product_id_numeric as number || 14) + 1;

      // 2. Build updates
      const updates: Record<string, unknown> = { active: true, source: 'approved', product_id_numeric: nextId };
      if (action === 'edit_approve' && edits && typeof edits === 'object') {
        Object.assign(updates, edits as Record<string, unknown>);
      }
      const { data: updated, error: upErr } = await sb.from('dubis_products')
        .update(updates).eq('id', product_id).select().single();
      if (upErr) return json({ error: upErr.message }, 500);
      const prod = updated as Record<string, unknown>;

      // 3. Add to SLOGAN_TYPOGRAPHY dynamically (runtime only — will be in DB for future)
      const sloganKey = (prod.slogan as string) || '';
      if (sloganKey && !SLOGAN_TYPOGRAPHY[sloganKey]) {
        SLOGAN_TYPOGRAPHY[sloganKey] = {
          small: (prod.typography_small as string) || '',
          big: (prod.typography_big as string) || '',
          after: (prod.typography_after as string) || '',
          layout: (prod.typography_layout as string) || 'top-bottom',
        };
      }

      // 4. Generate mockup image via Gemini (using image-capable model)
      let mockupUrl = '';
      const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
      if (geminiKey) {
        try {
          const clothType = (prod.clothing_type as string) || 't-shirt';
          const typeLabel: Record<string, string> = { 't-shirt': 'T-shirt', 'hoodie': 'Hoodie', 'zip-hoodie': 'Zip Hoodie', 'long-sleeve': 'Long-sleeve shirt', 'cap': 'Cap' };
          const garment = typeLabel[clothType] || 'T-shirt';
          const imgPrompt = `Professional product mockup photo: a dark black ${garment} laid flat on dark background. On the back of the ${garment}, white bold text is printed with dramatic size contrast: "${prod.typography_small || ''}" in small text, "${prod.typography_big || ''}" in HUGE bold Impact font (3x larger), "${prod.typography_after || ''}" in small text below. Clean product photography, no person, just the garment. Photorealistic, studio lighting. Do NOT add any other text or watermarks.`;

          const imgRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${geminiKey}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: imgPrompt }] }],
                generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
              }),
              signal: AbortSignal.timeout(60000) },
          );
          if (imgRes.ok) {
            const imgData = await imgRes.json();
            const parts = imgData?.candidates?.[0]?.content?.parts || [];
            const imgPart = parts.find((p: Record<string, unknown>) => (p.inlineData as Record<string,unknown>)?.mimeType?.toString().startsWith('image/'));
            if (imgPart?.inlineData?.data) {
              const raw = imgPart.inlineData.data as string;
              const imgBytes = Uint8Array.from(atob(raw), (c: string) => c.charCodeAt(0));
              await sb.storage.createBucket('product-images', { public: true }).catch(() => {});
              const fileName = `product-${nextId}.jpg`;
              const { error: upErr2 } = await sb.storage.from('product-images').upload(fileName, imgBytes, {
                contentType: imgPart.inlineData.mimeType || 'image/jpeg',
                upsert: true,
              });
              if (!upErr2) {
                const { data: { publicUrl } } = sb.storage.from('product-images').getPublicUrl(fileName);
                mockupUrl = publicUrl;
                // Save mockup URL to product record
                await sb.from('dubis_products').update({ image_url: mockupUrl }).eq('id', product_id);
              }
            }
          }
        } catch (imgErr) { console.error('Mockup generation error:', imgErr); }
      }

      // 5. Update agent_task
      const now = new Date().toISOString();
      await sb.from('agent_tasks')
        .update({ status: 'done', approved_at: now, updated_at: now,
          notes: `✅ מוצר #${nextId} אושר — ${sloganKey}${mockupUrl ? '\n🖼 תמונה: ' + mockupUrl : ''}` })
        .eq('agent_id', 'product')
        .filter('content_data->>product_id', 'eq', String(product_id));

      return json({
        success: true,
        action: 'approved',
        product_id_numeric: nextId,
        product: updated,
        mockup_url: mockupUrl || null,
      });
    }

    return json({ error: 'Use GET to list or POST to approve/reject' }, 405);
  }

  // ── SYNC-PRODUCTS — Generate products.js and push to GitHub ──────
  if (type === 'sync-products') {
    const adminOk = await verifyAdmin(req);
    const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
    const authHeader = req.headers.get('authorization') ?? '';
    const token = url.searchParams.get('token') || authHeader.replace('Bearer ', '').trim();
    const isCron = cronSecret && token === cronSecret;
    if (!adminOk && !isCron) return json({ error: 'Unauthorized' }, 401);

    // 1. Fetch all active products from DB
    const { data: products, error: fetchErr } = await sb.from('dubis_products')
      .select('*')
      .eq('active', true)
      .order('product_id_numeric', { ascending: true });
    if (fetchErr) return json({ error: fetchErr.message }, 500);
    if (!products?.length) return json({ error: 'No active products found' }, 404);

    // 2. Generate products.js content
    const JS_TYPE_MAP: Record<string, string> = { 't-shirt': 'tshirt', 'hoodie': 'hoodie', 'zip-hoodie': 'ziphoodie', 'long-sleeve': 'longsleeve', 'cap': 'cap' };
    const TYPE_META: Record<string, Record<string, string|null>> = {
      tshirt: { typeLabel: 'T-Shirt', fabric: '100% combed ring-spun cotton', fitUnisex: 'Unisex, regular fit', fitWomen: "Women's fitted cut", printMethod: 'DTG — Direct-to-Garment', printAreas: '["Front", "Back"]', care: 'CARE_TSHIRT', care_he: 'CARE_TSHIRT_HE', sizes: 'SIZES_TSHIRT', sizeGuide: 'SIZE_GUIDE_TSHIRT' },
      hoodie: { typeLabel: 'Hoodie', fabric: '80% cotton, 20% polyester — heavyweight fleece', fitUnisex: 'Unisex, relaxed fit', fitWomen: "Women's relaxed fit", printMethod: 'DTG — Direct-to-Garment', printAreas: '["Front", "Back"]', care: 'CARE_HOODIE', care_he: 'CARE_HOODIE_HE', sizes: 'SIZES_HOODIE', sizeGuide: 'SIZE_GUIDE_HOODIE' },
      ziphoodie: { typeLabel: 'Zip Hoodie', fabric: '80% cotton, 20% polyester — heavyweight fleece', fitUnisex: 'Unisex, regular fit', fitWomen: "Women's fitted cut", printMethod: 'DTG — Direct-to-Garment', printAreas: '["Front", "Back"]', care: 'CARE_HOODIE', care_he: 'CARE_HOODIE_HE', sizes: 'SIZES_HOODIE', sizeGuide: 'SIZE_GUIDE_HOODIE' },
      longsleeve: { typeLabel: 'Long-Sleeve', fabric: '100% combed ring-spun cotton', fitUnisex: 'Unisex, regular fit', fitWomen: "Women's fitted cut", printMethod: 'DTG — Direct-to-Garment', printAreas: '["Front", "Back"]', care: 'CARE_TSHIRT', care_he: 'CARE_TSHIRT_HE', sizes: 'SIZES_LONGSLEEVE', sizeGuide: 'SIZE_GUIDE_LONGSLEEVE' },
      cap: { typeLabel: 'Cap', fabric: '100% chino cotton twill, unstructured', fitUnisex: 'One Size, adjustable strap', fitWomen: 'One Size, adjustable strap', printMethod: 'Embroidery', printAreas: '["Front"]', care: null, care_he: 'CARE_CAP_HE', sizes: 'SIZES_CAP', sizeGuide: null },
    };
    const PRICES: Record<string, number> = { tshirt: 28, hoodie: 41, ziphoodie: 46, longsleeve: 31, cap: 28 };

    const esc = (s: string) => (s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

    function genEntry(p: Record<string, unknown>) {
      const pType = JS_TYPE_MAP[(p.clothing_type as string)] || (p.clothing_type as string) || 'tshirt';
      const meta = TYPE_META[pType] || TYPE_META.tshirt;
      const fit = p.category === 'women' ? meta.fitWomen : meta.fitUnisex;
      const price = (p.price_usd as number) || PRICES[pType] || 28;
      const pid = (p.product_id_numeric as number) || p.id;
      const colors = JSON.stringify(p.colors || ['Black', 'White']);
      const careStr = meta.care ? `care: ${meta.care},` : `care: ["Spot clean only","Do not machine wash","Do not tumble dry","Reshape and air dry"],`;
      const sgStr = meta.sizeGuide ? `sizeGuide: ${meta.sizeGuide}` : `sizeGuide: [{ size: 'One Size', note: 'Adjustable strap, fits most head sizes' }]`;
      return `    {
        id: ${pid},
        phrase: "${esc((p.slogan as string) || '')}",
        type: "${pType}",
        typeLabel: "${meta.typeLabel}",
        gender: "${p.category || 'unisex'}",
        price: ${price},
        image: "images/product-${pid}.jpg",
        colors: ${colors},
        sizes: ${meta.sizes},
        description: "${esc((p.description_en as string) || '')}",
        description_he: "${esc((p.description_he as string) || '')}",
        fabric: "${meta.fabric}",
        fit: "${fit}",
        printMethod: "${meta.printMethod}",
        printAreas: ${meta.printAreas},
        ${careStr}
        care_he: ${meta.care_he},
        ${sgStr}
    }`;
    }

    const header = `// DUBIS - Product Catalog
// Auto-generated by sync-products — DO NOT EDIT MANUALLY
// Last sync: ${new Date().toISOString()}
// Collection 01 - For the rest of us

const SIZES_TSHIRT    = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
const SIZES_HOODIE    = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
const SIZES_LONGSLEEVE = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
const SIZES_CAP       = ['One Size'];

const SIZE_GUIDE_TSHIRT = [
    { size: 'S',   chest: 46, length: 70 },
    { size: 'M',   chest: 51, length: 72 },
    { size: 'L',   chest: 56, length: 74 },
    { size: 'XL',  chest: 61, length: 76 },
    { size: '2XL', chest: 66, length: 78 },
    { size: '3XL', chest: 71, length: 80 },
];

const SIZE_GUIDE_HOODIE = [
    { size: 'S',   chest: 56, length: 67 },
    { size: 'M',   chest: 61, length: 70 },
    { size: 'L',   chest: 66, length: 73 },
    { size: 'XL',  chest: 71, length: 76 },
    { size: '2XL', chest: 76, length: 79 },
    { size: '3XL', chest: 81, length: 82 },
];

const SIZE_GUIDE_LONGSLEEVE = SIZE_GUIDE_TSHIRT;

const CARE_TSHIRT = [
    "Machine wash cold, inside out",
    "Tumble dry low heat",
    "Do not bleach",
    "Do not iron directly on print",
    "Do not dry clean"
];

const CARE_HOODIE = [
    "Machine wash cold, inside out",
    "Tumble dry low heat",
    "Do not bleach",
    "Do not iron directly on print",
    "Do not dry clean"
];

const CARE_TSHIRT_HE = [
    "כביסה קרה במכונה, בפנים החוצה",
    "ייבוש בחום נמוך",
    "אין להלבין",
    "אל תגהץ ישירות על ההדפסה",
    "אין לניקוי יבש"
];

const CARE_HOODIE_HE = CARE_TSHIRT_HE;

const CARE_CAP_HE = [
    "ניקוי ידני בלבד",
    "אין כביסה במכונה",
    "אין לייבש במייבש",
    "עצב מחדש וייבש באוויר"
];
`;

    type Prod = Record<string, unknown>;
    const unisex = products.filter((p: Prod) => (p.category || 'unisex') === 'unisex');
    const men = products.filter((p: Prod) => p.category === 'men');
    const women = products.filter((p: Prod) => p.category === 'women');

    let body = 'const products = [\n';
    if (unisex.length) { body += '\n    // ─── UNISEX ────────────────────\n\n'; body += unisex.map((p: Prod) => genEntry(p)).join(',\n'); body += ',\n'; }
    if (men.length) { body += "\n    // ─── MEN'S ─────────────────────\n\n"; body += men.map((p: Prod) => genEntry(p)).join(',\n'); body += ',\n'; }
    if (women.length) { body += "\n    // ─── WOMEN'S ───────────────────\n\n"; body += women.map((p: Prod) => genEntry(p)).join(',\n'); body += ',\n'; }
    body += '];\n';

    const content = header + '\n' + body;

    // Validate generated content before pushing
    if (!content.includes('const products = [') || !content.includes('id: 1,')) {
      return json({ error: 'Generated products.js failed validation — aborting push', preview: content.substring(0, 300) }, 500);
    }

    // 3. Push to GitHub if GITHUB_TOKEN is set
    let pushed = false;
    let pushError = '';
    const ghToken = Deno.env.get('GITHUB_TOKEN') ?? '';
    if (ghToken) {
      try {
        const repo = 'dubis-brand/dubis-website';
        const filePath = 'js/products.js';
        // Get current file SHA
        const getRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
          headers: { 'Authorization': `token ${ghToken}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'DUBIS-Sync' },
        });
        const fileData = await getRes.json();
        const sha = fileData.sha || '';
        // Encode content to base64 (Deno-compatible)
        const encoder = new TextEncoder();
        const bytes = encoder.encode(content);
        const encoded = btoa(String.fromCharCode(...bytes));
        // Push update
        const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
          method: 'PUT',
          headers: { 'Authorization': `token ${ghToken}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json', 'User-Agent': 'DUBIS-Sync' },
          body: JSON.stringify({
            message: `sync: update products.js (${products.length} products)`,
            content: encoded,
            sha,
            branch: 'main',
          }),
        });
        pushed = putRes.ok;
        if (!pushed) pushError = await putRes.text();
      } catch (e) { pushError = (e as Error).message; }
    }

    return json({
      success: true,
      product_count: products.length,
      pushed_to_github: pushed,
      push_error: pushError || undefined,
      content: pushed ? undefined : content,
    });
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

  // ── serve-image: serve IG images with clean headers (no X-Robots-Tag) ──
  // ══════════════════════════════════════════════════════════
  // VIDEO PIPELINE — AI-generated promo videos
  // ══════════════════════════════════════════════════════════

  // ── Shared auth helper for video pipeline routes ──
  function checkVideoAuth(r: Request, u: URL): boolean {
    const svcKey2      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const cronSecret2  = Deno.env.get('CRON_SECRET') ?? '';
    const agentSecret3 = Deno.env.get('AGENT_SECRET') ?? '';
    const ah  = r.headers.get('authorization') ?? '';
    const tok = u.searchParams.get('token') || ah.replace('Bearer ', '').trim() || r.headers.get('x-agent-secret') || '';
    return !!((svcKey2 && tok === svcKey2) || (cronSecret2 && tok === cronSecret2) || (agentSecret3 && tok === agentSecret3));
  }

  // ── GENERATE-VIDEO-SCRIPT ─────────────────────────────────
  if (type === 'generate-video-script') {
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    const admin = await verifyAdmin(req);
    if (!admin && !checkVideoAuth(req, url) && !isAgentSecret(req)) return json({ error: 'Unauthorized' }, 401);

    const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
    if (!geminiKey) return json({ error: 'GEMINI_API_KEY not configured' }, 503);

    const b = body as Record<string, string>;
    const language = b.language || 'en';
    const style = b.style || 'humor';
    const duration = parseInt(b.duration || '15', 10);
    const productSlogan = b.product_slogan || '';
    const productType = b.product_type || 'tshirt';

    // If no slogan provided, pick one randomly from our catalog
    type ProductDef = { slogan: string; type: string; gender: string };
    const VIDEO_PRODUCTS: ProductDef[] = [
      { slogan: "I am not fat, I am a LIMITED edition.", type: 'tshirt', gender: 'unisex' },
      { slogan: "more of me to LOVE", type: 'tshirt', gender: 'unisex' },
      { slogan: "NAPPING IS MY CARDIO", type: 'hoodie', gender: 'unisex' },
      { slogan: "I survived. That's enough.", type: 'tshirt', gender: 'unisex' },
      { slogan: "low maintenance, high VALUE", type: 'tshirt', gender: 'unisex' },
      { slogan: "Not a model. NEVER. wanted to be.", type: 'hoodie', gender: 'unisex' },
      { slogan: "NAP — Born to nap, forced to work", type: 'tshirt', gender: 'unisex' },
      { slogan: "certified OVER thinker", type: 'ziphoodie', gender: 'unisex' },
      { slogan: "serial NAPPER", type: 'longsleeve', gender: 'unisex' },
      { slogan: "Zero Motivation CLUB", type: 'hoodie', gender: 'women' },
      { slogan: "emotionally attached to my COUCH", type: 'longsleeve', gender: 'women' },
      { slogan: "COFFEE — I run on coffee and sarcasm.", type: 'tshirt', gender: 'women' },
    ];
    const picked = productSlogan
      ? { slogan: productSlogan, type: productType, gender: b.gender || 'unisex' }
      : VIDEO_PRODUCTS[Math.floor(Math.random() * VIDEO_PRODUCTS.length)];

    const typo = SLOGAN_TYPOGRAPHY[Object.keys(SLOGAN_TYPOGRAPHY).find(
      k => k.toLowerCase() === picked.slogan.replace(/\s+/g, ' ').toLowerCase()
        || picked.slogan.toLowerCase().includes(k.toLowerCase().substring(0, 15))
    ) || ''];

    const garmentNames: Record<string, string> = { tshirt: 't-shirt', hoodie: 'hoodie', ziphoodie: 'zip hoodie', longsleeve: 'long sleeve', cap: 'cap' };
    const garmentName = garmentNames[picked.type] || 't-shirt';

    const numScenes = duration <= 15 ? 4 : 6;
    const sceneDuration = Math.round(duration / numScenes);

    const prompt = `You are a creative director making a ${duration}-second Instagram Reel ad for DUBIS — an Israeli body-positive humor apparel brand.

Product: ${garmentName} with slogan "${picked.slogan}"
${typo ? `Typography: small="${typo.small}" BIG="${typo.big}" after="${typo.after}"` : ''}
Language: ${language === 'he' ? 'Hebrew' : 'English'}
Style: ${style} (${style === 'humor' ? 'self-aware cynical humor' : style === 'promo' ? 'direct product promotion' : 'lifestyle/relatable'})
Target: 25-45, body-positive, comfort-first

Create EXACTLY ${numScenes} scenes. Each scene is ~${sceneDuration} seconds.

CRITICAL VISUAL RULES — Every scene MUST follow these:
1. The DUBIS ${garmentName} with the slogan "${picked.slogan}" MUST be CLEARLY VISIBLE in EVERY scene where a person appears
2. The slogan text on the garment must use mixed-size typography: ${typo ? `small "${typo.small}", HUGE BOLD "${typo.big}", small "${typo.after}"` : `huge bold "${picked.slogan}"`}
3. Power word is 3-5x larger than other text, white sans-serif on dark fabric
4. Small "DUBIS™" logo on left chest
5. The model should be wearing the ACTUAL ${garmentName} prominently — slogan readable
6. Person: 25-45, body-positive, diverse, authentic (NOT a fashion model)
7. Each visual_prompt must explicitly describe the garment text and typography

Structure:
${duration <= 15 ? `Scene 1: HOOK — relatable funny situation (person wearing the DUBIS ${garmentName} with slogan visible)
Scene 2: SLOGAN CLOSE-UP — close-up of the ${garmentName} showing the slogan typography clearly
Scene 3: PRODUCT WEAR — full view of person wearing the ${garmentName}, slogan visible, lifestyle setting
Scene 4: CTA — close-up of garment with slogan + small text "dubis.net" overlay` :
`Scene 1: HOOK — relatable funny situation (${language === 'he' ? 'Israeli humor' : 'universal humor'})
Scene 2: PROBLEM — "you need this ${garmentName}"
Scene 3: SLOGAN REVEAL — dramatic typography, power word "${typo?.big || picked.slogan.split(' ').reduce((a,b) => a.length > b.length ? a : b)}" huge
Scene 4: PRODUCT SHOWCASE — the ${garmentName} in different colors
Scene 5: SOCIAL PROOF — "${language === 'he' ? 'הצטרפו לקהילת DUBIS' : 'Join the DUBIS community'}"
Scene 6: CTA — dubis.net + logo`}

Return ONLY valid JSON (no markdown):
{
  "title": "short title",
  "slogan": "${picked.slogan}",
  "product_type": "${picked.type}",
  "language": "${language}",
  "total_duration": ${duration},
  "scenes": [
    {
      "scene_number": 1,
      "duration": ${sceneDuration},
      "narration": "${language === 'he' ? 'Hebrew narration text' : 'English narration text'}",
      "visual_prompt": "detailed image generation prompt for this scene (English, photorealistic)",
      "text_overlay": "text to show on screen (max 5 words)",
      "text_style": "large|medium|small",
      "transition": "fade|slide|zoom"
    }
  ],
  "music_prompt": "short description of background music mood",
  "music_style": "lo-fi|upbeat|chill|dramatic",
  "cta_text": "Shop now at dubis.net",
  "color_palette": { "bg": "#1a1a2e", "text": "#ffffff", "accent": "#c9a84c" }
}`;

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
          signal: AbortSignal.timeout(30000) },
      );
      const raw = (await res.json()).candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleaned = raw.replace(/```json|```/g, '').trim();
      const script = JSON.parse(cleaned);

      // Save to agent_tasks if requested
      if (b.save_task === 'true') {
        const { data: task } = await sb.from('agent_tasks').insert({
          agent_id: 'content',
          title: `Video — ${script.title || picked.slogan}`,
          description: `סרטון ${duration} שניות: ${picked.slogan}`,
          category: 'video',
          status: 'approved',
          priority: 'medium',
          content_data: {
            content_type: 'video',
            format: 'reel',
            video_script: script,
            product_slogan: picked.slogan,
            product_type: picked.type,
            language,
            style,
            duration,
            pipeline_step: 'script_ready',
          },
        }).select('id').single();
        return json({ success: true, task_id: (task as Record<string, unknown>)?.id, script });
      }

      return json({ success: true, script });
    } catch (e) {
      return json({ error: 'Script generation failed: ' + (e as Error).message }, 500);
    }
  }

  // ── GENERATE-VIDEO-ASSETS ─────────────────────────────────
  if (type === 'generate-video-assets') {
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    const admin = await verifyAdmin(req);
    if (!admin && !checkVideoAuth(req, url) && !isAgentSecret(req)) return json({ error: 'Unauthorized' }, 401);

    const falKey = Deno.env.get('FAL_API_KEY') ?? '';
    const elevenKey = Deno.env.get('ELEVENLABS_API_KEY') ?? '';

    const b = body as Record<string, unknown>;
    const taskId = b.task_id as string;
    let script = b.script as Record<string, unknown> | null;

    // Load script from task if task_id provided
    if (taskId && !script) {
      const { data: taskRow } = await sb.from('agent_tasks').select('content_data').eq('id', taskId).single();
      if (!taskRow) return json({ error: 'Task not found' }, 404);
      script = ((taskRow as Record<string, unknown>).content_data as Record<string, unknown>)?.video_script as Record<string, unknown> || null;
    }
    if (!script || !script.scenes) return json({ error: 'script with scenes required (or task_id with video_script)' }, 400);

    const scenes = script.scenes as Record<string, unknown>[];
    const assets: Record<string, unknown>[] = [];

    // Ensure video-assets bucket exists
    await sb.storage.createBucket('video-assets', { public: true }).catch(() => {});

    // ── Generate scene images via fal.ai FLUX ──
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const assetData: Record<string, unknown> = { scene_number: i + 1 };

      if (falKey && scene.visual_prompt) {
        try {
          const falRes = await fetch('https://fal.run/fal-ai/flux/schnell', {
            method: 'POST',
            headers: {
              'Authorization': `Key ${falKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              prompt: `${scene.visual_prompt}. Square format 1080x1080. Photorealistic. High quality. Cinematic lighting.`,
              image_size: 'square_hd',
              num_images: 1,
              enable_safety_checker: true,
            }),
            signal: AbortSignal.timeout(60000),
          });
          const falData = await falRes.json();
          const imageUrl = falData.images?.[0]?.url || falData.output?.images?.[0]?.url;

          if (imageUrl) {
            // Download and upload to Supabase Storage
            const imgRes = await fetch(imageUrl);
            if (imgRes.ok) {
              const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
              const fname = `video-scene-${taskId || 'gen'}-${i + 1}-${Date.now()}.jpg`;
              const { error: upErr } = await sb.storage.from('video-assets').upload(fname, imgBytes, { contentType: 'image/jpeg', upsert: true });
              if (!upErr) {
                const { data: { publicUrl } } = sb.storage.from('video-assets').getPublicUrl(fname);
                assetData.image_url = publicUrl;
              } else {
                assetData.image_url = imageUrl; // fallback to fal.ai URL
              }
            }
          } else {
            assetData.image_error = falData.detail || 'No image returned';
          }
        } catch (e) {
          assetData.image_error = (e as Error).message;
        }
      } else if (!falKey) {
        assetData.image_error = 'FAL_API_KEY not configured';
      }

      // ── Generate narration audio via ElevenLabs TTS ──
      if (elevenKey && scene.narration) {
        try {
          // Use a default voice - Rachel for English, default for Hebrew
          const lang = (script.language as string) || 'en';
          const voiceId = lang === 'he' ? 'pFZP5JQG7iQjIQuC4Bku' : 'EXAVITQu4vr4xnSDxMaL'; // Lily / Sarah
          const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
              'xi-api-key': elevenKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              text: scene.narration as string,
              model_id: 'eleven_multilingual_v2',
              voice_settings: { stability: 0.5, similarity_boost: 0.75 },
            }),
            signal: AbortSignal.timeout(30000),
          });

          if (ttsRes.ok && ttsRes.headers.get('content-type')?.includes('audio')) {
            const audioBytes = new Uint8Array(await ttsRes.arrayBuffer());
            const fname = `video-audio-${taskId || 'gen'}-${i + 1}-${Date.now()}.mp3`;
            const { error: upErr } = await sb.storage.from('video-assets').upload(fname, audioBytes, { contentType: 'audio/mpeg', upsert: true });
            if (!upErr) {
              const { data: { publicUrl } } = sb.storage.from('video-assets').getPublicUrl(fname);
              assetData.audio_url = publicUrl;
            }
          } else {
            const errData = await ttsRes.text();
            assetData.audio_error = `ElevenLabs ${ttsRes.status}: ${errData.substring(0, 200)}`;
          }
        } catch (e) {
          assetData.audio_error = (e as Error).message;
        }
      } else if (!elevenKey) {
        assetData.audio_error = 'ELEVENLABS_API_KEY not configured';
      }

      // Text overlay data (for render step)
      assetData.text_overlay = scene.text_overlay || '';
      assetData.text_style = scene.text_style || 'large';
      assetData.duration = scene.duration || 4;
      assetData.transition = scene.transition || 'fade';

      assets.push(assetData);
    }

    // ── Generate background music via ElevenLabs Sound Effects ──
    let musicUrl: string | null = null;
    if (elevenKey && script.music_prompt) {
      try {
        const sfxRes = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
          method: 'POST',
          headers: {
            'xi-api-key': elevenKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: `${script.music_prompt}. ${script.music_style || 'lo-fi'} instrumental background music, ${script.total_duration || 15} seconds`,
            duration_seconds: (script.total_duration as number) || 15,
          }),
          signal: AbortSignal.timeout(30000),
        });
        if (sfxRes.ok && sfxRes.headers.get('content-type')?.includes('audio')) {
          const musicBytes = new Uint8Array(await sfxRes.arrayBuffer());
          const fname = `video-music-${taskId || 'gen'}-${Date.now()}.mp3`;
          const { error: upErr } = await sb.storage.from('video-assets').upload(fname, musicBytes, { contentType: 'audio/mpeg', upsert: true });
          if (!upErr) {
            const { data: { publicUrl } } = sb.storage.from('video-assets').getPublicUrl(fname);
            musicUrl = publicUrl;
          }
        }
      } catch { /* music is optional */ }
    }

    // Update task if task_id provided
    if (taskId) {
      const { data: taskRow } = await sb.from('agent_tasks').select('content_data').eq('id', taskId).single();
      if (taskRow) {
        const cd = (taskRow as Record<string, unknown>).content_data as Record<string, unknown>;
        await sb.from('agent_tasks').update({
          content_data: { ...cd, video_assets: assets, video_music_url: musicUrl, pipeline_step: 'assets_ready' },
          updated_at: new Date().toISOString(),
        }).eq('id', taskId);
      }
    }

    const imagesGenerated = assets.filter(a => a.image_url).length;
    const audiosGenerated = assets.filter(a => a.audio_url).length;

    return json({
      success: true,
      task_id: taskId || null,
      assets,
      music_url: musicUrl,
      summary: {
        scenes: scenes.length,
        images_generated: imagesGenerated,
        audios_generated: audiosGenerated,
        has_music: !!musicUrl,
        missing_keys: [
          ...(!falKey ? ['FAL_API_KEY'] : []),
          ...(!elevenKey ? ['ELEVENLABS_API_KEY'] : []),
        ],
      },
    });
  }

  // ── RENDER-VIDEO ──────────────────────────────────────────
  if (type === 'render-video') {
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    const admin = await verifyAdmin(req);
    if (!admin && !checkVideoAuth(req, url) && !isAgentSecret(req)) return json({ error: 'Unauthorized' }, 401);

    const falKey = Deno.env.get('FAL_API_KEY') ?? '';
    if (!falKey) return json({ error: 'FAL_API_KEY not configured' }, 503);

    const b = body as Record<string, unknown>;
    const taskId = b.task_id as string;
    if (!taskId) return json({ error: 'task_id required for webhook-based rendering' }, 400);

    const { data: taskRow } = await sb.from('agent_tasks').select('content_data').eq('id', taskId).single();
    if (!taskRow) return json({ error: 'Task not found' }, 404);
    const cd = (taskRow as Record<string, unknown>).content_data as Record<string, unknown>;
    const assets = (cd.video_assets as Record<string, unknown>[]) || [];
    const script = (cd.video_script as Record<string, unknown>) || null;

    if (!assets.length) return json({ error: 'No assets to render. Run generate-video-assets first.' }, 400);
    const sceneAssets = assets.filter(a => a.image_url);
    if (sceneAssets.length < 2) return json({ error: `Need at least 2 scene images, got ${sceneAssets.length}` }, 400);

    // ── WEBHOOK-BASED RENDERING ──
    // Submit all Kling jobs with fal_webhook → kling-callback updates task as each finishes
    // When all done, kling-callback triggers compose with webhook → compose-callback saves final video
    const cbSecret = Deno.env.get('CRON_SECRET') || Deno.env.get('AGENT_SECRET') || 'cb';
    const baseUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/agents`;
    const scenes = (script?.scenes as Record<string, unknown>[]) || [];

    const sceneJobs: Record<string, unknown>[] = [];
    for (let i = 0; i < sceneAssets.length; i++) {
      const sc = scenes[i] || {};
      const motion = `Subtle natural movement, slow camera zoom in, cinematic lifestyle ad shot. ${sc.visual_prompt || ''}`.substring(0, 480);
      const cbUrl = `${baseUrl}?type=kling-callback&task_id=${taskId}&scene=${i}&secret=${cbSecret}`;
      try {
        const r = await fetch(`https://queue.fal.run/fal-ai/kling-video/v1.6/standard/image-to-video?fal_webhook=${encodeURIComponent(cbUrl)}`, {
          method: 'POST',
          headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: motion,
            image_url: sceneAssets[i].image_url as string,
            duration: '5',
            aspect_ratio: '1:1',
          }),
        });
        const d = await r.json();
        sceneJobs.push({ idx: i, request_id: d.request_id || null, status: d.request_id ? 'pending' : 'submit_failed', error: d.request_id ? null : JSON.stringify(d).substring(0, 200) });
      } catch (e) {
        sceneJobs.push({ idx: i, request_id: null, status: 'submit_failed', error: (e as Error).message });
      }
    }

    await sb.from('agent_tasks').update({
      content_data: {
        ...cd,
        reel_status: 'rendering',
        pipeline_step: 'kling_in_progress',
        kling_jobs: sceneJobs,
        scene_video_urls: new Array(sceneAssets.length).fill(null),
        render_started_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    }).eq('id', taskId);

    return json({
      success: true,
      status: 'processing',
      task_id: taskId,
      scenes_submitted: sceneJobs.filter(j => j.request_id).length,
      message: 'Kling jobs submitted with webhooks. Check task content_data.reel_status (rendering→ready/failed). Typical wait: 3-5 minutes.',
    });
  }

  // ── KLING-CALLBACK ─── Webhook from fal.ai when each scene Kling completes ──
  if (type === 'kling-callback') {
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    const cbSecret = Deno.env.get('CRON_SECRET') || Deno.env.get('AGENT_SECRET') || 'cb';
    if (url.searchParams.get('secret') !== cbSecret) return json({ error: 'Unauthorized' }, 401);

    const taskId = url.searchParams.get('task_id') || '';
    const sceneIdx = parseInt(url.searchParams.get('scene') || '0', 10);
    const payload = body as Record<string, unknown>;
    const status = payload.status as string;
    const result = (payload.payload as Record<string, unknown>) || {};
    const videoUrl = (result.video as Record<string, unknown>)?.url as string || null;

    const { data: tr } = await sb.from('agent_tasks').select('content_data').eq('id', taskId).single();
    if (!tr) return json({ ok: true, note: 'task not found' });
    const cd = (tr as Record<string, unknown>).content_data as Record<string, unknown>;
    const sceneVideos = ((cd.scene_video_urls as (string | null)[]) || []).slice();
    const jobs = ((cd.kling_jobs as Record<string, unknown>[]) || []).slice();

    if (status === 'OK' && videoUrl) {
      sceneVideos[sceneIdx] = videoUrl;
      if (jobs[sceneIdx]) jobs[sceneIdx] = { ...jobs[sceneIdx], status: 'done' };
    } else {
      if (jobs[sceneIdx]) jobs[sceneIdx] = { ...jobs[sceneIdx], status: 'failed', error: JSON.stringify(payload.error || payload).substring(0, 300) };
    }

    // Check if all scenes done (success or failed)
    const allDone = jobs.every(j => j.status === 'done' || j.status === 'failed' || j.status === 'submit_failed');
    const successCount = sceneVideos.filter(v => !!v).length;

    const newCd: Record<string, unknown> = { ...cd, scene_video_urls: sceneVideos, kling_jobs: jobs };

    if (allDone) {
      if (successCount === 0) {
        newCd.reel_status = 'failed';
        newCd.render_error = 'All Kling animations failed';
        await sb.from('agent_tasks').update({ content_data: newCd, updated_at: new Date().toISOString() }).eq('id', taskId);
        return json({ ok: true, all_done: true, success_count: 0 });
      }

      // Build compose tracks
      const sceneDurationMs = 5000;
      const totalDurationMs = sceneVideos.length * sceneDurationMs;
      const videoKeyframes: Record<string, unknown>[] = [];
      const imageKeyframes: Record<string, unknown>[] = [];
      const assets = (cd.video_assets as Record<string, unknown>[]) || [];
      const sceneAssets = assets.filter(a => a.image_url);
      for (let i = 0; i < sceneAssets.length; i++) {
        const v = sceneVideos[i];
        const kf = { timestamp: i * sceneDurationMs, duration: sceneDurationMs };
        if (v) videoKeyframes.push({ ...kf, url: v });
        else imageKeyframes.push({ ...kf, url: sceneAssets[i].image_url as string });
      }
      const tracks: Record<string, unknown>[] = [];
      if (videoKeyframes.length) tracks.push({ id: 'v', type: 'video', keyframes: videoKeyframes });
      if (imageKeyframes.length) tracks.push({ id: 'i', type: 'image', keyframes: imageKeyframes });

      const audioAssets = assets.filter(a => a.audio_url);
      if (audioAssets.length > 0) {
        const audioKeyframes = audioAssets.map((a, i) => ({ url: a.audio_url as string, timestamp: i * sceneDurationMs, duration: sceneDurationMs }));
        tracks.push({ id: 'a', type: 'audio', keyframes: audioKeyframes });
      }
      const musicUrl = (cd.video_music_url as string) || null;
      if (musicUrl) tracks.push({ id: 'm', type: 'audio', keyframes: [{ url: musicUrl, timestamp: 0, duration: totalDurationMs }] });

      // Submit compose with webhook
      const falKey = Deno.env.get('FAL_API_KEY') ?? '';
      const composeWebhook = `${Deno.env.get('SUPABASE_URL')}/functions/v1/agents?type=compose-callback&task_id=${taskId}&secret=${cbSecret}`;
      try {
        const r = await fetch(`https://queue.fal.run/fal-ai/ffmpeg-api/compose?fal_webhook=${encodeURIComponent(composeWebhook)}`, {
          method: 'POST',
          headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ tracks }),
        });
        const d = await r.json();
        newCd.pipeline_step = 'compose_in_progress';
        newCd.compose_request_id = d.request_id || null;
        if (!d.request_id) {
          newCd.reel_status = 'failed';
          newCd.render_error = `Compose submit failed: ${JSON.stringify(d).substring(0, 200)}`;
        }
      } catch (e) {
        newCd.reel_status = 'failed';
        newCd.render_error = `Compose submit error: ${(e as Error).message}`;
      }
    }

    await sb.from('agent_tasks').update({ content_data: newCd, updated_at: new Date().toISOString() }).eq('id', taskId);
    return json({ ok: true, scene: sceneIdx, all_done: allDone });
  }

  // ── COMPOSE-CALLBACK ─── Webhook from fal.ai when ffmpeg compose completes ──
  if (type === 'compose-callback') {
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    const cbSecret = Deno.env.get('CRON_SECRET') || Deno.env.get('AGENT_SECRET') || 'cb';
    if (url.searchParams.get('secret') !== cbSecret) return json({ error: 'Unauthorized' }, 401);

    const taskId = url.searchParams.get('task_id') || '';
    const payload = body as Record<string, unknown>;
    const status = payload.status as string;
    const result = (payload.payload as Record<string, unknown>) || {};
    const videoUrl = (result.video_url as string)
      || ((result.video as Record<string, unknown>)?.url as string)
      || null;

    const { data: tr } = await sb.from('agent_tasks').select('content_data').eq('id', taskId).single();
    if (!tr) return json({ ok: true, note: 'task not found' });
    const cd = (tr as Record<string, unknown>).content_data as Record<string, unknown>;

    if (status !== 'OK' || !videoUrl) {
      await sb.from('agent_tasks').update({
        content_data: { ...cd, reel_status: 'failed', render_error: `Compose failed: ${JSON.stringify(payload.error || payload).substring(0, 300)}` },
        updated_at: new Date().toISOString(),
      }).eq('id', taskId);
      return json({ ok: true, status: 'failed' });
    }

    // Download to Supabase Storage
    try {
      const vidRes = await fetch(videoUrl);
      if (!vidRes.ok) throw new Error(`fetch ${vidRes.status}`);
      const vidBytes = new Uint8Array(await vidRes.arrayBuffer());
      const fname = `dubis-video-${taskId}-${Date.now()}.mp4`;
      await sb.storage.createBucket('videos', { public: true }).catch(() => {});
      const { error: upErr } = await sb.storage.from('videos').upload(fname, vidBytes, { contentType: 'video/mp4', upsert: true });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = sb.storage.from('videos').getPublicUrl(fname);
      await sb.from('agent_tasks').update({
        content_data: { ...cd, video_url: publicUrl, reel_status: 'ready', pipeline_step: 'render_ready', render_completed_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      }).eq('id', taskId);
      return json({ ok: true, video_url: publicUrl });
    } catch (e) {
      // Fallback: store fal.ai temporary URL
      await sb.from('agent_tasks').update({
        content_data: { ...cd, video_url: videoUrl, reel_status: 'ready', pipeline_step: 'render_ready', note: 'Stored on fal.ai (temp URL): ' + (e as Error).message },
        updated_at: new Date().toISOString(),
      }).eq('id', taskId);
      return json({ ok: true, video_url: videoUrl, note: 'fallback fal url' });
    }
  }


  // ── VIDEO-PIPELINE ─── Full orchestration ─────────────────
  if (type === 'video-pipeline') {
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    const admin = await verifyAdmin(req);
    if (!admin && !checkVideoAuth(req, url) && !isAgentSecret(req)) return json({ error: 'Unauthorized' }, 401);

    const b = body as Record<string, unknown>;
    const language = (b.language as string) || 'en';
    const style = (b.style as string) || 'humor';
    const duration = parseInt((b.duration as string) || '15', 10);
    const productSlogan = (b.product_slogan as string) || '';
    const skipRender = b.skip_render === true; // For testing: only script + assets
    const edgeBase = `${Deno.env.get('SUPABASE_URL')?.replace('/rest/v1', '')}/functions/v1/agents`;
    const authHeaderVal = `Bearer ${svcKey}`;
    const results: Record<string, unknown> = { steps: {} };

    try {
      // Step 1: Generate script + save as task
      const scriptRes = await fetch(`${edgeBase}?type=generate-video-script`, {
        method: 'POST',
        headers: { 'Authorization': authHeaderVal, 'Content-Type': 'application/json' },
        body: JSON.stringify({ language, style, duration, product_slogan: productSlogan, product_type: b.product_type || '', gender: b.gender || '', save_task: 'true' }),
        signal: AbortSignal.timeout(45000),
      });
      const scriptData = await scriptRes.json();
      (results.steps as Record<string, unknown>).script = { success: !!scriptData.success, task_id: scriptData.task_id };
      results.task_id = scriptData.task_id;

      if (!scriptData.success || !scriptData.task_id) {
        return json({ ...results, success: false, error: 'Script generation failed', detail: scriptData });
      }

      // Step 2: Generate assets (images + audio)
      const assetsRes = await fetch(`${edgeBase}?type=generate-video-assets`, {
        method: 'POST',
        headers: { 'Authorization': authHeaderVal, 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: scriptData.task_id }),
        signal: AbortSignal.timeout(120000),
      });
      const assetsData = await assetsRes.json();
      (results.steps as Record<string, unknown>).assets = {
        success: !!assetsData.success,
        images: assetsData.summary?.images_generated || 0,
        audios: assetsData.summary?.audios_generated || 0,
        has_music: assetsData.summary?.has_music || false,
      };

      if (skipRender) {
        return json({ ...results, success: true, note: 'Pipeline stopped after assets (skip_render=true)', script: scriptData.script });
      }

      // Step 3: Render video
      const renderRes = await fetch(`${edgeBase}?type=render-video`, {
        method: 'POST',
        headers: { 'Authorization': authHeaderVal, 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: scriptData.task_id }),
        signal: AbortSignal.timeout(180000),
      });
      const renderData = await renderRes.json();
      (results.steps as Record<string, unknown>).render = { success: !!renderData.success, video_url: renderData.video_url || null };

      return json({
        ...results,
        success: !!renderData.video_url,
        video_url: renderData.video_url || null,
        script: scriptData.script,
      });
    } catch (e) {
      return json({ ...results, success: false, error: (e as Error).message }, 500);
    }
  }

  // ── META ADS MANAGE ──────────────────────────────────────────────────
  // One-stop route for managing Meta Ads campaigns from agents/Boss.
  // Actions (via ?action=): check-token, list-campaigns, toggle-campaign, orchestrate-us-pivot
  // Auth: admin JWT OR x-agent-secret
  if (type === 'meta-ads-manage') {
    const admin = await verifyAdmin(req);
    if (!admin && !isAgentSecret(req)) return json({ error: 'Unauthorized' }, 401);

    const action = url.searchParams.get('action') || '';
    const metaToken = Deno.env.get('META_ACCESS_TOKEN') || '';
    const adAccountId = Deno.env.get('META_AD_ACCOUNT_ID') || 'act_26201135546175057';
    const pixelId = Deno.env.get('META_PIXEL_ID') || '1000453189108953';
    const pageId = Deno.env.get('FACEBOOK_PAGE_ID') || '';
    const igAccountId = Deno.env.get('INSTAGRAM_ACCOUNT_ID') || '';
    const graphBase = 'https://graph.facebook.com/v21.0';

    if (!metaToken) return json({ error: 'META_ACCESS_TOKEN not configured in Supabase secrets' }, 500);

    // Helper: call Meta Graph API
    async function metaCall(path: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', fields?: Record<string, unknown>): Promise<Record<string, unknown>> {
      const u = new URL(`${graphBase}${path.startsWith('/') ? path : '/' + path}`);
      if (method === 'GET' && fields) {
        for (const [k, v] of Object.entries(fields)) u.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
      }
      u.searchParams.set('access_token', metaToken);
      const init: RequestInit = { method };
      if (method === 'POST') {
        const form = new URLSearchParams();
        if (fields) for (const [k, v] of Object.entries(fields)) form.set(k, typeof v === 'string' ? v : JSON.stringify(v));
        init.body = form;
        init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      }
      const res = await fetch(u.toString(), init);
      return await res.json();
    }

    // ── ACTION: check-token ─────────────────────────────────────────────
    if (action === 'check-token') {
      const dbg = await metaCall('/debug_token', 'GET', { input_token: metaToken });
      const me = await metaCall('/me', 'GET', { fields: 'id,name' });
      const acct = await metaCall(`/${adAccountId}`, 'GET', { fields: 'id,name,account_status,currency,business,capabilities' });
      const hasAdsManagement = Array.isArray((dbg as { data?: { scopes?: string[] } }).data?.scopes)
        && (dbg as { data?: { scopes?: string[] } }).data!.scopes!.includes('ads_management');
      return json({ has_ads_management: hasAdsManagement, debug_token: dbg, me, ad_account: acct, pixel_id: pixelId, page_id: pageId, ig_account_id: igAccountId });
    }

    // ── ACTION: list-campaigns ──────────────────────────────────────────
    if (action === 'list-campaigns') {
      const campaigns = await metaCall(`/${adAccountId}/campaigns`, 'GET', {
        fields: 'id,name,status,effective_status,objective,created_time,daily_budget,lifetime_budget',
        limit: 100,
      });
      return json({ campaigns });
    }

    // ── ACTION: toggle-campaign ─────────────────────────────────────────
    // body: { campaign_id, status: 'ACTIVE' | 'PAUSED' }
    if (action === 'toggle-campaign') {
      const campaignId = (body.campaign_id as string) || '';
      const newStatus = ((body.status as string) || 'PAUSED').toUpperCase();
      if (!campaignId) return json({ error: 'Missing campaign_id in body' }, 400);
      const result = await metaCall(`/${campaignId}`, 'POST', { status: newStatus });
      return json({ campaign_id: campaignId, new_status: newStatus, result });
    }

    // ── ACTION: orchestrate-us-pivot ────────────────────────────────────
    // One-shot: pause old HE campaign + create new US Conversions campaign + 2 ad sets + 2 ads
    // body: { pause_campaign_id?, daily_budget_ils?, image_url?, landing_url? }
    if (action === 'orchestrate-us-pivot') {
      const results: Record<string, unknown> = { steps: [] };
      const steps = results.steps as Record<string, unknown>[];
      const dailyBudgetILS = Number(body.daily_budget_ils) || 25; // ₪25/day per ad set = ₪50 total ≈ $14
      const dailyBudgetMinor = Math.round(dailyBudgetILS * 100); // minor units (אגורות)
      const pauseCampaignId = (body.pause_campaign_id as string) || '';
      const landingUrl = (body.landing_url as string) || 'https://www.dubis.net/?utm_source=facebook&utm_medium=paid&utm_campaign=us_w3';

      // Step 1: Pause old campaign if requested
      if (pauseCampaignId) {
        try {
          const r = await metaCall(`/${pauseCampaignId}`, 'POST', { status: 'PAUSED' });
          steps.push({ step: 'pause_old', campaign_id: pauseCampaignId, result: r });
        } catch (e) { steps.push({ step: 'pause_old', error: (e as Error).message }); }
      }

      // Step 2: Create campaign
      let campaignId = '';
      try {
        const createCamp = await metaCall(`/${adAccountId}/campaigns`, 'POST', {
          name: `DUBIS US Conversions — W3 — ${new Date().toISOString().slice(0, 10)}`,
          objective: 'OUTCOME_SALES',
          status: 'PAUSED', // start paused for review
          special_ad_categories: [],
          buying_type: 'AUCTION',
        });
        campaignId = (createCamp as { id?: string }).id || '';
        steps.push({ step: 'create_campaign', campaign_id: campaignId, result: createCamp });
        if (!campaignId) { results.success = false; return json(results, 500); }
      } catch (e) { steps.push({ step: 'create_campaign', error: (e as Error).message }); return json({ ...results, success: false }, 500); }

      // Step 3: Get a real product image from dubis_images for the creative
      let imageUrl = (body.image_url as string) || '';
      if (!imageUrl) {
        try {
          const { data: imgs } = await sb.from('dubis_images').select('image_url').eq('approved', true).limit(1);
          if (imgs && imgs[0]) imageUrl = imgs[0].image_url as string;
        } catch (_e) { /* ignore */ }
      }

      // Step 4: Create 2 Ad Sets (Women + Men)
      const genders: { label: string; genders: number[] }[] = [
        { label: 'Women', genders: [2] },
        { label: 'Men',   genders: [1] },
      ];
      const adSetIds: Record<string, string> = {};
      for (const g of genders) {
        try {
          const startTime = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // start in 1 hour
          const createAS = await metaCall(`/${adAccountId}/adsets`, 'POST', {
            name: `US ${g.label} 35-55 — Body Positive`,
            campaign_id: campaignId,
            daily_budget: dailyBudgetMinor,
            billing_event: 'IMPRESSIONS',
            optimization_goal: 'OFFSITE_CONVERSIONS',
            bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
            status: 'PAUSED',
            start_time: startTime,
            destination_type: 'WEBSITE',
            targeting: {
              geo_locations: { countries: ['US'] },
              age_min: 35,
              age_max: 55,
              genders: g.genders,
              locales: [6], // English (US)
              publisher_platforms: ['facebook', 'instagram'],
              facebook_positions: ['feed', 'story', 'video_feeds'],
              instagram_positions: ['stream', 'story', 'explore', 'reels'],
            },
            promoted_object: { pixel_id: pixelId, custom_event_type: 'PURCHASE' },
            attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }],
          });
          const adsetId = (createAS as { id?: string }).id || '';
          adSetIds[g.label] = adsetId;
          steps.push({ step: 'create_adset', gender: g.label, adset_id: adsetId, result: createAS });
        } catch (e) { steps.push({ step: 'create_adset', gender: g.label, error: (e as Error).message }); }
      }

      // Step 5: Create Ad Creatives + Ads (if we have a pageId + image)
      if (pageId && imageUrl) {
        const creativeBodyWomen = `Built for the body you actually live in.\n\nPlus-size comfort wear that doesn't apologize. Bold prints. Soft fabrics. Real sizes up to 5XL.\n\nFree shipping on orders over $50. Made-to-order in the USA.`;
        const creativeBodyMen = `Built for the body you actually live in.\n\nComfort-first clothing that doesn't judge. Bold statements. Soft cotton blends. Sizes up to 5XL.\n\nMade-to-order in the USA. Ships fast, fits right.`;

        for (const g of genders) {
          const adsetId = adSetIds[g.label];
          if (!adsetId) continue;
          const msg = g.label === 'Women' ? creativeBodyWomen : creativeBodyMen;
          try {
            // Create creative
            const creative = await metaCall(`/${adAccountId}/adcreatives`, 'POST', {
              name: `DUBIS US ${g.label} — Body Positive creative`,
              object_story_spec: {
                page_id: pageId,
                ...(igAccountId ? { instagram_actor_id: igAccountId } : {}),
                link_data: {
                  link: `${landingUrl}&utm_content=${g.label.toLowerCase()}`,
                  message: msg,
                  name: g.label === 'Women' ? 'Real Comfort for Real Bodies' : 'The Fit That Gets You',
                  description: 'Plus-size fashion with a sense of humor. Ships from US.',
                  picture: imageUrl,
                  call_to_action: { type: 'SHOP_NOW', value: { link: `${landingUrl}&utm_content=${g.label.toLowerCase()}` } },
                },
              },
              degrees_of_freedom_spec: { creative_features_spec: { standard_enhancements: { enroll_status: 'OPT_OUT' } } },
            });
            const creativeId = (creative as { id?: string }).id || '';
            steps.push({ step: 'create_creative', gender: g.label, creative_id: creativeId, result: creative });

            // Create ad
            if (creativeId) {
              const ad = await metaCall(`/${adAccountId}/ads`, 'POST', {
                name: `DUBIS US ${g.label} — Body Positive ad`,
                adset_id: adsetId,
                creative: { creative_id: creativeId },
                status: 'PAUSED',
              });
              steps.push({ step: 'create_ad', gender: g.label, ad_id: (ad as { id?: string }).id || '', result: ad });
            }
          } catch (e) { steps.push({ step: 'create_creative_or_ad', gender: g.label, error: (e as Error).message }); }
        }
      } else {
        steps.push({ step: 'create_creative_or_ad', skipped: true, reason: `missing pageId (${!!pageId}) or imageUrl (${!!imageUrl})` });
      }

      results.success = true;
      results.campaign_id = campaignId;
      results.adset_ids = adSetIds;
      results.currency = 'ILS';
      results.daily_budget_per_adset_ils = dailyBudgetILS;
      results.total_daily_budget_ils = dailyBudgetILS * genders.length;
      results.note = 'All created in PAUSED state. Review in Ads Manager and manually activate, or call /meta-ads-manage?action=toggle-campaign to activate.';
      return json(results);
    }

    return json({ error: 'Invalid action. Valid: check-token, list-campaigns, toggle-campaign, orchestrate-us-pivot' }, 400);
  }

  // Instagram's crawler is blocked by Supabase storage's X-Robots-Tag: none
  // This route fetches from storage and returns with Facebook-friendly headers
  if (type === 'serve-image') {
    const filename = url.searchParams.get('f') || '';
    if (!filename) return json({ error: 'Missing ?f= parameter' }, 400);
    const storageUrl = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/ig-images/${filename}`;
    try {
      const imgRes = await fetch(storageUrl);
      if (!imgRes.ok) return new Response('Image not found', { status: 404 });
      const imgData = await imgRes.arrayBuffer();
      const ct = imgRes.headers.get('content-type') || 'image/jpeg';
      return new Response(imgData, {
        status: 200,
        headers: {
          'Content-Type': ct,
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch { return new Response('Error fetching image', { status: 500 }); }
  }

  return json({
    error: 'Invalid type. Valid types: tasks, runs, run, generate-image, generate-product-image, product-images, products-catalog, smart-match, publish, gemini-models, content-run, fb-debug, publish-ready, avatars, voices, heygen-status, upload-reel-photo, upload-talking-photo, generate-reel, reel-status, reel-webhook, auto-content, qa-content, generate-slogan, approve-product, security-scan, generate-video-script, generate-video-assets, render-video, kling-callback, compose-callback, video-pipeline, serve-image, meta-ads-manage',
  }, 400);
});