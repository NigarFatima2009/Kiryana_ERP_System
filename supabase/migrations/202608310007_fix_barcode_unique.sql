-- Fix barcode unique constraint to allow NULL values
-- PostgreSQL's UNIQUE constraint treats NULL as not equal to anything,
-- but we need a partial unique index to properly allow multiple NULL barcodes

-- Drop the old UNIQUE constraint on barcode
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_barcode_key;

-- Create a partial unique index that only applies to non-NULL barcodes
CREATE UNIQUE INDEX products_barcode_unique_idx ON public.products(barcode)
WHERE barcode IS NOT NULL;

-- Verify the index exists
SELECT * FROM pg_indexes WHERE tablename = 'products' AND indexname = 'products_barcode_unique_idx';
