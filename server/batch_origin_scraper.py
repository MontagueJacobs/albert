#!/usr/bin/env python3
"""
Batch Origin Scraper for Albert Heijn Products

Scrapes product origin data (country/monthly origin) for products in the database
that don't have this information yet.

Usage:
  python batch_origin_scraper.py                         # Scrape from products table (default)
  python batch_origin_scraper.py --mode purchases        # Scrape only products in user_purchases
  python batch_origin_scraper.py --mode all              # Scrape from products table
  python batch_origin_scraper.py --limit 50              # Scrape up to 50 products
  python batch_origin_scraper.py --delay 3               # Wait 3 seconds between requests
  python batch_origin_scraper.py --dry-run               # Show what would be scraped without scraping
  python batch_origin_scraper.py --headless=false        # Show browser window for debugging
"""

import asyncio
import argparse
import json
import os
import sys
from datetime import datetime
from typing import Dict, Any, List, Optional

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from product_detail_scraper import AHProductDetailScraper

try:
    from supabase import create_client, Client
except ImportError:
    print("ERROR: supabase-py not installed. Run: pip install supabase", file=sys.stderr)
    sys.exit(1)

# Load environment variables
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))


class BatchOriginScraper:
    """Batch scraper that fetches products from Supabase and updates origin data.
    
    NOTE: AH blocks headless browsers. Must run with headless=False or use xvfb.
    On a server: xvfb-run python batch_origin_scraper.py
    """
    
    def __init__(self, headless: bool = False, delay: float = 2.0):
        self.headless = headless
        self.delay = delay
        self.scraper: Optional[AHProductDetailScraper] = None
        self.supabase: Optional[Client] = None
        
        # Stats
        self.stats = {
            'total_candidates': 0,
            'scraped': 0,
            'updated': 0,
            'failed': 0,
            'skipped_no_url': 0,
        }
        
    def connect_supabase(self) -> bool:
        """Connect to Supabase."""
        url = os.getenv('SUPABASE_URL')
        key = os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_ANON_KEY')
        
        if not url or not key:
            print("[ERROR] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY required", file=sys.stderr)
            return False
            
        self.supabase = create_client(url, key)
        print(f"[INFO] Connected to Supabase: {url}", flush=True)
        return True
        
    def get_products_needing_origin(self, limit: int = 100) -> List[Dict[str, Any]]:
        """
        Fetch products that need origin data scraped.
        
        Returns products that:
        - Have a url (so we can scrape them)
        - Don't have origin_country set yet
        - Haven't already failed or been marked not_found
        """
        if not self.supabase:
            return []
            
        # Query products missing key data (origin, unit_size, price, OR image).
        # Only permanently exclude not_found — allow re-scraping of failed,
        # success, and pending items that still have null price or image.
        result = self.supabase.table('products') \
            .select('id, name, url, origin_country, origin_by_month, unit_size, price, image_url, details_scrape_status, details_scraped_at') \
            .not_.is_('url', 'null') \
            .or_('origin_country.is.null,unit_size.is.null,price.is.null,image_url.is.null') \
            .or_('details_scrape_status.is.null,details_scrape_status.not.in.(not_found)') \
            .limit(limit) \
            .execute()
        
        # Filter out items scraped in the last hour to avoid re-scrape loops
        products = []
        now = datetime.now()
        for p in (result.data or []):
            scraped_at = p.get('details_scraped_at')
            if scraped_at:
                try:
                    sa = datetime.fromisoformat(scraped_at.replace('Z', '+00:00')).replace(tzinfo=None)
                    if (now - sa).total_seconds() < 3600:
                        continue  # Skip recently scraped items
                except (ValueError, TypeError):
                    pass
            products.append(p)
            
        self.stats['total_candidates'] = len(products)
        
        print(f"[INFO] Found {len(products)} products needing origin data", flush=True)
        return products
    
    def get_user_purchase_products(self, limit: int = 100) -> List[Dict[str, Any]]:
        """
        Fetch products from user_purchases that need origin data.
        
        Returns products that:
        - Are in user_purchases table
        - Have a product URL (so we can scrape them)
        - Don't have origin_country set yet in the products table
        """
        if not self.supabase:
            return []
        
        # Get product URLs from user_purchases (more reliable than product_id)
        purchases_result = self.supabase.table('user_purchases') \
            .select('product_url') \
            .not_.is_('product_url', 'null') \
            .execute()
        
        if not purchases_result.data:
            print("[INFO] No products with URLs found in user_purchases", flush=True)
            return []
        
        # Get unique URLs
        product_urls = list(set(p['product_url'] for p in purchases_result.data if p.get('product_url')))
        print(f"[INFO] Found {len(product_urls)} unique product URLs in user_purchases", flush=True)
        
        if not product_urls:
            return []
        
        # Debug: show sample
        print(f"[DEBUG] Sample URLs: {product_urls[:3]}", flush=True)
        
        # Query products table by URL - find those missing origin OR unit_size data
        all_products = []
        chunk_size = 20  # Smaller chunks for URL queries
        
        for i in range(0, len(product_urls), chunk_size):
            chunk_urls = product_urls[i:i + chunk_size]
            
            result = self.supabase.table('products') \
                .select('id, name, url, origin_country, origin_by_month, unit_size, price, image_url, details_scrape_status, details_scraped_at') \
                .in_('url', chunk_urls) \
                .or_('origin_country.is.null,unit_size.is.null,price.is.null,image_url.is.null') \
                .or_('details_scrape_status.is.null,details_scrape_status.not.in.(not_found)') \
                .execute()
            
            if result.data:
                all_products.extend(result.data)
                print(f"[DEBUG] Found {len(result.data)} products in chunk {i//chunk_size + 1}", flush=True)
        
        # Filter out items scraped in the last hour to avoid re-scrape loops
        now = datetime.now()
        filtered = []
        for p in all_products:
            scraped_at = p.get('details_scraped_at')
            if scraped_at:
                try:
                    sa = datetime.fromisoformat(scraped_at.replace('Z', '+00:00')).replace(tzinfo=None)
                    if (now - sa).total_seconds() < 3600:
                        continue
                except (ValueError, TypeError):
                    pass
            filtered.append(p)
        
        # Limit results
        products = filtered[:limit]
        self.stats['total_candidates'] = len(products)
        
        print(f"[INFO] Found {len(products)} user purchase products needing origin data", flush=True)
        return products

    def _init_ah_api(self):
        """Lazily initialise the AH mobile API client for price/image fallback."""
        if hasattr(self, '_ah_api'):
            return self._ah_api
        try:
            # ah_api.py lives in the project root (one level above server/)
            parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            if parent_dir not in sys.path:
                sys.path.insert(0, parent_dir)
            from ah_api import AHClient
            client = AHClient()
            client.get_anonymous_token()
            self._ah_api = client
            print("[INFO] AH API client initialised for price/image fallback", flush=True)
            return self._ah_api
        except Exception as e:
            print(f"[WARN] Could not init AH API fallback: {e}", flush=True)
            self._ah_api = None
            return None

    def fill_missing_from_api(self, product_name: str, result: Dict[str, Any]) -> Dict[str, Any]:
        """
        If the page scraper missed price or image, try the AH search API.
        The API reliably returns both for virtually every product.
        """
        needs_price = result.get('price') is None
        needs_image = not result.get('image_url')
        if not needs_price and not needs_image:
            return result

        client = self._init_ah_api()
        if not client:
            return result

        try:
            data = client.search_products(product_name, size=3)
            cards = data.get('products', data.get('cards', []))
            if not cards:
                return result

            # Use the first result — it's the closest match
            first = cards[0]
            prod = first.get('products', [first])[0] if isinstance(first.get('products'), list) else first

            if needs_price:
                api_price = prod.get('currentPrice') or prod.get('priceBeforeBonus')
                if api_price is not None:
                    result['price'] = float(api_price)
                    print(f"  [API] Got price: €{result['price']}", flush=True)

            if needs_image:
                images = prod.get('images', [])
                for img in images:
                    if img.get('width') == 200:
                        result['image_url'] = img['url']
                        break
                if not result.get('image_url') and images:
                    result['image_url'] = images[0].get('url', '').replace(
                        '800x800_JPG_Q90', '200x200_JPG_Q85')
                if result.get('image_url'):
                    print(f"  [API] Got image URL", flush=True)

        except Exception as e:
            print(f"  [API] Fallback error: {e}", flush=True)

        return result
    
    def mark_scrape_failed(self, product_id: str, error_type: str) -> bool:
        """
        Mark a product's scrape status as failed in the database.
        
        Args:
            product_id: The product's ID in the database
            error_type: The type of error (not_found, access_denied, captcha, etc.)
        """
        if not self.supabase:
            return False
            
        try:
            status = 'not_found' if error_type == 'not_found' else 'failed'
            result = self.supabase.table('products') \
                .update({
                    'details_scrape_status': status,
                    'details_scraped_at': __import__('datetime').datetime.now().isoformat()
                }) \
                .eq('id', product_id) \
                .execute()
            return bool(result.data)
        except Exception as e:
            print(f"  [ERROR] Failed to mark scrape status: {e}", flush=True)
            return False
        
    def update_product_origin(self, product_id: int, origin_data: Dict[str, Any]) -> bool:
        """
        Update a product's origin data in the database.
        
        Args:
            product_id: The product's ID in the database
            origin_data: Dict with origin_country, origin_by_month, is_fairtrade, is_organic, etc.
        """
        if not self.supabase:
            return False
            
        try:
            # Build update payload - only include non-None values for optional fields
            # ALWAYS include is_vegan/is_vegetarian/is_organic/is_fairtrade so that
            # previously incorrect values (e.g. false vegan=true) get overwritten with None
            update_payload = {}
            
            if origin_data.get('origin_country'):
                update_payload['origin_country'] = origin_data['origin_country']
                
            if origin_data.get('origin_by_month'):
                update_payload['origin_by_month'] = origin_data['origin_by_month']
            
            # Always write boolean flags - None means "not detected" and should
            # overwrite any stale true/false from previous (buggy) scrapes
            update_payload['is_fairtrade'] = origin_data.get('is_fairtrade')
            update_payload['is_organic'] = origin_data.get('is_organic')
            update_payload['is_vegan'] = origin_data.get('is_vegan')
            update_payload['is_vegetarian'] = origin_data.get('is_vegetarian')
                
            if origin_data.get('nutri_score'):
                update_payload['nutri_score'] = origin_data['nutri_score']
            
            if origin_data.get('image_url'):
                update_payload['image_url'] = origin_data['image_url']
            
            if origin_data.get('price') is not None:
                update_payload['price'] = origin_data['price']
            
            # Additional product details
            if origin_data.get('brand'):
                update_payload['brand'] = origin_data['brand']
            
            if origin_data.get('unit_size'):
                update_payload['unit_size'] = origin_data['unit_size']
            
            if origin_data.get('ingredients'):
                update_payload['ingredients'] = origin_data['ingredients']
            
            if origin_data.get('nutrition_text'):
                update_payload['nutrition_text'] = origin_data['nutrition_text']
            
            if origin_data.get('nutrition_json'):
                update_payload['nutrition_json'] = origin_data['nutrition_json']
            
            # Allergens is a list - store as JSON array
            if origin_data.get('allergens'):
                update_payload['allergens'] = origin_data['allergens']
            
            # Check if we actually extracted any meaningful data
            if not update_payload:
                print(f"  [SKIP] No data extracted for product {product_id}", flush=True)
                return False
                
            # Mark as success only if we got BOTH price and image (essential fields).
            # Items missing either are marked 'pending' and will be retried in
            # future runs (the 1-hour cooldown on details_scraped_at prevents
            # same-session re-scrape loops).
            update_payload['details_scraped_at'] = origin_data.get('scraped_at') or __import__('datetime').datetime.now().isoformat()
            has_price = origin_data.get('price') is not None
            has_image = bool(origin_data.get('image_url'))
            update_payload['details_scrape_status'] = 'success' if (has_price and has_image) else 'pending'
                
            # Update the product
            result = self.supabase.table('products') \
                .update(update_payload) \
                .eq('id', product_id) \
                .execute()
                
            if result.data:
                self.stats['updated'] += 1
                print(f"  [UPDATED] Product {product_id}: {update_payload}", flush=True)
                return True
            else:
                print(f"  [WARN] Update returned no data for product {product_id}", flush=True)
                return False
                
        except Exception as e:
            print(f"  [ERROR] Failed to update product {product_id}: {e}", flush=True)
            return False
            
    async def run(self, limit: int = 100, dry_run: bool = False, mode: str = 'all'):
        """
        Run the batch scraper.
        
        Args:
            limit: Maximum number of products to scrape
            dry_run: If True, only show what would be done without actually scraping
            mode: 'all' for products table, 'purchases' for user_purchases only
        """
        print("=" * 60, flush=True)
        print("  Batch Origin Scraper for Albert Heijn Products", flush=True)
        print("=" * 60, flush=True)
        print(f"  Source: {'user_purchases' if mode == 'purchases' else 'products table'}", flush=True)
        print(f"  Mode: {'DRY RUN' if dry_run else 'LIVE'}", flush=True)
        print(f"  Limit: {limit} products", flush=True)
        print(f"  Delay: {self.delay}s between requests", flush=True)
        print(f"  Headless: {self.headless}", flush=True)
        print("=" * 60, flush=True)
        
        # Connect to Supabase
        if not self.connect_supabase():
            return
            
        # Get products needing origin data based on mode
        if mode == 'purchases':
            products = self.get_user_purchase_products(limit=limit)
        else:
            products = self.get_products_needing_origin(limit=limit)
        
        if not products:
            print("[INFO] No products need origin data - all done!", flush=True)
            return
            
        if dry_run:
            print("\n[DRY RUN] Would scrape these products:", flush=True)
            for p in products:
                print(f"  - {p['id']}: {p['name'][:50]}... ({p['url']})", flush=True)
            print(f"\n[DRY RUN] Total: {len(products)} products", flush=True)
            return
            
        # Initialize the scraper
        self.scraper = AHProductDetailScraper(headless=self.headless)
        
        try:
            await self.scraper.setup()
            
            # Process each product
            for i, product in enumerate(products, 1):
                product_id = product['id']
                product_name = product['name'][:40]
                product_url = product['url']
                
                if not product_url or not product_url.startswith('http'):
                    self.stats['skipped_no_url'] += 1
                    print(f"[{i}/{len(products)}] SKIP {product_name}... - invalid URL", flush=True)
                    continue
                    
                print(f"\n[{i}/{len(products)}] Scraping: {product_name}...", flush=True)
                print(f"  URL: {product_url}", flush=True)
                
                try:
                    # Scrape the product page
                    result = await self.scraper.scrape_product(product_url)
                    self.stats['scraped'] += 1
                    
                    if result['success']:
                        # Fill in price/image via AH API if the page scraper missed them
                        result = self.fill_missing_from_api(product['name'], result)
                        # Update the database
                        self.update_product_origin(product_id, result)
                    else:
                        self.stats['failed'] += 1
                        error_type = result.get('error', 'unknown')
                        print(f"  [FAIL] {error_type}", flush=True)
                        # Update scrape status in database
                        self.mark_scrape_failed(product_id, error_type)
                        
                except Exception as e:
                    self.stats['failed'] += 1
                    print(f"  [ERROR] {e}", flush=True)
                    
                # Delay between requests to avoid rate limiting
                if i < len(products):
                    await asyncio.sleep(self.delay)
                    
        finally:
            if self.scraper:
                await self.scraper.close()
                
        # Print summary
        print("\n" + "=" * 60, flush=True)
        print("  SCRAPING COMPLETE", flush=True)
        print("=" * 60, flush=True)
        print(f"  Total candidates:   {self.stats['total_candidates']}", flush=True)
        print(f"  Scraped:            {self.stats['scraped']}", flush=True)
        print(f"  Updated:            {self.stats['updated']}", flush=True)
        print(f"  Failed:             {self.stats['failed']}", flush=True)
        print(f"  Skipped (no URL):   {self.stats['skipped_no_url']}", flush=True)
        print("=" * 60, flush=True)


async def main():
    parser = argparse.ArgumentParser(description='Batch Origin Scraper for AH Products')
    parser.add_argument('--mode', '-m', type=str, default='all', choices=['all', 'purchases'],
                        help='Source: "all" for products table, "purchases" for user_purchases only (default: all)')
    parser.add_argument('--limit', '-l', type=int, default=100, 
                        help='Maximum number of products to scrape (default: 100)')
    parser.add_argument('--delay', '-d', type=float, default=2.0,
                        help='Delay between requests in seconds (default: 2.0)')
    parser.add_argument('--headless', type=str, default='false',
                        help='Run browser in headless mode (default: false - AH blocks headless)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Show what would be scraped without actually scraping')
    
    args = parser.parse_args()
    
    headless = args.headless.lower() not in ('false', '0', 'no')
    
    scraper = BatchOriginScraper(headless=headless, delay=args.delay)
    await scraper.run(limit=args.limit, dry_run=args.dry_run, mode=args.mode)


if __name__ == '__main__':
    asyncio.run(main())
