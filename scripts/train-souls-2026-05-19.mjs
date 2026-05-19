#!/usr/bin/env node
// train-souls-2026-05-19.mjs — Phase 0 step 2
// Uploads persona photos to Higgsfield + trains soul-2 for each.
// Updates personas-v3.json with reference_ids.
//
// Run: node scripts/train-souls-2026-05-19.mjs [--persona men-3] [--variant soul-2|soul-cinematic|both] [--photos 8]
// Default: --variant soul-2 (the most-used variant; soul-cinematic only if oren wants cinema stills)

import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const HF = 'C:\\Users\\tehar\\bin\\hf.exe';
const ARGS = process.argv.slice(2);
const onlyPersona = ARGS.includes('--persona') ? ARGS[ARGS.indexOf('--persona') + 1] : null;
const variant = ARGS.includes('--variant') ? ARGS[ARGS.indexOf('--variant') + 1] : 'soul-2';
const numPhotos = ARGS.includes('--photos') ? Number(ARGS[ARGS.indexOf('--photos') + 1]) : 8;

const PERSONAS_PATH = path.resolve('videos/il-campaign/personas-v3.json');
const PERSONAS_FILE = JSON.parse(fs.readFileSync(PERSONAS_PATH, 'utf8'));
const PHOTOS_BASE = path.resolve('images/personas');

function hf(args) {
  const r = spawnSync(HF, args, { encoding: 'utf8', shell: false });
  if (r.status !== 0) throw new Error(`hf ${args.join(' ')} failed (${r.status}): ${r.stderr || r.stdout}`);
  return r.stdout;
}

function getPhotoFiles(personaId, max) {
  const dir = path.join(PHOTOS_BASE, personaId);
  if (!fs.existsSync(dir)) throw new Error(`No photos dir for ${personaId}`);
  const files = fs.readdirSync(dir).filter((f) => /^photo-\d+\.jpg$/.test(f)).sort();
  if (files.length < 5) throw new Error(`${personaId} has only ${files.length} photos (need ≥5)`);
  return files.slice(0, max).map((f) => path.join(dir, f));
}

function uploadPhoto(filepath) {
  const out = hf(['upload', 'create', filepath, '--json']);
  const json = JSON.parse(out);
  if (!json.id) throw new Error('Upload returned no id: ' + out);
  return json.id;
}

function trainSoul(name, variant, imageIds) {
  const args = ['soul-id', 'create', '--name', name, `--${variant}`];
  imageIds.forEach((id) => { args.push('--image', id); });
  args.push('--json');
  const out = hf(args);
  const json = JSON.parse(out);
  return json;
}

function waitSoul(soulId, timeoutMin = 30) {
  const r = spawnSync(HF, ['soul-id', 'wait', soulId, '--timeout', `${timeoutMin}m`, '--json'], { encoding: 'utf8' });
  // Wait can succeed (0) or timeout (non-zero); read stdout regardless
  return r.stdout ? JSON.parse(r.stdout) : null;
}

function updatePersonaSoulId(personaId, variant, soulRefId) {
  const persona = PERSONAS_FILE.personas.find((p) => p.id === personaId);
  if (!persona) throw new Error(`Persona ${personaId} not in JSON`);
  if (variant === 'soul-2') persona.soul_id = soulRefId;
  else if (variant === 'soul-cinematic') persona.soul_cinema_id = soulRefId;
  fs.writeFileSync(PERSONAS_PATH, JSON.stringify(PERSONAS_FILE, null, 2) + '\n');
}

async function processOne(persona, variantStr) {
  const v = variantStr.replace('--', '');
  console.log(`\n=== ${persona.id} :: ${v} ===`);
  console.log(`  selecting ${numPhotos} photos…`);
  const files = getPhotoFiles(persona.id, numPhotos);
  console.log(`  ${files.length} files: ${files.map((f) => path.basename(f)).join(', ')}`);

  console.log(`  uploading…`);
  const ids = [];
  for (const f of files) {
    const id = uploadPhoto(f);
    ids.push(id);
    console.log(`    ${path.basename(f)} → ${id.slice(0, 12)}…`);
  }

  console.log(`  submitting soul-id create --${v}…`);
  const job = trainSoul(`dubis-${persona.id}-${v}-${Date.now().toString().slice(-6)}`, v, ids);
  const soulId = job.id || job.soul_id || job.reference_id;
  if (!soulId) {
    console.error(`  FAIL: no soul id in response: ${JSON.stringify(job).slice(0, 300)}`);
    return null;
  }
  console.log(`  soul training submitted: ${soulId}`);

  console.log(`  polling (up to 30 min)…`);
  const finished = waitSoul(soulId, 30);
  if (!finished) {
    console.warn(`  WARN: wait returned empty; may still be training. soul=${soulId}`);
    return soulId;
  }
  console.log(`  finished: state=${finished.state || finished.status || 'unknown'}`);
  if (finished.state && !['ready', 'completed', 'active'].includes(String(finished.state).toLowerCase())) {
    console.error(`  FAIL: state=${finished.state}`);
    return null;
  }

  updatePersonaSoulId(persona.id, v, soulId);
  console.log(`  ✓ saved soul_${v === 'soul-2' ? 'id' : 'cinema_id'}=${soulId} for ${persona.id}`);
  return soulId;
}

async function main() {
  const startBalance = JSON.parse(hf(['account', 'status', '--json'])).credits;
  console.log(`Starting balance: ${startBalance} credits`);

  const targets = onlyPersona ? PERSONAS_FILE.personas.filter((p) => p.id === onlyPersona) : PERSONAS_FILE.personas;
  if (!targets.length) { console.error(`No personas match "${onlyPersona}"`); process.exit(1); }

  const variants = variant === 'both' ? ['soul-2', 'soul-cinematic'] : [variant];
  console.log(`Plan: ${targets.length} personas × ${variants.length} variant(s) = ${targets.length * variants.length} trainings\n`);

  const ok = [], failed = [];
  for (const persona of targets) {
    for (const v of variants) {
      try {
        const id = await processOne(persona, v);
        if (id) ok.push(`${persona.id}/${v}`);
        else failed.push(`${persona.id}/${v}`);
      } catch (e) {
        console.error(`  EXCEPTION ${persona.id}/${v}: ${e.message}`);
        failed.push(`${persona.id}/${v}`);
      }
    }
  }

  const endBalance = JSON.parse(hf(['account', 'status', '--json'])).credits;
  console.log(`\n=== DONE ===`);
  console.log(`Successes: ${ok.length} — ${ok.join(', ')}`);
  console.log(`Failures: ${failed.length} — ${failed.join(', ')}`);
  console.log(`Credit usage: ${startBalance} → ${endBalance} (delta: ${startBalance - endBalance})`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
