-- Atomically process an item-level sales return.
-- Keep the original sale immutable for audit purposes; net sales are derived
-- from sales.total minus the linked sales_returns totals.

CREATE OR REPLACE FUNCTION public.create_sales_return(
  p_sale_id uuid,
  p_reason text,
  p_refund_method text,
  p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale record;
  v_sale_item record;
  v_return_id uuid;
  v_return_number text;
  v_requested_item jsonb;
  v_quantity numeric;
  v_previously_returned numeric;
  v_total_line_amount numeric;
  v_item_return_amount numeric;
  v_return_total numeric := 0;
  v_previously_returned_total numeric := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_pos() THEN
    RAISE EXCEPTION 'You do not have permission to process a sales return';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A return reason is required';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Select at least one item to return';
  END IF;

  SELECT id, customer_id, total, status
  INTO v_sale
  FROM public.sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original sale was not found';
  END IF;

  IF v_sale.status IN ('HELD', 'CANCELLED') THEN
    RAISE EXCEPTION 'This sale cannot be returned';
  END IF;

  IF v_sale.status = 'RETURNED' THEN
    RAISE EXCEPTION 'This sale has already been fully returned';
  END IF;

  SELECT COALESCE(SUM(line_total), 0)
  INTO v_total_line_amount
  FROM public.sale_items
  WHERE sale_id = p_sale_id;

  IF v_total_line_amount <= 0 THEN
    RAISE EXCEPTION 'The original sale has no returnable items';
  END IF;

  v_return_number := 'SR-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' || substr(gen_random_uuid()::text, 1, 6);

  INSERT INTO public.sales_returns (
    sale_id, customer_id, return_number, reason, refund_method, total, created_by
  ) VALUES (
    p_sale_id, v_sale.customer_id, v_return_number, btrim(p_reason), p_refund_method, 0, auth.uid()
  )
  RETURNING id INTO v_return_id;

  FOR v_requested_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_quantity := (v_requested_item ->> 'quantity')::numeric;

    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'Return quantities must be greater than zero';
    END IF;

    SELECT id, product_id, quantity, line_total, cogs
    INTO v_sale_item
    FROM public.sale_items
    WHERE id = (v_requested_item ->> 'sale_item_id')::uuid
      AND sale_id = p_sale_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A selected item does not belong to this sale';
    END IF;

    SELECT COALESCE(SUM(sri.quantity), 0)
    INTO v_previously_returned
    FROM public.sales_return_items sri
    JOIN public.sales_returns sr ON sr.id = sri.sales_return_id
    WHERE sri.sale_item_id = v_sale_item.id;

    IF v_quantity > v_sale_item.quantity - v_previously_returned THEN
      RAISE EXCEPTION 'Return quantity exceeds the quantity sold for this item';
    END IF;

    -- Allocate sale-level tax and discounts proportionally, so a full return
    -- always matches the original sale total exactly.
    v_item_return_amount := round(
      v_sale.total * ((v_sale_item.line_total * v_quantity / v_sale_item.quantity) / v_total_line_amount),
      2
    );
    v_return_total := v_return_total + v_item_return_amount;

    INSERT INTO public.sales_return_items (
      sales_return_id, sale_item_id, quantity, amount
    ) VALUES (
      v_return_id, v_sale_item.id, v_quantity, v_item_return_amount
    );

    UPDATE public.inventory
    SET quantity = quantity + v_quantity
    WHERE product_id = v_sale_item.product_id;

    INSERT INTO public.inventory_movements (
      product_id, movement_type, quantity_change, unit_cost,
      reference_type, reference_id, created_by
    ) VALUES (
      v_sale_item.product_id,
      'SALE_RETURN',
      v_quantity,
      CASE WHEN v_sale_item.quantity > 0 THEN v_sale_item.cogs / v_sale_item.quantity ELSE 0 END,
      'SALES_RETURN',
      v_return_id,
      auth.uid()
    );
  END LOOP;

  UPDATE public.sales_returns
  SET total = v_return_total
  WHERE id = v_return_id;

  IF v_sale.customer_id IS NOT NULL AND p_refund_method = 'CUSTOMER_CREDIT' THEN
    INSERT INTO public.customer_transactions (
      customer_id, transaction_type, amount, reference_type, reference_id, narration, created_by
    ) VALUES (
      v_sale.customer_id, 'RETURN', v_return_total, 'SALES_RETURN', v_return_id,
      'Sales return - ' || v_return_number, auth.uid()
    );
  END IF;

  SELECT COALESCE(SUM(total), 0)
  INTO v_previously_returned_total
  FROM public.sales_returns
  WHERE sale_id = p_sale_id;

  UPDATE public.sales
  SET status = CASE WHEN v_previously_returned_total >= v_sale.total - 0.01 THEN 'RETURNED' ELSE 'COMPLETED' END
  WHERE id = p_sale_id;

  RETURN jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'return_number', v_return_number,
    'total', v_return_total,
    'fully_returned', v_previously_returned_total >= v_sale.total - 0.01
  );
