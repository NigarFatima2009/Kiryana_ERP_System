-- Fix foreign key constraints that prevent profile deletion
-- Set user_id to NULL instead of blocking the delete

-- audit_logs: set user_id to NULL when profile is deleted
ALTER TABLE public.audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey,
  ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- notifications: set recipient_id to NULL when profile is deleted
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_recipient_id_fkey,
  ADD CONSTRAINT notifications_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- inventory_movements: set created_by to NULL when profile is deleted
ALTER TABLE public.inventory_movements
  DROP CONSTRAINT IF EXISTS inventory_movements_created_by_fkey,
  ADD CONSTRAINT inventory_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- sales: set created_by to NULL when profile is deleted
ALTER TABLE public.sales
  DROP CONSTRAINT IF EXISTS sales_created_by_fkey,
  ADD CONSTRAINT sales_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- purchase_orders: set created_by to NULL when profile is deleted
ALTER TABLE public.purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_created_by_fkey,
  ADD CONSTRAINT purchase_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- goods_receipts: set created_by to NULL when profile is deleted
ALTER TABLE public.goods_receipts
  DROP CONSTRAINT IF EXISTS goods_receipts_created_by_fkey,
  ADD CONSTRAINT goods_receipts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- purchase_returns: set created_by to NULL when profile is deleted
ALTER TABLE public.purchase_returns
  DROP CONSTRAINT IF EXISTS purchase_returns_created_by_fkey,
  ADD CONSTRAINT purchase_returns_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- sales_returns: set created_by to NULL when profile is deleted
ALTER TABLE public.sales_returns
  DROP CONSTRAINT IF EXISTS sales_returns_created_by_fkey,
  ADD CONSTRAINT sales_returns_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- customer_transactions: set created_by to NULL when profile is deleted
ALTER TABLE public.customer_transactions
  DROP CONSTRAINT IF EXISTS customer_transactions_created_by_fkey,
  ADD CONSTRAINT customer_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- customer_payments: set created_by to NULL when profile is deleted
ALTER TABLE public.customer_payments
  DROP CONSTRAINT IF EXISTS customer_payments_created_by_fkey,
  ADD CONSTRAINT customer_payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- supplier_transactions: set created_by to NULL when profile is deleted
ALTER TABLE public.supplier_transactions
  DROP CONSTRAINT IF EXISTS supplier_transactions_created_by_fkey,
  ADD CONSTRAINT supplier_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- supplier_payments: set created_by to NULL when profile is deleted
ALTER TABLE public.supplier_payments
  DROP CONSTRAINT IF EXISTS supplier_payments_created_by_fkey,
  ADD CONSTRAINT supplier_payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- expenses: set created_by to NULL when profile is deleted
ALTER TABLE public.expenses
  DROP CONSTRAINT IF EXISTS expenses_created_by_fkey,
  ADD CONSTRAINT expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- journal_entries: set created_by to NULL when profile is deleted
ALTER TABLE public.journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_created_by_fkey,
  ADD CONSTRAINT journal_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
