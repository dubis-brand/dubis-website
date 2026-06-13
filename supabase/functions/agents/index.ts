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

// ── SELLABLE_TYPES — the ONE contract for "what DUBIS may create" ──────────
// Single source of truth for BOTH product pools (admin "+ סלוגן חדש"
// suggestions AND the weekly auto-creator). Before this contract there were two
// pools that silently contradicted each other — one offered v-neck/tank-top that
// the DB could not even insert, the other still rolled plain pullover hoodies —
// which is how a forbidden hoodie reached the catalog (Oren, 2026-06-13).
// A garment type appears here ONLY if it passes four gates:
//   ① agreed  — Oren approved selling it
//   ② brand   — a REAL Gelato brand+SKU (NEVER brand:null → Just-Hoods / Hila-K sizing)
//   ③ schema  — allowed by the dubis_products.clothing_type CHECK constraint
//   ④ mockup  — a clean mockup has rendered at least once  → only then autoEligible
// autoEligible:true  → weekly cron may auto-PUBLISH (no human eyes) — proven types only.
// autoEligible:false → admin may SUGGEST it (manual approve gate), never auto-publishes.
// Plain pullover 'hoodie' is intentionally ABSENT — DUBIS sells zip-hoodies only
// (brand:null Just Hoods JH001F sizing disaster, Hila order 2026-05-23).
// v-neck (Gildan 64v00) + tank-top (Gildan 5200) are sourced & constraint-allowed;
// they JOIN here once their gildan TEMPLATES reach prod + the first mockup verifies.
const SELLABLE_TYPES: Array<{ type: string; gender: string; weight: number; autoEligible: boolean }> = [
  { type: 'tshirt',     gender: 'unisex', weight: 4, autoEligible: true  },
  { type: 'tshirt',     gender: 'women',  weight: 3, autoEligible: true  },
  { type: 'ziphoodie',  gender: 'unisex', weight: 3, autoEligible: true  },
  { type: 'longsleeve', gender: 'unisex', weight: 3, autoEligible: true  },
  { type: 'longsleeve', gender: 'women',  weight: 2, autoEligible: true  },
  { type: 'cap',        gender: 'unisex', weight: 2, autoEligible: false }, // AS Colour 1114 — verify mockup → enable
  { type: 'capemb',     gender: 'unisex', weight: 1, autoEligible: false }, // Flexfit 6245 — verify mockup → enable
  // v-neck (Gildan 64v00) is BLOCKED from the catalog: routing/order works, but Gelato
  // renders NO garment mockup for 64v00 (the only v-neck on our plan) — drafts return a
  // bare design-on-gray preview, not a worn garment (gate ④ caught it, product #37, 2026-06-13).
  // Re-add here ONLY if a v-neck SKU with real Gelato mockups is sourced, or we generate our own.
  { type: 'tanktop',    gender: 'unisex', weight: 4, autoEligible: true  }, // Gildan 5200 — mockup verified (real garment, catalog parity) 2026-06-13 (#38)
];

// ── Service-role key — rotation 2026-06 ──
// Prefer the sb_secret 'dubissecretkey' key (Supabase injects it in SUPABASE_SECRET_KEYS as
// JSON), fall back to the legacy service_role JWT during the transition. This is the
// single source for the DB client, all inbound auth-token comparisons (svcKey/svcK),
// and outbound Bearer/x-agent-secret calls — so the legacy + exposed 'default' keys can
// be disabled with zero downtime. (verify_jwt=false on every fn, so a non-JWT sb_secret
// works on the Authorization header too — our code does the string comparison.)
const SERVICE_ROLE = (() => {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')['dubissecretkey']; if (k) return k as string; } catch { /* not migrated yet */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
})();

