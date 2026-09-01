-- Add page permissions for new features: Shift Management and Reorder Recommendations

-- Add CASHIER permissions for Shift Management
INSERT INTO public.page_permissions (role, page_path, page_label, enabled) VALUES
  ('CASHIER', '/shift', 'Shift Management', true)
ON CONFLICT (role, page_path) DO NOTHING;

-- Add OWNER permissions for new features
-- Note: OWNER has implicit access to all pages, but we add them here for UI/permissions page consistency
INSERT INTO public.page_permissions (role, page_path, page_label, enabled) VALUES
  ('OWNER', '/', 'Dashboard', true),
  ('OWNER', '/pos', 'Point of Sale', true),
  ('OWNER', '/shift', 'Shift Management', true),
  ('OWNER', '/sales', 'Sales History', true),
  ('OWNER', '/sales-returns', 'Sales Returns', true),
  ('OWNER', '/products', 'Products', true),
  ('OWNER', '/categories', 'Categories', true),
  ('OWNER', '/brands', 'Brands', true),
  ('OWNER', '/stock', 'Stock', true),
  ('OWNER', '/stock-movements', 'Stock Movements', true),
  ('OWNER', '/batches', 'Batches & Expiry', true),
  ('OWNER', '/valuation', 'Inventory Valuation', true),
  ('OWNER', '/reorder-recommendations', 'Reorder Recommendations', true),
  ('OWNER', '/suppliers', 'Suppliers', true),
  ('OWNER', '/purchase-orders', 'Purchase Orders', true),
  ('OWNER', '/goods-receipts', 'Goods Receipts', true),
  ('OWNER', '/purchase-returns', 'Purchase Returns', true),
  ('OWNER', '/customers', 'Customers', true),
  ('OWNER', '/khata', 'Khata', true),
  ('OWNER', '/payments', 'Payments', true),
  ('OWNER', '/expenses', 'Expenses', true),
  ('OWNER', '/accounting', 'Accounting', true),
  ('OWNER', '/reports', 'Reports', true),
  ('OWNER', '/employees', 'Employees', true),
  ('OWNER', '/notifications', 'Notifications', true),
  ('OWNER', '/settings', 'Settings', true),
  ('OWNER', '/permissions', 'Page Permissions', true),
  ('OWNER', '/audit-logs', 'Audit Logs', true)
ON CONFLICT (role, page_path) DO NOTHING;
