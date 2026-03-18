#!/usr/bin/env python3
"""
Albert Heijn Catalog Scraper

Scrapes product listings from AH's category pages to populate the products database.
This allows collecting product URLs which can then be used by batch_origin_scraper.py
to get detailed origin information.

Usage:
  python catalog_scraper.py                          # Scrape all categories
  python catalog_scraper.py --category "groente"     # Scrape specific category
  python catalog_scraper.py --limit 500              # Limit total products
  python catalog_scraper.py --dry-run                # Show what would be scraped
  python catalog_scraper.py --continue               # Continue from last position

The scraper:
1. Discovers all category pages on ah.nl
2. For each category, paginates through product listings
3. Extracts product info (name, URL, price, image, etc.)
4. Upserts products into the Supabase products table
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


# AH main categories to scrape
AH_CATEGORIES = [
    # Fresh produce
    {'slug': 'producten/aardappel-groente-fruit', 'name': 'Groente & Fruit'},
    {'slug': 'producten/vlees-kip-vis-vega', 'name': 'Vlees, Kip, Vis & Vega'},
    {'slug': 'producten/kaas-vleeswaren-tapas', 'name': 'Kaas & Vleeswaren'},
    {'slug': 'producten/zuivel-plantaardig-eieren', 'name': 'Zuivel & Eieren'},
    
    # Groceries
    {'slug': 'producten/bakkerij-banket', 'name': 'Bakkerij'},
    {'slug': 'producten/ontbijtgranen-beleg', 'name': 'Ontbijt & Beleg'},
    {'slug': 'producten/pasta-rijst-internationale-keuken', 'name': 'Pasta, Rijst & Wereldkeuken'},
    {'slug': 'producten/soepen-conserven-sauzen', 'name': 'Soepen & Sauzen'},
    {'slug': 'producten/snoep-koek-chips', 'name': 'Snoep & Koek'},
    {'slug': 'producten/koffie-thee', 'name': 'Koffie & Thee'},
    {'slug': 'producten/frisdrank-sappen-water', 'name': 'Dranken'},
    {'slug': 'producten/wijn-bier-sterke-drank', 'name': 'Wijn & Bier'},
    
    # Specialty
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
    # URLs like /producten/product/wi123456/ah-product-name
    match = re.search(r'/product/(wi\d+)', url)
    if match:
        return match.group(1)
    return None


class AHCatalogScraper:
    """Scrapes product catalog from Albert Heijn website.
    
    NOTE: AH blocks headless browsers. Must run with headless=False or use xvfb.
    On a server: xvfb-run python catalog_scraper.py
    """
    
    def __init__(self, headless: bool = False):  # Default to headed (AH blocks headless)
        self.headless = headless
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self._playwright = None
        self.supabase: Optional[Client] = None
        
        # Track scraped products
        self.seen_ids: Set[str] = set()
        
        # Stats
        self.stats = {
            'categories_scraped': 0,
            'products_found': 0,
            'products_new': 0,
            'products_updated': 0,
            'errors': 0,
        }
        
    def connect_supabase(self) -> bool:
        """Connect to Supabase."""
        url = os.getenv('SUPABASE_URL')
        key = os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_ANON_KEY')
        
        if not url or not key:
            print("[ERROR] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required", file=sys.stderr)
            return False
            
        self.supabase = create_client(url, key)
        print(f"[INFO] Connected to Supabase: {url}", flush=True)
        return True 
        
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
            
    async def accept_cookies(self):
        """Accept cookie consent if present."""
        try:
            accept_btn = await self.page.query_selector('button:has-text("Accepteer alle cookies")')
            if accept_btn:
                await accept_btn.click()
                await asyncio.sleep(1)
                print("[INFO] Accepted cookies", flush=True)
        except:
            pass
            
    async def scrape_category_page(self, category_url: str) -> List[Dict[str, Any]]:
        """
        Scrape a single category page for products.
        
        Returns list of product dicts with: id, name, url, image_url, price
        """
        products = []
        
        try:
            # Find all product links - this is the most reliable selector
            product_links = await self.page.query_selector_all('a[href*="/producten/product/"]')
            
            print(f"  Found {len(product_links)} product links", flush=True)
            
            seen_on_page = set()
            
            for link in product_links:
                try:
                    product = {}
                    
                    # Get product URL and ID
                    href = await link.get_attribute('href')
                    if not href:
                        continue
                        
                    product['url'] = f"https://www.ah.nl{href}" if href.startswith('/') else href
                    product['id'] = extract_product_id(href)
                    
                    if not product.get('id'):
                        continue
                        
                    # Skip duplicates on this page
                    if product['id'] in seen_on_page:
                        continue
                    seen_on_page.add(product['id'])
                    
                    # Skip if already seen globally
                    if product['id'] in self.seen_ids:
                        continue
                    self.seen_ids.add(product['id'])
                    
                    # Get the parent card/container to extract more info
                    # Walk up the DOM to find the product card container
                    card = link
                    for _ in range(5):  # Walk up max 5 levels
                        parent = await card.evaluate_handle('el => el.parentElement')
                        if parent:
                            card = parent
                            class_name = await card.evaluate('el => el.className || ""')
                            if 'product' in class_name.lower() or 'card' in class_name.lower():
                                break
                    
                    # Get product name from the link or nearby elements
                    name_elem = await card.query_selector('[class*="title"], [class*="name"], span, h2, h3')
                    if name_elem:
                        name_text = await name_elem.inner_text()
                        if name_text and len(name_text) > 2:
                            product['name'] = name_text.strip()
                    
                    # If no name found, try the link text itself
                    if not product.get('name'):
                        link_text = await link.inner_text()
                        if link_text and len(link_text) > 2:
                            product['name'] = link_text.strip()
                            
                    if not product.get('name'):
                        continue
                        
                    product['normalized_name'] = normalize_name(product['name'])
                    
                    # Get image from the card
                    img = await card.query_selector('img')
                    if img:
                        src = await img.get_attribute('src')
                        if src and not src.startswith('data:'):
                            product['image_url'] = src
                            
                    # Get price
                    price_elem = await card.query_selector('[class*="price"]')
                    if price_elem:
                        price_text = await price_elem.inner_text()
                        price_match = re.search(r'(\d+)[.,](\d{2})', price_text)
                        if price_match:
                            product['price'] = float(f"{price_match.group(1)}.{price_match.group(2)}")
                            
                    products.append(product)
                    self.stats['products_found'] += 1
                    
                except Exception as e:
                    self.stats['errors'] += 1
                    
        except Exception as e:
            print(f"  [ERROR] Failed to scrape page: {e}", flush=True)
            self.stats['errors'] += 1
            
        return products
        
    async def scrape_category(self, category: Dict[str, str], max_pages: int = 20, delay: float = 2.0) -> List[Dict[str, Any]]:
        """
        Scrape all pages of a category.
        
        Args:
            category: Dict with 'slug' and 'name'
            max_pages: Maximum number of pages to scrape per category
            delay: Delay between page loads
            
        Returns:
            List of all products found in this category
        """
        all_products = []
        category_url = f"https://www.ah.nl/{category['slug']}"
        
        print(f"\n[CATEGORY] {category['name']}", flush=True)
        print(f"  URL: {category_url}", flush=True)
        
        try:
            # Load first page - use domcontentloaded since networkidle can timeout
            await self.page.goto(category_url, wait_until='domcontentloaded', timeout=30000)
            await asyncio.sleep(5)  # Wait for JS rendering
            
            # Accept cookies on first load
            await self.accept_cookies()
            
            for page_num in range(1, max_pages + 1):
                print(f"  Page {page_num}...", flush=True)
                
                # Scroll down to trigger lazy loading
                await self.page.evaluate('window.scrollTo(0, document.body.scrollHeight / 2)')
                await asyncio.sleep(1)
                await self.page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
                await asyncio.sleep(1)
                
                # Scrape current page
                products = await self.scrape_category_page(category_url)
                all_products.extend(products)
                
                print(f"    Found {len(products)} new products on this page", flush=True)
                
                if not products:
                    print(f"  No more products found, stopping pagination", flush=True)
                    break
                    
                # Look for "Load more" / pagination
                try:
                    # Try to find and click "Load more" button
                    load_more = await self.page.query_selector('button:has-text("Meer laden"), button:has-text("Laad meer")')
                    if load_more:
                        await load_more.click()
                        await asyncio.sleep(delay)
                        continue
                        
                    # Try pagination links
                    next_page = await self.page.query_selector(f'a[href*="page={page_num + 1}"], a[aria-label*="Volgende"]')
                    if next_page:
                        await next_page.click()
                        await asyncio.sleep(delay)
                        continue
                        
                except:
                    pass
                    
                # No more pages
                print(f"  End of category (no more pagination)", flush=True)
                break
                
        except Exception as e:
            print(f"  [ERROR] Failed to scrape category: {e}", flush=True)
            self.stats['errors'] += 1
            
        self.stats['categories_scraped'] += 1
        print(f"  Total products in category: {len(all_products)}", flush=True)
        
        return all_products
        
    def save_products_to_db(self, products: List[Dict[str, Any]]) -> int:
        """
        Save products to Supabase.
        
        Args:
            products: List of product dicts
            
        Returns:
            Number of products saved/updated
        """
        if not self.supabase or not products:
            return 0
            
        saved = 0
        
        for product in products:
            try:
                # Prepare record
                record = {
                    'id': product['id'],
                    'name': product['name'],
                    'normalized_name': product.get('normalized_name'),
                    'url': product.get('url'),
                    'image_url': product.get('image_url'),
                    'price': product.get('price'),
                    'source': 'scraped',
                    'last_seen_at': datetime.now().isoformat(),
                }
                
                # Remove None values
                record = {k: v for k, v in record.items() if v is not None}
                
                # Upsert (insert or update)
                result = self.supabase.table('products').upsert(
                    record,
                    on_conflict='id'
                ).execute()
                
                if result.data:
                    saved += 1
                    
            except Exception as e:
                print(f"  [ERROR] Failed to save product {product.get('id')}: {e}", flush=True)
                self.stats['errors'] += 1
                
        return saved
        
    async def run(self, 
                  categories: Optional[List[str]] = None,
                  limit: int = 0,
                  max_pages: int = 20,
                  delay: float = 2.0,
                  dry_run: bool = False,
                  save_batch_size: int = 50):
        """
        Run the catalog scraper.
        
        Args:
            categories: List of category slugs to scrape (None = all)
            limit: Maximum total products to scrape (0 = no limit)
            max_pages: Maximum pages per category
            delay: Delay between requests
            dry_run: If True, don't save to database
            save_batch_size: Save to DB every N products
        """
        print("=" * 60, flush=True)
        print("  Albert Heijn Catalog Scraper", flush=True)
        print("=" * 60, flush=True)
        print(f"  Mode: {'DRY RUN' if dry_run else 'LIVE'}", flush=True)
        print(f"  Categories: {len(AH_CATEGORIES) if not categories else len(categories)}", flush=True)
        print(f"  Limit: {limit if limit > 0 else 'No limit'}", flush=True)
        print(f"  Delay: {delay}s between pages", flush=True)
        print("=" * 60, flush=True)
        
        if not dry_run:
            if not self.connect_supabase():
                return
                
        await self.setup()
        
        try:
            all_products = []
            cats_to_scrape = AH_CATEGORIES
            
            if categories:
                cats_to_scrape = [c for c in AH_CATEGORIES if c['slug'] in categories or c['name'].lower() in [x.lower() for x in categories]]
                
            for category in cats_to_scrape:
                products = await self.scrape_category(category, max_pages=max_pages, delay=delay)
                all_products.extend(products)
                
                # Save batch to DB
                if not dry_run and len(all_products) >= save_batch_size:
                    saved = self.save_products_to_db(all_products[-save_batch_size:])
                    self.stats['products_new'] += saved
                    print(f"  [DB] Saved batch of {saved} products", flush=True)
                    
                # Check limit
                if limit > 0 and len(all_products) >= limit:
                    print(f"\n[INFO] Reached limit of {limit} products", flush=True)
                    break
                    
                # Delay between categories
                await asyncio.sleep(delay)
                
            # Save remaining products
            if not dry_run and all_products:
                remaining = all_products[-(len(all_products) % save_batch_size):] if len(all_products) % save_batch_size > 0 else []
                if remaining:
                    saved = self.save_products_to_db(remaining)
                    self.stats['products_new'] += saved
                    
            # Print results if dry run
            if dry_run:
                print("\n[DRY RUN] Products that would be saved:", flush=True)
                for p in all_products[:20]:
                    print(f"  - {p['id']}: {p['name'][:50]}... €{p.get('price', '?')}", flush=True)
                if len(all_products) > 20:
                    print(f"  ... and {len(all_products) - 20} more", flush=True)
                    
        finally:
            await self.close()
            
        # Print summary
        print("\n" + "=" * 60, flush=True)
        print("  SCRAPING COMPLETE", flush=True)
        print("=" * 60, flush=True)
        print(f"  Categories scraped: {self.stats['categories_scraped']}", flush=True)
        print(f"  Products found:     {self.stats['products_found']}", flush=True)
        print(f"  Products saved:     {self.stats['products_new']}", flush=True)
        print(f"  Errors:             {self.stats['errors']}", flush=True)
        print("=" * 60, flush=True)


async def main():
    parser = argparse.ArgumentParser(description='Albert Heijn Catalog Scraper')
    parser.add_argument('--category', '-c', action='append', 
                        help='Specific category slug or name to scrape (can be used multiple times)')
    parser.add_argument('--limit', '-l', type=int, default=0,
                        help='Maximum total products to scrape (0 = no limit)')
    parser.add_argument('--max-pages', type=int, default=20,
                        help='Maximum pages per category (default: 20)')
    parser.add_argument('--delay', '-d', type=float, default=2.0,
                        help='Delay between page loads in seconds (default: 2.0)')
    parser.add_argument('--headless', type=str, default='false',
                        help='Run browser in headless mode (default: false - AH blocks headless)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Show what would be scraped without saving')
    parser.add_argument('--list-categories', action='store_true',
                        help='List available categories and exit')
    
    args = parser.parse_args()
    
    if args.list_categories:
        print("Available categories:")
        for cat in AH_CATEGORIES:
            print(f"  {cat['slug']:45} -> {cat['name']}")
        return
        
    headless = args.headless.lower() not in ('false', '0', 'no')
    
    scraper = AHCatalogScraper(headless=headless)
    await scraper.run(
        categories=args.category,
        limit=args.limit,
        max_pages=args.max_pages,
        delay=args.delay,
        dry_run=args.dry_run,
    )


if __name__ == '__main__':
    asyncio.run(main())
