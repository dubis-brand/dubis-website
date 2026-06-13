// DUBIS — Shared Supabase configuration
// Single source of truth for Supabase URL and publishable key (public, safe for client).
// 2026-06: migrated from the legacy anon JWT to the new publishable key (sb_publishable_…)
// so the legacy JWT-based keys can be disabled in the dashboard. RLS still enforced —
// the publishable key is the browser-safe replacement for the anon key. The variable name
// stays DUBIS_SUPABASE_ANON so all 7 consumers keep working without edits.
window.DUBIS_SUPABASE_URL  = 'https://ntzwvqtpdmvvavbhuyeb.supabase.co';
window.DUBIS_SUPABASE_ANON = 'sb_publishable_i2WiAKATqNIjMWXLWD0RFQ_yIa4tXqh';
