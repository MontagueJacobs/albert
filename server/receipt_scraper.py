#!/usr/bin/env python3
"""
Albert Heijn Receipt Scraper

Scrapes actual receipt data from AH website to get accurate purchase dates.
Uses Playwright for browser automation with session persistence.

Usage:
  python receipt_scraper.py --manual-login    # Login manually and save session
  python receipt_scraper.py --scrape          # Scrape receipts using saved session
  python receipt_scraper.py --output receipts.json
"""

import asyncio
import json
import os
import sys
import argparse
import re
from datetime import datetime
from typing import Optional, Dict, Any, List
from pathlib import Path

try:
    from playwright.async_api import async_playwright, Page, Browser, BrowserContext
except ImportError:
    print("ERROR: Playwright not installed. Run: pip install playwright && playwright install chromium", file=sys.stderr)
    sys.exit(1)

# Session file location
SESSION_FILE = Path(__file__).parent.parent.parent / "ah_browser_session.json"


class AHReceiptScraper:
    """Scrapes receipt data from AH website using browser automation."""
    
    AH_BASE_URL = "https://www.ah.nl"
    RECEIPTS_URL = "https://www.ah.nl/mijn/bonnetjes"
    LOGIN_URL = "https://www.ah.nl/mijn"
    
    def __init__(self, headless: bool = True, session_file: Path = SESSION_FILE):
        self.headless = headless
        self.session_file = session_file
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self._playwright = None
        
    async def setup(self, use_session: bool = True):
        """Initialize browser with optional session restoration."""
        self._playwright = await async_playwright().start()
        
        self.browser = await self._playwright.chromium.launch(
            headless=self.headless,
            args=[
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
                '--disable-dev-shm-usage',
            ]
        )
        
        # Create context with Dutch locale
        context_options = {
            'viewport': {'width': 1280, 'height': 900},
            'locale': 'nl-NL',
            'timezone_id': 'Europe/Amsterdam',
            'user_agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
        
        # Load saved session if available
        if use_session and self.session_file.exists():
            try:
                with open(self.session_file, 'r') as f:
                    session_data = json.load(f)
                context_options['storage_state'] = session_data
                print("[INFO] Loaded saved browser session", flush=True)
            except Exception as e:
                print(f"[WARN] Could not load session: {e}", flush=True)
        
        self.context = await self.browser.new_context(**context_options)
        
        # Anti-detection
        await self.context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        """)
        
        self.page = await self.context.new_page()
        print("[INFO] Browser initialized", flush=True)
        
    async def save_session(self):
        """Save current browser session for reuse."""
        if self.context:
            storage_state = await self.context.storage_state()
            with open(self.session_file, 'w') as f:
                json.dump(storage_state, f, indent=2)
            print(f"[INFO] Session saved to {self.session_file}", flush=True)
            
    async def close(self):
        """Clean up browser resources."""
        if self.browser:
            await self.browser.close()
        if self._playwright:
            await self._playwright.stop()
            
    async def is_logged_in(self) -> bool:
        """Check if currently logged in to AH."""
        try:
            current_url = self.page.url
            
            # If we're on a blank page, navigate to mijn first
            if not current_url or current_url == 'about:blank':
                await self.page.goto(self.LOGIN_URL, wait_until='domcontentloaded', timeout=15000)
                await asyncio.sleep(2)
                current_url = self.page.url
            
            # If we're on login page, not logged in
            if 'login' in current_url.lower():
                return False
                
            # If we're on a mijn/* page, we're logged in
            if '/mijn' in current_url and 'login' not in current_url:
                content = await self.page.content()
                logged_in_indicators = ['uitloggen', 'logout', 'mijn account', 'welkom', 'eerder gekocht']
                return any(ind in content.lower() for ind in logged_in_indicators)
            
            return False
            
        except Exception as e:
            print(f"[WARN] Login check failed: {e}", flush=True)
            return False
            
    async def manual_login(self, timeout_seconds: int = 300):
        """
        Open browser for manual login.
        
        Args:
            timeout_seconds: Max time to wait for login
        """
        print("[INFO] Opening AH login page for manual authentication...", flush=True)
        print(f"[INFO] You have {timeout_seconds // 60} minutes to log in.", flush=True)
        print("[INFO] Take your time - the page will NOT refresh while you type.", flush=True)
        
        await self.page.goto(self.LOGIN_URL, wait_until='domcontentloaded')
        
        # Wait for user to complete login - check every 5 seconds
        # Don't navigate, just check the current URL
        start_time = datetime.now()
        while (datetime.now() - start_time).seconds < timeout_seconds:
            await asyncio.sleep(5)  # Check every 5 seconds, not 2
            
            # Just check URL without navigating
            current_url = self.page.url
            if '/mijn/' in current_url and 'login' not in current_url.lower():
                # User navigated to a protected page - they're logged in
                print("[SUCCESS] Login detected!", flush=True)
                await self.save_session()
                return True
                
        print("[ERROR] Login timeout - please try again", flush=True)
        return False
        
    async def navigate_to_receipts(self) -> bool:
        """Navigate to the receipts page."""
        try:
            print("[INFO] Navigating to receipts page...", flush=True)
            await self.page.goto(self.RECEIPTS_URL, wait_until='domcontentloaded', timeout=30000)
            await asyncio.sleep(3)
            
            # Check if we got redirected to login
            if 'login' in self.page.url.lower():
                print("[ERROR] Redirected to login - session expired", flush=True)
                return False
                
            return True
            
        except Exception as e:
            print(f"[ERROR] Failed to navigate to receipts: {e}", flush=True)
            return False
            
    async def scrape_receipts_list(self) -> List[Dict[str, Any]]:
        """
        Scrape the list of receipts from the receipts page.
        
        Returns:
            List of receipt summaries with dates and links
        """
        receipts = []
        
        try:
            # Wait for receipt list to load
            await asyncio.sleep(2)
            content = await self.page.content()
            
            # Look for receipt items - AH uses various selectors
            receipt_selectors = [
                '[data-testhook="receipt-item"]',
                '[class*="receipt"]',
                '[class*="bonnetje"]',
                'a[href*="bonnetjes"]',
            ]
            
            for selector in receipt_selectors:
                items = await self.page.query_selector_all(selector)
                if items:
                    print(f"[INFO] Found {len(items)} receipt elements with selector: {selector}", flush=True)
                    break
            else:
                # Try to find any clickable receipt links
                items = await self.page.query_selector_all('a')
                items = [i for i in items if 'bonnetje' in (await i.get_attribute('href') or '').lower()]
                
            for item in items[:20]:  # Limit to 20 receipts
                try:
                    receipt = {}
                    
                    # Get link
                    href = await item.get_attribute('href')
                    if href:
                        receipt['url'] = href if href.startswith('http') else f"{self.AH_BASE_URL}{href}"
                        
                    # Get text content (usually contains date)
                    text = await item.inner_text()
                    receipt['text'] = text.strip()
                    
                    # Try to extract date
                    date_patterns = [
                        r'(\d{1,2})\s+(jan|feb|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec)[a-z]*\s+(\d{4})',
                        r'(\d{1,2})-(\d{1,2})-(\d{4})',
                        r'(\d{4})-(\d{2})-(\d{2})',
                    ]
                    
                    for pattern in date_patterns:
                        match = re.search(pattern, text, re.IGNORECASE)
                        if match:
                            receipt['date_raw'] = match.group()
                            break
                            
                    if receipt.get('url'):
                        receipts.append(receipt)
                        
                except Exception as e:
                    print(f"[WARN] Error parsing receipt item: {e}", flush=True)
                    
            print(f"[INFO] Found {len(receipts)} receipts", flush=True)
            
        except Exception as e:
            print(f"[ERROR] Failed to scrape receipts list: {e}", flush=True)
            
        return receipts
        
    async def scrape_receipt_detail(self, receipt_url: str) -> Dict[str, Any]:
        """
        Scrape detailed information from a single receipt.
        
        Args:
            receipt_url: URL to the receipt detail page
            
        Returns:
            Dict with receipt details including products
        """
        result = {
            'url': receipt_url,
            'success': False,
            'date': None,
            'store': None,
            'total': None,
            'products': [],
            'error': None,
        }
        
        try:
            print(f"[INFO] Scraping receipt: {receipt_url}", flush=True)
            
            await self.page.goto(receipt_url, wait_until='domcontentloaded', timeout=30000)
            await asyncio.sleep(2)
            
            content = await self.page.content()
            
            # Extract date
            date_patterns = [
                r'(\d{1,2})\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+(\d{4})',
                r'(\d{1,2})\s+(jan|feb|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec)[a-z]*\.?\s+(\d{4})',
                r'(\d{1,2})-(\d{1,2})-(\d{4})',
            ]
            
            for pattern in date_patterns:
                match = re.search(pattern, content, re.IGNORECASE)
                if match:
                    result['date'] = match.group()
                    break
                    
            # Extract store location
            store_pattern = r'(AH\s+[^<\n]+?)(?:<|$|\n)'
            store_match = re.search(store_pattern, content)
            if store_match:
                result['store'] = store_match.group(1).strip()
                
            # Extract total
            total_patterns = [
                r'totaal[:\s]*€?\s*(\d+[.,]\d{2})',
                r'€\s*(\d+[.,]\d{2})\s*(?:totaal|total)',
            ]
            
            for pattern in total_patterns:
                match = re.search(pattern, content, re.IGNORECASE)
                if match:
                    result['total'] = float(match.group(1).replace(',', '.'))
                    break
                    
            # Extract products
            product_items = await self.page.query_selector_all('[class*="product"], [class*="item"], [class*="regel"]')
            
            for item in product_items:
                try:
                    text = await item.inner_text()
                    
                    # Try to parse product line: "Product Name    €X.XX"
                    # or "2x Product Name    €X.XX"
                    product_pattern = r'(?:(\d+)x?\s+)?(.+?)\s+€?\s*(\d+[.,]\d{2})'
                    match = re.search(product_pattern, text.strip())
                    
                    if match:
                        quantity = int(match.group(1)) if match.group(1) else 1
                        name = match.group(2).strip()
                        price = float(match.group(3).replace(',', '.'))
                        
                        if name and len(name) > 2:
                            result['products'].append({
                                'name': name,
                                'quantity': quantity,
                                'price': price,
                            })
                except Exception:
                    pass
                    
            result['success'] = True
            print(f"[SUCCESS] Scraped receipt: {len(result['products'])} products, total: {result['total']}", flush=True)
            
        except Exception as e:
            result['error'] = str(e)
            print(f"[ERROR] Failed to scrape receipt: {e}", flush=True)
            
        return result
        
    async def scrape_all_receipts(self, max_receipts: int = 10, delay: float = 2.0) -> List[Dict[str, Any]]:
        """
        Scrape multiple receipts with their details.
        
        Args:
            max_receipts: Maximum number of receipts to scrape
            delay: Delay between requests
            
        Returns:
            List of detailed receipt data
        """
        # First navigate to receipts page
        if not await self.navigate_to_receipts():
            return []
            
        # Get list of receipts
        receipt_list = await self.scrape_receipts_list()
        if not receipt_list:
            print("[WARN] No receipts found", flush=True)
            return []
            
        # Scrape each receipt
        results = []
        for i, receipt in enumerate(receipt_list[:max_receipts]):
            print(f"[INFO] Progress: {i+1}/{min(len(receipt_list), max_receipts)}", flush=True)
            
            if receipt.get('url'):
                detail = await self.scrape_receipt_detail(receipt['url'])
                detail['list_info'] = receipt  # Include list info
                results.append(detail)
                
                if i < min(len(receipt_list), max_receipts) - 1:
                    await asyncio.sleep(delay)
                    
        return results


async def main():
    parser = argparse.ArgumentParser(description='AH Receipt Scraper')
    parser.add_argument('--manual-login', action='store_true', help='Open browser for manual login')
    parser.add_argument('--scrape', action='store_true', help='Scrape receipts using saved session')
    parser.add_argument('--check-login', action='store_true', help='Check if session is still valid')
    parser.add_argument('--output', '-o', default='receipts.json', help='Output file')
    parser.add_argument('--max-receipts', type=int, default=10, help='Max receipts to scrape')
    parser.add_argument('--headless', action='store_true', default=False, help='Run in headless mode')
    parser.add_argument('--delay', type=float, default=2.0, help='Delay between requests')
    
    args = parser.parse_args()
    
    if not (args.manual_login or args.scrape or args.check_login):
        parser.print_help()
        return 1
        
    scraper = AHReceiptScraper(headless=args.headless if not args.manual_login else False)
    
    try:
        await scraper.setup(use_session=not args.manual_login)
        
        if args.manual_login:
            success = await scraper.manual_login()
            return 0 if success else 1
            
        if args.check_login:
            logged_in = await scraper.is_logged_in()
            print(f"[INFO] Login status: {'logged in' if logged_in else 'NOT logged in'}", flush=True)
            return 0 if logged_in else 1
            
        if args.scrape:
            # Check login status first
            if not await scraper.is_logged_in():
                print("[ERROR] Not logged in. Run with --manual-login first.", flush=True)
                return 1
                
            results = await scraper.scrape_all_receipts(
                max_receipts=args.max_receipts,
                delay=args.delay
            )
            
            # Save results
            with open(args.output, 'w', encoding='utf-8') as f:
                json.dump(results, f, indent=2, ensure_ascii=False, default=str)
            print(f"[INFO] Saved {len(results)} receipts to {args.output}", flush=True)
            
            # Print summary
            total_products = sum(len(r.get('products', [])) for r in results)
            print(f"[INFO] Summary: {len(results)} receipts, {total_products} total products", flush=True)
            
            return 0
            
    finally:
        await scraper.close()
        
    return 0


if __name__ == '__main__':
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
