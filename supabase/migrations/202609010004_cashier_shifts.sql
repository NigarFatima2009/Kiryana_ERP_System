-- Cashier Shift Management Tables and Functions
-- Tracks shift opening/closing cash, sales during shift, and variance calculation

-- Create cashier_shifts table
CREATE TABLE IF NOT EXISTS public.cashier_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opened_at TIMESTAMP NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMP,
  opening_cash DECIMAL(12,2) NOT NULL,
  closing_cash DECIMAL(12,2),
  expected_cash DECIMAL(12,2),
  variance DECIMAL(12,2),
  status VARCHAR(20) DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add shift_id to sales table (with cascading delete)
DO $$ 
BEGIN
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='sales' AND column_name='shift_id') THEN
    ALTER TABLE public.sales ADD COLUMN shift_id UUID REFERENCES public.cashier_shifts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_cashier_shifts_user_opened ON public.cashier_shifts(user_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_cashier_shifts_status ON public.cashier_shifts(status);
CREATE INDEX IF NOT EXISTS idx_sales_shift ON public.sales(shift_id);

-- Enable RLS
ALTER TABLE public.cashier_shifts ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view their own shifts" ON public.cashier_shifts;
CREATE POLICY "Users can view their own shifts" ON public.cashier_shifts
  FOR SELECT USING (
    user_id = auth.uid() 
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'OWNER'
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'MANAGER'
  );

DROP POLICY IF EXISTS "Cashiers can create shifts" ON public.cashier_shifts;
CREATE POLICY "Cashiers can create shifts" ON public.cashier_shifts
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('CASHIER', 'OWNER', 'MANAGER')
  );

DROP POLICY IF EXISTS "Cashiers can close their shifts" ON public.cashier_shifts;
CREATE POLICY "Cashiers can close their shifts" ON public.cashier_shifts
  FOR UPDATE USING (
    user_id = auth.uid()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'OWNER'
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'MANAGER'
  );

