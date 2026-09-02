-- ============================================================
-- DIRECT SQL FIX: Copy and paste this ENTIRE script into 
-- Supabase SQL Editor (not via migrations)
-- ============================================================

-- STEP 1: Verify columns exist
ALTER TABLE public.cashier_shifts 
ADD COLUMN IF NOT EXISTS auto_close_at TIMESTAMP WITH TIME ZONE;

-- STEP 2: Drop old functions
DROP FUNCTION IF EXISTS public.get_current_shift() CASCADE;
DROP FUNCTION IF EXISTS public.open_cashier_shift(numeric) CASCADE;
DROP FUNCTION IF EXISTS public.open_cashier_shift(numeric, timestamp without time zone) CASCADE;
DROP FUNCTION IF EXISTS public.close_cashier_shift(uuid, numeric) CASCADE;
DROP FUNCTION IF EXISTS public.close_cashier_shift(uuid, numeric, timestamp without time zone) CASCADE;
DROP FUNCTION IF EXISTS public.get_shift_summary(uuid) CASCADE;

-- STEP 3: Wait for schema reload
SELECT pg_sleep(2);

-- STEP 4: Recreate get_current_shift with no timezone conversion
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

-- STEP 5: Recreate open_cashier_shift
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

  -- Use client time if provided (already in ISO 8601 format with timezone),
  -- otherwise use server time
  IF p_client_time IS NOT NULL THEN
    v_now := p_client_time::timestamp with time zone;
  ELSE
    v_now := NOW();
  END IF;
  
  -- 15-minute shift for testing (change to INTERVAL '8 hours' for production)
  v_auto_close_time := v_now + INTERVAL '15 minutes';

  INSERT INTO public.cashier_shifts (
    user_id, opening_cash, opened_at, auto_close_at, status, created_at, updated_at
  ) VALUES (
    auth.uid(),
    p_opening_cash,
    COALESCE(p_client_time::timestamp with time zone, NOW()),
    COALESCE(p_client_time::timestamp with time zone, NOW()) + INTERVAL '15 minutes',
    'OPEN',
    NOW(),
    NOW()
  )
  RETURNING id INTO v_shift_id;

  RETURN jsonb_build_object(
    'id', v_shift_id,
    'user_id', auth.uid(),
    'opening_cash', p_opening_cash,
    'opened_at', COALESCE(p_client_time::timestamp with time zone, NOW()),
    'closed_at', null,
    'closing_cash', null,
    'expected_cash', null,
    'variance', null,
    'status', 'OPEN',
    'notes', null,
    'created_at', NOW(),
    'auto_close_at', COALESCE(p_client_time::timestamp with time zone, NOW()) + INTERVAL '15 minutes'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.open_cashier_shift(numeric, timestamp without time zone) TO authenticated;

-- STEP 6: Recreate close_cashier_shift - Returns RECORD (single row)
CREATE OR REPLACE FUNCTION public.close_cashier_shift(
  p_shift_id uuid,
  p_closing_cash numeric,
  p_client_time timestamp without time zone DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_open numeric;
  v_total numeric := 0;
  v_count integer := 0;
  v_expected numeric;
  v_variance numeric;
  v_close_time timestamp with time zone;
BEGIN
  -- Use client time if provided, otherwise use server time
  v_close_time := COALESCE(p_client_time::timestamp with time zone, NOW());

  -- Get opening cash from the shift
  SELECT opening_cash INTO v_open
  FROM public.cashier_shifts
  WHERE id = p_shift_id
    AND (user_id = auth.uid() OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('OWNER', 'MANAGER'));

  IF v_open IS NULL THEN
    RAISE EXCEPTION 'Shift not found or unauthorized';
  END IF;

  -- Calculate sales count and total (simple query - no joins)
  SELECT COUNT(*)::integer, COALESCE(SUM(total), 0)::numeric
  INTO v_count, v_total
  FROM public.sales
  WHERE public.sales.shift_id = p_shift_id AND public.sales.status = 'COMPLETED';

  v_expected := v_open + v_total;
  v_variance := v_expected - p_closing_cash;

  UPDATE public.cashier_shifts
  SET closed_at = v_close_time,
      closing_cash = p_closing_cash,
      expected_cash = v_expected,
      variance = v_variance,
      status = 'CLOSED',
      updated_at = NOW()
  WHERE public.cashier_shifts.id = p_shift_id;

  -- Return as JSON object
  RETURN jsonb_build_object(
    'id', p_shift_id,
    'closed_at', v_close_time,
    'opening_cash', v_open,
    'closing_cash', p_closing_cash,
    'expected_cash', v_expected,
    'variance', v_variance,
    'sales_count', v_count,
    'total_sales', v_total,
    'status', 'CLOSED'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_cashier_shift(uuid, numeric, timestamp without time zone) TO authenticated;

-- STEP 7: Recreate get_shift_summary
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

-- STEP 8: Update RLS policies (DROP all old ones first)
DROP POLICY IF EXISTS "Users can view their own shifts" ON public.cashier_shifts;
DROP POLICY IF EXISTS "Cashiers can create shifts" ON public.cashier_shifts;
DROP POLICY IF EXISTS "Cashiers can close their shifts" ON public.cashier_shifts;
DROP POLICY IF EXISTS "Cashiers can update their shifts" ON public.cashier_shifts;

SELECT pg_sleep(0.5);

-- Create fresh RLS policies
CREATE POLICY "Users can view their own shifts" ON public.cashier_shifts
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND (
      user_id = auth.uid()
      OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('OWNER', 'MANAGER')
    )
  );

CREATE POLICY "Cashiers can create shifts" ON public.cashier_shifts
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
    AND user_id = auth.uid()
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('CASHIER', 'OWNER', 'MANAGER')
  );

CREATE POLICY "Cashiers can update their shifts" ON public.cashier_shifts
  FOR UPDATE USING (
    auth.uid() IS NOT NULL
    AND (
      user_id = auth.uid()
      OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('OWNER', 'MANAGER')
    )
  ) WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      user_id = auth.uid()
      OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('OWNER', 'MANAGER')
    )
  );

