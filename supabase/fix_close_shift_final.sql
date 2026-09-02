-- STEP 1: Close ALL open shifts
UPDATE public.cashier_shifts
SET status = 'CLOSED', closed_at = NOW(), closing_cash = opening_cash,
    expected_cash = opening_cash, variance = 0, notes = 'Reset for testing', updated_at = NOW()
WHERE status = 'OPEN';

-- STEP 2: Drop ALL versions of close_cashier_shift
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT oid, proargtypes::regtype[] as args
    FROM pg_proc
    WHERE proname = 'close_cashier_shift'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE format('DROP FUNCTION public.close_cashier_shift(%s)',
      array_to_string(ARRAY(SELECT t::text FROM unnest(r.args) t), ', '));
  END LOOP;
END $$;

-- STEP 3: Create clean close function - NO aliases, NO joins, NO ambiguity
CREATE OR REPLACE FUNCTION public.close_cashier_shift(
  p_shift_id UUID,
  p_closing_cash DECIMAL,
  p_client_time TIMESTAMP DEFAULT NULL
) RETURNS TABLE(
  out_id UUID,
  out_closed_at TIMESTAMP,
  out_opening_cash DECIMAL,
  out_closing_cash DECIMAL,
  out_expected_cash DECIMAL,
  out_variance DECIMAL,
  out_sales_count INT,
  out_total_sales DECIMAL,
  out_status VARCHAR
) AS $$
DECLARE
  v_opening NUMERIC;
  v_total NUMERIC;
  v_count INT;
  v_expected NUMERIC;
  v_var NUMERIC;
BEGIN
  -- Verify access
  SELECT opening_cash INTO v_opening
  FROM cashier_shifts
  WHERE id = p_shift_id AND (
    user_id = auth.uid() OR
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('OWNER','MANAGER')
  );

  IF v_opening IS NULL THEN
    RAISE EXCEPTION 'Shift not found or unauthorized';
  END IF;

  -- Count sales
  SELECT COALESCE(SUM(total),0)::NUMERIC, COUNT(*)::INT
  INTO v_total, v_count
  FROM sales
  WHERE shift_id = p_shift_id AND status = 'COMPLETED';

  v_expected := v_opening + v_total;
  v_var := v_expected - p_closing_cash;

  -- Update
  UPDATE cashier_shifts
  SET
    closed_at = COALESCE(p_client_time, NOW()),
    closing_cash = p_closing_cash,
    expected_cash = v_expected,
    variance = v_var,
    status = 'CLOSED',
    updated_at = NOW()
  WHERE id = p_shift_id;

  -- Return
  RETURN QUERY
  SELECT
    p_shift_id,
    COALESCE(p_client_time, NOW()),
    v_opening,
    p_closing_cash,
    v_expected,
    v_var,
    v_count,
    v_total,
    'CLOSED'::VARCHAR;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
