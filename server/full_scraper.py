#!/usr/bin/env python3
"""
Albert Heijn Full Catalog Scraper

Scrapes products from AH category pages AND their detail pages in one run.
Handles the privacy popup automatically.

Usage:
  python full_scraper.py --test              # Test with 10 products
  python full_scraper.py --limit 100         # Scrape 100 products with details
  python full_scraper.py                     # Scrape entire catalog (thousands of products)

The scraper:
1. Opens a visible browser window
2. Handles the cookie/privacy popup
3. Scrapes product listings from category pages
4. Visits each product page to get detailed info (origin, fairtrade, organic, etc.)
5. Saves everything to Supabase
"""

import asyncio
import argparse
import json
import os
import sys
import re
from datetime import datetime
from typing import Dict, Any, List, Optional, Set

try:
    from playwright.async_api import async_playwright, Page, Browser, BrowserContext
except ImportError:
    print("ERROR: Playwright not installed. Run: pip install playwright && playwright install chromium", file=sys.stderr)
    sys.exit(1)

try:
    from supabase import create_client, Client
except ImportError:
    print("ERROR: supabase-py not installed. Run: pip install supabase", file=sys.stderr)
    sys.exit(1)

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))


# Country name mappings (Dutch to English)
COUNTRY_MAPPINGS = {
    'nederland': 'Netherlands', 'netherlands': 'Netherlands', 'holland': 'Netherlands',
    'duitsland': 'Germany', 'germany': 'Germany',
    'belgië': 'Belgium', 'belgium': 'Belgium',
    'frankrijk': 'France', 'france': 'France',
    'spanje': 'Spain', 'spain': 'Spain',
    'italië': 'Italy', 'italy': 'Italy',
    'griekenland': 'Greece', 'greece': 'Greece',
    'portugal': 'Portugal',
    'polen': 'Poland', 'poland': 'Poland',
    'marokko': 'Morocco', 'morocco': 'Morocco',
    'turkije': 'Turkey', 'turkey': 'Turkey',
    'egypte': 'Egypt', 'egypt': 'Egypt',
    'zuid-afrika': 'South Africa', 'south africa': 'South Africa',
    'kenia': 'Kenya', 'kenya': 'Kenya',
    'costa rica': 'Costa Rica',
    'ecuador': 'Ecuador', 'colombia': 'Colombia',
    'brazilië': 'Brazil', 'brazil': 'Brazil',
    'argentinië': 'Argentina', 'argentina': 'Argentina',
    'chili': 'Chile', 'chile': 'Chile',
    'peru': 'Peru', 'mexico': 'Mexico',
    'verenigde staten': 'United States', 'united states': 'United States', 'usa': 'United States',
    'china': 'China', 'india': 'India',
    'thailand': 'Thailand', 'vietnam': 'Vietnam',
    'indonesië': 'Indonesia', 'indonesia': 'Indonesia',
    'australië': 'Australia', 'australia': 'Australia',
    'nieuw-zeeland': 'New Zealand', 'new zealand': 'New Zealand',
}

MONTH_NAMES = {
    'januari': 'jan', 'jan': 'jan',
    'februari': 'feb', 'feb': 'feb',
    'maart': 'mar', 'mrt': 'mar', 'mar': 'mar',
    'april': 'apr', 'apr': 'apr',
    'mei': 'may', 'may': 'may',
    'juni': 'jun', 'jun': 'jun',
    'juli': 'jul', 'jul': 'jul',
    'augustus': 'aug', 'aug': 'aug',
    'september': 'sep', 'sept': 'sep', 'sep': 'sep',
    'oktober': 'oct', 'okt': 'oct', 'oct': 'oct',
    'november': 'nov', 'nov': 'nov',
    'december': 'dec', 'dec': 'dec',
}

