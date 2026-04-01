#!/usr/bin/env python3
"""
Albert Heijn Product Detail Scraper

Scrapes detailed product information from individual AH product pages:
- Vegan/Vegetarian status
- Organic/Bio certification
- Nutri-Score
- Country of origin
- Brand, unit size, allergens, ingredients

Usage:
  python product_detail_scraper.py --url "https://www.ah.nl/producten/product/wi123456"
  python product_detail_scraper.py --batch --limit 50
  python product_detail_scraper.py --product-id "wi123456"
"""

import asyncio
import json
import os
import sys
import argparse
import re
from datetime import datetime
from typing import Optional, Dict, Any, List

try:
    from playwright.async_api import async_playwright, Page, Browser, BrowserContext
except ImportError:
    print("ERROR: Playwright not installed. Run: pip install playwright && playwright install chromium", file=sys.stderr)
    sys.exit(1)


# Country name mappings (Dutch to English)
COUNTRY_MAPPINGS = {
    'nederland': 'Netherlands',
    'netherlands': 'Netherlands',
    'holland': 'Netherlands',
    'duitsland': 'Germany',
    'germany': 'Germany',
    'belgië': 'Belgium',
    'belgium': 'Belgium',
    'frankrijk': 'France',
    'france': 'France',
    'spanje': 'Spain',
    'spain': 'Spain',
    'italië': 'Italy',
    'italy': 'Italy',
    'griekenland': 'Greece',
    'greece': 'Greece',
    'portugal': 'Portugal',
    'polen': 'Poland',
    'poland': 'Poland',
    'marokko': 'Morocco',
    'morocco': 'Morocco',
    'turkije': 'Turkey',
    'turkey': 'Turkey',
    'egypte': 'Egypt',
    'egypt': 'Egypt',
    'zuid-afrika': 'South Africa',
    'south africa': 'South Africa',
    'kenia': 'Kenya',
    'kenya': 'Kenya',
    'costa rica': 'Costa Rica',
    'ecuador': 'Ecuador',
    'colombia': 'Colombia',
    'brazilië': 'Brazil',
    'brazil': 'Brazil',
    'argentinië': 'Argentina',
    'argentina': 'Argentina',
    'chili': 'Chile',
    'chile': 'Chile',
    'peru': 'Peru',
    'mexico': 'Mexico',
    'verenigde staten': 'United States',
    'united states': 'United States',
    'usa': 'United States',
    'china': 'China',
    'india': 'India',
    'thailand': 'Thailand',
    'vietnam': 'Vietnam',
    'indonesië': 'Indonesia',
    'indonesia': 'Indonesia',
    'australië': 'Australia',
    'australia': 'Australia',
    'nieuw-zeeland': 'New Zealand',
    'new zealand': 'New Zealand',
    'sri lanka': 'Sri Lanka',
    'filipijnen': 'Philippines',
    'philippines': 'Philippines',
    'maleisië': 'Malaysia',
    'malaysia': 'Malaysia',
    'pakistan': 'Pakistan',
    'bangladesh': 'Bangladesh',
    'ierland': 'Ireland',
    'ireland': 'Ireland',
    'oostenrijk': 'Austria',
    'austria': 'Austria',
    'zwitserland': 'Switzerland',
    'switzerland': 'Switzerland',
    'denemarken': 'Denmark',
    'denmark': 'Denmark',
    'zweden': 'Sweden',
    'sweden': 'Sweden',
    'noorwegen': 'Norway',
    'norway': 'Norway',
}


