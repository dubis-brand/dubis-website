// dubis-website/video/scripts/render-and-publish.js
// GitHub Actions: pick product → ffmpeg 9:16 slideshow → upload to Supabase Storage
// → POST dubis-tiktok-content-v4 → Late.com → TikTok @dubis.brand

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FORCE_PID = parseInt(process.env.INPUT_PRODUCT_ID || '0', 10) || null;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
const BUCKET = 'tiktok-videos';
const AUDIO_BUCKET = 'tiktok-audio';
const OUT_DIR = 'out';
const SLIDE_DURATION = 4;
const TARGET_W = 1080;
const TARGET_H = 1920;
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

async function ensureBucket() {
  const { data: buckets } = await sb.storage.listBuckets();
  if (!buckets?.some(b => b.name === BUCKET)) {
    await sb.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 50 * 1024 * 1024 });
    console.log('Created bucket', BUCKET);
  } else {
    console.log('Bucket exists:', BUCKET);
  }
}

async function pickProduct() {
  if (FORCE_PID) {
    const { data } = await sb.from('dubis_products')
      .select('id, product_id_numeric, slogan, clothing_type, gender, colors, description_en, image_url, lifestyle_image_url')
      .eq('product_id_numeric', FORCE_PID).single();
    if (!data) throw new Error('product not found: ' + FORCE_PID);
    return data;
  }
  const { data: products } = await sb.from('dubis_products')
    .select('id, product_id_numeric, slogan, clothing_type, gender, colors, description_en, image_url, lifestyle_image_url')
    .eq('active', true).order('product_id_numeric');
  if (!products?.length) throw new Error('no active products');

  const ago = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data: recent } = await sb.from('agent_tasks')
    .select('content_data').eq('agent_id', 'tiktok').gte('created_at', ago);
  const seen = new Set();
  for (const t of (recent || [])) {
    const p = t.content_data?.product_id_numeric;
    if (p) seen.add(p);
  }
  const eligible = products.filter(p => !seen.has(p.product_id_numeric));
  const pool = eligible.length ? eligible : products;
  return pool[Math.floor(Math.random() * pool.length)];
}


async function pickAudio() {
  try {
    const { data: files } = await sb.storage.from(AUDIO_BUCKET).list('', { limit: 100 });
    const audio = (files || []).filter(f => /\.(mp3|wav|ogg|m4a)$/i.test(f.name));
    if (!audio.length) { console.log('No audio in bucket, rendering silent'); return null; }
    const pick = audio[Math.floor(Math.random() * audio.length)];
    const { data } = sb.storage.from(AUDIO_BUCKET).getPublicUrl(pick.name);
    console.log('Picked audio:', pick.name);
    return { name: pick.name, url: data.publicUrl };
  } catch (e) { console.warn('audio pick failed', e.message); return null; }
}
async function downloadFile(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('download-failed ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  await fs.writeFile(dest, buf);
  return dest;
}

async function downloadImage(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('image-download-failed ' + r.status + ' ' + url);
  const buf = Buffer.from(await r.arrayBuffer());
  await fs.writeFile(dest, buf);
  return dest;
}

function escDrawtext(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/%/g, '\\%')
    .replace(/\n/g, ' ');
}

function ffmpeg(args) {
  console.log('+ ffmpeg', args.join(' '));
  execSync('ffmpeg -y ' + args.join(' '), { stdio: 'inherit' });
}

async function resolveImageUrl(product) {
  if (product.lifestyle_image_url) return { url: product.lifestyle_image_url, source: 'LIFESTYLE' };
  if (product.image_url) return { url: product.image_url, source: 'product' };

  // Fallback 1: dubis_images table (vetted real-person photos)
  try {
    const { data: imgs } = await sb.from('dubis_images')
      .select('image_url, photo_url, url')
      .eq('product_id', product.product_id_numeric)
      .eq('approved', true)
      .limit(5);
    for (const row of (imgs || [])) {
      const u = row.image_url || row.photo_url || row.url;
      if (u) return { url: u, source: 'dubis_images' };
    }
  } catch (e) { console.warn('dubis_images lookup failed:', e.message); }

  // Fallback 2: per-color mockup. After the 2026-05-03 color-rotation fix, the
  // no-color default `product-{id}-front.jpg` was removed. Iterate the product's
  // `colors[]` palette and return the first variant that exists on the CDN.
  let colors = [];
  try {
    if (Array.isArray(product.colors)) colors = product.colors;
    else if (typeof product.colors === 'string') colors = JSON.parse(product.colors);
  } catch (_) {}
  for (const c of colors) {
    if (!c) continue;
    const url = `https://www.dubis.net/images/product-${product.product_id_numeric}-${encodeURIComponent(c)}-front.jpg`;
    try {
      const r = await fetch(url, { method: 'HEAD' });
      if (r.ok) return { url, source: `per-color:${c}` };
    } catch (_) {}
  }

  throw new Error(`no image found for product ${product.product_id_numeric} (tried lifestyle/image_url/dubis_images/colors[${colors.length}])`);
}

