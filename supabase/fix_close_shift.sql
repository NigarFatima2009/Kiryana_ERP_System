-- Fix: column reference "id" is ambiguous
-- The issue is that cashier_shifts and sales both have 'id' columns
-- and the function references them without table aliases

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
  -- Get opening cash — verify user owns this shift or is owner/manager
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

  -- Calculate sales total — use table alias to avoid ambiguity
  SELECT COALESCE(SUM(s.total), 0)::DECIMAL, COUNT(*)::INT
  INTO v_sales_total, v_sales_count
  FROM public.sales s
  WHERE s.shift_id = p_shift_id AND s.status = 'COMPLETED';

  -- Calculate expected cash
  v_expected_cash := v_opening_cash + v_sales_total;
  v_variance := v_expected_cash - p_closing_cash;

  -- Update shift — use table alias cs to avoid ambiguous column references
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

  -- Return the result
  RETURN QUERY SELECT v_result_id, v_closed_at, v_opening_cash, p_closing_cash, v_expected_cash, v_variance, v_sales_count, v_sales_total, v_result_status;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
