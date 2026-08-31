-- Remove the foreign key constraint on profiles.id → auth.users(id)
-- This allows creating employee profiles without auth accounts
-- Auth accounts can be created separately in Supabase Dashboard

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
