-- =============================================
-- KIRYANA ERP - SIMPLE SEED DATA
-- Run this AFTER the migration SQL
-- =============================================

-- 1. CATEGORIES (if not already seeded by migration)
INSERT INTO public.categories(name) VALUES 
  ('Dairy'),('Beverages'),('Bakery'),('Biscuits'),('Snacks'),
  ('Rice'),('Flour'),('Pulses'),('Spices'),('Cooking Oil'),
  ('Sugar'),('Tea'),('Cleaning'),('Personal Care'),('Household'),('Frozen Foods')
ON CONFLICT (name) DO NOTHING;

-- 2. EXPENSE CATEGORIES
INSERT INTO public.expense_categories(name, account_code) VALUES 
  ('Rent','EXP_RENT'),('Electricity','EXP_ELECTRICITY'),('Salaries','EXP_SALARIES'),
  ('Transport','EXP_TRANSPORT'),('Internet','EXP_UTILITIES'),('Maintenance','EXP_MAINTENANCE'),
  ('Utilities','EXP_UTILITIES_2'),('Miscellaneous','EXP_MISC')
ON CONFLICT(account_code) DO NOTHING;

-- 3. CHART OF ACCOUNTS
INSERT INTO public.accounts(code,name,account_type) VALUES 
  ('CASH','Cash','ASSET'),('BANK','Bank','ASSET'),('INVENTORY','Inventory','ASSET'),
  ('AR','Accounts Receivable','ASSET'),('AP','Accounts Payable','LIABILITY'),
  ('OWNER_CAPITAL','Owner Capital','EQUITY'),('SALES','Sales Revenue','REVENUE'),
  ('COGS','Cost of Goods Sold','EXPENSE'),('EXP_RENT','Rent Expense','EXPENSE'),
  ('EXP_ELECTRICITY','Electricity Expense','EXPENSE'),('EXP_SALARIES','Salaries Expense','EXPENSE'),
  ('EXP_TRANSPORT','Transport Expense','EXPENSE'),('EXP_MAINTENANCE','Maintenance Expense','EXPENSE'),
  ('EXP_UTILITIES','Utilities Expense','EXPENSE'),('EXP_UTILITIES_2','Utilities 2 Expense','EXPENSE'),
  ('EXP_MISC','Miscellaneous Expense','EXPENSE')
ON CONFLICT(code) DO NOTHING;

-- 4. SUPPLIERS
INSERT INTO public.suppliers (id, name, company, phone, email, address, credit_limit, opening_balance) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'ABC Traders', 'ABC Trading Co.', '0321-1234567', 'abc@traders.com', 'Karachi, Main Market', 500000, 150000),
  ('a1000000-0000-0000-0000-000000000002', 'Fresh Dairy Farms', 'Fresh Farms Ltd.', '0333-9876543', 'info@freshfarms.pk', 'Lahore, Industrial Area', 300000, 75000),
  ('a1000000-0000-0000-0000-000000000003', 'National Foods', 'National Foods Ltd.', '0300-5551234', 'orders@nationalfoods.pk', 'Karachi, SITE', 1000000, 200000),
  ('a1000000-0000-0000-0000-000000000004', 'Punjab Grain Mill', 'PGM Industries', '0312-4448888', 'sales@pgm.pk', 'Faisalabad', 750000, 120000),
  ('a1000000-0000-0000-0000-000000000005', 'Global FMCG', 'Global Consumer Products', '0345-2223344', 'wholesale@globalfmcg.pk', 'Lahore, Cantt', 400000, 50000)
ON CONFLICT (id) DO NOTHING;

