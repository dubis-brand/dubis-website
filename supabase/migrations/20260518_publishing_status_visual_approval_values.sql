-- 2026-05-18: Extend dubis_products.publishing_status CHECK constraint to include
-- the visual-approval flow values added in the autonomous product pipeline.
--
-- Root cause: the original constraint only allowed ('manual','pending_pipeline').
-- The Edge Function callback (gha-pipeline-callback) tries to set
-- 'pending_visual_approval', and product-visual-approve sets 'live' or
-- 'visual_rejected'. Every UPDATE was rejected with 23514, returned 500 to the
-- GHA workflow, and the workflow's failure handler overwrote the queue's
-- last_error with the generic "GHA workflow failed — check run logs" message.
-- That was the source of the daily-report failure for products 26/27/28/29.
--
-- Idempotent: drop-if-exists then recreate.

ALTER TABLE public.dubis_products
  DROP CONSTRAINT IF EXISTS dubis_products_publishing_status_check;

ALTER TABLE public.dubis_products
  ADD CONSTRAINT dubis_products_publishing_status_check
  CHECK (
    publishing_status IS NULL
    OR publishing_status IN (
      'manual',
      'pending_pipeline',
      'pending_visual_approval',
      'live',
      'visual_rejected'
    )
  );
