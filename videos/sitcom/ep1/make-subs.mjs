// Ep1 "הלייק" — render Hebrew subtitle PNGs (RTL-safe via node-canvas; ffmpeg drawtext breaks Hebrew).
// Each sub = transparent 1080x220 PNG, white text w/ black stroke, bottom-centered by overlay later.
import { createCanvas, registerFont } from 'canvas';
import fs from 'fs';

const FONT_PATHS = ['C:/Windows/Fonts/arialbd.ttf', 'C:/Windows/Fonts/arial.ttf'];
for (const p of FONT_PATHS) { if (fs.existsSync(p)) { registerFont(p, { family: 'SubFont' }); break; } }

const SUBS = [
  { id: 's1', text: 'לייק אחד.' },
  { id: 's2', text: 'זה לייק טוב. לייק איכותי.' },
  { id: 's3', text: 'זה אמא שלך.' },
  { id: 's4', text: '...אין לנו אמהות.' },
  { id: 's5', text: 'החולצה קיבלה יותר קליקים מהפוסט.' },
  { id: 's6', text: '...מקדמים את החולצה.' },
  { id: 'sP', text: 'הצוות עובד. אתם תנוחו. DUBIS', honey: true },
];

const W = 1080, H = 220;
for (const s of SUBS) {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.direction = 'rtl';
  let size = 58;
  ctx.font = `bold ${size}px SubFont`;
  while (ctx.measureText(s.text).width > W - 120 && size > 34) { size -= 2; ctx.font = `bold ${size}px SubFont`; }
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(s.text, W / 2, H / 2);
  ctx.fillStyle = s.honey ? '#C17E3A' : '#FFFFFF';
  ctx.fillText(s.text, W / 2, H / 2);
  fs.writeFileSync(`sub-${s.id}.png`, c.toBuffer('image/png'));
  console.log(`sub-${s.id}.png (${size}px) — ${s.text}`);
}