-- 5. PRODUCTS (25 realistic grocery items)
INSERT INTO public.products (id, name, sku, barcode, category_id, unit, purchase_price, selling_price, wholesale_price, tax_rate, reorder_level, expiry_tracking) VALUES
  ('b1000000-0000-0000-0000-000000000001', 'Milk 1 Liter', 'DRY-MIL-001', '6291001000001', (SELECT id FROM public.categories WHERE name='Dairy'), 'pcs', 180.00, 220.00, 200.00, 0, 20, true),
  ('b1000000-0000-0000-0000-000000000002', 'Bread (White)', 'BAK-BRD-001', '6291001000002', (SELECT id FROM public.categories WHERE name='Bakery'), 'pcs', 55.00, 80.00, 70.00, 0, 30, true),
  ('b1000000-0000-0000-0000-000000000003', 'Eggs (1 Dozen)', 'DRY-EGG-001', '6291001000003', (SELECT id FROM public.categories WHERE name='Dairy'), 'dozen', 280.00, 360.00, 340.00, 0, 15, false),
  ('b1000000-0000-0000-0000-000000000004', 'Sugar 1kg', 'SUG-SUG-001', '6291001000004', (SELECT id FROM public.categories WHERE name='Sugar'), 'kg', 110.00, 140.00, 130.00, 0, 40, false),
  ('b1000000-0000-0000-0000-000000000005', 'All Purpose Flour 1kg', 'FLO-MDA-001', '6291001000005', (SELECT id FROM public.categories WHERE name='Flour'), 'kg', 95.00, 125.00, 115.00, 0, 40, false),
  ('b1000000-0000-0000-0000-000000000006', 'Basmati Rice 5kg', 'RIC-BAS-001', '6291001000006', (SELECT id FROM public.categories WHERE name='Rice'), 'kg', 650.00, 850.00, 800.00, 0, 10, false),
  ('b1000000-0000-0000-0000-000000000007', 'Cooking Oil 1L', 'OIL-SUN-001', '6291001000007', (SELECT id FROM public.categories WHERE name='Cooking Oil'), 'pcs', 320.00, 420.00, 395.00, 0, 15, false),
  ('b1000000-0000-0000-0000-000000000008', 'Green Tea (50 bags)', 'TEA-GRN-001', '6291001000008', (SELECT id FROM public.categories WHERE name='Tea'), 'pcs', 180.00, 250.00, 230.00, 0, 10, false),
  ('b1000000-0000-0000-0000-000000000009', 'Biscuits (Marie)', 'BIS-MAR-001', '6291001000009', (SELECT id FROM public.categories WHERE name='Biscuits'), 'pcs', 45.00, 65.00, 58.00, 0, 25, false),
  ('b1000000-0000-0000-0000-000000000010', 'Pepsi 1.5L', 'BEV-PEP-001', '6291001000010', (SELECT id FROM public.categories WHERE name='Beverages'), 'pcs', 120.00, 170.00, 160.00, 0, 24, false),
  ('b1000000-0000-0000-0000-000000000011', 'Water 1.5L', 'BEV-WAT-001', '6291001000011', (SELECT id FROM public.categories WHERE name='Beverages'), 'pcs', 30.00, 50.00, 45.00, 0, 48, false),
  ('b1000000-0000-0000-0000-000000000012', 'Lays Chips (Classic)', 'SNK-LAY-001', '6291001000012', (SELECT id FROM public.categories WHERE name='Snacks'), 'pcs', 55.00, 80.00, 72.00, 0, 20, false),
  ('b1000000-0000-0000-0000-000000000013', 'Dettol Soap', 'PER-SAP-001', '6291001000013', (SELECT id FROM public.categories WHERE name='Personal Care'), 'pcs', 65.00, 90.00, 82.00, 0, 20, false),
  ('b1000000-0000-0000-0000-000000000014', 'Shampoo Sachet', 'PER-SAM-001', '6291001000014', (SELECT id FROM public.categories WHERE name='Personal Care'), 'pcs', 8.00, 15.00, 12.00, 0, 50, false),
  ('b1000000-0000-0000-0000-000000000015', 'Detergent 1kg', 'CLE-DET-001', '6291001000015', (SELECT id FROM public.categories WHERE name='Cleaning'), 'pcs', 180.00, 250.00, 230.00, 0, 12, false),
  ('b1000000-0000-0000-0000-000000000016', 'Turmeric 250g', 'SPI-TUR-001', '6291001000016', (SELECT id FROM public.categories WHERE name='Spices'), 'pcs', 60.00, 90.00, 80.00, 0, 15, false),
  ('b1000000-0000-0000-0000-000000000017', 'Red Chili 250g', 'SPI-CHI-001', '6291001000017', (SELECT id FROM public.categories WHERE name='Spices'), 'pcs', 80.00, 120.00, 105.00, 0, 15, false),
  ('b1000000-0000-0000-0000-000000000018', 'Moong Dal 1kg', 'PUL-MOO-001', '6291001000018', (SELECT id FROM public.categories WHERE name='Pulses'), 'kg', 200.00, 280.00, 260.00, 0, 10, false),
  ('b1000000-0000-0000-0000-000000000019', 'Toothpaste (Colgate)', 'PER-TOO-001', '6291001000019', (SELECT id FROM public.categories WHERE name='Personal Care'), 'pcs', 75.00, 110.00, 100.00, 0, 15, false),
  ('b1000000-0000-0000-0000-000000000020', 'Frozen Paratha (10pc)', 'FRO-PAR-001', '6291001000020', (SELECT id FROM public.categories WHERE name='Frozen Foods'), 'pcs', 180.00, 250.00, 230.00, 0, 10, true),
  ('b1000000-0000-0000-0000-000000000021', 'Rusks (Toast)', 'BAK-RUS-001', '6291001000021', (SELECT id FROM public.categories WHERE name='Bakery'), 'pcs', 40.00, 60.00, 52.00, 0, 20, false),
  ('b1000000-0000-0000-0000-000000000022', 'Mango Juice 1L', 'BEV-MAN-001', '6291001000022', (SELECT id FROM public.categories WHERE name='Beverages'), 'pcs', 140.00, 200.00, 185.00, 0, 12, false),
  ('b1000000-0000-0000-0000-000000000023', 'Chips Fortune 500g', 'SNK-CHI-001', '6291001000023', (SELECT id FROM public.categories WHERE name='Snacks'), 'pcs', 150.00, 220.00, 200.00, 0, 10, false),
  ('b1000000-0000-0000-0000-000000000024', 'Hand Wash 250ml', 'PER-HND-001', '6291001000024', (SELECT id FROM public.categories WHERE name='Personal Care'), 'pcs', 110.00, 160.00, 145.00, 0, 10, false),
  ('b1000000-0000-0000-0000-000000000025', 'Mopping Liquid 1L', 'HOU-MOP-001', '6291001000025', (SELECT id FROM public.categories WHERE name='Household'), 'pcs', 90.00, 130.00, 120.00, 0, 10, false)
