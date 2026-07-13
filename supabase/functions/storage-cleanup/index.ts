// storage-cleanup — storage janitor for published/stale marketing assets.
// Deployed 2026-07-13 via Supabase MCP (NOT part of deploy.bat / agents deploy flow).
// The deployed version has a real random token; this repo copy is a placeholder —
// if you redeploy, generate a new token and update memory/troubleshooting.md.
// Invoke from SQL (env proxies block direct curl):
//   SELECT content FROM http_get('https://ntzwvqtpdmvvavbhuyeb.supabase.co/functions/v1/storage-cleanup?token=<TOKEN>&dry=1');
//   dry=1 → preview only, dry=0 → actually delete.
// IMPORTANT: delete storage files ONLY through the Storage API like this function does.
// `DELETE FROM storage.objects` orphans the underlying S3 blobs and they keep counting
// toward the billed storage size.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CLEANUP_TOKEN = 'REPLACE_WITH_RANDOM_TOKEN_BEFORE_DEPLOY';

// bucket + prefix ('' = whole bucket) + optional keepDays (only delete files older than N days)
const TARGETS: { bucket: string; prefix: string; keepDays?: number }[] = [
  { bucket: 'video-assets', prefix: '_pilot' },
  { bucket: 'tiktok-videos', prefix: '' },
  { bucket: 'videos', prefix: '' },
  { bucket: 'ig-images', prefix: '', keepDays: 30 },
];

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

async function listAll(bucket: string, prefix: string): Promise<{ path: string; created_at: string; size: number }[]> {
  const out: { path: string; created_at: string; size: number }[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (!item.id) {
        out.push(...await listAll(bucket, path)); // folder → recurse
      } else {
        out.push({ path, created_at: item.created_at, size: item.metadata?.size ?? 0 });
      }
    }
    if (data.length < 1000) break;
    offset += data.length;
  }
  return out;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (url.searchParams.get('token') !== CLEANUP_TOKEN) {
    return new Response(JSON.stringify({ success: false, error: 'forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  const dryRun = url.searchParams.get('dry') !== '0';
  const report: Record<string, unknown>[] = [];
  let totalFiles = 0, totalBytes = 0;

  try {
    for (const t of TARGETS) {
      const files = await listAll(t.bucket, t.prefix);
      const cutoff = t.keepDays ? Date.now() - t.keepDays * 86400_000 : null;
      const victims = files.filter((f) => !cutoff || new Date(f.created_at).getTime() < cutoff);
      const bytes = victims.reduce((s, f) => s + f.size, 0);
      let deleted = 0;
      const errors: string[] = [];
      if (!dryRun && victims.length) {
        for (let i = 0; i < victims.length; i += 100) {
          const chunk = victims.slice(i, i + 100).map((f) => f.path);
          const { data, error } = await supabase.storage.from(t.bucket).remove(chunk);
          if (error) errors.push(error.message);
          else deleted += data?.length ?? chunk.length;
        }
      }
      totalFiles += victims.length;
      totalBytes += bytes;
      report.push({ bucket: t.bucket, prefix: t.prefix || '(all)', keepDays: t.keepDays ?? null, matched: victims.length, mb: Math.round(bytes / 1048576), deleted, errors });
    }
    return new Response(JSON.stringify({ success: true, dryRun, totalFiles, totalMB: Math.round(totalBytes / 1048576), report }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
