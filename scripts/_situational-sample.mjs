#!/usr/bin/env node
// Prototype: situational image for the "מאחורי הקוד" series.
// Takes an existing team avatar as a FACE reference and places that same
// character into a SCENE (here: Ron/CTO debugging at 2am). No readable text
// on clothing (AI-text rule). Gemini 2.5 Flash Image. ~$0.04.
import fs from 'node:fs';
import path from 'node:path';

let KEY = process.env.GEMINI_API_KEY;
if (!KEY) {
  const t = fs.readFileSync(path.resolve('.env.local'), 'utf8');
  const m = t.match(/^GEMINI_API_KEY\s*=\s*(.+)$/m);
  if (m) KEY = m[1].trim().replace(/^["']|["']$/g, '');
}
if (!KEY) { console.error('no key'); process.exit(1); }

const refB64 = fs.readFileSync(path.resolve('images/team/cto.jpg')).toString('base64');

const prompt = `Editorial documentary photograph. Keep the SAME person, same face and identity as the reference image (Israeli man ~45, short messy dark hair, light stubble, tired under-eye circles, calm-under-fire warmth).
Scene: it is 2am. He sits hunched at a cluttered home-office desk in a dim room lit only by the cold blue glow of a laptop screen and a small warm desk lamp. A half-empty coffee mug beside the keyboard, sticky notes on the wall, one hand rubbing his temple, focused and exhausted but composed. He wears a plain navy DUBIS hoodie — the clothing is BLANK, no readable text or logo on it.
Real everyday body, not a model. Shot on Sony A7IV 35mm f/2, soft mixed light, Kodak Portra 400 film grain, visible skin texture and pores, natural catchlights, cinematic candid feel, medium environmental shot showing the desk and room. 2K.
Negative: no readable text on clothing, no readable text on the screen, no logos, no plastic/airbrushed skin, no AI glow, no fashion-model glamour, no robot/cyborg, no extra fingers, no neon sci-fi.`;

const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${KEY}`;
const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: [{ parts: [
      { text: prompt },
      { inlineData: { mimeType: 'image/jpeg', data: refB64 } },
    ] }],
    generationConfig: { temperature: 0.9, responseModalities: ['IMAGE'] },
  }),
});
if (!res.ok) { console.error('HTTP', res.status, (await res.text()).slice(0, 300)); process.exit(2); }
const json = await res.json();
const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
if (!part) { console.error('no image:', JSON.stringify(json).slice(0, 300)); process.exit(3); }
const out = path.resolve('scripts/_situational-cto-sample.jpg');
fs.writeFileSync(out, Buffer.from(part.inlineData.data, 'base64'));
const kb = (fs.statSync(out).size / 1024).toFixed(0);
console.log('OK saved', out, kb + 'KB');
