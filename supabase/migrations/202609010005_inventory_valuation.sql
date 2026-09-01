-- Inventory Valuation Methods (FIFO, LIFO, Weighted Average)
-- Calculates inventory value and COGS using different methods

-- Add valuation method column to products
DO $$ 
BEGIN
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='valuation_method') THEN
    ALTER TABLE public.products ADD COLUMN valuation_method VARCHAR(20) DEFAULT 'FIFO' CHECK (valuation_method IN ('FIFO', 'LIFO', 'WEIGHTED_AVERAGE'));
  END IF;
END $$;

-- RPC Function: Calculate inventory value using FIFO method
CREATE OR REPLACE FUNCTION public.calculate_fifo_inventory_value()
RETURNS TABLE(
  product_id UUID,
  product_name TEXT,
  total_units INT,
  fifo_value DECIMAL,
  average_unit_cost DECIMAL
) AS $$
DECLARE
  rec RECORD;
  v_remaining INT;
  v_cost DECIMAL;
  v_total DECIMAL;
  v_units INT;
BEGIN
  FOR rec IN
    SELECT DISTINCT p.id, p.name, COALESCE(i.quantity, 0) as current_qty
    FROM products p
    LEFT JOIN inventory i ON i.product_id = p.id
    WHERE p.is_active = true AND i.quantity > 0
  LOOP
    v_remaining := rec.current_qty;
    v_total := 0;
    v_cost := 0;

    -- Get batches in FIFO order (oldest first)
    FOR v_units, v_cost IN
      SELECT quantity, unit_cost
      FROM inventory_batches
      WHERE product_id = rec.id AND remaining_quantity > 0
      ORDER BY created_at ASC
    LOOP
      EXIT WHEN v_remaining <= 0;
      
      IF v_units <= v_remaining THEN
        v_total := v_total + (v_units * v_cost);
        v_remaining := v_remaining - v_units;
      ELSE
        v_total := v_total + (v_remaining * v_cost);
        v_remaining := 0;
      END IF;
    END LOOP;

    RETURN QUERY SELECT
      rec.id,
      rec.name,
      rec.current_qty::INT,
      v_total,
      CASE WHEN rec.current_qty > 0 THEN v_total / rec.current_qty ELSE 0 END;
  END LOOP;
END;
$$ LANGUAGE plpgsql STABLE;

-- RPC Function: Calculate inventory value using LIFO method
CREATE OR REPLACE FUNCTION public.calculate_lifo_inventory_value()
RETURNS TABLE(
  product_id UUID,
  product_name TEXT,
  total_units INT,
  lifo_value DECIMAL,
  average_unit_cost DECIMAL
) AS $$
DECLARE
  rec RECORD;
  v_remaining INT;
  v_cost DECIMAL;
  v_total DECIMAL;
  v_units INT;
BEGIN
  FOR rec IN
    SELECT DISTINCT p.id, p.name, COALESCE(i.quantity, 0) as current_qty
    FROM products p
    LEFT JOIN inventory i ON i.product_id = p.id
    WHERE p.is_active = true AND i.quantity > 0
  LOOP
    v_remaining := rec.current_qty;
    v_total := 0;
    v_cost := 0;

    -- Get batches in LIFO order (newest first)
    FOR v_units, v_cost IN
      SELECT quantity, unit_cost
      FROM inventory_batches
      WHERE product_id = rec.id AND remaining_quantity > 0
      ORDER BY created_at DESC
    LOOP
      EXIT WHEN v_remaining <= 0;
      
      IF v_units <= v_remaining THEN
        v_total := v_total + (v_units * v_cost);
        v_remaining := v_remaining - v_units;
      ELSE
        v_total := v_total + (v_remaining * v_cost);
        v_remaining := 0;
      END IF;
    END LOOP;

    RETURN QUERY SELECT
      rec.id,
      rec.name,
      rec.current_qty::INT,
      v_total,
      CASE WHEN rec.current_qty > 0 THEN v_total / rec.current_qty ELSE 0 END;
  END LOOP;
END;
$$ LANGUAGE plpgsql STABLE;

