#!/usr/bin/env python3
"""
Albert Heijn Authenticated Full Scraper

Opens a browser for you to log in, then scrapes products with full details
including the Herkomst (origin by month) data.

Usage:
  python authenticated_scraper.py --test       # Test with 10 products
  python authenticated_scraper.py --limit 100  # Scrape 100 products
  python authenticated_scraper.py              # Scrape all products
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

MONTH_ABBREV_TO_KEY = {
    'jan': 'jan', 'januari': 'jan',
    'feb': 'feb', 'februari': 'feb',
    'mrt': 'mar', 'mar': 'mar', 'maart': 'mar',
    'apr': 'apr', 'april': 'apr',
    'mei': 'may', 'may': 'may',
    'jun': 'jun', 'juni': 'jun',
    'jul': 'jul', 'juli': 'jul',
    'aug': 'aug', 'augustus': 'aug',
    'sep': 'sep', 'sept': 'sep', 'september': 'sep',
    'okt': 'oct', 'oct': 'oct', 'oktober': 'oct',
    'nov': 'nov', 'november': 'nov',
    'dec': 'dec', 'december': 'dec',
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
    if not name:
        return ''
    return re.sub(r'[^a-z0-9]', '', name.lower())


def extract_product_id(url: str) -> Optional[str]:
    match = re.search(r'/product/(wi\d+)', url)
    if match:
        return match.group(1)
    return None


def parse_origin_by_month(text: str) -> Dict[str, str]:
    """
    Parse origin text like:
    "januari - maart: Spanje, april - september: Nederland, oktober - december: Spanje"
    
    Returns: {"jan": "Spain", "feb": "Spain", "mar": "Spain", "apr": "Netherlands", ...}
    """
    origin_by_month = {}
    month_order = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    
    # Normalize text
    text = text.lower().strip()
    
    # Pattern: "month - month: country" or "month: country"
    # Split by comma or newline to get individual entries
    entries = re.split(r'[,\n]', text)
    
    for entry in entries:
        entry = entry.strip()
        if not entry:
            continue
            
        # Try to match "month - month: country" or "month t/m month: country"
        match = re.search(r'(\w+)\s*[-–t/m]+\s*(\w+)\s*[:\s]+(.+)', entry)
        if match:
            start_month_raw = match.group(1).strip()
            end_month_raw = match.group(2).strip()
            country_raw = match.group(3).strip()
        else:
            # Try "month: country"
            match = re.search(r'(\w+)\s*[:\s]+(.+)', entry)
            if match:
                start_month_raw = match.group(1).strip()
                end_month_raw = start_month_raw
                country_raw = match.group(2).strip()
            else:
                continue
        
        # Get month keys
        start_key = MONTH_ABBREV_TO_KEY.get(start_month_raw)
        end_key = MONTH_ABBREV_TO_KEY.get(end_month_raw)
        
        if not start_key:
            continue
            
        # Get country
        country = None
        country_raw_lower = country_raw.lower()
        for dutch, english in COUNTRY_MAPPINGS.items():
            if dutch in country_raw_lower:
                country = english
                break
        
        if not country:
            # Use raw if > 2 chars and looks like a country name
            if len(country_raw) > 2 and country_raw[0].isupper():
                country = country_raw.split()[0].title()
            else:
                continue
        
        # Fill in the month range
        if end_key:
            start_idx = month_order.index(start_key) if start_key in month_order else -1
            end_idx = month_order.index(end_key) if end_key in month_order else start_idx
            
            if start_idx >= 0:
                if end_idx < start_idx:  # Wraps around year (e.g., oct-feb)
                    for i in range(start_idx, 12):
                        origin_by_month[month_order[i]] = country
                    for i in range(0, end_idx + 1):
                        origin_by_month[month_order[i]] = country
                else:
                    for i in range(start_idx, end_idx + 1):
                        origin_by_month[month_order[i]] = country
        else:
            origin_by_month[start_key] = country
    
    return origin_by_month


class AuthenticatedScraper:
    """Scraper that runs after manual login."""
    
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
            'with_origin': 0,
            'errors': 0,
        }
        
    def connect_supabase(self) -> bool:
        url = os.getenv('SUPABASE_URL')
        key = os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_ANON_KEY')
        
        if not url or not key:
            print("[WARN] SUPABASE not configured - saving to JSON only", file=sys.stderr)
            return False
            
        self.supabase = create_client(url, key)
        print("[DB] Connected to Supabase", flush=True)
        return True
        
    async def setup(self):
        """Initialize browser."""
        self._playwright = await async_playwright().start()
        
        self.browser = await self._playwright.chromium.launch(
            headless=False,
            args=['--disable-blink-features=AutomationControlled', '--no-sandbox']
        )
        
        self.context = await self.browser.new_context(
            viewport={'width': 1400, 'height': 900},
            locale='nl-NL',
            timezone_id='Europe/Amsterdam',
            user_agent='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
        )
        
        await self.context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        """)
        
        self.page = await self.context.new_page()
        
    async def close(self):
        if self.browser:
            await self.browser.close()
        if self._playwright:
            await self._playwright.stop()
            
    async def wait_for_login(self):
        """Navigate to AH and wait for user to log in."""
        print("\n" + "="*60, flush=True)
        print("  PLEASE LOG IN TO YOUR ALBERT HEIJN ACCOUNT", flush=True)
        print("="*60, flush=True)
        
        # Go to login page
        await self.page.goto('https://www.ah.nl/mijn/inloggen', wait_until='domcontentloaded')
        await asyncio.sleep(2)
        
        # Handle cookie popup
        try:
            cookie_btn = await self.page.query_selector('button:has-text("Accepteer")')
            if cookie_btn:
                await cookie_btn.click()
                print("[OK] Accepted cookies", flush=True)
                await asyncio.sleep(1)
        except:
            pass
        
        print("\n>>> Please log in to your AH account in the browser window <<<", flush=True)
        print(">>> The scraper will continue automatically once you're logged in <<<\n", flush=True)
        
        # Wait for login - check for account page or logged-in indicators
        max_wait = 600  # 10 minutes
        start = asyncio.get_event_loop().time()
        
        while True:
            await asyncio.sleep(2)
            
            try:
                # Check if logged in (look for account indicators)
                is_logged_in = await self.page.evaluate('''
                    () => {
                        // Check various indicators
                        const text = document.body.innerText.toLowerCase();
                        const hasAccountLink = document.querySelector('a[href*="/mijn/"]') !== null;
                        const hasLogout = text.includes('uitloggen') || text.includes('log out');
                        const hasGreeting = text.includes('welkom') || text.includes('hallo');
                        const notOnLoginPage = !window.location.href.includes('/inloggen');
                        
                        return (hasAccountLink || hasLogout || hasGreeting) && notOnLoginPage;
                    }
                ''')
                
                if is_logged_in:
                    print("\n[OK] Login detected! Starting scraper...\n", flush=True)
                    await asyncio.sleep(2)
                    return True
                    
            except Exception as e:
                # Page might be navigating, just continue
                pass
                
            elapsed = asyncio.get_event_loop().time() - start
            if elapsed > max_wait:
                print("\n[ERROR] Login timeout - please try again", flush=True)
                return False
                
            # Show waiting message every 30 seconds
            if int(elapsed) % 30 == 0 and int(elapsed) > 0:
                remaining = int(max_wait - elapsed)
                print(f"  Still waiting for login... ({remaining}s remaining)", flush=True)
                
    async def scrape_category_products(self, category: Dict[str, str], max_products: int = 0) -> List[Dict[str, Any]]:
        """Scrape product listings from a category."""
        products = []
        category_url = f"https://www.ah.nl/{category['slug']}"
        
        print(f"\n[CATEGORY] {category['name']}", flush=True)
        
        try:
            await self.page.goto(category_url, wait_until='domcontentloaded', timeout=30000)
            await asyncio.sleep(3)
            
            # Scroll to load more
            for _ in range(3):
                await self.page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
                await asyncio.sleep(1)
            
            # Find product links
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
                    
                except:
                    self.stats['errors'] += 1
                    
            self.stats['categories_scraped'] += 1
            print(f"  Collected {len(products)} products", flush=True)
            
        except Exception as e:
            print(f"  [ERROR] {e}", flush=True)
            self.stats['errors'] += 1
            
        return products
        
    async def scrape_product_details(self, product: Dict[str, Any]) -> Dict[str, Any]:
        """Scrape full details from a product page including Herkomst."""
        url = product.get('url')
        if not url:
            return product
            
        try:
            await self.page.goto(url, wait_until='domcontentloaded', timeout=20000)
            await asyncio.sleep(2)
            
            # Get product name from page
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
                    
            print(f"  -> {product.get('name', product['id'])[:50]}...", flush=True)
            
            # Get image
            try:
                img = await self.page.query_selector('main img[src*="static.ah.nl"]')
                if img:
                    src = await img.get_attribute('src')
                    if src:
                        product['image_url'] = src
            except:
                pass
            
            # Scroll down to load all sections
            await self.page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
            await asyncio.sleep(1)
            
            # Click on Herkomst to expand it
            try:
                herkomst_btn = await self.page.query_selector('button:has-text("Herkomst")')
                if herkomst_btn:
                    await herkomst_btn.scroll_into_view_if_needed()
                    await asyncio.sleep(0.3)
                    await herkomst_btn.click()
                    await asyncio.sleep(1)
            except:
                pass
            
            # Get page content for analysis
            content = await self.page.content()
            content_lower = content.lower()
            
            # Get visible text
            body = await self.page.query_selector('body')
            visible_text = await body.inner_text() if body else ""
            
            # ===== VEGAN/VEGETARIAN =====
            if any(x in content_lower for x in ['vegan', 'geschikt voor veganisten', 'plantaardig']):
                product['is_vegan'] = True
                product['is_vegetarian'] = True
            elif any(x in content_lower for x in ['vegetarisch', 'geschikt voor vegetariërs']):
                product['is_vegetarian'] = True
                
            # ===== ORGANIC =====
            if any(x in content_lower for x in ['biologisch', 'ah biologisch', 'eko-keurmerk', 'organic', 'demeter']):
                product['is_organic'] = True
                
            # ===== FAIRTRADE =====
            if any(x in content_lower for x in ['fairtrade', 'fair trade', 'max havelaar', 'utz certified', 'rainforest alliance']):
                product['is_fairtrade'] = True
                
            # ===== NUTRI-SCORE =====
            nutri_match = re.search(r'nutri-?score["\s:]*([a-eA-E])', content, re.IGNORECASE)
            if nutri_match:
                product['nutri_score'] = nutri_match.group(1).upper()
                
            # ===== HERKOMST / ORIGIN =====
            # Look for Herkomst section in visible text
            lines = visible_text.split('\n')
            herkomst_text = ""
            in_herkomst = False
            
            for line in lines:
                line_stripped = line.strip()
                if 'herkomst' in line_stripped.lower() and len(line_stripped) < 30:
                    in_herkomst = True
                    continue
                elif in_herkomst:
                    if any(x in line_stripped.lower() for x in ['contactgegevens', 'kenmerken', 'voedingswaarden', 'ingrediënten']):
                        break
                    if line_stripped:
                        herkomst_text += line_stripped + " "
            
            if herkomst_text:
                # Parse monthly origin
                origin_by_month = parse_origin_by_month(herkomst_text)
                if origin_by_month:
                    product['origin_by_month'] = origin_by_month
                    self.stats['with_origin'] += 1
                    print(f"    📍 Origin: {origin_by_month}", flush=True)
                    
                # Also try to extract single origin country
                for country_nl, country_en in COUNTRY_MAPPINGS.items():
                    if country_nl in herkomst_text.lower():
                        product['origin_country'] = country_en
                        break
            
            # Also check HTML for origin patterns
            if not product.get('origin_country'):
                for pattern in [r'herkomst[:\s]+([A-Za-z\-]+)', r'land van herkomst[:\s]+([A-Za-z\-]+)']:
                    match = re.search(pattern, content, re.IGNORECASE)
                    if match:
                        country_raw = match.group(1).strip().lower()
                        if country_raw in COUNTRY_MAPPINGS:
                            product['origin_country'] = COUNTRY_MAPPINGS[country_raw]
                            break
            
            self.stats['details_scraped'] += 1
            
            # Show what we found
            details = []
            if product.get('is_organic'): details.append('🌿 Bio')
            if product.get('is_vegan'): details.append('🌱 Vegan')
            if product.get('is_fairtrade'): details.append('🤝 Fairtrade')
            if product.get('origin_country'): details.append(f"📍 {product['origin_country']}")
            if product.get('nutri_score'): details.append(f"NS:{product['nutri_score']}")
            
            if details:
                print(f"    {', '.join(details)}", flush=True)
            
        except Exception as e:
            print(f"    [ERROR] {e}", flush=True)
            self.stats['errors'] += 1
            
        return product
        
    def save_product(self, product: Dict[str, Any]) -> bool:
        """Save product to Supabase."""
        if not self.supabase:
            return False
            
        try:
            record = {
                'id': product['id'],
                'name': product.get('name', f"Product {product['id']}"),
                'normalized_name': product.get('normalized_name'),
                'url': product.get('url'),
                'image_url': product.get('image_url'),
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
            
    async def run(self, limit: int = 0, delay: float = 1.5):
        """Run the authenticated scraper."""
        print("\n" + "="*60, flush=True)
        print("  ALBERT HEIJN AUTHENTICATED SCRAPER", flush=True)
        print("="*60, flush=True)
        print(f"  Product limit: {limit if limit > 0 else 'No limit'}", flush=True)
        print(f"  Delay: {delay}s between products", flush=True)
        print("="*60, flush=True)
        
        self.connect_supabase()
        await self.setup()
        
        try:
            # Step 1: Wait for login
            logged_in = await self.wait_for_login()
            if not logged_in:
                return
                
            # Step 2: Collect products from categories
            print("\n" + "="*60, flush=True)
            print("  PHASE 1: COLLECTING PRODUCTS", flush=True)
            print("="*60, flush=True)
            
            if limit > 0 and limit <= 20:
                # Small limit - just use first category
                products = await self.scrape_category_products(AH_CATEGORIES[0], max_products=limit)
                self.products.extend(products)
            else:
                for category in AH_CATEGORIES:
                    remaining = limit - len(self.products) if limit > 0 else 0
                    products = await self.scrape_category_products(category, max_products=remaining if limit > 0 else 0)
                    self.products.extend(products)
                    
                    if limit > 0 and len(self.products) >= limit:
                        break
                        
                    await asyncio.sleep(2)
                    
            print(f"\n[PHASE 1 COMPLETE] Collected {len(self.products)} products", flush=True)
            
            # Step 3: Scrape details for each product
            print("\n" + "="*60, flush=True)
            print("  PHASE 2: SCRAPING PRODUCT DETAILS (with origin)", flush=True)
            print("="*60, flush=True)
            
            for i, product in enumerate(self.products, 1):
                print(f"\n[{i}/{len(self.products)}]", flush=True)
                
                await self.scrape_product_details(product)
                
                if self.supabase:
                    self.save_product(product)
                    
                await asyncio.sleep(delay)
                
        finally:
            # Save to JSON
            output_file = f"ah_authenticated_catalog_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(self.products, f, indent=2, ensure_ascii=False)
            print(f"\n[BACKUP] Saved to {output_file}", flush=True)
            
            await self.close()
            
        # Summary
        print("\n" + "="*60, flush=True)
        print("  SCRAPING COMPLETE", flush=True)
        print("="*60, flush=True)
        print(f"  Categories scraped:   {self.stats['categories_scraped']}", flush=True)
        print(f"  Products found:       {self.stats['products_found']}", flush=True)
        print(f"  Details scraped:      {self.stats['details_scraped']}", flush=True)
        print(f"  With origin data:     {self.stats['with_origin']}", flush=True)
        print(f"  Saved to database:    {self.stats['products_saved']}", flush=True)
        print(f"  Errors:               {self.stats['errors']}", flush=True)
        print("="*60, flush=True)
        
        # Show examples with origin
        with_origin = [p for p in self.products if p.get('origin_by_month')]
        if with_origin:
            print("\n[EXAMPLES] Products with monthly origin data:", flush=True)
            for p in with_origin[:5]:
                print(f"  - {p.get('name', p['id'])[:40]}", flush=True)
                print(f"      {p.get('origin_by_month')}", flush=True)


async def main():
    parser = argparse.ArgumentParser(description='AH Authenticated Scraper')
    parser.add_argument('--test', action='store_true', help='Test mode: 10 products')
    parser.add_argument('--limit', '-l', type=int, default=0, help='Max products (0 = no limit)')
    parser.add_argument('--delay', '-d', type=float, default=1.5, help='Delay between products')
    
    args = parser.parse_args()
    
    limit = 10 if args.test else args.limit
    
    scraper = AuthenticatedScraper()
    await scraper.run(limit=limit, delay=args.delay)


if __name__ == '__main__':
    asyncio.run(main())
