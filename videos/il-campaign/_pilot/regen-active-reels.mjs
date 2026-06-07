#!/usr/bin/env node
// regen-active-reels.mjs (2026-06-07) — definitive reel pipeline for the 4 active personas.
// oren requirement: the persona must wear the EXACT current product, front AND back.
//
// Per persona (all spawnSync, zero shell parsing):
//   1. virtual_model_tryout(face-ref, current Navy FRONT mockup) → {id}-hero-v2.jpg
//      (proven: dresses the persona in the exact garment + DUBIS chest logo)
//   2. Veo 3.1 from hero-v2, prompt names the correct garment + "must not morph" + narration_en
//      → faithful garment (verified on women-5) + lip-synced English speech
//   3. compose: segA(Veo, native EN audio) + segB/C(Navy BACK mockup Ken Burns) + segD(outro)
//   4. upload FINAL to BOTH _pilot/{id}-FINAL-EN.mp4 and -HE.mp4 (English video; HE story in caption)
// Resumable: skips try-on if hero-v2 exists, skips Veo if veo-v2 exists.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const HF = 'C:\\Users\\tehar\\bin\\hf.exe';
const FFMPEG = 'C:\\Users\\tehar\\bin\\ffmpeg.exe';
const ROOT = path.resolve(import.meta.dirname, '..');
const WEB = path.resolve(ROOT, '..', '..');
const SAMPLES = path.join(ROOT, 'samples-2026-05-19');
const PILOT = path.join(ROOT, '_pilot');
const STORAGE_URL = 'https://ntzwvqtpdmvvavbhuyeb.supabase.co/storage/v1/object';
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  (readFileSync(path.join(WEB, '.env.local'), 'utf-8').match(/SUPABASE_SERVICE_ROLE_KEY="([^"]+)"/) || [])[1];
const SUPA = createClient('https://ntzwvqtpdmvvavbhuyeb.supabase.co', SRK, { auth: { persistSession: false } });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const personas = JSON.parse(readFileSync(path.join(ROOT, 'personas-v3.json'), 'utf-8')).personas;

// garmentNoun used in the Veo "do not morph" clause
const CFG = {
  'men-1':   { pid: 3,  color: 'Navy', garment: 'zip-up hoodie', narration_en: "Everyone's at the 6 AM CrossFit. I'm a master of the power nap. That's the real cardio. A hoodie for the rest of us." },
  'men-5':   { pid: 8,  color: 'Navy', garment: 't-shirt',       narration_en: "Born to nap, forced to work. Both messages, on my back. With respect." },
  'women-1': { pid: 11, color: 'Navy', garment: 't-shirt',       narration_en: "They believed she could. So she took a nap. Turns out that was the smartest move of the day." },
  'women-5': { pid: 31, color: 'Navy', garment: 't-shirt',       narration_en: "You're prettier when you're comfortable. Someone told me twenty years ago. I'm only starting to believe it now." },
};

