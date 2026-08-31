-- Add email column to profiles so we can track employee emails
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;

-- Backfill email from auth.users for existing profiles
UPDATE public.profiles p
SET email = au.email
FROM auth.users au
WHERE p.id = au.id AND p.email IS NULL;

-- Create an index on email for faster lookups
CREATE INDEX IF NOT EXISTS profiles_email_idx ON public.profiles(email);

-- Create an auto-update trigger for profiles to sync email from auth.users
CREATE OR REPLACE FUNCTION public.sync_profile_email()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.profiles
  SET email = NEW.email
  WHERE id = NEW.id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS auth_users_email_sync ON auth.users;
CREATE TRIGGER auth_users_email_sync
AFTER INSERT OR UPDATE ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_profile_email();
