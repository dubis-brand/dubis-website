#!/usr/bin/env node
// Situational images for the "מאחורי הקוד" queued batch (seq 13-18).
// Each = the character's avatar face placed IN the post's real (anonymized) scene.
// No readable garment text. Gemini 2.5 Flash Image. ~$0.04 each.
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

let KEY = process.env.GEMINI_API_KEY;
if (!KEY) {
  const t = fs.readFileSync(path.resolve('.env.local'), 'utf8');
  const m = t.match(/^GEMINI_API_KEY\s*=\s*(.+)$/m);
  if (m) KEY = m[1].trim().replace(/^["']|["']$/g, '');
}
if (!KEY) { console.error('no key'); process.exit(1); }

const OUT = path.resolve('images/personas-situational');
fs.mkdirSync(OUT, { recursive: true });

const BASE = `Editorial documentary photograph. Keep the SAME person, same face and identity as the reference image. Real everyday Israeli person 38-55, REAL body (a little soft, not a model). Plain DUBIS garment — the clothing is BLANK, NO readable text or logo on it. Shot on Sony A7IV 35mm f/2, soft natural light, Kodak Portra 400 film grain, visible skin texture, natural catchlights, cinematic candid feel, medium environmental shot. 2K.`;
const NEG = `Negative: no readable text on clothing, no readable text on screens, no logos, no plastic/airbrushed skin, no AI glow, no fashion-model glamour, no robot/cyborg, no extra fingers, no neon sci-fi.`;

const JOBS = [
  { id:'cto',      seq:13, scene:'2am. He sits hunched at a cluttered home-office desk in a dim room lit only by the cold blue glow of a laptop and a small warm desk lamp, a half-empty coffee mug, sticky notes on the wall, one hand rubbing his temple, exhausted but composed — debugging.' },
  { id:'security', seq:14, scene:'Late evening in a dim room, he sits guarded with arms loosely crossed in front of a couple of monitors showing scrolling access logs and a green "blocked" indicator, narrowed watchful eyes, hood of his dark hoodie partly up.' },
  { id:'marketing',seq:15, scene:'He slumps at a desk staring at a laptop showing a flat, near-zero sales line chart, one hand dragging down his tired face, an empty coffee cup, daylight from a window — frustrated, still analyzing.' },
  { id:'product',  seq:16, scene:'At a bright worktable, a cloth tape measure draped around his neck, carefully measuring a folded garment from a small stack of folded shirts and hoodies, focused practical maker, sleeves pushed up.' },
  { id:'content',  seq:17, scene:'At a tidy desk late at night, leaning very close to a notebook with a single line circled, pen in hand, small reading glasses, a magnifier nearby, obsessing over one tiny detail.' },
  { id:'boss',     seq:18, scene:'Standing by a glass whiteboard in a small office, arms crossed, reading glasses pushed up on the forehead, a dry no-nonsense look, a coffee mug on the table, pointing at the word PROOF written on the board.' },
];

const refFor = (id) => fs.readFileSync(path.resolve(`images/team/${id}.jpg`)).toString('base64');

async function gen(job, retries=2){
  const prompt = `${BASE}\n\nScene: ${job.scene}\n\n${NEG}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${KEY}`;
  for (let a=0;a<=retries;a++){
    try{
      const res = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({contents:[{parts:[{text:prompt},{inlineData:{mimeType:'image/jpeg',data:refFor(job.id)}}]}],
        generationConfig:{temperature:0.9,responseModalities:['IMAGE']}})});
      if(!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0,160)}`);
      const j = await res.json();
      const part = j.candidates?.[0]?.content?.parts?.find(p=>p.inlineData?.data);
      if(!part) throw new Error('no image');
      return Buffer.from(part.inlineData.data,'base64');
    }catch(e){ if(a===retries) throw e; console.warn(`  retry ${a+1}: ${e.message}`); await sleep(2500*(a+1)); }
  }
}

for(const job of JOBS){
  const out = path.join(OUT, `${job.id}-${job.seq}.jpg`);
  try{
    process.stdout.write(`gen ${job.id}-${job.seq}… `);
    const b = await gen(job);
    fs.writeFileSync(out, b);
    console.log(`OK ${(b.length/1024).toFixed(0)}KB`);
  }catch(e){ console.error(`FAIL ${job.id}: ${e.message}`); }
  await sleep(1500);
}
console.log('done');
