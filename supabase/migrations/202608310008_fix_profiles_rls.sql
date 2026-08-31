-- Fix the overly restrictive RLS policy on profiles table
-- The dynamically created 'profiles_read' policy blocks fetching all profiles
-- This policy is too restrictive and should be replaced with more specific rules

-- Drop the problematic dynamic profile_read policy if it exists
DROP POLICY IF EXISTS profiles_read ON public.profiles;

-- Ensure the correct specific policies exist for profiles
-- These allow OWNER/MANAGER to see all profiles, and users to see their own

-- Policy 1: Users can always read their own profile
CREATE POLICY profiles_own_read ON public.profiles 
  FOR SELECT 
  TO authenticated 
  USING (id = auth.uid());

-- Policy 2: Owner can read all profiles
CREATE POLICY profiles_owner_read ON public.profiles 
  FOR SELECT 
  TO authenticated 
  USING (public.has_any_role(array['OWNER']::public.app_role[]));

-- Policy 3: Manager can read all profiles
CREATE POLICY profiles_manager_read ON public.profiles 
  FOR SELECT 
  TO authenticated 
  USING (public.has_any_role(array['MANAGER']::public.app_role[]));

-- Update policy for ownership management (already exists but make it explicit)
DROP POLICY IF EXISTS profiles_owner_manage ON public.profiles;
CREATE POLICY profiles_owner_manage ON public.profiles 
  FOR ALL 
  TO authenticated 
  USING (public.has_any_role(array['OWNER']::public.app_role[])) 
  WITH CHECK (public.has_any_role(array['OWNER']::public.app_role[]));

-- Verify profiles RLS is enabled
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
