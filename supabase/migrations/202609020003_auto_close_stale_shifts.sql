-- Auto-close stale shifts when opening a new one
-- This ensures each cashier always starts fresh with elapsed time = 0

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

  -- Auto-close any stale open shifts for this user (older than 12 hours)
  FOR v_stale_shift IN
    SELECT cs.id
    FROM public.cashier_shifts cs
    WHERE cs.user_id = v_user_id
      AND cs.status = 'OPEN'
      AND (v_opened_at - cs.opened_at) > INTERVAL '12 hours'
  LOOP
    UPDATE public.cashier_shifts
    SET
      status = 'CLOSED',
      closed_at = v_opened_at,
      closing_cash = opening_cash,
      expected_cash = opening_cash,
      variance = 0,
      notes = COALESCE(notes, '') || ' | Auto-closed: stale shift (>12h)',
      updated_at = v_opened_at
    WHERE cs.id = v_stale_shift.id;

    RAISE NOTICE 'Auto-closed stale shift: %', v_stale_shift.id;
  END LOOP;

  -- Now create the new shift with client time
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
