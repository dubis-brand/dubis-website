#!/usr/bin/env node
// ensure-reel-bank.mjs (2026-06-09) — keeps a PRODUCT-KEYED reel bank full for
// every ACTIVE product, so the weekly plan's reel slots always have a real video
// (instead of downgrading to a feed_post). oren: "always prepare a suitable video
// bank using Higgsfield."
//
// Output (Supabase Storage video-assets/_pilot/):
//   product-{pid}-FINAL-EN.mp4   (English Veo speech — the reel)
//   product-{pid}-FINAL-HE.mp4   (same video; the Hebrew story goes in the caption)
//
// Per product that lacks a reel:
//   1. virtual_model_tryout(persona face-ref, current product FRONT mockup) → hero
//   2. Veo 3.1 from hero (prompt names the exact garment + "must not morph" + EN narration)
//   3. compose: segA(Veo+EN audio) + segB/C(product BACK Ken-Burns reveal) + segD(DUBIS outro)
//   4. upload product-keyed EN + HE
// The 4 pre-existing persona reels (men-1/#3, men-5/#8, women-1/#11, women-5/#31)
// are COPIED to product-keyed names (no regen).
// Resumable: skips any product whose product-{pid}-FINAL-EN.mp4 already exists.
//
// Usage: node ensure-reel-bank.mjs            (all active products)
//        node ensure-reel-bank.mjs 1 2 4      (only these pids)

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
const STORAGE = 'https://ntzwvqtpdmvvavbhuyeb.supabase.co/storage/v1/object';
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  (readFileSync(path.join(WEB, '.env.local'), 'utf-8').match(/SUPABASE_SERVICE_ROLE_KEY="([^"]+)"/) || [])[1];
const SUPA = createClient('https://ntzwvqtpdmvvavbhuyeb.supabase.co', SRK, { auth: { persistSession: false } });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const personas = JSON.parse(readFileSync(path.join(ROOT, 'personas-v3.json'), 'utf-8')).personas;

// product → { persona (face+age+scene), color (has front+back mockup), garment noun, EN narration }
// Only personas with a face ref are used: men-1/3/5, women-1/4/5.
const CFG = {
  1:  { persona: 'women-5', color: 'Navy',  garment: 't-shirt',        nar: "Mass production? Not me. After forty I'm a limited edition — rare, a little worn, and not for everyone." },
  2:  { persona: 'men-3',   color: 'Navy',  garment: 't-shirt',        nar: "There's more of me than there used to be. More to love, more to feed, and zero apologies." },
  4:  { persona: 'men-5',   color: 'Navy',  garment: 't-shirt',        nar: "Some weeks you don't win, you survive. And honestly? That is more than enough." },
  5:  { persona: 'women-4', color: 'Black', garment: 't-shirt',        nar: "Low maintenance, high value. Like a good shirt — or me after forty. No fuss, still worth it." },
  10: { persona: 'men-1',   color: 'Navy',  garment: 'long-sleeve shirt', nar: "They call it lazy. I call it a craft. I'm a serial napper, and I have no regrets." },
  18: { persona: 'women-1', color: 'Navy',  garment: 't-shirt',        nar: "Fashion can wait. I'm unfashionably comfortable, and I've never slept better." },
  23: { persona: 'men-3',   color: 'Navy',  garment: 't-shirt',        nar: "Some people leap out of bed at six. I'm allergic to mornings. This shirt is my doctor's note." },
  25: { persona: 'men-5',   color: 'Navy',  garment: 'zip-up hoodie',  nar: "Big plans today? Cancelled. Just me, this hoodie, and the couch. Best meeting all week." },
  29: { persona: 'women-4', color: 'Navy',  garment: 'long-sleeve shirt', nar: "My energy is a non-renewable resource. I spend it carefully — mostly on naps." },
  30: { persona: 'men-1',   color: 'Navy',  garment: 'long-sleeve shirt', nar: "Made it through another year. Still here, somehow. Congrats to me — comfort is the prize." },
  32: { persona: 'women-5', color: 'Navy',  garment: 't-shirt',        nar: "Activewear, for the proudly inactive. The only sprint I do is to the fridge." },
  34: { persona: 'women-1', color: 'Black', garment: 'long-sleeve shirt', nar: "Twenty years in, still waiting for my big break. Until then: soft sleeves, low expectations." },
};
// Pre-existing persona reels → copy to product-keyed names (no regeneration).
const COPY_FROM_PERSONA = { 3: 'men-1', 8: 'men-5', 11: 'women-1', 31: 'women-5' };

