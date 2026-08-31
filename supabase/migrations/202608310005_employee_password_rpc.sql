-- Table to store temporary employee passwords
-- This is a workaround since Supabase anon key cannot set auth passwords

create table if not exists public.employee_password_temp (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  password_hash text not null,
  created_at timestamp with time zone default now(),
  expires_at timestamp with time zone default now() + interval '7 days',
  used_at timestamp with time zone,
  unique(employee_id)
);

-- Enable RLS
alter table public.employee_password_temp enable row level security;

-- Policy: Only OWNER can insert/update
create policy "owner_can_manage_employee_passwords"
  on public.employee_password_temp
  for all
  using (
    public.current_user_role() = 'OWNER'
  )
  with check (public.current_user_role() = 'OWNER');

-- Grant access
grant select, insert, update, delete on public.employee_password_temp to authenticated;

-- Function to hash password (using crypt from pgcrypto)
create extension if not exists pgcrypto;

-- Function to set employee password by owner
create or replace function public.set_employee_password_temp(
  p_employee_id uuid,
  p_password text
) returns table(success boolean, message text) language plpgsql as $$
declare
  v_password_hash text;
begin
  -- Verify caller is OWNER
  if public.current_user_role() != 'OWNER' then
    return query select false, 'Only OWNER can set employee passwords';
    return;
  end if;

  -- Verify employee exists
  if not exists(select 1 from public.profiles where id = p_employee_id) then
    return query select false, 'Employee not found';
    return;
  end if;

  -- Hash the password using bcrypt
  v_password_hash := crypt(p_password, gen_salt('bf'));

  -- Insert or update the temporary password
  insert into public.employee_password_temp (employee_id, password_hash)
  values (p_employee_id, v_password_hash)
  on conflict (employee_id) do update set
    password_hash = v_password_hash,
    created_at = now(),
    expires_at = now() + interval '7 days',
    used_at = null;

  return query select true, 'Password set successfully. Employee can now login.';
end;
$$;

-- Function to verify employee password at login
create or replace function public.verify_employee_password(
  p_email text,
  p_password text
) returns table(success boolean, user_id uuid, message text) language plpgsql as $$
declare
  v_employee_id uuid;
  v_password_hash text;
  v_matches boolean;
begin
  -- Find employee by email
  select id into v_employee_id from public.profiles where email = p_email;
  
  if v_employee_id is null then
    return query select false, null::uuid, 'Email not found';
    return;
  end if;

  -- Get stored password hash
  select password_hash into v_password_hash 
  from public.employee_password_temp 
  where employee_id = v_employee_id 
    and expires_at > now()
    and used_at is null;

  if v_password_hash is null then
    return query select false, null::uuid, 'Temporary password not set or expired';
    return;
  end if;

  -- Verify password
  v_matches := (v_password_hash = crypt(p_password, v_password_hash));
  
  if v_matches then
    -- Mark as used
    update public.employee_password_temp 
    set used_at = now() 
    where employee_id = v_employee_id;
    
    return query select true, v_employee_id, 'Password verified';
  else
    return query select false, null::uuid, 'Invalid password';
  end if;
end;
$$;

grant execute on function public.set_employee_password_temp(uuid, text) to authenticated;
grant execute on function public.verify_employee_password(text, text) to anon;
