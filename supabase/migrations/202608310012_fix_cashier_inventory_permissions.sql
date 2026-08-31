-- Migration: Fix CASHIER RLS policies for inventory operations during sales
-- Issue: Cashiers couldn't update inventory or create movements during sales
-- Solution: Add UPDATE and INSERT permissions for inventory and related tables

-- Drop existing read-only policies for CASHIER
DROP POLICY IF EXISTS inventory_cashier ON public.inventory;
DROP POLICY IF EXISTS inventory_batches_cashier ON public.inventory_batches;
DROP POLICY IF EXISTS inventory_movements_cashier ON public.inventory_movements;

-- Create new policies allowing CASHIER to manage inventory during sales

-- INVENTORY: Cashier can SELECT and UPDATE (for sales)
CREATE POLICY inventory_cashier ON public.inventory 
  FOR SELECT TO authenticated 
  USING (public.current_user_role()='CASHIER');

CREATE POLICY inventory_cashier_update ON public.inventory 
  FOR UPDATE TO authenticated 
  USING (public.current_user_role()='CASHIER')
  WITH CHECK (public.current_user_role()='CASHIER');

-- INVENTORY_BATCHES: Cashier can SELECT and UPDATE (to track batch depletion in sales)
CREATE POLICY inventory_batches_cashier ON public.inventory_batches 
  FOR SELECT TO authenticated 
  USING (public.current_user_role()='CASHIER');

CREATE POLICY inventory_batches_cashier_update ON public.inventory_batches 
  FOR UPDATE TO authenticated 
  USING (public.current_user_role()='CASHIER')
  WITH CHECK (public.current_user_role()='CASHIER');

-- INVENTORY_MOVEMENTS: Cashier can INSERT (to log sales movements)
CREATE POLICY inventory_movements_cashier ON public.inventory_movements 
  FOR SELECT TO authenticated 
  USING (public.current_user_role()='CASHIER');

CREATE POLICY inventory_movements_cashier_insert ON public.inventory_movements 
  FOR INSERT TO authenticated 
  WITH CHECK (public.current_user_role()='CASHIER');

-- Also allow SALES_RETURNS operations (which require inventory updates)
CREATE POLICY inventory_movements_cashier_select_all ON public.inventory_movements 
  FOR SELECT TO authenticated 
  USING (public.current_user_role()='CASHIER');
