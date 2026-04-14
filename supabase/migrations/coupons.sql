-- DUBIS Coupons Migration
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/ntzwvqtpdmvvavbhuyeb/sql

-- 1. Create coupons table
CREATE TABLE IF NOT EXISTS public.coupons (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
    discount_value DECIMAL NOT NULL CHECK (discount_value > 0),
    valid_from TIMESTAMPTZ NOT NULL,
    valid_until TIMESTAMPTZ NOT NULL,
    max_uses INTEGER DEFAULT NULL,
    current_uses INTEGER DEFAULT 0,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add coupon columns to orders table
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS coupon_code TEXT,
    ADD COLUMN IF NOT EXISTS discount_amount DECIMAL DEFAULT 0;

-- 3. Enable RLS on coupons
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

-- 4. Allow service role full access (for API endpoints)
CREATE POLICY "service_role_all" ON public.coupons
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 5. Allow anon to read enabled+valid coupons (for validation endpoint)
CREATE POLICY "anon_read_valid" ON public.coupons
    FOR SELECT
    TO anon, authenticated
    USING (enabled = true AND NOW() BETWEEN valid_from AND valid_until);

-- 6. RPC function to safely increment coupon usage count
CREATE OR REPLACE FUNCTION public.increment_coupon_uses(coupon_code TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
    UPDATE public.coupons
    SET current_uses = current_uses + 1
    WHERE code = coupon_code;
$$;
