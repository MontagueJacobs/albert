#!/usr/bin/env python3
"""
Albert Heijn Full Catalog Scraper

Scrapes products from all AH category pages AND their detail pages in one run.
Handles the cookie/privacy popup automatically.

Usage:
  python full_scraper.py --test              # Test with 10 products
  python full_scraper.py --limit 100         # Scrape 100 products with details
  python full_scraper.py                     # Scrape entire catalog (thousands of products)
  python full_scraper.py -c diepvries        # Scrape one category only
  python full_scraper.py --force             # Re-scrape products already in DB
  python full_scraper.py --list-categories   # Show all available categories

The scraper:
1. Opens a visible browser window (AH blocks headless)
2. Handles the cookie/privacy popup
3. Scrolls through category pages until all products are loaded
4. Visits each product page to get detailed info (origin, fairtrade, organic, etc.)
5. Saves everything to Supabase (with resume support — skips already-enriched products)
"""

import asyncio
import argparse
import json
import os
import sys
import re
import textwrap
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

# Import the comprehensive detail scraper to reuse its extraction logic
try:
    from product_detail_scraper import AHProductDetailScraper
except ImportError:
    print("ERROR: product_detail_scraper.py not found in server/ directory", file=sys.stderr)
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

# AH categories — complete list from ah.nl/producten navigation
# Excludes personal pages (Eerder gekocht, Ontdek nieuwe producten) and deals (AH Voordeelshop)
AH_CATEGORIES = [
    # --- Food ---
    {'slug': 'producten/aardappel-groente-fruit', 'name': 'Aardappel, groente, fruit'},
    {'slug': 'producten/maaltijden-salades', 'name': 'Maaltijden, salades'},
    {'slug': 'producten/vlees-kip-vis-vega', 'name': 'Vlees, kip, vis, vega'},
    {'slug': 'producten/vegetarisch-vegan', 'name': 'Vegetarisch, vegan'},
    {'slug': 'producten/kaas-vleeswaren-tapas', 'name': 'Kaas, vleeswaren, tapas'},
    {'slug': 'producten/zuivel-plantaardig-eieren', 'name': 'Zuivel, plantaardig, eieren'},
    {'slug': 'producten/bakkerij-banket', 'name': 'Bakkerij, banket'},
    {'slug': 'producten/ontbijtgranen-beleg', 'name': 'Ontbijtgranen, beleg'},
    {'slug': 'producten/pasta-rijst-internationale-keuken', 'name': 'Pasta, rijst, internationale keuken'},
    {'slug': 'producten/soepen-conserven-sauzen-olie', 'name': 'Soepen, conserven, sauzen, oliën'},
    {'slug': 'producten/snoep-koek-chips', 'name': 'Snoep, koek, chips'},
    {'slug': 'producten/borrel-chips-noten', 'name': 'Borrel, chips, noten'},
    {'slug': 'producten/tussendoortjes-koek', 'name': 'Tussendoortjes, koek'},
    {'slug': 'producten/koffie-thee', 'name': 'Koffie, thee'},
    {'slug': 'producten/frisdrank-sappen-water', 'name': 'Frisdrank, sappen, water'},
    {'slug': 'producten/wijn-bier-sterke-drank', 'name': 'Wijn, bier, sterke drank'},
    {'slug': 'producten/diepvries', 'name': 'Diepvries'},
    # --- Special diets ---
    {'slug': 'producten/glutenvrij', 'name': 'Glutenvrij'},
    {'slug': 'producten/gezondheid-en-sport', 'name': 'Gezondheid en sport'},
    # --- Non-food ---
    {'slug': 'producten/baby-en-kind', 'name': 'Baby en kind'},
    {'slug': 'producten/dieren', 'name': 'Dieren'},
    {'slug': 'producten/drogisterij', 'name': 'Drogisterij'},
    {'slug': 'producten/huishouden', 'name': 'Huishouden'},
    {'slug': 'producten/koken-tafelen-vrije-tijd', 'name': 'Koken, tafelen, vrije tijd'},
    # --- Seasonal ---
    {'slug': 'producten/pasen', 'name': 'Pasen'},
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
            'details_skipped': 0,
            'products_saved': 0,
            'errors': 0,
        }
        self.existing_product_ids: Set[str] = set()
        
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

    def load_existing_product_ids(self):
        """Load IDs of products that already have full detail data in the DB."""
        if not self.supabase:
            return
        try:
            # Products with details_scrape_status = 'success' are fully enriched
            result = self.supabase.table('products').select('id') \
                .eq('details_scrape_status', 'success') \
                .execute()
            if result.data:
                self.existing_product_ids = {row['id'] for row in result.data}
                print(f"[DB] {len(self.existing_product_ids)} products already fully scraped in DB", flush=True)
        except Exception as e:
            print(f"[WARN] Could not load existing products: {e}", flush=True)
        
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
        """Scrape product listings from a category page with aggressive scrolling."""
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

            # Check if page loaded correctly (not a 404 or empty page)
            title = await self.page.title()
            if '404' in title or 'niet gevonden' in title.lower():
                print(f"  [SKIP] Category page not found (404)", flush=True)
                return products

            # --- Aggressive scroll: keep going until no new product links appear ---
            prev_count = 0
            stale_rounds = 0
            max_stale = 3  # stop after 3 consecutive scrolls with no new products
            scroll_round = 0

            while stale_rounds < max_stale:
                scroll_round += 1

                # Click "Bekijk meer" / "Toon meer producten" buttons if present
                try:
                    load_more = await self.page.query_selector(
                        'button:has-text("Bekijk meer"), '
                        'button:has-text("Toon meer"), '
                        'button:has-text("Laad meer"), '
                        'a:has-text("Bekijk meer")'
                    )
                    if load_more and await load_more.is_visible():
                        await load_more.click()
                        await asyncio.sleep(2)
                except Exception:
                    pass

                # Scroll to bottom
                await self.page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
                await asyncio.sleep(1.5)

                cur_count = await self.page.evaluate(
                    'document.querySelectorAll(\'a[href*="/producten/product/"]\').length'
                )

                if cur_count > prev_count:
                    stale_rounds = 0
                    prev_count = cur_count
                else:
                    stale_rounds += 1

                # Safety cap to avoid infinite scrolling on huge categories
                if scroll_round >= 80:
                    print(f"  [INFO] Reached scroll cap ({scroll_round} rounds, {cur_count} links)", flush=True)
                    break

            print(f"  Scrolled {scroll_round} rounds, found {prev_count} product links", flush=True)

            # Extract product data via JS — walk up from each <a> to find the card
            raw_products = await self.page.evaluate('''() => {
                const links = document.querySelectorAll('a[href*="/producten/product/"]');
                const results = [];
                const seen = new Set();

                for (const a of links) {
                    const href = a.getAttribute('href');
                    if (!href || seen.has(href)) continue;
                    seen.add(href);

                    // Walk up to the product card (typically 3-6 levels)
                    let card = a;
                    for (let i = 0; i < 6; i++) {
                        if (card.parentElement) card = card.parentElement;
                    }

                    // Name: try multiple selectors
                    let name = '';
                    const nameEl = card.querySelector('[class*="title"], [data-testhook*="title"], [class*="product-title"]')
                        || a.querySelector('[class*="title"], span');
                    if (nameEl) name = nameEl.innerText.split('\\n')[0].trim();

                    // Fallback: the link's own text content
                    if (!name || name.length < 3) {
                        const linkText = a.innerText.trim().split('\\n')[0].trim();
                        if (linkText.length > 2) name = linkText;
                    }

                    // Price
                    let price = null;
                    const priceEl = card.querySelector('[class*="price"]');
                    if (priceEl) {
                        const m = priceEl.innerText.match(/(\\d+)[.,](\\d{2})/);
                        if (m) price = parseFloat(m[1] + '.' + m[2]);
                    }

                    // Image
                    let image = null;
                    const img = card.querySelector('img');
                    if (img && img.src && !img.src.startsWith('data:')) {
                        image = img.src;
                    }

                    results.push({ href, name, price, image });
                }
                return results;
            }''')

            print(f"  Found {len(raw_products)} unique product links", flush=True)

            for item in raw_products:
                if max_products > 0 and len(products) >= max_products:
                    break

                href = item.get('href', '')
                product_id = extract_product_id(href)
                if not product_id or product_id in self.seen_ids:
                    continue

                self.seen_ids.add(product_id)

                name = (item.get('name') or '').strip()

                # Fallback: extract name from URL slug
                if not name or len(name) < 3:
                    url_match = re.search(r'/wi\d+/([^/?]+)', href)
                    if url_match:
                        name = url_match.group(1).replace('-', ' ').title()

                if not name or len(name) < 3:
                    continue

                product = {
                    'id': product_id,
                    'url': f"https://www.ah.nl{href}" if href.startswith('/') else href,
                    'category': category['name'],
                    'name': name,
                    'normalized_name': normalize_name(name),
                }
                if item.get('price'):
                    product['price'] = item['price']
                if item.get('image'):
                    product['image_url'] = item['image']

                products.append(product)
                self.stats['products_found'] += 1
                    
            self.stats['categories_scraped'] += 1
            print(f"  Collected {len(products)} products from this category", flush=True)
            
        except Exception as e:
            print(f"  [ERROR] {e}", flush=True)
            self.stats['errors'] += 1
            
        return products
        
    async def scrape_product_details(self, product: Dict[str, Any]) -> Dict[str, Any]:
        """Scrape full product details by delegating to AHProductDetailScraper.
        
        Reuses the comprehensive extraction logic from product_detail_scraper.py
        which handles JSON-LD, nutrition tables, ingredients, unit size,
        allergens, origin, and all certifications.
        """
        url = product.get('url')
        if not url:
            return product

        try:
            # Use the detail scraper with our existing page
            if not hasattr(self, '_detail_scraper'):
                self._detail_scraper = AHProductDetailScraper(headless=False)
                # Inject our browser page so it doesn't open a second browser
                self._detail_scraper.page = self.page

            result = await self._detail_scraper.scrape_product(url)

            print(f"  -> {product.get('name', product['id'])[:50]}", flush=True)

            # Map the detail scraper result onto our product dict.
            # Only overwrite with non-None values.
            field_map = [
                'is_vegan', 'is_vegetarian', 'is_organic', 'is_fairtrade',
                'nutri_score', 'origin_country', 'origin_by_month',
                'brand', 'unit_size', 'price', 'image_url',
                'ingredients', 'nutrition_text', 'nutrition_json',
                'allergens',
            ]
            for field in field_map:
                val = result.get(field)
                if val is not None and val != [] and val != '':
                    product[field] = val

            # Update name from detail page if we got a better one
            # (the category listing names can be truncated)
            # We only take it if the h1 was captured by the detail scraper
            # (the detail scraper doesn't return 'name' so we read h1 ourselves)
            try:
                title_elem = await self.page.query_selector('h1')
                if title_elem:
                    name = (await title_elem.inner_text()).strip()
                    if name and len(name) > 2:
                        product['name'] = name
                        product['normalized_name'] = normalize_name(name)
            except:
                pass

            # Mark scrape status
            product['details_scrape_status'] = 'success' if result.get('success') else 'pending'
            product['details_scraped_at'] = result.get('scraped_at') or datetime.now().isoformat()

            self.stats['details_scraped'] += 1

        except Exception as e:
            print(f"    [ERROR] {e}", flush=True)
            product['details_scrape_status'] = 'failed'
            self.stats['errors'] += 1

        return product
        
    def save_product(self, product: Dict[str, Any]) -> bool:
        """Save a product to Supabase with all detail fields."""
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
                'brand': product.get('brand'),
                'unit_size': product.get('unit_size'),
                'ingredients': product.get('ingredients'),
                'nutrition_text': product.get('nutrition_text'),
                'nutrition_json': product.get('nutrition_json'),
                'allergens': product.get('allergens'),
                'details_scrape_status': product.get('details_scrape_status'),
                'details_scraped_at': product.get('details_scraped_at'),
                'source': 'scraped',
                'last_seen_at': datetime.now().isoformat(),
            }
            
            # Remove None values (but keep False and empty lists)
            record = {k: v for k, v in record.items() if v is not None}
            
            self.supabase.table('products').upsert(record, on_conflict='id').execute()
            self.stats['products_saved'] += 1
            return True
            
        except Exception as e:
            print(f"    [DB ERROR] {e}", flush=True)
            return False
            
    async def run(self, limit: int = 0, delay: float = 1.5,
                  categories: Optional[List[str]] = None, force: bool = False):
        """
        Run the full scraper.
        
        Args:
            limit: Max products to scrape (0 = no limit)
            delay: Seconds between product detail requests
            categories: Specific categories to scrape (None = all)
            force: Re-scrape details even if product already enriched in DB
        """
        print("\n" + "="*60, flush=True)
        print("  ALBERT HEIJN FULL CATALOG SCRAPER", flush=True)
        print("="*60, flush=True)
        print(f"  Product limit: {limit if limit > 0 else 'No limit'}", flush=True)
        print(f"  Delay between products: {delay}s", flush=True)
        print(f"  Force re-scrape:  {force}", flush=True)
        print("="*60, flush=True)
        print("\n[INFO] A browser window will open. Keep it visible!", flush=True)
        print("[INFO] The scraper will handle the cookie popup automatically.\n", flush=True)
        
        self.connect_supabase()

        # Load existing product IDs for resume support
        if not force:
            self.load_existing_product_ids()

        await self.setup()
        
        try:
            # PHASE 1: Collect product URLs from categories
            print("\n" + "="*60, flush=True)
            print("  PHASE 1: COLLECTING PRODUCTS FROM CATEGORIES", flush=True)
            print("="*60, flush=True)
            
            cats_to_scrape = AH_CATEGORIES
            if categories:
                cats_to_scrape = [
                    c for c in AH_CATEGORIES
                    if c['slug'] in categories
                    or c['slug'].split('/')[-1] in [x.lower().replace(' ', '-') for x in categories]
                    or c['name'].lower() in [x.lower() for x in categories]
                ]
                if not cats_to_scrape:
                    print(f"[ERROR] No matching categories for: {categories}", flush=True)
                    print("  Available:", flush=True)
                    for c in AH_CATEGORIES:
                        print(f"    {c['slug'].split('/')[-1]:40s}  {c['name']}", flush=True)
                    return
                
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
                pid = product.get('id', '?')

                # Resume support: skip products already enriched in DB
                if not force and pid in self.existing_product_ids:
                    self.stats['details_skipped'] += 1
                    # Still save the listing data (updates last_seen_at)
                    if self.supabase:
                        self.save_product(product)
                    if i % 50 == 0:
                        print(f"  [{i}/{len(self.products)}] skipped (already enriched)…", flush=True)
                    continue

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
                if product.get('unit_size'): details.append(f"📦 {product['unit_size']}")
                if product.get('ingredients'): details.append(f"🧪 ingredients")
                if product.get('nutrition_json'): details.append(f"📊 nutrition")
                
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
        print(f"  Categories scraped:   {self.stats['categories_scraped']}", flush=True)
        print(f"  Products found:       {self.stats['products_found']}", flush=True)
        print(f"  Details scraped:      {self.stats['details_scraped']}", flush=True)
        print(f"  Details skipped:      {self.stats['details_skipped']}", flush=True)
        print(f"  Products saved to DB: {self.stats['products_saved']}", flush=True)
        print(f"  Errors:               {self.stats['errors']}", flush=True)
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
    parser = argparse.ArgumentParser(
        description='AH Full Catalog Scraper',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""\
            examples:
              %(prog)s --test                          Test with 10 products
              %(prog)s --limit 200                     Scrape 200 products
              %(prog)s -c diepvries -c bakkerij-banket  Only specific categories
              %(prog)s --force                         Re-scrape even if already in DB
              %(prog)s --list-categories                Show available categories
        """),
    )
    parser.add_argument('--test', action='store_true',
                        help='Test mode: scrape only 10 products')
    parser.add_argument('--limit', '-l', type=int, default=0,
                        help='Maximum products to scrape (0 = no limit)')
    parser.add_argument('--delay', '-d', type=float, default=1.5,
                        help='Delay between product detail requests (default: 1.5s)')
    parser.add_argument('--category', '-c', action='append',
                        help='Specific category slug or name (can use multiple times)')
    parser.add_argument('--force', '-f', action='store_true',
                        help='Force re-scrape of products already enriched in DB')
    parser.add_argument('--list-categories', action='store_true',
                        help='List all available categories and exit')
    
    args = parser.parse_args()

    if args.list_categories:
        print(f"\nAvailable AH categories ({len(AH_CATEGORIES)}):\n")
        for c in AH_CATEGORIES:
            slug = c['slug'].split('/')[-1]
            print(f"  {slug:40s}  {c['name']}")
        print(f"\nUse: {sys.argv[0]} -c <slug>")
        return
    
    limit = 10 if args.test else args.limit
    
    scraper = AHFullScraper()
    await scraper.run(limit=limit, delay=args.delay, categories=args.category,
                      force=args.force)


if __name__ == '__main__':
    asyncio.run(main())