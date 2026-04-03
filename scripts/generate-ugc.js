/**
 * DUBIS UGC Image Generator
 * Step 1: Gemini generates people in PLAIN dark clothing (no text/logos)
 * Step 2: Node canvas adds DUBIS slogan overlay on each image
 * Run: node scripts/generate-ugc.js
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, registerFont } = require('canvas');

// Load GEMINI_API_KEY from .env.local
function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env.local');
  if (!fs.existsSync(envPath)) {
    throw new Error('.env.local file not found at: ' + envPath);
  }
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = process.env[key] ?? val;
  }
}

loadEnv();

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('ERROR: GEMINI_API_KEY not found in .env.local');
  console.error('Add: GEMINI_API_KEY="your-key-here" to .env.local');
  process.exit(1);
}

// Register Impact font for overlay text
const IMPACT_FONT_PATH = 'C:\\Windows\\Fonts\\impact.ttf';
if (fs.existsSync(IMPACT_FONT_PATH)) {
  registerFont(IMPACT_FONT_PATH, { family: 'Impact' });
  console.log('Impact font registered.');
} else {
  console.warn('WARNING: Impact font not found at', IMPACT_FONT_PATH, '— falling back to system font.');
}

const OUTPUT_DIR = path.resolve(__dirname, '../images/ugc');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log('Created directory:', OUTPUT_DIR);
}

// UGC image definitions — plain clothing prompts + slogans for overlay
const UGC_PROMPTS = [
  {
    id: 1,
    filename: 'ugc-1.jpg',
    description: 'Israeli man 40s, living room selfie',
    slogan: "I'm not fat, I'm a LIMITED edition",
    prompt: `A realistic phone selfie photo of an Israeli man in his early 40s. He has dark Mediterranean features, slight stubble, warm brown eyes, and a relaxed tired expression — the look of someone who just got home from work. He is wearing a PLAIN dark charcoal/black oversized unisex t-shirt with ABSOLUTELY NO text, no logos, no writing, no letters, no graphics, no prints anywhere on the clothing — the shirt is completely blank and plain. He is standing in a typical Israeli apartment living room — beige walls, a couch visible behind him, maybe a bookshelf, warm late-afternoon natural light from a window. The photo is taken at arm's length as a selfie — slightly downward angle, casual framing, slightly imperfect exposure, not professional. The background is slightly out of focus. Photo style: genuine candid smartphone photo, not staged, realistic skin texture, real lighting, 2024 style.`
  },
  {
    id: 2,
    filename: 'ugc-2.jpg',
    description: 'Israeli woman 50s, kitchen selfie with coffee',
    slogan: 'Napping is my cardio',
    prompt: `A realistic phone selfie photo of an Israeli woman in her early 50s. She has a full curvy figure, dark curly hair with some gray, warm olive complexion, and a relaxed slightly amused expression. She is wearing a PLAIN dark navy or charcoal oversized hoodie/sweatshirt with ABSOLUTELY NO text, no logos, no writing, no letters, no graphics, no prints anywhere on the clothing — the garment is completely blank and plain. She is standing in a home kitchen — typical Israeli kitchen tiles, counter visible, morning light. She is holding a mug of coffee in one hand and taking the selfie with the other. The photo is a casual arm-length selfie, slightly imperfect — perhaps not perfectly centered, natural lighting from the kitchen window. The overall feel is warm and authentic, like a real person sharing a morning moment on WhatsApp or Instagram. Not professional. Real life.`
  },
  {
    id: 3,
    filename: 'ugc-3.jpg',
    description: 'Couple 40s, restaurant selfie',
    slogan: 'More of me to love',
    prompt: `A realistic phone selfie photo of an Israeli couple in their mid 40s at a casual restaurant. The man: dark skin, short dark hair, warm smile, wearing a PLAIN dark charcoal t-shirt with ABSOLUTELY NO text, no logos, no writing, no letters, no graphics anywhere on the clothing. The woman beside him: curvy, shoulder-length dark hair, warm olive skin, bright eyes, wearing a PLAIN dark t-shirt with ABSOLUTELY NO text, no logos, no writing, no letters, no graphics anywhere on the clothing. Both garments are completely blank and plain fabric. They are leaning together cheek-to-cheek in a typical couple restaurant selfie pose — both smiling genuinely. Background: casual Israeli restaurant — wooden tables, warm dim lighting, other tables slightly visible in the blurry background. The photo is taken at arm's length by the man, slightly imperfect angle, warm restaurant lighting, the kind of photo couples post on Instagram after a nice dinner. Not professional photography.`
  },
  {
    id: 4,
    filename: 'ugc-4.jpg',
    description: 'Bearded man 45, zip hoodie, car selfie',
    slogan: 'Certified overthinker',
    prompt: `A realistic phone selfie of an Israeli man around 45 years old. He has a full beard, dark hair going slightly gray at the temples, strong Mediterranean features. He is wearing a PLAIN dark zip-up hoodie with ABSOLUTELY NO text, no logos, no writing, no letters, no graphics, no prints anywhere on the clothing — the hoodie is completely blank and plain fabric, no patches, no embroidery. He is sitting in the driver's seat of a car — the steering wheel is clearly visible in the lower part of the frame, dashboard behind him. It is daytime. He is taking a selfie looking directly at the camera with a relaxed confident expression. The car interior is typical — dark seats, maybe some sunglasses on the dashboard. Natural sunlight through the car windows. Photo style: genuine smartphone selfie, slightly casual framing, not professional, realistic lighting, the kind of photo someone sends to a group chat saying "on my way".`
  },
  {
    id: 5,
    filename: 'ugc-5.jpg',
    description: 'Woman 40s, oversized t-shirt, couch selfie',
    slogan: 'Born to nap, forced to work',
    prompt: `A realistic phone selfie of an Israeli woman in her early 40s. She has a comfortable curvy body, dark wavy hair, warm olive skin, no makeup or light makeup, looking relaxed and content. She is wearing a PLAIN oversized dark t-shirt with ABSOLUTELY NO text, no logos, no writing, no letters, no graphics, no prints anywhere on the clothing — the shirt is completely blank and plain — the shirt is slightly too big, worn casually as if lounging at home. She is sitting on a couch and taking a selfie. In one hand she holds a TV remote. The couch is a typical Israeli apartment couch — maybe beige or gray fabric. Background: a home living room, evening warm light, a bit of a TV reflection visible. Expression: genuinely relaxed, slightly amused, comfortable. The photo looks like she just spontaneously took it to send to a friend. Real life, not staged.`
  },
  {
    id: 6,
    filename: 'ugc-6.jpg',
    description: 'Group of friends 40-50s, BBQ setting',
    slogan: 'DUBIS — For the rest of us',
    prompt: `A realistic group photo taken at an outdoor BBQ in Israel. A group of 4-5 friends aged 40-50, mixed men and women, all with Mediterranean/Israeli features — warm skin tones, dark hair, casual happy expressions. 2 or 3 of them are wearing PLAIN dark charcoal or black t-shirts with ABSOLUTELY NO text, no logos, no writing, no letters, no graphics, no prints anywhere on any of the clothing — all garments are completely blank and plain fabric. The setting is a typical Israeli backyard or patio — plastic garden chairs, a grill in the background with smoke, paper plates on a plastic table, late afternoon golden light. They are bunched together for the photo, some with arms around each other, laughing or smiling naturally. One person is holding the camera (phone selfie/group photo style). The photo looks like it was taken casually at a real event — not staged, slightly imperfect framing, warm outdoor light. The kind of photo someone posts in a WhatsApp family group.`
  }
];

// ─── Gemini API ────────────────────────────────────────────────────────────────

async function generateImage(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${API_KEY}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['IMAGE', 'TEXT']
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const candidates = data.candidates || [];
  if (!candidates.length) throw new Error('No candidates in Gemini response');

  const parts = candidates[0]?.content?.parts || [];
  const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

  if (!imagePart) {
    const textPart = parts.find(p => p.text);
    const textHint = textPart ? ` Text response: "${textPart.text?.slice(0, 200)}"` : '';
    throw new Error(`No image found in response parts.${textHint}`);
  }

  return imagePart.inlineData;
}

// ─── Canvas overlay ────────────────────────────────────────────────────────────

async function addOverlay(imagePath, slogan) {
  const img = await loadImage(imagePath);
  const W = img.width;
  const H = img.height;

  const BANNER_H = Math.round(H * 0.16); // ~16% of image height
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Draw original image
  ctx.drawImage(img, 0, 0, W, H);

  // Semi-transparent dark banner at bottom
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.fillRect(0, H - BANNER_H, W, BANNER_H);

  // Subtle top edge glow on the banner
  const gradient = ctx.createLinearGradient(0, H - BANNER_H, 0, H - BANNER_H + 12);
  gradient.addColorStop(0, 'rgba(193,126,58,0.45)');   // DUBIS honey-brown
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, H - BANNER_H, W, 12);

  // ── Slogan text ──
  const sloganFontSize = Math.round(BANNER_H * 0.44);
  ctx.font = `bold ${sloganFontSize}px Impact, Arial Black, sans-serif`;
  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  // Scale font down if text is too wide
  let fontSize = sloganFontSize;
  while (ctx.measureText(slogan).width > W * 0.88 && fontSize > 14) {
    fontSize -= 1;
    ctx.font = `bold ${fontSize}px Impact, Arial Black, sans-serif`;
  }

  const sloganY = H - BANNER_H + BANNER_H * 0.42;
  ctx.fillText(slogan, W / 2, sloganY);

  // ── DUBIS™ watermark — bottom right ──
  const wmFontSize = Math.round(BANNER_H * 0.22);
  ctx.font = `bold ${wmFontSize}px Impact, Arial Black, sans-serif`;
  ctx.fillStyle = 'rgba(193,126,58,0.90)';   // honey-brown
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('DUBIS\u2122', W - Math.round(W * 0.03), H - Math.round(H * 0.012));

  // Save back — overwrite the raw file
  const ext = path.extname(imagePath).toLowerCase();
  const mimeIsJpeg = ext === '.jpg' || ext === '.jpeg';
  const out = mimeIsJpeg
    ? canvas.toBuffer('image/jpeg', { quality: 0.92 })
    : canvas.toBuffer('image/png');

  fs.writeFileSync(imagePath, out);
}

// ─── Save raw Gemini bytes ─────────────────────────────────────────────────────

function saveRaw(inlineData, filename) {
  const buffer = Buffer.from(inlineData.data, 'base64');
  const ext = inlineData.mimeType === 'image/png' ? 'png' : 'jpg';
  const finalFilename = filename.replace(/\.\w+$/, `.${ext}`);
  const filePath = path.join(OUTPUT_DIR, finalFilename);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

// ─── Delete old UGC images ────────────────────────────────────────────────────

function deleteOldImages() {
  if (!fs.existsSync(OUTPUT_DIR)) return;
  const files = fs.readdirSync(OUTPUT_DIR).filter(f => /^ugc-\d+\.(jpg|jpeg|png)$/i.test(f));
  for (const f of files) {
    fs.unlinkSync(path.join(OUTPUT_DIR, f));
  }
  if (files.length) console.log(`Deleted ${files.length} old UGC image(s).`);
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log('DUBIS UGC Image Generator (two-step: plain photo + canvas overlay)');
  console.log('='.repeat(65));
  console.log(`Output directory: ${OUTPUT_DIR}`);
  console.log(`Generating ${UGC_PROMPTS.length} images...\n`);

  deleteOldImages();

  const results = [];

  for (const item of UGC_PROMPTS) {
    process.stdout.write(`[${item.id}/6] ${item.description}...\n`);
    process.stdout.write(`      Step 1: Generating plain photo via Gemini... `);

    try {
      // Step 1 — Gemini generates plain-clothing photo
      const inlineData = await generateImage(item.prompt);
      const savedPath = saveRaw(inlineData, item.filename);
      console.log(`saved (${path.basename(savedPath)})`);

      // Step 2 — Canvas overlay
      process.stdout.write(`      Step 2: Adding slogan overlay... `);
      await addOverlay(savedPath, item.slogan);
      const relativePath = path.relative(path.resolve(__dirname, '..'), savedPath);
      console.log(`done -> ${relativePath}`);

      results.push({ id: item.id, status: 'ok', path: savedPath });
    } catch (err) {
      console.log(`FAILED`);
      console.error(`      Error: ${err.message}`);
      results.push({ id: item.id, status: 'error', error: err.message });
    }

    // Delay between requests to avoid rate limiting
    if (item.id < UGC_PROMPTS.length) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  console.log('\n' + '='.repeat(65));
  const ok = results.filter(r => r.status === 'ok').length;
  const failed = results.filter(r => r.status === 'error').length;
  console.log(`Done: ${ok} generated, ${failed} failed`);

  if (ok > 0) {
    console.log(`\nImages saved to: ${OUTPUT_DIR}`);
    console.log('Each image has a bottom-banner overlay with the slogan + DUBIS\u2122 watermark.');
    console.log('Add them to index.html in the UGC / social proof section.');
  }

  if (failed > 0) {
    console.log('\nFailed items:');
    results.filter(r => r.status === 'error').forEach(r => {
      console.log(`  - ugc-${r.id}: ${r.error}`);
    });
    console.log('\nNotes:');
    console.log('  - Gemini image generation may be blocked for realistic human photos.');
    console.log('  - If you see "SAFETY" errors, the prompts need to be more abstract.');
    console.log('  - Alternative: use Imagen 3 via Vertex AI or Midjourney.');
  }
}

run().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
