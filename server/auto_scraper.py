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
    
    def __init__(self, headless: bool = True, browserless_url: Optional[str] = None, cookies_file: Optional[str] = None):
        """
        Initialize the scraper.
        
        Args:
            headless: Run browser in headless mode (for local browser)
            browserless_url: URL to connect to Browserless.io or similar service
                             e.g., "wss://chrome.browserless.io?token=YOUR_TOKEN"
            cookies_file: Path to JSON file with saved session cookies
        """
        self.headless = headless
        self.browserless_url = browserless_url
        self.cookies_file = cookies_file
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
        
        # Load cookies if provided
        if self.cookies_file:
            await self.load_cookies(self.cookies_file)
        
        print("[INFO] Browser ready", flush=True)
    
    async def load_cookies(self, cookies_file: str) -> bool:
        """Load session cookies from a JSON file."""
        try:
            with open(cookies_file, 'r') as f:
                cookies = json.load(f)
            
            if not cookies:
                print("[WARNING] Cookie file is empty", flush=True)
                return False
            
            await self.context.add_cookies(cookies)
            print(f"[INFO] Loaded {len(cookies)} cookies from {cookies_file}", flush=True)
            return True
        except FileNotFoundError:
            print(f"[WARNING] Cookie file not found: {cookies_file}", flush=True)
            return False
        except json.JSONDecodeError as e:
            print(f"[ERROR] Invalid cookie file format: {e}", flush=True)
            return False
        except Exception as e:
            print(f"[ERROR] Failed to load cookies: {e}", flush=True)
            return False
    
    async def save_cookies(self, cookies_file: str) -> bool:
        """Save current session cookies to a JSON file."""
        try:
            cookies = await self.context.cookies()
            
            # Filter to only AH-related cookies
            ah_cookies = [c for c in cookies if 'ah.nl' in c.get('domain', '')]
            
            with open(cookies_file, 'w') as f:
                json.dump(ah_cookies, f, indent=2)
            
            print(f"[INFO] Saved {len(ah_cookies)} cookies to {cookies_file}", flush=True)
            return True
        except Exception as e:
            print(f"[ERROR] Failed to save cookies: {e}", flush=True)
            return False
    
    async def check_logged_in(self) -> bool:
        """Check if we're already logged in (via cookies)."""
        try:
            # Navigate to a page that requires login
            await self.page.goto('https://www.ah.nl/mijn/eerder-gekocht', wait_until='domcontentloaded', timeout=30000)
            await asyncio.sleep(2)
            
            current_url = self.page.url.lower()
            
            # If we're redirected to login, we're not logged in
            if 'login.ah.nl' in current_url:
                print("[INFO] Not logged in - cookies expired or invalid", flush=True)
                return False
            
            # If we're on the purchases page, we're logged in!
            if 'eerder-gekocht' in current_url or 'mijn' in current_url:
                print("[SUCCESS] Already logged in via cookies!", flush=True)
                return True
            
            print(f"[INFO] Unexpected URL: {current_url}", flush=True)
            return False
            
        except Exception as e:
            print(f"[ERROR] Failed to check login status: {e}", flush=True)
            return False
        
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
            try:
                # Check if we're still on the right page
                current_url = self.page.url
                if 'eerder-gekocht' not in current_url and 'producten' not in current_url:
                    print(f"[WARNING] Page navigated away to {current_url}, stopping scroll", flush=True)
                    break
                
                # Scroll down smoothly
                await self.page.evaluate('window.scrollBy(0, 800)')
                await self.human_delay(800, 1200)
                
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
                    print(f"[INFO] Scrolled {i+1} times, page height: {current_height}px", flush=True)
            except Exception as e:
                print(f"[WARNING] Scroll error: {e}", flush=True)
                break
        
        # Scroll back to top
        try:
            await self.page.evaluate('window.scrollTo(0, 0)')
            await self.human_delay(500, 1000)
        except:
            pass
    
    async def extract_products(self) -> List[Dict[str, Any]]:
        """Extract product information from the page."""
        print("[INFO] Extracting products...", flush=True)
        
        products = await self.page.evaluate('''
            () => {
                const items = [];
                const seen = new Set();
                
                // Find all product cards/articles
                const cards = document.querySelectorAll('article, [data-testhook="product-card"]');
                
                cards.forEach(card => {
                    // Find product link
                    const link = card.querySelector('a[href*="/producten/product/"]');
                    if (!link) return;
                    
                    const url = new URL(link.href, location.origin).toString();
                    if (seen.has(url)) return;
                    seen.add(url);
                    
                    // Get product name - try multiple strategies
                    let name = '';
                    
                    // Strategy 1: Look for product title element
                    const titleEl = card.querySelector('[data-testhook="product-title"], [class*="title"]');
                    if (titleEl) {
                        name = titleEl.textContent.trim();
                    }
                    
                    // Strategy 2: Look for header elements
                    if (!name) {
                        const header = card.querySelector('h1, h2, h3, h4');
                        if (header) {
                            name = header.textContent.trim();
                        }
                    }
                    
                    // Strategy 3: Use aria-label
                    if (!name) {
                        name = link.getAttribute('aria-label') || '';
                    }
                    
                    // Strategy 4: Extract from URL
                    if (!name) {
                        const match = url.match(/\\/product\\/wi\\d+\\/(.+)$/);
                        if (match) {
                            name = match[1].replace(/-/g, ' ').replace(/^ah-/, 'AH ');
                        }
                    }
                    
                    // Clean the name - remove price/promo text that may have leaked in
                    name = name.replace(/\\d+[,.]\\d{2}[\\s€]?/g, ' ')  // Remove prices like 2.19
                              .replace(/\\d+(e)? gratis/gi, '')  // Remove "2e gratis" type promos
                              .replace(/\\d+ voor \\d+[,.]\\d+/gi, '')  // Remove "3 voor 5.00" type promos
                              .replace(/\\d+ (gram|ml|liter|kg|g|l) voor/gi, '')  // Remove quantity promos
                              .replace(/Prijsfavoriet/gi, '')
                              .replace(/Vegan/gi, '')  // Will re-detect this from product data
                              .replace(/\\s+/g, ' ')
                              .trim();
                    
                    // Get price
                    let price = null;
                    const priceEl = card.querySelector('[data-testhook="product-price"], [class*="price"]');
                    if (priceEl) {
                        const priceText = priceEl.textContent.replace(',', '.');
                        const priceMatch = priceText.match(/(\\d+\\.\\d{2})/);
                        if (priceMatch) {
                            price = parseFloat(priceMatch[1]);
                        }
                    }
                    
                    // Get image
                    const imgEl = card.querySelector('img');
                    const image = imgEl?.src || '';
                    
                    if (name && name.length > 2) {
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
    
    async def scrape(self, email: Optional[str] = None, password: Optional[str] = None, 
                     output_file: Optional[str] = None, save_cookies_to: Optional[str] = None) -> Dict[str, Any]:
        """
        Full scraping workflow.
        
        Args:
            email: AH account email (optional if using cookies)
            password: AH account password (optional if using cookies)
            output_file: Optional file path to save results
            save_cookies_to: Optional file path to save session cookies after login
            
        Returns:
            Dict with status and scraped products
        """
        result = {
            'success': False,
            'products': [],
            'error': None,
            'scraped_at': datetime.now(tz=None).astimezone().isoformat(),
            'login_method': None
        }
        
        try:
            await self.setup()
            
            # Try to use existing cookies first
            logged_in = False
            if self.cookies_file:
                logged_in = await self.check_logged_in()
                if logged_in:
                    result['login_method'] = 'cookies'
            
            # If not logged in via cookies, try credentials
            if not logged_in:
                if not email or not password:
                    result['error'] = 'no_credentials_and_cookies_invalid'
                    print("[ERROR] No valid cookies and no credentials provided", flush=True)
                    return result
                
                if not await self.login(email, password):
                    result['error'] = 'login_failed'
                    return result
                
                result['login_method'] = 'credentials'
                
                # Save cookies after successful login if requested
                if save_cookies_to:
                    await self.save_cookies(save_cookies_to)
            
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
    parser.add_argument('--email', '-e', help='AH account email (optional if using cookies)')
    parser.add_argument('--password', '-p', help='AH account password (optional if using cookies)')
    parser.add_argument('--output', '-o', default='auto_scrape_results.json', help='Output file')
    parser.add_argument('--headless', action='store_true', default=True, help='Run in headless mode')
    parser.add_argument('--no-headless', dest='headless', action='store_false', help='Show browser window')
    parser.add_argument('--browserless-url', help='URL to Browserless.io or similar service')
    parser.add_argument('--cookies', '-c', help='Path to cookies JSON file to load')
    parser.add_argument('--save-cookies', help='Path to save cookies after successful login')
    parser.add_argument('--capture-cookies', action='store_true', help='Interactive mode: open browser for manual login, then save cookies')
    
    args = parser.parse_args()
    
    # Special mode: capture cookies interactively
    if args.capture_cookies:
        return await capture_cookies_interactive(args.save_cookies or 'ah_cookies.json', args.headless)
    
    # Check for browserless URL in environment
    browserless_url = args.browserless_url or os.environ.get('BROWSERLESS_URL')
    
    # Validate inputs
    if not args.cookies and (not args.email or not args.password):
        print("[ERROR] Either --cookies or both --email and --password are required", flush=True)
        return 1
    
    scraper = AHAutoScraper(headless=args.headless, browserless_url=browserless_url, cookies_file=args.cookies)
    result = await scraper.scrape(args.email, args.password, args.output, args.save_cookies)
    
    # Output result as JSON for the server to parse
    print(f"\n[RESULT] {json.dumps(result)}", flush=True)
    
    return 0 if result['success'] else 1


async def capture_cookies_interactive(output_file: str, headless: bool = False) -> int:
    """
    Open a browser for manual login, then save the session cookies.
    This allows bypassing CAPTCHA by letting the user log in manually.
    """
    print("[INFO] === Cookie Capture Mode ===", flush=True)
    print("[INFO] A browser window will open. Please log in to your AH account.", flush=True)
    print("[INFO] After successful login, cookies will be saved automatically.", flush=True)
    print("", flush=True)
    
    p = await async_playwright().start()
    
    try:
        browser = await p.chromium.launch(
            headless=headless,  # Usually False for manual login
            args=[
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
            ]
        )
        
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 900},
            locale='nl-NL',
            timezone_id='Europe/Amsterdam',
        )
        
        page = await context.new_page()
        
        # Remove webdriver detection
        await page.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        """)
        
        print("[INFO] Opening AH login page...", flush=True)
        await page.goto('https://www.ah.nl/mijn', wait_until='domcontentloaded')
        
        print("[INFO] Please log in manually in the browser window.", flush=True)
        print("[INFO] Waiting for successful login...", flush=True)
        
        # Wait for the user to complete login (max 5 minutes)
        max_wait = 300
        for i in range(max_wait):
            await asyncio.sleep(1)
            
            current_url = page.url.lower()
            
            # Check if logged in (redirected away from login)
            if 'login.ah.nl' not in current_url and ('mijn' in current_url or 'ah.nl' in current_url):
                # Double check by trying to access a protected page
                await page.goto('https://www.ah.nl/mijn/eerder-gekocht', wait_until='domcontentloaded')
                await asyncio.sleep(2)
                
                if 'login.ah.nl' not in page.url.lower():
                    print(f"[SUCCESS] Login detected after {i+1} seconds!", flush=True)
                    break
            
            if (i + 1) % 30 == 0:
                print(f"[INFO] Still waiting for login... ({i+1}/{max_wait}s)", flush=True)
        else:
            print("[ERROR] Timeout waiting for login", flush=True)
            await browser.close()
            await p.stop()
            return 1
        
        # Save cookies
        cookies = await context.cookies()
        ah_cookies = [c for c in cookies if 'ah.nl' in c.get('domain', '')]
        
        with open(output_file, 'w') as f:
            json.dump(ah_cookies, f, indent=2)
        
        print(f"[SUCCESS] Saved {len(ah_cookies)} cookies to {output_file}", flush=True)
        print("[INFO] You can now use these cookies with: --cookies " + output_file, flush=True)
        
        # Print result for server parsing
        result = {
            'success': True,
            'cookies_saved': len(ah_cookies),
            'output_file': output_file
        }
        print(f"\n[RESULT] {json.dumps(result)}", flush=True)
        
        await browser.close()
        await p.stop()
        return 0
        
    except Exception as e:
        print(f"[ERROR] Cookie capture failed: {e}", flush=True)
        result = {'success': False, 'error': str(e)}
        print(f"\n[RESULT] {json.dumps(result)}", flush=True)
        await p.stop()
        return 1


if __name__ == '__main__':
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
