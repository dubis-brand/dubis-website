#!/usr/bin/env node
// probe-hf-api.mjs — schema discovery for the Higgsfield agents REST API.
//
// WHY: 8 CI runs proved the `higgsfield` CLI binary cannot make requests from
// GitHub runners ("no response received") while plain fetch to the SAME hosts
// works — including the token refresh (run 32470091935: "direct refresh OK").
// So the generator is moving to direct REST. The API is FastAPI (404s return
// {"detail":"Not Found"}), which means invalid POSTs return 422 with a
// field-by-field schema — this probe farms those errors to learn the shapes.
//
// SPENDS NOTHING: only GET endpoints + /agents/jobs/cost (a quote, not a job).
//
// Env: HIGGSFIELD_CREDENTIALS_PATH, HIGGSFIELD_WORKSPACE_ID (optional)

import fs from 'fs';
import os from 'os';
import path from 'path';

const CREDS_PATH = process.env.HIGGSFIELD_CREDENTIALS_PATH
  || path.join(os.homedir(), '.config', 'higgsfield', 'credentials.json');
const WORKSPACE_ID = process.env.HIGGSFIELD_WORKSPACE_ID || '52a7bfe8-e226-42cf-856a-6d5ccbba0f7f';
const API = 'https://fnf.higgsfield.ai';
const log = (...a) => console.log(...a);

let TOKEN = '';

async function refresh() {
  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
  const r = await fetch('https://fnf-device-auth.higgsfield.ai/refresh', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: creds.refresh_token }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`refresh ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  TOKEN = j.access_token;
  fs.writeFileSync(CREDS_PATH, JSON.stringify({
    access_token: j.access_token, refresh_token: j.refresh_token || creds.refresh_token,
  }));
  log('refresh: OK (chain rotated + written back)');
}

async function call(method, p, body, label) {
  try {
    const r = await fetch(`${API}${p}`, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    log(`\n### ${label || `${method} ${p}`} -> HTTP ${r.status}`);
    log(text.slice(0, 1200));
    try { return { status: r.status, json: JSON.parse(text) }; } catch { return { status: r.status, json: null }; }
  } catch (e) {
    log(`\n### ${label || `${method} ${p}`} -> NETWORK FAIL ${e.message.slice(0, 120)}`);
    return { status: 0, json: null };
  }
}

(async () => {
  await refresh();

  await call('GET', '/agents/balance');
  await call('GET', '/agents/workspaces');

  // workspace select — guess the body; 422 tells us the real field name
  const sel1 = await call('POST', '/agents/workspaces/select', { workspace_id: WORKSPACE_ID }, 'select {workspace_id}');
  if (sel1.status === 422) await call('POST', '/agents/workspaces/select', { id: WORKSPACE_ID }, 'select {id}');

  // models — the catalog with, hopefully, per-model param schemas
  const models = await call('GET', '/agents/models');
  if (models.json && Array.isArray(models.json)) {
    const veo = models.json.find(m => m.job_set_type === 'veo3_1');
    if (veo) {
      const props = veo.params && veo.params.properties;
      log('\n### veo3_1 required: ' + JSON.stringify(veo.params && veo.params.required));
      log('### veo3_1 properties (full):');
      log(JSON.stringify(props, null, 0));
      const defs = veo.params && veo.params.$defs;
      if (defs) log('### veo3_1 $defs keys: ' + Object.keys(defs).join(', '));
    } else {
      log('\n### veo3_1 NOT in catalog; types present: ' + models.json.map(m => m.job_set_type).join(','));
    }
    const soul = models.json.find(m => m.job_set_type === 'text2image_soul_v2');
    if (soul) log('\n### soul_v2 required: ' + JSON.stringify(soul.params && soul.params.required));
  }

  // cost — the schema oracle. Empty body first: the 422 names every field.
  await call('POST', '/agents/jobs/cost', {}, 'cost {}');
  await call('POST', '/agents/jobs/cost',
    { job_set_type: 'veo3_1' }, 'cost {job_set_type}');
  await call('POST', '/agents/jobs/cost',
    { job_set_type: 'veo3_1', params: { prompt: 'probe', aspect_ratio: '9:16', duration: 8, quality: 'high' } },
    'cost {job_set_type, params{...}}');

  // photoshoot enhance — schema for the WARDROBE-LOCK hero step
  await call('POST', '/agents/product-photoshoot/enhance', {}, 'enhance {}');
  await call('POST', '/agents/product-photoshoot/enhance',
    { mode: 'virtual_model_tryout', prompt: 'probe' }, 'enhance {mode,prompt}');

  // uploads — learn the contract from 422s (nothing is stored by an invalid call)
  await call('GET', '/agents/uploads?type=image');
  await call('POST', '/agents/uploads', {}, 'upload POST {}');
  await call('POST', '/agents/uploads?type=image', {}, 'upload POST ?type=image {}');
  // cost with a media reference — validates the input-image field name end-to-end
  await call('POST', '/agents/jobs/cost',
    { job_set_type: 'veo3_1', params: { prompt: 'probe', aspect_ratio: '9:16', duration: 8, quality: 'high',
      media: [{ role: 'start_image', data: { id: '00000000-0000-0000-0000-000000000000', type: 'media_input' } }] } },
    'cost veo3_1 + media[start_image]');
  await call('POST', '/agents/jobs/cost',
    { job_set_type: 'veo3_1', params: { prompt: 'probe', aspect_ratio: '9:16', duration: 8, quality: 'high',
      input_images: [{ id: '00000000-0000-0000-0000-000000000000', type: 'media_input' }] } },
    'cost veo3_1 + input_images[]');

  // hand the rotated chain back to the workflow
  console.log('===HF_CREDENTIALS===');
  console.log(fs.readFileSync(CREDS_PATH, 'utf8').trim());
  console.log('===END_HF_CREDENTIALS===');
})();
