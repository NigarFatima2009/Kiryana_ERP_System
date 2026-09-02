-- ============================================================
-- CRITICAL FIX: Change TIMESTAMP columns to TIMESTAMP WITH TIME ZONE
-- Copy and paste this ENTIRE script into Supabase SQL Editor
-- ============================================================

-- STEP 1: Add temporary columns with proper timezone
ALTER TABLE public.cashier_shifts
ADD COLUMN opened_at_tmp TIMESTAMP WITH TIME ZONE,
ADD COLUMN closed_at_tmp TIMESTAMP WITH TIME ZONE,
ADD COLUMN created_at_tmp TIMESTAMP WITH TIME ZONE,
ADD COLUMN updated_at_tmp TIMESTAMP WITH TIME ZONE,
ADD COLUMN auto_close_at_tmp TIMESTAMP WITH TIME ZONE;

-- STEP 2: Copy data from old columns to new ones
-- Convert TIMESTAMP to TIMESTAMP WITH TIME ZONE in Pakistan timezone
UPDATE public.cashier_shifts
SET 
  opened_at_tmp = opened_at AT TIME ZONE 'Asia/Karachi',
  closed_at_tmp = closed_at AT TIME ZONE 'Asia/Karachi',
  created_at_tmp = created_at AT TIME ZONE 'Asia/Karachi',
  updated_at_tmp = updated_at AT TIME ZONE 'Asia/Karachi',
  auto_close_at_tmp = auto_close_at AT TIME ZONE 'Asia/Karachi';

-- STEP 3: Wait for schema refresh
SELECT pg_sleep(1);

-- STEP 4: Drop old columns
ALTER TABLE public.cashier_shifts
DROP COLUMN opened_at,
DROP COLUMN closed_at,
DROP COLUMN created_at,
DROP COLUMN updated_at,
DROP COLUMN auto_close_at;

-- STEP 5: Rename new columns to original names
ALTER TABLE public.cashier_shifts
RENAME COLUMN opened_at_tmp TO opened_at;

ALTER TABLE public.cashier_shifts
RENAME COLUMN closed_at_tmp TO closed_at;

ALTER TABLE public.cashier_shifts
RENAME COLUMN created_at_tmp TO created_at;

ALTER TABLE public.cashier_shifts
RENAME COLUMN updated_at_tmp TO updated_at;

ALTER TABLE public.cashier_shifts
RENAME COLUMN auto_close_at_tmp TO auto_close_at;

-- STEP 6: Set defaults and constraints
ALTER TABLE public.cashier_shifts
ALTER COLUMN opened_at SET DEFAULT NOW() AT TIME ZONE 'Asia/Karachi',
ALTER COLUMN created_at SET DEFAULT NOW() AT TIME ZONE 'Asia/Karachi',
ALTER COLUMN updated_at SET DEFAULT NOW() AT TIME ZONE 'Asia/Karachi';

-- STEP 7: Wait for schema propagation
SELECT pg_sleep(1);

-- STEP 8: Now recreate all functions with correct return types
DROP FUNCTION IF EXISTS public.get_current_shift() CASCADE;
DROP FUNCTION IF EXISTS public.open_cashier_shift(numeric, timestamp without time zone) CASCADE;
DROP FUNCTION IF EXISTS public.close_cashier_shift(uuid, numeric, timestamp without time zone) CASCADE;
DROP FUNCTION IF EXISTS public.get_shift_summary(uuid) CASCADE;

SELECT pg_sleep(1);