-- STEP 9: Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';

-- Test confirmation
SELECT 'All fixes applied successfully! ✓' as status;

-- STEP 9: Add simple resume function that re-opens a closed shift without changing opened_at
CREATE OR REPLACE FUNCTION public.resume_cashier_shift(
  p_shift_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_shift record;
BEGIN
  -- Get the shift
  SELECT id, user_id, opening_cash, opened_at, created_at
  INTO v_shift
  FROM public.cashier_shifts
  WHERE id = p_shift_id
    AND (user_id = auth.uid() OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('OWNER', 'MANAGER'));

  IF v_shift IS NULL THEN
    RAISE EXCEPTION 'Shift not found or unauthorized';
  END IF;

  -- Update status back to OPEN (without changing opened_at)
  UPDATE public.cashier_shifts
  SET status = 'OPEN',
      closed_at = NULL,
      closing_cash = NULL,
      expected_cash = NULL,
      variance = NULL,
      updated_at = NOW()
  WHERE id = p_shift_id;

  -- Return shift data with original opened_at unchanged
  RETURN jsonb_build_object(
    'id', v_shift.id,
    'user_id', v_shift.user_id,
    'opening_cash', v_shift.opening_cash,
    'opened_at', v_shift.opened_at,
    'closed_at', null,
    'closing_cash', null,
    'expected_cash', null,
    'variance', null,
    'status', 'OPEN',
    'notes', null,
    'created_at', v_shift.created_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resume_cashier_shift(uuid) TO authenticated;

-- STEP 10: Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';

-- Test confirmation
SELECT 'All updates applied successfully! ✓' as status;
