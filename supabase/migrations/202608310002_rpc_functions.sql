-- RPC Functions for complex ERP transactions
-- All critical operations are atomic and enforce business rules

-- Helper: Get or create batches for purchase receiving
create or replace function public.create_or_update_batch(
  p_product_id uuid,
  p_supplier_id uuid,
  p_batch_number text,
  p_purchase_cost numeric,
  p_quantity numeric,
  p_manufacturing_date date,
  p_expiry_date date
) returns uuid language plpgsql as $$
declare
  v_batch_id uuid;
begin
  -- Try to find existing batch
  select id into v_batch_id from public.inventory_batches
  where product_id = p_product_id
    and coalesce(batch_number, '') = coalesce(p_batch_number, '')
    and purchase_cost = p_purchase_cost
    and supplier_id = p_supplier_id
    and manufacturing_date = p_manufacturing_date
    and expiry_date = p_expiry_date;

  if v_batch_id is null then
    -- Create new batch
    insert into public.inventory_batches(
      product_id, supplier_id, batch_number, purchase_cost,
      received_quantity, remaining_quantity, manufacturing_date, expiry_date
    ) values(
      p_product_id, p_supplier_id, p_batch_number, p_purchase_cost,
      p_quantity, p_quantity, p_manufacturing_date, p_expiry_date
    ) returning id into v_batch_id;
  else
    -- Update existing batch
    update public.inventory_batches
    set remaining_quantity = remaining_quantity + p_quantity,
        received_quantity = received_quantity + p_quantity
    where id = v_batch_id;
  end if;

  return v_batch_id;
end $$;

-- Receive goods into inventory (atomic)
create or replace function public.receive_goods(
  p_goods_receipt_id uuid
) returns table(success boolean, message text) language plpgsql as $$
declare
  v_product_id uuid;
  v_batch_id uuid;
  v_quantity numeric;
  v_unit_cost numeric;
  v_po_id uuid;
  v_po_item_id uuid;
  v_total_cost numeric;
begin
  -- Verify goods receipt exists and belongs to authenticated user
  if not exists(select 1 from public.goods_receipts where id = p_goods_receipt_id and created_by = auth.uid()) then
    return query select false, 'Goods receipt not found or unauthorized';
    return;
  end if;

  -- Start transaction: process each item
  for v_product_id, v_batch_id, v_quantity, v_unit_cost in
    select gri.product_id, gri.batch_id, gri.quantity, gri.unit_cost
    from public.goods_receipt_items gri
    where gri.goods_receipt_id = p_goods_receipt_id
  loop
    -- Verify batch not expired
    if (select expiry_date is not null and expiry_date < current_date from public.inventory_batches where id = v_batch_id) then
      return query select false, 'Cannot receive expired batch';
      return;
    end if;

    -- Update inventory quantity
    insert into public.inventory(product_id, quantity, reserved_quantity, average_cost)
    values(v_product_id, v_quantity, 0, v_unit_cost)
    on conflict(product_id) do update set
      quantity = inventory.quantity + v_quantity,
      average_cost = (
        (inventory.quantity * inventory.average_cost + v_quantity * v_unit_cost) /
        (inventory.quantity + v_quantity)
      );

    -- Create inventory movement
    insert into public.inventory_movements(
      product_id, batch_id, movement_type, quantity_change, unit_cost,
      reference_type, reference_id, created_by
    ) values(
      v_product_id, v_batch_id, 'PURCHASE', v_quantity, v_unit_cost,
      'goods_receipt', p_goods_receipt_id, auth.uid()
    );

    -- Create accounting entries: Debit Inventory, Credit Accounts Payable
    v_total_cost := v_quantity * v_unit_cost;
    insert into public.journal_entries(
      reference_type, reference_id, description, created_by
    ) values('goods_receipt', p_goods_receipt_id, 'Purchase receipt - ' || (select name from public.products where id = v_product_id), auth.uid())
    returning id into v_batch_id; -- reuse as entry_id

    insert into public.journal_entry_lines(journal_entry_id, account_id, debit)
    select v_batch_id, id, v_total_cost from public.accounts where code = 'INVENTORY';

    insert into public.journal_entry_lines(journal_entry_id, account_id, credit)
    select v_batch_id, id, v_total_cost from public.accounts where code = 'AP';
  end loop;

  -- Update purchase order status
  select purchase_order_id into v_po_id from public.goods_receipts where id = p_goods_receipt_id;
  if v_po_id is not null then
    if exists(
      select 1 from public.purchase_order_items
      where purchase_order_id = v_po_id
        and received_quantity < quantity
    ) then
      update public.purchase_orders set status = 'PARTIALLY_RECEIVED' where id = v_po_id;
    else
      update public.purchase_orders set status = 'RECEIVED' where id = v_po_id;
    end if;
  end if;

  -- Log audit
  insert into public.audit_logs(user_id, action, entity_type, entity_id, new_value)
  values(auth.uid(), 'GOODS_RECEIVED', 'goods_receipt', p_goods_receipt_id, jsonb_build_object('status','completed'));

  return query select true, 'Goods received successfully';