function hf(args) {
  const r = spawnSync(HF, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`hf ${args.slice(0,3).join(' ')} (${r.status}): ${(r.stderr||r.stdout||'').slice(0,400)}`);
  return r.stdout;
}
function ff(args, label) {
  const r = spawnSync(FFMPEG, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg ${label} (${r.status}): ${(r.stderr||r.stdout||'').split('\n').slice(-5).join('\n')}`);
}
function safeAnchor(a) {
  return (a || '').replace(/post-?kids body,?\s*/gi, '').replace(/average build,?\s*/gi, '')
    .replace(/\bbody\b,?\s*/gi, '').replace(/\s{2,}/g, ' ').replace(/^,\s*/, '').trim();
}
async function dl(url, out) { const r = await fetch(url); writeFileSync(out, Buffer.from(await r.arrayBuffer())); return out; }
async function reelExists(pid) {
  const r = await fetch(`${STORAGE}/public/video-assets/_pilot/product-${pid}-FINAL-EN.mp4`, { method: 'HEAD' });
  return r.ok;
}
async function uploadBoth(pid, buf) {
  const urls = {};
  for (const lang of ['EN', 'HE']) {
    const key = `_pilot/product-${pid}-FINAL-${lang}.mp4`;
    const { error } = await SUPA.storage.from('video-assets').upload(key, buf, { contentType: 'video/mp4', cacheControl: '3600', upsert: true });
    if (error) throw new Error(`upload ${lang}: ${error.message}`);
    urls[lang] = `${STORAGE}/public/video-assets/${key}`;
  }
  return urls;
}

function tryonHero(pid, cfg, p) {
  const out = path.join(PILOT, `product-${pid}-hero.jpg`);
  if (existsSync(out)) { log(`  #${pid} hero exists, skip try-on`); return out; }
  const studio = path.join(WEB, 'images', 'personas', cfg.persona, 'photo-01.jpg');
  const face = existsSync(studio) ? studio : path.join(SAMPLES, `${cfg.persona}-hero.jpg`);
  const mock = path.join(WEB, 'images', `product-${pid}-${cfg.color}-front.jpg`);
  const w = p.gender === 'men' ? 'man' : 'woman';
  const anchor = safeAnchor(p.body_anchor);
  const prompt = `${p.age}-year-old Israeli ${w}${anchor ? ', ' + anchor : ''}. ${p.scene_anchor_en || p.scene_anchor}. Wearing the EXACT ${cfg.color} DUBIS ${cfg.garment} shown in the second reference image, front-facing camera, three-quarter framing, modestly dressed and fully clothed. The garment type, color and printed DUBIS chest design must match the reference garment EXACTLY — do NOT change the garment type or alter the print. Soft window light, late afternoon golden tone, natural skin, candid documentary portrait. Sony A7IV 85mm f/1.8, Kodak Portra 400 grain. DUBIS chest logo clearly visible on the wearer's left chest.`;
  log(`  #${pid} try-on (${cfg.persona} → ${cfg.color} ${cfg.garment})`);
  const r = hf(['product-photoshoot', 'create', '--mode', 'virtual_model_tryout', '--prompt', prompt,
    '--image', face, '--image', mock, '--count', '1', '--aspect_ratio', '3:4', '--timeout', '8m']);
  const url = r.trim().split('\n').find(l => l.startsWith('http'));
  if (!url) throw new Error(`no try-on url: ${r.slice(0,200)}`);
  return url;
}
function veoFromHero(pid, cfg, p, heroPath) {
  const out = path.join(PILOT, `product-${pid}-veo.mp4`);
  if (existsSync(out)) { log(`  #${pid} veo exists, skip Veo`); return { out }; }
  const w = p.gender === 'men' ? 'man' : 'woman';
  const prompt = `Cinematic intimate documentary 9:16 portrait. A ${p.age}-year-old Israeli ${w}, exactly as in the start frame. ${p.scene_anchor_en || p.scene_anchor}. Wearing a ${cfg.color} DUBIS ${cfg.garment} — the garment MUST stay a ${cfg.color} ${cfg.garment} for the entire clip; it must NOT morph into a different garment and the chest print must not change. Speaks directly to camera in a warm, dry, slightly sardonic Israeli-accented English voice. Spoken text: "${cfg.nar}" Subtle natural gestures, a small knowing half-smile at the end. Stays front-facing. Soft golden afternoon light, Kodak Portra grain.`;
  log(`  #${pid} Veo from hero`);
  const r = hf(['generate', 'create', 'veo3_1', '--aspect_ratio', '9:16', '--duration', '8',
    '--quality', 'high', '--image', heroPath, '--prompt', prompt, '--wait', '--wait-timeout', '20m', '--json']);
  const res = JSON.parse(r); const o = Array.isArray(res) ? res[0] : res;
  const url = o.result_url || o.url;
  if (!url) throw new Error(`no veo url: ${JSON.stringify(res).slice(0,200)}`);
  return { url, out };
}
function compose(pid, cfg) {
  const veo = path.join(PILOT, `product-${pid}-veo.mp4`);
  const back = path.join(WEB, 'images', `product-${pid}-${cfg.color}-back.jpg`);
  const segA = path.join(PILOT, `product-${pid}-segA.mp4`), segB = path.join(PILOT, `product-${pid}-segB.mp4`);
  const segC = path.join(PILOT, `product-${pid}-segC.mp4`), segD = path.join(PILOT, `product-${pid}-segD.mp4`);
  ff(['-y','-i',veo,'-filter_complex','[0:v]scale=-2:1920,crop=1080:1920:(in_w-1080)/2:0,format=yuv420p[v]','-map','[v]','-map','0:a?','-c:v','libx264','-preset','medium','-crf','18','-c:a','aac','-b:a','192k',segA],'segA');
  ff(['-y','-loop','1','-i',back,'-t','3','-filter_complex',"[0:v]scale=2160:2160,zoompan=z='1.0+0.025*on/72':d=72:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=24,format=yuv420p[v]",'-map','[v]','-an','-c:v','libx264','-preset','medium','-crf','18',segB],'segB');
  ff(['-y','-loop','1','-i',back,'-t','3','-filter_complex',"[0:v]scale=2160:2160,zoompan=z='1.3+0.3*on/72':d=72:x='iw/2-(iw/zoom/2)':y='ih*0.68-(ih/zoom/2)':s=1080x1920:fps=24,format=yuv420p[v]",'-map','[v]','-an','-c:v','libx264','-preset','medium','-crf','18',segC],'segC');
  ff(['-y','-f','lavfi','-i','color=c=0x2C2C2C:s=1080x1920:d=3:r=24','-vf',"drawtext=text='DUBIS':fontfile='C\\:/Windows/Fonts/impact.ttf':fontsize=240:fontcolor=0xC17E3A:x=(w-text_w)/2:y=(h-text_h)/2-100,drawtext=text='dubis.net':fontfile='C\\:/Windows/Fonts/arial.ttf':fontsize=44:fontcolor=0xF5F0E8:x=(w-text_w)/2:y=(h-text_h)/2+120",'-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p',segD],'segD');
  const list = path.join(PILOT, `product-${pid}-concat.txt`);
  writeFileSync(list, `file 'product-${pid}-segA.mp4'\nfile 'product-${pid}-segB.mp4'\nfile 'product-${pid}-segC.mp4'\nfile 'product-${pid}-segD.mp4'\n`);
  const final = path.join(PILOT, `product-${pid}-FINAL-EN.mp4`);
  ff(['-y','-f','concat','-safe','0','-i',list,'-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',final],'concat');
  return readFileSync(final);
}

const onlyPids = process.argv.slice(2).map(Number).filter(Boolean);
const results = [];

// 1) copy the 4 pre-existing persona reels to product-keyed names (no regen)
for (const [pid, persona] of Object.entries(COPY_FROM_PERSONA)) {
  if (onlyPids.length && !onlyPids.includes(Number(pid))) continue;
  try {
    if (await reelExists(pid)) { log(`#${pid} already product-keyed, skip`); results.push({ pid:Number(pid), status:'exists' }); continue; }
    log(`▶ #${pid} copy from ${persona}-FINAL`);
    const src = `${STORAGE}/public/video-assets/_pilot/${persona}-FINAL-EN.mp4`;
    const r = await fetch(src); if (!r.ok) throw new Error(`source 404: ${persona}`);
    const buf = Buffer.from(await r.arrayBuffer());
    await uploadBoth(pid, buf);
    results.push({ pid:Number(pid), status:'copied', from:persona });
  } catch (e) { log(`✗ #${pid}: ${e.message}`); results.push({ pid:Number(pid), error:e.message }); }
}

// 2) generate the missing reels
for (const pidStr of Object.keys(CFG)) {
  const pid = Number(pidStr);
  if (onlyPids.length && !onlyPids.includes(pid)) continue;
  const cfg = CFG[pid];
  const p = personas.find(x => x.id === cfg.persona);
  if (!p) { log(`✗ #${pid}: persona ${cfg.persona} not found`); results.push({ pid, error:'persona-missing' }); continue; }
  try {
    if (await reelExists(pid)) { log(`#${pid} reel exists, skip`); results.push({ pid, status:'exists' }); continue; }
    log(`▶ #${pid} (${cfg.persona})`);
    let hero = tryonHero(pid, cfg, p);
    if (hero.startsWith('http')) hero = await dl(hero, path.join(PILOT, `product-${pid}-hero.jpg`));
    const veo = veoFromHero(pid, cfg, p, hero);
    if (veo.url) await dl(veo.url, veo.out);
    const buf = compose(pid, cfg);
    const urls = await uploadBoth(pid, buf);
    log(`  #${pid} done ${(buf.length/1e6).toFixed(1)}MB`);
    results.push({ pid, status:'generated', persona:cfg.persona, ...urls });
  } catch (e) { log(`✗ #${pid}: ${e.message}`); results.push({ pid, error:e.message }); }
  writeFileSync(path.join(PILOT, 'ensure-reel-bank-results.json'), JSON.stringify(results, null, 2));
}
console.log('=== ENSURE-REEL-BANK DONE ===');
console.log(JSON.stringify(results, null, 2));
