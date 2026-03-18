#!/usr/bin/env python3
"""
Albert Heijn Login-Based Full Catalog Scraper

Opens browser for manual login, then scrapes products with full access.

Usage:
  python login_scraper.py --limit 100    # Scrape 100 products
  python login_scraper.py --limit 500    # Scrape 500 products
  python login_scraper.py                # Scrape all products (no limit)
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
    'belgië': 'Belgium', 'belgium': 'Belgium', 'belgie': 'Belgium',
    'frankrijk': 'France', 'france': 'France',
    'spanje': 'Spain', 'spain': 'Spain',
    'italië': 'Italy', 'italy': 'Italy', 'italie': 'Italy',
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
    'brazilië': 'Brazil', 'brazil': 'Brazil', 'brazilie': 'Brazil',
    'argentinië': 'Argentina', 'argentina': 'Argentina', 'argentinie': 'Argentina',
    'chili': 'Chile', 'chile': 'Chile',
    'peru': 'Peru', 'mexico': 'Mexico',
    'verenigde staten': 'United States', 'united states': 'United States', 'usa': 'United States',
    'china': 'China', 'india': 'India',
    'thailand': 'Thailand', 'vietnam': 'Vietnam',
    'indonesië': 'Indonesia', 'indonesia': 'Indonesia', 'indonesie': 'Indonesia',
    'australië': 'Australia', 'australia': 'Australia', 'australie': 'Australia',
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


def extract_product_id(url: str) -> Optional[str]:
    """Extract product ID from AH product URL."""
    match = re.search(r'/product/(wi\d+)', url)
    if match:
        return match.group(1)
    return None


def normalize_name(name: str) -> str:
    """Normalize product name for matching."""
    if not name:
        return ''
    return re.sub(r'[^a-z0-9]', '', name.lower())


class AHLoginScraper:
    """Login-based scraper with full access."""
    
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
        """Initialize the browser."""
        self._playwright = await async_playwright().start()
        
        # Use persistent context to preserve login session
        user_data_dir = "/tmp/ah_browser_session"
        
        self.context = await self._playwright.chromium.launch_persistent_context(
            user_data_dir=user_data_dir,
            headless=False,
            viewport={'width': 1400, 'height': 900},
            locale='nl-NL',
            timezone_id='Europe/Amsterdam',
            args=[
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
            ]
        )
        
        # Get or create page
        if self.context.pages:
            self.page = self.context.pages[0]
        else:
            self.page = await self.context.new_page()
            
        await self.context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        """)
        
        print("[OK] Browser opened", flush=True)
        
    async def close(self):
        """Clean up browser resources."""
        if self.context:
            await self.context.close()
        if self._playwright:
            await self._playwright.stop()
            
    async def wait_for_login(self):
        """Navigate to login page and wait for user to log in."""
        print("\n" + "="*60, flush=True)
        print("  MANUAL LOGIN REQUIRED", flush=True)
        print("="*60, flush=True)
        print("\n  1. A browser window will open to ah.nl", flush=True)
        print("  2. Please log in with your AH account", flush=True)
        print("  3. Once logged in, the scraper will continue automatically", flush=True)
        print("\n" + "="*60 + "\n", flush=True)
        
        # Go to AH homepage
        await self.page.goto("https://www.ah.nl/", wait_until="domcontentloaded")
        await asyncio.sleep(2)
        
        # Handle cookie popup
        await self.handle_cookie_popup()
        
        # Check if already logged in
        logged_in = await self.check_logged_in()
        
        if logged_in:
            print("[OK] Already logged in! Proceeding with scraping...\n", flush=True)
            return True
            
        # Navigate to login page
        print("[INFO] Please log in to your AH account...", flush=True)
        await self.page.goto("https://www.ah.nl/mijn/inloggen", wait_until="domcontentloaded")
        await asyncio.sleep(2)
        
        # Wait for login (check every 3 seconds for up to 5 minutes)
        max_wait = 300  # 5 minutes
        waited = 0
        
        while waited < max_wait:
            await asyncio.sleep(3)
            waited += 3
            
            logged_in = await self.check_logged_in()
            if logged_in:
                print("\n[OK] Login successful! Starting scraper...\n", flush=True)
                return True
                
            if waited % 30 == 0:
                print(f"[INFO] Waiting for login... ({waited}s)", flush=True)
                
        print("\n[ERROR] Login timeout. Please try again.", flush=True)
        return False
        
    async def check_logged_in(self) -> bool:
        """Check if user is logged in."""
        try:
            # Look for logged-in indicators
            logged_in_indicators = [
                '[data-testhook="customer-menu"]',
                '[class*="logged-in"]',
                'a[href*="/mijn/bestellingen"]',
                'text="Mijn bestellingen"',
            ]
            
            for selector in logged_in_indicators:
                try:
                    elem = await self.page.query_selector(selector)
                    if elem:
                        return True
                except:
                    pass
                    
            # Also check URL - if redirected away from login page
            url = self.page.url
            if '/mijn/' in url and '/inloggen' not in url:
                return True
                
            return False
            
        except:
            return False
            
    async def handle_cookie_popup(self):
        """Handle the AH privacy/cookie popup."""
        try:
            cookie_popup = self.page.locator('[data-testid="cookie-popup"]')
            try:
                await cookie_popup.wait_for(state="visible", timeout=5000)
                
                # Use JavaScript to click Accepteren
                await self.page.evaluate('''() => {
                    const buttons = document.querySelectorAll('button');
                    for (const btn of buttons) {
                        if (btn.innerText.includes('Accepteren')) {
                            btn.click();
                            return true;
                        }
                    }
                    return false;
                }''')
                
                await cookie_popup.wait_for(state="hidden", timeout=5000)
                print("[OK] Cookie popup dismissed", flush=True)
                
            except:
                pass  # No popup
                
        except:
            pass
            
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
                await self.handle_cookie_popup()
                
            # Scroll to load more products (AH uses infinite scroll)
            scroll_count = 5 if max_products == 0 or max_products > 50 else 3
            for i in range(scroll_count):
                await self.page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
                await asyncio.sleep(1.5)
                print(f"  Scrolling... ({i+1}/{scroll_count})", flush=True)
                
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
            await asyncio.sleep(1.5)
            
            # Get product name
            try:
                title_elem = await self.page.query_selector('h1')
                if title_elem:
                    name = await title_elem.inner_text()
                    if name and len(name.strip()) > 2:
                        product['name'] = name.strip()
                        product['normalized_name'] = normalize_name(product['name'])
            except:
                pass
                
            # Fallback name from URL
            if not product.get('name'):
                url_match = re.search(r'/wi\d+/([^/?]+)', url)
                if url_match:
                    product['name'] = url_match.group(1).replace('-', ' ').title()
                    product['normalized_name'] = normalize_name(product['name'])
                    
            print(f"  -> {product.get('name', product['id'])[:50]}...", flush=True, end='')
            
            # Get image
            try:
                img = await self.page.query_selector('main img[src*="static.ah.nl"]')
                if img:
                    src = await img.get_attribute('src')
                    if src:
                        product['image_url'] = src
            except:
                pass
                
            # Get price
            try:
                price_text = await self.page.inner_text('[class*="price"]')
                match = re.search(r'(\d+)[.,](\d{2})', price_text)
                if match:
                    product['price'] = float(f"{match.group(1)}.{match.group(2)}")
            except:
                pass
            
            content = await self.page.content()
            content_lower = content.lower()
            
            found = []
            
            # Vegan/Vegetarian
            if any(x in content_lower for x in ['vegan', 'veganistisch', 'plantaardig']):
                product['is_vegan'] = True
                product['is_vegetarian'] = True
                found.append('🌱 Vegan')
            elif any(x in content_lower for x in ['vegetarisch', 'geschikt voor vegetariërs']):
                product['is_vegetarian'] = True
                found.append('🥬 Vegetarian')
                
            # Organic/Bio
            if any(x in content_lower for x in ['biologisch', 'ah biologisch', 'eko-keurmerk', 'demeter']):
                product['is_organic'] = True
                found.append('🌿 Bio')
                
            # Fairtrade
            if any(x in content_lower for x in ['fairtrade', 'fair trade', 'max havelaar', 'utz', 'rainforest alliance']):
                product['is_fairtrade'] = True
                found.append('🤝 Fairtrade')
                
            # Nutri-Score
            nutri_match = re.search(r'nutri-?score["\s:]*([a-eA-E])', content, re.IGNORECASE)
            if nutri_match:
                product['nutri_score'] = nutri_match.group(1).upper()
                found.append(f'NS: {product["nutri_score"]}')
                
            # ===== ORIGIN / HERKOMST =====
            try:
                # Click Herkomst accordion via JavaScript
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
                                
                            line_lower = line.lower()
                            for month_nl, month_key in MONTH_NAMES.items():
                                if line_lower.startswith(month_nl):
                                    country_part = line[len(month_nl):].strip()
                                    
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
                            current_month = datetime.now().strftime('%b').lower()
                            if current_month in origin_by_month:
                                product['origin_country'] = origin_by_month[current_month][0]
                                found.append(f'📍 {product["origin_country"]}')
                                
            except:
                pass
                
            # Fallback origin from page text
            if not product.get('origin_country'):
                origin_patterns = [
                    r'herkomst[:\s]+([A-Za-z\-]+)',
                    r'land van herkomst[:\s]+([A-Za-z\-]+)',
                ]
                for pattern in origin_patterns:
                    match = re.search(pattern, content, re.IGNORECASE)
                    if match:
                        country_raw = match.group(1).strip().lower()
                        if country_raw in COUNTRY_MAPPINGS:
                            product['origin_country'] = COUNTRY_MAPPINGS[country_raw]
                            found.append(f'📍 {product["origin_country"]}')
                            break
                
            self.stats['details_scraped'] += 1
            
            if found:
                print(f" [{', '.join(found)}]", flush=True)
            else:
                print("", flush=True)
            
        except Exception as e:
            print(f" [ERROR: {e}]", flush=True)
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
            
            record = {k: v for k, v in record.items() if v is not None}
            
            self.supabase.table('products').upsert(record, on_conflict='id').execute()
            self.stats['products_saved'] += 1
            return True
            
        except Exception as e:
            print(f"    [DB ERROR] {e}", flush=True)
            return False
            
    async def run(self, limit: int = 0, delay: float = 1.0):
        """Run the scraper."""
        print("\n" + "="*60, flush=True)
        print("  AH LOGIN-BASED CATALOG SCRAPER", flush=True)
        print("="*60, flush=True)
        print(f"  Product limit: {limit if limit > 0 else 'No limit'}", flush=True)
        print(f"  Delay between products: {delay}s", flush=True)
        print("="*60, flush=True)
        
        self.connect_supabase()
        await self.setup()
        
        try:
            # Wait for user login
            if not await self.wait_for_login():
                print("\n[ERROR] Could not complete login. Exiting.", flush=True)
                return
                
            # PHASE 1: Collect products from categories
            print("\n" + "="*60, flush=True)
            print("  PHASE 1: COLLECTING PRODUCTS", flush=True)
            print("="*60, flush=True)
            
            if limit > 0 and limit <= 50:
                # Small limit - just use first category
                products = await self.scrape_category_products(AH_CATEGORIES[0], max_products=limit)
                self.products.extend(products)
            else:
                # Spread across categories
                products_per_category = (limit // len(AH_CATEGORIES) + 1) if limit > 0 else 0
                
                for category in AH_CATEGORIES:
                    if limit > 0 and len(self.products) >= limit:
                        break
                        
                    remaining = limit - len(self.products) if limit > 0 else 0
                    max_from_cat = min(products_per_category, remaining) if limit > 0 else 0
                    
                    products = await self.scrape_category_products(category, max_products=max_from_cat)
                    self.products.extend(products)
                    
            print(f"\n[PHASE 1] Collected {len(self.products)} products", flush=True)
            
            # PHASE 2: Scrape product details
            print("\n" + "="*60, flush=True)
            print("  PHASE 2: SCRAPING PRODUCT DETAILS", flush=True)
            print("="*60, flush=True)
            
            for i, product in enumerate(self.products):
                print(f"\n[{i+1}/{len(self.products)}]", flush=True)
                
                await self.scrape_product_details(product)
                self.save_product(product)
                
                if delay > 0:
                    await asyncio.sleep(delay)
                    
            # Save backup JSON
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            backup_file = f"ah_catalog_{timestamp}.json"
            with open(backup_file, 'w', encoding='utf-8') as f:
                json.dump(self.products, f, indent=2, ensure_ascii=False)
            print(f"\n[BACKUP] Saved to {backup_file}", flush=True)
            
            # Print summary
            print("\n" + "="*60, flush=True)
            print("  SCRAPING COMPLETE", flush=True)
            print("="*60, flush=True)
            print(f"  Categories scraped:   {self.stats['categories_scraped']}", flush=True)
            print(f"  Products found:       {self.stats['products_found']}", flush=True)
            print(f"  Details scraped:      {self.stats['details_scraped']}", flush=True)
            print(f"  Products saved to DB: {self.stats['products_saved']}", flush=True)
            print(f"  Errors:               {self.stats['errors']}", flush=True)
            print("="*60, flush=True)
            
            # Show products with origin data
            origin_products = [p for p in self.products if p.get('origin_by_month')]
            if origin_products:
                print(f"\n[ORIGIN DATA] {len(origin_products)} products with monthly origin:", flush=True)
                for p in origin_products[:5]:
                    print(f"  - {p['name']}: {p.get('origin_country', 'N/A')}", flush=True)
                    
        finally:
            await self.close()


async def main():
    parser = argparse.ArgumentParser(description='AH Login-Based Scraper')
    parser.add_argument('--limit', type=int, default=0, help='Max products to scrape (0 = no limit)')
    parser.add_argument('--delay', type=float, default=1.0, help='Delay between products (seconds)')
    
    args = parser.parse_args()
    
    scraper = AHLoginScraper()
    await scraper.run(limit=args.limit, delay=args.delay)


if __name__ == '__main__':
    asyncio.run(main())
