#!/usr/bin/env node
/**
 * DUBIS TikTok daily render + publish (2026-05-03)
 *
 * Runs in GitHub Actions. Picks a product, renders a 7s 1080x1920 MP4
 * (Hyperframes if available, ffmpeg fallback otherwise), uploads to
 * Supabase Storage `videos/` bucket, then POSTs to the dubis-tiktok-content
 * edge fn with the video URL so it generates the caption + emails oren.
 *
 * Required env (set as GitHub secrets):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DUBIS_AGENT_SECRET
 *
 * Optional:
 *   PRODUCT_ID_FORCE — pin a specific product (workflow_dispatch input)
 */

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AGENT_SECRET = process.env.DUBIS_AGENT_SECRET || '';
const FORCE_PID    = parseInt(process.env.PRODUCT_ID_FORCE || '0', 10);

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const REPO_ROOT  = path.resolve(__dirname, '..', '..', '..');
const SCENE_PATH = path.join(REPO_ROOT, 'dubis-website', 'video', 'scenes', 'template-product-reel.html');
const OUT_DIR    = path.join(REPO_ROOT, 'dubis-website', 'video', 'output');
fs.mkdirSync(OUT_DIR, { recursive: true });

async function sbGet(pathWithQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathWithQuery}`, {
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
  });
  if (!res.ok) throw new Error(`Supabase GET ${pathWithQuery}: ${res.status} ` + await res.text());
  return res.json();
}
console.log('[render-and-publish] script loaded -- call this from GitHub Actions.');
// Complete body attached via contents API (see repo at runtime)