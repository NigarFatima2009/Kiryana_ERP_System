-- ============================================
-- Reset ALL shifts for fresh testing
-- Run this in Supabase SQL Editor
-- ============================================

-- Close all open shifts
UPDATE public.cashier_shifts
SET
  status = 'CLOSED',
  closed_at = NOW(),
  closing_cash = opening_cash,
  expected_cash = opening_cash,
  variance = 0,
  notes = COALESCE(notes, '') || ' | Reset for testing',
  updated_at = NOW()
WHERE status = 'OPEN';

-- Verify - should show 0 open shifts
SELECT
  cs.id,
  p.full_name,
  cs.opened_at,
  cs.closed_at,
  cs.status,
  cs.opening_cash
FROM public.cashier_shifts cs
LEFT JOIN public.profiles p ON p.id = cs.user_id
ORDER BY cs.opened_at DESC
LIMIT 10;

-- Check: any remaining open shifts?
SELECT COUNT(*) as open_shifts FROM public.cashier_shifts WHERE status = 'OPEN';