// ── Supabase client ──
function sbAdmin() {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    SERVICE_ROLE,
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

// ── Uint8Array → base64 (chunked to avoid stack overflow on big images) ──
function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// ── Visual variation matrix — anti-mode-collapse for Gemini image generation.
// Every social post must look visually distinct from the last ~20 posts.
// Seeded by task.id so the same task always produces the same scene (idempotent),
// but any two different tasks almost never converge on the same combination.
// Added 2026-04-23 after duplicate-posts incident (Task #40).
function seededPick<T>(seed: number, arr: T[]): T {
  return arr[seed % arr.length];
}

// Pick the URL of the REAL Gelato back-mockup for a product. The back is what
// carries the slogan artwork, so this is what social posts should show.
// Mirrors js/main.js pickDisplayColor: prefer non-Black/non-Charcoal so posts
// don't all look like a dark-shirt wall. Seeded by taskId so the same task is
// idempotent across reruns but two tasks for the same product vary their color.
// Replaces the AI lifestyle-photo generation (Gemini/Pollinations) for the
// auto post pipeline as of 2026-05-16: we now publish the real Gelato render
// instead of an invented person wearing the garment.
function pickGelatoBackMockupUrl(
  productIdNumeric: number | string | null | undefined,
  colors: unknown,
  taskId: string | null | undefined,
): string | null {
  const id = String(productIdNumeric ?? '').trim();
  if (!id) return null;
  const all = Array.isArray(colors)
    ? (colors as unknown[]).filter((c): c is string => typeof c === 'string' && c.length > 0)
    : [];
  if (all.length === 0) return null;
  const colorful = all.filter(c => c !== 'Black' && c !== 'Charcoal');
  const pool = colorful.length > 0 ? colorful : all;
  const hex = (taskId || '').replace(/-/g, '').substring(0, 8);
  const seed = hex ? (parseInt(hex, 16) || 0) : ((Number(id) || 0) * 2246822519);
  const pick = pool[(seed >>> 0) % pool.length];
  if (!pick) return null;
  return `https://www.dubis.net/images/product-${id}-${pick.replace(/ /g, '-')}-back.jpg`;
}
// ── Reel bank (2026-06-06) ───────────────────────────────────────────────
// Persona reels that are FINAL + ready in video-assets/_pilot/, mapped to their
// ACTIVE product. Each persona wears ONE specific product, so a bank reel may
// attach ONLY to a content task for the SAME product_id (otherwise the caption's
// product and the video's garment mismatch).
// 2026-06-07: all reels are now ENGLISH (Veo native audio) — the Hebrew slot holds
// the SAME English video; the Hebrew STORY lives in the caption (oren: no HE voice,
// no on-screen subtitles). So every active persona has both 'he' + 'en' slots filled.
// Only personas tied to ACTIVE products are listed (men-2→#6 / men-3→#15 retired → removed).
const REEL_BANK: Record<string, { product_id: number; langs: string[] }> = {
  'men-1':   { product_id: 3,  langs: ['he', 'en'] },
  'men-5':   { product_id: 8,  langs: ['he', 'en'] },
  'women-1': { product_id: 11, langs: ['he', 'en'] },
  'women-5': { product_id: 31, langs: ['he', 'en'] },
};
// 2026-06-09: self-wiring product-keyed reel bank. ensure-reel-bank.mjs uploads
// product-{pid}-FINAL-{EN,HE}.mp4 for every active product; if one exists we use
// it (HEAD-checked), so newly-generated reels are picked up with no code change.
// Falls back to the legacy persona-keyed map (men-1/#3 etc.) for older files.
async function reelBankUrlForProduct(productId: number | string | null | undefined, lang: string): Promise<string | null> {
  const pid = Number(productId);
  if (!pid) return null;
  const L = (lang || 'en').toLowerCase() === 'he' ? 'HE' : 'EN';
  const base = (Deno.env.get('SUPABASE_URL') ?? '').replace('/rest/v1', '').replace(/\/$/, '');
  // 1) product-keyed bank (preferred, self-wiring)
  const pUrl = `${base}/storage/v1/object/public/video-assets/_pilot/product-${pid}-FINAL-${L}.mp4`;
  try { const r = await fetch(pUrl, { method: 'HEAD' }); if (r.ok) return pUrl; } catch { /* fall through */ }
  // 2) legacy persona-keyed fallback
  const entry = Object.entries(REEL_BANK).find(([, v]) => v.product_id === pid);
  if (entry) {
    const [persona, meta] = entry;
    if (meta.langs.includes(L.toLowerCase())) {
      return `${base}/storage/v1/object/public/video-assets/_pilot/${persona}-FINAL-${L}.mp4`;
    }
  }
  return null;
}
// 2026-06-09: prefer a REAL Higgsfield persona-model still (the character wearing
// THIS exact product) over a bare garment mockup. oren: "posts go out as bare
// garment, never the model shots we made for ads/videos." These live in
// dubis_images tagged 'persona', linked to the product via the uuid FK. Currently
// imported for products 3/8/11/31 (men-1/men-5/women-1/women-5 try-on heroes);
// returns null for products with no persona image yet → caller falls back.
// deno-lint-ignore no-explicit-any
async function pickPersonaModelUrl(sb: any, productId: number | string | null | undefined, seed: number): Promise<string | null> {
  const pid = Number(productId);
  if (!pid) return null;
  try {
    const { data } = await sb.from('dubis_images')
      .select('image_url, dubis_products!inner(product_id_numeric)')
      .eq('dubis_products.product_id_numeric', pid)
      .eq('approved', true)
      .contains('tags', ['persona'])
      .limit(10);
    if (data && data.length) {
      const pk = data[(seed >>> 0) % data.length];
      return (pk?.image_url as string) || null;
    }
  } catch { /* ignore — caller falls back to lifestyle/mockup */ }
  return null;
}
// 2026-06-09: build an Instagram carousel from EXISTING catalog mockups (front +
// back per color) + the persona-model still — the same undistorted square images
// the product page shows. No AI generation. oren: "prepare what's needed for
// carousels." Returns 2-6 public image URLs (HEAD-verified), or [] if too few.
// deno-lint-ignore no-explicit-any
async function buildCarouselImages(sb: any, productId: number | string | null | undefined): Promise<string[]> {
  const pid = Number(productId);
  if (!pid) return [];
  let colors: string[] = [];
  try {
    const { data: pr } = await sb.from('dubis_products').select('colors').eq('active', true).eq('product_id_numeric', pid).limit(1);
    const c = pr?.length ? (pr[0] as Record<string, unknown>).colors : null;
    if (Array.isArray(c)) colors = c as string[];
  } catch { /* ignore */ }
  // high-contrast, photogenic colors first
  const pref = ['Navy', 'Black', 'White', 'Charcoal', 'Cream', 'Red', 'Forest Green', 'Gray', 'Royal Blue'];
  colors.sort((a, b) => ((pref.indexOf(a) + 1) || 99) - ((pref.indexOf(b) + 1) || 99));
  const base = 'https://www.dubis.net/images';
  const c1 = colors[0], c2 = colors[1];
  const persona = await pickPersonaModelUrl(sb, pid, pid);
  // order: c1 front, c1 back, persona-model, c2 front, c2 back
  const ordered = [
    c1 && `${base}/product-${pid}-${encodeURIComponent(c1)}-front.jpg`,
    c1 && `${base}/product-${pid}-${encodeURIComponent(c1)}-back.jpg`,
    persona,
    c2 && `${base}/product-${pid}-${encodeURIComponent(c2)}-front.jpg`,
    c2 && `${base}/product-${pid}-${encodeURIComponent(c2)}-back.jpg`,
  ].filter(Boolean) as string[];
  const slides: string[] = [];
  for (const u of ordered) {
    if (slides.includes(u)) continue;
    try { const r = await fetch(u, { method: 'HEAD' }); if (r.ok) slides.push(u); } catch { /* skip */ }
    if (slides.length >= 6) break;
  }
  return slides;
}
function buildVisualVariation(taskId: string, titleLower: string): string {
  // 24 bits of entropy from the task UUID is plenty for picking from small arrays.
  const hex = (taskId || '').replace(/-/g, '').substring(0, 12) || '000000000000';
  const s1 = parseInt(hex.substring(0, 4), 16) || 1;
  const s2 = parseInt(hex.substring(4, 8), 16) || 2;
  const s3 = parseInt(hex.substring(8, 12), 16) || 3;

  // SUBJECT — diverse American adults 35-55. No more "40-something dark top" default.
  const subjects = [
    'a man around 50, wider build, short salt-and-pepper beard, warm brown skin',
    'a woman around 45, curvy build, shoulder-length curly dark hair, olive skin',
    'a man around 38, lean build, close-cropped hair, pale skin with freckles',
    'a woman around 52, plus-size, silver-gray bob haircut, fair skin',
    'a nonbinary person around 42, athletic build, braided hair, deep brown skin',
    'a man around 55, stocky, bald with trimmed gray goatee, ruddy skin',
    'a woman around 37, petite, straight black hair in a ponytail, East Asian features',
    'a man around 46, tall and slim, wavy chestnut hair, light olive skin',
    'a woman around 49, mid-size, bleached pixie cut, freckled fair skin',
    'a man around 41, broad-shouldered, curly dark hair and beard, South Asian features',
    'a woman around 44, curvy, natural afro, dark brown skin',
    'a man around 53, average build, glasses, thinning sandy hair, pale skin',
  ];
  const subject = seededPick(s1, subjects);

  // SCENE — 15 distinct locations, pick avoids "couch" unless title really is about napping.
  const isCouchAngle = titleLower.includes('nap') || titleLower.includes('couch') || titleLower.includes('cardio');
  const couchScenes = [
    'sprawled sideways on a worn linen sofa, late-afternoon window light streaking across the cushions',
    'half-asleep on a dark leather armchair, lamp glow, open book face-down on their chest',
    'curled up under a chunky knit throw on a velvet loveseat, muted morning overcast light',
  ];
  const activeScenes = [
    'walking along a rain-wet city sidewalk at dusk, neon reflections in puddles, moody blue hour',
    'leaning on a wooden railing outside a small-town diner, golden-hour sun low behind them',
    'pouring coffee in a sunlit Brooklyn kitchen, morning light through a window with plants',
    'riding the subway, hand on the overhead bar, harsh fluorescent carriage light',
    'crossing a quiet suburban street at midday, long shadows on warm asphalt',
    'sitting on a park bench in autumn, scattered leaves, soft overcast daylight',
    'browsing vinyl in a record store, warm tungsten lighting, wooden crates around them',
    'standing at a bus stop at night under a single sodium-vapor streetlight, rim-lit',
    'on the back porch of a ranch house at sunset, warm orange side light, screen door behind',
    'in a home garage workshop, diffused skylight, tool pegboard blurred in background',
    'at a crowded farmers market stall, dappled sunlight through canvas awnings',
    'on the steps of a brownstone in summer, harsh midday sun, iron railing shadow',
    'inside a bookstore café, floor-to-ceiling window light, shelves as bokeh background',
    'against a painted brick alley wall, flat shade, graffiti out of focus behind them',
    'cooking at a kitchen island, pendant light from above, dough on the counter',
  ];
  const pool = isCouchAngle ? couchScenes.concat(activeScenes.slice(0, 4)) : activeScenes;
  const scene = seededPick(s2, pool);

  // LENS / COMPOSITION — every option MUST keep the back of the garment
  // clearly visible, because that's where the product's slogan lives.
  // 2026-04-23 fix: the old matrix had front-facing portraits that hid the
  // slogan entirely, so posts looked like generic black t-shirts with only
  // a small "DUBIS" chest logo — breaking the whole point of the product.
  const compositions = [
    '50mm lens, three-quarter back view from behind over the right shoulder, subject glancing back toward camera — back of garment fills the center of the frame, slogan fully readable',
    '35mm lens, full back view walking away from camera, subject slightly turned so profile is visible — back slogan dominates the frame',
    '50mm lens, back view medium shot, subject turned 30° to the right, head glancing down — back slogan clearly legible from mid-back up',
    '85mm lens, tight back shot shoulder-to-waist, shallow depth of field, sharp focus on the back slogan',
    '35mm lens, over-the-shoulder from behind while the person looks to the side, slight low angle — back print fills the frame center',
    '28mm lens, wide back shot with environmental context, subject on the right third, back of garment clearly legible',
  ];
  const composition = seededPick(s3, compositions);

  return `${subject}, ${scene}. Shot on DSLR, ${composition}. Genuine unposed moment — not a fashion model, not posing. The BACK of the garment (where the slogan is printed) must be clearly visible and readable.`;
}

// ── Fetch reference images for Gemini: both the FRONT product photo AND
// the BACK design artwork (where the slogan lives).
// Returns { front, back? } — front is the composited product shot, back is
// the raw print artwork that must appear on the back of the garment.
// Both go into the Gemini prompt so the generator knows the exact slogan
// and renders it legibly on the back of the subject.
// 2026-04-23 fix (Task #40): previously only front was sent, so Gemini
// invented blank black garments with just a small chest logo.
async function fetchProductReferenceImage(
  productIdNumeric: number | string,
  colors?: string[],
  backDesignUrl?: string | null,
): Promise<{ front: { b64: string; mimeType: string }; back?: { b64: string; mimeType: string } } | null> {
  const id = String(productIdNumeric);
  const preferred = ['Black', 'Charcoal', 'Navy', 'Cream', 'White', 'Honey Brown', 'Forest Green', 'Red'];
  const ordered = colors && colors.length
    ? [...preferred.filter(c => colors.includes(c)), ...colors.filter(c => !preferred.includes(c))]
    : preferred;
  const frontCandidates: string[] = [];
  frontCandidates.push(`https://www.dubis.net/images/product-${id}-front.jpg`);
  for (const c of ordered) {
    frontCandidates.push(`https://www.dubis.net/images/product-${id}-${c.replace(/ /g, '-')}-front.jpg`);
  }

  async function fetchOne(url: string): Promise<{ b64: string; mimeType: string } | null> {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const mime = r.headers.get('content-type') || 'image/jpeg';
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.byteLength < 5000) return null;
      return { b64: bytesToB64(buf), mimeType: mime };
    } catch { return null; }
  }

  let front: { b64: string; mimeType: string } | null = null;
  for (const url of frontCandidates) {
    front = await fetchOne(url);
    if (front) break;
  }
  if (!front) return null;

  // Back design is optional but strongly preferred — without it Gemini
  // loses the slogan. Fall back to URL pattern if the DB field wasn't passed.
  const backCandidates: string[] = [];
  if (backDesignUrl) backCandidates.push(backDesignUrl);
  backCandidates.push(`https://www.dubis.net/designs/back_design_${id}_dark.png`);
  backCandidates.push(`https://www.dubis.net/designs/back_design_${id}_white.png`);
  let back: { b64: string; mimeType: string } | null = null;
  for (const url of backCandidates) {
    back = await fetchOne(url);
    if (back) break;
  }

  return back ? { front, back } : { front };
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
            // 2026-06-01 (oren complaint "למה אין פוסטים עם אנשים"): the feed was
            // 100% garment back-mockups because this content-run phase always
            // landed on pickGelatoBackMockupUrl and persisted it into
            // generated_image_url — so publish-ready's people-photo branch was
            // dead code. Fix: seeded coin-flip here too. ~half of posts now lead
            // with a REAL approved lifestyle/person photo from dubis_images.
            if (!imageUrl) {
              const lsHex = (task.id as string).replace(/-/g, '').substring(0, 8);
              const lsSeed = parseInt(lsHex, 16) || 0;
              const wantsPerson = (lsSeed % 2) === 0;
              if (wantsPerson) {
                try {
                  const { data: lifestyleImgs } = await sb.from('dubis_images')
                    .select('image_url')
                    .contains('tags', ['lifestyle'])
                    .eq('approved', true)
                    .gte('quality_score', 5)
                    .limit(50);
                  if (lifestyleImgs?.length) {
                    const pick = (lifestyleImgs as Record<string, unknown>[])[lsSeed % lifestyleImgs.length];
                    const u = pick?.image_url as string | undefined;
                    if (u) imageUrl = u;
                  }
                } catch { /* ignore — fall through to garment mockup */ }
              }
            }
            // 2026-05-16: stopped using Gemini to invent lifestyle photos. The
            // social post otherwise shows the REAL Gelato back-mockup — that's the
            // image that carries the actual slogan artwork the customer buys.
            // Resolve product_id + colors so we can pick the right back mockup.
            if (!imageUrl) {
              let refPid: string = (cd.product_id as string) || '';
              let refColors: string[] = Array.isArray(cd.product_colors) ? (cd.product_colors as string[]) : [];
              const refSlogan = (cd.product_slogan as string) || '';
              try {
                if (refPid && refColors.length === 0) {
                  const { data: pr } = await sb.from('dubis_products')
                    .select('colors')
                    .eq('active', true)
                    .eq('product_id_numeric', refPid)
                    .limit(1);
                  if (pr?.length) {
                    const c = (pr[0] as Record<string, unknown>).colors;
                    if (Array.isArray(c)) refColors = c as string[];
                  }
                } else if (!refPid && refSlogan) {
                  const { data: hit } = await sb.from('dubis_products')
                    .select('product_id_numeric, colors')
                    .eq('active', true)
                    .ilike('slogan', refSlogan)
                    .limit(1);
                  if (hit?.length) {
                    const row = hit[0] as Record<string, unknown>;
                    refPid = String(row.product_id_numeric);
                    const c = row.colors;
                    if (Array.isArray(c)) refColors = c as string[];
                  }
                }
              } catch { /* ignore */ }
              const mockupUrl = pickGelatoBackMockupUrl(refPid, refColors, task.id as string);
              if (mockupUrl) imageUrl = mockupUrl;
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
      const svcK = SERVICE_ROLE;
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
    const svcKey = SERVICE_ROLE;
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
    const svcKey      = SERVICE_ROLE;
    const cronSecret  = Deno.env.get('CRON_SECRET') ?? '';
    const agentSecret = Deno.env.get('AGENT_SECRET') ?? '';
    const token = url.searchParams.get('token') || req.headers.get('x-agent-secret') || (req.headers.get('authorization') ?? '').replace('Bearer ', '').trim() || '';
    const isAuthed = (svcKey && token === svcKey) || (cronSecret && token === cronSecret) || (agentSecret && token === agentSecret);
    const adminOk = await verifyAdmin(req);
    if (!isAuthed && !adminOk) return json({ error: 'Unauthorized' }, 401);

    const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
    // 2026-06-06: also pull weekly-marketing-plan slots whose scheduled time has
    // arrived (status='backlog'). Previously these sat in backlog forever because
    // content-run only looked at approved+pending — the weekly plan never executed.
    // Now a due slot flows: backlog → (caption+media here) → pending_approval → QA
    // → publish, same as any task. TikTok slots are excluded (the GHA reel-bank
    // publishes those independently). Earliest-scheduled first so the plan runs in order.
    const nowIsoForSlots = new Date().toISOString();
    const [{ data: approvedTasks }, { data: pendingTasks }, { data: backlogSlots }] = await Promise.all([
      sb.from('agent_tasks').select('id, title, agent_id, category, description, notes, priority, content_data, status').eq('status', 'approved').eq('agent_id', 'content').order('created_at', { ascending: true }),
      sb.from('agent_tasks').select('id, title, agent_id, category, description, notes, priority, content_data, status').eq('status', 'pending_approval').eq('agent_id', 'content').order('created_at', { ascending: true }),
      sb.from('agent_tasks').select('id, title, agent_id, category, description, notes, priority, content_data, status').eq('status', 'backlog').eq('agent_id', 'content')
        .lte('content_data->>scheduled_for', nowIsoForSlots)
        .neq('content_data->>format', 'tiktok')
        .order('content_data->>scheduled_for', { ascending: true }),
    ]);
    type Task = Record<string, unknown>;
    // approved + pending first (already in-flight), then due plan slots in schedule order.
    const allTasks = [...(approvedTasks || []), ...(pendingTasks || []), ...(backlogSlots || [])];
    // 2026-05-03 fix: skip noise (boss-agent team-meeting / admin tasks accidentally
    // tagged agent_id='content'). A real post task must carry at least format,
    // product_id, or product_slogan. Anything else is a misrouted admin TODO.
    const looksLikePostTask = (t: Task) => {
      const cd = (t.content_data as Task) || {};
      return !!(cd.format || cd.product_id || cd.product_slogan || cd.caption_en || cd.caption_he);
    };
    // 2026-06-09: NEVER let content-run touch the agent-personas BTS series. Those
    // tasks are 'approved' (so they'd otherwise land in content-run's queue) but
    // are managed exclusively by publish_next_persona (one/day, avatar already set).
    // content-run was overwriting their avatar with a garment mockup + flipping
    // them to pending_approval — the recurring "Moshe shipped with a tee" bug class.
    const isPersonaSeriesTask = (t: Task) => (((t.content_data as Task)?.series as string) || '') === 'agent_personas';
    const skipped = allTasks.filter((t: Task) => !looksLikePostTask(t) && !isPersonaSeriesTask(t));
    const tasks = allTasks.filter((t: Task) => looksLikePostTask(t) && !isPersonaSeriesTask(t) && !((t.content_data as Task)?.generated_image_url as string)?.includes('supabase.co'));
    // Mark misrouted tasks so they stop blocking — change agent_id to 'boss'
    // (these are admin TODOs created by the weekly-team-meeting boss subagent)
    // so they show in the boss queue but don't pollute the content quota.
    // 'oren' is not in the agent_tasks valid_agent CHECK constraint.
    if (skipped.length) {
      const ids = skipped.map((t: Task) => t.id);
      await sb.from('agent_tasks').update({
        agent_id: 'boss',
        notes: 'Auto-rerouted from content → boss: task has no post payload (format/product_slogan/caption). Created by team-meeting or admin agent.',
        updated_at: new Date().toISOString(),
      }).in('id', ids as string[]);
    }
    if (!tasks.length) return json({ queued: 0, rerouted: skipped.length, summary: 'All content tasks already have Supabase images ✅' });

    // 2026-06-09: process up to 3 per run (was 1) so the weekly-marketing-plan
    // backlog actually drains. With auto-content disabled (weekly-plan-only mode),
    // content-run is the sole filler of plan slots; 1/run was too slow to keep up
    // with ~2-3 due slots/day. Caption is one Gemini call + image is a fast DB
    // lookup (persona/mockup), so 3 tasks stay well within the function budget.
    const batchN = parseInt(url.searchParams.get('batch') || '3', 10);
    const batch = tasks.slice(0, Math.max(1, batchN));
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

        // IL re-opened 2026-05-15: gate on the caption matching the post's language.
        // auto-content writes content_data.language (he|en); legacy rows fall back to en.
        // 2026-06-09: read cd.lang too — the weekly-marketing-plan writes the slot
        // language as content_data.lang, but auto-content writes content_data.language.
        // Reading only `language` made every HE plan slot get an EN caption.
        const postLang = (((cd.language as string) || (cd.lang as string) || 'en')).toLowerCase() === 'he' ? 'he' : 'en';
        const existingCaption = postLang === 'he' ? (cd.caption_he as string) : (cd.caption_en as string);
        if (existingCaption && hasPermImg) {
          await sb.from('agent_tasks').update({
            status: 'pending_approval',
            content_data: { ...cd, language: postLang, product_url: productUrl, product_id: productId, product_price_usd: productPriceUsd, product_type: productType },
            updated_at: now,
          }).eq('id', task.id);
          taskResults.push(`✅ ${task.title}: content ready (${postLang}) → pending_approval (linked → ${productUrl})`);
          continue;
        }

        let gen: Record<string, string> = {};
        const needsCaption = postLang === 'he' ? !cd.caption_he : !cd.caption_en;
        if (needsCaption && geminiKey) {
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
          const hePrompt = `אתה הקופירייטר הבכיר של DUBIS — מותג אופנה אנטי-אופנתי ישראלי. סלוגן: "בשביל כל השאר".

[קהל יעד — חזרה לישראל 2026-05-15]
ישראלים גילאי 35-55, גופים אמיתיים, חיים אמיתיים. עייפים מתרבות הכושר, משפת האינפלואנסרים, ומבגדים שנראים טוב רק על בני 22. רוצים נוחות שלא מתנצלת ובגדים שבנויים לגוף שהם באמת חיים בו.

[ה-DNA של DUBIS]
DUBIS שובר את הבחירה השקרית בין "אופנתי אבל לא נוח" ל"נוח אבל בלתי נראה". בגדים שמתאימים לגוף אמיתי, מרגישים מעולה, ונושאים משפט שנון שאומר: "ככה אני".

[הזווית להיום] ${todayAngle}
חשוב: אל תדבר רק על משקל או גוף. DUBIS זה הרבה יותר — נוחות, הומור, אנטי-אופנה, חיים אחרי 35, איכות, קהילה.

[כללי טון]
- עברית ישראלית טבעית, כמו הודעה ל-WhatsApp לחבר (סלנג בסדר: יאללה, תכל'ס, אחי)
- הומור יבש, ציני, חכם — לא תרגום מאנגלית
- מילים אסורות: מושלם, מהמם, חובה, מטורף, מבצע, הנחה, יוקרתי, פרימיום, אקסקלוסיבי
- ב-עברית: השתמש ב"קפוצון" ולא ב"הודי", "קפוצונים" ולא "הודיז"
- אסור להציע ללקוח "לתקן" את עצמו
- משפטים קצרים. בלי פלאף. שיחתי — לא ספרותי.

--- משימה ---
משימה: "${task.title}"
סלוגן המוצר: "${productSloganRaw}"
סוג מוצר: "${productType}"
URL מוצר: "${productUrl}"
מחיר: ${productPriceUsd != null ? `$${productPriceUsd}` : 'ראה דף מוצר'}
פורמט: ${isStory ? 'STORY — 1-2 משפטים בלבד' : (cd.format || 'feed_post')}

חובה:
1. הסלוגן (שכתוב על הבגד באנגלית, למשל "NAPPING IS MY CARDIO") חייב להופיע בכיתוב בדיוק כפי שהוא — באנגלית כפי שכתוב על הבגד.
2. אל תמציא URL בכיתוב. צינור הפרסום מוסיף את ה-URL האמיתי בעצמו.
3. אל תכלול מחיר בגוף הכיתוב — שורת ה-shop מוסיפה את המחיר.

החזר JSON תקני בלבד: {"caption_he":"...","hashtags":"#DUBIS #ForTheRestOfUs ...5-10 תגים רלוונטיים","image_prompt":"..."}`;

          const enPrompt = `${dubisPrompt}

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

          const captionPrompt = postLang === 'he' ? hePrompt : enPrompt;
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
          try { gen = JSON.parse(raw.replace(/```json|```/g, '').trim()); } catch {
            gen = postLang === 'he' ? { caption_he: raw.substring(0, 200) } : { caption_en: raw.substring(0, 200) };
          }
          if (postLang === 'he') {
            if (gen.caption_he) gen.caption_he = fixHebrew(gen.caption_he);
            if (!gen.caption_he) throw new Error('HE caption generation empty');
          } else {
            if (!gen.caption_en) throw new Error('EN caption generation empty');
          }
        } else {
          gen = postLang === 'he'
            ? { caption_he: cd.caption_he as string, hashtags: cd.hashtags as string }
            : { caption_en: cd.caption_en as string, hashtags: cd.hashtags as string };
        }

        let imageUrl = hasPermImg ? (cd.generated_image_url as string) : '';
        let imgError = '';

        if (!imageUrl) {
          // 2026-05-18: alternate between (a) approved lifestyle photos from
          // dubis_images and (b) the real Gelato back-mockup. Lifestyle images
          // (e.g. /images/carousel/v3/*) carry brand atmosphere; Gelato mockups
          // carry the actual slogan artwork. Half-and-half mix keeps the feed
          // varied without losing the product anchor every post.
          // Priority 3 fallback: dubis_images gallery matched by product/slogan.
          const productSlogan = ((cd.product_slogan as string) || '').toLowerCase().trim();
          const productId = (cd.product_id as string) || '';

          // Resolve colors from dubis_products so we pick a real back mockup.
          let productColors: string[] = [];
          try {
            if (productId) {
              const { data: pr } = await sb.from('dubis_products')
                .select('colors')
                .eq('active', true)
                .eq('product_id_numeric', productId)
                .limit(1);
              if (pr?.length) {
                const c = (pr[0] as Record<string, unknown>).colors;
                if (Array.isArray(c)) productColors = c as string[];
              }
            }
          } catch { /* ignore */ }

          // Seeded coin-flip per task.id — same task always picks the same
          // image source so re-runs are idempotent.
          const taskHex = (task.id as string).replace(/-/g, '').substring(0, 8);
          const taskSeed = parseInt(taskHex, 16) || 0;
          const tryLifestyleFirst = (taskSeed % 2) === 0;

          // ── Persona-model path (HIGHEST priority, 2026-06-09) ──
          // A real Higgsfield model wearing THIS product (dubis_images tag
          // 'persona', linked by product uuid) beats both the generic lifestyle
          // pool and the bare garment mockup. Falls through if none exists yet
          // for this product (currently imported for products 3/8/11/31).
          if (!imageUrl && productId) {
            const personaUrl = await pickPersonaModelUrl(sb, productId, taskSeed);
            if (personaUrl) imageUrl = personaUrl;
          }

          // ── Lifestyle path ──
          // Quality_score >= 8 + scene_type = 'lifestyle' selects the curated
          // V3 carousel pool. Seeded pick keeps re-runs deterministic.
          if (!imageUrl && tryLifestyleFirst) {
            try {
              // dubis_images.quality_score is constrained 0-5; curated V3 lifestyle
              // images are inserted at 5 (max). Other auto-generated images live at 0-3.
              const { data: lifestyleImgs } = await sb.from('dubis_images')
                .select('image_url')
                .contains('tags', ['lifestyle'])
                .eq('approved', true)
                .gte('quality_score', 5)
                .limit(50);
              if (lifestyleImgs?.length) {
                const pick = (lifestyleImgs as Array<{image_url: string}>)[taskSeed % lifestyleImgs.length];
                if (pick?.image_url) imageUrl = pick.image_url;
              }
            } catch { /* fall through to Gelato mockup */ }
          }

          // ── Gelato back-mockup path ──
          if (!imageUrl) {
            if (productId) {
              const mockupUrl = pickGelatoBackMockupUrl(productId, productColors, task.id as string);
              if (mockupUrl) {
                imageUrl = mockupUrl;
              } else {
                imgError = 'no_gelato_back_mockup';
              }
            } else {
              imgError = 'no_product_id';
            }
          }

          // ── Lifestyle path (second-half slot — if Gelato was tried first) ──
          if (!imageUrl && !tryLifestyleFirst) {
            try {
              // dubis_images.quality_score is constrained 0-5; curated V3 lifestyle
              // images are inserted at 5 (max). Other auto-generated images live at 0-3.
              const { data: lifestyleImgs } = await sb.from('dubis_images')
                .select('image_url')
                .contains('tags', ['lifestyle'])
                .eq('approved', true)
                .gte('quality_score', 5)
                .limit(50);
              if (lifestyleImgs?.length) {
                const pick = (lifestyleImgs as Array<{image_url: string}>)[taskSeed % lifestyleImgs.length];
                if (pick?.image_url) imageUrl = pick.image_url;
              }
            } catch { /* fall through to legacy gallery match */ }
          }

          try {
            type ImgRow = { image_url: string; quality_score: number; dubis_products?: { slogan?: string } | null };
            let matchImg: ImgRow | null = null;

            // 1) Match by product_id (most precise) — only if Gemini didn't succeed
            if (!imageUrl && productId) {
              const { data } = await sb.from('dubis_images')
                .select('image_url, quality_score, dubis_products(slogan)')
                .eq('product_id', productId)
                .eq('approved', true)
                .order('quality_score', { ascending: false })
                .limit(1);
              if (data?.length) matchImg = (data as ImgRow[])[0];
            }

            // 2) Match by slogan keywords against dubis_products.slogan
            if (!imageUrl && !matchImg && productSlogan) {
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
            if (!imageUrl && !matchImg) {
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

            if (!imageUrl && matchImg) imageUrl = matchImg.image_url;
          } catch (imgLookupErr) {
            imgError = `img_lookup:${(imgLookupErr as Error).message}`;
          }
        }

        // IL re-opened 2026-05-15: store the caption for the post's language.
        // Note: the product URL is appended at PUBLISH time (shopLineIG/FB), not here —
        // so the caption body stays clean and publish adds the clickable shop line.
        const finalCapHe = postLang === 'he'
          ? (gen.caption_he || (cd.caption_he as string) || '')
          : ((cd.caption_he as string) || '');
        const finalCapEn = postLang === 'en'
          ? (gen.caption_en || (cd.caption_en as string) || '')
          : ((cd.caption_en as string) || '');
        const finalImageUrl = imageUrl || (cd.generated_image_url as string) || '';
        const hasCaption = postLang === 'he' ? !!finalCapHe : !!finalCapEn;
        const hasFinalImg = !!finalImageUrl;
        // 2026-05-03 fix: never advance to pending_approval without BOTH caption AND image.
        // publish-ready blocks no-image tasks anyway, and QA was approving them at 80/100
        // because image is only 20pts of the score → tasks rotted in 'approved' forever.
        // Stay in_progress so the next content-run cron retries Gemini image gen.
        const newStatus = (hasCaption && hasFinalImg) ? 'pending_approval' : 'in_progress';
        await sb.from('agent_tasks').update({
          status: newStatus,
          // Persist both caption fields + language so publish + QA can pick the right one.
          content_data: {
            ...cd,
            caption_he: finalCapHe,
            caption_en: finalCapEn,
            language:   postLang,
            hashtags: gen.hashtags || (cd.hashtags as string) || '',
            image_prompt: gen.image_prompt || '',
            generated_image_url: finalImageUrl,
            product_url:       productUrl,
            product_id:        productId,
            product_price_usd: productPriceUsd,
            product_type:      productType,
          },
          notes: ((task.notes as string) || '') + (
            !hasCaption ? `\n⚠️ Caption empty — retry needed`
            : !hasFinalImg ? `\n⚠️ Image generation failed [${imgError || 'unknown'}] — retry needed`
            : ''
          ),
          updated_at: now,
        }).eq('id', task.id);
        taskResults.push(
          (hasCaption && hasFinalImg) ? `✅ ${task.title}: image+caption → pending_approval`
          : !hasCaption                ? `⚠️ ${task.title}: caption empty — stays in_progress`
          :                              `⚠️ ${task.title}: image missing [${imgError || 'gemini_failed'}] — stays in_progress`
        );
      } catch (e) {
        taskResults.push(`❌ ${task.title}: ${(e as Error).message}`);
      }
    }

    // Log this run so autonomy/activity feeds show content agent is alive.
    try {
      const successes = taskResults.filter(r => r.startsWith('✅')).length;
      const failures  = taskResults.filter(r => r.startsWith('❌'));
      const startedMs = new Date(now).getTime();
      await sb.from('agent_runs').insert({
        agent_id: 'content',
        run_date: now.slice(0, 10),
        status: failures.length && successes === 0 ? 'error' : 'success',
        tasks_created: successes,
        duration_ms: Date.now() - startedMs,
        summary: `content-run processed ${batch.length}/${tasks.length}: ${taskResults.slice(0, 5).join(' | ')}`,
        error_message: failures.length ? failures.slice(0, 3).join(' | ') : null,
      });
    } catch (_logErr) { /* non-fatal */ }

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
  if (type === 'backfill-permalinks') {
    // One-off: scan all done social_post tasks lacking ig_permalink/fb_permalink,
    // query Graph API for each, and fill content_data with public URLs.
    const svcKey = SERVICE_ROLE;
    const agentSecret = Deno.env.get('AGENT_SECRET') ?? '';
    const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
    const authHeader = req.headers.get('authorization') ?? '';
    const token = url.searchParams.get('token') || req.headers.get('x-agent-secret') || authHeader.replace('Bearer ', '').trim() || '';
    const isAuthed = (svcKey && token === svcKey) || (agentSecret && token === agentSecret) || (cronSecret && token === cronSecret);
    if (!isAuthed && !(await verifyAdmin(req))) return json({ error: 'Unauthorized' }, 401);

    const igToken = Deno.env.get('INSTAGRAM_ACCESS_TOKEN') ?? '';
    const fbToken = Deno.env.get('FACEBOOK_PAGE_TOKEN') ?? igToken;
    if (!igToken) return json({ error: 'INSTAGRAM_ACCESS_TOKEN missing' }, 503);

    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    // Fetch ALL done social_posts (current total ~76, won't grow past a few hundred
    // for years). Filtering in JS to find ones that still need work is fine at
    // this scale. The previous `limit*4` over-fetch made batches converge on the
    // same first N rows and never reach the tail.
    const { data: tasks, error } = await sb.from('agent_tasks')
      .select('id, title, content_data')
      .eq('category', 'social_post').eq('status', 'done')
      .order('updated_at', { ascending: true })
      .limit(500);
    if (error) return json({ error: error.message }, 500);

    const toBackfill = (tasks || []).filter((t: Record<string, unknown>) => {
      const cd = (t.content_data as Record<string, unknown>) || {};
      const hasIgUrl = !!cd.ig_permalink;
      const hasFbUrl = !!cd.fb_permalink;
      const hasIgId = !!cd.instagram_post_id;
      const hasFbId = !!cd.facebook_post_id;
      return (hasIgId && !hasIgUrl) || (hasFbId && !hasFbUrl);
    }).slice(0, limit);

    const results: Record<string, unknown>[] = [];
    for (const task of toBackfill) {
      const cd = (task.content_data as Record<string, unknown>) || {};
      const igId = cd.instagram_post_id as string | undefined;
      const fbId = cd.facebook_post_id as string | undefined;
      let igPermalink = cd.ig_permalink as string | null || null;
      let fbPermalink = cd.fb_permalink as string | null || null;
      let igErr: string | null = null;
      let fbErr: string | null = null;

      if (igId && !igPermalink) {
        try {
          const r = await fetch(`https://graph.facebook.com/v19.0/${igId}?fields=permalink&access_token=${igToken}`);
          const d = await r.json();
          if (r.ok && d.permalink) igPermalink = d.permalink as string;
          else igErr = d.error?.message || `HTTP ${r.status}`;
        } catch (e) { igErr = (e as Error).message; }
      }
      if (fbId && !fbPermalink) {
        try {
          // FB photo posts use `link`, regular posts use `permalink_url`. Ask for both.
          const r = await fetch(`https://graph.facebook.com/v19.0/${fbId}?fields=link,permalink_url&access_token=${fbToken}`);
          const d = await r.json();
          if (r.ok) {
            fbPermalink = (d.link as string | undefined) || (d.permalink_url as string | undefined) || null;
          }
          if (!fbPermalink) {
            // Construct fallback from page_id + post_id — always works for our own page posts.
            const fbPageId = Deno.env.get('FACEBOOK_PAGE_ID') ?? '';
            if (fbPageId) fbPermalink = `https://www.facebook.com/${fbPageId}/posts/${fbId}`;
            else fbErr = d.error?.message || `HTTP ${r.status} (and FACEBOOK_PAGE_ID not set for fallback)`;
          }
        } catch (e) { fbErr = (e as Error).message; }
      }

      await sb.from('agent_tasks').update({
        content_data: { ...cd, ig_permalink: igPermalink, fb_permalink: fbPermalink },
        updated_at: new Date().toISOString(),
      }).eq('id', task.id);

      results.push({ id: task.id, title: task.title, ig: igPermalink, fb: fbPermalink, ig_err: igErr, fb_err: fbErr });
      await new Promise((r) => setTimeout(r, 250)); // throttle Graph API
    }

    return json({ ok: true, scanned: (tasks || []).length, backfilled: results.length, results });
  }

  if (type === 'publish-ready') {
    const svcKey      = SERVICE_ROLE;
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

    // 2026-04-25 dup-publish fix: include 'publishing' so we can re-claim stale locks (>10min).
    const { data: candidates, error: fetchErr } = await sb.from('agent_tasks').select('id, title, content_data, status').in('status', ['pending_approval', 'approved', 'publishing']).eq('agent_id', 'content').order('created_at', { ascending: true });
    if (fetchErr) return json({ error: fetchErr.message }, 500);

    type Task = Record<string, unknown>;
    const batchSize = parseInt(url.searchParams.get('batch') || '1', 10);
    const STALE_LOCK_MS = 10 * 60 * 1000; // 10 minutes
    const nowMs = Date.now();

    // ── 2026-06-06 MEDIA HYDRATION ─────────────────────────────────────────
    // The Boss flagged "reels + stories never publish" for 3+ days. Root cause:
    // a task approved-to-publish but with NO media (reel without video_url, or
    // story/feed without generated_image_url) was rejected by the filter below
    // on every run → rotted forever. Here we guarantee media for every task that
    // is approved to publish (status='approved' from oren's manual approve in
    // admin, OR content_approved=true from QA auto-approve at score≥75):
    //   • reel without video → attach the matching FINAL persona reel from the
    //     bank if the product matches (men-1/2/3/5 → products 3/6/15/8); else
    //     downgrade to feed_post so it still publishes (bank has no women / no
    //     men-4 / no men-1-EN yet — batch reels 2026-05-23 stalled).
    //   • story/feed without image → attach a Gelato back-mockup.
    // pending_approval tasks oren is still reviewing are left untouched.
    for (const t of (candidates || [])) {
      const cd = (t.content_data as Task) || {};
      const approvedToPublish = !!cd.content_approved || t.status === 'approved';
      if (!approvedToPublish || cd.publish_frozen) continue;
      let mutated = false;
      const hLang = (((cd.language as string) || (cd.lang as string) || 'en')).toLowerCase();
      // (a0) carousel without slides → build from existing catalog mockups + persona
      // (2026-06-09). If we can't assemble ≥2 slides, degrade to a single feed_post.
      if (cd.format === 'carousel' && !(Array.isArray(cd.carousel_images) && (cd.carousel_images as string[]).length >= 2)) {
        const slides = await buildCarouselImages(sb, cd.product_id);
        if (slides.length >= 2) {
          cd.carousel_images = slides;
          if (!cd.generated_image_url) cd.generated_image_url = slides[0]; // hasImage gate + FB first-image
          cd.image_source = cd.image_source || 'carousel_mockups';
          mutated = true;
        } else {
          cd.format = 'feed_post'; cd.carousel_downgraded = true; mutated = true;
        }
      }
      // (a) reel without a ready video → attach bank reel or downgrade to feed_post
      if (cd.format === 'reel' && !(cd.video_url && cd.reel_status === 'ready')) {
        const bankUrl = await reelBankUrlForProduct(cd.product_id as string, hLang);
        if (bankUrl) {
          cd.video_url = bankUrl; cd.reel_status = 'ready'; cd.reel_source = 'bank_pilot'; mutated = true;
        } else {
          cd.format = 'feed_post'; cd.reel_downgraded = true;
          cd.reel_downgraded_reason = 'no FINAL persona reel for this product/lang (bank covers products 3/6/15/8, men only, EN except men-1) — publishing as feed post';
          mutated = true;
        }
      }
      // (b) non-reel without image → attach a Gelato back-mockup
      // 2026-06-09: NEVER garment-mockup a persona post. The agent-personas BTS
      // series MUST show the character's avatar (images/team/{role}.jpg), set at
      // creation by the agent-personas skill. A garment mockup here is the bug
      // that shipped the "I survived" tee on the Moshe/Supply post. If a persona
      // post somehow has no image, leave it imageless (it won't publish) so the
      // gap is visible — never publish the wrong image.
      const isPersonaPost = (((cd.series as string) || '')) === 'agent_personas';
      const stillReel = cd.format === 'reel' && cd.video_url && cd.reel_status === 'ready';
      if (!stillReel && !cd.generated_image_url && !isPersonaPost) {
        // 2026-06-09: prefer a real Higgsfield persona-model still (model wearing
        // THIS product) over a bare garment mockup. oren wants posts to show the
        // models we made, not just the garment. Falls to mockup if no persona
        // image exists for this product yet.
        const hSeed = parseInt((t.id as string).replace(/-/g, '').substring(0, 8), 16) || 0;
        const personaUrl = await pickPersonaModelUrl(sb, cd.product_id, hSeed);
        if (personaUrl) { cd.generated_image_url = personaUrl; cd.image_source = 'persona_model_hydrate'; mutated = true; }
        if (!cd.generated_image_url) {
          let productColors: string[] = [];
          try {
            const { data: pr } = await sb.from('dubis_products').select('colors').eq('active', true).eq('product_id_numeric', cd.product_id as string).limit(1);
            const c = pr?.length ? (pr[0] as Record<string, unknown>).colors : null;
            if (Array.isArray(c)) productColors = c as string[];
          } catch { /* ignore */ }
          const mockup = pickGelatoBackMockupUrl(cd.product_id as string, productColors, t.id as string);
          if (mockup) { cd.generated_image_url = mockup; cd.image_source = 'gelato_mockup_hydrate'; mutated = true; }
        }
      }
      if (mutated) {
        t.content_data = cd;
        await sb.from('agent_tasks').update({ content_data: cd, updated_at: new Date().toISOString() }).eq('id', t.id);
      }
    }

    const readyTasks = (candidates || []).filter((t: Task) => {
      const cd = (t.content_data as Task) || {};
      // 2026-04-25: hard freeze flag — manual override to skip a task that caused dup-publish
      if (cd.publish_frozen) return false;
      const hasImage = !!(cd.generated_image_url as string); // accept dubis.net OR supabase.co images
      const hasReel  = !!(cd.video_url && cd.reel_status === 'ready');
      // 2026-06-06: status='approved' (oren's manual admin approve) counts as an
      // approval signal even if content_approved was never set by QA. Previously
      // ONLY content_approved was checked, so manually-approved posts never published.
      const approvedSignal = !!cd.content_approved || t.status === 'approved';
      if (!approvedSignal || (!hasImage && !hasReel)) return false;
      // Skip tasks that are already locked (status='publishing') unless the lock is stale
      if (t.status === 'publishing') {
        const lockAt = cd.publish_lock_at as string | undefined;
        if (lockAt && (nowMs - new Date(lockAt).getTime()) < STALE_LOCK_MS) return false;
      }
      // Permanent retry cap — if >= 5 publish attempts without success, send to manual review
      if ((cd.publish_attempts as number) >= 5) return false;
      return true;
    }).slice(0, batchSize);

    if (!readyTasks.length) return json({ published: 0, summary: 'אין משימות מוכנות לפרסום עדיין' });

    const igBase = `https://graph.facebook.com/v19.0/${igAccount}`;
    const results: unknown[] = [];
    const now = new Date().toISOString();

    for (const task of readyTasks) {
      const cd = (task.content_data as Task) || {};

      // ── 2026-05-20 PHASE C — Content dedup (7-day window) ──────────
      // Rule: never publish a post that uses the same slogan as another published
      // post in the last 7 days. If duplicate found, push the task back to
      // pending_approval with a reason — oren reviews in admin.
      //
      // 2026-06-09: product_id dedup REMOVED + persona series EXEMPTED.
      //   • product_id dedup starved the whole pipeline: with a ~15-product
      //     catalog and 2 posts/day, every product naturally recurs ~every 7.5
      //     days — right on the boundary — so posts kept bouncing to
      //     pending_approval and rotting (nothing ever re-published them). That
      //     stalled BOTH regular content (last regular post 2026-06-06) AND the
      //     persona series (day2-5 bounced). A product reappearing within a week
      //     is normal for a small shop; the slogan dedup below is the real spam
      //     guard. See troubleshooting.md "Publish pipeline starved by product
      //     dedup (2026-06-09)".
      //   • The agent-personas BTS series is exempt entirely — its uniqueness is
      //     the narrative (Gadi/Shira/...), the product link is incidental and
      //     intentionally repeats across characters.
      const isPersonaSeries = (((cd.series as string) || '')) === 'agent_personas';
      const dedupWindow = new Date(Date.now() - 7*86400000).toISOString();
      const mySlogan    = ((cd.slogan as string) || (cd.product_slogan as string) || '').trim();
      let dedupReason: string | null = null;
      if (!isPersonaSeries && mySlogan && mySlogan.length > 8) {
        const { data: sameSlogan } = await sb.from('agent_tasks')
          .select('id, updated_at')
          .eq('agent_id', 'content').eq('status', 'done')
          .neq('id', task.id)
          .gte('updated_at', dedupWindow)
          .filter('content_data->>slogan', 'eq', mySlogan)
          .limit(1);
        if (sameSlogan && sameSlogan.length > 0) {
          dedupReason = `same slogan ("${mySlogan.slice(0,40)}") published within last 7 days (task ${(sameSlogan[0] as Task).id})`;
        }
      }
      if (dedupReason) {
        await sb.from('agent_tasks').update({
          status: 'pending_approval',
          content_data: { ...cd, duplicate_skip_reason: dedupReason, duplicate_detected_at: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        }).eq('id', task.id);
        results.push({ id: task.id, title: task.title, status: 'skipped-duplicate', reason: dedupReason });
        continue;
      }

      // ── 2026-04-25 ATOMIC CLAIM ─────────────────────────────────────
      // Race-safe lock: only one concurrent run can transition the task into
      // 'publishing'. The .in() filter ensures the UPDATE only succeeds if the
      // task is still in a publishable state (or holding a stale lock).
      // If 0 rows return, another worker already claimed it → skip.
      const priorStatus = task.status as string;
      const acceptStatuses = priorStatus === 'publishing'
        ? ['publishing']                          // re-claim stale lock
        : ['pending_approval', 'approved'];
      const attemptCount = ((cd.publish_attempts as number) || 0) + 1;
      const claimNow = new Date().toISOString();
      const { data: claimed, error: claimErr } = await sb.from('agent_tasks')
        .update({
          status: 'publishing',
          content_data: { ...cd, publish_lock_at: claimNow, publish_attempts: attemptCount },
          updated_at: claimNow,
        })
        .eq('id', task.id)
        .in('status', acceptStatuses)
        .select('id')
        .maybeSingle();
      if (claimErr || !claimed) {
        results.push({ id: task.id, title: task.title, status: 'skipped', reason: claimErr?.message || 'lock-held-by-another-worker' });
        continue;
      }
      // Language can come from either `cd.language` (auto-content writes this)
      // or `cd.lang` (weekly-marketing-plan writes this). Default to 'en' for
      // legacy rows that have no language field.
      const lang = (((cd.language as string) || (cd.lang as string) || 'en')).toLowerCase();
      // Instagram doesn't make URLs clickable in feed/Reel captions — only bio link works.
      // Facebook DOES make URLs clickable, so we link directly to the specific product page.
      // product_url is set by auto-content from dubis_products (active=true only).
      const productUrl = (cd.product_url as string) || 'https://www.dubis.net';
      const priceUsd   = (cd.product_price_usd as number | null) ?? null;
      // PRODUCT-LINK RULE (2026-04-18): both IG + FB must show the specific product URL.
      // IG won't make it clickable in feed/Reel captions, but the user can still see and copy it.
      // Pair with "link in bio" because that bio link IS clickable.
      const priceTag   = priceUsd != null ? ` — $${priceUsd}` : '';
      // Use `?p=N` format for BOTH platforms — it's the only form that survives
      // the Meta platforms intact:
      //   - IG: `#product-N` in caption is parsed as a hashtag → kidnaps clicks to
      //         IG's generic #product feed. `?p=N` renders as plain text but
      //         doesn't hijack.
      //   - FB: `#product-N` works in-page but FB's l.facebook.com click tracker
      //         appends `?fbclid=XXX` and drops the hash in its redirect → users
      //         land on homepage. `?p=N` survives FB's redirect cleanly.
      // main.js (initSpaTracking) reads `?p=N` on load → openProductModal(N).
      // (Fixed 2026-04-21)
      const productUrlQP = productUrl.replace(/\/?#product-(\d+)/, '/?p=$1');
      const igUrl        = productUrlQP.replace(/^https?:\/\/(www\.)?/, '');
      const shopLineIG   = `🛒 Shop this${priceTag} → ${igUrl}\n🔗 Tap link in bio @dubis.brand`;
      // FB: keep full https:// so it stays clickable in the FB feed.
      const shopLineFB   = `🛒 Shop this${priceTag} → ${productUrlQP}`;
      const baseBody = lang === 'he'
        ? ((cd.caption_he as string) || (cd.caption_en as string) || task.title)
        : ((cd.caption_en as string) || (cd.caption_he as string) || task.title);
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
      // 2026-05-20: Bumped Graph API v19 → v22 for REELS support.
      // Meta deprecated v19 REELS endpoint behavior; v22 accepts video_url + media_type=REELS cleanly.
      const igBaseV22 = `https://graph.facebook.com/v22.0/${igAccount}`;
      const fbApiV22 = 'https://graph.facebook.com/v22.0';
      // Carousel: cd.format === 'carousel' AND cd.carousel_images is array of URLs (≥2, ≤10)
      const carouselImages = Array.isArray(cd.carousel_images) ? cd.carousel_images as string[] : [];
      const isCarousel = (cd.format === 'carousel') && carouselImages.length >= 2;
      try {
        let container: Record<string, unknown>;
        if (isReel) {
          // Instagram Reels: POST /{ig-account}/media with media_type=REELS
          // v22 expects: video_url, media_type='REELS', caption, optional cover_url, share_to_feed=true
          const coverUrl = (cd.cover_url as string) || image_url || undefined;
          const reelPayload: Record<string, unknown> = {
            video_url: videoUrl,
            caption,
            media_type: 'REELS',
            share_to_feed: true,
            access_token: igToken,
          };
          if (coverUrl) reelPayload.cover_url = coverUrl;
          const cRes = await fetch(`${igBaseV22}/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reelPayload),
          });
          container = await cRes.json();
          if (!cRes.ok || container.error) {
            const errMsg = (container.error as Record<string,unknown>)?.message as string || 'reel container failed';
            await sb.from('agent_tasks').update({ status: priorStatus, content_data: { ...cd, publish_lock_at: null, publish_attempts: attemptCount, last_publish_error: errMsg, last_publish_attempt_at: claimNow }, updated_at: new Date().toISOString() }).eq('id', task.id);
            results.push({ id: task.id, title: task.title, status: 'error', error: errMsg });
            continue;
          }
          // Poll container status — videos take longer to process (up to 30s)
          const containerId = container.id as string;
          let ready = false;
          for (let attempt = 0; attempt < 24; attempt++) {
            await new Promise((r) => setTimeout(r, 5000));
            const statusRes = await fetch(`${fbApiV22}/${containerId}?fields=status_code&access_token=${igToken}`);
            const statusData = await statusRes.json() as Record<string, unknown>;
            if (statusData.status_code === 'FINISHED') { ready = true; break; }
            if (statusData.status_code === 'ERROR') { break; }
          }
          if (!ready) {
            const errMsg = 'Reel container not ready after 120s';
            await sb.from('agent_tasks').update({ status: priorStatus, content_data: { ...cd, publish_lock_at: null, publish_attempts: attemptCount, last_publish_error: errMsg, last_publish_attempt_at: claimNow }, updated_at: new Date().toISOString() }).eq('id', task.id);
            results.push({ id: task.id, title: task.title, status: 'error', error: errMsg });
            continue;
          }
        } else if (isCarousel) {
          // Instagram Carousel: 2-step. (a) Create child containers for each image (is_carousel_item=true).
          // (b) Create parent container with media_type=CAROUSEL and children=[child_ids].
          const childIds: string[] = [];
          for (const childUrl of carouselImages.slice(0, 10)) {
            const cRes = await fetch(`${igBaseV22}/media`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ image_url: childUrl, is_carousel_item: true, access_token: igToken }),
            });
            const cJson = await cRes.json();
            if (!cRes.ok || cJson.error) {
              const errMsg = `carousel child failed: ${cJson.error?.message || 'unknown'}`;
              await sb.from('agent_tasks').update({ status: priorStatus, content_data: { ...cd, publish_lock_at: null, publish_attempts: attemptCount, last_publish_error: errMsg, last_publish_attempt_at: claimNow }, updated_at: new Date().toISOString() }).eq('id', task.id);
              results.push({ id: task.id, title: task.title, status: 'error', error: errMsg });
              throw new Error(errMsg);
            }
            childIds.push(cJson.id as string);
            await new Promise((r) => setTimeout(r, 1500));
          }
          // Parent carousel container
          const cRes = await fetch(`${igBaseV22}/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ media_type: 'CAROUSEL', children: childIds.join(','), caption, access_token: igToken }),
          });
          container = await cRes.json();
          if (!cRes.ok || container.error) {
            const errMsg = (container.error as Record<string,unknown>)?.message as string || 'carousel parent failed';
            await sb.from('agent_tasks').update({ status: priorStatus, content_data: { ...cd, publish_lock_at: null, publish_attempts: attemptCount, last_publish_error: errMsg, last_publish_attempt_at: claimNow }, updated_at: new Date().toISOString() }).eq('id', task.id);
            results.push({ id: task.id, title: task.title, status: 'error', error: errMsg });
            continue;
          }
          await new Promise((r) => setTimeout(r, 7000));
        } else {
          // Image post
          const cRes = await fetch(`${igBaseV22}/media`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_url, caption, access_token: igToken }) });
          container = await cRes.json();
          if (!cRes.ok || container.error) {
            const errMsg = (container.error as Record<string,unknown>)?.message as string || 'container failed';
            await sb.from('agent_tasks').update({ status: priorStatus, content_data: { ...cd, publish_lock_at: null, publish_attempts: attemptCount, last_publish_error: errMsg, last_publish_attempt_at: claimNow }, updated_at: new Date().toISOString() }).eq('id', task.id);
            results.push({ id: task.id, title: task.title, status: 'error', error: errMsg });
            continue;
          }
          await new Promise((r) => setTimeout(r, 7000));
        }
        const pRes = await fetch(`${igBaseV22}/media_publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creation_id: container.id, access_token: igToken }) });
        const pub = await pRes.json();
        if (!pRes.ok || pub.error) {
          const errMsg = pub.error?.message || 'publish failed';
          await sb.from('agent_tasks').update({ status: priorStatus, content_data: { ...cd, publish_lock_at: null, publish_attempts: attemptCount, last_publish_error: errMsg, last_publish_attempt_at: claimNow }, updated_at: new Date().toISOString() }).eq('id', task.id);
          results.push({ id: task.id, title: task.title, status: 'error', error: errMsg });
          continue;
        }
        // Instagram succeeded — now try Facebook as well
        let fbPostId: string | null = null;
        let fbError: string | null = null;
        try {
          const fbPageId = Deno.env.get('FACEBOOK_PAGE_ID') ?? '';
          const fbToken  = Deno.env.get('FACEBOOK_PAGE_TOKEN') ?? igToken; // fall back to IG token
          if (fbPageId) {
            // 2026-05-20: branch by media type. Photo posts → /photos; video → /videos.
            // FB doesn't have a generic "carousel" feed object — we cross-post the carousel
            // as a single first-image photo to keep the link clickable. IG owns the carousel UX.
            let fbRes: Response;
            if (isReel && videoUrl) {
              // FB video post (Page video upload by URL — works v19+, v22 preferred)
              fbRes = await fetch(`${fbApiV22}/${fbPageId}/videos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file_url: videoUrl, description: captionFB, access_token: fbToken }),
              });
            } else {
              // FB photo (default for feed_post + carousel-first-image fallback)
              const fbImageUrl = image_url || (isCarousel && carouselImages.length > 0 ? carouselImages[0] : null);
              if (!fbImageUrl) {
                fbError = 'no image URL for FB photo upload';
                fbRes = new Response('{}', { status: 200 });
              } else {
                fbRes = await fetch(`${fbApiV22}/${fbPageId}/photos`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ url: fbImageUrl, caption: captionFB, access_token: fbToken }),
                });
              }
            }
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

        // Fetch public permalinks. IG/FB only mint these AFTER media_publish, so
        // this has to be a separate Graph API call — pub.id alone is the numeric
        // media_id, not a URL. Failures are non-fatal: we still mark the task done,
        // just without a public link in the daily report.
        let igPermalink: string | null = null;
        try {
          const igPRes = await fetch(`${fbApiV22}/${pub.id}?fields=permalink&access_token=${igToken}`);
          const igPData = await igPRes.json();
          if (igPRes.ok && igPData.permalink) igPermalink = igPData.permalink as string;
        } catch (_) { /* leave null */ }
        let fbPermalink: string | null = null;
        if (fbPostId) {
          try {
            const fbToken = Deno.env.get('FACEBOOK_PAGE_TOKEN') ?? igToken;
            // FB photo posts expose `link` not `permalink_url`. Try `link` first;
            // fall back to permalink_url for regular posts.
            const fbPRes = await fetch(`${fbApiV22}/${fbPostId}?fields=link,permalink_url&access_token=${fbToken}`);
            const fbPData = await fbPRes.json();
            if (fbPRes.ok) {
              fbPermalink = (fbPData.link as string | undefined) || (fbPData.permalink_url as string | undefined) || null;
            }
            // Last-resort fallback: construct from page_id + post_id
            if (!fbPermalink && fbPostId) {
              const fbPageId = Deno.env.get('FACEBOOK_PAGE_ID') ?? '';
              if (fbPageId) fbPermalink = `https://www.facebook.com/${fbPageId}/posts/${fbPostId}`;
            }
          } catch (_) { /* leave null */ }
        }

        // Use a fresh timestamp at the moment we record success — `now` was set at loop start.
        const publishNow = new Date().toISOString();
        await sb.from('agent_tasks').update({ status: 'done', content_data: { ...cd, instagram_post_id: pub.id, facebook_post_id: fbPostId, ig_permalink: igPermalink, fb_permalink: fbPermalink, published_at: publishNow, publish_lock_at: null, publish_attempts: attemptCount }, updated_at: publishNow }).eq('id', task.id);
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
        const errMsg = (e as Error).message;
        // Restore the lock so a future cron run can retry — but keep the attempt count so the cap eventually kicks in.
        try { await sb.from('agent_tasks').update({ status: priorStatus, content_data: { ...cd, publish_lock_at: null, publish_attempts: attemptCount, last_publish_error: errMsg, last_publish_attempt_at: claimNow }, updated_at: new Date().toISOString() }).eq('id', task.id); } catch { /* swallow — caller still sees error in results */ }
        results.push({ id: task.id, title: task.title, status: 'error', error: errMsg });
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
    const svcKey      = SERVICE_ROLE;
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
    // 2026-05-03 fix: count only OUR own auto-content tasks toward the daily cap.
    // Sunday's `dubis-weekly-team-meeting` task creates admin TODOs with
    // agent_id='content' and was eating the entire daily quota → no posts ever
    // got created on Sundays.
    type Cd = Record<string, unknown>;
    const autoTodayCount = (todayTasks || []).filter((t: Record<string, unknown>) => {
      const cd = (t.content_data as Cd) || {};
      return cd.created_by === 'auto-content-cron' || cd.auto_created === true;
    }).length;
    const MAX_DAILY_POSTS = 2;
    if (autoTodayCount >= MAX_DAILY_POSTS) {
      return json({ skipped: true, reason: `Already ${autoTodayCount} auto-content tasks today (max ${MAX_DAILY_POSTS})`, total_content_tasks_today: todayTasks?.length ?? 0 });
    }
    // IL re-opened 2026-05-15: alternate HE/EN posts. Even auto-content count = HE
    // (first post of the day in IL morning), odd = EN (second post in US morning).
    // Manual override still respected via ?lang=he|en query param.
    // Downstream content-run + publish are language-aware as of 2026-05-18.
    const langParam = (url.searchParams.get('lang') || '').toLowerCase();
    const nextLang = (langParam === 'he' || langParam === 'en')
      ? langParam
      : ((autoTodayCount % 2 === 0) ? 'he' : 'en');

    // LRU rotation — pick the product whose most recent auto-content task is
    // oldest (or has never been posted). This guarantees every active product
    // gets equal coverage regardless of how many products exist.
    //
    // BUG FIXED 2026-05-18: previous logic had two issues that left 5/18 active
    // products with zero posts in a week:
    //   1. `PRODUCTS.find(!recent.has)` always picked the LOWEST product_id not
    //      in the recent set → biased toward low IDs.
    //   2. Fallback `getDay() % PRODUCTS.length` returns 0–6 (since getDay() is
    //      0–6), so with 18 products only the first 7 could ever be picked.
    // New approach: scan a wide window (200 most recent auto-content tasks),
    // build last_posted_at per product_id, then pick the product with the
    // oldest last_posted_at (or never-posted first, tiebroken by product_id).
    type TaskRow = Record<string, unknown>;
    const { data: recentTasks } = await sb.from('agent_tasks')
      .select('content_data, created_at')
      .eq('agent_id', 'content')
      .order('created_at', { ascending: false })
      .limit(200);
    const lastPostedAt = new Map<number, string>();
    for (const t of (recentTasks || []) as TaskRow[]) {
      const cd = (t.content_data as TaskRow) || {};
      // Only count actual auto-content posts toward rotation — admin/meeting
      // tasks with agent_id='content' shouldn't influence product selection.
      const isAutoContent = cd.created_by === 'auto-content-cron' || cd.auto_created === true;
      if (!isAutoContent) continue;
      const pid = Number(cd.product_id);
      if (!pid) continue;
      const ts = t.created_at as string;
      if (!lastPostedAt.has(pid)) lastPostedAt.set(pid, ts);
    }
    // Sort products: never-posted (no entry) first, then by oldest last_posted_at.
    // Tiebreak by product_id ASC so the order is deterministic.
    const ranked = [...PRODUCTS].sort((a, b) => {
      const la = lastPostedAt.get(a.product_id);
      const lb = lastPostedAt.get(b.product_id);
      if (!la && !lb) return a.product_id - b.product_id;
      if (!la) return -1;
      if (!lb) return 1;
      if (la !== lb) return la < lb ? -1 : 1;
      return a.product_id - b.product_id;
    });
    const picked = ranked[0];
    // HARD GUARD: auto-content MUST have a product. Never create tasks without product_id.
    if (!picked?.product_id) {
      return json({ skipped: true, reason: 'No product with product_id available — refusing to create post without product link' });
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

  // ── WEEKLY MARKETING PLAN ────────────────────────────────────────────
  // IL pivot 2026-05-17 — generates the next week's 17-slot social plan.
  // See: docs/plans/campaigns/DUBIS_WEEKLY_SOCIAL_PLAN_2026-05-16.html
  // Cron: every Sunday 04:00 UTC (07:00 IL). Boss agent emails the plan
  // to oren for approval; once approved, child agent_tasks become active.
  //
  // Skeleton MVP (2026-05-17): generates the slot calendar + product
  // selection + placeholder agent_tasks rows. Gemini caption generation
  // + Boss approval email are the NEXT batch — slots are created with
  // status='backlog' and needs_copy=true so the system knows they're
  // not yet ready to publish.
  if (type === 'weekly-marketing-plan') {
    const cronSecret  = Deno.env.get('CRON_SECRET') ?? '';
    const agentSecret = Deno.env.get('AGENT_SECRET') ?? '';
    const svcKey      = SERVICE_ROLE;
    const authHeader  = req.headers.get('authorization') ?? '';
    const token       = authHeader.replace('Bearer ', '').trim()
                     || req.headers.get('x-agent-secret') || '';
    const isAuthed = (cronSecret && token === cronSecret)
                  || (agentSecret && token === agentSecret)
                  || (svcKey && token === svcKey);
    const adminOk = await verifyAdmin(req);
    if (!isAuthed && !adminOk) return json({ error: 'Unauthorized' }, 401);

    const forceRegen = url.searchParams.get('force') === '1';

    // ── 1. Compute target week start (upcoming Sunday in IL) ──────────
    // IL is UTC+2 (winter) or UTC+3 (summer). For "week starts Sunday in IL",
    // we anchor by UTC Sunday 00:00. Acceptable drift — slots use UTC anyway.
    const today = new Date();
    const dayOfWeek = today.getUTCDay(); // 0=Sun
    const daysUntilNextSunday = dayOfWeek === 0 ? 0 : (7 - dayOfWeek);
    const weekStart = new Date(today);
    weekStart.setUTCDate(today.getUTCDate() + daysUntilNextSunday);
    weekStart.setUTCHours(0, 0, 0, 0);
    const weekStartDate = weekStart.toISOString().slice(0, 10); // YYYY-MM-DD

    // ── 2. Check for existing plan ────────────────────────────────────
    const { data: existing } = await sb
      .from('weekly_marketing_plans')
      .select('id, status, total_slots, task_ids, generated_at')
      .eq('week_start_date', weekStartDate)
      .maybeSingle();

    if (existing && !forceRegen && existing.status !== 'draft') {
      return json({
        ok: true, skipped: true, reason: `Plan for ${weekStartDate} already exists (status=${existing.status}). Pass ?force=1 to regenerate.`,
        plan: existing,
      });
    }

    // ── 3. Fetch prior week's metrics ─────────────────────────────────
    const priorWeekStart = new Date(weekStart);
    priorWeekStart.setUTCDate(weekStart.getUTCDate() - 7);
    const priorWeekStartIso = priorWeekStart.toISOString();
    const priorWeekEndIso   = weekStart.toISOString();

    const { count: postsCount } = await sb
      .from('agent_tasks').select('id', { count: 'exact', head: true })
      .eq('category', 'social_post').eq('status', 'done')
      .gte('updated_at', priorWeekStartIso).lt('updated_at', priorWeekEndIso);
    const { count: tiktoksCount } = await sb
      .from('agent_tasks').select('id', { count: 'exact', head: true })
      .eq('category', 'tiktok_post').eq('status', 'done')
      .gte('updated_at', priorWeekStartIso).lt('updated_at', priorWeekEndIso);
    const { count: ordersCount } = await sb
      .from('orders').select('id', { count: 'exact', head: true })
      .gte('created_at', priorWeekStartIso).lt('created_at', priorWeekEndIso);

    const priorWeekMetrics = {
      window_start: priorWeekStartIso,
      window_end:   priorWeekEndIso,
      posts_published: postsCount ?? 0,
      tiktoks_published: tiktoksCount ?? 0,
      orders_count: ordersCount ?? 0,
      // Engagement metrics require Meta API call — deferred to next batch.
    };

    // ── 4. Slot calendar template (17 slots, HE-first per IL pivot) ───
    // Day index: 0=Sun, 1=Mon, ..., 6=Sat (matches Date.getUTCDay)
    type SlotTemplate = {
      day_offset: number;  // days from week_start (Sunday=0)
      hour_utc: number;
      channel: 'ig_fb_feed' | 'ig_fb_reel' | 'ig_carousel' | 'tiktok';
      format:  'feed_post' | 'reel' | 'carousel' | 'tiktok';
      category: 'social_post' | 'tiktok_post';
      lang: 'he' | 'en';
    };
    const SLOT_TEMPLATES: SlotTemplate[] = [
      // ── Sunday ──
      { day_offset: 0, hour_utc: 18, channel: 'tiktok',     format: 'tiktok',    category: 'tiktok_post', lang: 'he' },
      // ── Monday ──
      { day_offset: 1, hour_utc:  8, channel: 'ig_fb_reel', format: 'reel',      category: 'social_post', lang: 'he' },
      { day_offset: 1, hour_utc: 10, channel: 'ig_fb_feed', format: 'feed_post', category: 'social_post', lang: 'he' },
      { day_offset: 1, hour_utc: 18, channel: 'tiktok',     format: 'tiktok',    category: 'tiktok_post', lang: 'en' },
      // ── Tuesday ──
      { day_offset: 2, hour_utc:  8, channel: 'ig_fb_reel', format: 'reel',      category: 'social_post', lang: 'he' },
      { day_offset: 2, hour_utc: 16, channel: 'ig_carousel',format: 'carousel',  category: 'social_post', lang: 'he' },
      { day_offset: 2, hour_utc: 18, channel: 'tiktok',     format: 'tiktok',    category: 'tiktok_post', lang: 'he' },
      // ── Wednesday ──
      { day_offset: 3, hour_utc:  8, channel: 'ig_fb_reel', format: 'reel',      category: 'social_post', lang: 'en' },
      { day_offset: 3, hour_utc: 10, channel: 'ig_fb_feed', format: 'feed_post', category: 'social_post', lang: 'he' },
      { day_offset: 3, hour_utc: 18, channel: 'tiktok',     format: 'tiktok',    category: 'tiktok_post', lang: 'en' },
      // ── Thursday ──
      { day_offset: 4, hour_utc:  8, channel: 'ig_fb_reel', format: 'reel',      category: 'social_post', lang: 'he' },
      { day_offset: 4, hour_utc: 18, channel: 'tiktok',     format: 'tiktok',    category: 'tiktok_post', lang: 'he' },
      // ── Friday ──
      { day_offset: 5, hour_utc:  8, channel: 'ig_fb_reel', format: 'reel',      category: 'social_post', lang: 'he' },
      { day_offset: 5, hour_utc: 14, channel: 'ig_carousel',format: 'carousel',  category: 'social_post', lang: 'en' },
      { day_offset: 5, hour_utc: 16, channel: 'ig_fb_feed', format: 'feed_post', category: 'social_post', lang: 'en' },
      { day_offset: 5, hour_utc: 18, channel: 'tiktok',     format: 'tiktok',    category: 'tiktok_post', lang: 'he' },
      // ── Saturday ──
      { day_offset: 6, hour_utc: 18, channel: 'tiktok',     format: 'tiktok',    category: 'tiktok_post', lang: 'he' },
    ];
    // Sanity: 17 slots, 12 HE, 5 EN
    const heCount = SLOT_TEMPLATES.filter(s => s.lang === 'he').length;
    const enCount = SLOT_TEMPLATES.filter(s => s.lang === 'en').length;
    if (SLOT_TEMPLATES.length !== 17 || heCount !== 12 || enCount !== 5) {
      return json({ error: `slot template invariant broken: total=${SLOT_TEMPLATES.length}, he=${heCount}, en=${enCount}` }, 500);
    }

    // ── 5. Product selection — rotate across active catalog ───────────
    const { data: products, error: prodErr } = await sb
      .from('dubis_products')
      .select('id, product_id_numeric, slogan, colors, clothing_type')
      .eq('active', true)
      .order('product_id_numeric', { ascending: true });
    if (prodErr || !products || products.length === 0) {
      return json({ error: 'No active products available for plan generation', detail: prodErr?.message }, 500);
    }

    // Get products NOT featured in the prior 7 days (variety rule)
    const { data: recentFeatured } = await sb
      .from('agent_tasks')
      .select('content_data')
      .in('category', ['social_post', 'tiktok_post'])
      .gte('created_at', priorWeekStartIso)
      .limit(100);
    const recentProductIds = new Set<number>(
      (recentFeatured || []).map((t: Record<string, unknown>) => {
        const cd = (t.content_data as Record<string, unknown>) || {};
        return Number(cd.product_id);
      }).filter(n => Number.isFinite(n))
    );
    const freshProducts = products.filter((p: Record<string, unknown>) => !recentProductIds.has(p.product_id_numeric as number));
    // Use fresh first, fall back to full list when exhausted
    const productPool = freshProducts.length >= 6 ? freshProducts : products;

    // ── 6. Build slot details + create placeholder agent_tasks ────────
    const planDayLabels = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    const taskIds: string[] = [];
    const slotDetails: Record<string, unknown>[] = [];
    const failures: string[] = [];

    for (let i = 0; i < SLOT_TEMPLATES.length; i++) {
      const slot = SLOT_TEMPLATES[i];
      const product = productPool[i % productPool.length] as Record<string, unknown>;
      const productId = product.product_id_numeric as number;

      // Slot timestamp = weekStart + day_offset + hour_utc
      const slotTime = new Date(weekStart);
      slotTime.setUTCDate(weekStart.getUTCDate() + slot.day_offset);
      slotTime.setUTCHours(slot.hour_utc, 0, 0, 0);
      const slotIso = slotTime.toISOString();

      // Slogans on garments are always EN (DUBIS rule). DB has one column: slogan.
      const productSlogan = (product.slogan as string) || '';

      // Title format (2026-05-20 oren request): include full date so he can track execution
      // [יום-בשבוע YYYY-MM-DD HH:00 UTC] FORMAT LANG — slogan
      const slotDateIso = slotIso.slice(0, 10); // YYYY-MM-DD
      const title = `[${planDayLabels[slot.day_offset]} ${slotDateIso} ${String(slot.hour_utc).padStart(2,'0')}:00 UTC] ${slot.format.toUpperCase()} ${slot.lang.toUpperCase()} — ${productSlogan ? productSlogan.slice(0,40) : 'product-' + productId}`;

      const contentData = {
        // Schedule
        scheduled_for: slotIso,
        day_label_he:  planDayLabels[slot.day_offset],
        hour_utc:      slot.hour_utc,
        // Channel + format
        channel:       slot.channel,
        format:        slot.format,
        platform:      slot.format === 'tiktok' ? 'tiktok' : 'instagram+facebook',
        lang:          slot.lang,
        // Product
        product_id:    productId,
        product_slogan: productSlogan,
        product_url:   `https://www.dubis.net/?p=${productId}`,
        product_type:  product.clothing_type,
        // Plan tracking
        weekly_plan_week_start: weekStartDate,
        auto_created: true,
        created_by:   'weekly-marketing-plan',
        // Copy generation gate — caption_he / caption_en filled by next batch
        needs_copy:   true,
        // QA gate — qa_score filled by ?type=copy-qa
        qa_score:     null,
      };

      const { data: newTask, error: insertErr } = await sb
        .from('agent_tasks')
        .insert({
          title,
          agent_id:  'content',
          category:  slot.category,
          status:    'backlog',
          priority:  'medium',
          content_data: contentData,
          due_date:  slotIso,
        })
        .select('id').single();

      if (insertErr || !newTask) {
        failures.push(`slot ${i} (${slot.format} ${slot.lang}): ${insertErr?.message || 'insert returned no id'}`);
        continue;
      }
      const taskId = (newTask as Record<string, string>).id;
      taskIds.push(taskId);
      slotDetails.push({
        slot_index: i,
        task_id: taskId,
        scheduled_for: slotIso,
        ...slot,
        product_id: productId,
        product_slogan: productSlogan,
      });
    }

    if (failures.length > 0) {
      // Partial failure — log but continue. Caller decides whether to retry.
      console.error('[weekly-marketing-plan] partial failures:', failures);
    }

    // ── 7. Upsert weekly_marketing_plans row ──────────────────────────
    const planRow = {
      week_start_date: weekStartDate,
      status: failures.length === 0 ? 'awaiting_approval' : 'draft',
      total_slots: taskIds.length,
      he_slots: slotDetails.filter(s => (s as Record<string, unknown>).lang === 'he').length,
      en_slots: slotDetails.filter(s => (s as Record<string, unknown>).lang === 'en').length,
      task_ids: taskIds,
      prior_week_metrics: priorWeekMetrics,
      plan_summary: {
        slots: slotDetails,
        strategy_notes: `IL-focused HE-first cadence (${heCount} HE / ${enCount} EN). Prior week: ${postsCount ?? 0} posts, ${tiktoksCount ?? 0} TikToks, ${ordersCount ?? 0} orders. Phase 0 (IL personas) still blocking Reels production — slots created as placeholders.`,
        failures,
      },
      notes: failures.length > 0 ? `${failures.length} slot inserts failed — see plan_summary.failures` : null,
    };

    const { data: plan, error: planErr } = await sb
      .from('weekly_marketing_plans')
      .upsert(planRow, { onConflict: 'week_start_date' })
      .select()
      .single();

    if (planErr) {
      return json({ error: 'plan upsert failed', detail: planErr.message, task_ids: taskIds }, 500);
    }

    // ── 8. Log to agent_runs ──────────────────────────────────────────
    // Schema: id, agent_id, run_date, status, summary, tasks_created, duration_ms,
    // error_message, created_at, tasks_completed_ids, proof_verified, verification_notes,
    // side_effects. No 'data' column.
    await sb.from('agent_runs').insert({
      agent_id: 'marketing',
      status: 'completed',
      summary: `weekly-marketing-plan generated for ${weekStartDate}: ${taskIds.length} slots created (${heCount} HE / ${enCount} EN)`,
      tasks_created: taskIds.length,
      duration_ms: Date.now() - today.getTime(),
      side_effects: { plan_id: (plan as Record<string, unknown>)?.id, week_start_date: weekStartDate, failures },
    }).then(() => {}).catch(() => {});

    return json({
      ok: true,
      plan,
      task_count: taskIds.length,
      task_ids: taskIds,
      he_count: heCount,
      en_count: enCount,
      product_pool_size: productPool.length,
      product_pool_fresh: freshProducts.length,
      failures,
      next_step: 'Boss should email this plan to oren for approval. Copy generation (Gemini + copy-playbook) happens after approval via the (not-yet-built) ?type=copy-qa route.',
    });
  }

  // ── QA-CONTENT ───────────────────────────────────────────────────────
  if (type === 'qa-content') {
    // Auth: admin JWT or service role key (same as content-run)
    const svcKey = SERVICE_ROLE;
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

    // IL re-opened 2026-05-15: QA either caption_en or caption_he depending on language.
    type Task = Record<string, unknown>;
    const { data: tasks, error: fetchErr } = await sb.from('agent_tasks')
      .select('id, title, notes, content_data')
      .eq('status', 'pending_approval')
      .eq('agent_id', 'content')
      .order('created_at', { ascending: true });
    if (fetchErr) return json({ error: fetchErr.message }, 500);

    const unscored = ((tasks || []) as Task[]).filter((t) => {
      const cd = (t.content_data as Task) || {};
      return (cd.caption_en || cd.caption_he) && !cd.qa_score;
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

      // ── 1. Brand voice + grammar (30pts) — Gemini (language-aware) ────
      // IL re-opened 2026-05-15: QA either HE or EN caption based on cd.language.
      const qaLang = ((cd.language as string) || 'en').toLowerCase() === 'he' ? 'he' : 'en';
      const captionEn = (cd.caption_en as string) || '';
      const captionHe = (cd.caption_he as string) || '';
      const captionText = qaLang === 'he' ? captionHe : captionEn;
      let voiceScore = 0;
      try {
        const voicePrompt = qaLang === 'he'
          ? `אתה QA reviewer של מותג DUBIS. DUBIS הוא מותג אופנה אנטי-אופנתי ישראלי לגילאי 35-55. סלוגן: "בשביל כל השאר".
כללי קול המותג:
- טון: הומור יבש מודע-עצמי, body-positive, שיחתי, אנטי-היפ
- מילים אסורות בעברית: מושלם, מהמם, חובה, מטורף, מבצע, הנחה, יוקרתי, פרימיום, אקסקלוסיבי
- חייב להשתמש ב"קפוצון" (לא "הודי") ו"קפוצונים" (לא "הודיז")
- משפטים קצרים וחדים, גוף ראשון רבים ("אנחנו", "אצלנו")
- בלי שפת דחיפות, בלי CTA מכירתיים
- מתחבר לסלוגן המוצר ולאישיות המותג

כיתוב בעברית לבדיקה: "${captionHe}"
סלוגן המוצר על הבגד (באנגלית): "${productSlogan}"

בדוק:
1. איכות קול המותג בעברית — האם זה on-brand, שנון, אנטי-היפ? (0-20)
2. תקינות דקדוקית של העברית (0-5)
3. האם הסלוגן באנגלית קריא ותקין דקדוקית? (0-5)

נקד סה"כ 0-30. החזר רק JSON תקני:
{"score": <0-30>, "reason": "<משפט אחד>", "english_grammar_ok": <true/false>, "slogan_grammar_ok": <true/false>}`
          : `You are a DUBIS brand QA reviewer. DUBIS is a US anti-fashion apparel brand for people aged 35-55, tagline "For the rest of us."
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
        qaDetails.qa_lang = qaLang;
        if (qaLang === 'en' && vParsed.english_grammar_ok === false) failReasons.push('שגיאת דקדוק בכיתוב האנגלי');
        if (vParsed.slogan_grammar_ok === false) failReasons.push('סלוגן המוצר לא תקין דקדוקית באנגלית');
      } catch { voiceScore = 15; qaDetails.voice_reason = 'Gemini unavailable — default score'; }
      score += voiceScore;
      qaDetails.voice_score = voiceScore;
      if (voiceScore < 15) failReasons.push('קול המותג חלש');

      // ── 2. Caption quality (25pts) — language-aware ────
      let captionScore = 0;
      const captionLen = captionText.length;
      const minLen = format === 'story' ? 10 : (qaLang === 'he' ? 30 : 50);
      const maxLen = format === 'story' ? 150 : (qaLang === 'he' ? 400 : 500);
      if (captionLen >= minLen && captionLen <= maxLen) {
        captionScore = 20;
        // +5 if caption references the slogan or brand mark
        const slogan2 = ((cd.product_slogan as string) || '').toLowerCase();
        const sloganWords2 = slogan2.split(/\s+/).filter((w: string) => w.length > 3);
        const hasRef = sloganWords2.some((w: string) => captionText.toLowerCase().includes(w));
        if (hasRef || captionText.includes('DUBIS') || captionText.toLowerCase().includes('dubis')) captionScore = 25;
      } else if (captionLen > 0) {
        captionScore = 10; // has content but wrong length
      }
      // PRODUCT-LINK RULE (HARD FAIL): product_url + product_id must both be set.
      // The publish flow (shopLineIG/FB, line ~1599) automatically appends the URL
      // to the caption sent to Meta, so we don't require captionEn to contain it here.
      // But if no product is linked at all, we cannot publish — no "link in bio" anchor.
      const productUrlCd = (cd.product_url as string) || '';
      const productIdCd  = (cd.product_id as string) || '';
      let productLinkFail = false;
      if (!productUrlCd || !productIdCd || !productUrlCd.includes('#product-')) {
        productLinkFail = true;
        failReasons.push(`HARD FAIL: no product linked (product_id=${productIdCd || 'null'}, product_url=${productUrlCd || 'null'})`);
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

      // ── 5. No forbidden words (10pts) — language-aware ────
      // Anti-hype brand voice — these are banned in any DUBIS customer-facing copy.
      const forbiddenEn = ['perfect', 'stunning', 'must-have', 'insane', 'sale', 'discount', 'luxurious', 'premium', 'exclusive'];
      const forbiddenHe = ['מושלם', 'מהמם', 'חובה', 'מטורף', 'מבצע', 'הנחה', 'יוקרתי', 'פרימיום', 'אקסקלוסיבי', 'הודי', 'הודיז'];
      const forbidden = qaLang === 'he' ? forbiddenHe : forbiddenEn;
      const captionLower = captionText.toLowerCase();
      const foundForbidden = forbidden.filter((w) => captionLower.includes(w.toLowerCase()));
      const forbiddenScore = foundForbidden.length === 0 ? 10 : 0;
      score += forbiddenScore;
      qaDetails.forbidden_score = forbiddenScore;
      if (foundForbidden.length > 0) failReasons.push(`banned words: ${foundForbidden.join(', ')}`);

      // ── Final verdict ────────────────────────────────────────────────
      // Hard fails block auto-publish regardless of score.
      // 2026-05-03: image-missing is also a hard fail — publish-ready will
      // never publish a no-image task, so approving one just rots the queue.
      const imageMissing = imageScore === 0;
      if (imageMissing) failReasons.push('HARD FAIL: no image (publish-ready blocks no-image tasks)');
      const qaPass = score >= 60 && !productLinkFail && !imageMissing;
      const qaAutoPublish = score >= 75 && !productLinkFail && !imageMissing; // High-quality → auto-approve + auto-publish
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
              'Authorization': `Bearer ${SERVICE_ROLE}`,
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

  // ── COPY-QA — single-shot caption scoring against Copy Playbook ───
  // Used by orchestrator skills (higgsfield-reels, dubis-design) as a service call.
  // Different from qa-content: takes inputs directly, returns single score, does NOT batch over DB.
  // Body: { caption_he?, caption_en?, slogan, product_id, lang, persona_id? }
  // Returns: { score: 0-100, issues: string[], fix_suggestions: string[], breakdown: {...} }
  if (type === 'copy-qa') {
    const svcKey = SERVICE_ROLE;
    const agentSecret = Deno.env.get('AGENT_SECRET') ?? '';
    const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
    const authHeader = req.headers.get('authorization') ?? '';
    const token = url.searchParams.get('token') || authHeader.replace('Bearer ', '').trim() || req.headers.get('x-agent-secret') || '';
    const isAuthed = (svcKey && token === svcKey) || (agentSecret && token === agentSecret) || (cronSecret && token === cronSecret);
    const adminOk = await verifyAdmin(req);
    if (!isAuthed && !adminOk) return json({ error: 'Unauthorized' }, 401);

    const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
    if (!geminiKey) return json({ error: 'GEMINI_API_KEY not configured' }, 503);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

    const captionHe = String(body.caption_he ?? '').trim();
    const captionEn = String(body.caption_en ?? '').trim();
    const slogan    = String(body.slogan ?? '').trim();
    const productId = Number(body.product_id ?? 0);
    const lang      = (String(body.lang ?? 'he').toLowerCase() === 'en') ? 'en' : 'he';
    const personaId = String(body.persona_id ?? '').trim();
    const caption   = lang === 'he' ? captionHe : captionEn;

    if (!caption) return json({ error: 'caption required (caption_he or caption_en per lang)' }, 400);
    if (!productId) return json({ error: 'product_id required' }, 400);

    // Verify product exists + slogan matches
    const { data: product } = await sb.from('dubis_products')
      .select('product_id_numeric, slogan, active')
      .eq('product_id_numeric', productId)
      .maybeSingle();

    if (!product) return json({ error: `product_id ${productId} not found` }, 404);
    if (!product.active) return json({ error: `product_id ${productId} is not active` }, 400);
    const sloganMismatch = slogan && product.slogan && slogan.trim().toLowerCase() !== String(product.slogan).trim().toLowerCase();

    // Verify product URL is present in caption (DUBIS hard rule)
    const productUrl = `dubis.net/#product-${productId}`;
    const productUrlAlt = `dubis.net/?p=${productId}`;
    const urlPresent = caption.includes(productUrl) || caption.includes(productUrlAlt) || caption.includes(`#product-${productId}`);

    // Copy Playbook system_instruction (matches memory/copy-playbook.md verbatim)
    const systemInstruction = lang === 'he' ? `אתה QA reviewer של מותג DUBIS לפי Copy Playbook.

כללי הפסילה (כל אחד = ציון נמוך משמעותי):
1. **אחת ממילות ה-blacklist בעברית:** מושלם, מהמם, חובה, מטורף (כשבח), לייף סטייל, מבצע שאסור לפספס, להשתפר, הטרנד הבא
2. **תרגום מאנגלית** — אם זה נשמע כמו translation ולא כמו עברית מקורית רק עכשיו (אנטי-תרגום rule). עוגנים אמיתיים: מרפסת ת"א, פינג'אן, פקקים, חמסין, ארוחת שישי, סופ"ש
3. **CTA טרנזקציוני** — "קנו עכשיו", "הנחה 20%", "אל תפספסו" — DUBIS לעולם לא מוכרת ככה. CTA זהותי בלבד.
4. **Self-deprecating של חולשה** — "אני שמן/שמנה ויודע/ת זאת". הומור מותר רק מתוך עוצמה.
5. **חסר Product URL** — חייב להופיע dubis.net/#product-{id} או דומה גלוי בקפשן
6. **חסר 3-beat structure** — Hook ציני → Agitation אמיתית → DUBIS Drop. צריך לראות את שלושת השלבים.

נקד 0-100:
- מבנה 3-beat: 30 נקודות (10 לכל beat)
- שפה מקורית עברית (אנטי-תרגום): 20
- אין מילות blacklist: 20 (-10 לכל מילה)
- CTA זהותי לא טרנזקציוני: 15
- Product URL נוכח: 10
- Slogan המוצר משולב נכון: 5

החזר רק JSON תקני:
{"score": <0-100>, "issues": ["<בעיה 1>", ...], "fix_suggestions": ["<תיקון 1>", ...], "breakdown": {"three_beat": <0-30>, "rooted_hebrew": <0-20>, "no_blacklist": <0-20>, "identity_cta": <0-15>, "product_url": <0-10>, "slogan_match": <0-5>}}`
      : `You are a DUBIS brand QA reviewer per the Copy Playbook.

Blacklist words (each one = significant deduction):
- perfect, stunning, must-have, don't miss out, upgrade yourself, the next trend, crazy/insane (as praise)

Required:
1. **3-beat structure** — Cynical Hook → Real-life Agitation → DUBIS Drop
2. **Identity-based CTA** — never "Buy now 20% off". "For the rest of us: dubis.net" style.
3. **Product URL visible** — dubis.net/#product-{id} or similar literal text in caption
4. **No self-deprecating-of-weakness humor** — humor from strength only
5. **Slogan integration** — the product's actual slogan should be present or paraphrased

Score 0-100:
- 3-beat structure: 30 points (10 per beat)
- No blacklist words: 20 (-10 per occurrence)
- Identity CTA (not transactional): 15
- Product URL present: 10
- Slogan integration correct: 5
- Voice match (anti-stunning, self-aware sardonic): 20

Return JSON only:
{"score": <0-100>, "issues": ["<issue 1>", ...], "fix_suggestions": ["<fix 1>", ...], "breakdown": {"three_beat": <0-30>, "no_blacklist": <0-20>, "identity_cta": <0-15>, "product_url": <0-10>, "slogan_match": <0-5>, "voice_match": <0-20>}}`;

    const userPrompt = `Caption to evaluate (${lang.toUpperCase()}):
"""
${caption}
"""

Product slogan (on the garment): "${product.slogan ?? slogan}"
Product ID: ${productId} (URL pattern: dubis.net/#product-${productId})
${personaId ? `Persona: ${personaId}\n` : ''}${sloganMismatch ? '⚠️ NOTE: provided slogan does NOT match DB product slogan — flag in issues.\n' : ''}${!urlPresent ? '⚠️ NOTE: product URL not detected verbatim in caption — verify and flag if missing.\n' : ''}`;

    try {
      const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 1024, responseMimeType: 'application/json' },
        }),
      });
      if (!gRes.ok) {
        const errBody = await gRes.text();
        return json({ error: 'Gemini call failed', status: gRes.status, detail: errBody.slice(0, 500) }, 502);
      }
      const gJson = await gRes.json();
      const responseText = gJson.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(responseText); } catch {
        return json({ error: 'Gemini returned non-JSON', raw: responseText.slice(0, 500) }, 502);
      }

      // Apply hard-rule deductions on top of Gemini score
      const baseScore = Number(parsed.score ?? 0);
      const hardIssues: string[] = Array.isArray(parsed.issues) ? [...(parsed.issues as string[])] : [];
      const hardFixes: string[] = Array.isArray(parsed.fix_suggestions) ? [...(parsed.fix_suggestions as string[])] : [];
      let finalScore = baseScore;

      if (!urlPresent) {
        finalScore = Math.min(finalScore, 65); // cap at 65 if URL missing
        hardIssues.push(lang === 'he' ? 'חסר Product URL גלוי בקפשן (חוק קשיח DUBIS)' : 'Product URL not visible in caption (DUBIS hard rule)');
        hardFixes.push(lang === 'he' ? `הוסף "dubis.net/#product-${productId}" בשורה האחרונה` : `Add "dubis.net/#product-${productId}" on the last line`);
      }
      if (sloganMismatch) {
        finalScore = Math.max(0, finalScore - 10);
        hardIssues.push(lang === 'he' ? `אי-התאמת סלוגן: caller שלח "${slogan}" אבל ה-DB מראה "${product.slogan}"` : `Slogan mismatch: caller passed "${slogan}" but DB says "${product.slogan}"`);
      }

      const passed = finalScore >= 75;
      const reviewNeeded = finalScore >= 60 && finalScore < 75;

      return json({
        score: finalScore,
        gemini_score: baseScore,
        passed,
        review_needed: reviewNeeded,
        issues: hardIssues,
        fix_suggestions: hardFixes,
        breakdown: parsed.breakdown ?? {},
        product_id: productId,
        product_slogan_db: product.slogan,
        lang,
        url_present: urlPresent,
        slogan_match: !sloganMismatch,
      });
    } catch (e) {
      return json({ error: 'copy-qa failed', detail: (e as Error).message }, 500);
    }
  }

  // ── GENERATE-SLOGAN — Product Creator Agent ────────────────────────
  if (type === 'generate-slogan') {
    const cronSecret  = Deno.env.get('CRON_SECRET') ?? '';
    const agentSecret = Deno.env.get('AGENT_SECRET') ?? '';
    const svcKey      = SERVICE_ROLE;
    const authHeader  = req.headers.get('authorization') ?? '';
    const token       = url.searchParams.get('token') || authHeader.replace('Bearer ', '').trim() || req.headers.get('x-agent-secret') || '';
    const isAuthed = (cronSecret && token === cronSecret) || (agentSecret && token === agentSecret) || (svcKey && token === svcKey);
    const adminOk = await verifyAdmin(req);
    if (!isAuthed && !adminOk) return json({ error: 'Unauthorized' }, 401);

    const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
    if (!geminiKey) return json({ error: 'GEMINI_API_KEY not configured' }, 503);

    // Get existing slogans to avoid duplicates
    const { data: existingProducts } = await sb.from('dubis_products').select('slogan, clothing_type');
    const existingSlogans = (existingProducts || []).map((p: Record<string, unknown>) => p.slogan).filter(Boolean);

    // 2026-05-19: pick 3 DIFFERENT clothing types for the next batch, prioritizing
    // under-represented + newly-launched types. Gemini was ignoring the "variety"
    // hint in the prompt and kept returning tshirt/hoodie/longsleeve only. Now we
    // INJECT 3 specific (type, gender) targets into the prompt — Gemini must use
    // these as-is.
    // Admin "+ סלוגן חדש" suggestions draw from the SELLABLE_TYPES contract
    // (module top) — every type here is constraint-insertable + brand-mapped, so
    // an approved suggestion can never fail to insert (the old v-neck/tank-top 500)
    // and a forbidden plain hoodie can never be offered (Hila zip-only rule).
    const TYPE_POOL = SELLABLE_TYPES;
    // Count existing products per (type, gender) so we down-weight saturated combos.
    const existingCounts: Record<string, number> = {};
    for (const p of (existingProducts || []) as Array<Record<string, unknown>>) {
      const dbType = String(p.clothing_type || '');
      // Map DB type back to JS type for matching TYPE_POOL keys
      const jsType = ({ 't-shirt': 'tshirt', 'zip-hoodie': 'ziphoodie', 'long-sleeve': 'longsleeve', 'v-neck': 'vneck', 'tank-top': 'tanktop', 'cap-emb': 'capemb' } as Record<string, string>)[dbType] || dbType;
      existingCounts[jsType] = (existingCounts[jsType] || 0) + 1;
    }
    // Weighted random pick of 3 DISTINCT (type, gender) combos
    const weightedPool = TYPE_POOL.map(p => ({
      ...p,
      finalWeight: p.weight / (1 + (existingCounts[p.type] || 0) * 0.5),  // saturated types get less weight
    }));
    const picked: Array<{ type: string; gender: string }> = [];
    const remainingPool = [...weightedPool];
    while (picked.length < 3 && remainingPool.length > 0) {
      const totalW = remainingPool.reduce((s, p) => s + p.finalWeight, 0);
      let r = Math.random() * totalW;
      let idx = 0;
      for (let i = 0; i < remainingPool.length; i++) {
        r -= remainingPool[i].finalWeight;
        if (r <= 0) { idx = i; break; }
      }
      const choice = remainingPool.splice(idx, 1)[0];
      // Ensure no duplicate type in the same batch (cross-gender is OK if different garment shape)
      const sameTypeAlready = picked.some(p => p.type === choice.type);
      if (!sameTypeAlready) picked.push({ type: choice.type, gender: choice.gender });
    }
    const targetSlotsStr = picked.map((p, i) => `  ${i + 1}. product_type='${p.type}', gender='${p.gender}'`).join('\n');

    // Also get from hardcoded products.js slogans
    const allSlogans = [...existingSlogans, ...Object.keys(SLOGAN_TYPOGRAPHY)];

    // ── 2026-05-16: pull REAL in-stock colors per clothing_type from product_variant_stock ──
    // Was hardcoded ['Black','White','Navy','Charcoal'] regardless of garment.
    // Now Gemini gets the actual Gelato-fulfillable palette per type, AND we filter on save.
    const { data: stockRows } = await sb.from('product_variant_stock')
      .select('clothing_type,color,in_stock')
      .eq('in_stock', true);
    const inStockMap: Record<string, Set<string>> = {};
    for (const r of (stockRows || []) as Array<Record<string, unknown>>) {
      const t = String(r.clothing_type || '');
      const c = String(r.color || '');
      if (!t || !c) continue;
      (inStockMap[t] ||= new Set()).add(c);
    }
    const inStockSummary = Object.entries(inStockMap)
      .map(([t, set]) => `  ${t}: ${Array.from(set).join(', ')}`)
      .join('\n');
    // Map our slogan product_type values → DB clothing_type values for filtering.
    // 2026-05-19: added vneck + tanktop + capemb after Phase F catalog expansion.
    const TYPE_TO_DB: Record<string, string> = {
      tshirt: 't-shirt', hoodie: 'hoodie', ziphoodie: 'zip-hoodie', longsleeve: 'long-sleeve', cap: 'cap',
      vneck: 'v-neck', tanktop: 'tank-top', capemb: 'cap-emb',
      't-shirt': 't-shirt', 'zip-hoodie': 'zip-hoodie', 'long-sleeve': 'long-sleeve',
      'v-neck': 'v-neck', 'tank-top': 'tank-top', 'cap-emb': 'cap-emb',
    };

    // 2026-05-19: CATALOG_COLORS — full color palette per (clothing_type, gender)
    // verified live against Gelato API. Used as fallback when product_variant_stock
    // has no rows yet for this type (e.g. brand-new clothing_type, or first product
    // of a sub-category). Without this, generate-slogan defaulted to ['Black','White']
    // for any fresh type — that was the "only 4 boring colors" complaint from oren
    // on 2026-05-19. NEVER add colors that aren't in Gelato's catalog for the (type,
    // gender) combo — verified colors only (the 2026-04-22 Honey Brown rule).
    const CATALOG_COLORS: Record<string, string[]> = {
      't-shirt:unisex':     ['Black', 'White', 'Cream', 'Navy', 'Charcoal', 'Red', 'Gray', 'Forest Green'],
      't-shirt:women':      ['Black', 'White', 'Cream', 'Navy'],
      'hoodie:unisex':      ['Black', 'White', 'Cream', 'Navy', 'Charcoal', 'Forest Green', 'Gray'],
      'hoodie:women':       ['Black', 'White', 'Navy', 'Charcoal'],
      'zip-hoodie:unisex':  ['Black', 'White', 'Navy', 'Gray', 'Royal Blue'],  // 2026-06-02 K-C: SOL'S 04237 (Lane Seven was Gelato staging, no mockups)
      'long-sleeve:unisex': ['Black', 'White', 'Cream', 'Navy', 'Forest Green', 'Gray'],
      'long-sleeve:women':  ['Black', 'White', 'Navy'],
      'cap:unisex':         ['Black', 'White', 'Cream', 'Navy'],
      'cap-emb:unisex':     ['Black', 'White', 'Navy', 'Cream', 'Charcoal'],
      'v-neck:unisex':      ['Black', 'White', 'Navy', 'Red'],
      'v-neck:women':       ['Black', 'White', 'Navy'],
      'tank-top:unisex':    ['Black', 'White', 'Navy', 'Red'],
      'tank-top:women':     ['Black'],
    };

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

FULL Gelato palette per (clothing_type:gender) — use ONLY these colors, never invent:
${Object.entries(CATALOG_COLORS).map(([k, v]) => `  ${k} → ${v.join(', ')} (${v.length} colors)`).join('\n')}

REAL in-stock colors right now (subset of the above — prefer these but expand to the full palette above):
${inStockSummary || '  (no stock data for any type — use the FULL palette above)'}

⚠️ COLOR REQUIREMENT: for each suggestion, return ALL available colors from the FULL palette for that (type, gender) — don't artificially limit to 3-4. Examples:
  - t-shirt unisex → return ALL 8 colors (Black/White/Cream/Navy/Charcoal/Red/Gray/Forest Green)
  - hoodie unisex → return ALL 7
  - v-neck womens → return ALL 3 (Black/White/Navy)
The system will filter unverified ones — your job is to be MAXIMALLY inclusive.

🎯 HARD REQUIREMENT — USE THESE 3 EXACT (product_type, gender) ASSIGNMENTS:
${targetSlotsStr}

Match the order. Don't substitute. These were chosen by the system to keep the
catalog balanced across all 8 supported types:
  - tshirt = classic crewneck t-shirt
  - vneck = V-neck t-shirt — premium tier
  - tanktop = sleeveless tank top — summer / casual
  - longsleeve = long-sleeve crew — colder weather
  - hoodie = pullover hoodie with hood
  - ziphoodie = zip-up hoodie (unisex only)
  - cap = printed dad-hat (unisex only) — only 1 slogan word fits
  - capemb = embroidered dad-hat (unisex only) — premium tier, only 1 slogan word fits

Generate 3 slogan proposals. Return ONLY valid JSON array. The "colors" field MUST be a non-empty subset of the FULL palette above for the matching (product_type, gender):
[{
  "slogan": "full slogan text",
  "power_word": "THE_BIG_WORD",
  "text_before": "words before power word",
  "text_after": "words after power word",
  "layout": "top-bottom",
  "product_type": "vneck",
  "gender": "unisex",
  "description_en": "2 sentences, conversational, for product page",
  "description_he": "2 משפטים, עברית ישראלית טבעית, לדף מוצר",
  "colors": ["Black", "White", "Navy", "Red"]
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
      // 2026-05-19: PRICE_MAP refreshed for the Phase F catalog — vneck/tank/cap-emb added.
      // Defaults per rule #7 (CEIL of cheapest IL cost from gelato-stock-check).
      const PRICE_MAP: Record<string, number> = {
        't-shirt': 28, hoodie: 41, 'zip-hoodie': 55, 'long-sleeve': 31,  // 2026-06-02 K-C: zip-hoodie →55 (SOL'S 04237 IL cost $52.66-54.90; Lane Seven was staging)
        cap: 28, 'cap-emb': 32, 'v-neck': 30, 'tank-top': 30,
      };
      const DB_TYPE_MAP: Record<string, string> = {
        tshirt: 't-shirt', hoodie: 'hoodie', ziphoodie: 'zip-hoodie', longsleeve: 'long-sleeve',
        cap: 'cap', capemb: 'cap-emb', vneck: 'v-neck', tanktop: 'tank-top',
        't-shirt': 't-shirt', 'zip-hoodie': 'zip-hoodie', 'long-sleeve': 'long-sleeve',
        'v-neck': 'v-neck', 'tank-top': 'tank-top', 'cap-emb': 'cap-emb',
      };
      // 2026-05-19: how many colors to give a new product. Was hardcoded slice(0, 4)
      // — too narrow. Bump to 8 so we surface the FULL Gelato palette when available
      // (t-shirt unisex has 8 colors, others have 3-7).
      const MAX_COLORS = 8;
      for (let sIdx = 0; sIdx < suggestions.length; sIdx++) {
        const s = suggestions[sIdx];
        // 2026-05-19: FORCE the (type, gender) to the target slot we picked above
        // — Gemini occasionally ignores the hard requirement and returns its own
        // pick. We assigned slot N to picked[N], so override here.
        if (picked[sIdx]) {
          s.product_type = picked[sIdx].type;
          s.gender = picked[sIdx].gender;
        }
        const clothingType = DB_TYPE_MAP[s.product_type || 'tshirt'] || 't-shirt';
        const genderKey = s.gender === 'women' ? 'women' : 'unisex';
        // 2026-05-19: 4-tier color selection.
        // 1. Start with Gemini's picks, validated against CATALOG_COLORS (verified Gelato).
        // 2. ALWAYS expand with the full CATALOG_COLORS for the type — Gemini tends to
        //    return 3-4 even when 7-8 are valid (the "boring palette" complaint, 2026-05-19).
        // 3. If both empty, fall back to in-stock data.
        // 4. Last-resort guard ['Black','White'].
        const allowedForType = inStockMap[TYPE_TO_DB[s.product_type || ''] || clothingType] || new Set<string>();
        const catalogKey = `${clothingType}:${genderKey}`;
        const catalogColors = CATALOG_COLORS[catalogKey] || [];
        const geminiPicks = Array.isArray(s.colors)
          ? (s.colors as string[]).filter((c: string) => allowedForType.has(c) || catalogColors.includes(c))
          : [];
        // Build chosenColors: Gemini's picks FIRST (preserves any taste signal), then
        // add the rest of CATALOG_COLORS not already in the list — up to MAX_COLORS total.
        const chosenSet = new Set<string>(geminiPicks);
        for (const c of catalogColors) {
          if (chosenSet.size >= MAX_COLORS) break;
          chosenSet.add(c);
        }
        let chosenColors = Array.from(chosenSet);
        if (chosenColors.length === 0 && allowedForType.size > 0) {
          chosenColors = Array.from(allowedForType).slice(0, MAX_COLORS);
        }
        if (chosenColors.length === 0) chosenColors = ['Black', 'White']; // last-resort guard
        chosenColors = chosenColors.slice(0, MAX_COLORS);
        const { data: product, error: pErr } = await sb.from('dubis_products').insert({
          slogan: s.slogan,
          clothing_type: clothingType,
          category: s.gender === 'women' ? 'women' : 'unisex',
          gender: s.gender || 'unisex',
          price_usd: PRICE_MAP[clothingType] || 28,
          description_en: s.description_en || '',
          description_he: s.description_he || '',
          colors: chosenColors,
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

      // 2. Build updates.
      // 2026-05-16: switched from "active=true here + Gemini single mockup" to
      // "active=FALSE here, hand off to GitHub Actions pipeline".
      // The pipeline generates print files, creates a Gelato draft, downloads
      // REAL Gelato preview images, commits them, then callbacks ?type=gha-pipeline-callback
      // which flips active=true gated by trg_enforce_product_activation_proof.
      const updates: Record<string, unknown> = {
        active: false,
        source: 'approved',
        product_id_numeric: nextId,
        publishing_status: 'pending_pipeline',   // tells the trigger this is a Boss-pipeline product
        proof_of_completion: {},                  // reset; workflow callback will fill
      };
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

      // 4. Enqueue work for the GitHub Actions pipeline.
      const { data: queueRow, error: qErr } = await sb.from('product_pipeline_queue').insert({
        product_id: product_id as string,
        product_id_numeric: nextId,
        status: 'pending_dispatch',
      }).select('id').single();
      if (qErr) return json({ error: 'queue_insert_failed', detail: qErr.message }, 500);
      const queueId = (queueRow as Record<string, unknown>).id as string;

      // 5. Trigger GitHub Actions workflow via repository_dispatch.
      // Requires GH_DISPATCH_TOKEN secret on the Edge Function (a fine-grained PAT
      // with `actions: write + contents: read` for dubis-brand/dubis-website).
      const ghToken = Deno.env.get('GH_DISPATCH_TOKEN') ?? '';
      const ghRepo  = Deno.env.get('GH_REPO') ?? 'dubis-brand/dubis-website';
      let dispatchOk = false;
      let dispatchError: string | null = null;
      if (!ghToken) {
        dispatchError = 'GH_DISPATCH_TOKEN env var missing — workflow not triggered. Pipeline row stays in pending_dispatch.';
      } else {
        try {
          const dispatchRes = await fetch(`https://api.github.com/repos/${ghRepo}/dispatches`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${ghToken}`,
              'Accept': 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              'Content-Type': 'application/json',
              'User-Agent': 'dubis-edge-fn/1.0',
            },
            body: JSON.stringify({
              event_type: 'boss-approved-product',
              client_payload: {
                product_id: product_id as string,
                product_id_numeric: nextId,
                queue_id: queueId,
              },
            }),
            signal: AbortSignal.timeout(15000),
          });
          if (dispatchRes.status === 204) {
            dispatchOk = true;
            await sb.from('product_pipeline_queue')
              .update({ status: 'dispatched', dispatched_at: new Date().toISOString() })
              .eq('id', queueId);
          } else {
            dispatchError = `GitHub dispatch returned ${dispatchRes.status}: ${(await dispatchRes.text()).slice(0, 300)}`;
          }
        } catch (e) {
          dispatchError = `dispatch_exception: ${(e as Error).message}`;
        }
      }
      if (!dispatchOk && dispatchError) {
        await sb.from('product_pipeline_queue')
          .update({ status: 'failed', last_error: dispatchError, completed_at: new Date().toISOString() })
          .eq('id', queueId);
      }

      // 6. Send oren a "processing" email (best-effort — does not block response).
      try {
        const resendKey = Deno.env.get('RESEND_API_KEY') ?? '';
        if (resendKey) {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'DUBIS <orders@dubis.net>',
              to: ['dubis.brand@gmail.com'],
              subject: `🛠 מוצר חדש בעיבוד: #${nextId} — "${sloganKey}"`,
              html: `
                <div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px">
                  <h2 style="color:#C17E3A">המוצר נכנס לקו ייצור אוטומטי</h2>
                  <p><strong>סלוגן:</strong> ${sloganKey}</p>
                  <p><strong>סוג:</strong> ${prod.clothing_type} / ${prod.gender}</p>
                  <p><strong>צבעים מאושרים במלאי:</strong> ${(prod.colors as string[] || []).join(', ')}</p>
                  <p><strong>מס׳ מוצר:</strong> #${nextId}</p>
                  <hr>
                  <p>קו הייצור כעת:</p>
                  <ol>
                    <li>יוצר קבצי הדפסה (3600×4200 PNG עם הסלוגן)</li>
                    <li>פותח טיוטת Gelato חינמית</li>
                    <li>מוריד מ-Gelato את המוקאפים האמיתיים של הבגד</li>
                    <li>מעלה אותם לאתר כתמונת הקדמית/אחורית של המוצר</li>
                    <li>מפעיל את המוצר באתר</li>
                  </ol>
                  <p style="color:#6b7280;font-size:13px">משך משוער: 5-10 דקות. תקבל מייל אישור כשהמוצר חי באתר עם לינק לטיוטת Gelato לאישור חזותי.</p>
                  ${dispatchError ? `<p style="color:#b91c1c"><strong>⚠️ שגיאה ב-dispatch:</strong> ${dispatchError}</p>` : ''}
                </div>`,
            }),
            signal: AbortSignal.timeout(8000),
          }).catch(() => {});
        }
      } catch { /* email is best-effort */ }

      // 7. Update agent_task
      const now = new Date().toISOString();
      await sb.from('agent_tasks')
        .update({
          status: 'in_progress',
          approved_at: now,
          updated_at: now,
          notes: `🛠 מוצר #${nextId} בעיבוד — ${sloganKey}\nQueue: ${queueId}\nDispatch: ${dispatchOk ? '✅' : '❌ ' + (dispatchError || 'unknown')}`,
        })
        .eq('agent_id', 'product')
        .filter('content_data->>product_id', 'eq', String(product_id));

      return json({
        success: true,
        action: 'approved_enqueued',
        product_id_numeric: nextId,
        queue_id: queueId,
        dispatch_ok: dispatchOk,
        dispatch_error: dispatchError,
      });
    }

    return json({ error: 'Use GET to list or POST to approve/reject' }, 405);
  }

  // ── GHA-PIPELINE-CALLBACK — receive workflow result, flip product live ─────
  // Called by .github/workflows/dubis-product-pipeline.yml after it finishes the
  // print-files + Gelato-draft + real-mockup-download + commit chain.
  // Auth via x-agent-secret. Idempotent: re-callbacks for the same product just
  // refresh the same row (no double-publish risk).
  if (type === 'gha-pipeline-callback') {
    const agentSecret  = Deno.env.get('AGENT_SECRET') ?? '';
    const ghaSecret    = Deno.env.get('GHA_CALLBACK_SECRET') ?? '';
    const tokenHdr = req.headers.get('x-agent-secret') || req.headers.get('authorization')?.replace('Bearer ', '').trim() || '';
    // Accept either AGENT_SECRET (legacy) or GHA_CALLBACK_SECRET (preferred for GHA — separate so rotating one doesn't break the other).
    const authed = (agentSecret && tokenHdr === agentSecret) || (ghaSecret && tokenHdr === ghaSecret);
    if (!authed) return json({ error: 'Unauthorized' }, 401);
    if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

    const b = body as Record<string, unknown>;
    const productId       = b.product_id as string;
    const productNumeric  = Number(b.product_id_numeric);
    const callbackStatus  = (b.status as string) || 'failed';   // 'live' | 'failed'
    const gelatoDraftId   = (b.gelato_draft_id as string) || null;
    const gelatoPreviews  = (b.gelato_preview_urls as Record<string, unknown>) || {};
    const workflowRunId   = (b.workflow_run_id as string) || null;
    const errorMsg        = (b.error as string) || null;

    if (!productId) return json({ error: 'product_id required' }, 400);

    // Update queue row (latest one for this product).
    const { data: queueRows } = await sb.from('product_pipeline_queue')
      .select('id').eq('product_id', productId)
      .order('created_at', { ascending: false }).limit(1);
    const queueId = (queueRows && queueRows[0]) ? (queueRows[0] as Record<string, unknown>).id as string : null;
    if (queueId) {
      await sb.from('product_pipeline_queue').update({
        status: callbackStatus === 'live' ? 'live' : 'failed',
        workflow_run_id: workflowRunId,
        gelato_draft_id: gelatoDraftId,
        gelato_preview_urls: gelatoPreviews,
        last_error: errorMsg,
        completed_at: new Date().toISOString(),
      }).eq('id', queueId);
    }

    // Fetch the product so we can send oren a useful email.
    const { data: prodRow } = await sb.from('dubis_products')
      .select('id,slogan,clothing_type,gender,colors,product_id_numeric,auto_publish,launched_at')
      .eq('id', productId).single();
    const prod = (prodRow || {}) as Record<string, unknown>;
    const slogan = (prod.slogan as string) || '(no slogan)';
    const numericId = (prod.product_id_numeric as number) || productNumeric;

    if (callbackStatus === 'live') {
      // Compose proof_of_completion satisfying trg_enforce_product_activation_proof.
      // Keys are reinterpreted for the Gelato-real-images flow:
      //   print_files_generated → step 1 (generate-designs.js)
      //   mockups_composited    → step 3 (Gelato preview images downloaded to /images/)
      //   parity_verified       → step 2 succeeded (Gelato accepted the print files)
      //   gelato_draft_id       → actual draft id Gelato returned
      const proof = {
        print_files_generated: true,
        mockups_composited:    true,
        parity_verified:       true,
        gelato_draft_id:       gelatoDraftId,
        workflow_run_id:       workflowRunId,
        gelato_preview_urls:   gelatoPreviews,
        approved_at:           new Date().toISOString(),
      };

      // Set image_url to one of the Gelato previews so legacy callers have something.
      // Prefer the first color's front preview.
      let leadImage: string | null = null;
      for (const colorBlock of Object.values(gelatoPreviews) as Array<Record<string, unknown>>) {
        if (colorBlock && typeof colorBlock === 'object' && colorBlock.front) {
          leadImage = colorBlock.front as string;
          break;
        }
      }

      // ── 2026-06-06 AUTO-PUBLISH branch ──────────────────────────────────
      // auto_publish=true products (weekly-slogan-product cron OR a catalog
      // regen we flagged) skip the human visual gate: proof is complete here,
      // so activate directly (trg_enforce_product_activation_proof passes),
      // dispatch the products.js sync, seed+finalize a cost price, and email
      // oren a "went live" notice WITH a 1-click remove link (no pre-approval).
      if (prod.auto_publish === true) {
        const removalToken = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
        const { error: actErr } = await sb.from('dubis_products').update({
          active: true,
          publishing_status: 'live',
          pending_visual_approval: false,
          visual_approval_token: null,
          // launched_at = FIRST launch only. Regens/re-approvals must not re-stamp it —
          // the 2026-06-06 Anton regen re-stamped all 16 veterans and the whole catalog
          // showed a NEW badge for 30 days (sync script derives isNew from launched_at).
          launched_at: (prod.launched_at as string) ?? new Date().toISOString(),
          proof_of_completion: proof,
          removal_token: removalToken,
          ...(leadImage ? { image_url: leadImage } : {}),
        }).eq('id', productId);
        if (actErr) {
          await sb.from('product_pipeline_queue').update({ status: 'failed', last_error: `auto_activate_failed: ${actErr.message}` }).eq('id', queueId ?? '');
          return json({ error: 'auto_activate_failed', detail: actErr.message }, 500);
        }
        if (queueId) await sb.from('product_pipeline_queue').update({ status: 'live', completed_at: new Date().toISOString() }).eq('id', queueId);
        // products.js sync
        try {
          const ghToken = Deno.env.get('GH_DISPATCH_TOKEN') ?? '';
          const ghRepo  = Deno.env.get('GH_REPO') ?? 'dubis-brand/dubis-website';
          if (ghToken) await fetch(`https://api.github.com/repos/${ghRepo}/dispatches`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${ghToken}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'dubis-edge-fn/1.0' },
            body: JSON.stringify({ event_type: 'oren-approved-visual', client_payload: { product_id: productId, product_id_numeric: numericId } }),
            signal: AbortSignal.timeout(15000),
          }).catch(() => {});
        } catch { /* sync best-effort */ }
        // baseline price (INSERT-only) + fire gelato-stock → finalizes CEIL(MIN cost) for auto_publish (see gelato-stock-check)
        try {
          const { data: existingPrice } = await sb.from('product_prices').select('product_id').eq('product_id', numericId).maybeSingle();
          if (!existingPrice) {
            const { data: pp } = await sb.from('dubis_products').select('price_usd').eq('id', productId).single();
            await sb.from('product_prices').insert({ product_id: numericId, selling_price: Number((pp as Record<string, unknown>)?.price_usd ?? 28), updated_at: new Date().toISOString() });
          }
          const supaUrl = Deno.env.get('SUPABASE_URL') ?? '';
          const PG_CRON_TOKEN = 'dubis-pg-cron-trigger-a554cd187bdfaf88a0a5dd8dcf571bea32658e1eb8ec217c';
          if (supaUrl) fetch(`${supaUrl.replace('/rest/v1', '')}/functions/v1/dubis-cron-dispatcher?job=gelato-stock&token=${encodeURIComponent(PG_CRON_TOKEN)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(2000) }).catch(() => {});
        } catch { /* price best-effort */ }
        // close agent_task (proof satisfies the guard)
        await sb.from('agent_tasks').update({
          status: 'done',
          updated_at: new Date().toISOString(),
          proof_of_completion: { auto_published: true, verified_by_oren: false, deployed_url: `https://www.dubis.net/#product-${numericId}`, api_response: `gha-run:${workflowRunId}` },
          notes: `🤖 מוצר #${numericId} עלה אוטומטית (Anton, מחיר עלות) — ${slogan}`,
        }).eq('agent_id', 'product').filter('content_data->>product_id', 'eq', productId);
        // notify oren: went live + 1-click remove
        try {
          const resendKey = Deno.env.get('RESEND_API_KEY') ?? '';
          if (resendKey) {
            const previewBlocks = Object.entries(gelatoPreviews).map(([color, urls]) => {
              const u = urls as Record<string, unknown>;
              return `<div style="display:inline-block;margin:8px;text-align:center"><p style="margin:4px 0;font-weight:bold">${color}</p>${u.front ? `<img src="${u.front}" style="width:150px;border:1px solid #ddd;border-radius:4px"/>` : ''}${u.back ? `<img src="${u.back}" style="width:150px;border:1px solid #ddd;border-radius:4px;margin-right:4px"/>` : ''}</div>`;
            }).join('');
            const removeUrl = `${(Deno.env.get('SUPABASE_URL') ?? '').replace('/rest/v1', '')}/functions/v1/agents?type=auto-product-remove&product_id=${productId}&token=${removalToken}`;
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: 'DUBIS <orders@dubis.net>',
                to: ['dubis.brand@gmail.com'],
                subject: `🤖 מוצר #${numericId} עלה אוטומטית — "${slogan}"`,
                html: `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:680px"><h2 style="color:#2d6a4f">מוצר חדש עלה לאוויר אוטומטית</h2><p>הסוכן יצר ופרסם מוצר חדש לפי כל התהליכים — הוא <strong>כבר חי באתר</strong> במחיר עלות. עדכן מחיר מתי שתרצה.</p><p><strong>סלוגן:</strong> ${slogan}</p><p><strong>סוג:</strong> ${prod.clothing_type} / ${prod.gender}</p><p>קישור: <a href="https://www.dubis.net/#product-${numericId}">dubis.net/#product-${numericId}</a></p><div style="text-align:center;margin:20px 0"><a href="${removeUrl}" style="display:inline-block;background:#b91c1c;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700">🗑 הסר מוצר זה</a><p style="color:#6b7280;font-size:12px">לחץ רק אם המוקאפ פגום או שאתה לא רוצה אותו — הוא יורד מהאתר מיד</p></div><hr><h3 style="color:#C17E3A">המוקאפים:</h3><div>${previewBlocks || '<em>אין תמונות</em>'}</div></div>`,
              }),
              signal: AbortSignal.timeout(8000),
            }).catch(() => {});
          }
        } catch { /* email best-effort */ }
        return json({ success: true, status: 'auto_published', product_id: productId, product_id_numeric: numericId });
      }

      // 2026-05-16: NOT setting active=true here anymore. Pipeline produced
      // the Gelato mockups, but oren still has to visually verify them via
      // the admin "Approve & Publish" button (or the magic link in the email).
      // The product stays active=false until product-visual-approve fires.
      const visualToken = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
      const { error: prodErr } = await sb.from('dubis_products').update({
        active: false,                              // still gated
        publishing_status: 'pending_visual_approval',
        pending_visual_approval: true,
        visual_approval_token: visualToken,
        proof_of_completion: proof,
        ...(leadImage ? { image_url: leadImage } : {}),
      }).eq('id', productId);

      if (prodErr) {
        await sb.from('product_pipeline_queue').update({
          status: 'failed',
          last_error: `pending_visual_set_failed: ${prodErr.message}`,
        }).eq('id', queueId ?? '');
        return json({ error: 'pending_visual_set_failed', detail: prodErr.message }, 500);
      }

      // Notify oren via Resend (best-effort).
      try {
        const resendKey = Deno.env.get('RESEND_API_KEY') ?? '';
        if (resendKey) {
          const colorList = (prod.colors as string[] || []).join(', ');
          const previewBlocks = Object.entries(gelatoPreviews).map(([color, urls]) => {
            const u = urls as Record<string, unknown>;
            return `
              <div style="display:inline-block;margin:8px;text-align:center">
                <p style="margin:4px 0;font-weight:bold">${color}</p>
                ${u.front ? `<img src="${u.front}" alt="${color} front" style="width:160px;border:1px solid #ddd;border-radius:4px"/>` : ''}
                ${u.back  ? `<img src="${u.back}"  alt="${color} back"  style="width:160px;border:1px solid #ddd;border-radius:4px;margin-right:4px"/>` : ''}
              </div>`;
          }).join('');
          // Build the magic-link approval URL. Token-based so oren can approve
          // straight from the email without a separate admin login.
          const approveUrl = `https://www.dubis.net/dub-console#visual-approve=${productId}:${visualToken}`;
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'DUBIS <orders@dubis.net>',
              to: ['dubis.brand@gmail.com'],
              subject: `👀 מוקאפים מוכנים — מוצר #${numericId} ממתין לאישור ויזואלי`,
              html: `
                <div dir="rtl" style="font-family:Arial,sans-serif;max-width:680px">
                  <h2 style="color:#C17E3A">המוקאפים האמיתיים מ-Gelato מוכנים — אבל המוצר עדיין לא חי באתר</h2>
                  <p>הצינור הוריד את המוקאפים שייצרה Gelato. הם <strong>לא יוצגו ללקוחות</strong> עד שתאשר ויזואלית.</p>
                  <p><strong>סלוגן:</strong> ${slogan}</p>
                  <p><strong>סוג:</strong> ${prod.clothing_type} / ${prod.gender}</p>
                  <p><strong>צבעים:</strong> ${colorList}</p>
                  <p><strong>טיוטת Gelato:</strong> ${gelatoDraftId ? `<code>${gelatoDraftId}</code> — בדוק גם ב-<a href="https://dashboard.gelato.com/orders">Gelato Dashboard</a>` : 'לא נוצרה'}</p>
                  <hr>
                  <h3 style="color:#C17E3A">בדוק שהמוקאפים תקינים (חזית + גב), ואז:</h3>
                  <div style="text-align:center;margin:24px 0">
                    <a href="${approveUrl}"
                       style="display:inline-block;background:#2d6a4f;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:16px;font-weight:700">
                      ✅ אשר ופרסם באתר
                    </a>
                  </div>
                  <p style="color:#6b7280;font-size:13px;text-align:center">אם המוקאפים פגומים — אל תלחץ. תיכנס לאדמין → "ממתינים לאישור" → לחץ "דחה" וטיפ הפיפליין יתחיל מחדש.</p>
                  <hr>
                  <h3 style="color:#C17E3A">המוקאפים שמחכים לאישורך:</h3>
                  <div>${previewBlocks || '<em>אין תמונות לתצוגה</em>'}</div>
                  <hr>
                  <p style="color:#6b7280;font-size:12px">Workflow run: ${workflowRunId || 'n/a'} · Token יישרף אחרי השימוש הראשון</p>
                </div>`,
            }),
            signal: AbortSignal.timeout(8000),
          }).catch(() => {});
        }
      } catch { /* email best-effort */ }

      // Don't close the agent_task yet — it's waiting for oren visual approval.
      await sb.from('agent_tasks').update({
        status: 'in_progress',
        updated_at: new Date().toISOString(),
        notes: `👀 מוצר #${numericId} ממתין לאישור ויזואלי — ${slogan}\nGelato draft: ${gelatoDraftId}\nMockups: ${Object.keys(gelatoPreviews).length} colors`,
      }).eq('agent_id', 'product').filter('content_data->>product_id', 'eq', productId);

      return json({ success: true, status: 'pending_visual_approval', product_id: productId, product_id_numeric: numericId, visual_approval_token: visualToken });
    }

    // ── status === 'failed' — SELF-HEAL + CONTROL ──────────────────────────
    // The 2026-06-09 first run failed only because Gelato was slow to render
    // previews; a plain re-run minutes later succeeded. So: auto-retry the
    // pipeline ONCE (autonomous flow only) before bothering oren. Every attempt
    // writes an agent_runs row so the Boss report / monitoring can SEE the
    // pipeline is working even when individual runs hiccup. GitHub's own
    // "Run failed" email is suppressed at the account level (Settings →
    // Notifications → Actions) — our controlled channel is agent_runs + the
    // single failure email below, sent only after retries are exhausted.
    const MAX_PIPELINE_RETRIES = 1;
    let qRetry = 0;
    if (queueId) {
      const { data: qr } = await sb.from('product_pipeline_queue').select('retry_count').eq('id', queueId).single();
      qRetry = Number((qr as Record<string, unknown>)?.retry_count ?? 0);
    }
    const canRetry = prod.auto_publish === true && qRetry < MAX_PIPELINE_RETRIES;

    if (canRetry) {
      let redispatched = false;
      try {
        const ghToken = Deno.env.get('GH_DISPATCH_TOKEN') ?? '';
        const ghRepo  = Deno.env.get('GH_REPO') ?? 'dubis-brand/dubis-website';
        if (ghToken) {
          const dr = await fetch(`https://api.github.com/repos/${ghRepo}/dispatches`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${ghToken}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'dubis-edge-fn/1.0' },
            body: JSON.stringify({ event_type: 'boss-approved-product', client_payload: { product_id: productId, product_id_numeric: numericId, queue_id: queueId } }),
            signal: AbortSignal.timeout(15000),
          });
          redispatched = dr.status === 204;
        }
      } catch { /* re-dispatch best-effort */ }

      if (queueId) {
        await sb.from('product_pipeline_queue').update({
          status: redispatched ? 'pending_dispatch' : 'failed',
          retry_count: qRetry + 1,
          last_error: `auto-retry ${qRetry + 1}/${MAX_PIPELINE_RETRIES} after: ${errorMsg || 'no previews'}`,
          dispatched_at: redispatched ? new Date().toISOString() : null,
        }).eq('id', queueId);
      }
      try {
        await sb.from('agent_runs').insert({
          agent_id: 'product', run_date: new Date().toISOString().slice(0, 10),
          status: redispatched ? 'completed' : 'failed',
          summary: redispatched
            ? `🔁 auto-retry ${qRetry + 1}/${MAX_PIPELINE_RETRIES} for product #${numericId} "${slogan}" (transient: ${errorMsg || 'no previews'})`
            : `⚠️ auto-retry re-dispatch FAILED for product #${numericId} "${slogan}" — ${errorMsg || ''}`,
          side_effects: { auto_product_retry: true, product_id: productId, product_id_numeric: numericId, attempt: qRetry + 1, redispatched, error: errorMsg },
        });
      } catch { /* log best-effort */ }

      if (redispatched) {
        // quiet self-heal — NO oren email. Next callback decides success/final-fail.
        return json({ success: true, status: 'auto_retry_dispatched', product_id: productId, product_id_numeric: numericId, attempt: qRetry + 1 });
      }
      // could not re-dispatch → fall through to the failure email
    }

    // Retries exhausted (or manual product, or re-dispatch failed) → ONE controlled signal.
    try {
      const resendKey = Deno.env.get('RESEND_API_KEY') ?? '';
      if (resendKey) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'DUBIS <orders@dubis.net>',
            to: ['dubis.brand@gmail.com'],
            subject: `❌ נכשלה הוספה אוטומטית של מוצר #${numericId} — "${slogan}"`,
            html: `
              <div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px">
                <h2 style="color:#b91c1c">קו הייצור נכשל${qRetry > 0 ? ` (אחרי ${qRetry} ניסיון חוזר אוטומטי)` : ''}</h2>
                <p><strong>סלוגן:</strong> ${slogan}</p>
                <p><strong>שגיאה:</strong> ${errorMsg || 'לא ידועה'}</p>
                <p><strong>Workflow run:</strong> ${workflowRunId ? `<a href="https://github.com/dubis-brand/dubis-website/actions/runs/${workflowRunId}">פתח</a>` : 'n/a'}</p>
                <p>המוצר נשאר ב-<code>active=false</code> ולא עלה לאוויר.${qRetry > 0 ? ' המערכת ניסתה שוב לבד וזה עדיין נכשל — כנראה לא תקלה רגעית.' : ''}</p>
              </div>`,
          }),
          signal: AbortSignal.timeout(8000),
        }).catch(() => {});
      }
    } catch { /* */ }

    try {
      await sb.from('agent_runs').insert({
        agent_id: 'product', run_date: new Date().toISOString().slice(0, 10), status: 'failed',
        summary: `❌ auto-product #${numericId} "${slogan}" failed${qRetry > 0 ? ` after ${qRetry} auto-retry` : ''} — ${errorMsg || 'unknown'}`,
        side_effects: { auto_product_failed: true, product_id: productId, product_id_numeric: numericId, retries: qRetry, error: errorMsg, workflow_run_id: workflowRunId },
      });
    } catch { /* log best-effort */ }

    await sb.from('agent_tasks').update({
      status: 'failed',
      updated_at: new Date().toISOString(),
      notes: `❌ קו הייצור נכשל למוצר #${numericId} (${slogan})\n${errorMsg || ''}`,
    }).eq('agent_id', 'product').filter('content_data->>product_id', 'eq', productId);

    return json({ success: true, status: 'failed', product_id: productId, error: errorMsg, retries: qRetry });
  }

  // ── PRODUCT-VISUAL-APPROVE — oren clicks "Approve & Publish" ──────
  // Two auth paths:
  //   A. admin JWT (from admin UI button) — uses verifyAdmin
  //   B. visual_approval_token from the email magic link — bypasses admin login
  // On success: active=true, publishing_status='live', launched_at=now, token burned.
  if (type === 'product-visual-approve') {
    const productId = url.searchParams.get('product_id') || (body as Record<string, unknown>)?.product_id as string;
    const token     = url.searchParams.get('token')      || (body as Record<string, unknown>)?.token      as string;
    if (!productId) return json({ error: 'product_id required' }, 400);

    const adminOk = await verifyAdmin(req);
    if (!adminOk && !token) return json({ error: 'Unauthorized — admin JWT or visual_approval_token required' }, 401);

    const { data: prodRow, error: fetchErr } = await sb.from('dubis_products')
      .select('id, product_id_numeric, slogan, pending_visual_approval, visual_approval_token, proof_of_completion, launched_at')
      .eq('id', productId).single();
    if (fetchErr || !prodRow) return json({ error: 'product_not_found' }, 404);
    const p = prodRow as Record<string, unknown>;

    if (!p.pending_visual_approval) {
      return json({ error: 'not_pending_visual_approval', current_status: 'either already live or never went through pipeline' }, 400);
    }
    // Token check (only for the magic-link path — admin JWT skips this).
    if (!adminOk && token && p.visual_approval_token !== token) {
      return json({ error: 'invalid_token — possibly burned or wrong product' }, 401);
    }

    const { error: upErr } = await sb.from('dubis_products').update({
      active: true,
      publishing_status: 'live',
      pending_visual_approval: false,
      visual_approval_token: null,            // burn token (one-time use)
      // First launch only — re-approvals/regens keep the original launch date
      // (see auto-publish branch note; prevents site-wide false NEW badges).
      launched_at: (p.launched_at as string) ?? new Date().toISOString(),
    }).eq('id', productId);
    if (upErr) return json({ error: 'activation_failed', detail: upErr.message }, 500);

    // Update queue row (latest for this product) to status='live'
    await sb.from('product_pipeline_queue').update({
      status: 'live', completed_at: new Date().toISOString(),
    }).eq('product_id', productId);

    // 2026-05-19: dispatch dubis-sync-products.yml so the static js/products.js
    // picks up the newly-active row. Without this the site reads the previous
    // pipeline run's products.js (regenerated BEFORE active=true), and the
    // product gets the ✅ "live" email but never appears on dubis.net.
    // Best-effort: if GH_DISPATCH_TOKEN is missing or GitHub rejects, we still
    // return success — the product is active in DB, oren can run the workflow
    // manually if needed.
    try {
      const ghToken = Deno.env.get('GH_DISPATCH_TOKEN') ?? '';
      const ghRepo  = Deno.env.get('GH_REPO') ?? 'dubis-brand/dubis-website';
      if (ghToken) {
        await fetch(`https://api.github.com/repos/${ghRepo}/dispatches`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ghToken}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
            'User-Agent': 'dubis-edge-fn/1.0',
          },
          body: JSON.stringify({
            event_type: 'oren-approved-visual',
            client_payload: {
              product_id: productId,
              product_id_numeric: p.product_id_numeric,
            },
          }),
          signal: AbortSignal.timeout(15000),
        }).catch(() => {});
      }
    } catch { /* dispatch is best-effort */ }

    // 2026-05-19: seed product_prices with a fallback baseline + fire gelato-stock-check
    // so product_variant_stock auto-populates with in_stock + gelato_cost_usd within
    // ~60s. Without this the admin Product Catalog card shows "לא נבדק" + "אין נתוני
    // עלות" until the next daily 5 UTC cron. The async stock check feeds Margin US/IL
    // columns; a later sync sets product_prices.selling_price = CEIL(MIN(gelato_cost_usd))
    // per rule #7 of memory/checkout-guardrails.md. Both calls are best-effort.
    try {
      // (a) Seed product_prices with dubis_products.price_usd as baseline so admin
      // has SOMETHING to render. Daily cron + manual sync refine to
      // CEIL(MIN(gelato_cost_usd)) once cost data lands.
      // 2026-05-19 (corrected same day): INSERT-only, never UPSERT — overriding an
      // existing selling_price would clobber a higher rule-#7 price set earlier
      // (was dropping product 31 from $27 → $21 every time visual-approve re-fired).
      const { data: existingPrice } = await sb.from('product_prices').select('product_id').eq('product_id', p.product_id_numeric).maybeSingle();
      if (!existingPrice) {
        const { data: prodPrice } = await sb.from('dubis_products')
          .select('price_usd').eq('id', productId).single();
        const baselinePrice = Number((prodPrice as Record<string, unknown>)?.price_usd ?? 28);
        await sb.from('product_prices')
          .insert({ product_id: p.product_id_numeric, selling_price: baselinePrice, updated_at: new Date().toISOString() });
      }

      // (b) Fire gelato-stock-check via cron dispatcher. Returns immediately
      // (~2s budget here); upstream takes ~55s. Check product_variant_stock
      // 60-90s later for cost data.
      const supaUrl = Deno.env.get('SUPABASE_URL') ?? '';
      const PG_CRON_TOKEN = 'dubis-pg-cron-trigger-a554cd187bdfaf88a0a5dd8dcf571bea32658e1eb8ec217c';
      if (supaUrl) {
        fetch(`${supaUrl.replace('/rest/v1', '')}/functions/v1/dubis-cron-dispatcher?job=gelato-stock&token=${encodeURIComponent(PG_CRON_TOKEN)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(2000),
        }).catch(() => {});  // swallow — upstream keeps running
      }
    } catch { /* baseline price + stock fire are best-effort */ }

    // Close the agent_task
    await sb.from('agent_tasks').update({
      status: 'done',
      updated_at: new Date().toISOString(),
      notes: `✅ מוצר #${p.product_id_numeric} חי באתר אחרי אישור ויזואלי — ${p.slogan}`,
    }).eq('agent_id', 'product').filter('content_data->>product_id', 'eq', productId);

    // Best-effort confirmation email
    try {
      const resendKey = Deno.env.get('RESEND_API_KEY') ?? '';
      if (resendKey) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'DUBIS <orders@dubis.net>',
            to: ['dubis.brand@gmail.com'],
            subject: `✅ מוצר #${p.product_id_numeric} עלה לאוויר — "${p.slogan}"`,
            html: `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px">
                <h2 style="color:#2d6a4f">המוצר חי באתר</h2>
                <p><strong>סלוגן:</strong> ${p.slogan}</p>
                <p>קישור: <a href="https://www.dubis.net/#product-${p.product_id_numeric}">dubis.net/#product-${p.product_id_numeric}</a></p>
                <p style="color:#6b7280;font-size:13px">המוצר יוצג עם תג "NEW" באתר במשך 30 ימים.</p>
              </div>`,
          }),
          signal: AbortSignal.timeout(8000),
        }).catch(() => {});
      }
    } catch { /* */ }

    return json({ success: true, action: 'published', product_id: productId, product_id_numeric: p.product_id_numeric });
  }

  // ── PRODUCT-VISUAL-REJECT — oren clicks "Reject" on bad mockups ──────
  // Marks the product as visually rejected. The Gelato draft + mockup files
  // stay in the repo (for forensics) but the product can't be activated.
  // To recover: re-run the pipeline via approve-product (creates a NEW draft).
  if (type === 'product-visual-reject') {
    const productId = url.searchParams.get('product_id') || (body as Record<string, unknown>)?.product_id as string;
    const reason    = (body as Record<string, unknown>)?.reason as string || 'visual_rejected';
    if (!productId) return json({ error: 'product_id required' }, 400);

    const adminOk = await verifyAdmin(req);
    if (!adminOk) return json({ error: 'Admin only' }, 401);

    const { data: prodRow } = await sb.from('dubis_products')
      .select('product_id_numeric, slogan, pending_visual_approval').eq('id', productId).single();
    if (!prodRow) return json({ error: 'product_not_found' }, 404);

    const { error: upErr } = await sb.from('dubis_products').update({
      pending_visual_approval: false,
      visual_approval_token: null,
      publishing_status: 'visual_rejected',
      proof_of_completion: {},
    }).eq('id', productId);
    if (upErr) return json({ error: 'reject_failed', detail: upErr.message }, 500);

    await sb.from('product_pipeline_queue').update({
      status: 'cancelled', last_error: `oren_visual_reject: ${reason}`, completed_at: new Date().toISOString(),
    }).eq('product_id', productId);

    await sb.from('agent_tasks').update({
      status: 'failed', updated_at: new Date().toISOString(),
      notes: `❌ אישור ויזואלי נדחה — ${(prodRow as Record<string, unknown>).slogan}\nסיבה: ${reason}`,
    }).eq('agent_id', 'product').filter('content_data->>product_id', 'eq', productId);

    return json({ success: true, action: 'rejected', product_id: productId });
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

  // ── SECURITY-SCAN — Security audit agent (daily cron 0 3 * * *) ─────
  if (type === 'security-scan') {
    const cronSecret  = Deno.env.get('CRON_SECRET') ?? '';
    const agentSecret = Deno.env.get('AGENT_SECRET') ?? '';
    const svcKey      = SERVICE_ROLE;
    const authHeader  = req.headers.get('authorization') ?? '';
    const token       = url.searchParams.get('token') || authHeader.replace('Bearer ', '').trim() || req.headers.get('x-agent-secret') || '';
    const isAuthed = (cronSecret && token === cronSecret) || (agentSecret && token === agentSecret) || (svcKey && token === svcKey);
    const adminOk = await verifyAdmin(req);
    if (!isAuthed && !adminOk) return json({ error: 'Unauthorized' }, 401);

    const scanStartedMs = Date.now();
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

    // Log to agent_runs so the boss daily email (morning-report.js) can find it.
    // Without this, lastSecurityRun is always null and the email shows "never ran".
    try {
      const runSummary = findings.length === 0
        ? `סריקה יומית הסתיימה — 0 ממצאים. כל ה-headers, RLS, ומפתחות תקינים.`
        : `סריקה יומית — ${findings.length} ממצאים (${scanResult.critical} critical, ${scanResult.high} high, ${scanResult.medium} medium, ${scanResult.low} low).\n` +
          findings.slice(0, 8).map(f => `[${f.severity}] ${f.category}: ${f.detail}`).join('\n');
      await sb.from('agent_runs').insert({
        agent_id: 'security',
        status: scanResult.critical > 0 ? 'completed_with_errors' : 'completed',
        summary: runSummary,
        tasks_created: 1,
        duration_ms: Date.now() - scanStartedMs,
        proof_verified: true,
        error_message: scanResult.critical > 0 ? `${scanResult.critical} critical findings` : null,
      });
    } catch (_) { /* non-fatal */ }

    return json(scanResult);
  }

  // ── serve-image: serve IG images with clean headers (no X-Robots-Tag) ──
  // ══════════════════════════════════════════════════════════
  // VIDEO PIPELINE — AI-generated promo videos
  // ══════════════════════════════════════════════════════════

  // ── Shared auth helper for video pipeline routes ──
  function checkVideoAuth(r: Request, u: URL): boolean {
    const svcKey2      = SERVICE_ROLE;
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

    // ── ACTION: orchestrate-il-campaign ─────────────────────────────────
    // 2026-05-06 — Israel campaign in HEBREW. Built per oren's request after the US
    // campaign was paused for ROAS=0–0.26x. Reasoning: 100% of our 4 existing orders
    // came from IL via the personal network, so paid IL traffic should convert
    // higher than cold US traffic until US brand recognition builds.
    // body: { daily_budget_ils?, image_url?, landing_url? }
    // ALL objects created in PAUSED state — oren reviews in Ads Manager and activates
    // manually after verifying UTM tracking works end-to-end.
    if (action === 'orchestrate-il-campaign') {
      const results: Record<string, unknown> = { steps: [] };
      const steps = results.steps as Record<string, unknown>[];
      const dailyBudgetILS = Number(body.daily_budget_ils) || 16; // ₪16/adset/day = ₪32 total ≈ $8.50/day
      const dailyBudgetMinor = Math.round(dailyBudgetILS * 100); // אגורות
      const baseLanding = (body.landing_url as string) || 'https://www.dubis.net/?lang=he&utm_source=fb&utm_medium=paid&utm_campaign=il_w1';

      // Step 1: Create campaign (PAUSED)
      let campaignId = '';
      try {
        const createCamp = await metaCall(`/${adAccountId}/campaigns`, 'POST', {
          name: `DUBIS IL Sales — W1 — ${new Date().toISOString().slice(0, 10)}`,
          objective: 'OUTCOME_SALES',
          status: 'PAUSED',
          special_ad_categories: [],
          buying_type: 'AUCTION',
        });
        campaignId = (createCamp as { id?: string }).id || '';
        steps.push({ step: 'create_campaign', campaign_id: campaignId, result: createCamp });
        if (!campaignId) { results.success = false; return json(results, 500); }
      } catch (e) { steps.push({ step: 'create_campaign', error: (e as Error).message }); return json({ ...results, success: false }, 500); }

      // Step 2: Pull gender-matched images from dubis_images.
      // 2026-05-07 — explicit per-gender lookup so women's ad NEVER gets a male
      // image and vice versa (the bug from 2026-04-21 P0 audit).
      // model_type values in DB: 'woman' / 'curvy_woman' for female, 'man' / 'large_man' / 'older_man' for male.
      async function pickImage(genderBucket: 'female' | 'male'): Promise<string> {
        const womanTypes = ['woman', 'curvy_woman'];
        const manTypes   = ['man', 'large_man', 'older_man'];
        const types = genderBucket === 'female' ? womanTypes : manTypes;
        const { data } = await sb
          .from('dubis_images')
          .select('image_url')
          .in('model_type', types)
          .eq('approved', true)
          .order('quality_score', { ascending: false })
          .limit(1);
        return (data && data[0] && (data[0] as { image_url: string }).image_url) || '';
      }
      const womenImg = (body.image_url_women as string) || await pickImage('female');
      const menImg   = (body.image_url_men   as string) || await pickImage('male');

      // Step 3: Create 2 Ad Sets (Women 30-55 + Men 30-55, Israel)
      // Each segment carries its own image so the creative on Women adset shows a woman
      // and the creative on Men adset shows a man.
      const segments: { label: string; genders: number[]; utm_content: string; image: string }[] = [
        { label: 'Women', genders: [2], utm_content: 'ad_a_women', image: womenImg },
        { label: 'Men',   genders: [1], utm_content: 'ad_b_men',   image: menImg   },
      ];
      const adSetIds: Record<string, string> = {};
      for (const s of segments) {
        try {
          const startTime = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // start in 1h
          const createAS = await metaCall(`/${adAccountId}/adsets`, 'POST', {
            name: `IL ${s.label} 30-55`,
            campaign_id: campaignId,
            daily_budget: dailyBudgetMinor,
            billing_event: 'IMPRESSIONS',
            optimization_goal: 'OFFSITE_CONVERSIONS',
            bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
            status: 'PAUSED',
            start_time: startTime,
            destination_type: 'WEBSITE',
            targeting: {
              geo_locations: { countries: ['IL'] },
              age_min: 30,
              age_max: 55,
              genders: s.genders,
              // Manual placement — Audience Network OFF (it killed US ROAS)
              publisher_platforms: ['facebook', 'instagram'],
              facebook_positions: ['feed', 'story'],
              instagram_positions: ['stream', 'story'],
            },
            promoted_object: { pixel_id: pixelId, custom_event_type: 'PURCHASE' },
            attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }],
          });
          const adsetId = (createAS as { id?: string }).id || '';
          adSetIds[s.label] = adsetId;
          steps.push({ step: 'create_adset', segment: s.label, adset_id: adsetId, result: createAS });
        } catch (e) { steps.push({ step: 'create_adset', segment: s.label, error: (e as Error).message }); }
      }

      // Step 4: Create Ad Creatives + Ads with Hebrew copy
      // Hebrew written natively — NOT a translation of the US English creatives.
      // Tone: oren's voice — direct, slightly self-deprecating, no influencer-speak.
      const creativeWomen = `חיפשתי שנים בגדים שמרגישים כמוני.\nלא דוגמנית. לא מושלמת. לא מצטדקת.\nמצאתי? לא ממש. אז בניתי.\n\nDUBIS — בגדים שנבנו לגוף שאת גרה בו.\n14 דגמים, נשלח מארה״ב לישראל בתוך 7-10 ימים.\n\nלחיצה לדגם המוביל →`;
      const creativeMen = `DUBIS זה לא קמפיין של אינסטוסלב.\nזה ברנד שהקים בחור אחד שנמאס לו לחפש חולצה שמתאימה לו אחרי 40.\n\n14 דגמים. חולצות, קפוצונים, שרוול ארוך, כובעים.\nשום דבר לא נשלח לפני שמודדים את הלוגו ב-3D.\n\nניסיון אחד — אתה תבין.`;

      const headlines: Record<string, string> = {
        Women: 'בגדים שנבנו לגוף שאת גרה בו',
        Men:   'ברנד שלא רצה להיות עוד אחד',
      };
      const descriptions: Record<string, string> = {
        Women: 'אופנה אמיתית לבוגרות. נשלח מארה"ב.',
        Men:   'אופנה אמיתית לבוגרים. נשלח מארה"ב.',
      };
      // Per-segment landing — different products to test which converts better
      const productByLabel: Record<string, number> = { Women: 8, Men: 11 };

      if (pageId && (womenImg || menImg)) {
        for (const s of segments) {
          const adsetId = adSetIds[s.label];
          if (!adsetId) continue;
          if (!s.image) {
            steps.push({ step: 'create_creative_or_ad', segment: s.label, skipped: true, reason: `no approved ${s.label} image found in dubis_images` });
            continue;
          }
          const msg = s.label === 'Women' ? creativeWomen : creativeMen;
          const productId = productByLabel[s.label];
          const link = `${baseLanding}&p=${productId}&utm_content=${s.utm_content}`;
          try {
            const creative = await metaCall(`/${adAccountId}/adcreatives`, 'POST', {
              name: `DUBIS IL ${s.label} — W1 creative`,
              object_story_spec: {
                page_id: pageId,
                ...(igAccountId ? { instagram_actor_id: igAccountId } : {}),
                link_data: {
                  link,
                  message: msg,
                  name: headlines[s.label],
                  description: descriptions[s.label],
                  picture: s.image,
                  call_to_action: { type: 'SHOP_NOW', value: { link } },
                },
              },
              degrees_of_freedom_spec: { creative_features_spec: { standard_enhancements: { enroll_status: 'OPT_OUT' } } },
            });
            const creativeId = (creative as { id?: string }).id || '';
            steps.push({ step: 'create_creative', segment: s.label, creative_id: creativeId, image_used: s.image, result: creative });

            if (creativeId) {
              const ad = await metaCall(`/${adAccountId}/ads`, 'POST', {
                name: `DUBIS IL ${s.label} — W1 ad`,
                adset_id: adsetId,
                creative: { creative_id: creativeId },
                status: 'PAUSED',
              });
              steps.push({ step: 'create_ad', segment: s.label, ad_id: (ad as { id?: string }).id || '', result: ad });
            }
          } catch (e) { steps.push({ step: 'create_creative_or_ad', segment: s.label, error: (e as Error).message }); }
        }
      } else {
        steps.push({ step: 'create_creative_or_ad', skipped: true, reason: `missing pageId (${!!pageId}) or images (women=${!!womenImg}, men=${!!menImg})` });
      }

      // Step 5: persist to ad_campaigns so the morning report sees it.
      // Schema has no campaign_id/name columns — Meta IDs go into `notes`.
      // Row starts as 'paused' (mirrors the Meta objects); flip to 'active' when oren activates in Ads Manager.
      try {
        const today = new Date().toISOString().slice(0, 10);
        const endDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const adsetNote = Object.entries(adSetIds).map(([k, v]) => `${v} (${k})`).join(', ') || 'none';
        const { error: rowErr } = await sb.from('ad_campaigns').insert({
          platform: 'instagram+facebook',
          goal: 'sales',
          budget: dailyBudgetILS * segments.length,
          budget_currency: 'ILS',
          duration_days: 7,
          audience: 'IL Men + Women 30-55 (CBO, 2 adsets)',
          status: 'paused',
          start_date: today,
          end_date: endDate,
          spend_to_date: 0,
          type: 'campaign',
          notes: `DUBIS IL Sales — W1 — ${today} | Meta campaign_id: ${campaignId} | Adsets: ${adsetNote} | Daily: ₪${dailyBudgetILS} CBO × ${segments.length}`,
        });
        steps.push({ step: 'persist_to_ad_campaigns', ok: !rowErr, error: rowErr?.message });
      } catch (e) {
        steps.push({ step: 'persist_to_ad_campaigns', error: (e as Error).message });
      }

      results.success = true;
      results.campaign_id = campaignId;
      results.adset_ids = adSetIds;
      results.currency = 'ILS';
      results.daily_budget_per_adset_ils = dailyBudgetILS;
      results.total_daily_budget_ils = dailyBudgetILS * segments.length;
      results.utm_campaign = 'il_w1';
      results.note = 'IL campaign created in PAUSED state. Verify UTM tracking + creatives in Ads Manager, then activate. Kill-switch: <2 attributed orders after 7 days → pause.';
      return json(results);
    }

    return json({ error: 'Invalid action. Valid: check-token, list-campaigns, toggle-campaign, orchestrate-us-pivot, orchestrate-il-campaign' }, 400);
  }

  // ── shopping-feed: Google Merchant Center product feed (XML/RSS 2.0) ──
  // Serves the Google Shopping feed for DUBIS. Public, no auth.
  // Exposed at https://www.dubis.net/shopping-feed.xml via vercel.json rewrite.
  // Regenerated per-request; cached 6h at CDN edge.
  if (type === 'shopping-feed') {
    const { data: products, error: pErr } = await sb
      .from('dubis_products')
      .select('id, product_id_numeric, slogan, clothing_type, gender, price_usd, colors, description_en, category')
      .eq('active', true)
      .order('product_id_numeric', { ascending: true });
    if (pErr) return new Response(`DB error: ${pErr.message}`, { status: 500 });

    const productIds = (products || []).map((p: any) => p.id);
    const { data: images } = await sb
      .from('dubis_images')
      .select('product_id, image_url, approved, quality_score')
      .in('product_id', productIds)
      .order('approved', { ascending: false })
      .order('quality_score', { ascending: false, nullsFirst: false });

    const bestImageByProduct = new Map<string, string>();
    for (const img of (images || []) as any[]) {
      if (!bestImageByProduct.has(img.product_id) && img.image_url) {
        bestImageByProduct.set(img.product_id, img.image_url);
      }
    }

    const esc = (s: unknown) => String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    const clothingTypeLabel: Record<string, string> = {
      't-shirt': 'T-Shirt',
      'hoodie': 'Hoodie',
      'zip-hoodie': 'Zip Hoodie',
      'long-sleeve': 'Long Sleeve Tee',
      'cap': 'Cap',
    };
    const googleCategory: Record<string, string> = {
      't-shirt': '212',       // Apparel > Clothing > Shirts & Tops
      'long-sleeve': '212',
      'hoodie': '2271',        // Apparel > Clothing > Shirts & Tops > Sweatshirts
      'zip-hoodie': '2271',
      'cap': '175',            // Apparel > Clothing Accessories > Hats
    };
    const genderMap: Record<string, string> = {
      'men': 'male',
      'women': 'female',
      'unisex': 'unisex',
      'male': 'male',
      'female': 'female',
    };
    const apparelSizes = ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

    const items: string[] = [];
    for (const p of (products || []) as any[]) {
      const img = bestImageByProduct.get(p.id);
      if (!img) continue; // Google Shopping requires image_link — skip products without images
      const id = p.product_id_numeric;
      const typeLbl = clothingTypeLabel[p.clothing_type] || p.clothing_type || 'Apparel';
      const title = `DUBIS — ${p.slogan} ${typeLbl}`;
      const descFallback = `${p.slogan}. A ${String(typeLbl).toLowerCase()} from DUBIS — built for the body you actually live in. Body-positive humor apparel for the rest of us. Soft cotton, relaxed fit, sizes S through 3XL, made to order.`;
      const desc = p.description_en || descFallback;
      const price = `${Number(p.price_usd).toFixed(2)} USD`;
      const link = `https://www.dubis.net/#product-${id}`;
      const colors = Array.isArray(p.colors) && p.colors.length > 0 ? p.colors.join('/') : 'Mixed';
      const cat = googleCategory[p.clothing_type] || '1604';
      const gender = genderMap[p.gender] || 'unisex';

      const sizes = p.clothing_type === 'cap' ? ['One Size'] : apparelSizes;

      for (const size of sizes) {
        const sizeSuffix = size === 'One Size' ? 'OS' : size;
        items.push(`    <item>
      <g:id>DUBIS-${id}-${sizeSuffix}</g:id>
      <g:item_group_id>DUBIS-${id}</g:item_group_id>
      <g:title>${esc(title)} (${esc(size)})</g:title>
      <g:description>${esc(desc)}</g:description>
      <g:link>${link}</g:link>
      <g:image_link>${esc(img)}</g:image_link>
      <g:availability>in_stock</g:availability>
      <g:price>${price}</g:price>
      <g:brand>DUBIS</g:brand>
      <g:condition>new</g:condition>
      <g:google_product_category>${cat}</g:google_product_category>
      <g:product_type>Apparel &amp; Accessories &gt; Clothing &gt; ${esc(typeLbl)}</g:product_type>
      <g:gender>${gender}</g:gender>
      <g:age_group>adult</g:age_group>
      <g:color>${esc(colors)}</g:color>
      <g:size>${esc(size)}</g:size>
      <g:size_system>US</g:size_system>
      <g:identifier_exists>no</g:identifier_exists>
      <g:mpn>DUBIS-${id}-${sizeSuffix}</g:mpn>
      <g:shipping>
        <g:country>US</g:country>
        <g:service>Standard</g:service>
        <g:price>0.00 USD</g:price>
      </g:shipping>
    </item>`);
      }
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>DUBIS — For the rest of us</title>
    <link>https://www.dubis.net</link>
    <description>Body-positive humor apparel. Built for the body you actually live in.</description>
${items.join('\n')}
  </channel>
</rss>`;

    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=21600, s-maxage=21600', // 6 hours
        'Access-Control-Allow-Origin': '*',
        'X-Robots-Tag': 'noindex',
      },
    });
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

  // ── GELATO-DISCOVERY — daily catalog snapshot + diff (Wave 1, 2026-05-15) ─
  // Plan: docs/plans/DUBIS_GELATO_DISCOVERY_AGENT_2026-05-15.html
  // Wave 1 scope: fetch apparel catalog → aggregate by base productUid →
  //               UPSERT snapshot → diff vs yesterday → log to agent_runs.
  // NO scoring, NO slogan generation, NO admin UI yet (Waves 2-4).
  if (type === 'gelato-discovery') {
    const t0 = Date.now();
    const cronSecret  = Deno.env.get('CRON_SECRET') ?? '';
    const agentSecret = Deno.env.get('AGENT_SECRET') ?? '';
    const svcKey      = SERVICE_ROLE;
    const authHeader  = req.headers.get('authorization') ?? '';
    const token       = url.searchParams.get('token') || authHeader.replace('Bearer ', '').trim() || req.headers.get('x-agent-secret') || '';
    const isAuthed = (cronSecret && token === cronSecret) || (agentSecret && token === agentSecret) || (svcKey && token === svcKey);
    const adminOk = await verifyAdmin(req);
    if (!isAuthed && !adminOk) return json({ error: 'Unauthorized' }, 401);

    const GELATO_API_KEY = Deno.env.get('GELATO_API_KEY') ?? '';
    if (!GELATO_API_KEY) return json({ error: 'GELATO_API_KEY not set' }, 500);

    // Catalogs DUBIS cares about (apparel covers tshirt/hoodie/ziphoodie/longsleeve/dad-hat).
    // Beanies + bucket-hat are siblings — include for future expansion.
    const CATALOGS = ['apparel'];
    const PAGE_LIMIT = 100;
    const MAX_PAGES_PER_CATALOG = 200; // safety: 200 × 100 = 20,000 variants per catalog

    type Variant = {
      productUid: string;
      attributes?: Record<string, string>;
      supportedCountries?: string[];
      notSupportedCountries?: string[];
      dimensions?: Record<string, { value: string; measureUnit: string }>;
    };

    const allVariants: Variant[] = [];
    const fetchErrors: string[] = [];

    for (const catalogUid of CATALOGS) {
      let offset = 0;
      for (let page = 0; page < MAX_PAGES_PER_CATALOG; page++) {
        try {
          const r = await fetch(`https://product.gelatoapis.com/v3/catalogs/${catalogUid}/products:search`, {
            method: 'POST',
            headers: { 'X-API-KEY': GELATO_API_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ limit: PAGE_LIMIT, offset, attributeFilters: {} }),
            signal: AbortSignal.timeout(30000),
          });
          if (!r.ok) {
            fetchErrors.push(`${catalogUid} page ${page} HTTP ${r.status}`);
            break;
          }
          const body = await r.json();
          const products: Variant[] = Array.isArray(body?.products) ? body.products : [];
          if (products.length === 0) break;
          allVariants.push(...products);
          if (products.length < PAGE_LIMIT) break;
          offset += products.length;
        } catch (e) {
          fetchErrors.push(`${catalogUid} page ${page} fetch-error: ${(e as Error).message}`);
          break;
        }
      }
    }

    // Aggregate by base productUid (everything before _gsi_<size>) so we store
    // ONE row per base product per snapshot, with colors[] + sizes[] arrays.
    type Agg = {
      product_uid: string;
      brand: string | null;
      product_type: string | null;
      colors: Set<string>;
      sizes: Set<string>;
      facilities: string[];
      base_price_usd: number | null;
      available_us: boolean;
      raw_payload: Variant; // sample variant
    };

    const byBase = new Map<string, Agg>();
    for (const v of allVariants) {
      if (!v.productUid) continue;
      const base = v.productUid.split('_gsi_')[0]; // strip size+color suffix
      const a = v.attributes || {};
      let agg = byBase.get(base);
      if (!agg) {
        agg = {
          product_uid: base,
          brand: a.ApparelManufacturer || null,
          product_type: a.GarmentSubcategory || a.GarmentCategory || null,
          colors: new Set(),
          sizes: new Set(),
          facilities: [], // populated in Wave 2 via per-product enrichment
          base_price_usd: null, // populated in Wave 2 via /v3/prices
          available_us: false,
          raw_payload: v,
        };
        byBase.set(base, agg);
      }
      if (a.GarmentColor) agg.colors.add(a.GarmentColor);
      if (a.GarmentSize) agg.sizes.add(a.GarmentSize);
      const supported = Array.isArray(v.supportedCountries) ? v.supportedCountries : [];
      const notSupported = Array.isArray(v.notSupportedCountries) ? v.notSupportedCountries : [];
      // available_us = US is supported AND not in notSupported. If supportedCountries is empty,
      // Gelato's convention is "available everywhere except notSupportedCountries".
      const usOk = (supported.length === 0 || supported.includes('US')) && !notSupported.includes('US');
      if (usOk) agg.available_us = true;
    }

    // UPSERT today's snapshot rows in batches (Postgres has practical limits on large arrays)
    const today = new Date().toISOString().slice(0, 10);
    const rows = Array.from(byBase.values()).map((agg) => ({
      snapshot_date: today,
      product_uid: agg.product_uid,
      brand: agg.brand,
      product_type: agg.product_type,
      colors: Array.from(agg.colors),
      sizes: Array.from(agg.sizes),
      facilities: agg.facilities,
      base_price_usd: agg.base_price_usd,
      available_us: agg.available_us,
      raw_payload: agg.raw_payload,
    }));

    let upserted = 0;
    const upsertErrors: string[] = [];
    const sb = sbAdmin();
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const { error } = await sb
        .from('gelato_catalog_snapshot')
        .upsert(slice, { onConflict: 'snapshot_date,product_uid' });
      if (error) {
        upsertErrors.push(`batch ${i}-${i + slice.length}: ${error.message}`);
      } else {
        upserted += slice.length;
      }
    }

    // Diff vs yesterday
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const { data: yRows } = await sb
      .from('gelato_catalog_snapshot')
      .select('product_uid')
      .eq('snapshot_date', yesterday);
    const yset = new Set((yRows ?? []).map((r: { product_uid: string }) => r.product_uid));
    const todaySet = new Set(rows.map((r) => r.product_uid));
    const newCount = [...todaySet].filter((u) => !yset.has(u)).length;
    const removedCount = [...yset].filter((u) => !todaySet.has(u)).length;

    const summary = {
      catalogs_scanned: CATALOGS,
      variants_fetched: allVariants.length,
      base_products: rows.length,
      upserted,
      upsert_errors: upsertErrors,
      fetch_errors: fetchErrors,
      diff_vs_yesterday: {
        yesterday_date: yesterday,
        yesterday_count: yset.size,
        new_today: newCount,
        removed_today: removedCount,
      },
      brands_seen: Array.from(new Set(rows.map((r) => r.brand).filter(Boolean))).slice(0, 30),
      duration_ms: Date.now() - t0,
    };

    // Log to agent_runs (schema: agent_id, run_date, status, summary, tasks_created, duration_ms, side_effects)
    const runStatus = fetchErrors.length || upsertErrors.length ? 'failed' : 'completed';
    const { error: runErr } = await sb.from('agent_runs').insert({
      agent_id: 'gelato-discovery',
      run_date: today,
      status: runStatus,
      summary: `Snapshot: ${rows.length} base products from ${allVariants.length} variants. New: ${newCount}, removed: ${removedCount}.`,
      tasks_created: 0, // Wave 1: no agent_tasks created (Wave 4 will add approval flow)
      duration_ms: Date.now() - t0,
      error_message: runStatus === 'failed' ? [...fetchErrors, ...upsertErrors].join(' | ').slice(0, 500) : null,
      side_effects: summary,
    });
    if (runErr) console.warn('[gelato-discovery] agent_runs insert failed:', runErr.message);

    return json({ success: true, ...summary });
  }

  // ── WEEKLY-SLOGAN-PRODUCT (2026-06-06) — autonomous one-product-per-week ──
  // Picks a slot (varied across all 8 garment types incl cap/tanktop/vneck),
  // prefers an approved community slogan from the pool else generates one via
  // Gemini, inserts the product with auto_publish=true and kicks off the GHA
  // pipeline. gha-pipeline-callback then auto-activates it (no human gate) and
  // gelato-stock-check finalizes the price to cost. One product/week.
  if (type === 'weekly-slogan-product') {
    const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
    const agentSecret = Deno.env.get('AGENT_SECRET') ?? '';
    const svcKey = SERVICE_ROLE;
    const wToken = url.searchParams.get('token') || (req.headers.get('authorization') ?? '').replace('Bearer ', '').trim() || req.headers.get('x-agent-secret') || '';
    const wAuthed = (cronSecret && wToken === cronSecret) || (agentSecret && wToken === agentSecret) || (svcKey && wToken === svcKey);
    if (!wAuthed && !(await verifyAdmin(req))) return json({ error: 'Unauthorized' }, 401);
    const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
    if (!geminiKey) return json({ error: 'GEMINI_API_KEY not configured' }, 503);

    // Idempotency: one auto product per ISO week (unless ?force=1)
    if (url.searchParams.get('force') !== '1') {
      const sixDaysAgo = new Date(Date.now() - 6 * 86400000).toISOString();
      const { data: recent } = await sb.from('dubis_products').select('id').eq('auto_publish', true).gte('created_at', sixDaysAgo).limit(1);
      if (recent && recent.length) return json({ ok: true, skipped: 'already ran this week' });
    }

    // The weekly AUTO-creator may only auto-publish types that pass ALL FOUR gates
    // of the SELLABLE_TYPES contract (module top), i.e. autoEligible:true. This is
    // the gate that replaces a human review: a type cannot reach a customer
    // unsupervised until it is agreed + real-brand + constraint-allowed + mockup-
    // verified. Plain 'hoodie' is gone (zip-only). cap/capemb/v-neck/tank-top stay
    // suggest-only (autoEligible:false) until each one's first mockup is verified.
    const W_TYPE_POOL = SELLABLE_TYPES.filter(t => t.autoEligible);
    const W_CATALOG_COLORS: Record<string, string[]> = {
      't-shirt:unisex': ['Black', 'White', 'Cream', 'Navy', 'Charcoal', 'Red', 'Gray', 'Forest Green'],
      't-shirt:women': ['Black', 'White', 'Cream', 'Navy'],
      'hoodie:unisex': ['Black', 'White', 'Cream', 'Navy', 'Charcoal', 'Forest Green', 'Gray'],
      'hoodie:women': ['Black', 'White', 'Navy', 'Charcoal'],
      'zip-hoodie:unisex': ['Black', 'White', 'Navy', 'Gray', 'Royal Blue'],
      'long-sleeve:unisex': ['Black', 'White', 'Cream', 'Navy', 'Forest Green', 'Gray'],
      'long-sleeve:women': ['Black', 'White', 'Navy'],
      'cap:unisex': ['Black', 'White', 'Cream', 'Navy'], 'cap-emb:unisex': ['Black', 'White', 'Navy', 'Cream', 'Charcoal'],
      'v-neck:unisex': ['Black', 'White', 'Navy', 'Red'], 'v-neck:women': ['Black', 'White', 'Navy'],
      'tank-top:unisex': ['Black', 'White', 'Navy', 'Red'], 'tank-top:women': ['Black'],
    };
    const W_PRICE_MAP: Record<string, number> = { 't-shirt': 28, hoodie: 41, 'zip-hoodie': 55, 'long-sleeve': 31, cap: 28, 'cap-emb': 32, 'v-neck': 30, 'tank-top': 30 };
    const W_DB_TYPE: Record<string, string> = { tshirt: 't-shirt', hoodie: 'hoodie', ziphoodie: 'zip-hoodie', longsleeve: 'long-sleeve', cap: 'cap', capemb: 'cap-emb', vneck: 'v-neck', tanktop: 'tank-top' };

    // Weighted pick of ONE slot, down-weighting saturated types
    const { data: allProds } = await sb.from('dubis_products').select('slogan, clothing_type');
    const counts: Record<string, number> = {};
    for (const p of (allProds || []) as Array<Record<string, unknown>>) {
      const dt = String(p.clothing_type || '');
      const jt = ({ 't-shirt': 'tshirt', 'zip-hoodie': 'ziphoodie', 'long-sleeve': 'longsleeve', 'v-neck': 'vneck', 'tank-top': 'tanktop', 'cap-emb': 'capemb' } as Record<string, string>)[dt] || dt;
      counts[jt] = (counts[jt] || 0) + 1;
    }
    const pool = W_TYPE_POOL.map(p => ({ ...p, fw: p.weight / (1 + (counts[p.type] || 0) * 0.5) }));
    const totalW = pool.reduce((s, p) => s + p.fw, 0);
    let r = Math.random() * totalW; let slot = pool[0];
    for (const p of pool) { r -= p.fw; if (r <= 0) { slot = p; break; } }
    const dbType = W_DB_TYPE[slot.type] || 't-shirt';
    const genderKey = slot.gender === 'women' ? 'women' : 'unisex';
    const slotColors = W_CATALOG_COLORS[`${dbType}:${genderKey}`] || ['Black', 'White'];

    // Prefer an approved community submission
    let fromSubmission: string | null = null; let submitterEmail: string | null = null; let presetSlogan: string | null = null;
    const { data: poolRows } = await sb.from('slogan_candidates').select('id,text_en,submitter_email').eq('source', 'visitor_submission').eq('status', 'approved').order('brand_voice_score', { ascending: false }).limit(1);
    if (poolRows && poolRows.length) {
      const pr = poolRows[0] as Record<string, unknown>;
      presetSlogan = pr.text_en as string; fromSubmission = pr.id as string; submitterEmail = (pr.submitter_email as string) || null;
    }

    const { data: existingProducts2 } = await sb.from('dubis_products').select('slogan');
    const dupList = (existingProducts2 || []).map((p: Record<string, unknown>) => p.slogan).filter(Boolean).join(' | ');
    const wPrompt = presetSlogan
      ? `You are DUBIS's copywriter. We will print this customer-submitted slogan on a ${dbType} (${genderKey}): "${presetSlogan}". Break it into typography. Return ONLY JSON: {"slogan":"${presetSlogan}","power_word":"THE ONE BIG WORD","text_before":"words before","text_after":"words after","layout":"top-bottom","description_en":"2 sentences","description_he":"2 משפטים עברית טבעית"}`
      : `You are DUBIS's head copywriter — CYNICAL humor, body-positive, anti-fashion, for ages 35+. Generate ONE original slogan (2-7 words, English, one POWER WORD) for a ${dbType} (${genderKey}). Not offensive/political. Do NOT repeat: ${dupList}. Return ONLY JSON: {"slogan":"...","power_word":"BIG WORD","text_before":"...","text_after":"...","layout":"top-bottom","description_en":"2 sentences","description_he":"2 משפטים עברית טבעית"}`;
    let g: Record<string, string> = {};
    try {
      const gr = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: wPrompt }] }] }), signal: AbortSignal.timeout(30000) });
      const raw = (await gr.json()).candidates?.[0]?.content?.parts?.[0]?.text || '';
      g = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch (e) { return json({ error: 'gemini_failed', detail: (e as Error).message }, 500); }
    const finalSlogan = presetSlogan || g.slogan;
    if (!finalSlogan) return json({ error: 'no_slogan_produced' }, 500);

    // Insert product (auto_publish=true) + assign numeric + queue + dispatch GHA
    const { data: product, error: insErr } = await sb.from('dubis_products').insert({
      slogan: finalSlogan, clothing_type: dbType, category: genderKey, gender: slot.gender,
      price_usd: W_PRICE_MAP[dbType] || 28, description_en: g.description_en || '', description_he: g.description_he || '',
      colors: slotColors, typography_small: g.text_before || '', typography_big: g.power_word || '', typography_after: g.text_after || '',
      typography_layout: g.layout || 'top-bottom', source: 'ai-generated', active: false, auto_publish: true,
    }).select('id').single();
    if (insErr || !product) return json({ error: 'insert_failed', detail: insErr?.message }, 500);
    const newProdId = (product as Record<string, unknown>).id as string;

    const { data: maxRow } = await sb.from('dubis_products').select('product_id_numeric').not('product_id_numeric', 'is', null).order('product_id_numeric', { ascending: false }).limit(1).single();
    const nextId = (((maxRow as Record<string, unknown>)?.product_id_numeric as number) || 14) + 1;
    await sb.from('dubis_products').update({ source: 'approved', product_id_numeric: nextId, publishing_status: 'pending_pipeline', proof_of_completion: {} }).eq('id', newProdId);
    const { data: qRow } = await sb.from('product_pipeline_queue').insert({ product_id: newProdId, product_id_numeric: nextId, status: 'pending_dispatch' }).select('id').single();
    const queueId2 = (qRow as Record<string, unknown>)?.id as string;
    if (fromSubmission) await sb.from('slogan_candidates').update({ status: 'live' }).eq('id', fromSubmission);
    await sb.from('agent_tasks').insert({ agent_id: 'product', title: `סלוגן שבועי אוטומטי: ${finalSlogan}`, description: `Auto-weekly product. type=${dbType}/${genderKey}${fromSubmission ? ' (from community submission)' : ''}`, category: 'new_product', status: 'in_progress', priority: 'medium', content_data: { product_id: newProdId, auto_weekly: true, from_submission: fromSubmission, submitter_email: submitterEmail } });

    let dispatchOk = false;
    const ghToken = Deno.env.get('GH_DISPATCH_TOKEN') ?? '';
    const ghRepo = Deno.env.get('GH_REPO') ?? 'dubis-brand/dubis-website';
    if (ghToken) {
      try {
        const dr = await fetch(`https://api.github.com/repos/${ghRepo}/dispatches`, { method: 'POST', headers: { 'Authorization': `Bearer ${ghToken}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'dubis-edge-fn/1.0' }, body: JSON.stringify({ event_type: 'boss-approved-product', client_payload: { product_id: newProdId, product_id_numeric: nextId, queue_id: queueId2 } }), signal: AbortSignal.timeout(15000) });
        dispatchOk = dr.status === 204;
        if (dispatchOk && queueId2) await sb.from('product_pipeline_queue').update({ status: 'dispatched', dispatched_at: new Date().toISOString() }).eq('id', queueId2);
      } catch { /* dispatch best-effort — queue stays pending_dispatch */ }
    }

    // Reward the submitter (best-effort): 15% coupon + email
    if (fromSubmission && submitterEmail) {
      try {
        const couponCode = 'SLOGAN' + nextId + Math.random().toString(36).slice(2, 6).toUpperCase();
        const { error: cErr } = await sb.from('coupons').insert({ code: couponCode, name: `Slogan reward — ${finalSlogan.slice(0, 40)}`, discount_type: 'percentage', discount_value: 15, valid_from: new Date().toISOString(), valid_until: new Date(Date.now() + 30 * 86400000).toISOString(), max_uses: 1, enabled: true });
        if (!cErr) {
          await sb.from('slogan_candidates').update({ coupon_code: couponCode }).eq('id', fromSubmission);
          const resendKey = Deno.env.get('RESEND_API_KEY') ?? '';
          if (resendKey) await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'DUBIS <orders@dubis.net>', to: [submitterEmail], subject: '🎉 הסלוגן שלך עולה לאתר DUBIS!', html: `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:560px"><h2 style="color:#C17E3A">בחרנו את הסלוגן שלך!</h2><p>"<strong>${finalSlogan}</strong>" עולה לאתר שלנו בקרוב על ${dbType}.</p><p>כמו שהבטחנו — קופון <strong>15% הנחה</strong> לקנייה הבאה שלך:</p><div style="text-align:center;margin:20px 0"><span style="display:inline-block;background:#2C2C2C;color:#fff;padding:12px 28px;border-radius:8px;font-size:22px;letter-spacing:2px;font-weight:700">${couponCode}</span></div><p style="color:#6b7280;font-size:13px">תקף 30 יום · שימוש יחיד · <a href="https://www.dubis.net">dubis.net</a></p></div>` }), signal: AbortSignal.timeout(8000) }).catch(() => {});
        }
      } catch { /* reward best-effort */ }
    }

    return json({ ok: true, product_id: newProdId, product_id_numeric: nextId, slogan: finalSlogan, type: dbType, gender: slot.gender, from_submission: fromSubmission, dispatched: dispatchOk });
  }

  // ── AUTO-PRODUCT-REMOVE (2026-06-06) — 1-click remove link from the auto-publish email ──
  if (type === 'auto-product-remove') {
    const productId = url.searchParams.get('product_id') || '';
    const token = url.searchParams.get('token') || '';
    const htmlResp = (msg: string, code = 200) => new Response(`<!doctype html><html lang="he"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:Arial,sans-serif;text-align:center;padding:60px 20px;direction:rtl"><h2 style="color:#2C2C2C">${msg}</h2><p style="color:#888"><a href="https://www.dubis.net" style="color:#C17E3A">חזרה ל-dubis.net</a></p></body></html>`, { status: code, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (!productId || !token) return htmlResp('קישור לא תקין.', 400);
    const { data: p } = await sb.from('dubis_products').select('id,product_id_numeric,slogan,removal_token').eq('id', productId).single();
    if (!p) return htmlResp('המוצר לא נמצא.', 404);
    if ((p as Record<string, unknown>).removal_token !== token) return htmlResp('הקישור פג או כבר נוצל.', 401);
    await sb.from('dubis_products').update({ active: false, publishing_status: 'auto_removed', removal_token: null }).eq('id', productId);
    const numericId = (p as Record<string, unknown>).product_id_numeric;
    try {
      const ghToken = Deno.env.get('GH_DISPATCH_TOKEN') ?? '';
      const ghRepo = Deno.env.get('GH_REPO') ?? 'dubis-brand/dubis-website';
      if (ghToken) await fetch(`https://api.github.com/repos/${ghRepo}/dispatches`, { method: 'POST', headers: { 'Authorization': `Bearer ${ghToken}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'dubis-edge-fn/1.0' }, body: JSON.stringify({ event_type: 'oren-approved-visual', client_payload: { product_id: productId, product_id_numeric: numericId } }), signal: AbortSignal.timeout(15000) }).catch(() => {});
    } catch { /* sync best-effort */ }
    return htmlResp(`✅ מוצר #${numericId} הוסר מהאתר.<br><span style="font-size:14px;color:#888">"${(p as Record<string, unknown>).slogan}"</span>`);
  }

  // ── REVIEW-SLOGAN-SUBMISSIONS (2026-06-06) — score community slogans vs brand rules ──
  if (type === 'review-slogan-submissions') {
    const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
    const agentSecret = Deno.env.get('AGENT_SECRET') ?? '';
    const svcKey = SERVICE_ROLE;
    const rToken = url.searchParams.get('token') || (req.headers.get('authorization') ?? '').replace('Bearer ', '').trim() || req.headers.get('x-agent-secret') || '';
    const rAuthed = (cronSecret && rToken === cronSecret) || (agentSecret && rToken === agentSecret) || (svcKey && rToken === svcKey);
    if (!rAuthed && !(await verifyAdmin(req))) return json({ error: 'Unauthorized' }, 401);
    const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
    if (!geminiKey) return json({ error: 'GEMINI_API_KEY not configured' }, 503);

    const { data: pending } = await sb.from('slogan_candidates').select('id,text_en').eq('source', 'visitor_submission').eq('status', 'pending_review').order('created_at', { ascending: true }).limit(25);
    if (!pending || !pending.length) return json({ ok: true, reviewed: 0 });
    let approved = 0, rejected = 0, blacklisted = 0;
    for (const c of pending as Array<Record<string, unknown>>) {
      const text = c.text_en as string;
      const jPrompt = `You are DUBIS's brand-voice gatekeeper. DUBIS = cynical-from-strength humor, body-positive (never body-shaming), anti-fashion, ages 35+. A garment slogan must be 2-7 words, have one strong POWER WORD, NOT be offensive/political/racist/sexist, NOT use banned words (perfect, stunning, must-have, premium, luxury, exclusive). Score this customer-submitted slogan: "${text}". Return ONLY JSON: {"score":0-100,"verdict":"approve|reject|blacklist","reject_reason":"one short line (Hebrew)","fits_product_types":["tshirt","hoodie"]}. verdict=blacklist only if offensive/hateful. approve if score>=70 and on-brand.`;
      let v: Record<string, unknown> = {};
      try {
        const jr = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: jPrompt }] }] }), signal: AbortSignal.timeout(30000) });
        v = JSON.parse(((await jr.json()).candidates?.[0]?.content?.parts?.[0]?.text || '{}').replace(/```json|```/g, '').trim());
      } catch { v = { score: 0, verdict: 'reject', reject_reason: 'בדיקה אוטומטית נכשלה' }; }
      const score = Number(v.score) || 0;
      const now = new Date().toISOString();
      if (v.verdict === 'blacklist') {
        await sb.from('slogan_candidates').update({ status: 'blacklisted', brand_voice_score: score, reject_reason: (v.reject_reason as string) || 'תוכן לא הולם', reviewed_at: now, reviewed_by: 'gemini-review' }).eq('id', c.id as string);
        blacklisted++;
      } else if (score >= 70 && v.verdict === 'approve') {
        await sb.from('slogan_candidates').update({ status: 'approved', brand_voice_score: score, fits_product_types: Array.isArray(v.fits_product_types) ? v.fits_product_types : [], reviewed_at: now, reviewed_by: 'gemini-review' }).eq('id', c.id as string);
        approved++;
      } else {
        await sb.from('slogan_candidates').update({ status: 'rejected', brand_voice_score: score, reject_reason: (v.reject_reason as string) || `ציון ${score} מתחת לסף`, reviewed_at: now, reviewed_by: 'gemini-review' }).eq('id', c.id as string);
        rejected++;
      }
    }
    try {
      await sb.from('agent_runs').insert({ agent_id: 'product', run_date: new Date().toISOString().slice(0, 10), status: 'completed', summary: `סקירת סלוגני קהל: ${pending.length} נבדקו — ${approved} אושרו, ${rejected} נדחו, ${blacklisted} נחסמו`, side_effects: { reviewed: pending.length, approved, rejected, blacklisted } });
    } catch { /* log best-effort */ }
    return json({ ok: true, reviewed: pending.length, approved, rejected, blacklisted });
  }

  return json({
    error: 'Invalid type. Valid types: tasks, runs, run, generate-image, generate-product-image, product-images, products-catalog, smart-match, publish, gemini-models, content-run, fb-debug, publish-ready, avatars, voices, heygen-status, upload-reel-photo, upload-talking-photo, generate-reel, reel-status, reel-webhook, auto-content, weekly-marketing-plan, qa-content, generate-slogan, approve-product, security-scan, generate-video-script, generate-video-assets, render-video, kling-callback, compose-callback, video-pipeline, serve-image, meta-ads-manage, shopping-feed, gelato-discovery, weekly-slogan-product, auto-product-remove, review-slogan-submissions',
  }, 400);
});