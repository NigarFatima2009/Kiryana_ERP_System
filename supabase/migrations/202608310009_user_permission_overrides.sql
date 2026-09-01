-- User-level permission overrides: allows customizing page access per individual user
-- while keeping role-based permissions as the foundation.
-- 
-- If a user_permission_override exists for a user+page combination, it takes precedence.
-- Otherwise, the user's role-based permission is used.
-- This enables scenarios like: two CASHIERs, one can access Dashboard, the other cannot.

CREATE TABLE IF NOT EXISTS public.user_permission_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  page_path text NOT NULL,
  enabled boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, page_path)
);

-- Index for fast lookups: get all overrides for a user
CREATE INDEX user_permission_overrides_user_id_idx ON public.user_permission_overrides(user_id);

-- Index for checking a specific override: (user_id, page_path) lookup
CREATE INDEX user_permission_overrides_user_page_idx ON public.user_permission_overrides(user_id, page_path);

-- Enable RLS
ALTER TABLE public.user_permission_overrides ENABLE ROW LEVEL SECURITY;

-- Everyone can read overrides (checked by app logic)
CREATE POLICY "Anyone can read user permission overrides" ON public.user_permission_overrides
  FOR SELECT USING (true);

-- Only authenticated users can update (OWNER controls via app)
CREATE POLICY "Authenticated users can update user permission overrides" ON public.user_permission_overrides
  FOR UPDATE USING (auth.role() = 'authenticated');

-- Only authenticated users can insert
CREATE POLICY "Authenticated users can insert user permission overrides" ON public.user_permission_overrides
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Only authenticated users can delete
CREATE POLICY "Authenticated users can delete user permission overrides" ON public.user_permission_overrides
  FOR DELETE USING (auth.role() = 'authenticated');

-- Enable Realtime so changes apply instantly across all clients
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_permission_overrides;

-- Update profiles table to add a touch_updated_at trigger if not exists
CREATE TRIGGER user_permission_overrides_updated BEFORE UPDATE ON public.user_permission_overrides
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
