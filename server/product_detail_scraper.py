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
                
            await asyncio.sleep(2)  # Wait for dynamic content
            
            # Get the page content for analysis
            content = await self.page.content()
            
            # ================================================================
            # Extract certifications from JSON ProductProperty data only
            # (This avoids false positives from page-wide content searches)
            # ================================================================
            # Unescape HTML content to properly parse JSON patterns
            unescaped_content = content.replace('\\"', '"')
            
            # Known ProductProperty codes:
            # - sp_include_dieet_veganistisch: "Veganistisch" - vegan
            # - sp_include_dieet_vegetarisch: "Vegetarisch" - vegetarian  
            # - nutriscore: "A", "B", etc. - nutri-score
            # - np_bio: organic/bio marker (if present)
            # - sp_fairtrade, sp_utz, np_fairtrade, etc. - fairtrade certifications
            
            # Extract VEGAN from sp_include_dieet_veganistisch
            try:
                vegan_match = re.search(r'"code":"sp_include_dieet_veganistisch","values":\[[^\]]*\]', unescaped_content, re.IGNORECASE)
                if vegan_match:
                    result['is_vegan'] = True
                    result['is_vegetarian'] = True  # Vegan implies vegetarian
                    print(f"[DEBUG] Found vegan certification in ProductProperty", flush=True)
            except Exception as e:
                print(f"[WARN] Vegan extraction failed: {e}", flush=True)
            
            # Extract VEGETARIAN from sp_include_dieet_vegetarisch
            if not result['is_vegetarian']:
                try:
                    veg_match = re.search(r'"code":"sp_include_dieet_vegetarisch","values":\[[^\]]*\]', unescaped_content, re.IGNORECASE)
                    if veg_match:
                        result['is_vegetarian'] = True
                        print(f"[DEBUG] Found vegetarian certification in ProductProperty", flush=True)
                except Exception as e:
                    print(f"[WARN] Vegetarian extraction failed: {e}", flush=True)
            
            # Extract NUTRI-SCORE from nutriscore property
            try:
                nutri_match = re.search(r'"code":"nutriscore","values":\["([A-Ea-e])"\]', unescaped_content, re.IGNORECASE)
                if nutri_match:
                    result['nutri_score'] = nutri_match.group(1).upper()
                    print(f"[DEBUG] Found nutri-score: {result['nutri_score']}", flush=True)
            except Exception as e:
                print(f"[WARN] Nutri-score extraction failed: {e}", flush=True)
            
            # Extract ORGANIC/BIO from various possible property codes
            try:
                # Look for common organic property patterns
                organic_patterns = [
                    r'"code":"(sp_bio|np_bio|sp_biologisch|np_biologisch|bio)","values":\[[^\]]*\]',
                    r'"code":"sp_include_[^"]*bio[^"]*","values":\[[^\]]*\]',
                ]
                for pattern in organic_patterns:
                    if re.search(pattern, unescaped_content, re.IGNORECASE):
                        result['is_organic'] = True
                        print(f"[DEBUG] Found organic certification in ProductProperty", flush=True)
                        break
                
                # Also check product title for explicit "biologisch" or "bio" label
                # (Only use this as it's the product's actual name, not page cruft)
                title_match = re.search(r'"title":"([^"]+)"', unescaped_content)
                if title_match:
                    title = title_match.group(1).lower()
                    if 'biologisch' in title or title.startswith('bio ') or ' bio ' in title:
                        result['is_organic'] = True
                        print(f"[DEBUG] Found organic in product title: {title}", flush=True)
            except Exception as e:
                print(f"[WARN] Organic extraction failed: {e}", flush=True)
            
            # Extract FAIRTRADE from various possible property codes
            try:
                fairtrade_patterns = [
                    r'"code":"(sp_fairtrade|np_fairtrade|fairtrade)","values":\[[^\]]*\]',
                    r'"code":"sp_include_[^"]*fairtrade[^"]*","values":\[[^\]]*\]',
                    r'"code":"(sp_utz|np_utz|utz)","values":\[[^\]]*\]',
                    r'"code":"(sp_rainforest|rainforest_alliance)","values":\[[^\]]*\]',
                    r'"code":"(sp_max_havelaar|havelaar)","values":\[[^\]]*\]',
                    # AH uses da_accreditation for certifications like FAIR_TRADE_MARK, UTZ, etc.
                    r'"code":"da_accreditation","values":\["[^"]*FAIR_TRADE[^"]*"\]',
                    r'"code":"da_accreditation","values":\["[^"]*UTZ[^"]*"\]',
                    r'"code":"da_accreditation","values":\["[^"]*RAINFOREST[^"]*"\]',
                ]
                for pattern in fairtrade_patterns:
                    if re.search(pattern, unescaped_content, re.IGNORECASE):
                        result['is_fairtrade'] = True
                        print(f"[DEBUG] Found fairtrade certification via pattern: {pattern[:50]}", flush=True)
                        break
            except Exception as e:
                print(f"[WARN] Fairtrade extraction failed: {e}", flush=True)
            
            # Debug: Log all ProductProperty codes found on this page
            try:
                all_codes = re.findall(r'"code":"([^"]+)","values":\[([^\]]*)\]', unescaped_content)
                if all_codes:
                    print(f"[DEBUG] All ProductProperty codes found: {all_codes[:15]}", flush=True)  # First 15
            except:
                pass
            
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
            # (unescaped_content already created above in certification extraction)
            try:
                # Look for np_lokaal property with country values
                np_lokaal_match = re.search(r'"code":"np_lokaal","values":\["([^"]+)"\]', unescaped_content, re.IGNORECASE)
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
                r'(\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l|cl|stuks?|st))\b',
                r'inhoud[:\s]*(\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l|cl))',
            ]
            
            try:
                # Look in title first
                title_elem = await self.page.query_selector('h1')
                if title_elem:
                    title = await title_elem.inner_text()
                    for pattern in unit_patterns:
                        match = re.search(pattern, title, re.IGNORECASE)
                        if match:
                            result['unit_size'] = match.group(1).strip()
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
            # Extract Price
            # ================================================================
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
                                        break
                        except (json.JSONDecodeError, ValueError):
                            pass
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
            print(f"[SUCCESS] Scraped: vegan={result['is_vegan']}, organic={result['is_organic']}, nutri={result['nutri_score']}, origin={result['origin_country']}, image={'yes' if result['image_url'] else 'no'}", flush=True)
            
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