function hf(args) {
  const r = spawnSync(HF, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`hf ${args.slice(0,3).join(' ')} (${r.status}): ${(r.stderr||r.stdout||'').slice(0,400)}`);
  return r.stdout;
}
function ff(args, label) {
  const r = spawnSync(FFMPEG, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg ${label} (${r.status}): ${(r.stderr||r.stdout||'').split('\n').slice(-5).join('\n')}`);
}

// Body-anchor words that trip Higgsfield's NSFW filter ("post-kids body", etc.) — strip them.
function safeAnchor(a) {
  return (a || '').replace(/post-?kids body,?\s*/gi, '').replace(/average build,?\s*/gi, '')
    .replace(/\bbody\b,?\s*/gi, '').replace(/\s{2,}/g, ' ').replace(/^,\s*/, '').trim();
}
function tryonHero(id, p, cfg) {
  const out = path.join(PILOT, `${id}-hero-v2.jpg`);
  if (existsSync(out)) { log(`  ${id} hero-v2 exists, skip try-on`); return out; }
  // prefer the clean studio persona photo if present (less likely to trip the NSFW filter)
  const studio = path.join(WEB, 'images', 'personas', id, 'photo-01.jpg');
  const face = existsSync(studio) ? studio : path.join(SAMPLES, `${id}-hero.jpg`);
  const mock = path.join(WEB, 'images', `product-${cfg.pid}-${cfg.color}-front.jpg`);
  const w = p.gender === 'men' ? 'man' : 'woman';
  const anchor = safeAnchor(p.body_anchor);
  const prompt = `${p.age}-year-old Israeli ${w}${anchor ? ', ' + anchor : ''}. ${p.scene_anchor_en || p.scene_anchor}. Wearing the EXACT ${cfg.color} DUBIS ${cfg.garment} shown in the second reference image, front-facing camera, three-quarter framing, modestly dressed and fully clothed. The garment type, color and printed DUBIS chest design must match the reference garment EXACTLY — do NOT change the garment type or alter the print. Soft window light, late afternoon golden tone, natural skin, candid documentary portrait. Sony A7IV 85mm f/1.8, Kodak Portra 400 grain. DUBIS chest logo clearly visible on the wearer's left chest.`;
  log(`  ${id} try-on → #${cfg.pid} ${cfg.color} ${cfg.garment}`);
  const r = hf(['product-photoshoot', 'create', '--mode', 'virtual_model_tryout', '--prompt', prompt,
    '--image', face, '--image', mock, '--count', '1', '--aspect_ratio', '3:4', '--timeout', '8m']);
  const url = r.trim().split('\n').find(l => l.startsWith('http'));
  if (!url) throw new Error(`no try-on url: ${r.slice(0,200)}`);
  return url; // caller downloads
}

async function dl(url, out) { const resp = await fetch(url); writeFileSync(out, Buffer.from(await resp.arrayBuffer())); return out; }

function veoFromHero(id, p, cfg, heroPath) {
  const out = path.join(PILOT, `${id}-veo-v2.mp4`);
  if (existsSync(out)) { log(`  ${id} veo-v2 exists, skip Veo`); return out; }
  const w = p.gender === 'men' ? 'man' : 'woman';
  const prompt = `Cinematic intimate documentary 9:16 portrait. A ${p.age}-year-old Israeli ${w}, exactly as in the start frame. ${p.scene_anchor_en || p.scene_anchor}. She/he is wearing a ${cfg.color} DUBIS ${cfg.garment} — the garment MUST stay a ${cfg.color} ${cfg.garment} for the entire clip; it must NOT morph into a different garment and the chest print must not change. Speaks directly to camera in a warm, dry, slightly sardonic Israeli-accented English voice. Spoken text: "${cfg.narration_en}" Subtle natural gestures, a small knowing half-smile at the end. Stays front-facing. Soft golden afternoon light, Kodak Portra grain.`;
  log(`  ${id} Veo from hero-v2`);
  const r = hf(['generate', 'create', 'veo3_1', '--aspect_ratio', '9:16', '--duration', '8',
    '--quality', 'high', '--image', heroPath, '--prompt', prompt, '--wait', '--wait-timeout', '20m', '--json']);
  const res = JSON.parse(r); const o = Array.isArray(res) ? res[0] : res;
  const url = o.result_url || o.url;
  if (!url) throw new Error(`no veo url: ${JSON.stringify(res).slice(0,200)}`);
  return { url, out };
}

async function compose(id, cfg) {
  const veo  = path.join(PILOT, `${id}-veo-v2.mp4`);
  const back = path.join(WEB, 'images', `product-${cfg.pid}-${cfg.color}-back.jpg`);
  const segA = path.join(PILOT, `${id}-v2-segA.mp4`), segB = path.join(PILOT, `${id}-v2-segB.mp4`);
  const segC = path.join(PILOT, `${id}-v2-segC.mp4`), segD = path.join(PILOT, `${id}-v2-segD.mp4`);
  ff(['-y','-i',veo,'-filter_complex','[0:v]scale=-2:1920,crop=1080:1920:(in_w-1080)/2:0,format=yuv420p[v]','-map','[v]','-map','0:a?','-c:v','libx264','-preset','medium','-crf','18','-c:a','aac','-b:a','192k',segA],'segA');
  ff(['-y','-loop','1','-i',back,'-t','3','-filter_complex',"[0:v]scale=2160:2160,zoompan=z='1.0+0.025*on/72':d=72:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=24,format=yuv420p[v]",'-map','[v]','-an','-c:v','libx264','-preset','medium','-crf','18',segB],'segB');
  ff(['-y','-loop','1','-i',back,'-t','3','-filter_complex',"[0:v]scale=2160:2160,zoompan=z='1.3+0.3*on/72':d=72:x='iw/2-(iw/zoom/2)':y='ih*0.68-(ih/zoom/2)':s=1080x1920:fps=24,format=yuv420p[v]",'-map','[v]','-an','-c:v','libx264','-preset','medium','-crf','18',segC],'segC');
  ff(['-y','-f','lavfi','-i','color=c=0x2C2C2C:s=1080x1920:d=3:r=24','-vf',"drawtext=text='DUBIS':fontfile='C\\:/Windows/Fonts/impact.ttf':fontsize=240:fontcolor=0xC17E3A:x=(w-text_w)/2:y=(h-text_h)/2-100,drawtext=text='dubis.net':fontfile='C\\:/Windows/Fonts/arial.ttf':fontsize=44:fontcolor=0xF5F0E8:x=(w-text_w)/2:y=(h-text_h)/2+120",'-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p',segD],'segD');
  const list = path.join(PILOT, `${id}-v2-concat.txt`);
  writeFileSync(list, `file '${id}-v2-segA.mp4'\nfile '${id}-v2-segB.mp4'\nfile '${id}-v2-segC.mp4'\nfile '${id}-v2-segD.mp4'\n`);
  const final = path.join(PILOT, `${id}-FINAL-EN.mp4`);
  ff(['-y','-f','concat','-safe','0','-i',list,'-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',final],'concat');
  const buf = readFileSync(final); const urls = {};
  for (const lang of ['EN','HE']) {
    const key = `_pilot/${id}-FINAL-${lang}.mp4`;
    const { error } = await SUPA.storage.from('video-assets').upload(key, buf, { contentType:'video/mp4', cacheControl:'3600', upsert:true });
    if (error) throw new Error(`upload ${lang}: ${error.message}`);
    urls[lang] = `${STORAGE_URL}/public/video-assets/${key}`;
  }
  log(`  ${id} composed ${(buf.length/1e6).toFixed(1)}MB → EN+HE`);
  return urls;
}

const results = [];
for (const id of Object.keys(CFG)) {
  const cfg = CFG[id]; const p = personas.find(x => x.id === id);
  try {
    log(`▶ ${id} (#${cfg.pid})`);
    let hero = tryonHero(id, p, cfg);
    if (hero.startsWith('http')) hero = await dl(hero, path.join(PILOT, `${id}-hero-v2.jpg`));
    const veo = veoFromHero(id, p, cfg, hero);
    if (veo.url) await dl(veo.url, veo.out);
    const urls = await compose(id, cfg);
    results.push({ id, pid: cfg.pid, ...urls });
  } catch (e) { log(`✗ ${id}: ${e.message}`); results.push({ id, error: e.message }); }
  writeFileSync(path.join(PILOT, 'regen-results.json'), JSON.stringify(results, null, 2));
}
console.log('=== REGEN DONE ===');
console.log(JSON.stringify(results, null, 2));
