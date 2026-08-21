// Ep7 "הפרח" assembly — clips (video only; cinematic_studio Hebrew speech came
// out as phonetic gibberish, verified twice) → minimax DUB track (Oren-clone
// voice for גדי, Naomi for מירי — the proven Hebrew path, decision 2026-08-01)
// → HE subs (node-canvas RTL) → FLOWER beat (the actual image from oren's
// email test) → product beat #52 Black front+back → music bed (monkeys.mp3 —
// the only unused track: ep4 lewis-dekalb, ep5 sneaky-snitch, ep6 fluffing).
// REAL premise: oren emailed "אני רוצה שתצייר לי פרח" to test the mail loop;
// the email agent opened a 4-part brand-alignment review instead of drawing it.
// Run from dubis-website root: node scripts/_ep7-build.mjs
import { spawnSync } from 'child_process';
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createCanvas, registerFont } = require('canvas');
registerFont('C:/Windows/Fonts/arialbd.ttf', { family: 'DubisHe', weight: 'bold' });
const FFMPEG = 'C:/Users/tehar/bin/ffmpeg.exe';
const SP = 'C:/Users/tehar/AppData/Local/Temp/claude/C--Users-tehar-OneDrive-Cladue-Projects-Dubis/fbb3cdb3-3165-47a9-b72c-827f8456c8fb/scratchpad';
const B = `${SP}/ep7/build`; fs.mkdirSync(B, { recursive: true });
const W = 1080, H = 1920;
function ff(args, label) { const r = spawnSync(FFMPEG, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); if (r.status !== 0) throw new Error(`ffmpeg ${label} (${r.status}): ${(r.stderr || '').split('\n').slice(-6).join('\n')}`); }
function renderCue(text, brand, idx) {
  const FONT = 60, LINE_H = 78, MAXW = 940, PAD = 28, BAND_BOTTOM = 1600;
  const canvas = createCanvas(W, H); const ctx = canvas.getContext('2d');
  ctx.font = `bold ${FONT}px DubisHe`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  try { ctx.direction = 'rtl'; } catch {}
  const words = text.split(' '); const lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > MAXW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  const blockH = lines.length * LINE_H, top = BAND_BOTTOM - blockH;
  let widest = 0; for (const ln of lines) widest = Math.max(widest, ctx.measureText(ln).width);
  const bandW = Math.min(W - 40, widest + PAD * 2), bandX = (W - bandW) / 2;
  ctx.fillStyle = 'rgba(28,28,28,0.55)';
  const r = 26, x = bandX, y = top - PAD, w = bandW, h = blockH + PAD * 2;
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fill();
  const fill = brand ? '#E39A4E' : '#F5F0E8';
  lines.forEach((ln, li) => { const yy = top + LINE_H / 2 + li * LINE_H; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1c1c1c'; ctx.lineWidth = FONT * 0.16; ctx.strokeText(ln, W / 2, yy); ctx.fillStyle = fill; ctx.fillText(ln, W / 2, yy); });
  const p = `${B}/cue-${idx}.png`; fs.writeFileSync(p, canvas.toBuffer('image/png')); return p;
}
const CUES = JSON.parse(fs.readFileSync(`${SP}/ep7/cues.json`, 'utf8'));
let cueIdx = 0;
for (const clip of CUES) {
  const inputs = ['-y', '-i', `${SP}/ep7/${clip.clip}.mp4`];
  for (const d of clip.dubs) inputs.push('-i', `${SP}/ep7/dubs/${d.file}`);
  for (const c of clip.cues) { inputs.push('-i', renderCue(c.text, !!c.brand, `${clip.clip}-${cueIdx++}`)); }
  const nD = clip.dubs.length;
  // video: scale + freeze-pad the last frame so the dubbed dialogue fits
  let fc = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=25,tpad=stop_mode=clone:stop_duration=${clip.pad || 0}[v0]`;
  // audio: dub track ONLY (original speech dropped — phonetic gibberish)
  const mixIns = [];
  clip.dubs.forEach((d, i) => {
    const ms = Math.round(d.at * 1000);
    fc += `;[${i + 1}:a]adelay=${ms}|${ms}[ad${i}]`;
    mixIns.push(`[ad${i}]`);
  });
  // Bounded apad: infinite apad + -shortest overflows the mux queue and dies
  // with a misleading "No space left on device". Pad exactly to video length.
  const vDur = (8.06 + (clip.pad || 0)).toFixed(2);
  fc += `;${mixIns.join('')}amix=inputs=${nD}:normalize=0,apad=whole_dur=${vDur}[aud]`;
  let prev = '[v0]';
  clip.cues.forEach((c, i) => {
    const fi = 1 + nD + i;
    const outLbl = i === clip.cues.length - 1 ? '[vout]' : `[v${i + 1}]`;
    fc += `;${prev}[${fi}:v]overlay=0:0:enable='between(t,${c.t0},${c.t1})'${outLbl}`;
    prev = `[v${i + 1}]`;
  });
  if (!clip.cues.length) fc += ';[v0]null[vout]';
  ff([...inputs, '-filter_complex', fc, '-map', '[vout]', '-map', '[aud]',
     '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
     '-c:a', 'aac', '-ar', '48000', '-ac', '2', `${B}/${clip.clip}-sub.mp4`], `${clip.clip}-subs`);
}
// FLOWER beat 2.6s — the actual flower from oren's email test, honey cue line.
const flowerCue = renderCue('הפרח. צויר. 🌸', true, 'flower');
ff(['-y', '-loop', '1', '-i', `${SP}/ep7/beats/flower.png`, '-i', flowerCue, '-t', '2.6',
  '-filter_complex', `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=#F5F0E8,fps=25[b];[b][1:v]overlay=0:0[v]`,
  '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', `${B}/beat-flower.mp4`], 'beat-flower');
// Product beat: #52 Black front 2.4s + back 2.4s, honey link cue, silent (music covers)
const linkCue = renderCue('DUBIS · dubis.net/?p=52', true, 'link52');
for (const [face, img] of [['front', `${SP}/ep7/beats/front.jpg`], ['back', `${SP}/ep7/beats/back.jpg`]]) {
  ff(['-y', '-loop', '1', '-i', img, '-i', linkCue, '-t', '2.4',
    '-filter_complex', `[0:v]scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2:color=#D7D7D7,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=#D7D7D7,fps=25[b];[b][1:v]overlay=0:0[v]`,
    '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', `${B}/beat-${face}.mp4`], `beat-${face}`);
}
for (const face of ['flower', 'front', 'back']) {
  ff(['-y', '-i', `${B}/beat-${face}.mp4`, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-shortest', '-c:v', 'copy', '-c:a', 'aac', `${B}/beat-${face}-a.mp4`], `beat-${face}-a`);
}
fs.writeFileSync(`${B}/list.txt`, [`${B}/c1-sub.mp4`, `${B}/c2-sub.mp4`, `${B}/c3-sub.mp4`, `${B}/beat-flower-a.mp4`, `${B}/beat-front-a.mp4`, `${B}/beat-back-a.mp4`].map(p => `file '${p}'`).join('\n'));
ff(['-y', '-f', 'concat', '-safe', '0', '-i', `${B}/list.txt`, '-c:v', 'libx264', '-preset', 'fast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', `${B}/joined.mp4`], 'concat');
ff(['-y', '-i', `${B}/joined.mp4`, '-i', 'videos/il-campaign/_music/monkeys.mp3',
  '-filter_complex', '[1:a]volume=0.22,afade=t=in:st=0:d=1[m];[0:a]volume=1.0[a0];[a0][m]amix=inputs=2:duration=first:dropout_transition=2[aout]',
  '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', `${B}/sitcom-ep7-haperach.mp4`], 'music');
console.log('EP7 DONE:', `${B}/sitcom-ep7-haperach.mp4`);
