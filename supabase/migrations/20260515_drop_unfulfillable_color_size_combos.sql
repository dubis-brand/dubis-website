-- 2026-05-15 — Drop colors/sizes that don't exist in Gelato's current catalog.
-- Companion to the productUid rewrite in api/create-gelato-order.js +
-- supabase/functions/gelato-stock-check/index.ts.
--
-- Verified 2026-05-15: every (product, color, size) below returns 200 from
-- GET https://product.gelatoapis.com/v3/products/{uid}. The dropped entries
-- previously returned 404 — orders for them would have captured PayPal,
-- failed Gelato, and triggered auto-refund. Better to not let users select
-- them at all.
--
-- Brands now used (resolved at order time):
--   tshirt unisex:     gildan/64000           (forest-green → next-level/3600 override)
--   tshirt womens:     bella-and-canvas/6004  (max size 2XL — no 3XL)
--   hoodie unisex:     gildan/18500
--   hoodie womens:     legacy alias `..._gpr_4-4` (no brand suffix; covers black/white/navy/charcoal)
--   ziphoodie unisex:  legacy alias
--   longsleeve unisex: gildan/2400
--   longsleeve womens: sols/02075             (max size XL — no 2XL/3XL, no Cream)
--   cap:               as-colour/1114 DTF     (no Charcoal in this brand)

BEGIN;

-- Product 7 (cap unisex) — Charcoal is not in AS Colour 1114 dad-hat catalog.
UPDATE public.dubis_products
   SET colors = '["Cream","Black","Navy"]'::jsonb
 WHERE product_id_numeric = 7;

-- Product 13 (hoodie women) — Cream/Sand is not in the womens pullover catalog.
UPDATE public.dubis_products
   SET colors = '["Charcoal","Navy","Black"]'::jsonb
 WHERE product_id_numeric = 13;

-- Product 14 (longsleeve women) — SOLS 02075 has no cream/natural color and
-- caps out at size XL. The new sizes_override column (if absent) stays NULL
-- and js/products.js carries the size override as the authoritative source.
UPDATE public.dubis_products
   SET colors = '["White","Black","Navy"]'::jsonb
 WHERE product_id_numeric = 14;

-- Remove rows from product_variant_stock that map to UIDs that no longer
-- exist in Gelato's catalog, so the daily stock-check doesn't keep logging
-- "not-in-catalog" for them.
DELETE FROM public.product_variant_stock
 WHERE (product_id_numeric = 7  AND color = 'Charcoal')
    OR (product_id_numeric = 13 AND color = 'Cream')
    OR (product_id_numeric = 14 AND color = 'Cream')
    OR (product_id_numeric IN (11, 12) AND size = '3XL')
    OR (product_id_numeric = 13         AND size = '3XL')
    OR (product_id_numeric = 14         AND size IN ('2XL', '3XL'));

COMMIT;
