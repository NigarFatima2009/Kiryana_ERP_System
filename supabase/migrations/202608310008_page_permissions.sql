-- Page permissions: OWNER controls which pages CASHIER can access
CREATE TABLE IF NOT EXISTS public.page_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role public.app_role NOT NULL,
  page_path text NOT NULL,
  page_label text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(role, page_path)
);

-- Insert default permissions for CASHIER (all enabled by default)
INSERT INTO public.page_permissions (role, page_path, page_label, enabled) VALUES
  ('CASHIER', '/', 'Dashboard', true),
  ('CASHIER', '/pos', 'Point of Sale', true),
  ('CASHIER', '/sales', 'Sales History', true),
  ('CASHIER', '/sales-returns', 'Sales Returns', true),
  ('CASHIER', '/customers', 'Customers', true),
  ('CASHIER', '/khata', 'Khata', true),
  ('CASHIER', '/reports', 'Reports', true),
  ('CASHIER', '/notifications', 'Notifications', true)
ON CONFLICT (role, page_path) DO NOTHING;

-- Enable RLS
ALTER TABLE public.page_permissions ENABLE ROW LEVEL SECURITY;

-- Everyone can read permissions
CREATE POLICY "Anyone can read page permissions" ON public.page_permissions
  FOR SELECT USING (true);

-- Only authenticated users can update (OWNER controls via app)
CREATE POLICY "Authenticated users can update page permissions" ON public.page_permissions
  FOR UPDATE USING (auth.role() = 'authenticated');

-- Only authenticated users can insert
CREATE POLICY "Authenticated users can insert page permissions" ON public.page_permissions
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
