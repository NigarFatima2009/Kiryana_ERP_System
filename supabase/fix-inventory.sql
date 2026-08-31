-- Fix inventory quantities by recalculating from stock movements
-- This script recalculates the current inventory for all products based on movements

BEGIN;

-- Create a temp table with calculated quantities
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

-- For any products without movements, set quantity to 0
UPDATE inventory
SET quantity = 0
WHERE product_id NOT IN (SELECT DISTINCT product_id FROM inventory_movements);

-- Verify the fix
SELECT 
  p.id,
  p.name,
  inv.quantity,
  inv.average_cost,
  COUNT(m.id) as movement_count,
  SUM(m.quantity_change) as calculated_qty
FROM products p
LEFT JOIN inventory inv ON p.id = inv.product_id
LEFT JOIN inventory_movements m ON p.id = m.product_id
GROUP BY p.id, p.name, inv.quantity, inv.average_cost
ORDER BY p.name;

COMMIT;
