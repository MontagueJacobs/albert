-- Add structured nutrition data column
-- Stores parsed voedingswaarden: {energy_kcal, fat, saturated_fat, carbs, sugars, fiber, protein, salt}
-- All values per 100g/100ml (grams values = weight percentages)
ALTER TABLE products ADD COLUMN IF NOT EXISTS nutrition_json JSONB;

-- Add comment for documentation
COMMENT ON COLUMN products.nutrition_json IS 'Structured nutrition per 100g: {energy_kcal, fat, saturated_fat, carbs, sugars, fiber, protein, salt}';
