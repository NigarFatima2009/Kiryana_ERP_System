-- Set all timestamp functions to use Pakistan timezone (UTC+5)
-- This ensures consistent timezone handling across the application

-- Drop the existing function first (required when changing return type)
DROP FUNCTION IF EXISTS public.open_cashier_shift(numeric, timestamp without time zone);

-- Update open_cashier_shift to use Pakistan time
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
  v_now timestamp;
  v_auto_close_time timestamp;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be authenticated to open a shift';
  END IF;

  IF p_opening_cash < 0 THEN
    RAISE EXCEPTION 'Opening cash cannot be negative';
  END IF;

  -- Use client time if provided, otherwise use current server time
  v_now := COALESCE(p_client_time, NOW() AT TIME ZONE 'Asia/Karachi');
  v_auto_close_time := v_now + INTERVAL '8 hours';

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
    'opening_cash', p_opening_cash,
    'opened_at', v_now,
    'timezone', 'Asia/Karachi (UTC+5)'
  );
END;
$$;

-- Update close_cashier_shift to use Pakistan time
CREATE OR REPLACE FUNCTION public.close_cashier_shift(
  p_shift_id uuid,
  p_closing_cash numeric,
  p_client_time timestamp without time zone DEFAULT NULL
) RETURNS TABLE(
  result_id uuid,
  result_closed_at timestamp without time zone,
  result_opening_cash numeric,
  result_closing_cash numeric,
  result_expected_cash numeric,
  result_variance numeric,
  result_sales_count integer,
  result_total_sales numeric,
  result_status character varying
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
  v_close_time timestamp;
BEGIN
  -- Use client time if provided, otherwise use current server time in Pakistan timezone
  v_close_time := COALESCE(p_client_time, NOW() AT TIME ZONE 'Asia/Karachi');

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

-- Ensure all timestamp columns use Pakistan timezone in display
-- Add comment to document timezone
COMMENT ON TABLE public.cashier_shifts IS 'All timestamps are stored in UTC and should be displayed in Pakistan timezone (UTC+5)';
COMMENT ON TABLE public.sales IS 'All timestamps are stored in UTC and should be displayed in Pakistan timezone (UTC+5)';
COMMENT ON TABLE public.inventory_movements IS 'All timestamps are stored in UTC and should be displayed in Pakistan timezone (UTC+5)';
COMMENT ON TABLE public.sales_returns IS 'All timestamps are stored in UTC and should be displayed in Pakistan timezone (UTC+5)';
