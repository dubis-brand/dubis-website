#!/usr/bin/env node
/**
 * fix-back-images.js — Regenerate ONLY back images for products with text issues
 * Uses ultra-explicit prompts to prevent Gemini from hallucinating extra text
 */

const fs = require('fs');
const path = require('path');

try { require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') }); } catch {}
try { require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); } catch {}

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const IMAGES_DIR = path.resolve(__dirname, '../images');

const GARMENT_DESC = {
  tshirt: 'crew-neck t-shirt, short sleeves',
  hoodie: 'pullover hoodie with front kangaroo pocket, long sleeves',
  ziphoodie: 'full-zip hoodie with front pockets, long sleeves',
  longsleeve: 'long-sleeve crew-neck shirt, long sleeves',
};

const COLOR_DESC = {
  'Black': 'solid black fabric',
  'White': 'solid white fabric',
  'Cream': 'off-white cream/ivory fabric',
  'Navy': 'dark navy blue fabric',
  'Charcoal': 'dark charcoal grey fabric',
  'Honey Brown': 'warm honey brown/caramel fabric',
  'Red': 'deep red/burgundy fabric',
  'Forest Green': 'deep forest green fabric',
};

// All 18 products — canonical back-text spec (must stay in sync with generate-designs.js PRODUCTS
// and dubis_products WHERE active=true). Product 7 is cap-only, no back image.
const FIXES = [
  { id: 1,  type: 'tshirt',
    colors: ['Black','White','Cream','Navy','Red'],
    desc: 'Line 1: "I am not fat, I am a" in small text (2 lines stacked). Line 2: "LIMITED" in HUGE bold Impact font, 4x larger. Line 3: "edition." in medium text below. That is ALL. Exactly 7 words.' },
  { id: 2,  type: 'tshirt',
    colors: ['Black','Cream','Navy'],
    desc: 'Line 1: "more of me to" in small text. Line 2: "LOVE" in HUGE bold Impact font, 5x larger. That is ALL. Exactly 4 words.' },
  { id: 3,  type: 'hoodie',
    colors: ['Black','White','Charcoal','Cream','Navy','Forest Green'],
    desc: 'Line 1: "NAPPING IS MY" in small text. Line 2: "CARDIO" in HUGE bold Impact font, 4x larger. That is ALL. Exactly 4 words.' },
  { id: 4,  type: 'tshirt',
    colors: ['Black','White','Charcoal','Cream','Navy'],
    desc: 'Line 1: "I survived." in medium bold text. Line 2: "That\'s enough." in slightly larger bold text below. That is ALL. Exactly 4 words plus punctuation.' },
  { id: 5,  type: 'tshirt',
    colors: ['Black','White','Cream','Charcoal'],
    desc: 'Line 1: "low maintenance, high" in small text. Line 2: "VALUE" in HUGE bold Impact font, 4x larger. That is ALL. Exactly 4 words. Do NOT add "reward" or any other word.' },
  { id: 6,  type: 'hoodie',
    colors: ['Charcoal','Black','Navy'],
    desc: 'Line 1: "Not a model." in small text. Line 2: "NEVER." in HUGE bold Impact font. Line 3: "wanted to be." in medium text below. That is ALL. Exactly 6 words.' },
  // id 7 is cap-only — skip
  { id: 8,  type: 'tshirt',
    colors: ['Black','Charcoal','Navy','Red','Forest Green'],
    desc: 'Line 1: "NAP" in HUGE bold Impact font at the top. Line 2: "Born to nap, forced to work" in small text below. That is ALL. Do NOT add "zzz", sleep symbols, or any other text.' },
  { id: 9,  type: 'ziphoodie',
    colors: ['Black','Navy','Charcoal'],
    desc: 'Line 1: "certified" in small text. Line 2: "OVER" in HUGE bold Impact font, 5x larger. Line 3: "thinker." in medium text below. That is ALL. Exactly 3 words.' },
  { id: 10, type: 'longsleeve',
    colors: ['Black','White','Navy','Forest Green'],
    desc: 'Line 1: "serial" in small text. Line 2: "NAPPER" in HUGE bold Impact font, 4x larger. That is ALL. Exactly 2 words. Do NOT repeat any word or add quotes.' },
  { id: 11, type: 'tshirt',
    colors: ['White','Cream','Black','Navy'],
    desc: 'Line 1: "She believed she could, so she took a" in small text (wrap to 2 lines). Line 2: "NAP." in HUGE bold Impact font, 5x larger. That is ALL. Exactly 9 words.' },
  { id: 12, type: 'tshirt',
    colors: ['Black','White','Cream','Navy'],
    desc: 'Line 1: "COFFEE" in HUGE bold Impact font at the top. Line 2: "I run on coffee and sarcasm." in small text below. That is ALL. Exactly 6 words.' },
  { id: 13, type: 'hoodie',
    colors: ['Charcoal','Cream','Navy'],
    desc: 'Line 1: "Zero Motivation" in small text. Line 2: "CLUB" in HUGE bold Impact font, 4x larger. That is ALL. Exactly 3 words.' },
  { id: 14, type: 'longsleeve',
    colors: ['Cream','White','Black','Navy'],
    desc: 'Line 1: "emotionally attached to my" in small text. Line 2: "COUCH" in HUGE bold Impact font, 4x larger. That is ALL. Exactly 5 words. Do NOT add any subtitle.' },
  { id: 15, type: 'hoodie',
    colors: ['Black','White','Navy','Charcoal'],
    desc: 'Line 1: "Fashion? I prefer" in small text. Line 2: "COMFORT." in HUGE bold Impact font, 4x larger. The big word is COMFORT, NOT fashion. That is ALL. Exactly 4 words.' },
  { id: 16, type: 'hoodie',
    colors: ['Black','White','Navy','Charcoal'],
    desc: 'Line 1: "My goal: minimal" in small text. Line 2: "EXISTENCE." in HUGE bold Impact font, 4x larger. That is ALL. Exactly 4 words.' },
  { id: 17, type: 'tshirt',
    colors: ['Black','White','Cream','Navy'],
    desc: 'Line 1: "Experienced in" in small text. Line 2: "EXHAUSTION" in HUGE bold Impact font, 4x larger. Line 3: "." small period below. That is ALL. Exactly 3 words.' },
  { id: 18, type: 'tshirt',
    colors: ['Black','White','Cream','Navy'],
    desc: 'Line 1: "Unfashionably" in small text. Line 2: "COMFORTABLE" in HUGE bold Impact font, 4x larger. Line 3: "." small period below. That is ALL. Exactly 2 words.' },
];

