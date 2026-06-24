#!/usr/bin/env node
// Dana summer slate reels — 3 NEW faces, exact product, front+back.
// try-on (new face + product FRONT mockup) -> Veo 3.1 (EN narration, garment must not morph)
// -> compose segA(Veo)+segB/C(BACK Ken-Burns, aspect-safe)+segD(DUBIS outro).
// Hosts via git (Supabase key in .env.local is the dead legacy JWT). Resumable.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const HF = 'C:\\Users\\tehar\\bin\\hf.exe';
const FFMPEG = 'C:\\Users\\tehar\\bin\\ffmpeg.exe';
const WEB = path.resolve('C:/Users/tehar/OneDrive/Cladue Projects/Dubis/dubis-website');
const OUT = path.join(WEB, 'videos', 'il-campaign', '_pilot');
const IMG = path.join(WEB, 'images');
const log = (...a) => console.log(new Date().toISOString().slice(11,19), ...a);

const CFG = [
  { key:'dana-38-tank', face:'face-3', pid:38, color:'Black', garment:'sleeveless tank top', age:45, w:'woman',
    anchor:'warm, real and relatable, natural grey-streaked dark curly hair',
    scene:'on a sun-drenched Tel Aviv balcony in the late afternoon heat',
    narration:"It's thirty-eight degrees and my neighbor still asks if I'm not cold without sleeves. I'm not cold. I just stopped dressing for other people's opinions." },
  { key:'dana-18-tee', face:'face-2', pid:18, color:'White', garment:'crew-neck t-shirt', age:50, w:'man',
    anchor:'easygoing, bald with a short grey beard, warm half-smile',
    scene:'in a bright sunlit kitchen at home, relaxed',
    narration:"At fifty I stopped trying to look thirty. Most freeing thing I ever did. I just want a shirt that doesn't fight me all day." },
  { key:'dana-31-tee', face:'face-1', pid:31, color:'Cream', garment:'crew-neck t-shirt', age:50, w:'woman',
    anchor:'warm and settled, silver chin-length hair, light reading glasses',
    scene:'by a big bright window at home, soft daylight',
    narration:"Fitting room, angled mirror, and there I am sucking my stomach in like someone's grading me. Then I stopped. I already built a whole life." },
];

function hf(args){ const r=spawnSync(HF,args,{encoding:'utf8',maxBuffer:64*1024*1024}); if(r.status!==0) throw new Error(`hf ${args.slice(0,2).join(' ')} (${r.status}): ${(r.stderr||r.stdout||'').slice(0,400)}`); return r.stdout; }
function ff(args,l){ const r=spawnSync(FFMPEG,args,{encoding:'utf8',maxBuffer:64*1024*1024}); if(r.status!==0) throw new Error(`ffmpeg ${l} (${r.status}): ${(r.stderr||r.stdout||'').split('\n').slice(-4).join(' ')}`); }
async function dl(url,out){ const r=await fetch(url); writeFileSync(out, Buffer.from(await r.arrayBuffer())); return out; }

