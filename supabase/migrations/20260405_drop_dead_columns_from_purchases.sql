-- Drop dead columns from user_purchases:
--   image_url  – never written; app reads images from the products table
--   receipt_id – defined in initial schema but never written or read anywhere

ALTER TABLE user_purchases DROP COLUMN IF EXISTS image_url;
ALTER TABLE user_purchases DROP COLUMN IF EXISTS receipt_id;
