-- Migration: Fix existing inventory quantities by recalculating from batches
-- Problem: Due to missing RLS policies, goods receipts created batches but
-- didn't update inventory.quantity. This script recalculates from batch data.

-- Update inventory.quantity to match sum of remaining_quantity across all batches
UPDATE public.inventory inv
SET quantity = COALESCE(batch_sum.total_remaining, 0),
    updated_at = now()
FROM (
  SELECT product_id, SUM(remaining_quantity) as total_remaining
  FROM public.inventory_batches
  GROUP BY product_id
) batch_sum
WHERE inv.product_id = batch_sum.product_id;

-- For products with batches but no inventory record, create one
INSERT INTO public.inventory (product_id, quantity, average_cost, reserved_quantity)
SELECT 
  ib.product_id,
  SUM(ib.remaining_quantity),
  CASE WHEN SUM(ib.remaining_quantity) > 0 
    THEN SUM(ib.remaining_quantity * ib.purchase_cost) / SUM(ib.remaining_quantity)
    ELSE 0 
  END,
  0
FROM public.inventory_batches ib
WHERE NOT EXISTS (SELECT 1 FROM public.inventory inv WHERE inv.product_id = ib.product_id)
GROUP BY ib.product_id;

-- Log what was fixed
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.inventory WHERE quantity > 0;
  RAISE NOTICE 'Fixed inventory: % products now have stock > 0', v_count;
END $$;