function buildBackPrompt(fix, color) {
  const garmentDesc = GARMENT_DESC[fix.type];
  const colorDesc = COLOR_DESC[color] || `${color} colored fabric`;
  const inkColor = ['Black', 'Navy', 'Charcoal', 'Forest Green'].includes(color) ? 'white' : 'black';

  return `Professional product photo showing the BACK of a ${garmentDesc}, ${colorDesc}, back view only.

TEXT ON THE BACK (${inkColor} ink), positioned in the upper-center of the back:
${fix.desc}

ABSOLUTE RULES — VIOLATIONS WILL CAUSE THIS IMAGE TO BE REJECTED:
- Print ONLY the exact words specified above, in ${inkColor} color, nothing else
- The back of this garment must be 100% blank EXCEPT the slogan text above
- The word "DUBIS" must NOT appear anywhere on the back — not large, not small, not in a corner, not at the hem, not near the neckline, not on a tag visible from outside, not anywhere
- Do NOT add "DUBIS™", "DUBIS", "dubis", "dbs", or any brand mark on the back
- Do NOT add a small logo/wordmark below or near the slogan
- Do NOT add a tagline, subtitle, credit line, website URL, or hashtag
- Do NOT add decorative elements: no stars, no underlines, no borders, no frames, no splashes, no icons, no emojis
- Do NOT add "zzz", "cooldown", "reward", copyright symbols, registered marks, ™, ®, © or any symbol
- Do NOT repeat any word that already appears in the slogan
- Do NOT add quotation marks around any text
- Do NOT print text on the sleeves, collar, hem, or any location other than the upper-center back
- Do NOT show a brand tag sewn on the outside of the garment
- If the slogan mentions a word like "NAP" or "NAPPER", print that word exactly ONCE — never twice

Visual framing:
- Show the back of the garment only — no front visible, no side angle
- Clean white studio background
- Product photography, no person, garment displayed on an invisible mannequin or laid flat
- Studio lighting, high quality, photorealistic, natural fabric drape
- Square 1:1 format
- No watermark, no photographer credit, no overlay captions`;
}

async function generateImage(prompt, outputPath) {
  console.log(`  Generating: ${path.basename(outputPath)}...`);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
      }),
      signal: AbortSignal.timeout(120000),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText.substring(0, 200)}`);
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

  if (!imgPart?.inlineData?.data) {
    throw new Error('No image data returned from Gemini');
  }

  const imgBuffer = Buffer.from(imgPart.inlineData.data, 'base64');
  if (imgBuffer.length < 10000) {
    throw new Error(`Image too small (${imgBuffer.length} bytes)`);
  }

  fs.writeFileSync(outputPath, imgBuffer);
  console.log(`  ✅ Saved: ${path.basename(outputPath)} (${(imgBuffer.length / 1024).toFixed(0)}KB)`);
}

const delay = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  if (!GEMINI_KEY) { console.error('Missing GEMINI_API_KEY'); process.exit(1); }

  // --missing-only: skip files that already exist (useful for retry after 503s)
  const missingOnly = process.argv.includes('--missing-only');

  let total = 0, success = 0, failed = 0, skipped = 0;

  for (const fix of FIXES) {
    console.log(`\n=== Product ${fix.id} ===`);

    for (const color of fix.colors) {
      total++;
      const safeColor = color.replace(/\s+/g, '-');
      const outPath = path.join(IMAGES_DIR, `product-${fix.id}-${safeColor}-back.jpg`);

      // Skip if file already exists AND is a reasonable size (not a partial/errored one)
      if (missingOnly && fs.existsSync(outPath)) {
        const size = fs.statSync(outPath).size;
        if (size >= 40 * 1024) {
          skipped++;
          console.log(`  ⏭  ${safeColor}: exists (${(size/1024).toFixed(0)}KB), skipping`);
          continue;
        }
      }

      try {
        const prompt = buildBackPrompt(fix, color);
        await generateImage(prompt, outPath);
        success++;
        await delay(3000); // Rate limit — slightly longer delay
      } catch (e) {
        console.log(`  ❌ ${safeColor}: ${e.message}`);
        failed++;
        // On 503, back off longer before next request
        if (String(e.message).includes('503')) await delay(15000);
      }
    }
  }

  console.log(`\n════════════════════════════════`);
  console.log(`Done! ${success} succeeded, ${skipped} skipped, ${failed} failed (total ${total})`);
}

main().catch(e => { console.error(e); process.exit(1); });