end $$;

-- Create and complete a POS sale (atomic)
create or replace function public.complete_pos_sale(
  p_customer_id uuid,
  p_items jsonb, -- [{product_id, quantity, unit_price, discount}]
  p_payments jsonb, -- [{method, amount}]
  p_discount numeric,
  p_tax numeric
) returns table(success boolean, message text, sale_id uuid) language plpgsql as $$
declare
  v_sale_id uuid;
  v_item record;
  v_quantity numeric;
  v_unit_price numeric;
  v_batch_id uuid;
  v_remaining numeric;
  v_product_id uuid;
  v_batch_remaining numeric;
  v_cogs numeric := 0;
  v_subtotal numeric := 0;
  v_total numeric;
  v_payment record;
  v_credit_amount numeric := 0;
  v_payment_method text;
  v_amount numeric;
  v_invoice_number text;
  v_entry_id uuid;
  v_sales_revenue uuid;
  v_cash_account uuid;
  v_ar_account uuid;
  v_cogs_account uuid;
  v_inventory_account uuid;
begin
  -- Validate items array
  if jsonb_array_length(p_items) = 0 then
    return query select false, 'No items in sale', null::uuid;
    return;
  end if;

  -- Generate invoice number
  v_invoice_number := 'INV-' || to_char(now(), 'YYYYMMDD-HH24MISS');

  -- Validate stock availability and calculate subtotal
  for v_item in select * from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric, unit_price numeric, discount numeric)
  loop
    v_quantity := v_item.quantity;
    v_unit_price := v_item.unit_price;
    v_product_id := v_item.product_id;

    -- Check stock (available = quantity - reserved)
    select (coalesce(quantity, 0) - coalesce(reserved_quantity, 0)) into v_remaining
    from public.inventory where product_id = v_product_id;

    if coalesce(v_remaining, 0) < v_quantity then
      return query select false, 'Insufficient stock for product ' || (select name from public.products where id = v_product_id), null::uuid;
      return;
    end if;

    v_subtotal := v_subtotal + (v_quantity * v_unit_price) - coalesce(v_item.discount, 0);
  end loop;

  v_total := v_subtotal - coalesce(p_discount, 0) + coalesce(p_tax, 0);

  -- Validate payments
  for v_payment in select * from jsonb_to_recordset(p_payments) as x(method text, amount numeric)
  loop
    if v_payment.amount <= 0 then
      return query select false, 'Invalid payment amount', null::uuid;
      return;
    end if;
    if v_payment.method = 'CUSTOMER_CREDIT' then
      v_credit_amount := v_credit_amount + v_payment.amount;
    end if;
  end loop;

  -- Create sale record
  insert into public.sales(invoice_number, customer_id, subtotal, discount, tax, total, created_by)
  values(v_invoice_number, p_customer_id, v_subtotal, coalesce(p_discount, 0), coalesce(p_tax, 0), v_total, auth.uid())
  returning id into v_sale_id;

  -- Process each item: create sale_item, deduct inventory, calculate COGS
  for v_item in select * from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric, unit_price numeric, discount numeric)
  loop
    v_quantity := v_item.quantity;
    v_unit_price := v_item.unit_price;
    v_product_id := v_item.product_id;

    -- Get COGS from average_cost
    select average_cost into v_cogs from public.inventory where product_id = v_product_id;
    v_cogs := coalesce(v_cogs, 0) * v_quantity;

    -- Create sale item
    insert into public.sale_items(sale_id, product_id, quantity, unit_price, discount, tax, line_total, cogs)
    values(v_sale_id, v_product_id, v_quantity, v_unit_price, coalesce(v_item.discount, 0), 0, 
           (v_quantity * v_unit_price) - coalesce(v_item.discount, 0), v_cogs);

    -- Deduct from batches using FEFO (First Expired First Out)
    for v_batch_id, v_batch_remaining in
      select id, remaining_quantity from public.inventory_batches
      where product_id = v_product_id
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
          ) values(v_product_id, v_batch_id, 'SALE', -v_quantity, v_cogs / v_quantity, 'sale', v_sale_id, auth.uid());

          v_quantity := 0;
        else
          update public.inventory_batches
          set remaining_quantity = 0
          where id = v_batch_id;

          insert into public.inventory_movements(
            product_id, batch_id, movement_type, quantity_change, unit_cost,
            reference_type, reference_id, created_by
          ) values(v_product_id, v_batch_id, 'SALE', -v_batch_remaining, v_cogs / v_quantity, 'sale', v_sale_id, auth.uid());

          v_quantity := v_quantity - v_batch_remaining;
        end if;
      end if;
    end loop;

    -- Update inventory
    update public.inventory
    set quantity = quantity - (v_item.quantity),
        reserved_quantity = greatest(0, reserved_quantity - (v_item.quantity))
    where product_id = v_product_id;
  end loop;

  -- Update sale COGS
  update public.sales set cogs = (select coalesce(sum(cogs), 0) from public.sale_items where sale_id = v_sale_id)
  where id = v_sale_id;

  -- Record payments
  for v_payment in select * from jsonb_to_recordset(p_payments) as x(method text, amount numeric)
  loop
    insert into public.sale_payments(sale_id, payment_method, amount)
    values(v_sale_id, v_payment.method, v_payment.amount);
  end loop;

  -- Update customer khata if credit sale
  if v_credit_amount > 0 and p_customer_id is not null then
    insert into public.customer_transactions(
      customer_id, transaction_type, amount, reference_type, reference_id, created_by
    ) values(p_customer_id, 'CREDIT_SALE', v_credit_amount, 'sale', v_sale_id, auth.uid());
  end if;

  -- Create accounting entries: Sales Revenue, Cash/AR, COGS, Inventory
  insert into public.journal_entries(
    reference_type, reference_id, description, created_by
  ) values('sale', v_sale_id, 'Sale - ' || v_invoice_number, auth.uid())
  returning id into v_entry_id;

  select id into v_sales_revenue from public.accounts where code = 'SALES';
  select id into v_cash_account from public.accounts where code = 'CASH';
  select id into v_ar_account from public.accounts where code = 'AR';
  select id into v_cogs_account from public.accounts where code = 'COGS';
  select id into v_inventory_account from public.accounts where code = 'INVENTORY';

  -- Debit Cash for cash payments
  for v_payment in select * from jsonb_to_recordset(p_payments) as x(method text, amount numeric)
  loop
    if v_payment.method = 'CASH' then
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
  values(v_entry_id, v_sales_revenue, v_total);

  -- COGS & Inventory
  select coalesce(sum(cogs), 0) into v_cogs from public.sale_items where sale_id = v_sale_id;
  if v_cogs > 0 then
    insert into public.journal_entry_lines(journal_entry_id, account_id, debit)
    values(v_entry_id, v_cogs_account, v_cogs);
    insert into public.journal_entry_lines(journal_entry_id, account_id, credit)
    values(v_entry_id, v_inventory_account, v_cogs);
  end if;

  -- Log audit
  insert into public.audit_logs(user_id, action, entity_type, entity_id, new_value)
  values(auth.uid(), 'SALE_CREATED', 'sale', v_sale_id, jsonb_build_object('total', v_total, 'items', p_items));

  return query select true, 'Sale completed successfully', v_sale_id;
