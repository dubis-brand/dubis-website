#!/usr/bin/env node
/**
 * DUBIS Carousel v2 — fix prominent badge + add back-of-shirt slogans
 *
 * Front images (6) — replace images/carousel/carousel-1..6.jpg
 *   - Gemini generates real-looking person in plain shirt/hoodie
 *   - Canvas overlay draws a LARGE white DUBIS badge on the chest
 *
 * Back images (3) — write images/carousel/carousel-back-1..3.jpg
 *   - Gemini generates rear view of person walking away
 *   - Canvas overlay draws the slogan in large bold text across the back
 *
 * Run: node scripts/generate-carousel-v2.js
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, registerFont } = require('canvas');

// ── env ───────────────────────────────────────────────────────────────────────
function loadEnv() {
  const candidates = [
    path.resolve(__dirname, '../.env.local'),
    path.resolve(__dirname, '../../../../.env.local'),
    'C:\\Users\\tehar\\OneDrive\\Cladue Projects\\Dubis\\dubis-website\\.env.local',
  ];
  const envPath = candidates.find(p => fs.existsSync(p));
  if (!envPath) throw new Error('.env.local not found. tried: ' + candidates.join(', '));
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[k] = process.env[k] ?? v;
  }
}
loadEnv();

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('GEMINI_API_KEY missing'); process.exit(1); }

// optional Impact font for nicer overlay
const IMPACT = 'C:\\Windows\\Fonts\\impact.ttf';
if (fs.existsSync(IMPACT)) { registerFont(IMPACT, { family: 'Impact' }); }
const ARIAL_BLACK = 'C:\\Windows\\Fonts\\ariblk.ttf';
if (fs.existsSync(ARIAL_BLACK)) { registerFont(ARIAL_BLACK, { family: 'Arial Black' }); }

const OUT_DIR = path.resolve(__dirname, '../images/carousel');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ── prompts ───────────────────────────────────────────────────────────────────

const FRONT_ITEMS = [
  { id: 1, color: 'black',  garment: 't-shirt', desc: 'a man in his 40s, average build, scruffy beard, candid' },
  { id: 2, color: 'cream',  garment: 't-shirt', desc: 'a woman in her late 30s, curvy figure, dark hair, candid smile' },
  { id: 3, color: 'navy',   garment: 'hoodie',  desc: 'a man in his early 50s, slightly heavier build, salt-and-pepper hair' },
  { id: 4, color: 'charcoal grey', garment: 'hoodie', desc: 'a woman in her 40s, real body, glasses, no makeup' },
  { id: 5, color: 'white',  garment: 't-shirt', desc: 'a man in his late 30s, normal build, short dark hair' },
  { id: 6, color: 'forest green', garment: 't-shirt', desc: 'a woman in her late 40s, full-figured, brown hair, warm smile' },
];

function frontPrompt(item) {
  return `A real-looking ordinary person (not a model) — ${item.desc} — wearing a ${item.color} ${item.garment}. Street photography style, natural daylight. The shirt is plain ${item.color} fabric with ABSOLUTELY NO text, no logo, no graphics, no print whatsoever — the front of the shirt is completely blank. FRAMING IS CRITICAL: a WIDE waist-up shot showing the FULL CHEST and TORSO clearly in the lower half of the frame — the person's face is in the upper third, and the entire chest area must be visible and unobstructed. The chest is the focal point. Person facing the camera. Candid, authentic, photorealistic. Square 1:1 composition. Plain blurred outdoor background (sidewalk, café exterior, brick wall). No watermark, no captions.`;
}

const BACK_ITEMS = [
  { id: 1, color: 'black',          slogan: "BUILT DIFFERENT.\nTHAT'S THE POINT.", desc: 'a man, average build, walking away on a city sidewalk' },
  { id: 2, color: 'cream',          slogan: "FASHION FINALLY\nCAUGHT UP.",         desc: 'a woman, real body, walking away in a casual neighborhood' },
  { id: 3, color: 'charcoal grey',  slogan: "LOW MAINTENANCE,\nHIGH VALUE.",       desc: 'a person, normal build, walking away on a quiet street' },
];

function backPrompt(item) {
  return `Street photography, rear view. ${item.desc}, wearing a plain ${item.color} t-shirt with ABSOLUTELY NO text, no print, no logo — the back is completely blank fabric. The person is walking AWAY from the camera so we see the full back of the shirt clearly framed in the center of the image. Natural daylight, candid, photorealistic, authentic ordinary person (not a model). Square 1:1 composition. Plain background (sidewalk, urban street). No watermark, no captions.`;
}

// ── Gemini ────────────────────────────────────────────────────────────────────

const MODEL = 'gemini-2.5-flash-image';

async function generate(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
    }),
    signal: AbortSignal.timeout(120_000)
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const img = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
  if (!img) {
    const txt = parts.find(p => p.text)?.text || '';
    throw new Error(`no image in response. text="${txt.slice(0, 200)}"`);
  }
  return Buffer.from(img.inlineData.data, 'base64');
}

// ── overlays ──────────────────────────────────────────────────────────────────

async function overlayFrontBadge(srcPath, dstPath) {
  const img = await loadImage(srcPath);
  const W = img.width, H = img.height;
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, W, H);

  // badge geometry — ~32% width, ~10% height, centred on chest (~72% from top)
  const badgeW = Math.round(W * 0.32);
  const badgeH = Math.round(badgeW * 0.32);
  const badgeX = Math.round((W - badgeW) / 2);
  const badgeY = Math.round(H * 0.70);
  const radius = Math.round(badgeH * 0.10);

  // soft drop-shadow for "sewn / printed" look
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = Math.round(badgeH * 0.25);
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = Math.round(badgeH * 0.06);

  // rounded-rect path
  ctx.beginPath();
  ctx.moveTo(badgeX + radius, badgeY);
  ctx.lineTo(badgeX + badgeW - radius, badgeY);
  ctx.quadraticCurveTo(badgeX + badgeW, badgeY, badgeX + badgeW, badgeY + radius);
  ctx.lineTo(badgeX + badgeW, badgeY + badgeH - radius);
  ctx.quadraticCurveTo(badgeX + badgeW, badgeY + badgeH, badgeX + badgeW - radius, badgeY + badgeH);
  ctx.lineTo(badgeX + radius, badgeY + badgeH);
  ctx.quadraticCurveTo(badgeX, badgeY + badgeH, badgeX, badgeY + badgeH - radius);
  ctx.lineTo(badgeX, badgeY + radius);
  ctx.quadraticCurveTo(badgeX, badgeY, badgeX + radius, badgeY);
  ctx.closePath();

  // white fill
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.restore();

  // subtle inner border to look like a stitched / printed patch
  ctx.save();
  ctx.lineWidth = Math.max(2, Math.round(badgeH * 0.025));
  ctx.strokeStyle = 'rgba(44,44,44,0.55)';
  ctx.beginPath();
  ctx.moveTo(badgeX + radius, badgeY);
  ctx.lineTo(badgeX + badgeW - radius, badgeY);
  ctx.quadraticCurveTo(badgeX + badgeW, badgeY, badgeX + badgeW, badgeY + radius);
  ctx.lineTo(badgeX + badgeW, badgeY + badgeH - radius);
  ctx.quadraticCurveTo(badgeX + badgeW, badgeY + badgeH, badgeX + badgeW - radius, badgeY + badgeH);
  ctx.lineTo(badgeX + radius, badgeY + badgeH);
  ctx.quadraticCurveTo(badgeX, badgeY + badgeH, badgeX, badgeY + badgeH - radius);
  ctx.lineTo(badgeX, badgeY + radius);
  ctx.quadraticCurveTo(badgeX, badgeY, badgeX + radius, badgeY);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  // text "D U B I S" (spaced) — bold dark
  const text = 'D U B I S';
  let fontSize = Math.round(badgeH * 0.55);
  ctx.font = `bold ${fontSize}px "Impact", "Arial Black", sans-serif`;
  // fit-to-width
  while (ctx.measureText(text).width > badgeW * 0.82 && fontSize > 8) {
    fontSize -= 1;
    ctx.font = `bold ${fontSize}px "Impact", "Arial Black", sans-serif`;
  }
  ctx.fillStyle = '#2C2C2C'; // DUBIS charcoal
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, badgeX + badgeW / 2, badgeY + badgeH / 2 + Math.round(fontSize * 0.04));

  fs.writeFileSync(dstPath, c.toBuffer('image/jpeg', { quality: 0.92 }));
}

async function overlayBackSlogan(srcPath, dstPath, slogan, shirtColor) {
  const img = await loadImage(srcPath);
  const W = img.width, H = img.height;
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, W, H);

  // determine text color based on shirt color
  const dark = ['black', 'navy', 'charcoal grey', 'forest green'].some(x => shirtColor.toLowerCase().includes(x));
  const inkColor = dark ? '#F5F0E8' : '#2C2C2C'; // cream on dark / charcoal on light
  const shadowColor = dark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.4)';

  const lines = slogan.split('\n');
  const blockW = Math.round(W * 0.62);   // 62% of width — across the back
  const blockX = (W - blockW) / 2;
  const blockYCenter = Math.round(H * 0.42);  // upper-back

  // pick font size to fit widest line within blockW
  let fontSize = Math.round(H * 0.075);
  ctx.font = `bold ${fontSize}px "Impact", "Arial Black", sans-serif`;
  let widest = Math.max(...lines.map(l => ctx.measureText(l).width));
  while (widest > blockW && fontSize > 14) {
    fontSize -= 1;
    ctx.font = `bold ${fontSize}px "Impact", "Arial Black", sans-serif`;
    widest = Math.max(...lines.map(l => ctx.measureText(l).width));
  }

  const lineH = Math.round(fontSize * 1.05);
  const totalH = lineH * lines.length;
  const startY = blockYCenter - totalH / 2 + lineH / 2;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = shadowColor;
  ctx.shadowBlur = Math.round(fontSize * 0.18);
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = Math.round(fontSize * 0.04);
  ctx.fillStyle = inkColor;

  lines.forEach((line, i) => {
    ctx.fillText(line, W / 2, startY + i * lineH);
  });

  fs.writeFileSync(dstPath, c.toBuffer('image/jpeg', { quality: 0.92 }));
}

// ── main ──────────────────────────────────────────────────────────────────────

async function run() {
  const args = process.argv.slice(2);
  const onlyFront = args.includes('--front');
  const onlyBack  = args.includes('--back');
  const runFront  = !onlyBack;
  const runBack   = !onlyFront;

  console.log(`DUBIS carousel v2 generator — front=${runFront} back=${runBack}`);
  console.log(`output: ${OUT_DIR}\n`);

  const results = [];

  // raw/ holds the unmodified Gemini outputs so we can re-overlay without re-calling the API
  const RAW_DIR = path.resolve(__dirname, '../images/carousel/raw');
  if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
  const overlayOnly = args.includes('--overlay-only');

  if (runFront) {
    for (const item of FRONT_ITEMS) {
      process.stdout.write(`[front ${item.id}/6] ${item.color} ${item.garment}: `);
      try {
        const rawPath = path.join(RAW_DIR, `front-${item.id}.png`);
        if (!overlayOnly || !fs.existsSync(rawPath)) {
          const buf = await generate(frontPrompt(item));
          fs.writeFileSync(rawPath, buf);
        }
        const dst = path.join(OUT_DIR, `carousel-${item.id}.jpg`);
        await overlayFrontBadge(rawPath, dst);
        console.log('OK');
        results.push({ kind: 'front', id: item.id, ok: true });
      } catch (e) {
        console.log('FAIL', e.message);
        results.push({ kind: 'front', id: item.id, ok: false, err: e.message });
      }
      if (!overlayOnly) await new Promise(r => setTimeout(r, 1500));
    }
  }

  if (runBack) {
    for (const item of BACK_ITEMS) {
      process.stdout.write(`[back  ${item.id}/3] ${item.color}: `);
      try {
        const rawPath = path.join(RAW_DIR, `back-${item.id}.png`);
        if (!overlayOnly || !fs.existsSync(rawPath)) {
          const buf = await generate(backPrompt(item));
          fs.writeFileSync(rawPath, buf);
        }
        const dst = path.join(OUT_DIR, `carousel-back-${item.id}.jpg`);
        await overlayBackSlogan(rawPath, dst, item.slogan, item.color);
        console.log('OK');
        results.push({ kind: 'back', id: item.id, ok: true });
      } catch (e) {
        console.log('FAIL', e.message);
        results.push({ kind: 'back', id: item.id, ok: false, err: e.message });
      }
      if (!overlayOnly) await new Promise(r => setTimeout(r, 1500));
    }
  }

  console.log('\n— summary —');
  for (const r of results) {
    console.log(`  ${r.kind}-${r.id}: ${r.ok ? 'OK' : 'FAIL — ' + r.err}`);
  }
}

run().catch(e => { console.error('FATAL', e); process.exit(1); });
