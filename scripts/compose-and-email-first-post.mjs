#!/usr/bin/env node
// compose-and-email-first-post.mjs
// After the sample batch completes:
//   1. Pick the strongest persona (priority: has reel; else best hero+back combo)
//   2. Upload hero + back + reel to Supabase Storage for public URLs
//   3. Compose HE + EN captions following memory/copy-playbook.md 3-beat formula
//   4. Run them through ?type=copy-qa for score
//   5. Send Resend email to dubis.brand@gmail.com with:
//        - batch summary (X/10 complete)
//        - first post preview (caption + image + reel embed)
//        - approve-to-publish instructions
//
// Run: node scripts/compose-and-email-first-post.mjs [--persona men-5] [--dry-run]

import fs from 'node:fs';
import path from 'node:path';

const ARGS = process.argv.slice(2);
const onlyPersona = ARGS.includes('--persona') ? ARGS[ARGS.indexOf('--persona') + 1] : null;
const dryRun = ARGS.includes('--dry-run');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ntzwvqtpdmvvavbhuyeb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;

if (!SUPABASE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY required');
if (!RESEND_KEY) throw new Error('RESEND_API_KEY required');

const SAMPLES_DIR = path.resolve('videos/il-campaign/samples-2026-05-19');
const MANIFEST_PATH = path.join(SAMPLES_DIR, '_manifest.json');

// HE captions hand-crafted per persona, following memory/copy-playbook.md 3-beat formula:
// Hook (cynical) → Agitation (real-life) → DUBIS Drop (identity-based CTA)
// EN captions are SEPARATELY WRITTEN — never translations.
const CAPTIONS = {
  'men-1': {
    he: `כולם פתאום קרדיו בחמש בבוקר.

אני? הקרדיו שלי 14:00, הספה, סדרה. הריאות שלי נושמות בקצב שלהן.

קפוצון לכל השאר. dubis.net/#product-3`,
    en: `Suddenly everyone runs cardio at 5 AM.

Mine starts at 2 PM, on the couch, with a show. My lungs breathe at their own pace.

A hoodie for the rest of us. dubis.net/?p=3`,
  },
  'men-2': {
    he: `הילדים שלי שנים אומרים לי שאני לא דוגמן.

אז מה. גם אני לא רציתי. אני רוצה קפה חם ושעה בלי שאלות.

קפוצון לאלה שהפסיקו להעמיד פנים. dubis.net/#product-6`,
    en: `My kids have spent years telling me I'm not a model.

So what. I never wanted to be. I want hot coffee and one hour without questions.

A hoodie for everyone who stopped pretending. dubis.net/?p=6`,
  },
  'men-3': {
    he: `אופנה? עזבו אותי כבר.

אני בפקק. שעתיים הביתה. כל מה שאני רוצה זה משהו שלא דורש ממני להחליט.

הקפוצון הזה לא שואל שאלות. בדיוק כמוני. dubis.net/#product-15`,
    en: `Fashion? Leave me alone already.

I'm in traffic. Two hours home. All I want is something that doesn't ask me to decide.

This hoodie asks nothing of me. Same. dubis.net/?p=15`,
  },
  'men-4': {
    he: `המומחים אומרים לתת למוח לנוח.

המוח שלי לא קיבל את ההזמנה. הוא עובד שלוש משמרות בלי תפסיק.

החולצה אומרת את האמת בלי שאני אצטרך לפצות. dubis.net/#product-9`,
    en: `Experts say give the mind a rest.

Mine never got the memo. It works three shifts, no breaks.

The shirt says it out loud so I don't have to. dubis.net/?p=9`,
  },
  'men-5': {
    he: `כולם פתאום עם רוטינת בוקר.

שלי מתחילה ב-12:00. קפה. חדשות. ספה ב-20:00.

החולצה אומרת את האמת. נולדתי לישון. dubis.net/#product-8`,
    en: `Everyone suddenly has a morning routine.

Mine starts at noon. Coffee. Headlines. Couch by 8.

The shirt says what I won't. Born to nap, forced to work. dubis.net/?p=8`,
  },
  'women-1': {
    he: `הם אמרו לי שאני יכולה.

לקחתי שלוף קצר במקום. מסתבר שזה היה הדבר הכי חכם של היום.

חולצה לאלה שהפנימו את זה. dubis.net/#product-11`,
    en: `They told me I could do it.

I took a short nap instead. Turned out smarter than anything else that day.

A shirt for everyone who got the memo. dubis.net/?p=11`,
  },
  'women-2': {
    he: `סדנאות מוטיבציה. הצטרפתי לכולן.

ואז הצטרפתי למועדון אפס-מוטיבציה. דמי החבר חיים שלמים.

הקפוצון הזה הוא תעודת חבר. dubis.net/#product-13`,
    en: `Motivation workshops. I joined them all.

Then I joined the Zero Motivation Club. Lifetime membership.

This hoodie is the membership card. dubis.net/?p=13`,
  },
  'women-3': {
    he: `המטרה שלי השנה? קיום מינימלי.

כן. גם זה הישג. גם זה כותרת. גם עליו אפשר להיות גאה.

הקפוצון אומר את זה ברור, בלי תירוצים. dubis.net/#product-16`,
    en: `My goal this year? Minimal existence.

Yes. That counts too. That's a headline too. Something to be proud of.

The hoodie says it loud, no excuses. dubis.net/?p=16`,
  },
  'women-4': {
    he: `יש לי תעודה. מומחית בתשישות.

זה לוקח שנים להגיע לרמה הזאת. בית, ילדים, חתול שדורש תשומת לב מ-3 בלילה.

הזיפ-הודי הזה אומר את זה בלי שאצטרך לדבר. dubis.net/#product-17`,
    en: `I have credentials. Licensed in exhaustion.

It takes years to reach this level. House, kids, a cat that demands attention at 3 AM.

This zip-hoodie says it so I don't have to. dubis.net/?p=17`,
  },
  'women-5': {
    he: `אמרו לי לפני 20 שנה — "את יפה יותר כשנוח לך".

20 שנה הייתי צריכה להאמין. עכשיו אני מאמינה.

חולצה לבחורה שגילתה. dubis.net/#product-31`,
    en: `Someone told me 20 years ago — "you're prettier when you're comfortable."

Took 20 years to believe it. Now I do.

A shirt for the woman who figured it out. dubis.net/?p=31`,
  },
};

const HASHTAGS_HE = ['#DUBIS', '#דוביס', '#גוף_אמיתי', '#בלי_לדפוק_חשבון', '#קפוצון', '#לכל_השאר'];
const HASHTAGS_EN = ['#DUBIS', '#realbodies', '#fortherestofus', '#hoodie', '#antifashion'];

const PRODUCTS = {
  3:  { type: 'hoodie', color: 'Forest-Green', slogan: 'Napping is my cardio' },
  6:  { type: 'hoodie', color: 'Charcoal', slogan: 'Not a model. Never wanted to be.' },
  15: { type: 'hoodie', color: 'Navy', slogan: 'Fashion? I prefer comfort.' },
  9:  { type: 'zip-hoodie', color: 'Navy', slogan: 'Certified overthinker' },
  8:  { type: 't-shirt', color: 'Red', slogan: 'Born to nap, forced to work' },
  11: { type: 't-shirt', color: 'Cream', slogan: 'She believed she could, so she took a nap' },
  13: { type: 'hoodie', color: 'Cream', slogan: 'Zero Motivation Club' },
  16: { type: 'hoodie', color: 'White', slogan: 'My goal: minimal EXISTENCE.' },
  17: { type: 'zip-hoodie', color: 'Black', slogan: 'Experienced in EXHAUSTION.' },
  31: { type: 't-shirt', color: 'White', slogan: "You're prettier when you're comfortable." },
};

const PERSONA_PRODUCT = {
  'men-1': 3, 'men-2': 6, 'men-3': 15, 'men-4': 9, 'men-5': 8,
  'women-1': 11, 'women-2': 13, 'women-3': 16, 'women-4': 17, 'women-5': 31,
};

async function uploadToStorage(localPath, storagePath) {
  const bytes = fs.readFileSync(localPath);
  const mime = localPath.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg';
  const url = `${SUPABASE_URL}/storage/v1/object/dubis-images/${storagePath}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': mime,
      'x-upsert': 'true',
    },
    body: bytes,
  });
  if (!res.ok) {
    const text = await res.text();
    if (!text.includes('Duplicate')) throw new Error(`upload ${storagePath}: ${res.status} ${text.slice(0, 200)}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/dubis-images/${storagePath}`;
}

async function runCopyQA(captionHe, captionEn, slogan, productId) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/agents?type=copy-qa&token=${SUPABASE_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caption_he: captionHe, caption_en: captionEn, slogan, product_id: productId, lang: 'he' }),
  });
  if (!res.ok) {
    return { score: null, error: `qa ${res.status}` };
  }
  return res.json();
}

function pickStrongest(manifest, availableFiles) {
  // Priority: has front + back + reel + no error
  const ranked = manifest.samples.filter((s) => {
    return availableFiles[s.persona_id]?.front && availableFiles[s.persona_id]?.back && availableFiles[s.persona_id]?.reel;
  });
  if (ranked.length === 0) return null;

  // Within complete set: prefer men-5 (Red t-shirt, validated first) as a known-good baseline,
  // OR the persona oren explicitly named via --persona flag
  if (onlyPersona) return ranked.find((s) => s.persona_id === onlyPersona) || ranked[0];
  return ranked.find((s) => s.persona_id === 'men-5') || ranked[0];
}

function detectAvailable() {
  const out = {};
  for (const id of Object.keys(PERSONA_PRODUCT)) {
    out[id] = {
      front: fs.existsSync(path.join(SAMPLES_DIR, `${id}-hero.jpg`)),
      back:  fs.existsSync(path.join(SAMPLES_DIR, `${id}-back.jpg`)),
      reel:  fs.existsSync(path.join(SAMPLES_DIR, `${id}-reel.mp4`)),
    };
  }
  return out;
}

function buildEmailHtml({ batchSummary, pickedPersona, captionHe, captionEn, qa, frontUrl, backUrl, reelUrl, available }) {
  const personaList = Object.keys(PERSONA_PRODUCT).map((id) => {
    const a = available[id] || {};
    const stat = a.front && a.back && a.reel ? '✅ מלא' : a.front && a.back ? '🟡 חזית+גב' : a.front ? '🟠 חזית בלבד' : '❌ חסר';
    const p = PERSONA_PRODUCT[id];
    const info = PRODUCTS[p];
    return `<tr><td style="padding:6px 10px;border-bottom:1px solid #2a2a2a">${id}</td><td style="padding:6px 10px;border-bottom:1px solid #2a2a2a">${info.color} ${info.type}</td><td style="padding:6px 10px;border-bottom:1px solid #2a2a2a;color:#c17e3a;font-style:italic">${info.slogan}</td><td style="padding:6px 10px;border-bottom:1px solid #2a2a2a">${stat}</td></tr>`;
  }).join('');

  const personaProduct = PERSONA_PRODUCT[pickedPersona];
  const productInfo = PRODUCTS[personaProduct];

  return `<!DOCTYPE html>
<html lang="he" dir="rtl"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0d0d0d;color:#e8e8e8;font-family:'Segoe UI',Arial,sans-serif;direction:rtl;">
<div style="max-width:680px;margin:0 auto;padding:24px;">

<div style="background:linear-gradient(135deg,#1a1a1a 0%,#241a10 100%);border:1px solid #2a2a2a;border-right:6px solid #c17e3a;border-radius:14px;padding:24px;margin-bottom:20px;">
<div style="color:#9a9a9a;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">DUBIS × Higgsfield · עדכון אצוות נכסים</div>
<h1 style="color:#c17e3a;margin:0 0 6px;font-size:24px;font-family:'Anton','Impact',sans-serif;font-weight:400;">${batchSummary.complete}/10 פרסונות מוכנות — פוסט ראשון לאישור</h1>
<p style="color:#f5f0e8;margin:6px 0 0;font-size:14px;">הצינור החדש (virtual_model_tryout + Seedance i2v) מוכח. הקרדיטים החדשים שלך אפשרו להשלים את החסר. למטה: סיכום האצווה + פוסט ראשון מוכן לפרסום בעברית ובאנגלית.</p>
</div>

<div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:20px;margin-bottom:18px;">
<h2 style="color:#c17e3a;font-size:18px;margin:0 0 12px;font-family:'Anton',sans-serif;letter-spacing:.4px;">📊 סיכום אצווה</h2>
<table style="width:100%;border-collapse:collapse;font-size:13px;">
<thead><tr style="color:#c17e3a;text-align:right"><th style="padding:6px 10px;border-bottom:1px solid #2a2a2a">Persona</th><th style="padding:6px 10px;border-bottom:1px solid #2a2a2a">Garment</th><th style="padding:6px 10px;border-bottom:1px solid #2a2a2a">Slogan</th><th style="padding:6px 10px;border-bottom:1px solid #2a2a2a">סטטוס</th></tr></thead>
<tbody>${personaList}</tbody>
</table>
<p style="color:#9a9a9a;font-size:12px;margin:12px 0 0;">קישור לתיקייה: <code style="background:#0a0a0a;color:#e8c890;padding:2px 6px;border-radius:4px;font-size:11px;">dubis-website/videos/il-campaign/samples-2026-05-19/</code></p>
<p style="color:#9a9a9a;font-size:12px;margin:6px 0 0;">Gallery: <a href="file:///C:/Users/tehar/OneDrive/Cladue%20Projects/Dubis/dubis-website/videos/il-campaign/samples-2026-05-19/GALLERY.html" style="color:#c17e3a">פתח GALLERY.html ב-Chrome</a></p>
</div>

<div style="background:#1a1a1a;border:1px solid #2a2a2a;border-right:4px solid #5bba6f;border-radius:12px;padding:20px;margin-bottom:18px;">
<h2 style="color:#5bba6f;font-size:18px;margin:0 0 6px;font-family:'Anton',sans-serif;letter-spacing:.4px;">✍️ פוסט ראשון לאישור — ${pickedPersona}</h2>
<p style="color:#9a9a9a;font-size:12px;margin:0 0 16px;">${productInfo.color} ${productInfo.type} · slogan "${productInfo.slogan}" · QA score: <b style="color:${qa.score >= 75 ? '#5bba6f' : qa.score >= 60 ? '#e0a64a' : '#e35d5d'}">${qa.score || 'n/a'}</b></p>

<div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
<div style="flex:1;min-width:200px;"><img src="${frontUrl}" style="width:100%;border-radius:8px;display:block;" alt="front"><div style="text-align:center;color:#9a9a9a;font-size:11px;margin-top:4px;">חזית</div></div>
<div style="flex:1;min-width:200px;"><img src="${backUrl}" style="width:100%;border-radius:8px;display:block;" alt="back"><div style="text-align:center;color:#9a9a9a;font-size:11px;margin-top:4px;">גב + סלוגן</div></div>
</div>

<div style="background:#0f0f0f;border-radius:8px;padding:14px;margin-bottom:14px;">
<div style="color:#c17e3a;font-size:11px;letter-spacing:1px;margin-bottom:6px;">CAPTION עברית (3-beat per copy-playbook)</div>
<div style="color:#e8e8e8;font-size:14px;line-height:1.7;white-space:pre-wrap;">${captionHe}</div>
<div style="color:#9a9a9a;font-size:12px;margin-top:8px;">${HASHTAGS_HE.join(' ')}</div>
</div>

<div style="background:#0f0f0f;border-radius:8px;padding:14px;margin-bottom:14px;">
<div style="color:#c17e3a;font-size:11px;letter-spacing:1px;margin-bottom:6px;">CAPTION אנגלית (rooted, not translated)</div>
<div style="color:#e8e8e8;font-size:14px;line-height:1.7;white-space:pre-wrap;" dir="ltr">${captionEn}</div>
<div style="color:#9a9a9a;font-size:12px;margin-top:8px;" dir="ltr">${HASHTAGS_EN.join(' ')}</div>
</div>

<div style="background:#0a0a0a;border-radius:8px;padding:10px;text-align:center;">
<p style="color:#9a9a9a;font-size:12px;margin:0 0 8px;">Reel 10s 9:16:</p>
<a href="${reelUrl}" style="color:#c17e3a;font-size:13px;text-decoration:none;">🎬 ${reelUrl.split('/').pop()}</a>
</div>
</div>

<div style="background:#1a1a1a;border:1px solid #2a2a2a;border-right:4px solid #c17e3a;border-radius:12px;padding:20px;margin-bottom:18px;">
<h2 style="color:#c17e3a;font-size:18px;margin:0 0 8px;font-family:'Anton',sans-serif;letter-spacing:.4px;">▶️ אישור פרסום</h2>
<p style="color:#e8e8e8;font-size:14px;margin:6px 0;">אם הפוסט נראה לך — ענה למייל הזה <b style="color:#5bba6f">"אשר ופרסם"</b> ואני פותח containers ב-IG Graph + FB ושולח את ה-Reel למסלול הפרסום (TikTok דרך Late.io + IG/FB Reels דרך media_publish).</p>
<p style="color:#e8e8e8;font-size:14px;margin:6px 0;">אם תיקונים — ענה עם <b style="color:#e0a64a">"תקן: ..."</b> ואני אגיב.</p>
<p style="color:#e8e8e8;font-size:14px;margin:6px 0;">לאחר אישור הפוסט הראשון הזה — תוכנית התוכן השבועית רצה אוטומטית, ואני אעדכן את הדוח היומי במה שנעלה.</p>
</div>

<div style="color:#9a9a9a;font-size:11px;text-align:center;padding:14px 0;border-top:1px solid #2a2a2a;margin-top:20px;">
DUBIS × Higgsfield · נשלח אוטומטית ע"י Claude · אצווה 2026-05-19
</div>
</div></body></html>`;
}

async function sendEmail(html, subject) {
  if (dryRun) {
    const path = 'C:/tmp/dubis-email-preview.html';
    fs.writeFileSync(path, html);
    console.log(`DRY RUN — saved preview to ${path}`);
    return { id: 'dry-run' };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'DUBIS Higgsfield <orders@dubis.net>',
      to: ['dubis.brand@gmail.com', 'teharlev1976@gmail.com'],
      subject,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const available = detectAvailable();
  const completeCount = Object.values(available).filter((a) => a.front && a.back && a.reel).length;
  const batchSummary = { complete: completeCount, total: 10 };

  console.log(`Batch: ${completeCount}/10 complete`);

  // Pick strongest persona
  const candidates = Object.keys(available).filter((id) => available[id].front && available[id].back && available[id].reel);
  if (!candidates.length) { console.error('No complete persona — cannot compose first post'); process.exit(1); }
  const pickedId = onlyPersona && candidates.includes(onlyPersona) ? onlyPersona : (candidates.includes('men-5') ? 'men-5' : candidates[0]);
  console.log(`Picked persona: ${pickedId}`);

  const product = PERSONA_PRODUCT[pickedId];
  const captions = CAPTIONS[pickedId];
  if (!captions) throw new Error(`No captions for ${pickedId}`);

  // Upload to Supabase Storage
  console.log('Uploading assets to Supabase Storage…');
  const stamp = Date.now();
  const frontUrl = await uploadToStorage(path.join(SAMPLES_DIR, `${pickedId}-hero.jpg`), `samples-2026-05-19/${pickedId}-hero-${stamp}.jpg`);
  const backUrl  = await uploadToStorage(path.join(SAMPLES_DIR, `${pickedId}-back.jpg`), `samples-2026-05-19/${pickedId}-back-${stamp}.jpg`);
  const reelUrl  = await uploadToStorage(path.join(SAMPLES_DIR, `${pickedId}-reel.mp4`), `samples-2026-05-19/${pickedId}-reel-${stamp}.mp4`);
  console.log(`  front:  ${frontUrl}`);
  console.log(`  back:   ${backUrl}`);
  console.log(`  reel:   ${reelUrl}`);

  // Copy-QA on captions
  console.log('Running copy-qa…');
  const qa = await runCopyQA(captions.he, captions.en, PRODUCTS[product].slogan, product);
  console.log(`  QA score: ${qa.score} (passed: ${qa.passed})`);
  if (qa.issues?.length) console.log(`  issues: ${qa.issues.join(' | ')}`);

  // Build + send email
  console.log('Sending email to DUBIS…');
  const html = buildEmailHtml({
    batchSummary, pickedPersona: pickedId,
    captionHe: captions.he, captionEn: captions.en,
    qa, frontUrl, backUrl, reelUrl, available,
  });
  const result = await sendEmail(html, `🎨 DUBIS Higgsfield — ${completeCount}/10 מוכנות + פוסט ראשון לאישור (${pickedId})`);
  console.log('Email result:', result);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
