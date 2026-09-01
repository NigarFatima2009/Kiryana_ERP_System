-- Migration: Create the missing create_offline_sale RPC function
-- The offline sync engine (sync.ts) calls supabase.rpc('create_offline_sale', ...)
-- but this function was never created in the database.
-- This causes offline sales to fail silently during sync, meaning
-- inventory_batches gets updated locally but inventory.quantity on the server never gets updated.

-- 1. Add client_transaction_id column to sales table for dedup
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS client_transaction_id uuid;

-- Drop existing function if it exists (may have different signature)
DROP FUNCTION IF EXISTS public.create_offline_sale(uuid, text, uuid, numeric, numeric, numeric, numeric, jsonb, jsonb, text);
DROP FUNCTION IF EXISTS public.create_offline_sale(uuid, uuid, text, uuid, numeric, numeric, numeric, numeric, jsonb, jsonb, text);
DROP FUNCTION IF EXISTS public.create_offline_sale();

-- 2. Create the RPC function
create or replace function public.create_offline_sale(
  p_client_transaction_id uuid,
  p_invoice_number text,
  p_customer_id uuid,
  p_subtotal numeric,
  p_discount numeric,
  p_tax numeric,
  p_total numeric,
  p_items jsonb, -- [{product_id, quantity, unit_price, discount, tax, line_total}]
  p_payment_methods jsonb, -- [{method, amount, reference?}]
  p_notes text
) returns table(sale_id uuid, invoice_number text) language plpgsql as $$
declare
  v_sale_id uuid;
  v_item record;
  v_quantity numeric;
  v_unit_price numeric;
  v_product_id uuid;
  v_batch_id uuid;
  v_batch_remaining numeric;
  v_cogs numeric := 0;
  v_total_cogs numeric := 0;
  v_payment record;
  v_credit_amount numeric := 0;
  v_entry_id uuid;
  v_sales_revenue uuid;
  v_cash_account uuid;
  v_ar_account uuid;
  v_cogs_account uuid;
  v_inventory_account uuid;
  v_invoice_number text;
