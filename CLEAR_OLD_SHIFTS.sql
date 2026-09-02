-- Clear all test shifts to start fresh
DELETE FROM public.cashier_shifts 
WHERE user_id = (SELECT id FROM auth.users LIMIT 1);

-- Confirm deletion
SELECT 'All old shifts deleted. Ready for fresh testing!' as status;
