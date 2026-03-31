# TODO / Roadmap

## Planned Features

### Barcode Scanner
Scan a product barcode with the phone camera to instantly see its CO₂ breakdown.

**Approach (v1 — Open Food Facts):**
1. Camera UI: `getUserMedia()` + video element + scan overlay
2. Barcode detection: `BarcodeDetector` API (Chrome/Android) or `zxing-js/browser` for cross-browser
3. Look up EAN via Open Food Facts API (`https://world.openfoodfacts.org/api/v2/product/{ean}`)
4. Feed ingredients + nutrition into our `getCO2FromIngredients()` engine
5. Display breakdown instantly — no DB changes needed

**Approach (v2 — native DB):**
- Add `ean TEXT` column to `products` table
- Scrape EAN from AH product pages (in `<script type="application/ld+json">`)
- Backfill EANs for existing products
- New `/api/products/barcode/:ean` endpoint
- Fall back to Open Food Facts if not in our DB

**Estimated effort:** ~2-3 days

---

## Known Limitations
- USDA profile substring matching can give wrong profiles for derivative ingredients (e.g. "aardappeleiwit" → raw potato instead of potato protein isolate)
- `nutrition_json` missing `fat`/`fiber` for products scraped before regex fix — rescraping fixes this; text-to-JSON merge works as runtime fallback
- Protein/carb floors not applied due to USDA profile mismatch risk
