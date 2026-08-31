-- Fix missing stock movements for purchase returns

-- 1. First, identify returns that don't have matching movements
SELECT 
  pr.id,
  pr.return_number,
  gri.product_id,
  pri.quantity,
  gri.unit_cost,
  COUNT(im.id) as movement_count
FROM purchase_returns pr
JOIN purchase_return_items pri ON pr.id = pri.purchase_return_id
JOIN goods_receipt_items gri ON pri.goods_receipt_item_id = gri.id
LEFT JOIN inventory_movements im ON (
  im.reference_type = 'PURCHASE_RETURN' 
  AND im.reference_id = pr.id 
  AND im.product_id = gri.product_id
)
GROUP BY pr.id, pr.return_number, gri.product_id, pri.quantity, gri.unit_cost
HAVING COUNT(im.id) = 0
ORDER BY pr.created_at DESC;

-- 2. Create missing movements for all returns that don't have them
INSERT INTO inventory_movements (
  product_id,
  movement_type,
  quantity_change,
  unit_cost,
  reference_type,
  reference_id,
  notes,
  created_at
)
SELECT 
  gri.product_id,
  'PURCHASE_RETURN',
  -pri.quantity,
  gri.unit_cost,
  'PURCHASE_RETURN',
  pr.id,
  'Purchase return - ' || pr.return_number,
  pr.created_at
FROM purchase_returns pr
JOIN purchase_return_items pri ON pr.id = pri.purchase_return_id
JOIN goods_receipt_items gri ON pri.goods_receipt_item_id = gri.id
WHERE NOT EXISTS (
  SELECT 1 FROM inventory_movements im
  WHERE im.reference_type = 'PURCHASE_RETURN' 
  AND im.reference_id = pr.id 
  AND im.product_id = gri.product_id
);

-- 3. Now recalculate inventory from all movements
WITH movement_totals AS (
  SELECT 
    product_id,
    SUM(quantity_change) as total_qty,
    AVG(unit_cost) as avg_cost
  FROM inventory_movements
  WHERE product_id IS NOT NULL
  GROUP BY product_id
)
UPDATE inventory inv
SET 
  quantity = COALESCE(mt.total_qty, 0),
  average_cost = COALESCE(mt.avg_cost, inv.average_cost)
FROM movement_totals mt
WHERE inv.product_id = mt.product_id;

-- 4. Verify the final inventory
SELECT 
  p.name,
  inv.quantity,
  inv.average_cost,
  SUM(m.quantity_change) as calculated_qty
FROM products p
LEFT JOIN inventory inv ON p.id = inv.product_id
LEFT JOIN inventory_movements m ON p.id = m.product_id
GROUP BY p.id, p.name, inv.quantity, inv.average_cost
ORDER BY p.name;
