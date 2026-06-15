#!/usr/bin/env node
/**
 * check-site-headers.js — fetch a URL and assert the security headers exist.
 * Mirrors what the live `security` agent checks, so there is ONE definition of
 * "the headers we require". Writes a JSON result the report script consumes.
 *
 * Usage: node scripts/check-site-headers.js <url> <outFile>
 *   e.g. node scripts/check-site-headers.js https://www.dubis.net scan-results/headers.json
 *
 * Output JSON: { ok, status, missing[], present{}, url, checked_at }
 */

const fs = require('fs');

// Required security headers (lowercased). Source of truth for both this GHA and
// the live agent. If you add a header in vercel.json, add it here too.
const REQUIRED = [
  'content-security-policy',
  'x-content-type-options',
  'x-frame-options',
  'strict-transport-security',
  'referrer-policy',
];

const url = process.argv[2] || 'https://www.dubis.net';
const outFile = process.argv[3] || 'scan-results/headers.json';

(async () => {
  let status = 0;
  let headers = {};
  let fetchError = null;
  try {
    // Node 18+ global fetch. Use GET (some edges don't expose headers on HEAD).
    const res = await fetch(url, { redirect: 'follow' });
    status = res.status;
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  } catch (e) {
    fetchError = String(e && e.message || e);
  }

  const present = {};
  const missing = [];
  for (const h of REQUIRED) {
    if (headers[h]) present[h] = headers[h].slice(0, 120);
    else missing.push(h);
  }

  const ok = !fetchError && status >= 200 && status < 400 && missing.length === 0;

  const result = {
    ok,
    status,
    url,
    missing,
    present,
    fetch_error: fetchError,
    checked_at: new Date().toISOString(),
  };

  fs.mkdirSync(require('path').dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));

  if (fetchError) {
    console.error(`[check-site-headers] fetch failed: ${fetchError}`);
  } else {
    console.log(`[check-site-headers] ${url} → ${status} · ok=${ok}${missing.length ? ` · missing: ${missing.join(', ')}` : ''}`);
  }
  // Always succeed — the report script decides findings, the workflow gate handles
  // red status. Let the event loop drain naturally (no force-exit) so the JSON
  // write fully flushes on every platform.
  process.exitCode = 0;
})();
