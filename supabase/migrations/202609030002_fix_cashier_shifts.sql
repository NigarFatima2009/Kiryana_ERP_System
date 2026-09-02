-- ============================================================
-- FIX: Cashier Shifts — force drop then recreate all RPCs
-- Run this ENTIRE script in Supabase SQL Editor
-- ============================================================

-- Add missing column
ALTER TABLE public.cashier_shifts ADD COLUMN IF NOT EXISTS auto_close_at TIMESTAMP;

-- Step 1: Find and drop ALL existing overloads using a function
CREATE OR REPLACE FUNCTION public._drop_all_shift_functions()
RETURNS void AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN 
    SELECT oid, proname, pg_get_function_identity_arguments(oid) AS args
    FROM pg_proc 
    WHERE proname IN ('get_current_shift', 'open_cashier_shift', 'close_cashier_shift', 'get_shift_summary')
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE format('DROP FUNCTION public.%s(%s) CASCADE', r.proname, r.args);
    RAISE NOTICE 'Dropped: %(%)', r.proname, r.args;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

SELECT public._drop_all_shift_functions();

-- Clean up helper
DROP FUNCTION public._drop_all_shift_functions();

-- Step 2: Now create all functions fresh (guaranteed no conflicts)

-- get_current_shift
CREATE FUNCTION public.get_current_shift()
RETURNS TABLE(
  id UUID, user_id UUID, opened_at TIMESTAMP, closed_at TIMESTAMP,
  opening_cash DECIMAL, closing_cash DECIMAL, expected_cash DECIMAL,
  variance DECIMAL, status VARCHAR, notes TEXT, created_at TIMESTAMP
) AS $$
BEGIN
  RETURN QUERY
  SELECT cs.id, cs.user_id, cs.opened_at, cs.closed_at,
    cs.opening_cash, cs.closing_cash, cs.expected_cash, cs.variance,
    cs.status, cs.notes, cs.created_at
  FROM public.cashier_shifts cs
  WHERE cs.user_id = auth.uid() AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- open_cashier_shift (returns jsonb, 2-min for testing)
CREATE FUNCTION public.open_cashier_shift(
  p_opening_cash numeric,
  p_client_time timestamp without time zone DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_shift_id uuid;
  v_now timestamp;
  v_auto_close timestamp;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_opening_cash < 0 THEN RAISE EXCEPTION 'Opening cash cannot be negative'; END IF;

  v_now := COALESCE(p_client_time, NOW());
  v_auto_close := v_now + INTERVAL '2 minutes';

  INSERT INTO public.cashier_shifts (user_id, opening_cash, opened_at, auto_close_at, status, created_at, updated_at)
  VALUES (auth.uid(), p_opening_cash, v_now, v_auto_close, 'OPEN', NOW(), NOW())
  RETURNING id INTO v_shift_id;

  RETURN jsonb_build_object(
    'id', v_shift_id, 'user_id', auth.uid(), 'opening_cash', p_opening_cash,
    'opened_at', v_now, 'closed_at', null, 'closing_cash', null,
    'expected_cash', null, 'variance', null, 'status', 'OPEN',
    'notes', null, 'created_at', NOW(), 'auto_close_at', v_auto_close
  );
END;
$$;

-- close_cashier_shift (all columns qualified to avoid ambiguity)
CREATE FUNCTION public.close_cashier_shift(
  p_shift_id uuid, p_closing_cash numeric,
  p_client_time timestamp without time zone DEFAULT NULL
) RETURNS TABLE(
  id uuid, closed_at timestamp without time zone, opening_cash numeric,
  closing_cash numeric, expected_cash numeric, variance numeric,
  sales_count integer, total_sales numeric, status character varying
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_open numeric;
  v_total numeric;
  v_count integer;
  v_expected numeric;
  v_variance numeric;
  v_close_time timestamp;
BEGIN
  v_close_time := COALESCE(p_client_time, NOW());

  SELECT cs.opening_cash INTO v_open
  FROM public.cashier_shifts cs
  WHERE cs.id = p_shift_id
    AND (cs.user_id = auth.uid() OR (SELECT p2.role FROM public.profiles p2 WHERE p2.id = auth.uid()) IN ('OWNER','MANAGER'));

  IF v_open IS NULL THEN RAISE EXCEPTION 'Shift not found or unauthorized'; END IF;

  SELECT COALESCE(SUM(GREATEST(0, s.total - COALESCE(r.total, 0))), 0), COUNT(*)
  INTO v_total, v_count
  FROM public.sales s
  LEFT JOIN (
    SELECT sr.sale_id, SUM(sr.total) AS total
    FROM public.sales_returns sr
    GROUP BY sr.sale_id
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
      updated_at = NOW()
  WHERE cashier_shifts.id = p_shift_id;

  RETURN QUERY SELECT p_shift_id, v_close_time, v_open, p_closing_cash,
    v_expected, v_variance, v_count, v_total, 'CLOSED'::varchar;
END;
$$;

-- get_shift_summary
CREATE FUNCTION public.get_shift_summary(p_shift_id uuid)
RETURNS TABLE(
  id uuid, opened_at timestamp, closed_at timestamp, opening_cash decimal,
  closing_cash decimal, expected_cash decimal, variance decimal,
  variance_percentage numeric, sales_count int, total_sales decimal,
  average_transaction decimal, status varchar
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
  v_sales_total decimal;
  v_sales_count int;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(s.total), 0)::decimal
  INTO v_sales_count, v_sales_total
  FROM public.sales s
  WHERE s.shift_id = p_shift_id AND s.status = 'COMPLETED';

  RETURN QUERY
  SELECT cs.id, cs.opened_at, cs.closed_at, cs.opening_cash, cs.closing_cash,
    cs.expected_cash, cs.variance,
    CASE WHEN cs.expected_cash > 0 THEN (cs.variance / cs.expected_cash * 100) ELSE 0 END,
    v_sales_count, v_sales_total,
    CASE WHEN v_sales_count > 0 THEN (v_sales_total / v_sales_count) ELSE 0 END,
    cs.status
  FROM public.cashier_shifts cs WHERE cs.id = p_shift_id;
END;
$$;

-- RLS
ALTER TABLE public.cashier_shifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own shifts" ON public.cashier_shifts;
DROP POLICY IF EXISTS "Cashiers can create shifts" ON public.cashier_shifts;
DROP POLICY IF EXISTS "Cashiers can update their shifts" ON public.cashier_shifts;

CREATE POLICY "Users can view their own shifts" ON public.cashier_shifts FOR SELECT USING (
  user_id = auth.uid() OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('OWNER','MANAGER')
);
CREATE POLICY "Cashiers can create shifts" ON public.cashier_shifts FOR INSERT WITH CHECK (
  user_id = auth.uid() AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('CASHIER','OWNER','MANAGER')
);
CREATE POLICY "Cashiers can update their shifts" ON public.cashier_shifts FOR UPDATE USING (
  user_id = auth.uid() OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('OWNER','MANAGER')
);

NOTIFY pgrst, 'reload schema';
SELECT '✅ All functions recreated successfully' as result;
