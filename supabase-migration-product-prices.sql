-- DUBIS Product Prices Migration
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/ntzwvqtpdmvvavbhuyeb/sql

-- 1. Create product_prices table
CREATE TABLE IF NOT EXISTS public.product_prices (
  product_id    INT PRIMARY KEY,
  selling_price NUMERIC(10,2) NOT NULL,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Enable RLS
ALTER TABLE public.product_prices ENABLE ROW LEVEL SECURITY;

-- 3. Public can read prices (website loads overrides)
CREATE POLICY "Public read product_prices"
  ON public.product_prices FOR SELECT
  USING (true);

-- 4. Authenticated users (admin) can write
CREATE POLICY "Auth write product_prices"
  ON public.product_prices FOR ALL
  USING (auth.role() = 'authenticated');
