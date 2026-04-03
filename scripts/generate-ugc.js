/**
 * DUBIS UGC Image Generator
 * Uses Gemini 2.5 Flash to generate realistic customer selfie-style photos
 * Run: node scripts/generate-ugc.js
 */

const fs = require('fs');
const path = require('path');

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

const OUTPUT_DIR = path.resolve(__dirname, '../images/ugc');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log('Created directory:', OUTPUT_DIR);
}

const UGC_PROMPTS = [
  {
    id: 1,
    filename: 'ugc-1.jpg',
    description: 'Israeli man 40s, living room selfie',
    prompt: `A realistic phone selfie photo of an Israeli man in his early 40s. He has dark Mediterranean features, slight stubble, warm brown eyes, and a relaxed tired expression — the look of someone who just got home from work. He is wearing a dark charcoal/black oversized unisex t-shirt with white bold condensed text on it. He is standing in a typical Israeli apartment living room — beige walls, a couch visible behind him, maybe a bookshelf, warm late-afternoon natural light from a window. The photo is taken at arm's length as a selfie — slightly downward angle, casual framing, slightly imperfect exposure, not professional. The background is slightly out of focus. Photo style: genuine candid smartphone photo, not staged, realistic skin texture, real lighting, 2024 style.`
  },
  {
    id: 2,
    filename: 'ugc-2.jpg',
    description: 'Israeli woman 50s, kitchen selfie with coffee',
    prompt: `A realistic phone selfie photo of an Israeli woman in her early 50s. She has a full curvy figure, dark curly hair with some gray, warm olive complexion, and a relaxed slightly amused expression. She is wearing a dark navy or charcoal oversized hoodie/sweatshirt with white text printed on it. She is standing in a home kitchen — typical Israeli kitchen tiles, counter visible, morning light. She is holding a mug of coffee in one hand and taking the selfie with the other. The photo is a casual arm-length selfie, slightly imperfect — perhaps not perfectly centered, natural lighting from the kitchen window. The overall feel is warm and authentic, like a real person sharing a morning moment on WhatsApp or Instagram. Not professional. Real life.`
  },
  {
    id: 3,
    filename: 'ugc-3.jpg',
    description: 'Couple 40s, restaurant selfie',
    prompt: `A realistic phone selfie photo of an Israeli couple in their mid 40s at a casual restaurant. The man: dark skin, short dark hair, warm smile, wearing a dark charcoal t-shirt with bold white text. The woman beside him: curvy, shoulder-length dark hair, warm olive skin, bright eyes, wearing a matching dark t-shirt. They are leaning together cheek-to-cheek in a typical couple restaurant selfie pose — both smiling genuinely. Background: casual Israeli restaurant — wooden tables, warm dim lighting, other tables slightly visible in the blurry background. The photo is taken at arm's length by the man, slightly imperfect angle, warm restaurant lighting, the kind of photo couples post on Instagram after a nice dinner. Not professional photography.`
  },
  {
    id: 4,
    filename: 'ugc-4.jpg',
    description: 'Bearded man 45, zip hoodie, car selfie',
    prompt: `A realistic phone selfie of an Israeli man around 45 years old. He has a full beard, dark hair going slightly gray at the temples, strong Mediterranean features. He is wearing a dark zip-up hoodie with white text visible on it. He is sitting in the driver's seat of a car — the steering wheel is clearly visible in the lower part of the frame, dashboard behind him. It is daytime. He is taking a selfie looking directly at the camera with a relaxed confident expression. The car interior is typical — dark seats, maybe some sunglasses on the dashboard. Natural sunlight through the car windows. Photo style: genuine smartphone selfie, slightly casual framing, not professional, realistic lighting, the kind of photo someone sends to a group chat saying "on my way".`
  },
  {
    id: 5,
    filename: 'ugc-5.jpg',
    description: 'Woman 40s, oversized t-shirt, couch selfie',
    prompt: `A realistic phone selfie of an Israeli woman in her early 40s. She has a comfortable curvy body, dark wavy hair, warm olive skin, no makeup or light makeup, looking relaxed and content. She is wearing an oversized dark t-shirt with white bold text — the shirt is slightly too big, worn casually as if lounging at home. She is sitting on a couch and taking a selfie. In one hand she holds a TV remote. The couch is a typical Israeli apartment couch — maybe beige or gray fabric. Background: a home living room, evening warm light, a bit of a TV reflection visible. Expression: genuinely relaxed, slightly amused, comfortable. The photo looks like she just spontaneously took it to send to a friend. Real life, not staged.`
  },
  {
    id: 6,
    filename: 'ugc-6.jpg',
    description: 'Group of friends 40-50s, BBQ setting',
    prompt: `A realistic group photo taken at an outdoor BBQ in Israel. A group of 4-5 friends aged 40-50, mixed men and women, all with Mediterranean/Israeli features — warm skin tones, dark hair, casual happy expressions. 2 or 3 of them are wearing dark charcoal or black t-shirts with bold white text. The setting is a typical Israeli backyard or patio — plastic garden chairs, a grill in the background with smoke, paper plates on a plastic table, late afternoon golden light. They are bunched together for the photo, some with arms around each other, laughing or smiling naturally. One person is holding the camera (phone selfie/group photo style). The photo looks like it was taken casually at a real event — not staged, slightly imperfect framing, warm outdoor light. The kind of photo someone posts in a WhatsApp family group.`
  }
];

async function generateImage(prompt, idx) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${API_KEY}`;

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

  // Extract image data from response
  const candidates = data.candidates || [];
  if (!candidates.length) {
    throw new Error('No candidates in Gemini response');
  }

  const parts = candidates[0]?.content?.parts || [];
  const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

  if (!imagePart) {
    const textPart = parts.find(p => p.text);
    const textHint = textPart ? ` Text response: "${textPart.text?.slice(0, 200)}"` : '';
    throw new Error(`No image found in response parts.${textHint}`);
  }

  return imagePart.inlineData;
}

async function saveImage(inlineData, filename) {
  const buffer = Buffer.from(inlineData.data, 'base64');
  const ext = inlineData.mimeType === 'image/png' ? 'png' : 'jpg';
  const finalFilename = filename.replace('.jpg', `.${ext}`);
  const filePath = path.join(OUTPUT_DIR, finalFilename);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

async function run() {
  console.log('DUBIS UGC Image Generator');
  console.log('='.repeat(50));
  console.log(`Output directory: ${OUTPUT_DIR}`);
  console.log(`Generating ${UGC_PROMPTS.length} images...\n`);

  const results = [];

  for (const item of UGC_PROMPTS) {
    process.stdout.write(`[${item.id}/6] ${item.description}... `);

    try {
      const inlineData = await generateImage(item.prompt, item.id);
      const savedPath = await saveImage(inlineData, item.filename);
      const relativePath = path.relative(path.resolve(__dirname, '..'), savedPath);
      console.log(`DONE -> ${relativePath}`);
      results.push({ id: item.id, status: 'ok', path: savedPath });
    } catch (err) {
      console.log(`FAILED`);
      console.error(`   Error: ${err.message}`);
      results.push({ id: item.id, status: 'error', error: err.message });
    }

    // Small delay between requests to avoid rate limiting
    if (item.id < UGC_PROMPTS.length) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  console.log('\n' + '='.repeat(50));
  const ok = results.filter(r => r.status === 'ok').length;
  const failed = results.filter(r => r.status === 'error').length;
  console.log(`Done: ${ok} generated, ${failed} failed`);

  if (ok > 0) {
    console.log(`\nImages saved to: ${OUTPUT_DIR}`);
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
