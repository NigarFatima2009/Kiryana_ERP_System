-- Create cheques table for cheque tracking (RECEIVED from customers, ISSUED to suppliers)
create table public.cheques (
  id uuid primary key default gen_random_uuid(),
  cheque_number text not null,
  type text not null check(type in ('RECEIVED','ISSUED')),
  party_type text not null check(party_type in ('CUSTOMER','SUPPLIER','OTHER')),
  party_id uuid,
  party_name text not null,
  bank_name text not null,
  account_number text,
  drawer_title text,
  amount numeric(14,2) not null check(amount > 0),
  issue_date date not null,
  due_date date not null,
  status text not null default 'PENDING' check(status in ('PENDING','CLEARED','BOUNCED','CANCELLED','RETURNED')),
  cleared_at timestamptz,
  notes text,
  reference_sale_id uuid references public.sales(id) on delete set null,
  reference_purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(cheque_number, bank_name)
);

-- Enable RLS
alter table public.cheques enable row level security;

-- RLS Policies
create policy cheques_read on public.cheques for select to authenticated 
  using (public.current_user_role() is not null);

create policy cheques_insert on public.cheques for insert to authenticated 
  with check (public.has_any_role(array['OWNER','MANAGER','ACCOUNTANT','CASHIER']::public.app_role[]));

create policy cheques_update on public.cheques for update to authenticated 
  using (public.has_any_role(array['OWNER','MANAGER','ACCOUNTANT']::public.app_role[])) 
  with check (public.has_any_role(array['OWNER','MANAGER','ACCOUNTANT']::public.app_role[]));

create policy cheques_delete on public.cheques for delete to authenticated 
  using (public.has_any_role(array['OWNER','MANAGER']::public.app_role[]));

-- Create index for performance
create index cheques_status_idx on public.cheques(status, due_date);
create index cheques_party_idx on public.cheques(party_type, party_id);
create index cheques_cheque_number_idx on public.cheques(cheque_number, bank_name);

-- Add update trigger
create trigger cheques_updated before update on public.cheques for each row execute function public.touch_updated_at();
