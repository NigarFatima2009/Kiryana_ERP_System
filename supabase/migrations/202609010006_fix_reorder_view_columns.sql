-- Fix reorder_recommendations view: column names must match TypeScript interface
-- Previous view used: id, name, category, supplier_id
-- TypeScript expects: product_id, product_name, category_name, suggested_supplier_id, reason

DROP VIEW IF EXISTS public.reorder_recommendations;

CREATE OR REPLACE VIEW public.reorder_recommendations AS
WITH product_sales AS (
  SELECT
    si.product_id,
    COALESCE(AVG(si.quantity), 5)::NUMERIC as avg_daily,
    COALESCE(SUM(si.quantity), 0)::INT as total_sold_30d
  FROM sale_items si
  JOIN sales s ON si.sale_id = s.id
  WHERE s.created_at > NOW() - INTERVAL '30 days'
    AND s.status = 'COMPLETED'
  GROUP BY si.product_id
),
product_suppliers AS (
  SELECT DISTINCT ON (poi.product_id)
    poi.product_id,
    poi.unit_cost,
    po.supplier_id
  FROM purchase_order_items poi
  JOIN purchase_orders po ON poi.purchase_order_id = po.id
  WHERE poi.received_quantity > 0
  ORDER BY poi.product_id, po.created_at DESC
)
SELECT
  p.id as product_id,
  p.name as product_name,
  COALESCE(cat.name, 'Uncategorized') as category_name,
  COALESCE(i.quantity, 0)::INT as current_stock,
  COALESCE(ps.avg_daily, 5)::NUMERIC as daily_usage,
  3 as lead_time_days,
  -- Use product's configured reorder_level if set (> 0), otherwise calculate from sales
  COALESCE(
    NULLIF(p.reorder_level::INT, 0),
    GREATEST(COALESCE(ps.avg_daily, 5)::INT * 3, 10)
  ) as reorder_level,
  -- Recommended quantity: 1.5x the reorder level
  CEILING(
    COALESCE(
      NULLIF(p.reorder_level::INT, 0),
      GREATEST(COALESCE(ps.avg_daily, 5)::INT * 3, 10)
    ) * 1.5
  )::INT as recommended_quantity,
  COALESCE(pps.supplier_id, (SELECT id FROM public.suppliers WHERE active = true LIMIT 1)) as suggested_supplier_id,
  COALESCE(sup.name, 'No supplier') as supplier_name,
  COALESCE(sup.phone, '') as supplier_phone,
  COALESCE(pps.unit_cost, p.purchase_price, 0) as last_purchase_price,
  CEILING(
    COALESCE(
      NULLIF(p.reorder_level::INT, 0),
      GREATEST(COALESCE(ps.avg_daily, 5)::INT * 3, 10)
    ) * 1.5
  )::INT * COALESCE(pps.unit_cost, p.purchase_price, 0) as estimated_cost,
  CASE
    WHEN COALESCE(i.quantity, 0) = 0 THEN 'URGENT'
    WHEN COALESCE(i.quantity, 0) < (
      COALESCE(
        NULLIF(p.reorder_level::INT, 0),
        GREATEST(COALESCE(ps.avg_daily, 5)::INT * 3, 10)
      ) * 0.5
    )::NUMERIC THEN 'URGENT'
    ELSE 'NORMAL'
  END as priority,
  CASE
    WHEN COALESCE(i.quantity, 0) = 0 THEN 'Out of stock - no units remaining'
    WHEN p.reorder_level > 0 AND COALESCE(i.quantity, 0) < p.reorder_level
      THEN 'Below configured reorder level of ' || p.reorder_level::INT
    ELSE 'Below calculated reorder level of ' || COALESCE(
      NULLIF(p.reorder_level::INT, 0),
      GREATEST(COALESCE(ps.avg_daily, 5)::INT * 3, 10)
    )::INT
  END as reason
FROM products p
LEFT JOIN categories cat ON cat.id = p.category_id
LEFT JOIN inventory i ON i.product_id = p.id
LEFT JOIN product_sales ps ON ps.product_id = p.id
LEFT JOIN product_suppliers pps ON pps.product_id = p.id
LEFT JOIN suppliers sup ON sup.id = COALESCE(pps.supplier_id, (SELECT id FROM public.suppliers WHERE active = true LIMIT 1))
WHERE p.active = true
  AND (
    -- Include if below calculated reorder level (from sales)
    COALESCE(i.quantity, 0) < GREATEST(COALESCE(ps.avg_daily, 5)::INT * 3, 10)
    -- OR include if below product's configured reorder_level
    OR COALESCE(i.quantity, 0) < COALESCE(p.reorder_level, 0)
  );