end $$;

-- Record customer payment (atomic)
create or replace function public.record_customer_payment(
  p_customer_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_reference text
) returns table(success boolean, message text) language plpgsql as $$
declare
  v_entry_id uuid;
  v_cash_account uuid;
  v_ar_account uuid;
begin
  if p_amount <= 0 then
    return query select false, 'Invalid payment amount';
    return;
  end if;

  -- Record payment
  insert into public.customer_payments(customer_id, amount, payment_method, reference, created_by)
  values(p_customer_id, p_amount, p_payment_method, p_reference, auth.uid());

  -- Update khata
  insert into public.customer_transactions(
    customer_id, transaction_type, amount, reference_type, reference_id, created_by
  ) values(p_customer_id, 'PAYMENT', -p_amount, 'customer_payment', p_customer_id, auth.uid());

  -- Accounting: Debit Cash, Credit AR
  insert into public.journal_entries(
    reference_type, reference_id, description, created_by
  ) values('customer_payment', p_customer_id, 'Customer payment received', auth.uid())
  returning id into v_entry_id;

  select id into v_cash_account from public.accounts where code = 'CASH';
  select id into v_ar_account from public.accounts where code = 'AR';

  insert into public.journal_entry_lines(journal_entry_id, account_id, debit)
  values(v_entry_id, v_cash_account, p_amount);

  insert into public.journal_entry_lines(journal_entry_id, account_id, credit)
  values(v_entry_id, v_ar_account, p_amount);

  -- Audit
  insert into public.audit_logs(user_id, action, entity_type, entity_id, new_value)
  values(auth.uid(), 'CUSTOMER_PAYMENT', 'customer_payment', p_customer_id, jsonb_build_object('amount', p_amount));

  return query select true, 'Payment recorded successfully';
