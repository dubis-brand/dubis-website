// DUBIS TikTok content v5 - DIRECT Late.com API + RPC vault access + priority fix
import { createClient } from 'npm:@supabase/supabase-js@2';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';

async function vaultGet(sb, name) {
  try { const { data } = await sb.rpc('get_vault_secret', { secret_name: name }); return data || ''; } catch (e) { return ''; }
}
async function getGemini(sb) { return Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('GOOGLE_AI_KEY') ?? await vaultGet(sb, 'dubis_gemini_api_key'); }

async function pickProduct(sb, forcePid) {
  if (forcePid) { const { data } = await sb.from('dubis_products').select('id, product_id_numeric, slogan, clothing_type, gender, colors, description_en, image_url').eq('product_id_numeric', forcePid).single(); return data; }
  const { data: products } = await sb.from('dubis_products').select('id, product_id_numeric, slogan, clothing_type, gender, colors, description_en, image_url').eq('active', true).order('product_id_numeric');
  if (!products || !products.length) return null;
  const ago = new Date(Date.now() - 7*24*3600*1000).toISOString();
  const { data: recent } = await sb.from('agent_tasks').select('content_data').eq('agent_id', 'tiktok').gte('created_at', ago);
  const seen = new Set(); for (const t of (recent||[])) { const p = t.content_data?.product_id_numeric; if (p) seen.add(p); }
  const eligible = products.filter(p => !seen.has(p.product_id_numeric));
  const pool = eligible.length ? eligible : products;
  return pool[Math.floor(Math.random() * pool.length)];
}

async function generateCaptions(geminiKey, product) {
  const slogan = product.slogan || 'DUBIS';
  const desc = product.description_en || '';
  const type = product.clothing_type || 'apparel';
  const prompt = 'You are a TikTok copywriter for DUBIS - a US apparel brand for real bodies aged 35-55. Brand voice: dry humor, irreverent, NEVER apologetic.\n\nProduct: "' + slogan + '" (' + type + ')\nDescription: ' + desc + '\n\nWrite 3 DIFFERENT TikTok captions, each 80-180 chars, with bold hook + slogan + soft CTA. Then 10 hashtags including #dubis. JSON: {"captions":["c1","c2","c3"],"hashtags":["#tag1"]}';
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + geminiKey, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.95 } }), signal: AbortSignal.timeout(45000) });
  if (!r.ok) throw new Error('gemini-' + r.status);
  const d = await r.json();
  return JSON.parse(d?.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
}

async function publishViaLate(latekey, accountId, text, videoUrl, scheduleAtIso) {
  if (!latekey) return { skipped: 'no-late-key' };
  if (!accountId) return { skipped: 'no-account-id' };
  if (!videoUrl) return { skipped: 'no-video-url' };
  const payload = { content: text, platforms: [{ platform: 'tiktok', accountId }], mediaItems: [{ type: 'video', url: videoUrl }], tiktokSettings: { privacy_level: 'PUBLIC_TO_EVERYONE', allow_comment: true, allow_duet: true, allow_stitch: true } };
  if (scheduleAtIso) { payload.publishNow = false; payload.scheduledFor = scheduleAtIso; payload.timezone = 'UTC'; } else { payload.publishNow = true; }
  try {
    const r = await fetch('https://getlate.dev/api/v1/posts', { method: 'POST', headers: { 'Authorization': 'Bearer ' + latekey, 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(90000) });
    const txt = await r.text();
    let p; try { p = JSON.parse(txt); } catch (e) { p = { raw: txt.slice(0, 400) }; }
    return { ok: r.ok, status: r.status, late_post_id: p?.post?._id || null, late_status: p?.post?.status || null, body: txt.slice(0, 400) };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function emailOren(product, captions, hashtags, taskId, videoUrl, lateResult) {
  if (!RESEND_KEY) return false;
  const slogan = product.slogan || ''; const pid = product.product_id_numeric;
  const img = product.image_url || ('https://www.dubis.net/images/product-' + pid + '.jpg');
  const captionsHtml = (captions||[]).map((c,i) => '<div style="background:#0d0d0d;border:1px solid #2a2a2a;border-radius:8px;padding:14px;margin:8px 0"><div style="color:#888;font-size:11px">V' + (i+1) + '</div><div style="color:#e8e0d5;white-space:pre-wrap">' + c + '</div></div>').join('');
  let lateStatus = '';
  if (lateResult?.ok) lateStatus = '<div style="background:#0d2d0d;color:#7fb069;padding:10px;border-radius:8px">PUBLISHED to TikTok via Late - post: ' + lateResult.late_post_id + '</div>';
  else if (lateResult?.skipped) lateStatus = '<div style="background:#2d2d0d;color:#c8a96e;padding:10px;border-radius:8px">Skipped: ' + lateResult.skipped + '</div>';
  else if (lateResult) lateStatus = '<div style="background:#3d0d0d;color:#e58a8a;padding:10px;border-radius:8px">Failed: ' + (lateResult.error || ('HTTP ' + lateResult.status)) + ' ' + (lateResult.body||'') + '</div>';
  const videoBlock = videoUrl ? '<p>Video: <a href="' + videoUrl + '">' + videoUrl + '</a></p>' : '<p>Image: <a href="' + img + '">' + img + '</a></p>';
  const html = '<html dir="rtl"><body style="font-family:Arial;max-width:680px;margin:0 auto;background:#0d0d0d;color:#e8e0d5;padding:24px"><h2 style="color:#c8a96e">DUBIS TikTok</h2><p>Product: "' + slogan + '" (#' + pid + ')</p><img src="' + img + '" style="max-width:400px;border-radius:8px">' + videoBlock + lateStatus + '<h3 style="color:#c8a96e">Captions</h3>' + captionsHtml + '<h3 style="color:#c8a96e">Tags</h3><div style="font-family:monospace;color:#7fb069">' + (hashtags||[]).join(' ') + '</div><p style="color:#666;font-size:12px">Task: ' + taskId + ' / v5 Late direct (RPC vault)</p></body></html>';
  try { await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'DUBIS Agents <orders@dubis.net>', to: ['dubis.brand@gmail.com'], subject: '[DUBIS TikTok] ' + slogan + (lateResult?.ok ? ' PUBLISHED' : ''), html }) }); return true; } catch (e) { return false; }
}

