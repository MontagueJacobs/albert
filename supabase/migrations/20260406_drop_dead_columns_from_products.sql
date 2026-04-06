-- Drop dead columns from products table:
--   adjustments    – loaded from DB but never consumed; UI adjustments come from CO2 scoring engine
--   notes          – loaded but never reaches any API response or frontend
--   tags           – written by several paths but never read anywhere
--   contributed_by – only exists in migration DDL; zero app code references

ALTER TABLE products DROP COLUMN IF EXISTS adjustments;
ALTER TABLE products DROP COLUMN IF EXISTS notes;
ALTER TABLE products DROP COLUMN IF EXISTS tags;
ALTER TABLE products DROP COLUMN IF EXISTS contributed_by;