-- RPC Function: Open Shift
CREATE OR REPLACE FUNCTION public.open_cashier_shift(
  p_opening_cash DECIMAL
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
BEGIN
  RETURN QUERY
  INSERT INTO public.cashier_shifts (user_id, opening_cash, status)
  VALUES (auth.uid(), p_opening_cash, 'OPEN')
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

-- RPC Function: Close Shift
CREATE OR REPLACE FUNCTION public.close_cashier_shift(
  p_shift_id UUID,
  p_closing_cash DECIMAL
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
  v_id UUID;
  v_closed_at TIMESTAMP;
  v_status VARCHAR;
BEGIN
  -- Get opening cash and verify user owns this shift
  SELECT opening_cash INTO v_opening_cash
  FROM public.cashier_shifts
  WHERE id = p_shift_id AND user_id = auth.uid();

  IF v_opening_cash IS NULL THEN
    RAISE EXCEPTION 'Shift not found or unauthorized';
  END IF;

  -- Calculate sales total
  SELECT COALESCE(SUM(s.total), 0)::DECIMAL, COUNT(*)
  INTO v_sales_total, v_sales_count
  FROM public.sales s
  WHERE s.shift_id = p_shift_id AND s.status = 'completed';

  -- Calculate expected cash
  v_expected_cash := v_opening_cash + v_sales_total;
  v_variance := v_expected_cash - p_closing_cash;

  -- Update shift and store results in variables
  UPDATE public.cashier_shifts
  SET
    closed_at = NOW(),
    closing_cash = p_closing_cash,
    expected_cash = v_expected_cash,
    variance = v_variance,
    status = 'CLOSED',
    updated_at = NOW()
  WHERE id = p_shift_id AND user_id = auth.uid()
  RETURNING cashier_shifts.id, cashier_shifts.closed_at, cashier_shifts.status
  INTO v_id, v_closed_at, v_status;

  -- Return the result
  RETURN QUERY SELECT v_id, v_closed_at, v_opening_cash, p_closing_cash, v_expected_cash, v_variance, v_sales_count, v_sales_total, v_status;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC Function: Get Current Open Shift
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
    cashier_shifts.created_at
  FROM public.cashier_shifts
  WHERE user_id = auth.uid()
    AND status = 'OPEN'
  ORDER BY opened_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

-- RPC Function: Get Shift Summary
CREATE OR REPLACE FUNCTION public.get_shift_summary(p_shift_id UUID)
RETURNS TABLE(
  id UUID,
  opened_at TIMESTAMP,
  closed_at TIMESTAMP,
  opening_cash DECIMAL,
  closing_cash DECIMAL,
  expected_cash DECIMAL,
  variance DECIMAL,
  variance_percentage NUMERIC,
  sales_count INT,
  total_sales DECIMAL,
  average_transaction DECIMAL,
  status VARCHAR
) AS $$
DECLARE
  v_sales_total DECIMAL;
  v_sales_count INT;
  v_opening_cash DECIMAL;
  v_expected_cash DECIMAL;
  v_closing_cash DECIMAL;
  v_variance DECIMAL;
  v_variance_pct NUMERIC;
BEGIN
  -- Get shift data
  SELECT
    opening_cash, closing_cash, expected_cash, variance
  INTO v_opening_cash, v_closing_cash, v_expected_cash, v_variance
  FROM public.cashier_shifts
  WHERE id = p_shift_id;

  -- Get sales data
  SELECT
    COUNT(*),
    COALESCE(SUM(total_amount), 0)::DECIMAL
  INTO v_sales_count, v_sales_total
  FROM public.sales
  WHERE shift_id = p_shift_id AND status = 'completed';

  -- Calculate variance percentage
  v_variance_pct := CASE
    WHEN v_expected_cash > 0 THEN (v_variance / v_expected_cash * 100)
    ELSE 0
  END;

  RETURN QUERY
  SELECT
    cs.id,
    cs.opened_at,
    cs.closed_at,
    cs.opening_cash,
    cs.closing_cash,
    cs.expected_cash,
    cs.variance,
    v_variance_pct,
    v_sales_count::INT,
    v_sales_total,
    CASE WHEN v_sales_count > 0 THEN (v_sales_total / v_sales_count)::DECIMAL ELSE 0 END,
    cs.status
  FROM public.cashier_shifts cs
  WHERE cs.id = p_shift_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- View: Shift Dashboard (today's shifts)
CREATE OR REPLACE VIEW public.shift_dashboard AS
SELECT
  cs.id,
  cs.user_id,
  p.email,
  cs.opened_at,
  cs.closed_at,
  cs.opening_cash,
  cs.closing_cash,
  cs.expected_cash,
  cs.variance,
  CASE
    WHEN cs.variance > 100 THEN 'HIGH_VARIANCE'
    WHEN cs.variance < -100 THEN 'HIGH_VARIANCE'
    WHEN cs.variance > 0 THEN 'OVERAGE'
    WHEN cs.variance < 0 THEN 'SHORTAGE'
    ELSE 'BALANCED'
  END as variance_status,
  (
    SELECT COUNT(*)
    FROM public.sales s
    WHERE s.shift_id = cs.id AND s.status = 'completed'
  )::INT as sales_count,
  (
    SELECT COALESCE(SUM(total), 0)::DECIMAL
    FROM public.sales s
    WHERE s.shift_id = cs.id AND s.status = 'completed'
  ) as total_sales,
  cs.status,
  cs.created_at
FROM public.cashier_shifts cs
LEFT JOIN public.profiles p ON p.id = cs.user_id
WHERE DATE(cs.opened_at) = CURRENT_DATE
ORDER BY cs.opened_at DESC;

-- View: Shift Performance Report
CREATE OR REPLACE VIEW public.shift_performance_report AS
SELECT
  DATE(cs.opened_at) as shift_date,
  cs.user_id,
  p.email,
  COUNT(DISTINCT cs.id)::INT as shifts_worked,
  SUM(cs.opening_cash)::DECIMAL as total_opening_cash,
  COALESCE(SUM(s.total), 0)::DECIMAL as total_sales,
  (COALESCE(SUM(s.total), 0) / NULLIF(COUNT(s.id), 0))::DECIMAL as avg_sales_per_shift,
  COUNT(s.id)::INT as total_transactions,
  SUM(cs.variance)::DECIMAL as total_variance,
  AVG(ABS(cs.variance))::DECIMAL as avg_variance
FROM public.cashier_shifts cs
LEFT JOIN public.profiles p ON p.id = cs.user_id
LEFT JOIN public.sales s ON s.shift_id = cs.id AND s.status = 'COMPLETED'
WHERE cs.status = 'CLOSED'
GROUP BY DATE(cs.opened_at), cs.user_id, p.email
ORDER BY shift_date DESC, total_sales DESC;
