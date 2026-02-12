c#!/usr/bin/env python3
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
}


class AHProductDetailScraper:
    """Scrapes detailed information from individual AH product pages."""
    
    def __init__(self, headless: bool = True):
        self.headless = headless
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self._playwright = None
        
    async def setup(self):
        """Initialize the browser."""
        self._playwright = await async_playwright().start()
        
        self.browser = await self._playwright.chromium.launch(
            headless=self.headless,
            args=[
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
                '--disable-dev-shm-usage',
            ]
        )
        
        self.context = await self.browser.new_context(
            viewport={'width': 1280, 'height': 900},
            locale='nl-NL',
            timezone_id='Europe/Amsterdam',
            user_agent='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        )
        
        # Remove webdriver detection
        await self.context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        """)
        
        self.page = await self.context.new_page()
        print("[INFO] Browser initialized", flush=True)
        
    async def close(self):
        """Clean up browser resources."""
        if self.browser:
            await self.browser.close()
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
            'nutri_score': None,
            'origin_country': None,
            'brand': None,
            'unit_size': None,
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
            # Extract Vegan/Vegetarian status
            # ================================================================
            # Look for dietary icons/badges
            vegan_indicators = [
                'vegan',
                'geschikt voor veganisten',
                'plantaardig',
            ]
            vegetarian_indicators = [
                'vegetarisch',
                'geschikt voor vegetariërs',
            ]
            
            content_lower = content.lower()
            
            # Check for vegan
            for indicator in vegan_indicators:
                if indicator in content_lower:
                    result['is_vegan'] = True
                    result['is_vegetarian'] = True  # Vegan implies vegetarian
                    break
                    
            # Check for vegetarian (if not already vegan)
            if not result['is_vegan']:
                for indicator in vegetarian_indicators:
                    if indicator in content_lower:
                        result['is_vegetarian'] = True
                        break
            
            # Try to find specific dietary badges
            try:
                dietary_badges = await self.page.query_selector_all('[class*="dietary"], [class*="keurmerk"], [class*="badge"]')
                for badge in dietary_badges:
                    text = (await badge.inner_text()).lower()
                    if 'vegan' in text:
                        result['is_vegan'] = True
                        result['is_vegetarian'] = True
                    elif 'vegetarisch' in text or 'vegetarian' in text:
                        result['is_vegetarian'] = True
            except:
                pass
                
            # ================================================================
            # Extract Organic/Bio status
            # ================================================================
            organic_indicators = [
                'biologisch',
                'bio ',
                'ah biologisch',
                'eko-keurmerk',
                'skal',
                'organic',
            ]
            
            for indicator in organic_indicators:
                if indicator in content_lower:
                    result['is_organic'] = True
                    break
                    
            # Also check product title
            try:
                title_elem = await self.page.query_selector('h1, [class*="title"]')
                if title_elem:
                    title = (await title_elem.inner_text()).lower()
                    if 'bio ' in title or 'biologisch' in title or title.startswith('bio'):
                        result['is_organic'] = True
            except:
                pass
                
            # ================================================================
            # Extract Nutri-Score
            # ================================================================
            # Look for Nutri-Score image or text
            nutri_patterns = [
                r'nutri-?score[:\s]*([A-Ea-e])',
                r'nutriscore[:\s]*([A-Ea-e])',
                r'nutri-score-([A-Ea-e])',
            ]
            
            for pattern in nutri_patterns:
                match = re.search(pattern, content, re.IGNORECASE)
                if match:
                    result['nutri_score'] = match.group(1).upper()
                    break
                    
            # Try to find Nutri-Score from image alt text or data attributes
            try:
                nutri_images = await self.page.query_selector_all('[class*="nutri"], [alt*="Nutri"], img[src*="nutri"]')
                for img in nutri_images:
                    alt = await img.get_attribute('alt') or ''
                    src = await img.get_attribute('src') or ''
                    for letter in ['A', 'B', 'C', 'D', 'E']:
                        if f'nutri' in (alt + src).lower() and letter in (alt + src).upper():
                            result['nutri_score'] = letter
                            break
                    if result['nutri_score']:
                        break
            except:
                pass
                
            # ================================================================
            # Extract Country of Origin
            # ================================================================
            origin_patterns = [
                r'herkomst[:\s]*([^<\n,]+)',
                r'land van herkomst[:\s]*([^<\n,]+)',
                r'oorsprong[:\s]*([^<\n,]+)',
                r'country of origin[:\s]*([^<\n,]+)',
                r'geproduceerd in[:\s]*([^<\n,]+)',
            ]
            
            for pattern in origin_patterns:
                match = re.search(pattern, content, re.IGNORECASE)
                if match:
                    country_raw = match.group(1).strip()
                    # Clean up the country name
                    country_raw = re.sub(r'<[^>]+>', '', country_raw)  # Remove HTML tags
                    country_raw = country_raw.strip().lower()
                    
                    # Map to standardized country name
                    for dutch_name, english_name in COUNTRY_MAPPINGS.items():
                        if dutch_name in country_raw:
                            result['origin_country'] = english_name
                            break
                    
                    if not result['origin_country'] and len(country_raw) > 2:
                        # Use the raw value if no mapping found
                        result['origin_country'] = country_raw.title()
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
                        
            result['success'] = True
            print(f"[SUCCESS] Scraped: vegan={result['is_vegan']}, organic={result['is_organic']}, nutri={result['nutri_score']}, origin={result['origin_country']}", flush=True)
            
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
