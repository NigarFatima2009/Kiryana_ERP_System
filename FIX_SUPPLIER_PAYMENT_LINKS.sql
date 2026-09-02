-- ============================================================
-- FIX: Link existing supplier payments to goods receipts
-- Simple approach - just link payments to oldest unlinked receipt
-- ============================================================

-- Step 1: Check current state
SELECT 
  COUNT(*) as total_transactions,
  SUM(CASE WHEN transaction_type = 'PAYMENT' THEN 1 ELSE 0 END) as payment_count,
  SUM(CASE WHEN reference_type = 'PURCHASE' THEN 1 ELSE 0 END) as linked_to_receipts
FROM supplier_transactions;

-- Step 2: Link payments to receipts
BEGIN;

UPDATE supplier_transactions st
SET 
  reference_type = 'PURCHASE',
  reference_id = (
    SELECT gr.id 
    FROM goods_receipts gr 
    WHERE gr.supplier_id = st.supplier_id 
    ORDER BY gr.created_at ASC 
    LIMIT 1
  )
WHERE st.transaction_type = 'PAYMENT'
  AND (st.reference_type IS NULL OR st.reference_type != 'PURCHASE');

COMMIT;

-- Step 3: Verify
SELECT 
  'After fix' as status,
  COUNT(*) as total_transactions,
  SUM(CASE WHEN transaction_type = 'PAYMENT' THEN 1 ELSE 0 END) as payment_count,
  SUM(CASE WHEN reference_type = 'PURCHASE' THEN 1 ELSE 0 END) as linked_to_receipts
FROM supplier_transactions;

-- Step 4: Show payment status per receipt
SELECT 
  gr.receipt_number,
  gr.total,
  COALESCE(SUM(st.amount), 0) as paid_amount,
  gr.total - COALESCE(SUM(st.amount), 0) as outstanding,
  CASE 
    WHEN gr.total - COALESCE(SUM(st.amount), 0) < 0.01 THEN 'PAID'
    WHEN COALESCE(SUM(st.amount), 0) > 0.01 THEN 'PARTIAL'
    ELSE 'UNPAID'
  END as status
FROM goods_receipts gr
LEFT JOIN supplier_transactions st ON 
  st.reference_id = gr.id 
  AND st.reference_type = 'PURCHASE'
  AND st.transaction_type = 'PAYMENT'
GROUP BY gr.id, gr.receipt_number, gr.total
ORDER BY gr.created_at DESC;
