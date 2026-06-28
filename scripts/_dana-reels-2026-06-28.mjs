#!/usr/bin/env node
// Dana summer slate reels — week 2026-06-28. 3 NEW faces (4/5/6), exact product, front+back.
// try-on (new face + product FRONT mockup) -> Veo 3.1 (EN narration, garment must not morph)
// -> compose segA(Veo)+segB(BACK Ken-Burns, aspect-safe)+segD(DUBIS outro). Resumable.
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
  { key:'dana-34-longsleeve', face:'face-4', pid:34, color:'White', garment:'long-sleeve crew-neck shirt', age:52, w:'man',
    anchor:'warm and weathered, salt-and-pepper short hair, neatly trimmed grey beard',
    scene:'on a Tel Aviv rooftop in the early evening as the city cools down and the lights come on',
    narration:"My whole life people told me the break was just around the corner. I'm fifty-two — still waiting. So I stopped waiting, and just took it." },
  { key:'dana-40-ziphoodie', face:'face-5', pid:40, color:'Royal-Blue', garment:'full-zip hooded sweatshirt with a metal zipper and a hood', age:47, w:'woman',
    anchor:'warm, real and relatable, dark curly shoulder-length hair with natural grey streaks',
    scene:'on a cafe terrace by the sea in the evening, a light breeze moving her hair',
    narration:"Someone told me I dress too comfortably, like it was an insult. I'm forty-seven. Comfort isn't giving up on style — comfort is the style." },
  { key:'dana-23-tee', face:'face-6', pid:23, color:'Red', garment:'crew-neck t-shirt', age:41, w:'man',
    anchor:'calm and easygoing, clean-shaven bald head, short greying stubble, rectangular glasses',
    scene:'in a home kitchen at six in the morning, groggy, holding a mug of coffee in the early light',
    narration:"Every successful person wakes up at five a.m., right? Then I'm doomed. I'm forty-one and the sunrise still feels like a personal attack — and I stopped apologizing for it." },
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
  writeFileSync(path.join(OUT,'_dana-reels-0628-results.json'), JSON.stringify(results,null,2));
}
log('=== DANA REELS 0628 DONE ==='); console.log(JSON.stringify(results,null,2));