END;
$$;

-- Every completed sale belongs to the cashier's active shift, including sales
-- that began offline and are later synced. This avoids ambiguous day-wide
-- fallbacks in the shift screen.
CREATE OR REPLACE FUNCTION public.assign_open_shift_to_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.shift_id IS NULL AND NEW.status IN ('COMPLETED', 'RETURNED') THEN
    SELECT id INTO NEW.shift_id
    FROM public.cashier_shifts
    WHERE user_id = COALESCE(NEW.created_by, auth.uid())
      AND status = 'OPEN'
    ORDER BY opened_at DESC
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_assign_open_shift ON public.sales;
CREATE TRIGGER sales_assign_open_shift
  BEFORE INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.assign_open_shift_to_sale();

-- Repair only incomplete duplicate headers created by the former return form:
-- they did not create return items or stock movements, while a later atomic
-- return for the same sale did. Keep the complete, auditable return instead.
DELETE FROM public.sales_returns orphaned
WHERE NOT EXISTS (
  SELECT 1 FROM public.sales_return_items item
  WHERE item.sales_return_id = orphaned.id
)
AND EXISTS (
  SELECT 1
  FROM public.sales_returns complete_return
  JOIN public.sales_return_items complete_item ON complete_item.sales_return_id = complete_return.id
  WHERE complete_return.sale_id = orphaned.sale_id
);

-- Attach legacy sales from the current open shift for each cashier. This is
-- restricted to sales made after the shift opened and only fills a null link.
UPDATE public.sales sale
SET shift_id = shift.id
FROM public.cashier_shifts shift
WHERE sale.shift_id IS NULL
  AND sale.created_by = shift.user_id
  AND shift.status = 'OPEN'
  AND sale.created_at >= shift.opened_at
  AND sale.status IN ('COMPLETED', 'RETURNED');

GRANT EXECUTE ON FUNCTION public.create_sales_return(uuid, text, text, jsonb) TO authenticated;

-- Closing a shift must use net sales after returns, not the original gross total.
CREATE OR REPLACE FUNCTION public.close_cashier_shift(
  p_shift_id uuid,
  p_closing_cash numeric,
  p_client_time timestamp without time zone DEFAULT NULL
) RETURNS TABLE(
  result_id uuid,
  result_closed_at timestamp without time zone,
  result_opening_cash numeric,
  result_closing_cash numeric,
  result_expected_cash numeric,
  result_variance numeric,
  result_sales_count integer,
  result_total_sales numeric,
  result_status character varying
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open numeric;
  v_total numeric;
  v_count integer;
  v_expected numeric;
  v_variance numeric;
BEGIN
  SELECT opening_cash INTO v_open
  FROM public.cashier_shifts
  WHERE id = p_shift_id
    AND (user_id = auth.uid() OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('OWNER', 'MANAGER'));

  IF v_open IS NULL THEN
    RAISE EXCEPTION 'Shift not found or unauthorized';
  END IF;

  SELECT COALESCE(SUM(GREATEST(0, s.total - COALESCE(r.total, 0))), 0), COUNT(*)
  INTO v_total, v_count
  FROM public.sales s
  LEFT JOIN (
    SELECT sale_id, SUM(total) AS total
    FROM public.sales_returns
    GROUP BY sale_id
  ) r ON r.sale_id = s.id
  WHERE s.shift_id = p_shift_id AND s.status IN ('COMPLETED', 'RETURNED');

  v_expected := v_open + v_total;
  v_variance := v_expected - p_closing_cash;

  UPDATE public.cashier_shifts
  SET closed_at = COALESCE(p_client_time, NOW()),
      closing_cash = p_closing_cash,
      expected_cash = v_expected,
      variance = v_variance,
      status = 'CLOSED',
      updated_at = NOW()
  WHERE id = p_shift_id;

  RETURN QUERY SELECT p_shift_id, COALESCE(p_client_time, NOW()), v_open, p_closing_cash,
    v_expected, v_variance, v_count, v_total, 'CLOSED'::varchar;
END;
$$;