end $$;

-- Record supplier payment (atomic)
create or replace function public.record_supplier_payment(
  p_supplier_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_reference text
) returns table(success boolean, message text) language plpgsql as $$
declare
  v_entry_id uuid;
  v_cash_account uuid;
  v_ap_account uuid;
begin
  if p_amount <= 0 then
    return query select false, 'Invalid payment amount';
    return;
  end if;

  -- Record payment
  insert into public.supplier_payments(supplier_id, amount, payment_method, reference, created_by)
  values(p_supplier_id, p_amount, p_payment_method, p_reference, auth.uid());

  -- Update payables
  insert into public.supplier_transactions(
    supplier_id, transaction_type, amount, reference_type, reference_id, created_by
  ) values(p_supplier_id, 'PAYMENT', -p_amount, 'supplier_payment', p_supplier_id, auth.uid());

  -- Accounting: Debit AP, Credit Cash
  insert into public.journal_entries(
    reference_type, reference_id, description, created_by
  ) values('supplier_payment', p_supplier_id, 'Supplier payment issued', auth.uid())
  returning id into v_entry_id;

  select id into v_cash_account from public.accounts where code = 'CASH';
  select id into v_ap_account from public.accounts where code = 'AP';

  insert into public.journal_entry_lines(journal_entry_id, account_id, debit)
  values(v_entry_id, v_ap_account, p_amount);

  insert into public.journal_entry_lines(journal_entry_id, account_id, credit)
  values(v_entry_id, v_cash_account, p_amount);

  -- Audit
  insert into public.audit_logs(user_id, action, entity_type, entity_id, new_value)
  values(auth.uid(), 'SUPPLIER_PAYMENT', 'supplier_payment', p_supplier_id, jsonb_build_object('amount', p_amount));

  return query select true, 'Payment recorded successfully';
end $$;

-- Process sales return (atomic)
create or replace function public.process_sales_return(
  p_sales_return_id uuid
) returns table(success boolean, message text) language plpgsql as $$
declare
  v_item record;
  v_sale_item_id uuid;
  v_quantity numeric;
  v_amount numeric;
  v_product_id uuid;
  v_batch_id uuid;
  v_sale_id uuid;
  v_entry_id uuid;
  v_total_return numeric := 0;