Deno.serve(async (req) => {
  const t0 = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
  const body = await req.json().catch(() => ({}));
  const forcePid = parseInt(body.product_id_numeric || '0', 10) || null;
  const videoUrl = body.video_url || null;
  const renderer = body.renderer || null;
  const scheduleAt = body.schedule_at || null;

  const product = await pickProduct(sb, forcePid);
  if (!product) return new Response(JSON.stringify({ error: 'no-products' }), { status: 404 });

  const KEY = await getGemini(sb);
  if (!KEY) return new Response(JSON.stringify({ error: 'no-gemini-key' }), { status: 500 });

  let parsed;
  try { parsed = await generateCaptions(KEY, product); } catch (e) { return new Response(JSON.stringify({ error: 'caption-failed', detail: e.message }), { status: 502 }); }

  const captions = Array.isArray(parsed.captions) ? parsed.captions.slice(0, 3) : [];
  const hashtags = Array.isArray(parsed.hashtags) ? parsed.hashtags.slice(0, 12) : [];
  if (!captions.length) return new Response(JSON.stringify({ error: 'no-captions' }), { status: 502 });

  const slogan = product.slogan || 'DUBIS';
  const pid = product.product_id_numeric;
  const fullText = captions[0] + '\n\n' + hashtags.join(' ');

  const lateKey = await vaultGet(sb, 'dubis_late_api_key');
  const tiktokAccountId = await vaultGet(sb, 'dubis_late_tiktok_account_id');
  const lateResult = await publishViaLate(lateKey, tiktokAccountId, fullText, videoUrl, scheduleAt);

  const contentData = { product_id_numeric: pid, product_slogan: slogan, product_url: 'https://www.dubis.net/?p=' + pid, image_url: product.image_url || ('https://www.dubis.net/images/product-' + pid + '.jpg'), captions, hashtags, platform: 'tiktok', video_url: videoUrl, video_renderer: renderer, generated_at: new Date().toISOString(), publish_method: lateResult?.ok ? 'late-direct' : (lateResult?.skipped || 'manual'), late_post_id: lateResult?.late_post_id, late_status: lateResult?.late_status };
  const taskStatus = lateResult?.ok ? 'done' : 'pending_approval';
  const proof = lateResult?.ok ? { tiktok_late_post_id: lateResult.late_post_id, published_at: new Date().toISOString(), publisher: 'late-direct' } : null;

  const { data: inserted, error: insErr } = await sb.from('agent_tasks').insert({ title: 'TikTok Post - ' + slogan, description: 'captions+tags' + (videoUrl?'+video':'') + (lateResult?.ok?' (auto)':''), agent_id: 'tiktok', status: taskStatus, priority: 'medium', category: 'tiktok_post', content_data: contentData, proof_of_completion: proof }).select('id').single();
  const taskId = inserted?.id || ('?:' + (insErr?.message || 'no-data'));
  const emailed = await emailOren(product, captions, hashtags, taskId, videoUrl, lateResult);

  await sb.from('agent_runs').insert({ agent_id: 'tiktok', status: 'completed', proof_verified: !!lateResult?.ok || !videoUrl, summary: 'tiktok pid=' + pid + ' caps=' + captions.length + ' video=' + (videoUrl?'yes':'no') + ' late=' + (lateResult?.ok ? 'PUBLISHED ' + lateResult.late_post_id : (lateResult?.skipped || lateResult?.error || ('HTTP ' + lateResult?.status))) + ' task=' + taskId + ' emailed=' + emailed, side_effects: { task_id: taskId, product_id_numeric: pid, video_url: videoUrl, renderer, late: lateResult, emailed, ins_err: insErr?.message }, duration_ms: Date.now() - t0, tasks_completed_ids: inserted?.id ? [inserted.id] : [] });

  return new Response(JSON.stringify({ ok: true, task_id: taskId, product_id_numeric: pid, captions, hashtags, video_url: videoUrl, late: lateResult, emailed, ins_err: insErr?.message }), { headers: { 'Content-Type': 'application/json' } });
});
