-- Migration: Fix OWNER and MANAGER permissions on inventory tables
-- Problem: OWNER only has SELECT on inventory, so when receiving goods,
-- the batch is created but inventory.quantity stays at 0.
-- The receiveGoods client code silently fails on inventory update.

-- Add INSERT/UPDATE/DELETE for OWNER on inventory tables
CREATE POLICY inventory_owner_manage ON public.inventory
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'OWNER')
  WITH CHECK (public.current_user_role() = 'OWNER');

CREATE POLICY inventory_batches_owner_manage ON public.inventory_batches
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'OWNER')
  WITH CHECK (public.current_user_role() = 'OWNER');

CREATE POLICY inventory_movements_owner_manage ON public.inventory_movements
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'OWNER')
  WITH CHECK (public.current_user_role() = 'OWNER');

-- Add INSERT/UPDATE/DELETE for MANAGER on inventory tables
CREATE POLICY inventory_manager_manage ON public.inventory
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'MANAGER')
  WITH CHECK (public.current_user_role() = 'MANAGER');

CREATE POLICY inventory_batches_manager_manage ON public.inventory_batches
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'MANAGER')
  WITH CHECK (public.current_user_role() = 'MANAGER');

CREATE POLICY inventory_movements_manager_manage ON public.inventory_movements
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'MANAGER')
  WITH CHECK (public.current_user_role() = 'MANAGER');