function tryon(c){
  const out = path.join(OUT, `${c.key}-hero.jpg`);
  if (existsSync(out)) { log(`  ${c.key} hero exists`); return out; }
  const face = path.join(IMG,'personas-new',`${c.face}.jpg`);
  const mock = path.join(IMG, `product-${c.pid}-${c.color}-front.jpg`);
  const prompt = `${c.age}-year-old Israeli ${c.w}, ${c.anchor}. ${c.scene}. Wearing the EXACT ${c.color} DUBIS ${c.garment} shown in the second reference image, front-facing camera, three-quarter framing, modestly dressed and fully clothed. The garment type, color and printed DUBIS chest design must match the reference garment EXACTLY — do NOT change the garment type or alter the print. Soft window light, golden afternoon tone, natural skin, candid documentary portrait. Sony A7IV 85mm f/1.8, Kodak Portra 400 grain. DUBIS chest logo clearly visible on the wearer's left chest.`;
  log(`  ${c.key} try-on -> #${c.pid} ${c.color} ${c.garment}`);
  const r = hf(['product-photoshoot','create','--mode','virtual_model_tryout','--prompt',prompt,'--image',face,'--image',mock,'--count','1','--aspect_ratio','3:4','--timeout','8m']);
  const url = r.trim().split('\n').find(l=>l.startsWith('http'));
  if(!url) throw new Error(`no try-on url: ${r.slice(0,200)}`);
  return url;
}
function veo(c, hero){
  const out = path.join(OUT, `${c.key}-veo.mp4`);
  if (existsSync(out)) { log(`  ${c.key} veo exists`); return {out}; }
  const prompt = `Cinematic intimate documentary 9:16 portrait. A ${c.age}-year-old Israeli ${c.w}, exactly as in the start frame. ${c.scene}. Wearing a ${c.color} DUBIS ${c.garment} — the garment MUST stay a ${c.color} ${c.garment} for the entire clip; it must NOT morph into a different garment and the chest print must not change. Speaks directly to camera in a warm, dry, slightly sardonic Israeli-accented English voice. Spoken text: "${c.narration}" Subtle natural gestures, a small knowing half-smile at the end. Stays front-facing. Soft golden light, Kodak Portra grain.`;
  log(`  ${c.key} Veo...`);
  const r = hf(['generate','create','veo3_1','--aspect_ratio','9:16','--duration','8','--quality','high','--image',hero,'--prompt',prompt,'--wait','--wait-timeout','20m','--json']);
  const res = JSON.parse(r); const o = Array.isArray(res)?res[0]:res; const url=o.result_url||o.url;
  if(!url) throw new Error(`no veo url: ${JSON.stringify(res).slice(0,200)}`);
  return {url,out};
}
function compose(c){
  const veoF = path.join(OUT,`${c.key}-veo.mp4`);
  const back = path.join(IMG,`product-${c.pid}-${c.color}-back.jpg`);
  const A=path.join(OUT,`${c.key}-A.mp4`),B=path.join(OUT,`${c.key}-B.mp4`),D=path.join(OUT,`${c.key}-D.mp4`);
  ff(['-y','-i',veoF,'-filter_complex','[0:v]scale=-2:1920,crop=1080:1920:(in_w-1080)/2:0,format=yuv420p[v]','-map','[v]','-map','0:a?','-c:v','libx264','-preset','medium','-crf','18','-c:a','aac','-b:a','192k',A],'A');
  ff(['-y','-loop','1','-i',back,'-t','3.5','-filter_complex',"[0:v]scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0xD7D7D7,zoompan=z='1.0+0.06*on/84':d=84:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=24,format=yuv420p[v]",'-map','[v]','-an','-c:v','libx264','-preset','medium','-crf','18',B],'B');
  ff(['-y','-f','lavfi','-i','color=c=0x2C2C2C:s=1080x1920:d=2.5:r=24','-vf',"drawtext=text='DUBIS':fontfile='C\\:/Windows/Fonts/impact.ttf':fontsize=240:fontcolor=0xC17E3A:x=(w-text_w)/2:y=(h-text_h)/2-100,drawtext=text='dubis.net':fontfile='C\\:/Windows/Fonts/arial.ttf':fontsize=44:fontcolor=0xF5F0E8:x=(w-text_w)/2:y=(h-text_h)/2+120",'-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p',D],'D');
  const list=path.join(OUT,`${c.key}-list.txt`); writeFileSync(list,`file '${c.key}-A.mp4'\nfile '${c.key}-B.mp4'\nfile '${c.key}-D.mp4'\n`);
  const final=path.join(OUT,`${c.key}-FINAL.mp4`);
  ff(['-y','-f','concat','-safe','0','-i',list,'-c:v','libx264','-preset','medium','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',final],'concat');
  return final;
}

const results=[];
for (const c of CFG){
  try{
    log(`▶ ${c.key}`);
    let hero = tryon(c); if (hero.startsWith('http')) hero = await dl(hero, path.join(OUT,`${c.key}-hero.jpg`));
    const v = veo(c, hero); if (v.url) await dl(v.url, v.out);
    const final = compose(c);
    const mb = (readFileSync(final).length/1e6).toFixed(1);
    log(`  ✓ ${c.key} ${mb}MB`); results.push({key:c.key,pid:c.pid,final,mb});
  }catch(e){ log(`  ✗ ${c.key}: ${e.message}`); results.push({key:c.key,error:e.message}); }
  writeFileSync(path.join(OUT,'_dana-reels-results.json'), JSON.stringify(results,null,2));
}
log('=== DANA REELS DONE ==='); console.log(JSON.stringify(results,null,2));
