-- Add email column to profiles so we can track employee emails
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;

-- Backfill email from auth.users for existing profiles
UPDATE public.profiles p
SET email = au.email
FROM auth.users au
WHERE p.id = au.id AND p.email IS NULL;

-- Make email required for new profiles (but allow null for existing data)
-- We'll handle this in the app layer
