// DUBIS — Google Merchant Center product feed (XML/RSS 2.0)
// Standalone edge function. Public, no JWT.
// Exposed at https://www.dubis.net/shopping-feed.xml via vercel.json rewrite.
// Regenerated per-request; cached 6h at CDN edge.

import { createClient } from 'npm:@supabase/supabase-js@2';

// Service-role key — rotation 2026-06: prefer the sb_secret 'dubissecretkey' key (Supabase
// injects it in SUPABASE_SECRET_KEYS as JSON), fall back to the legacy service_role JWT
// during the transition, so the legacy + exposed 'default' keys can be disabled with zero downtime.
const SERVICE_ROLE = (() => {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')['dubissecretkey']; if (k) return k as string; } catch { /* not migrated yet */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
})();

function sbAdmin() {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    SERVICE_ROLE,
  );
}

Deno.serve(async (_req: Request) => {
  const sb = sbAdmin();

  const { data: products, error: pErr } = await sb
    .from('dubis_products')
    .select('id, product_id_numeric, slogan, clothing_type, gender, price_usd, colors, description_en, category')
    .eq('active', true)
    .order('product_id_numeric', { ascending: true });
  if (pErr) return new Response(`DB error: ${pErr.message}`, { status: 500 });

  const productIds = (products || []).map((p: any) => p.id);
  const { data: images } = await sb
    .from('dubis_images')
    .select('product_id, image_url, approved, quality_score')
    .in('product_id', productIds)
    .order('approved', { ascending: false })
    .order('quality_score', { ascending: false, nullsFirst: false });

  const bestImageByProduct = new Map<string, string>();
  for (const img of (images || []) as any[]) {
    if (!bestImageByProduct.has(img.product_id) && img.image_url) {
      bestImageByProduct.set(img.product_id, img.image_url);
    }
  }

  const esc = (s: unknown) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  const clothingTypeLabel: Record<string, string> = {
    't-shirt': 'T-Shirt',
    'hoodie': 'Hoodie',
    'zip-hoodie': 'Zip Hoodie',
    'long-sleeve': 'Long Sleeve Tee',
    'cap': 'Cap',
  };
  const googleCategory: Record<string, string> = {
    't-shirt': '212',
    'long-sleeve': '212',
    'hoodie': '2271',
    'zip-hoodie': '2271',
    'cap': '175',
  };
  const genderMap: Record<string, string> = {
    'men': 'male',
    'women': 'female',
    'unisex': 'unisex',
    'male': 'male',
    'female': 'female',
  };
  const apparelSizes = ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

  const items: string[] = [];
  for (const p of (products || []) as any[]) {
    const id = p.product_id_numeric;
    // Primary image = canonical catalog mockup (SoT per CLAUDE.md): images/product-{id}-{Color}-front.jpg
    // Prefer Black (every product carries it), else first color; fall back to dubis_images lifestyle shot.
    const colorList: string[] = Array.isArray(p.colors) ? p.colors : [];
    const mockColor = colorList.includes('Black') ? 'Black' : colorList[0];
    const mockupUrl = mockColor
      ? `https://www.dubis.net/images/product-${id}-${encodeURIComponent(mockColor)}-front.jpg`
      : null;
    const img = mockupUrl || bestImageByProduct.get(p.id);
    if (!img) continue;
    const typeLbl = clothingTypeLabel[p.clothing_type] || p.clothing_type || 'Apparel';
    const title = `DUBIS — ${p.slogan} ${typeLbl}`;
    const descFallback = `${p.slogan}. A ${String(typeLbl).toLowerCase()} from DUBIS — built for the body you actually live in. Body-positive humor apparel for the rest of us. Soft cotton, relaxed fit, sizes S through 3XL, made to order.`;
    const desc = p.description_en || descFallback;
    const price = `${Number(p.price_usd).toFixed(2)} USD`;
    // ?p=N (not #product-N): fragments are dropped by redirectors/crawlers — same fix as social links 2026-04-21.
    const link = `https://www.dubis.net/?p=${id}`;
    const colors = Array.isArray(p.colors) && p.colors.length > 0 ? p.colors.join('/') : 'Mixed';
    const cat = googleCategory[p.clothing_type] || '1604';
    const gender = genderMap[p.gender] || 'unisex';

    const sizes = p.clothing_type === 'cap' ? ['One Size'] : apparelSizes;

    for (const size of sizes) {
      const sizeSuffix = size === 'One Size' ? 'OS' : size;
      items.push(`    <item>
      <g:id>DUBIS-${id}-${sizeSuffix}</g:id>
      <g:item_group_id>DUBIS-${id}</g:item_group_id>
      <g:title>${esc(title)} (${esc(size)})</g:title>
      <g:description>${esc(desc)}</g:description>
      <g:link>${link}</g:link>
      <g:image_link>${esc(img)}</g:image_link>${mockupUrl && bestImageByProduct.get(p.id) ? `
      <g:additional_image_link>${esc(bestImageByProduct.get(p.id))}</g:additional_image_link>` : ''}
      <g:availability>in_stock</g:availability>
      <g:price>${price}</g:price>
      <g:brand>DUBIS</g:brand>
      <g:condition>new</g:condition>
      <g:google_product_category>${cat}</g:google_product_category>
      <g:product_type>Apparel &amp; Accessories &gt; Clothing &gt; ${esc(typeLbl)}</g:product_type>
      <g:gender>${gender}</g:gender>
      <g:age_group>adult</g:age_group>
      <g:color>${esc(colors)}</g:color>
      <g:size>${esc(size)}</g:size>
      <g:size_system>US</g:size_system>
      <g:identifier_exists>no</g:identifier_exists>
      <g:mpn>DUBIS-${id}-${sizeSuffix}</g:mpn>
      <g:shipping>
        <g:country>US</g:country>
        <g:service>Standard</g:service>
        <g:price>0.00 USD</g:price>
      </g:shipping>
    </item>`);
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>DUBIS — For the rest of us</title>
    <link>https://www.dubis.net</link>
    <description>Body-positive humor apparel. Built for the body you actually live in.</description>
${items.join('\n')}
  </channel>
</rss>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=21600, s-maxage=21600',
      'Access-Control-Allow-Origin': '*',
      'X-Robots-Tag': 'noindex',
    },
  });
});