class AHProductDetailScraper:
    """Scrapes detailed information from individual AH product pages."""
    
    def __init__(self, headless: bool = True, user_data_dir: str = None):
        self.headless = headless
        # Use persistent profile to remember login
        self.user_data_dir = user_data_dir or os.path.join(os.path.dirname(__file__), '.ah_browser_profile')
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self._playwright = None
        
    async def setup(self):
        """Initialize the browser with persistent profile."""
        self._playwright = await async_playwright().start()
        
        # Use persistent context to keep login cookies
        self.context = await self._playwright.chromium.launch_persistent_context(
            self.user_data_dir,
            headless=self.headless,
            viewport={'width': 1280, 'height': 900},
            locale='nl-NL',
            timezone_id='Europe/Amsterdam',
            user_agent='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            args=[
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
                '--disable-dev-shm-usage',
            ]
        )
        
        # Remove webdriver detection
        await self.context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        """)
        
        self.page = self.context.pages[0] if self.context.pages else await self.context.new_page()
        print(f"[INFO] Browser initialized (profile: {self.user_data_dir})", flush=True)
        
    async def close(self):
        """Clean up browser resources."""
        if self.context:
            await self.context.close()
        if self._playwright:
            await self._playwright.stop()
            
    def _parse_nutrition_values(self, text: str) -> Optional[Dict[str, float]]:
        """
        Parse structured nutrition values from voedingswaarden text.
        AH nutrition tables show values per 100g/100ml, so the gram values
        directly translate to percentages of the product's composition.
        
        Handles both inline format ("Vetten 3,2 g") and line-separated table
        format ("Vetten\n3,2 g") from the pdp-nutricional-info table.
        
        Returns dict with keys: energy_kcal, fat, saturated_fat, carbs, sugars, fiber, protein, salt
        All values in grams per 100g (= percentage), except energy in kcal.
        """
        if not text:
            return None
        
        values = {}
        
        # \s+ covers both space and newline between label and value (table row extraction)
        # Each pattern: (output_key, regex_patterns)
        # We try Dutch names first, then English
        nutrition_fields = [
            ('energy_kcal', [
                r'(?:energie|energy)\s+[\d,.]+\s*kJ\s*/\s*(\d+[.,]?\d*)\s*kcal',
                r'(?:energie|energy)\s+(\d+[.,]?\d*)\s*kcal',
                r'(\d+[.,]?\d*)\s*kcal',
            ]),
            ('fat', [
                r'\bvet(?:ten?)?\b\s+(\d+[.,]?\d*)\s*g',
                r'\bfat\b\s+(\d+[.,]?\d*)\s*g',
                r'\btotal\s+fat\b\s+(\d+[.,]?\d*)\s*g',
            ]),
            ('saturated_fat', [
                r'waarvan\s+verzadigd(?:e?\s*(?:vetzuren?)?)?\s+(\d+[.,]?\d*)\s*g',
                r'(?:of\s+which\s+)?saturates?\s+(\d+[.,]?\d*)\s*g',
            ]),
            ('carbs', [
                r'\bkoolhydraten\b\s+(\d+[.,]?\d*)\s*g',
                r'\bcarbohydrate\b\s+(\d+[.,]?\d*)\s*g',
            ]),
            ('sugars', [
                r'waarvan\s+suikers?\s+(\d+[.,]?\d*)\s*g',
                r'(?:of\s+which\s+)?sugars?\s+(\d+[.,]?\d*)\s*g',
            ]),
            ('fiber', [
                r'(?:voedings)?vezels?\b\s+(\d+[.,]?\d*)\s*g',
                r'\bfib(?:re|er)\b\s+(\d+[.,]?\d*)\s*g',
            ]),
            ('protein', [
                r'\beiwitten?\b\s+(\d+[.,]?\d*)\s*g',
                r'\bprotein\b\s+(\d+[.,]?\d*)\s*g',
            ]),
            ('salt', [
                r'\bzout\b\s+(\d+[.,]?\d*)\s*g',
                r'\bsalt\b\s+(\d+[.,]?\d*)\s*g',
            ]),
        ]
        
        for key, patterns in nutrition_fields:
            for pattern in patterns:
                match = re.search(pattern, text, re.IGNORECASE)
                if match:
                    try:
                        val = float(match.group(1).replace(',', '.'))
                        values[key] = val
                    except ValueError:
                        pass
                    break
        
        if not values:
            return None
        
        # Derive unsaturated fat = total fat - saturated fat
        if 'fat' in values and 'saturated_fat' in values:
            values['unsaturated_fat'] = round(values['fat'] - values['saturated_fat'], 2)
        
        print(f"[DEBUG] Parsed nutrition values: {values}", flush=True)
        return values
    
    async def scrape_product(self, url: str) -> Dict[str, Any]:
        """
        Scrape detailed information from a single product page.
        
        Args:
            url: Full URL to the AH product page
            
        Returns:
            Dict with product details
        """
        result = {
            'url': url,
            'success': False,
            'is_vegan': None,
            'is_vegetarian': None,
            'is_organic': None,
            'is_fairtrade': None,
            'nutri_score': None,
            'origin_country': None,
            'origin_by_month': None,  # Monthly origin data: {"jan": "Country", "feb": "Country", ...}
            'brand': None,
            'unit_size': None,
            'price': None,
            'image_url': None,  # Product image URL
            'allergens': [],
            'ingredients': None,
            'nutrition_text': None,
            'nutrition_json': None,  # Structured: {energy_kcal, fat, saturated_fat, carbs, sugars, fiber, protein, salt}
            'error': None,
            'scraped_at': datetime.now().isoformat()
        }
        
        try:
            print(f"[INFO] Scraping: {url}", flush=True)
            
            # Navigate to product page
            response = await self.page.goto(url, wait_until='domcontentloaded', timeout=30000)
            
            if response and response.status == 404:
                result['error'] = 'not_found'
                print(f"[WARN] Product not found: {url}", flush=True)
                return result
            
            # Check for access denied / bot detection
            title = await self.page.title()
            if 'Access Denied' in title or response.status == 403:
                result['error'] = 'access_denied'
                print(f"[WARN] Access Denied (bot detected): {url}", flush=True)
                return result
                
            await asyncio.sleep(2)  # Wait for dynamic content
            
            # Get the page content for analysis
            content = await self.page.content()
            
            # Check for CAPTCHA or bot detection in content
            if 'robot' in content.lower() and 'captcha' in content.lower():
                result['error'] = 'captcha'
                print(f"[WARN] CAPTCHA detected: {url}", flush=True)
                return result
            
            # ================================================================
            # STRATEGY 1: Extract from JSON-LD schema.org structured data
            # This is the most reliable source for price, image, brand
            # ================================================================
            try:
                # Look for JSON-LD Product schema
                jsonld_match = re.search(r'(\{[^}]*"@type"\s*:\s*"Product"[^}]*"offers"[^}]*\})', content, re.DOTALL)
                if jsonld_match:
                    jsonld_text = jsonld_match.group(1)
                    # Unescape unicode
                    jsonld_text = jsonld_text.replace('\\u0026', '&').replace('\\u003c', '<').replace('\\u003e', '>')
                    
                    # Extract price from offers (handle both quoted and unquoted values)
                    # JSON can have: "price": 2.99 or "price": "2.99"
                    price_match = re.search(r'"price"\s*:\s*"?([\d.]+)"?', jsonld_text)
                    if price_match:
                        result['price'] = float(price_match.group(1))
                        print(f"[DEBUG] JSON-LD price: {result['price']}", flush=True)
                    
                    # Extract image
                    img_match = re.search(r'"image"\s*:\s*"([^"]+static\.ah\.nl[^"]+)"', jsonld_text)
                    if img_match:
                        result['image_url'] = img_match.group(1).replace('\\u0026', '&')
                        print(f"[DEBUG] JSON-LD image: found", flush=True)
                    
                    # Extract brand
                    brand_match = re.search(r'"brand"[^}]*"name"\s*:\s*"([^"]+)"', jsonld_text)
                    if brand_match:
                        result['brand'] = brand_match.group(1)
                        print(f"[DEBUG] JSON-LD brand: {result['brand']}", flush=True)
            except Exception as e:
                print(f"[WARN] JSON-LD extraction failed: {e}", flush=True)
            
            # ================================================================
            # STRATEGY 2: Extract from Next.js React Server Components data
            # ProductProperty contains nutriscore, vegan, organic, etc.
            # ================================================================
            # Normalize content for pattern matching (handle various escape styles)
            normalized = content.replace('\\\\', '\\').replace('\\"', '"').replace('\\u0022', '"')
            
            # Extract NUTRI-SCORE from ProductProperty or icons
            try:
                # Pattern 1: ProductProperty format
                nutri_match = re.search(r'"code"\s*:\s*"nutriscore"\s*,\s*"values"\s*:\s*\[\s*"([A-Ea-e])"\s*\]', normalized, re.IGNORECASE)
                if nutri_match:
                    result['nutri_score'] = nutri_match.group(1).upper()
                    print(f"[DEBUG] Found nutri-score from ProductProperty: {result['nutri_score']}", flush=True)
                else:
                    # Pattern 2: Icon format like "NUTRISCORE_A"
                    icon_match = re.search(r'"NUTRISCORE_([A-E])"', content, re.IGNORECASE)
                    if icon_match:
                        result['nutri_score'] = icon_match.group(1).upper()
                        print(f"[DEBUG] Found nutri-score from icon: {result['nutri_score']}", flush=True)
            except Exception as e:
                print(f"[WARN] Nutri-score extraction failed: {e}", flush=True)
            
            # Extract ORGANIC/BIO
            try:
                if re.search(r'"(np_biologisch|sp_kenmerk)"\s*,\s*"values"\s*:\s*\[[^\]]*"biologisch"[^\]]*\]', normalized, re.IGNORECASE):
                    result['is_organic'] = True
                    print(f"[DEBUG] Found organic certification from ProductProperty", flush=True)
                elif '"ORGANIC"' in content or 'EU_ORGANIC_FARMING' in content:
                    result['is_organic'] = True
                    print(f"[DEBUG] Found organic from icon uppercase", flush=True)
                # SVG icon pattern: pantry-svg-src/assets/logos/product/organic* or biologisch*
                elif 'logos/product/organic' in content.lower() or 'logos/product/biologisch' in content.lower():
                    result['is_organic'] = True
                    print(f"[DEBUG] Found organic from SVG icon", flush=True)
            except Exception as e:
                print(f"[WARN] Organic extraction failed: {e}", flush=True)
            
            # Extract VEGAN
            # IMPORTANT: Only match vegan in product-specific data, NOT the entire page.
            # The page HTML contains "VEGAN" in category filters, related products, etc.
            try:
                # Method 1: ProductProperty JSON - most reliable (product's own diet property)
                if re.search(r'"code"\s*:\s*"sp_include_dieet_veganistisch"', normalized, re.IGNORECASE):
                    result['is_vegan'] = True
                    result['is_vegetarian'] = True
                    print(f"[DEBUG] Found vegan certification from ProductProperty", flush=True)
                # Method 2: Product icon in the product's own icon/shield section
                # Look for vegan icon near the product's own properties (not in related products)
                # The product's own icons appear within ProductProperty or shield data
                elif re.search(r'"(productProperties|shields)"[^}]*"VEGAN"', normalized, re.IGNORECASE):
                    result['is_vegan'] = True
                    result['is_vegetarian'] = True
                    print(f"[DEBUG] Found vegan from product properties/shields", flush=True)
                # Method 3: SVG icon specifically in the product's icon block (not page-wide)
                elif re.search(r'"icons?"[^}]{0,200}logos/product/vegan-', content.lower()):
                    result['is_vegan'] = True
                    result['is_vegetarian'] = True
                    print(f"[DEBUG] Found vegan from product SVG icon", flush=True)
            except Exception as e:
                print(f"[WARN] Vegan extraction failed: {e}", flush=True)
            
            # Extract VEGETARIAN
            if not result.get('is_vegetarian'):
                try:
                    if re.search(r'"code"\s*:\s*"sp_include_dieet_vegetarisch"', normalized, re.IGNORECASE):
                        result['is_vegetarian'] = True
                        print(f"[DEBUG] Found vegetarian certification from ProductProperty", flush=True)
                    # Product-specific icon/shield containing vegetarian reference
                    elif re.search(r'"(productProperties|shields)"[^}]*"VEGETARI', normalized, re.IGNORECASE):
                        result['is_vegetarian'] = True
                        print(f"[DEBUG] Found vegetarian from product properties/shields", flush=True)
                    elif re.search(r'"icons?"[^}]{0,200}logos/product/vegetari', content.lower()):
                        result['is_vegetarian'] = True
                        print(f"[DEBUG] Found vegetarian from product SVG icon", flush=True)
                except Exception as e:
                    print(f"[WARN] Vegetarian extraction failed: {e}", flush=True)
            
            # Extract FAIRTRADE
            try:
                if re.search(r'"(sp_fairtrade|np_fairtrade|FAIRTRADE)"', content, re.IGNORECASE):
                    result['is_fairtrade'] = True
                    print(f"[DEBUG] Found fairtrade certification", flush=True)
                # SVG icon pattern
                elif 'logos/product/fairtrade' in content.lower():
                    result['is_fairtrade'] = True
                    print(f"[DEBUG] Found fairtrade from SVG icon", flush=True)
            except Exception as e:
                print(f"[WARN] Fairtrade extraction failed: {e}", flush=True)
            
            # NOTE: Dutch icon check moved AFTER np_lokaal and Herkomst methods
            # to avoid false-positive NL assignments. See below after METHOD 2.
            
            # STRATEGY 3: Extract monthly origin from collapsible origin table
            # ================================================================
            try:
                # Look for origin data in the table format
                origin_by_month = {}
                months_map = {
                    'januari': 'jan', 'februari': 'feb', 'maart': 'mar', 'april': 'apr',
                    'mei': 'may', 'juni': 'jun', 'juli': 'jul', 'augustus': 'aug',
                    'september': 'sep', 'oktober': 'oct', 'november': 'nov', 'december': 'dec'
                }
                
                # Pattern: "Januari-0-0"...children":"Januari"}]...{"children":"\tNederland / Spanje"
                for month_nl, month_key in months_map.items():
                    pattern = rf'"{month_nl.capitalize()}"[^}}]*\}}\],\["\$","td"[^}}]*"children"\s*:\s*"\\t([^"]+)"'
                    match = re.search(pattern, normalized, re.IGNORECASE)
                    if match:
                        origin = match.group(1).strip()
                        origin_by_month[month_key] = origin
                
                if origin_by_month:
                    result['origin_by_month'] = origin_by_month
                    # Set current month's origin as the main origin
                    current_month = datetime.now().strftime('%b').lower()
                    if current_month in origin_by_month:
                        result['origin_country'] = origin_by_month[current_month]
                        print(f"[DEBUG] Found monthly origin data, current: {result['origin_country']}", flush=True)
                    else:
                        # Just use first available
                        result['origin_country'] = list(origin_by_month.values())[0]
                        print(f"[DEBUG] Found monthly origin data: {len(origin_by_month)} months", flush=True)
            except Exception as e:
                print(f"[WARN] Origin extraction failed: {e}", flush=True)
            
            # ================================================================
            # STRATEGY 4: Fallback DOM-based extraction for image if not found
            # ================================================================
            if not result.get('image_url'):
                try:
                    # Look for product image in React state data (broader pattern)
                    img_match = re.search(r'"url"\s*:\s*"(https://static\.ah\.nl/dam/product/[^"]+)"', content)
                    if not img_match:
                        # Try broader static.ah.nl pattern (covers /image/ paths too)
                        img_match = re.search(r'"(?:url|image|src)"\s*:\s*"(https://static\.ah\.nl/[^"]*(?:product|image)[^"]*)"', content, re.IGNORECASE)
                    if img_match:
                        result['image_url'] = img_match.group(1).replace('\\u0026', '&')
                        print(f"[DEBUG] Found image from React state", flush=True)
                except Exception as e:
                    print(f"[WARN] Image fallback extraction failed: {e}", flush=True)
            
            # STRATEGY 4b: Try DOM-based image extraction from actual <img> elements
            if not result.get('image_url'):
                try:
                    dom_image = await self.page.evaluate('''() => {
                        // Look for the main product image (usually the largest image on the page)
                        const imgs = Array.from(document.querySelectorAll('img'));
                        for (const img of imgs) {
                            const src = img.src || img.getAttribute('data-src') || '';
                            // AH product images are on static.ah.nl
                            if (src.includes('static.ah.nl') && (src.includes('product') || src.includes('dam'))) {
                                return src;
                            }
                        }
                        // Also check picture/source elements
                        const sources = Array.from(document.querySelectorAll('picture source'));
                        for (const s of sources) {
                            const srcset = s.srcset || '';
                            if (srcset.includes('static.ah.nl') && (srcset.includes('product') || srcset.includes('dam'))) {
                                // Get the first URL from srcset
                                const match = srcset.match(/https?:\\/\\/static\\.ah\\.nl[^\\s,]+/);
                                if (match) return match[0];
                            }
                        }
                        return null;
                    }''')
                    if dom_image:
                        result['image_url'] = dom_image
                        print(f"[DEBUG] Found image from DOM img elements", flush=True)
                except Exception as e:
                    print(f"[WARN] DOM image extraction failed: {e}", flush=True)
                
            # ================================================================
            # FALLBACK: Extract certifications from visible Kenmerken section
            # (In case JSON property codes don't cover all certifications)
            # ================================================================
            try:
                kenmerken_text = await self.page.evaluate('''() => {
                    // Find and expand Kenmerken section
                    const summaries = Array.from(document.querySelectorAll('summary'));
                    for (const s of summaries) {
                        if (s.textContent.includes('Kenmerken')) {
                            // Expand the section
                            const details = s.closest('details');
                            if (details) {
                                details.open = true;
                                return details.textContent;
                            }
                        }
                    }
                    return null;
                }''')
                
                if kenmerken_text:
                    kenmerken_lower = kenmerken_text.lower()
                    print(f"[DEBUG] Kenmerken section text: {kenmerken_text[:200]}...", flush=True)
                    
                    # Check for Fairtrade in Kenmerken (only if not already found)
                    if not result['is_fairtrade']:
                        if 'fairtrade' in kenmerken_lower or 'fair trade' in kenmerken_lower:
                            result['is_fairtrade'] = True
                            print(f"[DEBUG] Found fairtrade in Kenmerken section", flush=True)
                    
                    # Check for organic/bio in Kenmerken
                    if not result['is_organic']:
                        if 'biologisch' in kenmerken_lower or 'eko-keurmerk' in kenmerken_lower or 'eu-bio' in kenmerken_lower:
                            result['is_organic'] = True
                            print(f"[DEBUG] Found organic in Kenmerken section", flush=True)
                    
                    # Check for vegan in Kenmerken  
                    if not result['is_vegan']:
                        if 'vegan' in kenmerken_lower or 'veganistisch' in kenmerken_lower or 'geschikt voor veganisten' in kenmerken_lower:
                            result['is_vegan'] = True
                            result['is_vegetarian'] = True
                            print(f"[DEBUG] Found vegan in Kenmerken section", flush=True)
                    
                    # Check for vegetarian in Kenmerken
                    if not result['is_vegetarian']:
                        if 'vegetarisch' in kenmerken_lower:
                            result['is_vegetarian'] = True
                            print(f"[DEBUG] Found vegetarian in Kenmerken section", flush=True)
            except Exception as e:
                print(f"[WARN] Kenmerken section extraction failed: {e}", flush=True)
                
            # ================================================================
            # Extract Country of Origin (including monthly variations)
            # ================================================================
            # Month name mappings (Dutch to English abbreviations)
            MONTH_NAMES_LOCAL = {
                'januari': 'jan', 'jan': 'jan',
                'februari': 'feb', 'feb': 'feb',
                'maart': 'mar', 'mrt': 'mar',
                'april': 'apr', 'apr': 'apr',
                'mei': 'may',
                'juni': 'jun', 'jun': 'jun',
                'juli': 'jul', 'jul': 'jul',
                'augustus': 'aug', 'aug': 'aug',
                'september': 'sep', 'sept': 'sep', 'sep': 'sep',
                'oktober': 'oct', 'okt': 'oct',
                'november': 'nov', 'nov': 'nov',
                'december': 'dec', 'dec': 'dec',
            }
            
            # METHOD 1: Extract origin from JSON data embedded in page (most reliable)
            # AH stores origin in "np_lokaal" property like: "code":"np_lokaal","values":["nederland"]
            # (using 'normalized' variable created above in strategy 2)
            try:
                # Look for np_lokaal property with country values
                np_lokaal_match = re.search(r'"code":"np_lokaal","values":\["([^"]+)"\]', normalized, re.IGNORECASE)
                if np_lokaal_match:
                    country_raw = np_lokaal_match.group(1).lower()
                    if country_raw in COUNTRY_MAPPINGS:
                        result['origin_country'] = COUNTRY_MAPPINGS[country_raw]
                    else:
                        result['origin_country'] = country_raw.title()
                    print(f"[DEBUG] Found origin via np_lokaal: {result['origin_country']}", flush=True)
            except Exception as e:
                print(f"[WARN] np_lokaal extraction failed: {e}", flush=True)
            
            # METHOD 2: Try the Herkomst accordion (for monthly origin data)
            if not result['origin_country']:
                try:
                    herkomst_clicked = await self.page.evaluate('''() => {
                        const summaries = document.querySelectorAll('summary');
                        for (const s of summaries) {
                            if (s.innerText.includes('Herkomst')) {
                                s.click();
                                return true;
                            }
                        }
                        return false;
                    }''')
                    
                    if herkomst_clicked:
                        await asyncio.sleep(0.5)
                        
                        # Extract content from Herkomst details
                        herkomst_content = await self.page.evaluate('''() => {
                            const details = document.querySelectorAll('details');
                            for (const d of details) {
                                const summary = d.querySelector('summary');
                                if (summary && summary.innerText.includes('Herkomst')) {
                                    return d.innerText;
                                }
                            }
                            return null;
                        }''')
                    
                        if herkomst_content:
                            origin_by_month = {}
                            
                            lines = herkomst_content.split('\n')
                            for line in lines:
                                line = line.strip()
                                if not line or line == 'Herkomst' or 'Maand' in line or 'Oorsprong' in line:
                                    continue
                                if 'kan door onvoorziene' in line.lower():
                                    continue
                                
                                # Try to match month patterns
                                line_lower = line.lower()
                                for month_nl, month_key in MONTH_NAMES_LOCAL.items():
                                    if line_lower.startswith(month_nl):
                                        country_part = line[len(month_nl):].strip()
                                        
                                        countries = []
                                        for country_raw in country_part.split('/'):
                                            country_raw = country_raw.strip().lower()
                                            if country_raw in COUNTRY_MAPPINGS:
                                                countries.append(COUNTRY_MAPPINGS[country_raw])
                                            elif len(country_raw) > 2 and re.match(r'^[a-zA-Z\s\-]+$', country_raw):
                                                countries.append(country_raw.title())
                                        
                                        if countries:
                                            origin_by_month[month_key] = countries[0] if len(countries) == 1 else countries
                                        break
                            
                            if origin_by_month:
                                result['origin_by_month'] = origin_by_month
                                # Set current origin_country based on current month
                                from datetime import datetime as dt
                                current_month = dt.now().strftime('%b').lower()
                                if current_month in origin_by_month:
                                    countries = origin_by_month[current_month]
                                    result['origin_country'] = countries[0] if isinstance(countries, list) else countries
                            
                            # Also try to extract single country if no monthly data
                            if not result['origin_country']:
                                for line in lines:
                                    line_lower = line.strip().lower()
                                    
                                    # Handle "Geproduceerd in [country]" format
                                    geproduceerd_match = re.search(r'geproduceerd in\s+([a-zA-Z\s\-]+)', line_lower)
                                    if geproduceerd_match:
                                        country_raw = geproduceerd_match.group(1).strip().rstrip('.')
                                        if country_raw in COUNTRY_MAPPINGS:
                                            result['origin_country'] = COUNTRY_MAPPINGS[country_raw]
                                            print(f"[DEBUG] Found origin via 'Geproduceerd in': {result['origin_country']}", flush=True)
                                            break
                                        elif len(country_raw) > 2:
                                            result['origin_country'] = country_raw.title()
                                            print(f"[DEBUG] Found origin via 'Geproduceerd in': {result['origin_country']}", flush=True)
                                            break
                                    
                                    # Handle "Vervaardigd in [country]" format
                                    vervaardigd_match = re.search(r'vervaardigd in\s+([a-zA-Z\s\-]+)', line_lower)
                                    if vervaardigd_match:
                                        country_raw = vervaardigd_match.group(1).strip().rstrip('.')
                                        if country_raw in COUNTRY_MAPPINGS:
                                            result['origin_country'] = COUNTRY_MAPPINGS[country_raw]
                                            print(f"[DEBUG] Found origin via 'Vervaardigd in': {result['origin_country']}", flush=True)
                                            break
                                        elif len(country_raw) > 2:
                                            result['origin_country'] = country_raw.title()
                                            print(f"[DEBUG] Found origin via 'Vervaardigd in': {result['origin_country']}", flush=True)
                                            break
                                    
                                    # Also check for country names directly
                                    for country_name, english_name in COUNTRY_MAPPINGS.items():
                                        if country_name in line_lower and 'maand' not in line_lower:
                                            result['origin_country'] = english_name
                                            print(f"[DEBUG] Found origin in Herkomst text: {result['origin_country']}", flush=True)
                                            break
                                    if result['origin_country']:
                                        break
                except Exception as e:
                    print(f"[WARN] Herkomst accordion extraction failed: {e}", flush=True)
            
            # Fallback: try regex patterns on page content if accordion didn't work
            if not result['origin_country']:
                origin_patterns = [
                    r'herkomst[:\s]*([^<\n,]+)',
                    r'land van herkomst[:\s]*([^<\n,]+)',
                    r'oorsprong[:\s]*([^<\n,]+)',
                    r'geproduceerd in\s+([a-zA-Z\s\-]+)',
                    r'vervaardigd in\s+([a-zA-Z\s\-]+)',
                ]
                
                for pattern in origin_patterns:
                    match = re.search(pattern, content, re.IGNORECASE)
                    if match:
                        country_raw = match.group(1).strip()
                        # Clean up the country name
                        country_raw = re.sub(r'<[^>]+>', '', country_raw)  # Remove HTML tags
                        country_raw = re.sub(r'["\'\}\{\[\]\\]', '', country_raw)  # Remove JSON artifacts
                        country_raw = country_raw.strip().lower()
                        
                        # Skip garbage/invalid matches
                        if len(country_raw) < 3 or country_raw in ['null', 'undefined', 'none', '']:
                            continue
                        
                        # Map to standardized country name
                        for dutch_name, english_name in COUNTRY_MAPPINGS.items():
                            if dutch_name in country_raw:
                                result['origin_country'] = english_name
                                break
                        
                        if not result['origin_country'] and len(country_raw) > 2:
                            # Validate it looks like a country (only letters and spaces/hyphens)
                            if re.match(r'^[a-zA-Z\s\-]+$', country_raw):
                                result['origin_country'] = country_raw.title()
                        
                        if result['origin_country']:
                            break
            
            # ================================================================
            # STRATEGY: Dutch icon check (low priority — only if no origin found yet)
            # Moved here from earlier to prevent false-positive NL assignments
            # ================================================================
            if not result['origin_country']:
                try:
                    if 'logos/product/dutch' in content.lower() or 'LOCALLY_PRODUCED' in content:
                        result['origin_country'] = 'Netherlands'
                        print(f"[DEBUG] Found local origin (Netherlands) from dutch icon", flush=True)
                except Exception as e:
                    print(f"[WARN] Local origin extraction failed: {e}", flush=True)
            
            # ================================================================
            # STRATEGY: Infer EU origin from organic/bio certification
            # Products with EU bio logo are at least from the EU
            # ================================================================
            if not result['origin_country'] and result.get('is_organic'):
                result['origin_country'] = 'EU'
                print(f"[DEBUG] Inferred EU origin from organic/bio certification", flush=True)
                    
            # ================================================================
            # Extract Brand
            # ================================================================
            # Try to find brand from structured data or specific elements
            try:
                brand_elem = await self.page.query_selector('[class*="brand"], [itemprop="brand"]')
                if brand_elem:
                    result['brand'] = (await brand_elem.inner_text()).strip()
            except:
                pass
                
            # Try JSON-LD structured data
            try:
                scripts = await self.page.query_selector_all('script[type="application/ld+json"]')
                for script in scripts:
                    script_content = await script.inner_text()
                    try:
                        data = json.loads(script_content)
                        if isinstance(data, dict):
                            if 'brand' in data:
                                brand = data['brand']
                                if isinstance(brand, dict):
                                    result['brand'] = brand.get('name', '')
                                else:
                                    result['brand'] = str(brand)
                    except json.JSONDecodeError:
                        pass
            except:
                pass
                
            # ================================================================
            # Extract Unit Size
            # ================================================================
            unit_patterns = [
                r'(\d+\s*[xX×]\s*\d+(?:[,.]\d+)?\s*(?:gram|kilogram|liter|milliliter|centiliter|deciliter|stuks?|st|kg|ml|cl|dl|g|l))\b',
                r'(\d+(?:[,.]\d+)?\s*(?:gram|kilogram|liter|milliliter|centiliter|deciliter|stuks?|st|kg|ml|cl|dl|g|l))\b',
                r'inhoud[:\s]*(\d+(?:[,.]\d+)?\s*(?:gram|kilogram|liter|milliliter|centiliter|deciliter|kg|ml|cl|dl|g|l))',
            ]
            
            try:
                # Primary method: look in the "Inhoud en gewicht" section
                # AH uses data-testid="pdp-content-and-weight-contents" for weight info
                weight_elem = await self.page.query_selector('[data-testid="pdp-content-and-weight-contents"]')
                if weight_elem:
                    weight_text = await weight_elem.inner_text()
                    print(f"[DEBUG] Found weight section: {weight_text[:100]}", flush=True)
                    # Look for explicit netto inhoud / net weight patterns
                    netto_match = re.search(
                        r'(?:netto\s*inhoud|inhoud|volume|gewicht)[:\s]*(\d+(?:[,.]\d+)?\s*(?:gram|kilogram|liter|milliliter|centiliter|deciliter|kg|ml|cl|dl|g|l))',
                        weight_text, re.IGNORECASE
                    )
                    if netto_match:
                        result['unit_size'] = netto_match.group(1).strip()
                        print(f"[DEBUG] Extracted unit_size from weight section: {result['unit_size']}", flush=True)
                    else:
                        # Fall back to general unit pattern in the weight section text
                        for pattern in unit_patterns:
                            match = re.search(pattern, weight_text, re.IGNORECASE)
                            if match:
                                result['unit_size'] = match.group(1).strip()
                                print(f"[DEBUG] Extracted unit_size from weight section (fallback): {result['unit_size']}", flush=True)
                                break
                    
                    # If unit_size is "stuks", look for Portiegrootte as the real weight
                    # AH format: "1 Stuks\nPortiegrootte:\n    250 gram"
                    if result['unit_size'] and re.match(r'^\d+\s*stuks?$', result['unit_size'], re.IGNORECASE):
                        portie_match = re.search(
                            r'portiegrootte[:\s]*(\d+(?:[,.]\d+)?\s*(?:gram|kilogram|liter|milliliter|centiliter|deciliter|kg|ml|cl|dl|g|l))',
                            weight_text, re.IGNORECASE
                        )
                        if portie_match:
                            result['unit_size'] = portie_match.group(1).strip()
                            print(f"[DEBUG] Replaced stuks with portiegrootte: {result['unit_size']}", flush=True)
            except Exception as e:
                print(f"[WARN] Weight section extraction failed: {e}", flush=True)
            
            # Fallback: look in title if weight section didn't yield results
            if not result['unit_size']:
                try:
                    title_elem = await self.page.query_selector('h1')
                    if title_elem:
                        title = await title_elem.inner_text()
                        for pattern in unit_patterns:
                            match = re.search(pattern, title, re.IGNORECASE)
                            if match:
                                result['unit_size'] = match.group(1).strip()
                                print(f"[DEBUG] Extracted unit_size from title: {result['unit_size']}", flush=True)
                                break
                except:
                    pass
                
            # ================================================================
            # Extract Allergens
            # ================================================================
            allergen_keywords = [
                'gluten', 'tarwe', 'wheat',
                'melk', 'lactose', 'milk', 'dairy',
                'ei', 'eieren', 'egg',
                'noten', 'nuts', 'pinda', 'peanut',
                'soja', 'soy',
                'vis', 'fish',
                'schaaldieren', 'shellfish', 'schelpdieren',
                'selderij', 'celery',
                'mosterd', 'mustard',
                'sesam', 'sesamzaad', 'sesame',
                'sulfiet', 'sulphite',
                'lupine', 'lupin',
                'weekdieren', 'molluscs',
            ]
            
            # Look for allergen section
            try:
                allergen_section = await self.page.query_selector('[class*="allergen"], [class*="allergenen"]')
                if allergen_section:
                    allergen_text = (await allergen_section.inner_text()).lower()
                    for allergen in allergen_keywords:
                        if allergen in allergen_text:
                            # Standardize allergen name
                            std_allergen = allergen.title()
                            if std_allergen not in result['allergens']:
                                result['allergens'].append(std_allergen)
            except:
                pass
                
            # ================================================================
            # Extract Ingredients
            # ================================================================
            try:
                ingredients_elem = await self.page.query_selector('[class*="ingredient"], [itemprop="ingredients"]')
                if ingredients_elem:
                    result['ingredients'] = (await ingredients_elem.inner_text()).strip()
            except:
                pass
                
            # Also look for ingredients in a specific section
            ingredients_patterns = [
                r'ingrediënten[:\s]*([^<]+?)(?=<|allergenen|voedingswaarde|$)',
                r'ingredients[:\s]*([^<]+?)(?=<|allergens|nutrition|$)',
            ]
            
            if not result['ingredients']:
                for pattern in ingredients_patterns:
                    match = re.search(pattern, content, re.IGNORECASE | re.DOTALL)
                    if match:
                        ingredients_raw = match.group(1).strip()
                        # Clean up
                        ingredients_raw = re.sub(r'<[^>]+>', ' ', ingredients_raw)
                        ingredients_raw = re.sub(r'\s+', ' ', ingredients_raw).strip()
                        if len(ingredients_raw) > 10:
                            result['ingredients'] = ingredients_raw[:2000]  # Limit length
                        break
            
            # ================================================================
            # Extract Voedingswaarde (Nutritional info) for CO2 weight estimation
            # We scrape both raw text AND structured values (fat, protein, carbs, etc.)
            # to cross-reference ingredients with nutrition labels.
            # ================================================================
            
            # Strategy 0 (BEST): Use AH's data-testid="pdp-nutricional-info" container
            # This contains the table with all voedingswaarden per 100g/100ml
            try:
                nutrition_text = await self.page.evaluate('''() => {
                    // Primary: the dedicated nutrition info container
                    const nutri = document.querySelector('[data-testid="pdp-nutricional-info"]');
                    if (nutri) {
                        // Try to get the table body specifically for clean data
                        const tbody = nutri.querySelector('[class*="table_body"]');
                        if (tbody) {
                            // Extract each row as "label value" pairs
                            const rows = tbody.querySelectorAll('tr');
                            if (rows.length > 0) {
                                const lines = [];
                                rows.forEach(row => {
                                    const cells = row.querySelectorAll('td, th');
                                    const parts = [];
                                    cells.forEach(cell => {
                                        const t = (cell.innerText || cell.textContent || '').trim();
                                        if (t) parts.push(t);
                                    });
                                    if (parts.length > 0) lines.push(parts.join(' '));
                                });
                                if (lines.length > 0) return lines.join('\\n');
                            }
                        }
                        // Fallback: just get all text from the container
                        return nutri.innerText;
                    }
                    return null;
                }''')
                
                if nutrition_text and len(nutrition_text.strip()) > 20:
                    result['nutrition_text'] = nutrition_text.strip()[:2000]
                    print(f"[DEBUG] Voedingswaarden from data-testid: {nutrition_text[:200]}...", flush=True)
            except Exception as e:
                print(f"[WARN] Voedingswaarden data-testid extraction failed: {e}", flush=True)
            
            # Strategy 1: Expand the Voedingswaarden accordion (fallback for different page layouts)
            if not result.get('nutrition_text'):
                try:
                    nutrition_text = await self.page.evaluate('''() => {
                        const summaries = Array.from(document.querySelectorAll('summary'));
                        for (const s of summaries) {
                            const txt = s.textContent || s.innerText || '';
                            if (txt.includes('Voedingswaarden') || txt.includes('Nutritional')) {
                                const details = s.closest('details');
                                if (details) {
                                    details.open = true;
                                    return details.innerText;
                                }
                            }
                        }
                        return null;
                    }''')
                    
                    if nutrition_text and len(nutrition_text.strip()) > 20:
                        result['nutrition_text'] = nutrition_text.strip()[:2000]
                        print(f"[DEBUG] Voedingswaarden from accordion: {nutrition_text[:150]}...", flush=True)
                except Exception as e:
                    print(f"[WARN] Voedingswaarden accordion failed: {e}", flush=True)
            
            # Strategy 2: CSS selectors fallback
            if not result.get('nutrition_text'):
                try:
                    nutrition_elem = await self.page.query_selector(
                        '[class*="nutrition"], [class*="voedingswaarde"], '
                        '[itemprop="nutrition"], [data-testhook*="nutrition"]'
                    )
                    if nutrition_elem:
                        nt = (await nutrition_elem.inner_text()).strip()
                        if len(nt) > 20:
                            result['nutrition_text'] = nt[:2000]
                            print(f"[DEBUG] Voedingswaarden from CSS selector: {nt[:150]}...", flush=True)
                except:
                    pass
            
            # Strategy 3: Regex fallback from raw HTML content
            if not result.get('nutrition_text'):
                nutrition_patterns = [
                    r'voedingswaarde\s*(?:per\s+\d+\s*(?:g|ml))?\s*(.+?)(?=ingredi[ëe]nten|allergi|bewaar|bereid|$)',
                    r'voedingswaarde\s*(.+?)(?=<)',
                ]
                for pattern in nutrition_patterns:
                    match = re.search(pattern, content, re.IGNORECASE | re.DOTALL)
                    if match:
                        nutrition_raw = match.group(0).strip()
                        nutrition_raw = re.sub(r'<[^>]+>', ' ', nutrition_raw)
                        nutrition_raw = re.sub(r'\s+', ' ', nutrition_raw).strip()
                        if len(nutrition_raw) > 20:
                            result['nutrition_text'] = nutrition_raw[:2000]
                        break
            
            # Parse structured nutrition values from the text
            if result.get('nutrition_text'):
                result['nutrition_json'] = self._parse_nutrition_values(result['nutrition_text'])
            
            # ================================================================
            # Extract Price (only if not already extracted from JSON-LD Strategy 1)
            # ================================================================
            if not result['price']:
                try:
                    # Look for price elements (AH uses various price selectors)
                    price_selectors = [
                        '[class*="price-amount"]',
                        '[class*="product-price"]',
                        '[data-testhook="price-amount"]',
                        '[itemprop="price"]',
                        '.price',
                    ]
                    
                    for selector in price_selectors:
                        price_elem = await self.page.query_selector(selector)
                        if price_elem:
                            price_text = await price_elem.inner_text()
                            # Parse price from text like "€2,99" or "2.99"
                            price_match = re.search(r'[\d]+[.,][\d]{2}', price_text)
                            if price_match:
                                price_str = price_match.group().replace(',', '.')
                                result['price'] = float(price_str)
                                print(f"[DEBUG] DOM price from {selector}: {result['price']}", flush=True)
                                break
                    
                    # Also try JSON-LD structured data for price
                    if not result['price']:
                        scripts = await self.page.query_selector_all('script[type="application/ld+json"]')
                        for script in scripts:
                            script_content = await script.inner_text()
                            try:
                                data = json.loads(script_content)
                                if isinstance(data, dict):
                                    offers = data.get('offers', {})
                                    if isinstance(offers, dict):
                                        price = offers.get('price')
                                        if price:
                                            result['price'] = float(price)
                                            print(f"[DEBUG] JSON-LD parsed price: {result['price']}", flush=True)
                                            break
                            except (json.JSONDecodeError, ValueError):
                                pass
                    
                    if not result['price']:
                        print(f"[WARN] No price found for this product", flush=True)
                except Exception as e:
                    print(f"[WARN] Price extraction failed: {e}", flush=True)
                        
            # ================================================================
            # Extract Product Image
            # ================================================================
            try:
                # Try multiple selectors for the product image
                image_selectors = [
                    '[class*="product-image"] img',
                    '[data-testhook*="product-image"] img',
                    'main img[src*="static.ah.nl"]',
                    'img[src*="static.ah.nl"]'
                ]
                for selector in image_selectors:
                    img_elem = await self.page.query_selector(selector)
                    if img_elem:
                        src = await img_elem.get_attribute('src')
                        if src and 'static.ah.nl' in src:
                            result['image_url'] = src
                            print(f"[DEBUG] Found image: {src[:60]}...", flush=True)
                            break
            except Exception as e:
                print(f"[WARN] Image extraction failed: {e}", flush=True)
                        
            result['success'] = True
            print(f"[SUCCESS] Scraped: vegan={result['is_vegan']}, organic={result['is_organic']}, nutri={result['nutri_score']}, origin={result['origin_country']}, price={result['price']}, image={'yes' if result['image_url'] else 'no'}", flush=True)
            
        except Exception as e:
            result['error'] = str(e)
            print(f"[ERROR] Failed to scrape {url}: {e}", flush=True)
            
        return result
        
    async def scrape_multiple(self, urls: List[str], delay: float = 2.0) -> List[Dict[str, Any]]:
        """
        Scrape multiple product pages with a delay between requests.
        
        Args:
            urls: List of product URLs to scrape
            delay: Seconds to wait between requests
            
        Returns:
            List of product detail dicts
        """
        results = []
        total = len(urls)
        
        for i, url in enumerate(urls, 1):
            print(f"[INFO] Progress: {i}/{total}", flush=True)
            result = await self.scrape_product(url)
            results.append(result)
            
            if i < total:
                await asyncio.sleep(delay)
                
        return results


async def main():
    parser = argparse.ArgumentParser(description='AH Product Detail Scraper')
    parser.add_argument('--url', '-u', help='Single product URL to scrape')
    parser.add_argument('--product-id', '-p', help='Product ID (e.g., wi123456)')
    parser.add_argument('--batch', action='store_true', help='Batch mode: read URLs from stdin')
    parser.add_argument('--output', '-o', default='product_details.json', help='Output file')
    parser.add_argument('--headless', action='store_true', default=True, help='Run in headless mode')
    parser.add_argument('--no-headless', dest='headless', action='store_false', help='Show browser window')
    parser.add_argument('--delay', type=float, default=2.0, help='Delay between requests in batch mode')
    
    args = parser.parse_args()
    
    # Determine URL(s) to scrape
    urls = []
    
    if args.url:
        urls.append(args.url)
    elif args.product_id:
        urls.append(f'https://www.ah.nl/producten/product/{args.product_id}')
    elif args.batch:
        print("[INFO] Batch mode: reading URLs from stdin (one per line)", flush=True)
        for line in sys.stdin:
            line = line.strip()
            if line and line.startswith('http'):
                urls.append(line)
        print(f"[INFO] Read {len(urls)} URLs", flush=True)
    else:
        parser.print_help()
        return 1
        
    if not urls:
        print("[ERROR] No URLs to scrape", flush=True)
        return 1
        
    # Initialize scraper
    scraper = AHProductDetailScraper(headless=args.headless)
    
    try:
        await scraper.setup()
        
        if len(urls) == 1:
            result = await scraper.scrape_product(urls[0])
            results = [result]
        else:
            results = await scraper.scrape_multiple(urls, delay=args.delay)
            
        # Save results
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(results, f, indent=2, ensure_ascii=False)
        print(f"[INFO] Saved results to {args.output}", flush=True)
        
        # Print summary
        success_count = sum(1 for r in results if r['success'])
        print(f"[INFO] Summary: {success_count}/{len(results)} products scraped successfully", flush=True)
        
        # Output result for server parsing
        print(f"\n[RESULT] {json.dumps({'success': True, 'count': len(results), 'results': results})}", flush=True)
        
        return 0
        
    finally:
        await scraper.close()


if __name__ == '__main__':
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
