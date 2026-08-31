-- Enable Supabase Realtime on key tables so connected clients
-- receive live updates when data changes.

-- Enable realtime for all critical tables
ALTER PUBLICATION supabase_realtime ADD TABLE products;
ALTER PUBLICATION supabase_realtime ADD TABLE categories;
ALTER PUBLICATION supabase_realtime ADD TABLE brands;
ALTER PUBLICATION supabase_realtime ADD TABLE inventory;
ALTER PUBLICATION supabase_realtime ADD TABLE inventory_batches;
ALTER PUBLICATION supabase_realtime ADD TABLE inventory_movements;
ALTER PUBLICATION supabase_realtime ADD TABLE suppliers;
ALTER PUBLICATION supabase_realtime ADD TABLE purchase_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE goods_receipts;
ALTER PUBLICATION supabase_realtime ADD TABLE goods_receipt_items;
ALTER PUBLICATION supabase_realtime ADD TABLE purchase_returns;
ALTER PUBLICATION supabase_realtime ADD TABLE purchase_return_items;
ALTER PUBLICATION supabase_realtime ADD TABLE customers;
ALTER PUBLICATION supabase_realtime ADD TABLE sales;
ALTER PUBLICATION supabase_realtime ADD TABLE sales_items;
ALTER PUBLICATION supabase_realtime ADD TABLE sales_returns;
ALTER PUBLICATION supabase_realtime ADD TABLE sales_return_items;
ALTER PUBLICATION supabase_realtime ADD TABLE customer_transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE customer_payments;
ALTER PUBLICATION supabase_realtime ADD TABLE supplier_transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE supplier_payments;
ALTER PUBLICATION supabase_realtime ADD TABLE expenses;
ALTER PUBLICATION supabase_realtime ADD TABLE profiles;
