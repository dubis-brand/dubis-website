-- 2026-06-21 — No periods on DUBIS shirts (oren directive).
--
-- Enforces, at the database level, that typography_small/big/after never store a
-- '.' — so NO insert path (AI slogan generator in agents/index.ts, the weekly
-- auto-creator, a manual admin "Add product", a direct SQL fix) can put a period
-- into the printed slogan. The print PNG is independently guaranteed period-free
-- by stripPeriods() in scripts/generate-designs.js; this trigger keeps the source
-- data itself clean too.
--
-- Why a trigger and not just app code: there are multiple writers, and the
-- original "stray floating dot" (a lone '.' in typography_after rendered as its
-- own centered line below the keyword — shipped on products 18/30/31/32/34/38)
-- proved app-level handling was bypassable. A BEFORE-trigger is the single
-- chokepoint that cannot be skipped.
--
-- Newlines are preserved (multi-line small text like product 11); only runs of
-- horizontal whitespace left by a removed period are collapsed. Commas / ? / !
-- are intentionally kept.

CREATE OR REPLACE FUNCTION strip_typography_periods()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.typography_small IS NOT NULL THEN
    NEW.typography_small := btrim(regexp_replace(replace(NEW.typography_small, '.', ''), '[ \t]{2,}', ' ', 'g'));
  END IF;
  IF NEW.typography_big IS NOT NULL THEN
    NEW.typography_big := btrim(regexp_replace(replace(NEW.typography_big, '.', ''), '[ \t]{2,}', ' ', 'g'));
  END IF;
  IF NEW.typography_after IS NOT NULL THEN
    NEW.typography_after := btrim(regexp_replace(replace(NEW.typography_after, '.', ''), '[ \t]{2,}', ' ', 'g'));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_strip_typography_periods ON dubis_products;
CREATE TRIGGER trg_strip_typography_periods
BEFORE INSERT OR UPDATE OF typography_small, typography_big, typography_after
ON dubis_products
FOR EACH ROW
EXECUTE FUNCTION strip_typography_periods();
