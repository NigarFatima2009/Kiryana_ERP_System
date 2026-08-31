-- Create an atomic RPC function to handle employee creation
-- This ensures the profile is created with the correct role in one operation

CREATE OR REPLACE FUNCTION public.create_invited_employee(
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_role public.app_role
)
RETURNS TABLE(success boolean, message text, employee_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Update the profile that was created by the auth trigger
  -- with the correct role and ensure email is set
  UPDATE public.profiles
  SET 
    role = p_role,
    email = p_email,
    updated_at = now()
  WHERE id = p_user_id;

  -- Verify the update worked
  IF FOUND THEN
    RETURN QUERY SELECT true, 'Employee profile created successfully'::text, p_user_id;
  ELSE
    -- If profile doesn't exist yet (trigger didn't fire), create it manually
    INSERT INTO public.profiles (id, full_name, role, email, active)
    VALUES (p_user_id, p_full_name, p_role, p_email, true)
    ON CONFLICT (id) DO UPDATE
    SET 
      full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
      role = EXCLUDED.role,
      email = COALESCE(EXCLUDED.email, public.profiles.email),
      updated_at = now();
    
    RETURN QUERY SELECT true, 'Employee profile created (fallback)'::text, p_user_id;
  END IF;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM::text, NULL::uuid;
END;
$$;

-- Ensure function is callable by authenticated users
GRANT EXECUTE ON FUNCTION public.create_invited_employee(uuid, text, text, public.app_role) TO authenticated;