begin
  -- Validate items
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'No items in sale';
  end if;

  -- Use provided invoice number or generate one
  v_invoice_number := coalesce(p_invoice_number, 'INV-' || to_char(now(), 'YYYYMMDD-HH24MISS'));

  -- Create sale record
  insert into public.sales(
    invoice_number, customer_id, subtotal, discount, tax, total, status, 
    client_transaction_id, notes, created_by
  ) values(
    v_invoice_number, p_customer_id, p_subtotal, 
    coalesce(p_discount, 0), coalesce(p_tax, 0), p_total, 'COMPLETED',
    p_client_transaction_id, p_notes, auth.uid()
  ) returning id into v_sale_id;

  -- Process each item
  for v_item in select * from jsonb_to_recordset(p_items) as x(
    product_id uuid, quantity numeric, unit_price numeric, 
    discount numeric, tax numeric, line_total numeric
  )
  loop
    v_quantity := v_item.quantity;
    v_unit_price := v_item.unit_price;
    v_product_id := v_item.product_id;

    -- Get COGS from average_cost
    select coalesce(average_cost, 0) into v_cogs from public.inventory where product_id = v_product_id;
    v_cogs := v_cogs * v_quantity;
    v_total_cogs := v_total_cogs + v_cogs;

    -- Create sale item
    insert into public.sale_items(
      sale_id, product_id, quantity, unit_price, discount, tax, line_total, cogs
    ) values(
      v_sale_id, v_product_id, v_quantity, v_unit_price, 
      coalesce(v_item.discount, 0), coalesce(v_item.tax, 0), 
      coalesce(v_item.line_total, v_quantity * v_unit_price), v_cogs
    );

    -- Deduct from batches using FEFO (First Expired First Out)
    for v_batch_id, v_batch_remaining in
      select id, remaining_quantity from public.inventory_batches
      where product_id = v_product_id
        and remaining_quantity > 0
        and (expiry_date is null or expiry_date >= current_date)
      order by coalesce(expiry_date, '9999-12-31') asc, received_date asc
    loop
      if v_quantity <= 0 then exit; end if;

      if v_batch_remaining > 0 then
        if v_batch_remaining >= v_quantity then
          update public.inventory_batches
          set remaining_quantity = remaining_quantity - v_quantity
          where id = v_batch_id;

          insert into public.inventory_movements(
            product_id, batch_id, movement_type, quantity_change, unit_cost,
            reference_type, reference_id, created_by
          ) values(v_product_id, v_batch_id, 'SALE', -v_quantity, 
                   case when v_quantity > 0 then v_cogs / v_quantity else 0 end, 
                   'SALE', v_sale_id, auth.uid());

          v_quantity := 0;
        else
          update public.inventory_batches
          set remaining_quantity = 0
          where id = v_batch_id;

          insert into public.inventory_movements(
            product_id, batch_id, movement_type, quantity_change, unit_cost,
            reference_type, reference_id, created_by
          ) values(v_product_id, v_batch_id, 'SALE', -v_batch_remaining, 
                   case when v_quantity > 0 then v_cogs / v_quantity else 0 end, 
                   'SALE', v_sale_id, auth.uid());

          v_quantity := v_quantity - v_batch_remaining;
        end if;
      end if;
    end loop;

    -- ✅ CRITICAL: Update inventory quantity
    update public.inventory
    set quantity = quantity - v_item.quantity,
        reserved_quantity = greatest(0, reserved_quantity - v_item.quantity)
    where product_id = v_product_id;
  end loop;

  -- Update sale COGS
  update public.sales set cogs = v_total_cogs where id = v_sale_id;

  -- Record payments
  for v_payment in select * from jsonb_to_recordset(p_payment_methods) as x(method text, amount numeric, reference text)
  loop
    insert into public.sale_payments(sale_id, payment_method, amount, reference)
    values(v_sale_id, v_payment.method, v_payment.amount, v_payment.reference);
    
    if v_payment.method = 'CUSTOMER_CREDIT' then
      v_credit_amount := v_credit_amount + v_payment.amount;
    end if;
  end loop;

  -- Update customer khata if credit sale
  if v_credit_amount > 0 and p_customer_id is not null then
    insert into public.customer_transactions(
      customer_id, transaction_type, amount, reference_type, reference_id, created_by
    ) values(p_customer_id, 'CREDIT_SALE', v_credit_amount, 'SALE', v_sale_id, auth.uid());
  end if;

  -- Create accounting entries
  insert into public.journal_entries(
    reference_type, reference_id, description, created_by
  ) values('SALE', v_sale_id, 'Offline sale - ' || v_invoice_number, auth.uid())
  returning id into v_entry_id;

  select id into v_sales_revenue from public.accounts where code = 'SALES';
  select id into v_cash_account from public.accounts where code = 'CASH';
  select id into v_ar_account from public.accounts where code = 'AR';
  select id into v_cogs_account from public.accounts where code = 'COGS';
  select id into v_inventory_account from public.accounts where code = 'INVENTORY';

  -- Debit Cash for cash/non-credit payments
  for v_payment in select * from jsonb_to_recordset(p_payment_methods) as x(method text, amount numeric, reference text)
  loop
    if v_payment.method != 'CUSTOMER_CREDIT' then
      insert into public.journal_entry_lines(journal_entry_id, account_id, debit)
      values(v_entry_id, v_cash_account, v_payment.amount);
    end if;
  end loop;

  -- Debit AR for credit sales
  if v_credit_amount > 0 then
    insert into public.journal_entry_lines(journal_entry_id, account_id, debit)
    values(v_entry_id, v_ar_account, v_credit_amount);
  end if;

  -- Credit Sales Revenue
  insert into public.journal_entry_lines(journal_entry_id, account_id, credit)
  values(v_entry_id, v_sales_revenue, p_total);

  -- COGS & Inventory
  if v_total_cogs > 0 then
    insert into public.journal_entry_lines(journal_entry_id, account_id, debit)
    values(v_entry_id, v_cogs_account, v_total_cogs);
    insert into public.journal_entry_lines(journal_entry_id, account_id, credit)
    values(v_entry_id, v_inventory_account, v_total_cogs);
  end if;

  -- Log audit
  insert into public.audit_logs(user_id, action, entity_type, entity_id, new_value)
  values(auth.uid(), 'OFFLINE_SALE_SYNCED', 'sale', v_sale_id, jsonb_build_object(
    'total', p_total, 
    'client_transaction_id', p_client_transaction_id,
    'items_count', jsonb_array_length(p_items)
  ));

  return query select v_sale_id, v_invoice_number;
end $$;

-- Grant execute to authenticated users
grant execute on function public.create_offline_sale to authenticated;
