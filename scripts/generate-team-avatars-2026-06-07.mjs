#!/usr/bin/env node
// generate-team-avatars-2026-06-07.mjs
// DUBIS "AI agents as humans" content series — character avatars.
// Each of the 12 real agents gets a consistent HUMAN character portrait
// (40+, real body, Israeli, warm, wearing DUBIS). NOT robots — people the
// audience can connect with. A DUBIS name tag is composited downstream by
// node-canvas (AI cannot render readable text — the "DUBS"/"DUBISM" lesson).
//
// Shared photographic style => looks like one team shot from the same session.
//
// Run: node scripts/generate-team-avatars-2026-06-07.mjs [--agent boss] [--force]
// Env: GEMINI_API_KEY (read from .env.local)
//
// Idempotent: skips existing unless --force.

import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

// --- load GEMINI_API_KEY from .env.local if not already in env ---
let KEY = process.env.GEMINI_API_KEY;
if (!KEY) {
  try {
    const envTxt = fs.readFileSync(path.resolve('.env.local'), 'utf8');
    const m = envTxt.match(/^GEMINI_API_KEY\s*=\s*(.+)$/m);
    if (m) KEY = m[1].trim().replace(/^["']|["']$/g, '');
  } catch {}
}
if (!KEY) { console.error('GEMINI_API_KEY required'); process.exit(1); }

const ARGS = process.argv.slice(2);
const onlyAgent = ARGS.includes('--agent') ? ARGS[ARGS.indexOf('--agent') + 1] : null;
const force = ARGS.includes('--force');

const OUT_BASE = path.resolve('images/team');
fs.mkdirSync(OUT_BASE, { recursive: true });

// Shared style — same "team photoshoot" look across all 12 so they read as one crew.
const STYLE = `Ultra-realistic editorial portrait photograph. Shot on Sony A7IV 85mm f/1.8 ISO 200, soft natural window light, warm neutral studio background in cream/charcoal tones with gentle bokeh, Kodak Portra 400 film grain, visible skin pores and natural imperfections, real-skin micro-texture, natural eye catchlights, shoulders-up to chest-up framing, centered. Subject is a real everyday Israeli person 38-55, REAL body (a little soft, not a model, not gym-built), warm and approachable, slight knowing humor in the eyes. Wearing DUBIS apparel with a plain blank lanyard name badge clipped at chest (badge left blank, no text). 2K resolution.`;

const NEG = `Negative: no text on clothing, no readable logos, no plastic skin, no airbrushed or over-smoothed skin, no perfect symmetry, no AI glow, no studio gloss, no fashion-model glamour, no anorexic or gym-built physique, no robot, no android, no cyborg, no metallic skin, no glowing eyes, no sci-fi, no group photo, no sunglasses, no hat covering face, no exaggerated grin.`;

// The 12 real DUBIS agents -> human characters.
const TEAM = [
  { id: 'boss',      name: 'גדי',   look: 'a ~50-year-old man, short salt-and-pepper hair and stubble, slight belly, reading glasses pushed up on his forehead, holding a coffee mug, charcoal DUBIS hoodie, tired-but-sharp warm eyes, faint dry smirk like he has seen it all' },
  { id: 'content',   name: 'שירה',  look: 'a ~42-year-old woman, dark curly shoulder-length hair, expressive warm face, small reading glasses, cream DUBIS t-shirt, holding a worn notebook and pen, thoughtful' },
  { id: 'cto',       name: 'רון',   look: 'a ~45-year-old man, short messy dark hair, visible under-eye circles, light stubble, navy DUBIS hoodie, holding a laptop, calm-under-fire expression' },
  { id: 'design',    name: 'נועה',  look: 'a ~38-year-old woman, artistic, dark hair in a loose bun with a colorful scarf, a few paint flecks on her hands, honey-brown DUBIS t-shirt, lively creative energy' },
  { id: 'email',     name: 'מירי',  look: 'a ~52-year-old woman, warm motherly face, glasses on a beaded chain, soft cardigan over a cream DUBIS t-shirt, kind patient smile' },
  { id: 'marketing', name: 'איתי',  look: 'a ~40-year-old man, short hair, slightly wired energetic look, navy DUBIS t-shirt, holding a phone showing charts, faint dark circles, a bit manic' },
  { id: 'planner',   name: 'דורון', look: 'a ~48-year-old man, calm strategist, glasses, short greying hair, charcoal DUBIS t-shirt, holding a whiteboard marker, composed' },
  { id: 'product',   name: 'טל',    look: 'a ~44-year-old person, hands-on maker, a tailor tape measure draped around the neck, light gray DUBIS t-shirt, sleeves pushed up, focused practical look' },
  { id: 'security',  name: 'בני',   look: 'a ~46-year-old man, dark DUBIS hoodie with the hood partly up, slightly narrowed suspicious eyes, arms crossed, guarded but not menacing' },
  { id: 'siteaudit', name: 'אורית', look: 'a ~41-year-old woman, meticulous, glasses, hair in a neat ponytail, cream DUBIS t-shirt, holding a clipboard with a checklist, sharp attentive eyes' },
  { id: 'supply',    name: 'משה',   look: 'a ~55-year-old man, weathered friendly face, reading glasses low on the nose, a sturdy DUBIS work-style shirt, holding a clipboard, veteran logistics vibe' },
  { id: 'video',     name: 'ליאת',  look: 'a ~39-year-old woman, casual, hair half-tied, holding up a phone as if filming, soft ring-light catchlights in the eyes, gray DUBIS t-shirt, restless creative energy' },
];

function buildPrompt(member) {
  return `${STYLE}\n\nThe person: ${member.look}.\n\n${NEG}`;
}

async function generateOne(member, retries = 2) {
  const prompt = buildPrompt(member);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${KEY}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.9, responseModalities: ['IMAGE'] },
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini ${res.status}: ${errText.slice(0, 200)}`);
      }
      const json = await res.json();
      const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (!part) throw new Error('No image data: ' + JSON.stringify(json).slice(0, 200));
      return Buffer.from(part.inlineData.data, 'base64');
    } catch (e) {
      if (attempt === retries) throw e;
      console.warn(`  retry ${attempt + 1}/${retries}: ${e.message}`);
      await sleep(2000 * (attempt + 1));
    }
  }
}

async function main() {
  const targets = onlyAgent ? TEAM.filter((m) => m.id === onlyAgent) : TEAM;
  if (!targets.length) { console.error(`Agent "${onlyAgent}" not found. IDs: ${TEAM.map(t=>t.id).join(', ')}`); process.exit(1); }
  console.log(`Generating ${targets.length} team avatar(s) -> ${OUT_BASE}\n`);

  let made = 0, skipped = 0, failed = 0;
  for (const member of targets) {
    const fname = path.join(OUT_BASE, `${member.id}.jpg`);
    if (fs.existsSync(fname) && !force) { console.log(`SKIP ${member.id} (${member.name}) — exists`); skipped++; continue; }
    try {
      console.log(`generating ${member.id} (${member.name})…`);
      const bytes = await generateOne(member);
      fs.writeFileSync(fname, bytes);
      console.log(`  saved ${member.id}.jpg (${(bytes.length/1024).toFixed(0)} KB)`);
      made++;
      await sleep(1500);
    } catch (e) {
      console.error(`  FAIL ${member.id}: ${e.message}`);
      failed++;
    }
  }
  console.log(`\nDone: ${made} made, ${skipped} skipped, ${failed} failed. ~$${(made*0.04).toFixed(2)} Gemini.`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
