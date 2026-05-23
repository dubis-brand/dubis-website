// Generalized version of _migrate-product-23-images.mjs — loops over a list of
// product_id_numeric values, downloads Gelato presigned mockups, uploads to
// Supabase Storage `product-images/products/{N}/`, writes to images/products/{N}/,
// then patches dubis_products.image_url + proof_of_completion.permanent_*.
//
// Modes:
//   1. Pipeline mode (per-product, called from GHA):
//        PRODUCT_ID_NUMERIC=24 PREVIEWS_JSON='{"Black":{"front":"...","back":"..."}}' \
//          node scripts/_migrate-products-images.mjs
//      Outputs a ===PERMANENT_MANIFEST=== block on stdout so the workflow
//      can capture permanent URLs and pass them to the gha-pipeline-callback.
//      Exits non-zero on critical failure (no previews / all uploads failed).
//
//   2. Manual bulk mode (no env vars): iterates over PRODUCT_IDS array below.
//      Reads gelato_preview_urls from DB row per product.
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

config({ path: '.env.local' });

const ENV_PRODUCT_ID = process.env.PRODUCT_ID_NUMERIC
  ? Number(process.env.PRODUCT_ID_NUMERIC)
  : null;

const PIPELINE_MODE = ENV_PRODUCT_ID !== null && !Number.isNaN(ENV_PRODUCT_ID);

// Bulk-mode default. Edit when running manual backfills.
const BULK_PRODUCT_IDS = [24, 25, 30];

const PRODUCT_IDS = PIPELINE_MODE ? [ENV_PRODUCT_ID] : BULK_PRODUCT_IDS;

const PREVIEWS_OVERRIDE = (() => {
  if (!process.env.PREVIEWS_JSON) return null;
  try {
    const parsed = JSON.parse(process.env.PREVIEWS_JSON);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    console.error(`PREVIEWS_JSON env var present but unparseable: ${e.message}`);
    process.exit(2);
  }
})();

const BUCKET = 'product-images';

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL;

if (!SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) / SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function download(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status} ${r.statusText} :: ${url.slice(0, 80)}…`);
  return Buffer.from(await r.arrayBuffer());
}

async function uploadPermanent(storagePrefix, filename, buf) {
  const path = `${storagePrefix}/${filename}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buf, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function migrateProduct(productId) {
  const localDir = join('images', 'products', String(productId));
  const storagePrefix = `products/${productId}`;

  console.log(`\n======== PRODUCT ${productId} ========`);

  const { data: product, error: pErr } = await supabase
    .from('dubis_products')
    .select('id, image_url, proof_of_completion')
    .eq('product_id_numeric', productId)
    .single();
  if (pErr) {
    console.error(`✗ DB lookup failed for ${productId}:`, pErr.message);
    return { productId, downloaded: 0, uploaded: 0, dbUpdated: false, error: pErr.message };
  }

  // Pipeline-mode override > DB-stored presigned URLs.
  const presigned = PREVIEWS_OVERRIDE || product.proof_of_completion?.gelato_preview_urls || {};
  const colors = Object.keys(presigned);
  if (!colors.length) {
    console.error(`✗ No preview URLs for ${productId} (neither env override nor DB)`);
    return { productId, downloaded: 0, uploaded: 0, dbUpdated: false, error: 'no preview urls' };
  }

  await mkdir(localDir, { recursive: true });

  const jobs = [];
  for (const color of colors) {
    for (const side of ['front', 'back']) {
      const url = presigned[color]?.[side];
      if (!url) { console.warn(`  MISSING ${color}/${side}`); continue; }
      jobs.push({
        color, side, url,
        filename: `product-${productId}-${color.toLowerCase()}-${side}.jpg`,
      });
    }
  }

  const permanent = {};
  let downloaded = 0;
  let uploaded = 0;
  const failures = [];

  for (const j of jobs) {
    process.stdout.write(`  → ${j.color}/${j.side} … `);
    try {
      const buf = await download(j.url);
      const localPath = join(localDir, j.filename);
      await writeFile(localPath, buf);
      downloaded++;

      const publicUrl = await uploadPermanent(storagePrefix, j.filename, buf);
      permanent[j.color] ??= {};
      permanent[j.color][j.side] = publicUrl;
      uploaded++;
      console.log(`✓ ${buf.length}B`);
    } catch (e) {
      failures.push(`${j.color}/${j.side}: ${e.message}`);
      console.log(`✗ ${e.message}`);
    }
  }

  // Hero = first available color's front (prefer Black if present, like product 23).
  const heroColor = colors.includes('Black') ? 'Black' : colors[0];
  const heroSourceUrl = presigned[heroColor]?.front;
  let heroUrl = null;
  if (heroSourceUrl) {
    try {
      const heroBuf = await download(heroSourceUrl);
      const heroLocal = join(localDir, `product-${productId}-hero.jpg`);
      await writeFile(heroLocal, heroBuf);
      downloaded++;
      heroUrl = await uploadPermanent(storagePrefix, `product-${productId}-hero.jpg`, heroBuf);
      uploaded++;
      console.log(`  ✓ hero (${heroColor}/front) → ${heroUrl}`);
    } catch (e) {
      failures.push(`hero: ${e.message}`);
      console.log(`  ✗ hero failed: ${e.message}`);
    }
  } else {
    console.warn(`  ✗ no hero source url for color=${heroColor}`);
  }

  if (uploaded === 0) {
    return {
      productId, downloaded, uploaded, dbUpdated: false,
      error: `no successful uploads (${failures.length} failures)`,
      failures,
    };
  }

  const newProof = {
    ...(product.proof_of_completion || {}),
    permanent_preview_urls: permanent,
    permanent_image_url: heroUrl,
    permanent_uploaded_at: new Date().toISOString(),
    gelato_preview_urls: permanent,
  };

  const update = { proof_of_completion: newProof };
  if (heroUrl) update.image_url = heroUrl;

  const { error: uErr } = await supabase
    .from('dubis_products')
    .update(update)
    .eq('product_id_numeric', productId);

  if (uErr) {
    console.error(`  ✗ DB update failed: ${uErr.message}`);
    return {
      productId, downloaded, uploaded, dbUpdated: false,
      error: uErr.message, heroUrl, permanent, failures,
    };
  }

  console.log(`  ✓ DB updated (image_url + proof_of_completion)`);
  return {
    productId, downloaded, uploaded, dbUpdated: true,
    heroUrl, permanent, colors: Object.keys(permanent), failures,
  };
}

const results = [];
for (const id of PRODUCT_IDS) {
  results.push(await migrateProduct(id));
}

console.log('\n======== SUMMARY ========');
for (const r of results) {
  console.log(JSON.stringify(r));
}

// Pipeline mode: emit a machine-readable manifest the workflow can capture
// and forward to the gha-pipeline-callback so DB ends up with permanent URLs.
if (PIPELINE_MODE && results.length === 1) {
  const r = results[0];
  console.log('===PERMANENT_MANIFEST===');
  console.log(JSON.stringify({
    productId: r.productId,
    dbUpdated: !!r.dbUpdated,
    permanent_preview_urls: r.permanent || {},
    permanent_image_url: r.heroUrl || null,
  }));
  console.log('===END_PERMANENT_MANIFEST===');
}

// Fail the GHA step if any product failed to migrate.
const failed = results.filter(r => !r.dbUpdated);
if (failed.length) {
  console.error(`\n✗ Migration failed for ${failed.length}/${results.length} product(s).`);
  process.exit(1);
}
