-- ============================================
-- RUN THIS EXACT FILE IN SUPABASE SQL EDITOR
-- Fixes: ambiguous 'id', close shift, timezone
-- ============================================

-- STEP 1: Close all open shifts
UPDATE public.cashier_shifts
SET status = 'CLOSED', closed_at = NOW(), closing_cash = opening_cash,
    expected_cash = opening_cash, variance = 0, notes = 'Reset', updated_at = NOW()
WHERE status = 'OPEN';

-- STEP 2: Drop ALL close function overloads (exact signatures)
DROP FUNCTION IF EXISTS public.close_cashier_shift(UUID, NUMERIC);
DROP FUNCTION IF EXISTS public.close_cashier_shift(UUID, NUMERIC, TIMESTAMP);
DROP FUNCTION IF EXISTS public.close_cashier_shift(UUID, DOUBLE PRECISION);
DROP FUNCTION IF EXISTS public.close_cashier_shift(UUID, DOUBLE PRECISION, TIMESTAMP);
DROP FUNCTION IF EXISTS public.close_cashier_shift(UUID, DECIMAL);
DROP FUNCTION IF EXISTS public.close_cashier_shift(UUID, DECIMAL, TIMESTAMP);

-- STEP 3: Drop ALL open function overloads
DROP FUNCTION IF EXISTS public.open_cashier_shift(NUMERIC);
DROP FUNCTION IF EXISTS public.open_cashier_shift(NUMERIC, TIMESTAMP);
DROP FUNCTION IF EXISTS public.open_cashier_shift(DECIMAL);
DROP FUNCTION IF EXISTS public.open_cashier_shift(DECIMAL, TIMESTAMP);
DROP FUNCTION IF EXISTS public.open_cashier_shift(DOUBLE PRECISION);
DROP FUNCTION IF EXISTS public.open_cashier_shift(DOUBLE PRECISION, TIMESTAMP);

-- STEP 4: Drop get_current_shift
DROP FUNCTION IF EXISTS public.get_current_shift();

-- STEP 5: Create open_cashier_shift (client timezone + auto-close stale)
CREATE OR REPLACE FUNCTION public.open_cashier_shift(
  p_opening_cash NUMERIC,
  p_client_time TIMESTAMP DEFAULT NULL
) RETURNS SETOF public.cashier_shifts AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_time TIMESTAMP := COALESCE(p_client_time, NOW());
  v_stale RECORD;
BEGIN
  -- Auto-close stale shifts (>1h old)
  FOR v_stale IN
    SELECT id FROM public.cashier_shifts
    WHERE user_id = v_uid AND status = 'OPEN'
      AND (v_time - opened_at) > INTERVAL '1 hour'
  LOOP
    UPDATE public.cashier_shifts
    SET status = 'CLOSED', closed_at = v_time, closing_cash = opening_cash,
        expected_cash = opening_cash, variance = 0,
        notes = 'Auto-closed: stale', updated_at = v_time
    WHERE cashier_shifts.id = v_stale.id;
  END LOOP;

  -- Create new shift
  RETURN QUERY
  INSERT INTO public.cashier_shifts (user_id, opening_cash, status, opened_at)
  VALUES (v_uid, p_opening_cash, 'OPEN', v_time)
  RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- STEP 6: Create close_cashier_shift (no ambiguity, client timezone)
CREATE OR REPLACE FUNCTION public.close_cashier_shift(
  p_shift_id UUID,
  p_closing_cash NUMERIC,
  p_client_time TIMESTAMP DEFAULT NULL
) RETURNS TABLE(
  result_id UUID,
  result_closed_at TIMESTAMP,
  result_opening_cash NUMERIC,
  result_closing_cash NUMERIC,
  result_expected_cash NUMERIC,
  result_variance NUMERIC,
  result_sales_count INT,
  result_total_sales NUMERIC,
  result_status VARCHAR
) AS $$
DECLARE
  v_open NUMERIC;
  v_total NUMERIC;
  v_count INT;
  v_expected NUMERIC;
  v_var NUMERIC;
BEGIN
  -- Get opening cash with explicit table reference
  SELECT cashier_shifts.opening_cash INTO v_open
  FROM public.cashier_shifts
  WHERE cashier_shifts.id = p_shift_id
    AND (
      cashier_shifts.user_id = auth.uid()
      OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('OWNER','MANAGER')
    );

  IF v_open IS NULL THEN
    RAISE EXCEPTION 'Shift not found or unauthorized';
  END IF;

  -- Count sales with explicit table reference
  SELECT COALESCE(SUM(sales.total),0)::NUMERIC, COUNT(*)::INT
  INTO v_total, v_count
  FROM public.sales
  WHERE sales.shift_id = p_shift_id AND sales.status = 'COMPLETED';

  v_expected := v_open + v_total;
  v_var := v_expected - p_closing_cash;

  -- Update with explicit table reference
  UPDATE public.cashier_shifts
  SET
    closed_at = COALESCE(p_client_time, NOW()),
    closing_cash = p_closing_cash,
    expected_cash = v_expected,
    variance = v_var,
    status = 'CLOSED',
    updated_at = NOW()
  WHERE cashier_shifts.id = p_shift_id;

  -- Return with no bare column references
  result_id := p_shift_id;
  result_closed_at := COALESCE(p_client_time, NOW());
  result_opening_cash := v_open;
  result_closing_cash := p_closing_cash;
  result_expected_cash := v_expected;
  result_variance := v_var;
  result_sales_count := v_count;
  result_total_sales := v_total;
  result_status := 'CLOSED';
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- STEP 7: Create get_current_shift
CREATE OR REPLACE FUNCTION public.get_current_shift()
RETURNS SETOF public.cashier_shifts AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM public.cashier_shifts
  WHERE cashier_shifts.user_id = auth.uid()
    AND cashier_shifts.status = 'OPEN'
  ORDER BY cashier_shifts.opened_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

-- STEP 8: Verify
SELECT id, user_id, opened_at, status, opening_cash
FROM public.cashier_shifts ORDER BY opened_at DESC LIMIT 5;
SELECT COUNT(*) as open_shifts FROM public.cashier_shifts WHERE status = 'OPEN';
