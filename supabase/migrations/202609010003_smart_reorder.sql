-- Smart Reorder Recommendations View
CREATE OR REPLACE VIEW public.reorder_recommendations AS
SELECT
  p.id,
  p.name,
  cat.name as category,
  COALESCE(i.quantity, 0) as current_stock,
  COALESCE(
    (
      SELECT COALESCE(AVG(si.quantity), 5)::NUMERIC
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      WHERE si.product_id = p.id
        AND s.created_at > NOW() - INTERVAL '30 days'
        AND s.status = 'COMPLETED'
    ), 5
  ) as daily_usage,
  3 as lead_time_days,
  (
    COALESCE(
      (
        SELECT COALESCE(AVG(si.quantity), 5)::INT
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        WHERE si.product_id = p.id AND s.created_at > NOW() - INTERVAL '30 days'
      ) * 3, 15
    )::INT
  ) as reorder_level,
  (
    COALESCE(
      (
        SELECT COALESCE(AVG(si.quantity), 5)::INT
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        WHERE si.product_id = p.id AND s.created_at > NOW() - INTERVAL '30 days'
      ) * 3 * 1.5, 20
    )::INT
  ) as recommended_quantity,
  COALESCE(po.supplier_id, (SELECT id FROM public.suppliers LIMIT 1)) as supplier_id,
  COALESCE(sup.name, 'Unassigned') as supplier_name,
  sup.phone as supplier_phone,
  COALESCE(poi.unit_cost, p.purchase_price) as last_purchase_price,
  (
    COALESCE(
      (
        SELECT COALESCE(AVG(si.quantity), 5)::INT
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        WHERE si.product_id = p.id AND s.created_at > NOW() - INTERVAL '30 days'
      ) * 3 * 1.5, 20
    )::INT
  ) * COALESCE(poi.unit_cost, p.purchase_price) as estimated_cost,
  CASE
    WHEN COALESCE(i.quantity, 0) < (
      COALESCE(
        (
          SELECT COALESCE(AVG(si.quantity), 5)::INT
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          WHERE si.product_id = p.id AND s.created_at > NOW() - INTERVAL '30 days'
        ) * 3, 15
      )::INT
    ) THEN 'URGENT'
    ELSE 'NORMAL'
  END as priority
FROM products p
LEFT JOIN categories cat ON cat.id = p.category_id
LEFT JOIN inventory i ON i.product_id = p.id
LEFT JOIN LATERAL (
  SELECT po_inner.supplier_id
  FROM purchase_orders po_inner
  WHERE po_inner.status = 'RECEIVED'
  ORDER BY po_inner.created_at DESC
  LIMIT 1
) po ON true
LEFT JOIN LATERAL (
  SELECT unit_cost
  FROM purchase_order_items
  WHERE product_id = p.id AND received_quantity > 0
  LIMIT 1
) poi ON true
LEFT JOIN suppliers sup ON sup.id = COALESCE(po.supplier_id, (SELECT id FROM public.suppliers LIMIT 1))
WHERE p.active = true;

DROP POLICY IF EXISTS "Reorder view accessible to owners and managers" ON public.products;
CREATE POLICY "Reorder view accessible to owners and managers" ON public.products
  FOR SELECT USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('OWNER', 'CASHIER')
  );