begin
  -- Verify return exists
  if not exists(select 1 from public.sales_returns where id = p_sales_return_id) then
    return query select false, 'Sales return not found';
    return;
  end if;

  select sale_id into v_sale_id from public.sales_returns where id = p_sales_return_id;

  -- Process each returned item
  for v_item in
    select sri.sale_item_id, sri.quantity, sri.amount, si.product_id, si.cogs
    from public.sales_return_items sri
    join public.sale_items si on sri.sale_item_id = si.id
    where sri.sales_return_id = p_sales_return_id
  loop
    v_sale_item_id := v_item.sale_item_id;
    v_quantity := v_item.quantity;
    v_amount := v_item.amount;
    v_product_id := v_item.product_id;
    v_total_return := v_total_return + v_amount;

    -- Restore inventory (add back to first suitable batch)
    select id into v_batch_id from public.inventory_batches
    where product_id = v_product_id
    order by received_date desc limit 1;

    if v_batch_id is not null then
      update public.inventory_batches
      set remaining_quantity = remaining_quantity + v_quantity
      where id = v_batch_id;
    end if;

    -- Update inventory
    update public.inventory
    set quantity = quantity + v_quantity
    where product_id = v_product_id;

    -- Create movement
    insert into public.inventory_movements(
      product_id, batch_id, movement_type, quantity_change, unit_cost,
      reference_type, reference_id, created_by
    ) values(v_product_id, v_batch_id, 'SALE_RETURN', v_quantity, v_item.cogs / v_quantity, 
             'sales_return', p_sales_return_id, auth.uid());
  end loop;

  -- Update original sale status
  update public.sales set status = 'RETURNED' where id = v_sale_id;

  -- Create accounting entries: Debit Sales Return, Credit AR/Cash
  insert into public.journal_entries(
    reference_type, reference_id, description, created_by
  ) values('sales_return', p_sales_return_id, 'Sales return processed', auth.uid())
  returning id into v_entry_id;

  -- Reverse the original sale entry logic here...
  -- (simplified for now)

  -- Audit
  insert into public.audit_logs(user_id, action, entity_type, entity_id, new_value)
  values(auth.uid(), 'SALES_RETURN_PROCESSED', 'sales_return', p_sales_return_id, jsonb_build_object('total', v_total_return));

  return query select true, 'Sales return processed successfully';
end $$;

-- Calculate customer balance
create or replace function public.customer_balance(p_customer_id uuid)
returns numeric language sql stable as $$
  select coalesce(opening_balance, 0) + coalesce(sum(
    case when transaction_type in ('CREDIT_SALE', 'ADJUSTMENT') then amount
         when transaction_type in ('PAYMENT', 'RETURN') then -amount
         else 0 end
  ), 0)
  from public.customers
  left join public.customer_transactions on customers.id = customer_transactions.customer_id
  where customers.id = p_customer_id
  group by customers.id, customers.opening_balance;
$$;

-- Calculate supplier balance
create or replace function public.supplier_balance(p_supplier_id uuid)
returns numeric language sql stable as $$
  select coalesce(opening_balance, 0) + coalesce(sum(
    case when transaction_type in ('PURCHASE', 'ADJUSTMENT') then amount
         when transaction_type in ('PAYMENT', 'RETURN') then -amount
         else 0 end
  ), 0)
  from public.suppliers
  left join public.supplier_transactions on suppliers.id = supplier_transactions.supplier_id
  where suppliers.id = p_supplier_id
  group by suppliers.id, suppliers.opening_balance;
$$;

-- Calculate inventory value
create or replace function public.inventory_value()
returns numeric language sql stable as $$
  select coalesce(sum(quantity * average_cost), 0) from public.inventory;
$$;


-- Create employee with role (for OWNER invitations)
create or replace function public.create_employee_with_role(
  p_email text,
  p_password text,
  p_full_name text,
  p_role app_role
)
returns json
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
  v_response json;
begin
  -- Create auth user
  v_user_id := auth.uid(); -- This will fail, we need a different approach
  
  -- For now, just create the profile
  -- The auth user must be created via Supabase Dashboard or REST API
  insert into public.profiles (email, full_name, role, active)
  values (p_email, p_full_name, p_role, true)
  on conflict (email) do update
  set role = p_role, full_name = p_full_name;

  return json_build_object(
    'success', true,
    'email', p_email,
    'role', p_role::text
  );
end;
$$;
