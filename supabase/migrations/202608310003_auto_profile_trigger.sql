-- Auto-create profile when a new auth user is created
-- This allows us to use signUp() from the client without Edge Functions

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce((new.raw_user_meta_data ->> 'role')::public.app_role, 'CASHIER'::public.app_role),
    true
  )
  on conflict (id) do update set
    full_name = coalesce(new.raw_user_meta_data ->> 'full_name', profiles.full_name),
    role = coalesce((new.raw_user_meta_data ->> 'role')::public.app_role, profiles.role);
  return new;
end;
$$;

-- Create the trigger on auth.users
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Grant usage to authenticated
grant usage on schema public to anon, authenticated;