# AH categories
AH_CATEGORIES = [
    {'slug': 'producten/aardappel-groente-fruit', 'name': 'Groente & Fruit'},
    {'slug': 'producten/vlees-kip-vis-vega', 'name': 'Vlees, Kip, Vis & Vega'},
    {'slug': 'producten/kaas-vleeswaren-tapas', 'name': 'Kaas & Vleeswaren'},
    {'slug': 'producten/zuivel-plantaardig-eieren', 'name': 'Zuivel & Eieren'},
    {'slug': 'producten/bakkerij-banket', 'name': 'Bakkerij'},
    {'slug': 'producten/ontbijtgranen-beleg', 'name': 'Ontbijt & Beleg'},
    {'slug': 'producten/pasta-rijst-internationale-keuken', 'name': 'Pasta, Rijst & Wereldkeuken'},
    {'slug': 'producten/soepen-conserven-sauzen', 'name': 'Soepen & Sauzen'},
    {'slug': 'producten/snoep-koek-chips', 'name': 'Snoep & Koek'},
    {'slug': 'producten/koffie-thee', 'name': 'Koffie & Thee'},
    {'slug': 'producten/frisdrank-sappen-water', 'name': 'Dranken'},
    {'slug': 'producten/wijn-bier-sterke-drank', 'name': 'Wijn & Bier'},
    {'slug': 'producten/diepvries', 'name': 'Diepvries'},
    {'slug': 'producten/baby-en-kind', 'name': 'Baby & Kind'},
    {'slug': 'producten/dieren', 'name': 'Huisdieren'},
    {'slug': 'producten/drogisterij', 'name': 'Drogisterij'},
    {'slug': 'producten/huishouden', 'name': 'Huishouden'},
]


def normalize_name(name: str) -> str:
    """Normalize product name for matching."""
    if not name:
        return ''
    return re.sub(r'[^a-z0-9]', '', name.lower())


def extract_product_id(url: str) -> Optional[str]:
    """Extract product ID from AH product URL."""
    match = re.search(r'/product/(wi\d+)', url)
    if match:
        return match.group(1)
    return None


