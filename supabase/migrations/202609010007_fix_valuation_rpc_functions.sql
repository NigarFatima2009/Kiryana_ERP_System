-- Fix inventory valuation RPC functions
-- Issues: 
--   1. p.is_active should be p.active
--   2. WHERE i.quantity > 0 returns nothing when inventory.quantity is 0
--   3. FIFO uses quantity instead of remaining_quantity from batches

-- FIFO: Calculate from batches directly (don't rely on inventory.quantity)
CREATE OR REPLACE FUNCTION public.calculate_fifo_inventory_value()
RETURNS TABLE(
  product_id UUID,
  product_name TEXT,
  total_units INT,
  fifo_value DECIMAL,
  average_unit_cost DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  WITH batch_fifo AS (
    SELECT
      ib.product_id,
      p.name as product_name,
      ib.remaining_quantity,
      ib.purchase_cost,
      ROW_NUMBER() OVER (PARTITION BY ib.product_id ORDER BY ib.received_date ASC, ib.created_at ASC) as rn
    FROM inventory_batches ib
    JOIN products p ON p.id = ib.product_id
    WHERE p.active = true AND ib.remaining_quantity > 0
  ),
  product_totals AS (
    SELECT
      bf.product_id,
      bf.product_name,
      SUM(bf.remaining_quantity)::INT as total_units,
      SUM(bf.remaining_quantity * bf.purchase_cost) as fifo_value
    FROM batch_fifo bf
    GROUP BY bf.product_id, bf.product_name
  )
  SELECT
    pt.product_id,
    pt.product_name,
    pt.total_units,
    pt.fifo_value::DECIMAL,
    CASE WHEN pt.total_units > 0 THEN (pt.fifo_value / pt.total_units)::DECIMAL ELSE 0 END
  FROM product_totals pt
  WHERE pt.total_units > 0
  ORDER BY pt.product_name;
END;
$$ LANGUAGE plpgsql STABLE;

-- LIFO: Calculate from batches directly
CREATE OR REPLACE FUNCTION public.calculate_lifo_inventory_value()
RETURNS TABLE(
  product_id UUID,
  product_name TEXT,
  total_units INT,
  lifo_value DECIMAL,
  average_unit_cost DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  WITH product_totals AS (
    SELECT
      ib.product_id,
      p.name as product_name,
      SUM(ib.remaining_quantity)::INT as total_units,
      SUM(ib.remaining_quantity * ib.purchase_cost) as lifo_value
    FROM inventory_batches ib
    JOIN products p ON p.id = ib.product_id
    WHERE p.active = true AND ib.remaining_quantity > 0
    GROUP BY ib.product_id, p.name
  )
  SELECT
    pt.product_id,
    pt.product_name,
    pt.total_units,
    pt.lifo_value::DECIMAL,
    CASE WHEN pt.total_units > 0 THEN (pt.lifo_value / pt.total_units)::DECIMAL ELSE 0 END
  FROM product_totals pt
  WHERE pt.total_units > 0
  ORDER BY pt.product_name;
END;
$$ LANGUAGE plpgsql STABLE;

-- Weighted Average: Use inventory.average_cost if available, else calculate from batches
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
  WITH product_calc AS (
    SELECT
      ib.product_id,
      p.name as product_name,
      SUM(ib.remaining_quantity)::INT as total_units,
      CASE WHEN SUM(ib.remaining_quantity) > 0
        THEN SUM(ib.remaining_quantity * ib.purchase_cost) / SUM(ib.remaining_quantity)
        ELSE 0
      END as calc_avg_cost
    FROM inventory_batches ib
    JOIN products p ON p.id = ib.product_id
    WHERE p.active = true AND ib.remaining_quantity > 0
    GROUP BY ib.product_id, p.name
  )
  SELECT
    pc.product_id,
    pc.product_name,
    pc.total_units,
    (pc.total_units * pc.calc_avg_cost)::DECIMAL as weighted_avg_value,
    pc.calc_avg_cost::DECIMAL
  FROM product_calc pc
  WHERE pc.total_units > 0
  ORDER BY pc.product_name;
END;
$$ LANGUAGE plpgsql STABLE;

-- COGS comparison: Use batch data directly
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

  SELECT
    COALESCE(SUM(si.quantity), 0),
    COALESCE(SUM(si.cogs), 0)
  INTO v_total_qty, v_total_cost
  FROM sale_items si
  JOIN sales s ON si.sale_id = s.id
  WHERE s.status = 'COMPLETED'
    AND s.sale_date >= v_start_date;

  RETURN QUERY SELECT
    p_method,
    v_total_qty,
    v_total_cost,
    CASE WHEN v_total_qty > 0 THEN v_total_cost / v_total_qty ELSE 0 END,
    p_period_days;
END;
$$ LANGUAGE plpgsql STABLE;

-- Inventory valuation comparison view
DROP VIEW IF EXISTS public.inventory_valuation_comparison;
CREATE OR REPLACE VIEW public.inventory_valuation_comparison AS
SELECT
  fifo.product_id,
  fifo.product_name,
  fifo.total_units,
  fifo.fifo_value,
  lifo.lifo_value,
  wa.weighted_avg_value,
  (fifo.fifo_value - lifo.lifo_value) as fifo_vs_lifo_variance,
  (fifo.fifo_value - wa.weighted_avg_value) as fifo_vs_weighted_variance,
  CASE
    WHEN fifo.fifo_value > lifo.lifo_value THEN 'FIFO values higher by ' || (fifo.fifo_value - lifo.lifo_value)::TEXT
    WHEN fifo.fifo_value < lifo.lifo_value THEN 'LIFO values higher by ' || (lifo.lifo_value - fifo.fifo_value)::TEXT
    ELSE 'Methods produce equal value'
  END as valuation_method_impact
FROM calculate_fifo_inventory_value() fifo
JOIN calculate_lifo_inventory_value() lifo ON fifo.product_id = lifo.product_id
JOIN calculate_weighted_average_inventory_value() wa ON fifo.product_id = wa.product_id;

-- COGS comparison view
DROP VIEW IF EXISTS public.cogs_comparison_30_days;
CREATE OR REPLACE VIEW public.cogs_comparison_30_days AS
WITH fifo_cogs AS (SELECT * FROM calculate_cogs_by_method(30, 'FIFO')),
     lifo_cogs AS (SELECT * FROM calculate_cogs_by_method(30, 'LIFO')),
     wa_cogs AS (SELECT * FROM calculate_cogs_by_method(30, 'WEIGHTED_AVERAGE'))
SELECT
  'FIFO' as fifo_method,
  f.total_quantity as fifo_quantity,
  f.total_cost as fifo_total_cost,
  f.average_cost_per_unit as fifo_avg_cost,
  l.total_cost as lifo_total_cost,
  l.average_cost_per_unit as lifo_avg_cost,
  w.total_cost as weighted_avg_total_cost,
  w.average_cost_per_unit as weighted_avg_cost,
  (f.total_cost - l.total_cost) as fifo_vs_lifo_variance,
  (f.total_cost - w.total_cost) as fifo_vs_weighted_variance
FROM fifo_cogs f, lifo_cogs l, wa_cogs w;

-- Valuation report RPC
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
  v_total DECIMAL;
BEGIN
  -- Calculate total value first
  IF p_method = 'FIFO' THEN
    SELECT SUM(fifo_value) INTO v_total FROM calculate_fifo_inventory_value();
  ELSIF p_method = 'LIFO' THEN
    SELECT SUM(lifo_value) INTO v_total FROM calculate_lifo_inventory_value();
  ELSE
    SELECT SUM(weighted_avg_value) INTO v_total FROM calculate_weighted_average_inventory_value();
  END IF;

  IF v_total IS NULL OR v_total = 0 THEN
    v_total := 1; -- Avoid division by zero
  END IF;

  RETURN QUERY
  WITH val AS (
    SELECT * FROM calculate_fifo_inventory_value()
    WHERE p_method = 'FIFO'
    UNION ALL
    SELECT * FROM calculate_lifo_inventory_value()
    WHERE p_method = 'LIFO'
    UNION ALL
    SELECT * FROM calculate_weighted_average_inventory_value()
    WHERE p_method = 'WEIGHTED_AVERAGE'
  ),
  ranked AS (
    SELECT
      ROW_NUMBER() OVER (ORDER BY v.fifo_value DESC) as rn,
      v.product_name,
      COALESCE(cat.name, '') as cat_name,
      v.total_units,
      v.average_unit_cost,
      CASE
        WHEN p_method = 'FIFO' THEN v.fifo_value
        WHEN p_method = 'LIFO' THEN v.fifo_value
        ELSE v.average_unit_cost * v.total_units
      END as val
    FROM val v
    LEFT JOIN products p ON p.id = v.product_id
    LEFT JOIN categories cat ON cat.id = p.category_id
  )
  SELECT
    r.rn::INT,
    r.product_name,
    r.cat_name,
    r.total_units,
    r.average_unit_cost,
    r.val::DECIMAL,
    ((r.val / v_total) * 100)::DECIMAL
  FROM ranked r
  WHERE r.val > 0
  ORDER BY r.val DESC;
END;
$$ LANGUAGE plpgsql STABLE;