-- STEP 9: Recreate get_current_shift
CREATE OR REPLACE FUNCTION public.get_current_shift()
RETURNS TABLE(
  id UUID,
  user_id UUID,
  opened_at TIMESTAMP WITH TIME ZONE,
  closed_at TIMESTAMP WITH TIME ZONE,
  opening_cash DECIMAL,
  closing_cash DECIMAL,
  expected_cash DECIMAL,
  variance DECIMAL,
  status VARCHAR,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE,
  auto_close_at TIMESTAMP WITH TIME ZONE
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
    cs.created_at,
    cs.auto_close_at
  FROM public.cashier_shifts cs
  WHERE cs.user_id = auth.uid()
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_current_shift() TO authenticated;

-- STEP 10: Recreate open_cashier_shift
CREATE OR REPLACE FUNCTION public.open_cashier_shift(
  p_opening_cash numeric,
  p_client_time timestamp without time zone DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id uuid;
  v_now timestamp with time zone;
  v_auto_close_time timestamp with time zone;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be authenticated to open a shift';
  END IF;

  IF p_opening_cash < 0 THEN
    RAISE EXCEPTION 'Opening cash cannot be negative';
  END IF;

  -- Use current server time in Pakistan timezone
  v_now := NOW() AT TIME ZONE 'Asia/Karachi';
  
  -- 15-minute shift for testing (change to INTERVAL '8 hours' for production)
  v_auto_close_time := v_now + INTERVAL '15 minutes';

  INSERT INTO public.cashier_shifts (
    user_id, opening_cash, opened_at, auto_close_at, status, created_at, updated_at
  ) VALUES (
    auth.uid(),
    p_opening_cash,
    v_now,
    v_auto_close_time,
    'OPEN',
    NOW() AT TIME ZONE 'Asia/Karachi',
    NOW() AT TIME ZONE 'Asia/Karachi'
  )
  RETURNING id INTO v_shift_id;

  RETURN jsonb_build_object(
    'id', v_shift_id,
    'user_id', auth.uid(),
    'opening_cash', p_opening_cash,
    'opened_at', v_now,
    'closed_at', null,
    'closing_cash', null,
    'expected_cash', null,
    'variance', null,
    'status', 'OPEN',
    'notes', null,
    'created_at', NOW() AT TIME ZONE 'Asia/Karachi',
    'auto_close_at', v_auto_close_time
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.open_cashier_shift(numeric, timestamp without time zone) TO authenticated;

-- STEP 11: Recreate close_cashier_shift
CREATE OR REPLACE FUNCTION public.close_cashier_shift(
  p_shift_id uuid,
  p_closing_cash numeric,
  p_client_time timestamp without time zone DEFAULT NULL
) RETURNS TABLE(
  id uuid,
  closed_at timestamp with time zone,
  opening_cash numeric,
  closing_cash numeric,
  expected_cash numeric,
  variance numeric,
  sales_count integer,
  total_sales numeric,
  status character varying
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open numeric;
  v_total numeric;
  v_count integer;
  v_expected numeric;
  v_variance numeric;
  v_close_time timestamp with time zone;
BEGIN
  v_close_time := NOW() AT TIME ZONE 'Asia/Karachi';

  SELECT opening_cash INTO v_open
  FROM public.cashier_shifts
  WHERE id = p_shift_id
    AND (user_id = auth.uid() OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('OWNER', 'MANAGER'));

  IF v_open IS NULL THEN
    RAISE EXCEPTION 'Shift not found or unauthorized';
  END IF;

  SELECT COALESCE(SUM(GREATEST(0, s.total - COALESCE(r.total, 0))), 0), COUNT(*)
  INTO v_total, v_count
  FROM public.sales s
  LEFT JOIN (
    SELECT sale_id, SUM(total) AS total
    FROM public.sales_returns
    GROUP BY sale_id
  ) r ON r.sale_id = s.id
  WHERE s.shift_id = p_shift_id AND s.status = 'COMPLETED';

  v_expected := v_open + v_total;
  v_variance := v_expected - p_closing_cash;

  UPDATE public.cashier_shifts
  SET closed_at = v_close_time,
      closing_cash = p_closing_cash,
      expected_cash = v_expected,
      variance = v_variance,
      status = 'CLOSED',
      updated_at = NOW() AT TIME ZONE 'Asia/Karachi'
  WHERE id = p_shift_id;

  RETURN QUERY SELECT p_shift_id, v_close_time, v_open, p_closing_cash,
    v_expected, v_variance, v_count, v_total, 'CLOSED'::varchar;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_cashier_shift(uuid, numeric, timestamp without time zone) TO authenticated;

-- STEP 12: Recreate get_shift_summary
CREATE OR REPLACE FUNCTION public.get_shift_summary(p_shift_id uuid)
RETURNS TABLE(
  id uuid,
  opened_at timestamp with time zone,
  closed_at timestamp with time zone,
  opening_cash decimal,
  closing_cash decimal,
  expected_cash decimal,
  variance decimal,
  variance_percentage numeric,
  sales_count int,
  total_sales decimal,
  average_transaction decimal,
  status varchar
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
  v_sales_total decimal;
  v_sales_count int;
  v_opening_cash decimal;
  v_expected_cash decimal;
  v_closing_cash decimal;
  v_variance decimal;
  v_variance_pct numeric;
BEGIN
  SELECT opening_cash, closing_cash, expected_cash, variance
  INTO v_opening_cash, v_closing_cash, v_expected_cash, v_variance
  FROM public.cashier_shifts WHERE id = p_shift_id;

  SELECT COUNT(*), COALESCE(SUM(total), 0)::decimal
  INTO v_sales_count, v_sales_total
  FROM public.sales WHERE shift_id = p_shift_id AND status = 'COMPLETED';

  v_variance_pct := CASE WHEN v_expected_cash > 0 THEN (v_variance / v_expected_cash * 100) ELSE 0 END;

  RETURN QUERY
  SELECT cs.id, 
    cs.opened_at,
    cs.closed_at,
    cs.opening_cash, cs.closing_cash,
    cs.expected_cash, cs.variance, v_variance_pct,
    v_sales_count::int, v_sales_total,
    CASE WHEN v_sales_count > 0 THEN (v_sales_total / v_sales_count)::decimal ELSE 0 END,
    cs.status
  FROM public.cashier_shifts cs WHERE cs.id = p_shift_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_shift_summary(uuid) TO authenticated;

-- STEP 13: Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';

-- Test confirmation
SELECT 'Timezone column fix completed successfully! ✓' as status;