class AHFullScraper:
    """Full scraper: catalog discovery + product detail extraction."""
    
    def __init__(self):
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self._playwright = None
        self.supabase: Optional[Client] = None
        
        self.seen_ids: Set[str] = set()
        self.products: List[Dict[str, Any]] = []
        
        self.stats = {
            'categories_scraped': 0,
            'products_found': 0,
            'details_scraped': 0,
            'products_saved': 0,
            'errors': 0,
        }
        
    def connect_supabase(self) -> bool:
        """Connect to Supabase."""
        url = os.getenv('SUPABASE_URL')
        key = os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_ANON_KEY')
        
        if not url or not key:
            print("[WARN] SUPABASE_URL/KEY not set - will save to JSON file instead", file=sys.stderr)
            return False
            
        self.supabase = create_client(url, key)
        print(f"[DB] Connected to Supabase", flush=True)
        return True
        
    async def setup(self):
        """Initialize the browser (always headed for AH)."""
        self._playwright = await async_playwright().start()
        
        self.browser = await self._playwright.chromium.launch(
            headless=False,  # Must be headed - AH blocks headless
            args=[
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
            ]
        )
        
        self.context = await self.browser.new_context(
            viewport={'width': 1400, 'height': 900},
            locale='nl-NL',
            timezone_id='Europe/Amsterdam',
            user_agent='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        )
        
        await self.context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        """)
        
        self.page = await self.context.new_page()
        print("[OK] Browser opened (keep this window visible)", flush=True)
        
    async def close(self):
        """Clean up browser resources."""
        if self.browser:
            await self.browser.close()
        if self._playwright:
            await self._playwright.stop()
            
    async def handle_privacy_popup(self):
        """Handle the AH privacy/cookie popup."""
        try:
            # Wait for the cookie popup to appear (it takes a few seconds)
            print("[INFO] Waiting for cookie popup...", flush=True)
            
            cookie_popup = self.page.locator('[data-testid="cookie-popup"]')
            try:
                await cookie_popup.wait_for(state="visible", timeout=10000)
                print("[OK] Cookie popup appeared", flush=True)
                
                # Use JavaScript to click the Accepteren button to avoid overlay issues
                clicked = await self.page.evaluate('''() => {
                    const buttons = document.querySelectorAll('button');
                    for (const btn of buttons) {
                        if (btn.innerText.includes('Accepteren')) {
                            btn.click();
                            return true;
                        }
                    }
                    return false;
                }''')
                
                if clicked:
                    # Wait for popup to disappear
                    await cookie_popup.wait_for(state="hidden", timeout=5000)
                    print("[OK] Cookie popup dismissed", flush=True)
                    await asyncio.sleep(1)
                    return True
                else:
                    print("[WARN] Could not find Accepteren button", flush=True)
                    return False
                    
            except Exception as e:
                # Popup didn't appear - probably already accepted
                print("[INFO] No cookie popup (already accepted or not shown)", flush=True)
                return False
            
        except Exception as e:
            print(f"[WARN] Cookie handling error: {e}", flush=True)
            return False
            
    async def scrape_category_products(self, category: Dict[str, str], max_products: int = 0) -> List[Dict[str, Any]]:
        """Scrape product listings from a category page."""
        products = []
        category_url = f"https://www.ah.nl/{category['slug']}"
        
        print(f"\n{'='*60}", flush=True)
        print(f"[CATEGORY] {category['name']}", flush=True)
        print(f"{'='*60}", flush=True)
        
        try:
            await self.page.goto(category_url, wait_until='domcontentloaded', timeout=30000)
            await asyncio.sleep(3)
            
            # Handle popup on first category
            if self.stats['categories_scraped'] == 0:
                await self.handle_privacy_popup()
                
            # Scroll to load more products
            for _ in range(3):
                await self.page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
                await asyncio.sleep(1)
                
            # Find all product links
            links = await self.page.query_selector_all('a[href*="/producten/product/"]')
            print(f"  Found {len(links)} product links", flush=True)
            
            seen_on_page = set()
            
            for link in links:
                if max_products > 0 and len(products) >= max_products:
                    break
                    
                try:
                    href = await link.get_attribute('href')
                    if not href:
                        continue
                        
                    product_id = extract_product_id(href)
                    if not product_id or product_id in seen_on_page or product_id in self.seen_ids:
                        continue
                        
                    seen_on_page.add(product_id)
                    self.seen_ids.add(product_id)
                    
                    product = {
                        'id': product_id,
                        'url': f"https://www.ah.nl{href}" if href.startswith('/') else href,
                        'category': category['name'],
                    }
                    
                    # Try to get name from link or parent
                    try:
                        # Walk up to find product card
                        card = link
                        for _ in range(5):
                            parent = await card.evaluate_handle('el => el.parentElement')
                            if parent:
                                card = parent
                                
                        name_elem = await card.query_selector('[class*="title"], [class*="name"], span')
                        if name_elem:
                            name = await name_elem.inner_text()
                            if name and len(name) > 2:
                                # Clean up multi-line names
                                product['name'] = name.split('\n')[0].strip()
                    except:
                        pass
                        
                    # Get price
                    try:
                        price_elem = await card.query_selector('[class*="price"]')
                        if price_elem:
                            price_text = await price_elem.inner_text()
                            match = re.search(r'(\d+)[.,](\d{2})', price_text)
                            if match:
                                product['price'] = float(f"{match.group(1)}.{match.group(2)}")
                    except:
                        pass
                        
                    # Get image
                    try:
                        img = await card.query_selector('img')
                        if img:
                            src = await img.get_attribute('src')
                            if src and not src.startswith('data:'):
                                product['image_url'] = src
                    except:
                        pass
                        
                    if product.get('name'):
                        product['normalized_name'] = normalize_name(product['name'])
                        products.append(product)
                        self.stats['products_found'] += 1
                        
                except Exception as e:
                    self.stats['errors'] += 1
                    
            self.stats['categories_scraped'] += 1
            print(f"  Collected {len(products)} products from this category", flush=True)
            
        except Exception as e:
            print(f"  [ERROR] {e}", flush=True)
            self.stats['errors'] += 1
            
        return products
        
    async def scrape_product_details(self, product: Dict[str, Any]) -> Dict[str, Any]:
        """Scrape detailed information from a product page."""
        url = product.get('url')
        if not url:
            return product
            
        try:
            await self.page.goto(url, wait_until='domcontentloaded', timeout=20000)
            await asyncio.sleep(2)
            
            # ===== GET PROPER NAME FROM PRODUCT PAGE =====
            try:
                # Try h1 or main title element
                title_elem = await self.page.query_selector('h1, [data-testhook="product-title"], [class*="product-title"]')
                if title_elem:
                    name = await title_elem.inner_text()
                    if name and len(name.strip()) > 2:
                        product['name'] = name.strip()
                        product['normalized_name'] = normalize_name(product['name'])
            except:
                pass
                
            # Fallback: extract name from URL if still missing/wrong
            if not product.get('name') or product.get('name') == 'Snoepgroente':
                # URL like /product/wi4164/ah-courgette -> "ah courgette"
                url_match = re.search(r'/wi\d+/([^/?]+)', url)
                if url_match:
                    name_from_url = url_match.group(1).replace('-', ' ').title()
                    product['name'] = name_from_url
                    product['normalized_name'] = normalize_name(name_from_url)
                    
            print(f"  -> {product.get('name', product['id'])[:50]}...", flush=True)
            
            # ===== GET PROPER IMAGE FROM PRODUCT PAGE =====
            try:
                img_elem = await self.page.query_selector('[class*="product-image"] img, [data-testhook*="product-image"] img, main img')
                if img_elem:
                    src = await img_elem.get_attribute('src')
                    if src and not src.startswith('data:') and 'static.ah.nl' in src:
                        product['image_url'] = src
            except:
                pass
            
            content = await self.page.content()
            content_lower = content.lower()
            
            # ===== VEGAN/VEGETARIAN =====
            if any(x in content_lower for x in ['vegan', 'geschikt voor veganisten', 'plantaardig']):
                product['is_vegan'] = True
                product['is_vegetarian'] = True
            elif any(x in content_lower for x in ['vegetarisch', 'geschikt voor vegetariërs']):
                product['is_vegetarian'] = True
                
            # ===== ORGANIC =====
            if any(x in content_lower for x in ['biologisch', 'bio ', 'ah biologisch', 'eko-keurmerk', 'organic', 'demeter']):
                product['is_organic'] = True
                
            # ===== FAIRTRADE =====
            if any(x in content_lower for x in ['fairtrade', 'fair trade', 'max havelaar', 'utz', 'rainforest alliance']):
                product['is_fairtrade'] = True
                
            # ===== NUTRI-SCORE =====
            nutri_match = re.search(r'nutri-?score["\s:]*([a-eA-E])', content, re.IGNORECASE)
            if nutri_match:
                product['nutri_score'] = nutri_match.group(1).upper()
                
            # ===== ORIGIN / HERKOMST =====
            # Click the Herkomst accordion to expand it
            try:
                # Use JavaScript to click the Herkomst summary element
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
                    await asyncio.sleep(1)  # Wait for accordion to expand
                    
                    # Extract the content from the Herkomst details section
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
                        # Parse month-country pairs from content like:
                        # "januari       Nederland / Spanje"
                        # "februari      Nederland / Spanje"
                        origin_by_month = {}
                        current_month = None
                        
                        # Split into lines and parse
                        lines = herkomst_content.split('\n')
                        for line in lines:
                            line = line.strip()
                            if not line or line == 'Herkomst' or 'Maand' in line or 'Oorsprong' in line:
                                continue
                            if 'kan door onvoorziene' in line.lower():
                                continue
                                
                            # Check if line starts with a month name
                            line_lower = line.lower()
                            for month_nl, month_key in MONTH_NAMES.items():
                                if line_lower.startswith(month_nl):
                                    # Extract countries after the month name
                                    country_part = line[len(month_nl):].strip()
                                    
                                    # Parse countries separated by /
                                    countries = []
                                    for country_raw in country_part.split('/'):
                                        country_raw = country_raw.strip().lower()
                                        if country_raw in COUNTRY_MAPPINGS:
                                            countries.append(COUNTRY_MAPPINGS[country_raw])
                                    
                                    if countries:
                                        origin_by_month[month_key] = countries
                                    break
                        
                        if origin_by_month:
                            product['origin_by_month'] = origin_by_month
                            # Set origin_country to current month's first country
                            current_month = datetime.now().strftime('%b').lower()
                            if current_month in origin_by_month:
                                product['origin_country'] = origin_by_month[current_month][0]
                            
            except Exception as e:
                pass  # No Herkomst section for this product
                
            # Fallback: try simpler origin patterns if no monthly data found
            if not product.get('origin_country'):
                origin_patterns = [
                    r'herkomst[:\s]+([A-Za-z\-]+)',
                    r'land van herkomst[:\s]+([A-Za-z\-]+)',
                    r'oorsprong[:\s]+([A-Za-z\-]+)',
                ]
                
                for pattern in origin_patterns:
                    match = re.search(pattern, content, re.IGNORECASE)
                    if match:
                        country_raw = match.group(1).strip().lower()
                        # Only accept if it's a known country
                        if country_raw in COUNTRY_MAPPINGS:
                            product['origin_country'] = COUNTRY_MAPPINGS[country_raw]
                            break
                
            self.stats['details_scraped'] += 1
            
        except Exception as e:
            print(f"    [ERROR] {e}", flush=True)
            self.stats['errors'] += 1
            
        return product
        
    def save_product(self, product: Dict[str, Any]) -> bool:
        """Save a product to Supabase."""
        if not self.supabase:
            return False
            
        try:
            record = {
                'id': product['id'],
                'name': product.get('name', f"Product {product['id']}"),
                'normalized_name': product.get('normalized_name'),
                'url': product.get('url'),
                'image_url': product.get('image_url'),
                'price': product.get('price'),
                'is_vegan': product.get('is_vegan'),
                'is_vegetarian': product.get('is_vegetarian'),
                'is_organic': product.get('is_organic'),
                'is_fairtrade': product.get('is_fairtrade'),
                'nutri_score': product.get('nutri_score'),
                'origin_country': product.get('origin_country'),
                'origin_by_month': product.get('origin_by_month'),
                'source': 'scraped',
                'last_seen_at': datetime.now().isoformat(),
            }
            
            # Remove None values
            record = {k: v for k, v in record.items() if v is not None}
            
            self.supabase.table('products').upsert(record, on_conflict='id').execute()
            self.stats['products_saved'] += 1
            return True
            
        except Exception as e:
            print(f"    [DB ERROR] {e}", flush=True)
            return False
            
    async def run(self, limit: int = 0, delay: float = 1.5, categories: Optional[List[str]] = None):
        """
        Run the full scraper.
        
        Args:
            limit: Max products to scrape (0 = no limit)
            delay: Seconds between product detail requests
            categories: Specific categories to scrape (None = all)
        """
        print("\n" + "="*60, flush=True)
        print("  ALBERT HEIJN FULL CATALOG SCRAPER", flush=True)
        print("="*60, flush=True)
        print(f"  Product limit: {limit if limit > 0 else 'No limit'}", flush=True)
        print(f"  Delay between products: {delay}s", flush=True)
        print("="*60, flush=True)
        print("\n[INFO] A browser window will open. Keep it visible!", flush=True)
        print("[INFO] The scraper will handle the cookie popup automatically.\n", flush=True)
        
        self.connect_supabase()
        await self.setup()
        
        try:
            # PHASE 1: Collect product URLs from categories
            print("\n" + "="*60, flush=True)
            print("  PHASE 1: COLLECTING PRODUCTS FROM CATEGORIES", flush=True)
            print("="*60, flush=True)
            
            cats_to_scrape = AH_CATEGORIES
            if categories:
                cats_to_scrape = [c for c in AH_CATEGORIES if c['slug'] in categories or c['name'].lower() in [x.lower() for x in categories]]
                
            # For test mode, just scrape from first category to get all products
            if limit > 0 and limit <= 20:
                # Small limit - just use first category
                products = await self.scrape_category_products(cats_to_scrape[0], max_products=limit)
                self.products.extend(products)
            else:
                # Large limit or no limit - spread across categories
                products_per_category = (limit // len(cats_to_scrape) + 1) if limit > 0 else 0
                
                for category in cats_to_scrape:
                    remaining = limit - len(self.products) if limit > 0 else 0
                    max_from_cat = min(products_per_category, remaining) if limit > 0 else 0
                    
                    products = await self.scrape_category_products(category, max_products=max_from_cat)
                    self.products.extend(products)
                    
                    if limit > 0 and len(self.products) >= limit:
                        print(f"\n[INFO] Reached limit of {limit} products", flush=True)
                        break
                        
                    await asyncio.sleep(2)  # Pause between categories
                
            print(f"\n[PHASE 1 COMPLETE] Collected {len(self.products)} products", flush=True)
            
            # PHASE 2: Scrape details for each product
            print("\n" + "="*60, flush=True)
            print("  PHASE 2: SCRAPING PRODUCT DETAILS", flush=True)
            print("="*60, flush=True)
            
            for i, product in enumerate(self.products, 1):
                print(f"\n[{i}/{len(self.products)}]", flush=True)
                
                await self.scrape_product_details(product)
                
                # Save to database
                if self.supabase:
                    self.save_product(product)
                    
                # Show what we found
                details = []
                if product.get('is_organic'): details.append('🌿 Bio')
                if product.get('is_vegan'): details.append('🌱 Vegan')
                if product.get('is_fairtrade'): details.append('🤝 Fairtrade')
                if product.get('origin_country'): details.append(f"📍 {product['origin_country']}")
                if product.get('nutri_score'): details.append(f"NS: {product['nutri_score']}")
                
                if details:
                    print(f"    Found: {', '.join(details)}", flush=True)
                    
                await asyncio.sleep(delay)
                
        finally:
            # Save to JSON as backup
            output_file = f"ah_catalog_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(self.products, f, indent=2, ensure_ascii=False)
            print(f"\n[BACKUP] Saved to {output_file}", flush=True)
            
            await self.close()
            
        # Print summary
        print("\n" + "="*60, flush=True)
        print("  SCRAPING COMPLETE", flush=True)
        print("="*60, flush=True)
        print(f"  Categories scraped:  {self.stats['categories_scraped']}", flush=True)
        print(f"  Products found:      {self.stats['products_found']}", flush=True)
        print(f"  Details scraped:     {self.stats['details_scraped']}", flush=True)
        print(f"  Products saved to DB: {self.stats['products_saved']}", flush=True)
        print(f"  Errors:              {self.stats['errors']}", flush=True)
        print("="*60, flush=True)
        
        # Show some examples with details
        products_with_origin = [p for p in self.products if p.get('origin_country')]
        if products_with_origin:
            print("\n[EXAMPLES] Products with origin data:", flush=True)
            for p in products_with_origin[:5]:
                origin = p.get('origin_country')
                monthly = p.get('origin_by_month')
                print(f"  - {p.get('name', p['id'])[:40]}: {origin}", flush=True)
                if monthly:
                    print(f"      Monthly: {monthly}", flush=True)


async def main():
    parser = argparse.ArgumentParser(description='AH Full Catalog Scraper')
    parser.add_argument('--test', action='store_true',
                        help='Test mode: scrape only 10 products')
    parser.add_argument('--limit', '-l', type=int, default=0,
                        help='Maximum products to scrape (0 = no limit)')
    parser.add_argument('--delay', '-d', type=float, default=1.5,
                        help='Delay between product detail requests (default: 1.5s)')
    parser.add_argument('--category', '-c', action='append',
                        help='Specific category to scrape (can use multiple times)')
    
    args = parser.parse_args()
    
    limit = 10 if args.test else args.limit
    
    scraper = AHFullScraper()
    await scraper.run(limit=limit, delay=args.delay, categories=args.category)


if __name__ == '__main__':
    asyncio.run(main())