async function renderSlideshow(product, tagline, audioPath) {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const imgPath = path.join(OUT_DIR, 'product.jpg');
  const { url: imgUrl, source: imgSource } = await resolveImageUrl(product);
  console.log('Image source:', imgSource, '->', imgUrl);
  await downloadImage(imgUrl, imgPath);

  const slogan = product.slogan || 'DUBIS';
  const cta = 'shop dubis.net/?p=' + product.product_id_numeric;

  const slogan_e = escDrawtext(slogan);
  const tagline_e = escDrawtext(tagline.slice(0, 60));
  const cta_e = escDrawtext(cta);
  const brand_e = escDrawtext('DUBIS');
  const sub_e = escDrawtext('for real bodies');

  const slide1 =
    `[0:v]scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=decrease,` +
    `pad=${TARGET_W}:${TARGET_H}:(ow-iw)/2:(oh-ih)/2:color=#0d0d0d,setsar=1,` +
    `trim=duration=${SLIDE_DURATION},setpts=PTS-STARTPTS,` +
    `drawtext=fontfile=${FONT}:text='${brand_e}':fontcolor=#c8a96e:fontsize=42:x=(w-text_w)/2:y=80,` +
    `drawtext=fontfile=${FONT}:text='${slogan_e}':fontcolor=#ffffff:fontsize=58:` +
    `box=1:boxcolor=#0d0d0d@0.85:boxborderw=22:x=(w-text_w)/2:y=h-260[v0]`;

  const slide2 =
    `color=c=#0d0d0d:s=${TARGET_W}x${TARGET_H}:d=${SLIDE_DURATION},setsar=1,` +
    `drawtext=fontfile=${FONT}:text='${tagline_e}':fontcolor=#e8e0d5:fontsize=64:x=(w-text_w)/2:y=(h-text_h)/2,` +
    `drawtext=fontfile=${FONT}:text='${brand_e}':fontcolor=#c8a96e:fontsize=36:x=(w-text_w)/2:y=h-180[v1]`;

  const slide3 =
    `color=c=#0d0d0d:s=${TARGET_W}x${TARGET_H}:d=${SLIDE_DURATION},setsar=1,` +
    `drawtext=fontfile=${FONT}:text='${cta_e}':fontcolor=#c8a96e:fontsize=56:x=(w-text_w)/2:y=(h-text_h)/2-40,` +
    `drawtext=fontfile=${FONT}:text='${sub_e}':fontcolor=#888888:fontsize=38:x=(w-text_w)/2:y=(h-text_h)/2+80[v2]`;

  const concat = `[v0][v1][v2]concat=n=3:v=1:a=0[outv]`;
  const filterComplex = [slide1, slide2, slide3, concat].join(';');

  const outPath = path.join(OUT_DIR, 'tiktok.mp4');

  // Write filterComplex to file to avoid shell quoting hell
  const filterFile = path.join(OUT_DIR, 'filter.txt');
  await fs.writeFile(filterFile, filterComplex);

  const TOTAL_DUR = SLIDE_DURATION * 3;
  const args = ['-loop', '1', '-t', String(SLIDE_DURATION), '-i', imgPath];
  if (audioPath) args.push('-i', audioPath);
  args.push('-filter_complex_script', filterFile, '-map', '[outv]');
  if (audioPath) args.push('-map', '1:a:0', '-c:a', 'aac', '-b:a', '128k', '-af', 'afade=t=in:st=0:d=1,afade=t=out:st=' + (TOTAL_DUR - 1) + ':d=1', '-shortest');
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-preset', 'medium', '-t', String(TOTAL_DUR), '-movflags', '+faststart', outPath);
  ffmpeg(args);

  if (!existsSync(outPath)) throw new Error('render-produced-no-output');
  const stat = await fs.stat(outPath);
  console.log('Rendered', outPath, '-', (stat.size / 1024 / 1024).toFixed(2), 'MB');
  return outPath;
}

async function uploadVideo(localPath, product) {
  const buf = await fs.readFile(localPath);
  const filename = `daily-${new Date().toISOString().slice(0,10)}-pid${product.product_id_numeric}-${Date.now()}.mp4`;
  const { error } = await sb.storage.from(BUCKET).upload(filename, buf, {
    contentType: 'video/mp4',
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw new Error('upload-failed ' + error.message);
  const { data } = sb.storage.from(BUCKET).getPublicUrl(filename);
  console.log('Uploaded:', data.publicUrl);
  return data.publicUrl;
}

async function triggerPublish(product, videoUrl) {
  const url = SUPABASE_URL + '/functions/v1/dubis-tiktok-content-v4';
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SERVICE_ROLE },
    body: JSON.stringify({
      product_id_numeric: product.product_id_numeric,
      video_url: videoUrl,
      renderer: 'gh-actions-ffmpeg-slideshow-v1',
    }),
  });
  const txt = await r.text();
  console.log('v4 response', r.status, txt.slice(0, 1000));
  if (!r.ok) throw new Error('v4-publish-failed-' + r.status);
  return JSON.parse(txt);
}

async function main() {
  console.log('=== DUBIS TikTok Daily ===', new Date().toISOString());
  await ensureBucket();
  const product = await pickProduct();
  console.log('Picked product', product.product_id_numeric, '"' + product.slogan + '"');

  const taglines = [
    'real body real shirt',
    'no body shaming',
    'comfort first',
    'for the rest of us',
    'aging on purpose',
    'made by people who get it',
  ];
  const tagline = taglines[Math.floor(Math.random() * taglines.length)];

  let audioPath = null;
  const audioPick = await pickAudio();
  if (audioPick) {
    audioPath = path.join(OUT_DIR, 'audio' + path.extname(audioPick.name));
    await fs.mkdir(OUT_DIR, { recursive: true });
    try { await downloadFile(audioPick.url, audioPath); } catch (e) { console.warn('audio download failed:', e.message); audioPath = null; }
  }
  const videoPath = await renderSlideshow(product, tagline, audioPath);
  const videoUrl = await uploadVideo(videoPath, product);
  const result = await triggerPublish(product, videoUrl);

  console.log('=== DONE ===');
  console.log('TikTok late_post_id:', result.late?.late_post_id || '(skipped)');
  console.log('Task:', result.task_id);
  console.log('Video:', videoUrl);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
