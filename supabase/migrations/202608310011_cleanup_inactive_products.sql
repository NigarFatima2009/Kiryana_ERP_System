-- Migration: Clean up inactive products and establish proper deletion pattern
-- Date: 2026-08-31

-- First, delete inventory records for inactive products
DELETE FROM inventory 
WHERE product_id IN (
  SELECT id FROM products WHERE active = false
);

-- Then, delete movement records for inactive products
DELETE FROM inventory_movements 
WHERE product_id IN (
  SELECT id FROM products WHERE active = false
);

-- Then, delete batch records for inactive products
DELETE FROM inventory_batches 
WHERE product_id IN (
  SELECT id FROM products WHERE active = false
);

-- Finally, delete the inactive products themselves
DELETE FROM products 
WHERE active = false;

-- Add a comment to the products table to document the deletion pattern
COMMENT ON TABLE products IS 'Products table - deleted products are completely removed from the database';
