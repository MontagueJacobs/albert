#!/usr/bin/env python3
"""
Automated Albert Heijn Scraper using Playwright
This script logs in with user credentials and scrapes their purchase history.

Supports:
- Local Playwright browser (for development/self-hosted)
- Remote browser services like Browserless.io (for Vercel/serverless)
"""

import asyncio
import json
import os
import sys
import argparse
from datetime import datetime
from typing import Optional, List, Dict, Any

try:
    from playwright.async_api import async_playwright, Page, Browser, BrowserContext
except ImportError:
    print("ERROR: Playwright not installed. Run: pip install playwright && playwright install chromium", file=sys.stderr)
    sys.exit(1)


class AHAutoScraper:
    """Automated scraper for Albert Heijn using Playwright."""
    
    def __init__(self, headless: bool = True, browserless_url: Optional[str] = None):
        """
        Initialize the scraper.
        
        Args:
            headless: Run browser in headless mode (for local browser)
            browserless_url: URL to connect to Browserless.io or similar service
                             e.g., "wss://chrome.browserless.io?token=YOUR_TOKEN"
        """
        self.headless = headless
        self.browserless_url = browserless_url
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self.products: List[Dict[str, Any]] = []
        self._playwright = None
        
    async def setup(self):
        """Initialize the browser (local or remote)."""
        self._playwright = await async_playwright().start()
        
        if self.browserless_url:
            # Connect to remote browser service (Browserless, Browserbase, etc.)
            print(f"[INFO] Connecting to remote browser service...", flush=True)
            try:
                self.browser = await self._playwright.chromium.connect_over_cdp(self.browserless_url)
                print("[INFO] Connected to remote browser", flush=True)
            except Exception as e:
                print(f"[ERROR] Failed to connect to remote browser: {e}", flush=True)
                raise
        else:
            # Launch local browser
            # WARNING: AH blocks headless browsers on their login page
            if self.headless:
                print("[WARNING] Running in headless mode - AH may block login attempts!", flush=True)
                print("[WARNING] If login fails, try with --no-headless flag", flush=True)
            print(f"[INFO] Starting local browser (headless={self.headless})...", flush=True)
            self.browser = await self._playwright.chromium.launch(
                headless=self.headless,
                args=[
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox',
                    '--disable-dev-shm-usage',
                ]
            )
        
        # Create context with realistic viewport and user agent
        self.context = await self.browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            user_agent='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            locale='nl-NL',
            timezone_id='Europe/Amsterdam',
        )
        
        self.page = await self.context.new_page()
        
        # Remove automation detection
        await self.page.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['nl-NL', 'nl', 'en-US', 'en'] });
        """)
        
        print("[INFO] Browser ready", flush=True)
        
    async def close(self):
        """Clean up browser resources."""
        if self.context:
            await self.context.close()
        if self.browser:
            await self.browser.close()
        if self._playwright:
            await self._playwright.stop()
        print("[INFO] Browser closed", flush=True)
    
    async def human_delay(self, min_ms: int = 500, max_ms: int = 1500):
        """Add a random human-like delay."""
        import random
        delay = random.randint(min_ms, max_ms) / 1000
        await asyncio.sleep(delay)
    
    async def type_slowly(self, selector: str, text: str):
        """Type text character by character like a human."""
        import random
        element = await self.page.wait_for_selector(selector, timeout=10000)
        await element.click()
        await self.human_delay(200, 400)
        
        for char in text:
            await self.page.keyboard.type(char)
            await asyncio.sleep(random.uniform(0.05, 0.15))
    
    async def login(self, email: str, password: str) -> bool:
        """
        Login to Albert Heijn website.
        
        Args:
            email: AH account email
            password: AH account password
            
        Returns:
            True if login successful, False otherwise
        """
        print("[INFO] Navigating to AH login page...", flush=True)
        
        try:
            # Go to mijn AH page which will redirect to login
            await self.page.goto('https://www.ah.nl/mijn', wait_until='domcontentloaded', timeout=30000)
            await self.human_delay(2000, 3000)
            
            # Check if page loaded or blocked
            html = await self.page.content()
            if 'Access Denied' in html:
                print("[ERROR] Access denied - AH blocks headless browsers. Try with --no-headless", flush=True)
                return False
            
            print(f"[INFO] Current URL: {self.page.url}", flush=True)
            
            # Wait for login form - AH shows both fields together
            print("[INFO] Waiting for login form...", flush=True)
            try:
                await self.page.wait_for_selector('#username', timeout=15000)
            except:
                # Maybe need to click login button first
                login_btn = await self.page.query_selector('a[href*="login"], button[data-testid="login-button"]')
                if login_btn:
                    print("[INFO] Clicking login button...", flush=True)
                    await login_btn.click()
                    await self.human_delay(2000, 3000)
                    await self.page.wait_for_selector('#username', timeout=15000)
            
            # Enter email
            print("[INFO] Entering email...", flush=True)
            await self.type_slowly('#username', email)
            await self.human_delay(500, 1000)
            
            # Enter password (AH shows both fields together)
            print("[INFO] Entering password...", flush=True)
            await self.type_slowly('#password', password)
            await self.human_delay(500, 1000)
            
            # Submit login
            print("[INFO] Submitting login...", flush=True)
            submit_btn = await self.page.query_selector('button[type="submit"]')
            if submit_btn:
                await submit_btn.click()
            
            print("[INFO] Waiting for login to complete...", flush=True)
            
            # Wait for redirect away from login page
            max_wait = 60
            captcha_warned = False
            for i in range(max_wait):
                await asyncio.sleep(1)
                current_url = self.page.url.lower()
                
                # Check for successful login (redirected away from login.ah.nl)
                if 'login.ah.nl' not in current_url:
                    print(f"[SUCCESS] Login successful after {i+1} seconds!", flush=True)
                    return True
                
                # Check for error messages
                error_el = await self.page.query_selector('[class*="error"], [data-testid*="error"]')
                if error_el:
                    error_text = await error_el.text_content()
                    if error_text and 'wachtwoord' in error_text.lower():
                        print(f"[ERROR] Login error: {error_text.strip()}", flush=True)
                        return False
                
                # Check for CAPTCHA (only warn once)
                if not captcha_warned:
                    captcha = await self.page.query_selector('[id*="captcha"], [class*="captcha"], iframe[src*="captcha"], iframe[src*="recaptcha"]')
                    if captcha:
                        print("[WARNING] CAPTCHA detected!", flush=True)
                        print("[WARNING] AH requires CAPTCHA verification. Auto-scrape cannot bypass this.", flush=True)
                        print("[WARNING] Consider using the manual bookmarklet method instead.", flush=True)
                        captcha_warned = True
                    
                if (i + 1) % 10 == 0:
                    print(f"[INFO] Still waiting for login... ({i+1}/{max_wait}s)", flush=True)
            
            # Final check
            if 'login.ah.nl' not in self.page.url.lower():
                return True
            
            if captcha_warned:
                print("[ERROR] Login failed - CAPTCHA could not be solved automatically", flush=True)
            else:
                print("[ERROR] Login timeout - possibly incorrect credentials", flush=True)
            return False
            
        except Exception as e:
            print(f"[ERROR] Login failed: {e}", flush=True)
            return False
    
    async def navigate_to_products(self) -> bool:
        """Navigate to the previously purchased products page."""
        print("[INFO] Navigating to previously purchased products...", flush=True)
        
        try:
            # Try the bonus route (less protected)
            await self.page.goto('https://www.ah.nl/bonus/eerder-gekocht', wait_until='networkidle')
            await self.human_delay(2000, 3000)
            
            # Check if blocked
            page_content = await self.page.content()
            if 'access denied' in page_content.lower() or 'permission' in page_content.lower():
                print("[WARNING] Access denied - trying alternative route...", flush=True)
                await self.page.goto('https://www.ah.nl/producten/eerder-gekocht', wait_until='networkidle')
                await self.human_delay(2000, 3000)
            
            # Wait for products to load
            print("[INFO] Waiting for products to load...", flush=True)
            
            # Try multiple selectors for product cards
            product_selectors = [
                'article a[href*="/producten/product/"]',
                '[data-testhook="product-card"]',
                'a[href*="/producten/product/"]',
            ]
            
            for selector in product_selectors:
                try:
                    await self.page.wait_for_selector(selector, timeout=10000)
                    print(f"[INFO] Found products with selector: {selector}", flush=True)
                    return True
                except:
                    continue
            
            print("[WARNING] Could not find product selectors, continuing anyway...", flush=True)
            return True
            
        except Exception as e:
            print(f"[ERROR] Navigation failed: {e}", flush=True)
            return False
    
    async def scroll_and_load_all(self, max_scrolls: int = 20):
        """Scroll down to load all lazy-loaded products."""
        print("[INFO] Scrolling to load all products...", flush=True)
        
        previous_height = 0
        stable_count = 0
        
        for i in range(max_scrolls):
            # Scroll down
            await self.page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
            await self.human_delay(1000, 2000)
            
            # Check if page height increased (new content loaded)
            current_height = await self.page.evaluate('document.body.scrollHeight')
            
            if current_height == previous_height:
                stable_count += 1
                if stable_count >= 3:
                    print(f"[INFO] Finished scrolling after {i+1} scrolls", flush=True)
                    break
            else:
                stable_count = 0
                previous_height = current_height
            
            if (i + 1) % 5 == 0:
                print(f"[INFO] Scrolled {i+1} times...", flush=True)
        
        # Scroll back to top
        await self.page.evaluate('window.scrollTo(0, 0)')
        await self.human_delay(500, 1000)
    
    async def extract_products(self) -> List[Dict[str, Any]]:
        """Extract product information from the page."""
        print("[INFO] Extracting products...", flush=True)
        
        products = await self.page.evaluate('''
            () => {
                const items = [];
                const seen = new Set();
                
                // Find all product links
                const links = document.querySelectorAll('a[href*="/producten/product/"], article a[href*="/producten/product/"]');
                
                links.forEach(a => {
                    const url = new URL(a.href, location.origin).toString();
                    if (seen.has(url)) return;
                    seen.add(url);
                    
                    // Get product name
                    let name = a.getAttribute('aria-label') || a.textContent || '';
                    name = name.replace(/\\s+/g, ' ').trim();
                    
                    if (!name) {
                        const title = a.closest('article')?.querySelector('[data-testhook="product-title"], h3, h2');
                        name = (title?.textContent || '').trim();
                    }
                    
                    // Get parent card
                    const card = a.closest('article') || a.closest('[data-testhook="product-card"]') || a.parentElement;
                    
                    // Get price
                    let price = null;
                    const priceEl = card?.querySelector('[data-testhook="product-price"], [class*="price"], span:has(> sup)');
                    const raw = priceEl?.textContent?.replace(',', '.').match(/(\\d+(\\.\\d{1,2})?)/);
                    if (raw) price = parseFloat(raw[1]);
                    
                    // Get image
                    const imgEl = card?.querySelector('img');
                    const image = imgEl?.src || '';
                    
                    if (name) {
                        items.push({
                            name,
                            url,
                            price,
                            image,
                            source: 'ah_auto_scrape'
                        });
                    }
                });
                
                return items;
            }
        ''')
        
        self.products = products
        print(f"[SUCCESS] Extracted {len(products)} products", flush=True)
        return products
    
    async def scrape(self, email: str, password: str, output_file: Optional[str] = None) -> Dict[str, Any]:
        """
        Full scraping workflow.
        
        Args:
            email: AH account email
            password: AH account password
            output_file: Optional file path to save results
            
        Returns:
            Dict with status and scraped products
        """
        result = {
            'success': False,
            'products': [],
            'error': None,
            'scraped_at': datetime.now(tz=None).astimezone().isoformat()
        }
        
        try:
            await self.setup()
            
            # Login
            if not await self.login(email, password):
                result['error'] = 'login_failed'
                return result
            
            # Navigate to products page
            if not await self.navigate_to_products():
                result['error'] = 'navigation_failed'
                return result
            
            # Scroll to load all products
            await self.scroll_and_load_all()
            
            # Extract products
            products = await self.extract_products()
            
            if not products:
                result['error'] = 'no_products_found'
                return result
            
            result['success'] = True
            result['products'] = products
            result['count'] = len(products)
            
            # Save to file if requested
            if output_file:
                with open(output_file, 'w', encoding='utf-8') as f:
                    json.dump(result, f, indent=2, ensure_ascii=False)
                print(f"[INFO] Saved results to {output_file}", flush=True)
            
            return result
            
        except Exception as e:
            result['error'] = str(e)
            print(f"[ERROR] Scraping failed: {e}", flush=True)
            return result
            
        finally:
            await self.close()


async def main():
    parser = argparse.ArgumentParser(description='Automated AH Scraper')
    parser.add_argument('--email', '-e', required=True, help='AH account email')
    parser.add_argument('--password', '-p', required=True, help='AH account password')
    parser.add_argument('--output', '-o', default='auto_scrape_results.json', help='Output file')
    parser.add_argument('--headless', action='store_true', default=True, help='Run in headless mode')
    parser.add_argument('--no-headless', dest='headless', action='store_false', help='Show browser window')
    parser.add_argument('--browserless-url', help='URL to Browserless.io or similar service (e.g., wss://chrome.browserless.io?token=YOUR_TOKEN)')
    
    args = parser.parse_args()
    
    # Check for browserless URL in environment
    browserless_url = args.browserless_url or os.environ.get('BROWSERLESS_URL')
    
    scraper = AHAutoScraper(headless=args.headless, browserless_url=browserless_url)
    result = await scraper.scrape(args.email, args.password, args.output)
    
    # Output result as JSON for the server to parse
    print(f"\n[RESULT] {json.dumps(result)}", flush=True)
    
    return 0 if result['success'] else 1


if __name__ == '__main__':
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