ON CONFLICT (id) DO NOTHING;

-- 6. INVENTORY (stock for all products)
INSERT INTO public.inventory (product_id, quantity, average_cost) VALUES
  ('b1000000-0000-0000-0000-000000000001', 100, 180.00),  -- Milk
  ('b1000000-0000-0000-0000-000000000002', 50, 55.00),    -- Bread
  ('b1000000-0000-0000-0000-000000000003', 30, 280.00),   -- Eggs
  ('b1000000-0000-0000-0000-000000000004', 60, 110.00),   -- Sugar
  ('b1000000-0000-0000-0000-000000000005', 45, 95.00),    -- Flour
  ('b1000000-0000-0000-0000-000000000006', 20, 650.00),   -- Rice
  ('b1000000-0000-0000-0000-000000000007', 25, 320.00),   -- Oil
  ('b1000000-0000-0000-0000-000000000008', 15, 180.00),   -- Tea
  ('b1000000-0000-0000-0000-000000000009', 50, 45.00),    -- Biscuits
  ('b1000000-0000-0000-0000-000000000010', 24, 120.00),   -- Pepsi
  ('b1000000-0000-0000-0000-000000000011', 40, 30.00),    -- Water
  ('b1000000-0000-0000-0000-000000000012', 30, 55.00),    -- Lays
  ('b1000000-0000-0000-0000-000000000013', 25, 65.00),    -- Dettol
  ('b1000000-0000-0000-0000-000000000014', 60, 8.00),     -- Shampoo
  ('b1000000-0000-0000-0000-000000000015', 18, 180.00),   -- Detergent
  ('b1000000-0000-0000-0000-000000000016', 20, 60.00),    -- Turmeric
  ('b1000000-0000-0000-0000-000000000017', 20, 80.00),    -- Chili
  ('b1000000-0000-0000-0000-000000000018', 15, 200.00),   -- Moong
  ('b1000000-0000-0000-0000-000000000019', 20, 75.00),    -- Toothpaste
  ('b1000000-0000-0000-0000-000000000020', 15, 180.00),   -- Paratha
  ('b1000000-0000-0000-0000-000000000021', 25, 40.00),    -- Rusks
  ('b1000000-0000-0000-0000-000000000022', 18, 140.00),   -- Mango
  ('b1000000-0000-0000-0000-000000000023', 15, 150.00),   -- Chips
  ('b1000000-0000-0000-0000-000000000024', 20, 110.00),   -- Handwash
  ('b1000000-0000-0000-0000-000000000025', 15, 90.00)     -- Mopping
ON CONFLICT (product_id) DO UPDATE SET 
  quantity = EXCLUDED.quantity, 
  average_cost = EXCLUDED.average_cost;

