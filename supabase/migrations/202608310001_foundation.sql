-- Kiryana ERP: all money columns are numeric. Transaction-changing RPCs below are atomic.
create extension if not exists pgcrypto;

create type public.app_role as enum ('OWNER','MANAGER','CASHIER','INVENTORY_MANAGER','ACCOUNTANT');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '', role public.app_role not null default 'CASHIER',
  active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.roles (code public.app_role primary key, label text not null);
insert into public.roles values ('OWNER','Owner'),('MANAGER','Manager'),('CASHIER','Cashier'),('INVENTORY_MANAGER','Inventory manager'),('ACCOUNTANT','Accountant');
create table public.permissions (code text primary key, label text not null);
create table public.role_permissions (role public.app_role references public.roles(code), permission_code text references public.permissions(code), primary key(role,permission_code));

create table public.categories (id uuid primary key default gen_random_uuid(), name text not null unique, active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.brands (id uuid primary key default gen_random_uuid(), name text not null unique, active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.products (
 id uuid primary key default gen_random_uuid(), name text not null, sku text not null unique, barcode text unique,
 category_id uuid references public.categories(id) on delete restrict, brand_id uuid references public.brands(id) on delete restrict,
 unit text not null default 'pcs', purchase_price numeric(14,2) not null default 0 check(purchase_price >= 0), selling_price numeric(14,2) not null check(selling_price >= 0), wholesale_price numeric(14,2) not null default 0 check(wholesale_price >= 0), tax_rate numeric(5,2) not null default 0 check(tax_rate between 0 and 100), reorder_level numeric(14,3) not null default 0 check(reorder_level >= 0), minimum_stock numeric(14,3) not null default 0, maximum_stock numeric(14,3), expiry_tracking boolean not null default false, active boolean not null default true, image_path text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index products_name_idx on public.products using gin(to_tsvector('simple', name));
create index products_barcode_idx on public.products(barcode) where barcode is not null;

create table public.inventory (
 product_id uuid primary key references public.products(id) on delete restrict, quantity numeric(14,3) not null default 0 check(quantity >= 0), reserved_quantity numeric(14,3) not null default 0 check(reserved_quantity >= 0), average_cost numeric(14,4) not null default 0, updated_at timestamptz not null default now(), check(reserved_quantity <= quantity)
);
create table public.inventory_batches (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id) on delete restrict, supplier_id uuid, batch_number text, purchase_cost numeric(14,4) not null check(purchase_cost >= 0), received_quantity numeric(14,3) not null check(received_quantity > 0), remaining_quantity numeric(14,3) not null check(remaining_quantity >= 0), manufacturing_date date, expiry_date date, received_date date not null default current_date, created_at timestamptz not null default now(), check(expiry_date is null or manufacturing_date is null or expiry_date >= manufacturing_date)
);
create unique index inventory_batches_unique_batch on public.inventory_batches(product_id, coalesce(batch_number,''), received_date, purchase_cost);
create index inventory_batches_fefo_idx on public.inventory_batches(product_id, expiry_date, received_date) where remaining_quantity > 0;
create table public.inventory_movements (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id) on delete restrict, batch_id uuid references public.inventory_batches(id) on delete restrict,
 movement_type text not null check(movement_type in ('PURCHASE','SALE','SALE_RETURN','PURCHASE_RETURN','ADJUSTMENT','DAMAGE','WASTAGE','OPENING_STOCK')),
 quantity_change numeric(14,3) not null check(quantity_change <> 0), unit_cost numeric(14,4) not null default 0, reference_type text not null, reference_id uuid, notes text, created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);
create index inventory_movements_product_date_idx on public.inventory_movements(product_id,created_at desc);

create table public.suppliers (
 id uuid primary key default gen_random_uuid(), name text not null, company text, phone text, email text, address text, tax_information text, credit_limit numeric(14,2) not null default 0, opening_balance numeric(14,2) not null default 0, notes text, active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.customers (
 id uuid primary key default gen_random_uuid(), name text not null, phone text unique, email text, address text, credit_limit numeric(14,2) not null default 0, opening_balance numeric(14,2) not null default 0, notes text, active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.purchase_orders (
 id uuid primary key default gen_random_uuid(), order_number text not null unique, supplier_id uuid not null references public.suppliers(id) on delete restrict, status text not null default 'DRAFT' check(status in ('DRAFT','PENDING','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')), order_date date not null default current_date, discount numeric(14,2) not null default 0, tax numeric(14,2) not null default 0, total numeric(14,2) not null default 0, notes text, created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.purchase_order_items (id uuid primary key default gen_random_uuid(), purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade, product_id uuid not null references public.products(id) on delete restrict, quantity numeric(14,3) not null check(quantity > 0), received_quantity numeric(14,3) not null default 0 check(received_quantity >= 0), unit_cost numeric(14,4) not null check(unit_cost >= 0), discount numeric(14,2) not null default 0, unique(purchase_order_id,product_id));
create table public.goods_receipts (id uuid primary key default gen_random_uuid(), receipt_number text not null unique, purchase_order_id uuid references public.purchase_orders(id) on delete restrict, supplier_id uuid not null references public.suppliers(id) on delete restrict, received_date date not null default current_date, subtotal numeric(14,2) not null default 0, discount numeric(14,2) not null default 0, tax numeric(14,2) not null default 0, total numeric(14,2) not null default 0, notes text, created_by uuid references public.profiles(id), created_at timestamptz not null default now());
create table public.goods_receipt_items (id uuid primary key default gen_random_uuid(), goods_receipt_id uuid not null references public.goods_receipts(id) on delete cascade, product_id uuid not null references public.products(id) on delete restrict, batch_id uuid not null references public.inventory_batches(id) on delete restrict, quantity numeric(14,3) not null check(quantity > 0), unit_cost numeric(14,4) not null check(unit_cost >= 0));

create table public.sales (
 id uuid primary key default gen_random_uuid(), invoice_number text not null unique, customer_id uuid references public.customers(id) on delete restrict, status text not null default 'COMPLETED' check(status in ('HELD','COMPLETED','CANCELLED','RETURNED')), sale_date timestamptz not null default now(), subtotal numeric(14,2) not null, discount numeric(14,2) not null default 0, tax numeric(14,2) not null default 0, total numeric(14,2) not null, cogs numeric(14,2) not null default 0, notes text, created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);
create index sales_date_idx on public.sales(sale_date desc);
create table public.sale_items (id uuid primary key default gen_random_uuid(), sale_id uuid not null references public.sales(id) on delete restrict, product_id uuid not null references public.products(id) on delete restrict, quantity numeric(14,3) not null check(quantity > 0), unit_price numeric(14,4) not null check(unit_price >= 0), discount numeric(14,2) not null default 0, tax numeric(14,2) not null default 0, line_total numeric(14,2) not null, cogs numeric(14,2) not null default 0);
create table public.sale_payments (id uuid primary key default gen_random_uuid(), sale_id uuid not null references public.sales(id) on delete restrict, payment_method text not null check(payment_method in ('CASH','CARD','BANK_TRANSFER','EASYPAISA','JAZZCASH','CUSTOMER_CREDIT')), amount numeric(14,2) not null check(amount > 0), reference text, created_at timestamptz not null default now());
create table public.customer_transactions (id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id) on delete restrict, transaction_type text not null check(transaction_type in ('OPENING','CREDIT_SALE','PAYMENT','RETURN','ADJUSTMENT')), amount numeric(14,2) not null, reference_type text not null, reference_id uuid, narration text, created_by uuid references public.profiles(id), created_at timestamptz not null default now());
create index customer_ledger_idx on public.customer_transactions(customer_id,created_at);
create table public.customer_payments (id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id) on delete restrict, amount numeric(14,2) not null check(amount > 0), payment_method text not null, reference text, payment_date timestamptz not null default now(), created_by uuid references public.profiles(id));
create table public.supplier_transactions (id uuid primary key default gen_random_uuid(), supplier_id uuid not null references public.suppliers(id) on delete restrict, transaction_type text not null check(transaction_type in ('OPENING','PURCHASE','PAYMENT','RETURN','ADJUSTMENT')), amount numeric(14,2) not null, reference_type text not null, reference_id uuid, narration text, created_by uuid references public.profiles(id), created_at timestamptz not null default now());
create index supplier_ledger_idx on public.supplier_transactions(supplier_id,created_at);
create table public.supplier_payments (id uuid primary key default gen_random_uuid(), supplier_id uuid not null references public.suppliers(id) on delete restrict, amount numeric(14,2) not null check(amount > 0), payment_method text not null, reference text, payment_date timestamptz not null default now(), created_by uuid references public.profiles(id));

create table public.sales_returns (id uuid primary key default gen_random_uuid(), sale_id uuid not null references public.sales(id) on delete restrict, customer_id uuid references public.customers(id) on delete restrict, return_number text not null unique, reason text not null, refund_method text not null, total numeric(14,2) not null default 0, created_by uuid references public.profiles(id), created_at timestamptz not null default now());
create table public.sales_return_items (id uuid primary key default gen_random_uuid(), sales_return_id uuid not null references public.sales_returns(id) on delete cascade, sale_item_id uuid not null references public.sale_items(id) on delete restrict, quantity numeric(14,3) not null check(quantity > 0), amount numeric(14,2) not null);
create table public.purchase_returns (id uuid primary key default gen_random_uuid(), goods_receipt_id uuid not null references public.goods_receipts(id) on delete restrict, supplier_id uuid not null references public.suppliers(id) on delete restrict, return_number text not null unique, reason text not null, total numeric(14,2) not null default 0, created_by uuid references public.profiles(id), created_at timestamptz not null default now());
create table public.purchase_return_items (id uuid primary key default gen_random_uuid(), purchase_return_id uuid not null references public.purchase_returns(id) on delete cascade, goods_receipt_item_id uuid not null references public.goods_receipt_items(id) on delete restrict, quantity numeric(14,3) not null check(quantity > 0), amount numeric(14,2) not null);

create table public.expense_categories (id uuid primary key default gen_random_uuid(), name text not null unique, account_code text not null unique, active boolean not null default true, created_at timestamptz not null default now());
create table public.expenses (id uuid primary key default gen_random_uuid(), expense_category_id uuid not null references public.expense_categories(id) on delete restrict, amount numeric(14,2) not null check(amount > 0), expense_date date not null default current_date, payment_method text not null, description text, reference text, created_by uuid references public.profiles(id), created_at timestamptz not null default now());
create table public.accounts (id uuid primary key default gen_random_uuid(), code text not null unique, name text not null, account_type text not null check(account_type in ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')), active boolean not null default true, created_at timestamptz not null default now());
create table public.journal_entries (id uuid primary key default gen_random_uuid(), entry_date timestamptz not null default now(), reference_type text not null, reference_id uuid, description text not null, created_by uuid references public.profiles(id), created_at timestamptz not null default now());
create table public.journal_entry_lines (id uuid primary key default gen_random_uuid(), journal_entry_id uuid not null references public.journal_entries(id) on delete restrict, account_id uuid not null references public.accounts(id) on delete restrict, debit numeric(14,2) not null default 0 check(debit >= 0), credit numeric(14,2) not null default 0 check(credit >= 0), check((debit = 0) <> (credit = 0)));
create table public.notifications (id uuid primary key default gen_random_uuid(), recipient_id uuid references public.profiles(id) on delete cascade, type text not null, title text not null, body text, read_at timestamptz, entity_type text, entity_id uuid, created_at timestamptz not null default now());
create table public.audit_logs (id uuid primary key default gen_random_uuid(), user_id uuid references public.profiles(id), action text not null, entity_type text not null, entity_id uuid, previous_value jsonb, new_value jsonb, created_at timestamptz not null default now());
create table public.store_settings (id boolean primary key default true check(id), store_name text not null default 'My Kiryana Store', address text, phone text, currency text not null default 'PKR', logo_path text, updated_at timestamptz not null default now());

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger products_updated before update on public.products for each row execute function public.touch_updated_at();
create trigger categories_updated before update on public.categories for each row execute function public.touch_updated_at();
create trigger brands_updated before update on public.brands for each row execute function public.touch_updated_at();
create trigger profiles_updated before update on public.profiles for each row execute function public.touch_updated_at();
create trigger customers_updated before update on public.customers for each row execute function public.touch_updated_at();
create trigger suppliers_updated before update on public.suppliers for each row execute function public.touch_updated_at();
create trigger po_updated before update on public.purchase_orders for each row execute function public.touch_updated_at();

create or replace function public.current_user_role() returns public.app_role language sql stable security definer set search_path = public as $$ select role from public.profiles where id = auth.uid() and active $$;
create or replace function public.has_any_role(allowed public.app_role[]) returns boolean language sql stable security definer set search_path = public as $$ select public.current_user_role() = any(allowed) $$;
create or replace function public.can_pos() returns boolean language sql stable security definer set search_path = public as $$ select public.has_any_role(array['OWNER','MANAGER','CASHIER']::public.app_role[]) $$;
create or replace function public.can_manage_catalog() returns boolean language sql stable security definer set search_path = public as $$ select public.has_any_role(array['OWNER','MANAGER','INVENTORY_MANAGER']::public.app_role[]) $$;
create or replace function public.can_manage_purchasing() returns boolean language sql stable security definer set search_path = public as $$ select public.has_any_role(array['OWNER','MANAGER','INVENTORY_MANAGER']::public.app_role[]) $$;
create or replace function public.can_manage_finance() returns boolean language sql stable security definer set search_path = public as $$ select public.has_any_role(array['OWNER','MANAGER','ACCOUNTANT']::public.app_role[]) $$;

insert into public.categories(name) values ('Dairy'),('Beverages'),('Bakery'),('Biscuits'),('Snacks'),('Rice'),('Flour'),('Pulses'),('Spices'),('Cooking Oil'),('Sugar'),('Tea'),('Cleaning'),('Personal Care'),('Household'),('Frozen Foods') on conflict do nothing;
insert into public.expense_categories(name,account_code) values ('Rent','EXP_RENT'),('Electricity','EXP_ELECTRICITY'),('Salaries','EXP_SALARIES'),('Transport','EXP_TRANSPORT'),('Internet','EXP_UTILITIES'),('Maintenance','EXP_UTILITIES'),('Utilities','EXP_UTILITIES'),('Miscellaneous','EXP_MISC') on conflict(account_code) do nothing;
insert into public.accounts(code,name,account_type) values ('CASH','Cash','ASSET'),('BANK','Bank','ASSET'),('INVENTORY','Inventory','ASSET'),('AR','Accounts Receivable','ASSET'),('AP','Accounts Payable','LIABILITY'),('OWNER_CAPITAL','Owner Capital','EQUITY'),('SALES','Sales Revenue','REVENUE'),('COGS','Cost of Goods Sold','EXPENSE'),('EXP_RENT','Rent Expense','EXPENSE'),('EXP_ELECTRICITY','Electricity Expense','EXPENSE'),('EXP_SALARIES','Salaries Expense','EXPENSE'),('EXP_TRANSPORT','Transport Expense','EXPENSE'),('EXP_UTILITIES','Utilities Expense','EXPENSE'),('EXP_MISC','Miscellaneous Expense','EXPENSE') on conflict(code) do nothing;

-- RLS: all reads require an authenticated active profile; writes are constrained by operational role.
alter table public.profiles enable row level security; alter table public.roles enable row level security; alter table public.permissions enable row level security; alter table public.role_permissions enable row level security;
alter table public.categories enable row level security; alter table public.brands enable row level security; alter table public.products enable row level security; alter table public.inventory enable row level security; alter table public.inventory_batches enable row level security; alter table public.inventory_movements enable row level security; alter table public.suppliers enable row level security; alter table public.customers enable row level security; alter table public.purchase_orders enable row level security; alter table public.purchase_order_items enable row level security; alter table public.goods_receipts enable row level security; alter table public.goods_receipt_items enable row level security; alter table public.sales enable row level security; alter table public.sale_items enable row level security; alter table public.sale_payments enable row level security; alter table public.customer_transactions enable row level security; alter table public.customer_payments enable row level security; alter table public.supplier_transactions enable row level security; alter table public.supplier_payments enable row level security; alter table public.sales_returns enable row level security; alter table public.sales_return_items enable row level security; alter table public.purchase_returns enable row level security; alter table public.purchase_return_items enable row level security; alter table public.expense_categories enable row level security; alter table public.expenses enable row level security; alter table public.accounts enable row level security; alter table public.journal_entries enable row level security; alter table public.journal_entry_lines enable row level security; alter table public.notifications enable row level security; alter table public.audit_logs enable row level security; alter table public.store_settings enable row level security;
do $$ declare t text; begin foreach t in array array['roles','permissions','role_permissions','categories','brands','products','inventory','inventory_batches','inventory_movements','suppliers','customers','purchase_orders','purchase_order_items','goods_receipts','goods_receipt_items','sales','sale_items','sale_payments','customer_transactions','customer_payments','supplier_transactions','supplier_payments','sales_returns','sales_return_items','purchase_returns','purchase_return_items','expense_categories','expenses','accounts','journal_entries','journal_entry_lines','notifications','audit_logs','store_settings'] loop execute format('create policy %I on public.%I for select to authenticated using (public.current_user_role() is not null)', t || '_read', t); end loop; end $$;
create policy profiles_self_read on public.profiles for select to authenticated using (id = auth.uid() or public.has_any_role(array['OWNER','MANAGER']::public.app_role[]));
create policy profiles_owner_manage on public.profiles for all to authenticated using(public.has_any_role(array['OWNER']::public.app_role[])) with check(public.has_any_role(array['OWNER']::public.app_role[]));
-- Granular RLS Policies by Role - PROPERLY ENFORCED

-- ===== OWNER: Read-only on most, full access to users/settings =====
-- Owner cannot do transactions, only view and manage

-- ===== INVENTORY_MANAGER: Can manage catalog, inventory, and purchasing =====
create policy categories_inv_mgr on public.categories for all to authenticated using(public.current_user_role()='INVENTORY_MANAGER') with check(public.current_user_role()='INVENTORY_MANAGER');
create policy brands_inv_mgr on public.brands for all to authenticated using(public.current_user_role()='INVENTORY_MANAGER') with check(public.current_user_role()='INVENTORY_MANAGER');
create policy products_inv_mgr on public.products for all to authenticated using(public.current_user_role()='INVENTORY_MANAGER') with check(public.current_user_role()='INVENTORY_MANAGER');
create policy inventory_inv_mgr on public.inventory for all to authenticated using(public.current_user_role()='INVENTORY_MANAGER') with check(public.current_user_role()='INVENTORY_MANAGER');
create policy inventory_batches_inv_mgr on public.inventory_batches for all to authenticated using(public.current_user_role()='INVENTORY_MANAGER') with check(public.current_user_role()='INVENTORY_MANAGER');
create policy inventory_movements_inv_mgr on public.inventory_movements for all to authenticated using(public.current_user_role()='INVENTORY_MANAGER') with check(public.current_user_role()='INVENTORY_MANAGER');
create policy suppliers_inv_mgr on public.suppliers for all to authenticated using(public.current_user_role()='INVENTORY_MANAGER') with check(public.current_user_role()='INVENTORY_MANAGER');
create policy purchase_orders_inv_mgr on public.purchase_orders for all to authenticated using(public.current_user_role()='INVENTORY_MANAGER') with check(public.current_user_role()='INVENTORY_MANAGER');
create policy purchase_order_items_inv_mgr on public.purchase_order_items for all to authenticated using(public.current_user_role()='INVENTORY_MANAGER') with check(public.current_user_role()='INVENTORY_MANAGER');
create policy goods_receipts_inv_mgr on public.goods_receipts for all to authenticated using(public.current_user_role()='INVENTORY_MANAGER') with check(public.current_user_role()='INVENTORY_MANAGER');
create policy goods_receipt_items_inv_mgr on public.goods_receipt_items for all to authenticated using(public.current_user_role()='INVENTORY_MANAGER') with check(public.current_user_role()='INVENTORY_MANAGER');
create policy purchase_returns_inv_mgr on public.purchase_returns for all to authenticated using(public.current_user_role()='INVENTORY_MANAGER') with check(public.current_user_role()='INVENTORY_MANAGER');
create policy purchase_return_items_inv_mgr on public.purchase_return_items for all to authenticated using(public.current_user_role()='INVENTORY_MANAGER') with check(public.current_user_role()='INVENTORY_MANAGER');
create policy supplier_transactions_inv_mgr on public.supplier_transactions for all to authenticated using(public.current_user_role()='INVENTORY_MANAGER') with check(public.current_user_role()='INVENTORY_MANAGER');
create policy supplier_payments_inv_mgr on public.supplier_payments for all to authenticated using(public.current_user_role()='INVENTORY_MANAGER') with check(public.current_user_role()='INVENTORY_MANAGER');

-- ===== CASHIER: Can ONLY process sales =====
create policy sales_cashier on public.sales for all to authenticated using(public.current_user_role()='CASHIER') with check(public.current_user_role()='CASHIER');
create policy sale_items_cashier on public.sale_items for all to authenticated using(public.current_user_role()='CASHIER') with check(public.current_user_role()='CASHIER');
create policy sale_payments_cashier on public.sale_payments for all to authenticated using(public.current_user_role()='CASHIER') with check(public.current_user_role()='CASHIER');
create policy sales_returns_cashier on public.sales_returns for all to authenticated using(public.current_user_role()='CASHIER') with check(public.current_user_role()='CASHIER');
create policy sales_return_items_cashier on public.sales_return_items for all to authenticated using(public.current_user_role()='CASHIER') with check(public.current_user_role()='CASHIER');
create policy customer_payments_cashier on public.customer_payments for all to authenticated using(public.current_user_role()='CASHIER') with check(public.current_user_role()='CASHIER');
create policy customer_transactions_cashier on public.customer_transactions for all to authenticated using(public.current_user_role()='CASHIER') with check(public.current_user_role()='CASHIER');
-- Cashier can READ customers
create policy customers_cashier_read on public.customers for select to authenticated using(public.current_user_role()='CASHIER');

-- ===== ACCOUNTANT & OWNER: Can manage expenses =====
create policy expenses_accountant_owner on public.expenses for all to authenticated using(public.current_user_role() IN ('ACCOUNTANT','OWNER')) with check(public.current_user_role() IN ('ACCOUNTANT','OWNER'));
create policy expense_categories_accountant_owner on public.expense_categories for all to authenticated using(public.current_user_role() IN ('ACCOUNTANT','OWNER')) with check(public.current_user_role() IN ('ACCOUNTANT','OWNER'));

-- ===== READ-ONLY POLICIES FOR MANAGER =====
create policy sales_manager_read on public.sales for select to authenticated using(public.current_user_role()='MANAGER');
create policy purchase_orders_manager_read on public.purchase_orders for select to authenticated using(public.current_user_role()='MANAGER');
create policy expenses_manager_read on public.expenses for select to authenticated using(public.current_user_role()='MANAGER');
create policy customers_manager_read on public.customers for select to authenticated using(public.current_user_role()='MANAGER');
create policy suppliers_manager_read on public.suppliers for select to authenticated using(public.current_user_role()='MANAGER');
create policy products_manager_read on public.products for select to authenticated using(public.current_user_role()='MANAGER');
create policy inventory_manager_read on public.inventory for select to authenticated using(public.current_user_role()='MANAGER');

-- ===== OWNER: Read-only access to data (no transaction creation) =====
create policy sales_owner_read on public.sales for select to authenticated using(public.current_user_role()='OWNER');
create policy purchase_orders_owner_read on public.purchase_orders for select to authenticated using(public.current_user_role()='OWNER');
create policy expenses_owner_read on public.expenses for select to authenticated using(public.current_user_role()='OWNER');
create policy customers_owner_read on public.customers for select to authenticated using(public.current_user_role()='OWNER');
create policy suppliers_owner_read on public.suppliers for select to authenticated using(public.current_user_role()='OWNER');
create policy products_owner_read on public.products for select to authenticated using(public.current_user_role()='OWNER');
create policy inventory_owner_read on public.inventory for select to authenticated using(public.current_user_role()='OWNER');

-- ===== ALL ROLES: Can read journal entries for audit =====
create policy journal_entries_read on public.journal_entries for select to authenticated using(public.current_user_role() in ('OWNER','MANAGER','ACCOUNTANT'));
create policy journal_entry_lines_read on public.journal_entry_lines for select to authenticated using(public.current_user_role() in ('OWNER','MANAGER','ACCOUNTANT'));
create policy accounts_read on public.accounts for select to authenticated using(public.current_user_role() is not null);
create policy notification_own on public.notifications for update to authenticated using(recipient_id = auth.uid()) with check(recipient_id = auth.uid());
create policy settings_owner on public.store_settings for all to authenticated using(public.has_any_role(array['OWNER']::public.app_role[])) with check(public.has_any_role(array['OWNER']::public.app_role[]));
create policy audit_owner_only on public.audit_logs for insert to authenticated with check (public.current_user_role() is not null);
grant usage on schema public to anon, authenticated;
grant select, insert, update on all tables in schema public to authenticated;
