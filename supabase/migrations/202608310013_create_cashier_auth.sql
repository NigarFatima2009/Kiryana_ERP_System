-- ============================================================
-- Migration: Create real Supabase Auth users for cashiers
-- and add must_change_password for first-login password change
-- ============================================================

-- 1. Add must_change_password column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- 2. RPC: create_cashier_account
--    Creates a real Supabase Auth user + profile in one call.
--    Called by OWNER only. Uses SECURITY DEFINER so it can write to auth.users.
CREATE OR REPLACE FUNCTION public.create_cashier_account(
  p_email text,
  p_full_name text,
  p_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_role public.app_role;
  v_user_id uuid;
  v_temp_password text;
BEGIN
  -- ── Verify caller is OWNER ──────────────────────────────────
  SELECT role INTO v_caller_role
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_caller_role IS DISTINCT FROM 'OWNER' THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Only the owner can create cashier accounts'
    );
  END IF;

  -- ── Validate inputs ─────────────────────────────────────────
  IF p_email IS NULL OR p_email = '' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Email is required');
  END IF;

  IF p_full_name IS NULL OR p_full_name = '' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Full name is required');
  END IF;

  -- ── Check for duplicate email in auth.users ─────────────────
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = p_email) THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'A user with this email already exists'
    );
  END IF;

  -- ── Use provided password or generate one ───────────────────
  v_temp_password := COALESCE(NULLIF(p_password, ''),
    substr(md5(random()::text), 1, 8) || 'A1!'
  );

  -- ── Create the auth user ────────────────────────────────────
  v_user_id := gen_random_uuid();

  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    p_email,
    crypt(v_temp_password, gen_salt('bf')),
    now(),                            -- email confirmed immediately (internal account)
    jsonb_build_object(
      'full_name', p_full_name,
      'role', 'CASHIER'
    ),
    now(),
    now(),
    encode(gen_random_bytes(32), 'hex'),
    encode(gen_random_bytes(32), 'hex')
  );

  -- ── Update the auto-created profile ─────────────────────────
  -- The handle_new_user trigger already created a profile row.
  -- We update it with the correct role, email, and must_change_password.
  UPDATE public.profiles
  SET
    role = 'CASHIER',
    email = p_email,
    full_name = p_full_name,
    active = true,
    must_change_password = true,
    updated_at = now()
  WHERE id = v_user_id;

  -- If trigger didn't fire (edge case), insert manually
  IF NOT FOUND THEN
    INSERT INTO public.profiles (id, full_name, role, email, active, must_change_password)
    VALUES (v_user_id, p_full_name, 'CASHIER', p_email, true, true)
    ON CONFLICT (id) DO UPDATE SET
      role = 'CASHIER',
      email = p_email,
      full_name = p_full_name,
      active = true,
      must_change_password = true,
      updated_at = now();
  END IF;

  -- ── Audit log ───────────────────────────────────────────────
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, new_value)
  VALUES (
    auth.uid(),
    'cashier_created',
    'profile',
    v_user_id,
    jsonb_build_object('email', p_email, 'full_name', p_full_name)
  );

  -- ── Return success ──────────────────────────────────────────
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Cashier account created successfully',
    'user_id', v_user_id,
    'email', p_email,
    'temp_password', v_temp_password
  );
END;
$$;

-- 3. RPC: change_own_password
--    Used by cashier on first login to change their temporary password.
CREATE OR REPLACE FUNCTION public.change_own_password(
  p_new_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  IF p_new_password IS NULL OR length(p_new_password) < 6 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Password must be at least 6 characters');
  END IF;

  -- Update auth password
  UPDATE auth.users
  SET
    encrypted_password = crypt(p_new_password, gen_salt('bf')),
    updated_at = now()
  WHERE id = v_user_id;

  -- Mark password as changed
  UPDATE public.profiles
  SET
    must_change_password = false,
    updated_at = now()
  WHERE id = v_user_id;

  -- Audit log
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id)
  VALUES (v_user_id, 'password_changed', 'profile', v_user_id);

  RETURN jsonb_build_object('success', true, 'message', 'Password updated successfully');
END;
$$;

-- 4. RPC: set_cashier_password (OWNER can set a cashier's password)
CREATE OR REPLACE FUNCTION public.set_cashier_password(
  p_user_id uuid,
  p_new_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_role public.app_role;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE id = auth.uid();

  IF v_caller_role IS DISTINCT FROM 'OWNER' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Only owner can set passwords');
  END IF;

  IF p_new_password IS NULL OR length(p_new_password) < 6 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Password must be at least 6 characters');
  END IF;

  -- Update auth password
  UPDATE auth.users
  SET encrypted_password = crypt(p_new_password, gen_salt('bf')), updated_at = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'User not found in auth');
  END IF;

  -- Force password change on next login
  UPDATE public.profiles
  SET must_change_password = true, updated_at = now()
  WHERE id = p_user_id;

  RETURN jsonb_build_object('success', true, 'message', 'Password set. Cashier must change on next login.');
END;
$$;

-- 5. RPC: delete_cashier_account (removes auth user + profile)
CREATE OR REPLACE FUNCTION public.delete_cashier_account(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_role public.app_role;
  v_target_role public.app_role;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE id = auth.uid();

  IF v_caller_role IS DISTINCT FROM 'OWNER' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Only owner can delete accounts');
  END IF;

  SELECT role INTO v_target_role FROM public.profiles WHERE id = p_user_id;

  IF v_target_role IS DISTINCT FROM 'CASHIER' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Can only delete cashier accounts');
  END IF;

  -- Delete the auth user (this cascade-deletes the profile via FK)
  DELETE FROM auth.users WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'User not found');
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Cashier account deleted');
END;
$$;

-- 6. Grant execute permissions
GRANT EXECUTE ON FUNCTION public.create_cashier_account(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.change_own_password(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_cashier_password(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_cashier_account(uuid) TO authenticated;

-- 7. Ensure profiles RLS allows the RPC (SECURITY DEFINER bypasses RLS, but just in case)
-- The RPCs use SECURITY DEFINER so they bypass RLS entirely.