-- 7. INVENTORY BATCHES (for expiry tracking products)
INSERT INTO public.inventory_batches (product_id, supplier_id, batch_number, purchase_cost, received_quantity, remaining_quantity, expiry_date, received_date) VALUES
  ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 'MILK-0801', 180.00, 100, 100, CURRENT_DATE + INTERVAL '7 days', CURRENT_DATE - INTERVAL '3 days'),
  ('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'BRD-0801', 55.00, 50, 50, CURRENT_DATE + INTERVAL '5 days', CURRENT_DATE - INTERVAL '3 days'),
  ('b1000000-0000-0000-0000-000000000010', 'a1000000-0000-0000-0000-000000000001', 'PEP-0801', 120.00, 24, 24, CURRENT_DATE + INTERVAL '90 days', CURRENT_DATE - INTERVAL '3 days'),
  ('b1000000-0000-0000-0000-000000000009', 'a1000000-0000-0000-0000-000000000001', 'BIS-0801', 45.00, 50, 50, CURRENT_DATE + INTERVAL '60 days', CURRENT_DATE - INTERVAL '3 days')
ON CONFLICT DO NOTHING;

-- 8. CUSTOMERS (15 realistic customers)
INSERT INTO public.customers (id, name, phone, email, address, credit_limit, opening_balance, notes) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'Muhammad Ali', '0301-1112233', null, 'Gulshan-e-Iqbal, Karachi', 50000, 3500, 'Regular customer'),
  ('c1000000-0000-0000-0000-000000000002', 'Fatima Ahmed', '0302-2223344', null, 'DHA Phase 5, Karachi', 100000, 0, 'VIP customer'),
  ('c1000000-0000-0000-0000-000000000003', 'Hassan Raza', '0303-3334455', null, 'North Nazimabad, Karachi', 30000, 2000, null),
  ('c1000000-0000-0000-0000-000000000004', 'Ayesha Siddiqui', '0304-4445566', null, 'Clifton, Karachi', 75000, 0, null),
  ('c1000000-0000-0000-0000-000000000005', 'Bilal Ahmed', '0305-5556677', null, 'Malir, Karachi', 25000, 5000, 'Monthly buyer'),
  ('c1000000-0000-0000-0000-000000000006', 'Zainab Bibi', '0306-6667788', null, 'Korangi, Karachi', 20000, 0, null),
  ('c1000000-0000-0000-0000-000000000007', 'Omar Farooq', '0307-7778899', null, 'Saddar, Karachi', 40000, 1500, null),
  ('c1000000-0000-0000-0000-000000000008', 'Nadia Parveen', '0308-8889900', null, 'PECHS, Karachi', 60000, 0, null),
  ('c1000000-0000-0000-0000-000000000009', 'Ahmed Shah', '0309-9990011', null, 'Landhi, Karachi', 15000, 3000, null),
  ('c1000000-0000-0000-0000-000000000010', 'Saima Khan', '0310-1011122', null, 'Gulistan-e-Johar, Karachi', 35000, 0, null),
  ('c1000000-0000-0000-0000-000000000011', 'Rashid Mehmood', '0311-2122233', null, 'Federal B Area, Karachi', 25000, 800, null),
  ('c1000000-0000-0000-0000-000000000012', 'Khalid Mehmood', '0312-3133344', null, 'Surjani Town, Karachi', 20000, 0, null),
  ('c1000000-0000-0000-0000-000000000013', 'Asma Rasheed', '0313-4144455', null, 'Orangi Town, Karachi', 15000, 0, null),
  ('c1000000-0000-0000-0000-000000000014', 'Tariq Jamil', '0314-5155566', null, 'Nazimabad, Karachi', 45000, 2500, null),
  ('c1000000-0000-0000-0000-000000000015', 'Irfan Pathan', '0315-6166677', null, 'Buffer Zone, Karachi', 30000, 0, null)
ON CONFLICT (id) DO NOTHING;

-- 9. STORE SETTINGS
INSERT INTO public.store_settings (id, store_name, address, phone, currency)
VALUES (true, 'Kiryana Store - Main Branch', 'Shop #12, Main Market, Gulshan-e-Iqbal, Karachi', '021-1234567', 'PKR')
ON CONFLICT (id) DO UPDATE SET store_name = EXCLUDED.store_name;

-- Done! Products are ready for POS search.
SELECT 'Seed data inserted successfully! ' || count(*) || ' products available.' as result FROM public.products;
