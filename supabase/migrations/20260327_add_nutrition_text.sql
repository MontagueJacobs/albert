-- Add nutrition_text column to store voedingswaarde text for CO2 weight estimation
-- Fat and salt values from this text are used to cap ingredient weight estimates
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS nutrition_text TEXT DEFAULT NULL;

COMMENT ON COLUMN public.products.nutrition_text IS 'Raw voedingswaarde/nutrition text from product page, used for CO2 ingredient weight estimation caps';
