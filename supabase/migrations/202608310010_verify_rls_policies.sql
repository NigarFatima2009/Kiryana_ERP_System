-- VERIFY AND FIX RLS POLICIES ON PROFILES

-- Check current RLS policies on profiles table
SELECT '=== CURRENT RLS POLICIES ===' as status;
SELECT 
  schemaname,
  tablename, 
  policyname, 
  permissive,
  roles,
  qual as condition,
  with_check
FROM pg_policies
WHERE tablename = 'profiles' AND schemaname = 'public'
ORDER BY policyname;

-- Verify profiles table has RLS enabled
SELECT '=== RLS STATUS ===' as status;
SELECT 
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE tablename = 'profiles' AND schemaname = 'public';

-- Check if policies allow OWNER/MANAGER to read all profiles
SELECT '=== TESTING POLICY LOGIC ===' as status;

-- Show what each user role should be able to see:
-- The key policies are:
-- 1. profiles_own_read: id = auth.uid() - users can read their own
-- 2. profiles_owner_read: has_any_role(['OWNER']) - owners can read all
-- 3. profiles_manager_read: has_any_role(['MANAGER']) - managers can read all

-- Verify the logic functions exist
SELECT '=== CHECKING HELPER FUNCTIONS ===' as status;
SELECT 
  n.nspname as schema,
  p.proname as function_name,
  pg_get_functiondef(p.oid) as function_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname IN ('current_user_role', 'has_any_role')
ORDER BY p.proname;

-- Final check: Count profiles by role
SELECT '=== PROFILES BY ROLE ===' as status;
SELECT role, COUNT(*) as count, STRING_AGG(full_name, ', ') as employees
FROM public.profiles
WHERE active = true
GROUP BY role
ORDER BY role;