-- RPC Function: Calculate inventory value using Weighted Average method
CREATE OR REPLACE FUNCTION public.calculate_weighted_average_inventory_value()
RETURNS TABLE(
  product_id UUID,
  product_name TEXT,
  total_units INT,
  weighted_avg_value DECIMAL,
  average_unit_cost DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.name,
    COALESCE(i.quantity, 0)::INT,
    COALESCE(i.quantity, 0) * COALESCE(i.average_cost, 0)::DECIMAL,
    COALESCE(i.average_cost, 0)::DECIMAL
  FROM products p
  LEFT JOIN inventory i ON i.product_id = p.id
  WHERE p.is_active = true AND COALESCE(i.quantity, 0) > 0
  ORDER BY p.name;
END;
$$ LANGUAGE plpgsql STABLE;

-- RPC Function: Calculate COGS by valuation method
CREATE OR REPLACE FUNCTION public.calculate_cogs_by_method(
  p_period_days INT DEFAULT 30,
  p_method VARCHAR DEFAULT 'FIFO'
)
RETURNS TABLE(
  method VARCHAR,
  total_quantity BIGINT,
  total_cost DECIMAL,
  average_cost_per_unit DECIMAL,
  period_days INT
) AS $$
DECLARE
  v_total_qty BIGINT;
  v_total_cost DECIMAL;
  v_start_date DATE;
BEGIN
  v_start_date := CURRENT_DATE - (p_period_days || ' days')::INTERVAL;

  -- Get all sold quantities and their costs based on method
  IF p_method = 'FIFO' THEN
    SELECT
      COALESCE(SUM(si.quantity), 0),
      COALESCE(SUM(si.quantity * ib.unit_cost), 0)
    INTO v_total_qty, v_total_cost
    FROM sale_items si
    JOIN sales s ON si.sale_id = s.id
    JOIN inventory_batches ib ON si.product_id = ib.product_id
    WHERE s.status = 'completed'
      AND s.sale_date >= v_start_date
      AND ib.created_at <= s.sale_date
    ORDER BY s.sale_date, ib.created_at;

  ELSIF p_method = 'LIFO' THEN
    SELECT
      COALESCE(SUM(si.quantity), 0),
      COALESCE(SUM(si.quantity * ib.unit_cost), 0)
    INTO v_total_qty, v_total_cost
    FROM sale_items si
    JOIN sales s ON si.sale_id = s.id
    JOIN inventory_batches ib ON si.product_id = ib.product_id
    WHERE s.status = 'completed'
      AND s.sale_date >= v_start_date
      AND ib.created_at <= s.sale_date
    ORDER BY s.sale_date DESC, ib.created_at DESC;

  ELSE -- WEIGHTED_AVERAGE
    SELECT
      COALESCE(SUM(si.quantity), 0),
      COALESCE(SUM(si.quantity * i.average_cost), 0)
    INTO v_total_qty, v_total_cost
    FROM sale_items si
    JOIN sales s ON si.sale_id = s.id
    JOIN inventory i ON si.product_id = i.product_id
    WHERE s.status = 'completed'
      AND s.sale_date >= v_start_date;
  END IF;

  RETURN QUERY SELECT
    p_method::VARCHAR,
    v_total_qty,
    v_total_cost,
    CASE WHEN v_total_qty > 0 THEN v_total_cost / v_total_qty ELSE 0 END,
    p_period_days;
END;
$$ LANGUAGE plpgsql STABLE;

-- View: Inventory Valuation Comparison
CREATE OR REPLACE VIEW public.inventory_valuation_comparison AS
SELECT
  f.product_id,
  f.product_name,
  f.total_units,
  f.fifo_value,
  l.lifo_value,
  w.weighted_avg_value,
  (f.fifo_value - l.lifo_value)::DECIMAL as fifo_vs_lifo_variance,
  (f.fifo_value - w.weighted_avg_value)::DECIMAL as fifo_vs_weighted_variance,
  CASE
    WHEN f.fifo_value > l.lifo_value THEN 'FIFO Higher'
    WHEN f.fifo_value < l.lifo_value THEN 'LIFO Higher'
    ELSE 'Equal'
  END as valuation_method_impact
FROM
  (SELECT * FROM calculate_fifo_inventory_value()) f
JOIN
  (SELECT * FROM calculate_lifo_inventory_value()) l ON f.product_id = l.product_id
JOIN
  (SELECT * FROM calculate_weighted_average_inventory_value()) w ON f.product_id = w.product_id
ORDER BY f.product_name;

-- View: COGS Comparison by Period
CREATE OR REPLACE VIEW public.cogs_comparison_30_days AS
SELECT
  f.method as fifo_method,
  f.total_quantity as fifo_quantity,
  f.total_cost as fifo_total_cost,
  f.average_cost_per_unit as fifo_avg_cost,
  l.total_cost as lifo_total_cost,
  l.average_cost_per_unit as lifo_avg_cost,
  w.total_cost as weighted_avg_total_cost,
  w.average_cost_per_unit as weighted_avg_cost,
  (f.total_cost - l.total_cost)::DECIMAL as fifo_vs_lifo_variance,
  (f.total_cost - w.total_cost)::DECIMAL as fifo_vs_weighted_variance
FROM
  calculate_cogs_by_method(30, 'FIFO') f,
  calculate_cogs_by_method(30, 'LIFO') l,
  calculate_cogs_by_method(30, 'WEIGHTED_AVERAGE') w;

-- RPC Function: Get detailed valuation report
CREATE OR REPLACE FUNCTION public.get_inventory_valuation_report(p_method VARCHAR DEFAULT 'FIFO')
RETURNS TABLE(
  rank INT,
  product_name TEXT,
  category_name TEXT,
  total_units INT,
  unit_cost DECIMAL,
  total_value DECIMAL,
  percentage_of_total DECIMAL
) AS $$
DECLARE
  v_total_value DECIMAL;
BEGIN
  -- Get total inventory value
  IF p_method = 'FIFO' THEN
    SELECT SUM(fifo_value) INTO v_total_value FROM calculate_fifo_inventory_value();
    
    RETURN QUERY
    SELECT
      ROW_NUMBER() OVER (ORDER BY fv.fifo_value DESC)::INT,
      fv.product_name,
      cat.name,
      fv.total_units,
      fv.average_unit_cost,
      fv.fifo_value,
      CASE WHEN v_total_value > 0 THEN (fv.fifo_value / v_total_value * 100) ELSE 0 END
    FROM calculate_fifo_inventory_value() fv
    JOIN products p ON fv.product_id = p.id
    LEFT JOIN categories cat ON p.category_id = cat.id
    WHERE fv.total_units > 0
    ORDER BY fv.fifo_value DESC;

  ELSIF p_method = 'LIFO' THEN
    SELECT SUM(lifo_value) INTO v_total_value FROM calculate_lifo_inventory_value();
    
    RETURN QUERY
    SELECT
      ROW_NUMBER() OVER (ORDER BY lv.lifo_value DESC)::INT,
      lv.product_name,
      cat.name,
      lv.total_units,
      lv.average_unit_cost,
      lv.lifo_value,
      CASE WHEN v_total_value > 0 THEN (lv.lifo_value / v_total_value * 100) ELSE 0 END
    FROM calculate_lifo_inventory_value() lv
    JOIN products p ON lv.product_id = p.id
    LEFT JOIN categories cat ON p.category_id = cat.id
    WHERE lv.total_units > 0
    ORDER BY lv.lifo_value DESC;

  ELSE -- WEIGHTED_AVERAGE
    SELECT SUM(weighted_avg_value) INTO v_total_value FROM calculate_weighted_average_inventory_value();
    
    RETURN QUERY
    SELECT
      ROW_NUMBER() OVER (ORDER BY wv.weighted_avg_value DESC)::INT,
      wv.product_name,
      cat.name,
      wv.total_units,
      wv.average_unit_cost,
      wv.weighted_avg_value,
      CASE WHEN v_total_value > 0 THEN (wv.weighted_avg_value / v_total_value * 100) ELSE 0 END
    FROM calculate_weighted_average_inventory_value() wv
    JOIN products p ON wv.product_id = p.id
    LEFT JOIN categories cat ON p.category_id = cat.id
    WHERE wv.total_units > 0
    ORDER BY wv.weighted_avg_value DESC;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;
