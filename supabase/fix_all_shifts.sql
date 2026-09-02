-- ============================================
-- COMPREHENSIVE SHIFT FIX
-- Run this ONE file in Supabase SQL Editor
-- ============================================

-- STEP 1: Close ALL open shifts (fresh start)
UPDATE public.cashier_shifts
SET
  status = 'CLOSED',
  closed_at = NOW(),
  closing_cash = opening_cash,
  expected_cash = opening_cash,
  variance = 0,
  notes = 'Reset: fresh start for timezone testing',
  updated_at = NOW()
WHERE status = 'OPEN';

-- STEP 2: Fix open_cashier_shift (auto-close stale + client timezone)
DROP FUNCTION IF EXISTS public.open_cashier_shift(numeric);
DROP FUNCTION IF EXISTS public.open_cashier_shift(numeric, timestamp);

CREATE OR REPLACE FUNCTION public.open_cashier_shift(
  p_opening_cash DECIMAL,
  p_client_time TIMESTAMP DEFAULT NULL
) RETURNS TABLE(
  id UUID,
  user_id UUID,
  opened_at TIMESTAMP,
  closed_at TIMESTAMP,
  opening_cash DECIMAL,
  closing_cash DECIMAL,
  expected_cash DECIMAL,
  variance DECIMAL,
  status VARCHAR,
  notes TEXT,
  created_at TIMESTAMP
) AS $$
DECLARE
  v_user_id UUID;
  v_opened_at TIMESTAMP;
  v_stale_shift RECORD;
BEGIN
  v_user_id := auth.uid();
  v_opened_at := COALESCE(p_client_time, NOW());

  -- Auto-close any stale open shifts for this user (older than 1 hour)
  FOR v_stale_shift IN
    SELECT cs.id
    FROM public.cashier_shifts cs
    WHERE cs.user_id = v_user_id
      AND cs.status = 'OPEN'
      AND (v_opened_at - cs.opened_at) > INTERVAL '1 hour'
  LOOP
    UPDATE public.cashier_shifts
    SET
      status = 'CLOSED',
      closed_at = v_opened_at,
      closing_cash = opening_cash,
      expected_cash = opening_cash,
      variance = 0,
      notes = COALESCE(notes, '') || ' | Auto-closed: stale shift',
      updated_at = v_opened_at
    WHERE id = v_stale_shift.id;

    RAISE NOTICE 'Auto-closed stale shift: %', v_stale_shift.id;
  END LOOP;

  -- Create new shift with client time
  RETURN QUERY
  INSERT INTO public.cashier_shifts (user_id, opening_cash, status, opened_at)
  VALUES (v_user_id, p_opening_cash, 'OPEN', v_opened_at)
  RETURNING
    cashier_shifts.id,
    cashier_shifts.user_id,
    cashier_shifts.opened_at,
    cashier_shifts.closed_at,
    cashier_shifts.opening_cash,
    cashier_shifts.closing_cash,
    cashier_shifts.expected_cash,
    cashier_shifts.variance,
    cashier_shifts.status,
    cashier_shifts.notes,
    cashier_shifts.created_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- STEP 3: Fix close_cashier_shift (no ambiguous column + client timezone)
DROP FUNCTION IF EXISTS public.close_cashier_shift(uuid, numeric);
DROP FUNCTION IF EXISTS public.close_cashier_shift(uuid, numeric, timestamp);

CREATE OR REPLACE FUNCTION public.close_cashier_shift(
  p_shift_id UUID,
  p_closing_cash DECIMAL,
  p_client_time TIMESTAMP DEFAULT NULL
) RETURNS TABLE(
  id UUID,
  closed_at TIMESTAMP,
  opening_cash DECIMAL,
  closing_cash DECIMAL,
  expected_cash DECIMAL,
  variance DECIMAL,
  sales_count INT,
  total_sales DECIMAL,
  status VARCHAR
) AS $$
DECLARE
  v_opening_cash DECIMAL;
  v_sales_total DECIMAL;
  v_sales_count INT;
  v_expected_cash DECIMAL;
  v_variance DECIMAL;
  v_result_id UUID;
  v_closed_at TIMESTAMP;
  v_result_status VARCHAR;
BEGIN
  SELECT cs.opening_cash INTO v_opening_cash
  FROM public.cashier_shifts cs
  WHERE cs.id = p_shift_id
    AND (
      cs.user_id = auth.uid()
      OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('OWNER', 'MANAGER')
    );

  IF v_opening_cash IS NULL THEN
    RAISE EXCEPTION 'Shift not found or unauthorized';
  END IF;

  SELECT COALESCE(SUM(s.total), 0)::DECIMAL, COUNT(*)::INT
  INTO v_sales_total, v_sales_count
  FROM public.sales s
  WHERE s.shift_id = p_shift_id AND s.status = 'COMPLETED';

  v_expected_cash := v_opening_cash + v_sales_total;
  v_variance := v_expected_cash - p_closing_cash;

  UPDATE public.cashier_shifts cs
  SET
    cs.closed_at = COALESCE(p_client_time, NOW()),
    cs.closing_cash = p_closing_cash,
    cs.expected_cash = v_expected_cash,
    cs.variance = v_variance,
    cs.status = 'CLOSED',
    cs.updated_at = NOW()
  WHERE cs.id = p_shift_id
    AND (
      cs.user_id = auth.uid()
      OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('OWNER', 'MANAGER')
    )
  RETURNING cs.id, cs.closed_at, cs.status
  INTO v_result_id, v_closed_at, v_result_status;

  RETURN QUERY SELECT v_result_id, v_closed_at, v_opening_cash, p_closing_cash, v_expected_cash, v_variance, v_sales_count, v_sales_total, v_result_status;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- STEP 4: Fix get_current_shift
DROP FUNCTION IF EXISTS public.get_current_shift();

CREATE OR REPLACE FUNCTION public.get_current_shift()
RETURNS TABLE(
  id UUID,
  user_id UUID,
  opened_at TIMESTAMP,
  closed_at TIMESTAMP,
  opening_cash DECIMAL,
  closing_cash DECIMAL,
  expected_cash DECIMAL,
  variance DECIMAL,
  status VARCHAR,
  notes TEXT,
  created_at TIMESTAMP
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    cs.id,
    cs.user_id,
    cs.opened_at,
    cs.closed_at,
    cs.opening_cash,
    cs.closing_cash,
    cs.expected_cash,
    cs.variance,
    cs.status,
    cs.notes,
    cs.created_at
  FROM public.cashier_shifts cs
  WHERE cs.user_id = auth.uid()
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

-- STEP 5: Verify
SELECT
  cs.id,
  p.full_name,
  cs.opened_at,
  cs.status,
  cs.opening_cash
FROM public.cashier_shifts cs
LEFT JOIN public.profiles p ON p.id = cs.user_id
ORDER BY cs.opened_at DESC
LIMIT 5;

SELECT COUNT(*) as open_shifts FROM public.cashier_shifts WHERE status = 'OPEN';
