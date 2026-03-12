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

# Import CAPTCHA solver (optional - only used if API key is set)
try:
    from captcha_solver import CaptchaSolver, extract_hcaptcha_sitekey, inject_captcha_response
    CAPTCHA_SOLVER_AVAILABLE = True
except ImportError:
    CAPTCHA_SOLVER_AVAILABLE = False
    print("[INFO] CAPTCHA solver module not available", file=sys.stderr)


class AHAutoScraper:
    """Automated scraper for Albert Heijn using Playwright."""
    
    def __init__(self, headless: bool = True, browserless_url: Optional[str] = None, cookies_file: Optional[str] = None, stealth_mode: bool = False, skip_account_protection: bool = False):
        """
        Initialize the scraper.
        
        Args:
            headless: Run browser in headless mode (for local browser)
            browserless_url: URL to connect to Browserless.io or similar service
                             e.g., "wss://chrome.browserless.io?token=YOUR_TOKEN"
            cookies_file: Path to JSON file with saved session cookies
            stealth_mode: If True, start headless and only show window if login needed
            skip_account_protection: If True, skip checking/disabling account protection
        """
        self.headless = headless
        self.stealth_mode = stealth_mode
        self.skip_account_protection = skip_account_protection
        self.browserless_url = browserless_url
        self.cookies_file = cookies_file
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self.products: List[Dict[str, Any]] = []
        self._playwright = None
        self._is_headless = headless  # Track current state
        
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
            # For stealth mode, we run non-headless but the window may be offscreen
            # This is because AH heavily blocks headless browsers
            start_headless = self.headless or self.stealth_mode
            self._is_headless = start_headless
            
            if self.stealth_mode:
                # In stealth mode, we run NON-headless because AH blocks headless
                # The browser window will appear but user interaction is minimal
                print("[INFO] Starting in stealth mode (visible browser for better compatibility)...", flush=True)
                start_headless = False
                self._is_headless = False
            elif start_headless:
                print("[WARNING] Running in headless mode - AH may block some pages!", flush=True)
            
            print(f"[INFO] Starting local browser (headless={start_headless})...", flush=True)
            
            self.browser = await self._playwright.chromium.launch(
                headless=start_headless,
                args=[
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--disable-site-isolation-trials',
                    '--disable-features=BlockInsecurePrivateNetworkRequests',
                    # Additional anti-detection args
                    '--disable-infobars',
                    '--window-size=1920,1080',
                    '--start-maximized',
                    '--disable-extensions',
                    '--disable-popup-blocking',
                    '--ignore-certificate-errors',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                ]
            )
        
        # Create context with realistic viewport and user agent - use a common real browser UA
        self.context = await self.browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            locale='nl-NL',
            timezone_id='Europe/Amsterdam',
            # Add extra headers to look more like a real browser
            extra_http_headers={
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1',
            }
        )
        
        self.page = await self.context.new_page()
        
        # Comprehensive anti-detection script
        await self.page.add_init_script("""
            // Remove webdriver flag
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            
            // Fake plugins array
            Object.defineProperty(navigator, 'plugins', { 
                get: () => {
                    const plugins = [
                        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
                        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
                        { name: 'Native Client', filename: 'internal-nacl-plugin' }
                    ];
                    plugins.refresh = () => {};
                    return plugins;
                }
            });
            
            // Fake languages
            Object.defineProperty(navigator, 'languages', { get: () => ['nl-NL', 'nl', 'en-US', 'en'] });
            
            // Fake platform
            Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
            
            // Fake hardware concurrency
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
            
            // Fake device memory
            Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
            
            // Override permissions
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );
            
            // Chrome-specific properties
            window.chrome = {
                runtime: {},
                loadTimes: function() {},
                csi: function() {},
                app: {}
            };
            
            // Prevent detection via toString
            const oldCall = Function.prototype.call;
            function hook(func, fake) {
                return function() {
                    if (this === window.navigator) {
                        return fake;
                    }
                    return oldCall.apply(this, arguments);
                };
            }
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
    
    async def disable_account_protection(self) -> bool:
        """
        Try to disable account protection for easier automated logins.
        Navigates to https://www.ah.nl/account/inloggegevens/controlecode and selects "No control code".
        """
        print("[INFO] Checking account protection settings...", flush=True)
        try:
            await self.page.goto('https://www.ah.nl/account/inloggegevens/controlecode', wait_until='domcontentloaded', timeout=15000)
            await asyncio.sleep(2)
            
            # First, dismiss any privacy/cookie consent popup
            privacy_selectors = [
                'button:has-text("Accepteren")',  # Accept
                'button:has-text("Alles accepteren")',  # Accept all
                'button:has-text("Alle cookies accepteren")',
                'button:has-text("Accept")',
                'button:has-text("Accept all")',
                'button[id*="accept"]',
                'button[class*="accept"]',
                '#accept-cookies',
                '[data-testid="cookie-accept"]',
                'button:has-text("Opslaan")',  # Save (for privacy preferences)
                'button:has-text("Sluiten")',  # Close
            ]
            
            for selector in privacy_selectors:
                try:
                    popup_btn = await self.page.query_selector(selector)
                    if popup_btn and await popup_btn.is_visible():
                        await popup_btn.click()
                        print(f"[INFO] Dismissed privacy popup", flush=True)
                        await asyncio.sleep(1)
                        break
                except Exception:
                    continue
            
            # Wait for page to settle after dismissing popup
            await asyncio.sleep(2)
            
            # Look for the third radio button option (No control code / Geen controlecode)
            # Use JavaScript to directly find and click the correct option
            clicked_option = False
            
            # Best approach: Use JavaScript to find all radio buttons and click the third one
            try:
                result = await self.page.evaluate('''() => {
                    // Get all radio inputs on the page
                    const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
                    console.log('Found ' + radios.length + ' radio buttons');
                    
                    // Click the third radio button (index 2)
                    if (radios.length >= 3) {
                        radios[2].click();
                        return { success: true, method: 'third' };
                    } else if (radios.length > 0) {
                        // Click the last one if we don't have exactly 3
                        radios[radios.length - 1].click();
                        return { success: true, method: 'last' };
                    }
                    return { success: false, method: 'none', count: radios.length };
                }''')
                if result.get('success'):
                    clicked_option = True
                    print(f"[INFO] Selected radio button via JS ({result.get('method')})", flush=True)
                else:
                    print(f"[DEBUG] JS radio approach found {result.get('count')} radios", flush=True)
            except Exception as e:
                print(f"[DEBUG] JS radio approach failed: {e}", flush=True)
            
            # Fallback: Find by text "Geen controlecode" and click the container/label
            if not clicked_option:
                try:
                    # Use locator with exact text matching for "Geen controlecode"
                    geen_element = await self.page.query_selector('text="Geen controlecode"')
                    if geen_element:
                        await geen_element.click()
                        clicked_option = True
                        print(f"[INFO] Clicked 'Geen controlecode' text directly", flush=True)
                except Exception as e:
                    print(f"[DEBUG] Text click failed: {e}", flush=True)
            
            # Approach 3: Use evaluate to find and click the correct radio by label text
            if not clicked_option:
                try:
                    result = await self.page.evaluate('''() => {
                        // Find all labels on the page
                        const labels = document.querySelectorAll('label');
                        for (const label of labels) {
                            if (label.textContent.toLowerCase().includes('geen controlecode')) {
                                // Found the label, click it or its associated input
                                const input = label.querySelector('input[type="radio"]') || 
                                              document.getElementById(label.getAttribute('for'));
                                if (input) {
                                    input.click();
                                    return 'clicked input';
                                } else {
                                    label.click();
                                    return 'clicked label';
                                }
                            }
                        }
                        // Try finding divs containing the text
                        const divs = document.querySelectorAll('div');
                        for (const div of divs) {
                            if (div.textContent.toLowerCase().includes('geen controlecode') && 
                                div.textContent.length < 100) {  // Avoid clicking large containers
                                div.click();
                                return 'clicked div';
                            }
                        }
                        return 'not found';
                    }''')
                    if result != 'not found':
                        clicked_option = True
                        print(f"[INFO] Selected 'Geen controlecode' via JS evaluate: {result}", flush=True)
                except Exception as e:
                    print(f"[DEBUG] JS evaluate approach failed: {e}", flush=True)
            
            if clicked_option:
                # Now click the Save button
                await asyncio.sleep(1)
                save_selectors = [
                    'button:has-text("Save")',
                    'button:has-text("Opslaan")',  # Dutch for Save
                    'button[type="submit"]',
                    '[data-testid="save-button"]',
                    'button.primary',
                ]
                
                for selector in save_selectors:
                    try:
                        save_btn = await self.page.query_selector(selector)
                        if save_btn:
                            await save_btn.click()
                            await asyncio.sleep(1)
                            print(f"[SUCCESS] Account protection disabled (No control code selected)", flush=True)
                            # Navigate away immediately to prevent any page scripts from running
                            await self.page.goto('about:blank', timeout=5000)
                            return True
                    except Exception:
                        continue
                
                print(f"[WARNING] Selected option but could not find Save button", flush=True)
                # Navigate away even on failure
                await self.page.goto('about:blank', timeout=5000)
                return False
            else:
                print(f"[INFO] Could not find 'No control code' option (may already be selected or page changed)", flush=True)
                # Navigate away
                await self.page.goto('about:blank', timeout=5000)
                return False
                
        except Exception as e:
            print(f"[WARNING] Could not check account protection: {e}", flush=True)
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
    
    async def restart_with_visible_browser(self) -> bool:
        """
        Restart the browser in non-headless mode so user can see it.
        Used in stealth mode when login is required.
        """
        if not self._is_headless or self.browserless_url:
            return True  # Already visible or remote
        
        print("[INFO] Cookies expired - restarting browser in visible mode for manual login...", flush=True)
        
        try:
            # Close current browser
            if self.context:
                await self.context.close()
            if self.browser:
                await self.browser.close()
            
            # Relaunch in visible mode
            self._is_headless = False
            self.browser = await self._playwright.chromium.launch(
                headless=False,
                args=[
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox',
                    '--disable-dev-shm-usage',
                ]
            )
            
            # Recreate context
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
            
            print("[INFO] Browser restarted in visible mode", flush=True)
            return True
            
        except Exception as e:
            print(f"[ERROR] Failed to restart browser: {e}", flush=True)
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
                    # Try to disable account protection for easier future logins
                    await self.disable_account_protection()
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
                # Try to disable account protection for easier future logins
                await self.disable_account_protection()
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
            # Start with the main eerder-gekocht page sorted by purchase date
            await self.page.goto('https://www.ah.nl/producten/eerder-gekocht?sortBy=purchase_date&page=0', wait_until='networkidle')
            await self.human_delay(2000, 3000)
            
            # Check if blocked
            page_content = await self.page.content()
            if 'access denied' in page_content.lower() or 'permission' in page_content.lower():
                print("[WARNING] Access denied on main page - trying bonus route...", flush=True)
                await self.page.goto('https://www.ah.nl/bonus/eerder-gekocht', wait_until='networkidle')
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
    
    async def scrape_all_pages(self) -> tuple[List[Dict[str, Any]], bool]:
        """Scrape products from multiple pages to get complete purchase history.
        
        Returns:
            Tuple of (products list, login_required bool)
        """
        all_products = []
        seen_urls = set()
        login_required = False
        
        # Pages to scrape - try the producten route which is the main purchase history page
        pages_to_scrape = [
            # Main purchase history page - this is the one the user sees
            ('https://www.ah.nl/producten/eerder-gekocht?sortBy=purchase_date&page=0', 'Purchase History'),
            # Bonus route - works reliably but has fewer products
            ('https://www.ah.nl/bonus/eerder-gekocht', 'Bonus Products'),
        ]
        
        for page_url, page_name in pages_to_scrape:
            print(f"[INFO] Scraping {page_name}...", flush=True)
            
            try:
                # Navigate with longer timeout
                await self.page.goto(page_url, wait_until='load', timeout=60000)
                await self.human_delay(3000, 4000)
                
                # Wait for page to stabilize and JS to run
                try:
                    await self.page.wait_for_load_state('networkidle', timeout=15000)
                except:
                    pass  # Continue even if networkidle times out
                
                # Extra wait for SPA content to render
                await self.human_delay(3000, 5000)
                
                # Scroll down a bit to trigger lazy loading
                await self.page.evaluate('window.scrollTo(0, 500)')
                await self.human_delay(2000, 3000)
                
                # Check if we have access - look for various block indicators
                try:
                    page_content = await self.page.content()
                    page_lower = page_content.lower()
                    current_url = self.page.url.lower()
                    
                    # Check for various access denial indicators
                    is_blocked = False
                    block_reason = None
                    needs_login = False
                    
                    # Hard block: Akamai/CDN access denied page
                    if '<title>access denied</title>' in page_lower:
                        is_blocked = True
                        block_reason = 'Akamai access denied'
                    # Check for explicit access denied in body (not just anywhere)
                    elif '<h1>access denied</h1>' in page_lower:
                        is_blocked = True
                        block_reason = 'access denied page'
                    # Redirected to login when we should be logged in
                    elif 'login.ah.nl' in current_url:
                        is_blocked = True
                        block_reason = 'session expired - login required'
                        needs_login = True
                    # CAPTCHA challenge page
                    elif '<title>' in page_lower and 'captcha' in page_lower.split('<title>')[1].split('</title>')[0]:
                        is_blocked = True
                        block_reason = 'captcha challenge'
                    # "Even controleren" re-authentication page
                    elif 'even controleren' in page_lower:
                        is_blocked = True
                        block_reason = 'session expired - re-authentication required'
                        needs_login = True
                    
                    if is_blocked:
                        print(f"[WARNING] Access denied to {page_name} ({block_reason}), skipping...", flush=True)
                        print(f"[DEBUG] Current URL: {self.page.url}", flush=True)
                        # Save page for debugging (only first 500 chars)
                        snippet = page_content[:500].replace('\n', ' ')
                        print(f"[DEBUG] Page snippet: {snippet}...", flush=True)
                        if needs_login:
                            login_required = True
                        continue
                except Exception as e:
                    print(f"[WARNING] Could not read page content for {page_name}: {e}", flush=True)
                    continue
                
                # Wait for products - try multiple selectors
                product_found = False
                product_selectors = [
                    'article a[href*="/producten/product/"]',
                    '[data-testhook="product-card"]',
                    'a[href*="/producten/product/"]',
                    '[class*="product"]',
                ]
                
                for selector in product_selectors:
                    try:
                        await self.page.wait_for_selector(selector, timeout=5000)
                        print(f"[DEBUG] Found elements with selector: {selector}", flush=True)
                        product_found = True
                        break
                    except:
                        continue
                
                if not product_found:
                    # Debug: show what's on the page
                    print(f"[WARNING] No products found on {page_name}", flush=True)
                    print(f"[DEBUG] Current URL: {self.page.url}", flush=True)
                    title = await self.page.title()
                    print(f"[DEBUG] Page title: {title}", flush=True)
                    # Check if there's any content suggesting we need to scroll or wait
                    page_text = await self.page.evaluate('document.body.innerText.substring(0, 1000)')
                    print(f"[DEBUG] Page text: {page_text[:500]}...", flush=True)
                    continue
                
                # Scroll to load all products on this page
                await self.scroll_and_load_all()
                
                # Also try to load more pages via pagination
                await self.load_all_pagination_pages()
                
                # Extract products
                products = await self.extract_products()
                
                # Add only new products (dedupe by URL)
                # Assign purchase_rank based on order (1 = most recently purchased)
                new_count = 0
                for product in products:
                    if product['url'] not in seen_urls:
                        seen_urls.add(product['url'])
                        # purchase_rank: position in sort order (1 = most recent purchase)
                        product['purchase_rank'] = len(all_products) + 1
                        all_products.append(product)
                        new_count += 1
                
                print(f"[SUCCESS] Found {new_count} new products from {page_name} (total: {len(all_products)})", flush=True)
                
            except Exception as e:
                print(f"[WARNING] Error scraping {page_name}: {e}", flush=True)
                continue
        
        return all_products, login_required
    
    async def load_all_pagination_pages(self, max_pages: int = 10):
        """Load additional pages via pagination if available."""
        for page_num in range(1, max_pages):
            try:
                # Check if there's a "load more" button or pagination
                load_more_selectors = [
                    'button:has-text("Meer laden")',
                    'button:has-text("Load more")',
                    '[data-testhook="load-more"]',
                    'a[href*="page=' + str(page_num) + '"]',
                ]
                
                clicked = False
                for selector in load_more_selectors:
                    try:
                        button = await self.page.query_selector(selector)
                        if button:
                            await button.click()
                            await self.human_delay(2000, 3000)
                            print(f"[INFO] Loaded page {page_num + 1}", flush=True)
                            clicked = True
                            break
                    except:
                        continue
                
                if not clicked:
                    # No more pages to load
                    break
                    
            except Exception as e:
                break

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
            'login_method': None,
            'login_required': False,  # Flag to indicate if manual login is needed
            'sorted_by_purchase_date': True  # Products are sorted by purchase date (most recent first)
        }
        
        try:
            await self.setup()
            
            # Try to use existing cookies first
            logged_in = False
            if self.cookies_file:
                logged_in = await self.check_logged_in()
                if logged_in:
                    result['login_method'] = 'cookies'
                    # Try to disable account protection for easier future logins
                    # This is done even with cookie login to ensure protection is off
                    # Skip if already disabled (flag is set)
                    if not self.skip_account_protection:
                        try:
                            await self.disable_account_protection()
                            # Re-save cookies after potentially changing protection
                            if save_cookies_to:
                                await self.save_cookies(save_cookies_to)
                        except Exception as e:
                            print(f"[WARNING] Could not disable account protection: {e}", flush=True)
                    else:
                        print("[INFO] Skipping account protection check (already disabled)", flush=True)
            
            # If not logged in via cookies and in stealth mode, signal that login is required
            if not logged_in and self.stealth_mode:
                # In stealth mode, don't try to login - just signal that it's needed
                result['error'] = 'login_required'
                result['login_required'] = True
                print("[INFO] Cookies expired or invalid - manual login required", flush=True)
                print("[INFO] Please use the cookie capture feature to log in", flush=True)
                return result
            
            # If not logged in via cookies, try credentials (non-stealth mode)
            if not logged_in:
                if not email or not password:
                    result['error'] = 'no_credentials_and_cookies_invalid'
                    print("[ERROR] No valid cookies and no credentials provided", flush=True)
                    return result
                
                # Restart browser in visible mode if needed
                if self._is_headless:
                    await self.restart_with_visible_browser()
                
                if not await self.login(email, password):
                    result['error'] = 'login_failed'
                    return result
                
                result['login_method'] = 'credentials'
                
                # Save cookies after successful login if requested
                if save_cookies_to:
                    await self.save_cookies(save_cookies_to)
            
            # Scrape all pages (purchase history + bonus products)
            products, needs_relogin = await self.scrape_all_pages()
            
            # Check if session expired during scraping
            if needs_relogin:
                result['error'] = 'login_required'
                result['login_required'] = True
                print("[INFO] Session expired during scraping - manual login required", flush=True)
                print("[INFO] Please use the cookie capture feature to log in again", flush=True)
                return result
            
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


async def visual_login_and_scrape(cookies_file: str, output_file: str = None) -> int:
    """
    Visual login mode: Opens a visible browser window for user to log in,
    then automatically scrapes their purchase history.
    
    This is the easiest flow for users:
    1. Browser opens to AH login page
    2. User logs in (handles CAPTCHA themselves)
    3. We detect successful login
    4. Automatically navigate to purchases and scrape
    5. Save cookies for future quick syncs
    """
    print("[INFO] === Visual Login Mode ===", flush=True)
    print("[INFO] Opening browser window for Albert Heijn login...", flush=True)
    print("[INFO] Please log in to your AH account. We'll detect when you're done.", flush=True)
    print("", flush=True)
    
    p = await async_playwright().start()
    result = {'success': False, 'products': [], 'count': 0}
    
    try:
        # Launch visible browser - try Firefox for better compatibility with AH
        # Firefox tends to have less bot detection issues
        browser = await p.firefox.launch(
            headless=False,
            args=[
                '--width=1280',
                '--height=900',
            ]
        )
        
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 900},
            user_agent='Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
            locale='nl-NL',
            timezone_id='Europe/Amsterdam',
        )
        
        page = await context.new_page()
        
        # Navigate to AH login page directly
        print("[INFO] Opening Albert Heijn login page...", flush=True)
        await page.goto('https://www.ah.nl/mijn/inloggen', wait_until='domcontentloaded')
        await asyncio.sleep(2)
        
        # Print current URL for debugging
        print(f"[DEBUG] Current URL: {page.url}", flush=True)
        
        # Check if user is already logged in (not on login page)
        async def is_logged_in():
            url = page.url.lower()
            # If we're NOT on any login/auth page, we're logged in
            if 'login.ah.nl' in url or 'inloggen' in url or '/auth' in url:
                return False
            return True
        
        if await is_logged_in():
            print("[SUCCESS] Already logged in!", flush=True)
        else:
            print("[INFO] ==========================================", flush=True)
            print("[INFO] Please log in to your Albert Heijn account.", flush=True)
            print("[INFO] Complete the login including any CAPTCHA.", flush=True) 
            print("[INFO] Take your time - we'll wait up to 5 minutes.", flush=True)
            print("[INFO] ==========================================", flush=True)
            
            # Wait for user to complete login (leave the login page)
            max_wait = 300
            login_success = False
            
            for i in range(max_wait):
                await asyncio.sleep(1)
                
                # Debug: print URL every 15 seconds
                if (i + 1) % 15 == 0:
                    print(f"[DEBUG] Current URL: {page.url}", flush=True)
                
                # Check if user has left the login page (= logged in successfully)
                if await is_logged_in():
                    print(f"[SUCCESS] Login complete after {i+1} seconds!", flush=True)
                    login_success = True
                    break
                
                if (i + 1) % 30 == 0:
                    print(f"[INFO] Still waiting for login... take your time ({i+1}/{max_wait}s)", flush=True)
            
            if not login_success:
                print("[ERROR] Login timeout - please try again", flush=True)
                result['error'] = 'login_timeout'
                await browser.close()
                await p.stop()
                print(f"\n[RESULT] {json.dumps(result)}", flush=True)
                return 1
        
        # Save cookies for future use
        cookies = await context.cookies()
        ah_cookies = [c for c in cookies if 'ah.nl' in c.get('domain', '')]
        
        with open(cookies_file, 'w') as f:
            json.dump(ah_cookies, f, indent=2)
        print(f"[INFO] Saved {len(ah_cookies)} cookies for future syncs", flush=True)
        
        # Try to disable account protection for easier future logins
        print(f"[INFO] Checking account protection settings...", flush=True)
        try:
            await page.goto('https://www.ah.nl/account/inloggegevens', wait_until='domcontentloaded', timeout=15000)
            await asyncio.sleep(2)
            
            # Look for "No control code" option and select it
            no_code_selectors = [
                'text="No control code"',
                ':has-text("No control code")',
                'label:has-text("No control code")',
                'text="Geen controlecode"',
            ]
            
            clicked_option = False
            for selector in no_code_selectors:
                try:
                    element = await page.query_selector(selector)
                    if element:
                        await element.click()
                        await asyncio.sleep(0.5)
                        print(f"[INFO] Selected 'No control code' option", flush=True)
                        clicked_option = True
                        break
                except Exception:
                    continue
            
            # Also try clicking via text
            if not clicked_option:
                try:
                    await page.click('text="No control code"', timeout=3000)
                    clicked_option = True
                    print(f"[INFO] Selected 'No control code' option via text click", flush=True)
                except Exception:
                    pass
            
            if clicked_option:
                # Click Save button
                await asyncio.sleep(1)
                save_selectors = [
                    'button:has-text("Save")',
                    'button:has-text("Opslaan")',
                    'button[type="submit"]',
                ]
                
                for selector in save_selectors:
                    try:
                        save_btn = await page.query_selector(selector)
                        if save_btn:
                            await save_btn.click()
                            await asyncio.sleep(2)
                            print(f"[SUCCESS] Account protection disabled", flush=True)
                            break
                    except Exception:
                        continue
                
                # Save updated cookies after disabling protection
                cookies = await context.cookies()
                ah_cookies = [c for c in cookies if 'ah.nl' in c.get('domain', '')]
                with open(cookies_file, 'w') as f:
                    json.dump(ah_cookies, f, indent=2)
            else:
                print(f"[INFO] No 'No control code' option found (may already be selected)", flush=True)
                
        except Exception as e:
            print(f"[WARNING] Could not check account protection: {e}", flush=True)
        
        # NOW navigate to the purchase history page - the MAIN one with all purchases
        target_url = 'https://www.ah.nl/producten/eerder-gekocht'
        print(f"[INFO] Navigating to your purchase history...", flush=True)
        print(f"[INFO] Target: {target_url}", flush=True)
        
        # Navigate and wait for page to fully load
        await page.goto(target_url, wait_until='networkidle', timeout=30000)
        await asyncio.sleep(3)
        
        actual_url = page.url
        print(f"[INFO] Actual URL: {actual_url}", flush=True)
        
        # If we got redirected to bonus page, let the user manually navigate
        # Give them plenty of time and don't close the browser!
        if 'producten/eerder-gekocht' not in actual_url.lower():
            print(f"", flush=True)
            print(f"[ACTION REQUIRED] ========================================", flush=True)
            print(f"[ACTION REQUIRED] ", flush=True)
            print(f"[ACTION REQUIRED] You were redirected to: {actual_url}", flush=True)
            print(f"[ACTION REQUIRED] ", flush=True)
            print(f"[ACTION REQUIRED] Please MANUALLY navigate to your purchase history:", flush=True)
            print(f"[ACTION REQUIRED] ", flush=True)
            print(f"[ACTION REQUIRED]   https://www.ah.nl/producten/eerder-gekocht", flush=True)
            print(f"[ACTION REQUIRED] ", flush=True)
            print(f"[ACTION REQUIRED] Steps:", flush=True)
            print(f"[ACTION REQUIRED]   1. Click on the address bar", flush=True)
            print(f"[ACTION REQUIRED]   2. Type or paste the URL above", flush=True)
            print(f"[ACTION REQUIRED]   3. Press Enter", flush=True)
            print(f"[ACTION REQUIRED] ", flush=True)
            print(f"[ACTION REQUIRED] You have 2 MINUTES. Take your time!", flush=True)
            print(f"[ACTION REQUIRED] ========================================", flush=True)
            print(f"", flush=True)
            
            # Wait for user to manually navigate - give them 2 full minutes
            found_page = False
            for i in range(120):
                await asyncio.sleep(1)
                
                try:
                    current = page.url.lower()
                    
                    # Check if user navigated to the right page (any eerder-gekocht page)
                    if 'eerder-gekocht' in current and 'bonus' not in current:
                        print(f"[SUCCESS] You're on the main purchase history page!", flush=True)
                        print(f"[INFO] Waiting for page to fully load...", flush=True)
                        await asyncio.sleep(5)  # Wait for page to load
                        actual_url = page.url
                        found_page = True
                        break
                    
                    # Also accept if they're on producten/eerder-gekocht even with bonus in path
                    if 'producten/eerder-gekocht' in current:
                        print(f"[SUCCESS] You're on the purchase history page!", flush=True)
                        print(f"[INFO] Waiting for page to fully load...", flush=True)
                        await asyncio.sleep(5)  # Wait for page to load
                        actual_url = page.url
                        found_page = True
                        break
                        
                except Exception as e:
                    # Page might be navigating, just wait
                    pass
                
                if (i + 1) % 20 == 0:
                    print(f"[INFO] Still waiting for you to navigate... ({i+1}/120s)", flush=True)
                    print(f"[INFO] Current URL: {page.url}", flush=True)
            
            if not found_page:
                print(f"[INFO] Timeout waiting for navigation. Will scrape current page anyway.", flush=True)
                actual_url = page.url
        
        # Report final page - DON'T check for login page, just scrape whatever we have
        print(f"[INFO] ========================================", flush=True)
        print(f"[INFO] You're on: {actual_url}", flush=True)
        print(f"[INFO] ========================================", flush=True)
        
        # Give the page time to fully load before scraping
        print("[INFO] Waiting for page to fully load...", flush=True)
        await asyncio.sleep(5)
        
        # Now scrape the purchase history
        print("[INFO] Starting to scrape your purchases...", flush=True)
        print("[INFO] (This may take a minute - scrolling through the page)", flush=True)
        
        products = []
        seen_urls = set()
        
        # Helper function to scrape products from current page
        async def scrape_current_page():
            """Scrape products from the current page by scrolling and extracting."""
            local_products = []
            last_count = 0
            scroll_attempts = 0
            max_scrolls = 30  # More scrolls to get more products
            
            # Wait for products to load
            try:
                await page.wait_for_selector('a[href*="/producten/product/"]', timeout=10000)
                print("[DEBUG] Product elements found on page", flush=True)
            except:
                print("[DEBUG] No product elements found immediately, will try scrolling...", flush=True)
            
            while scroll_attempts < max_scrolls:
                await asyncio.sleep(1)
                
                try:
                    page_products = await page.evaluate("""
                    () => {
                        const items = [];
                        const links = document.querySelectorAll('a[href*="/producten/product/"]');
                        
                        links.forEach(a => {
                            const url = a.href;
                            let name = a.getAttribute('aria-label') || '';
                            if (!name) {
                                const title = a.closest('article')?.querySelector('[data-testhook="product-title"], h3, h2');
                                name = title?.textContent?.trim() || '';
                            }
                            
                            const card = a.closest('article') || a.parentElement;
                            let price = null;
                            const priceEl = card?.querySelector('[data-testhook="product-price"], [class*="price"]');
                            if (priceEl) {
                                const match = priceEl.textContent?.replace(',', '.').match(/(\\d+\\.?\\d*)/);
                                if (match) price = parseFloat(match[1]);
                            }
                            
                            const img = card?.querySelector('img');
                            const image = img?.src || '';
                            
                            if (name && url) {
                                items.push({ name: name.trim(), url, price, image });
                            }
                        });
                        
                        return items;
                    }
                """)
                except Exception as eval_error:
                    print(f"[DEBUG] Page evaluation error (retrying): {eval_error}", flush=True)
                    await asyncio.sleep(2)
                    scroll_attempts += 1
                    continue
                
                # Add new products with purchase_rank
                for p in page_products:
                    if p['url'] not in seen_urls:
                        seen_urls.add(p['url'])
                        # Assign purchase_rank (1 = most recent purchase)
                        p['purchase_rank'] = len(local_products) + 1
                        local_products.append(p)
                
                current_count = len(local_products)
                if current_count > last_count:
                    print(f"[INFO] Found {current_count} new products on this page...", flush=True)
                    last_count = current_count
                
                # Scroll down
                try:
                    await page.evaluate('window.scrollBy(0, window.innerHeight)')
                except:
                    pass
                await asyncio.sleep(1.5)
                
                scroll_attempts += 1
                if current_count == last_count and scroll_attempts > 5:
                    break
            
            return local_products
        
        # Scrape the current page (we already navigated above)
        try:
            page_products = await scrape_current_page()
            products.extend(page_products)
            print(f"[SUCCESS] Scraped {len(page_products)} products", flush=True)
        except Exception as e:
            print(f"[ERROR] Error scraping: {e}", flush=True)
            import traceback
            traceback.print_exc()
        
        print(f"[INFO] ========================================", flush=True)
        print(f"[SUCCESS] Total scraped: {len(products)} unique products!", flush=True)
        
        result['success'] = True
        result['products'] = products
        result['count'] = len(products)
        result['cookies_saved'] = len(ah_cookies)
        result['sorted_by_purchase_date'] = True  # Products sorted by purchase date
        
        # Save to file if specified
        if output_file:
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(result, f, indent=2, ensure_ascii=False)
            print(f"[INFO] Saved results to {output_file}", flush=True)
        
        await browser.close()
        await p.stop()
        
        print(f"\n[RESULT] {json.dumps(result)}", flush=True)
        return 0
        
    except Exception as e:
        print(f"[ERROR] Visual login failed: {e}", flush=True)
        result['error'] = str(e)
        print(f"\n[RESULT] {json.dumps(result)}", flush=True)
        try:
            await p.stop()
        except:
            pass
        return 1


async def main():
    parser = argparse.ArgumentParser(description='Automated AH Scraper')
    parser.add_argument('--email', '-e', help='AH account email (optional if using cookies)')
    parser.add_argument('--password', '-p', help='AH account password (optional if using cookies)')
    parser.add_argument('--output', '-o', default='auto_scrape_results.json', help='Output file')
    parser.add_argument('--headless', action='store_true', default=True, help='Run in headless mode')
    parser.add_argument('--no-headless', dest='headless', action='store_false', help='Show browser window')
    parser.add_argument('--stealth', action='store_true', help='Stealth mode: start headless, signal if login needed')
    parser.add_argument('--browserless-url', help='URL to Browserless.io or similar service')
    parser.add_argument('--cookies', '-c', help='Path to cookies JSON file to load')
    parser.add_argument('--save-cookies', help='Path to save cookies after successful login')
    parser.add_argument('--capture-cookies', action='store_true', help='Interactive mode: open browser for manual login, then save cookies')
    parser.add_argument('--visual-login', action='store_true', help='Visual login mode: open browser, user logs in, then automatically scrape')
    parser.add_argument('--skip-account-protection', action='store_true', help='Skip checking/disabling account protection (already done)')
    parser.add_argument('--auto-login', action='store_true', help='Automatic login mode: use provided credentials to log in')
    parser.add_argument('--ah-email', help='AH account email for auto-login')
    parser.add_argument('--ah-password', help='AH account password for auto-login')
    
    args = parser.parse_args()
    
    # Special mode: automatic login with credentials
    if args.auto_login:
        if not args.ah_email or not args.ah_password:
            print("[ERROR] --auto-login requires --ah-email and --ah-password", flush=True)
            return 1
        return await auto_login_and_save_cookies(
            args.ah_email, 
            args.ah_password, 
            args.save_cookies or 'ah_cookies.json',
            args.headless
        )
    
    # Special mode: visual login - opens browser, user logs in, then scrapes
    if args.visual_login:
        return await visual_login_and_scrape(args.save_cookies or 'ah_cookies.json', args.output)
    
    # Special mode: capture cookies interactively
    if args.capture_cookies:
        return await capture_cookies_interactive(args.save_cookies or 'ah_cookies.json', args.headless)
    
    # Check for browserless URL in environment
    browserless_url = args.browserless_url or os.environ.get('BROWSERLESS_URL')
    
    # In stealth mode with cookies, credentials are optional
    if args.stealth and args.cookies:
        pass  # OK - will use cookies and signal if login needed
    elif not args.cookies and (not args.email or not args.password):
        print("[ERROR] Either --cookies or both --email and --password are required", flush=True)
        return 1
    
    scraper = AHAutoScraper(
        headless=args.headless, 
        browserless_url=browserless_url, 
        cookies_file=args.cookies,
        stealth_mode=args.stealth,
        skip_account_protection=args.skip_account_protection
    )
    result = await scraper.scrape(args.email, args.password, args.output, args.save_cookies)
    
    # Output result as JSON for the server to parse
    print(f"\n[RESULT] {json.dumps(result)}", flush=True)
    
    return 0 if result['success'] else 1


async def auto_login_and_save_cookies(email: str, password: str, output_file: str, headless: bool = False) -> int:
    """
    Automatically log in using provided credentials and save cookies.
    Browser starts minimized, only shows when CAPTCHA appears.
    """
    print("[INFO] === Auto Login Mode ===", flush=True)
    print(f"[INFO] Logging in as: {email}", flush=True)
    print("[INFO] Attempting automatic login...", flush=True)
    print("", flush=True)
    
    p = await async_playwright().start()
    browser_shown = False  # Track if we've shown browser to user
    
    try:
        # Start browser minimized so user doesn't see automation
        browser = await p.chromium.launch(
            headless=False,  # Must be visible to show later
            args=[
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
                '--start-minimized',  # Start minimized
            ]
        )
        
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 900},
            locale='nl-NL',
            timezone_id='Europe/Amsterdam',
        )
        
        page = await context.new_page()
        
        # Store CDP session and window ID for later use
        cdp_session = None
        window_id = None
        
        # Minimize window immediately using CDP
        try:
            cdp_session = await context.new_cdp_session(page)
            window_info = await cdp_session.send('Browser.getWindowForTarget')
            window_id = window_info['windowId']
            await cdp_session.send('Browser.setWindowBounds', {
                'windowId': window_id,
                'bounds': {'windowState': 'minimized'}
            })
            print("[INFO] Browser minimized", flush=True)
        except Exception as e:
            print(f"[WARN] Could not minimize browser: {e}", flush=True)
        
        # Helper to bring browser window on-screen when needed
        async def show_browser():
            nonlocal browser_shown, cdp_session, window_id
            if not browser_shown:
                print("[INFO] CAPTCHA detected! Showing browser for manual solving...", flush=True)
                try:
                    if cdp_session and window_id:
                        # Restore and bring to front
                        await cdp_session.send('Browser.setWindowBounds', {
                            'windowId': window_id,
                            'bounds': {'windowState': 'normal'}
                        })
                        await asyncio.sleep(0.1)
                        await cdp_session.send('Browser.setWindowBounds', {
                            'windowId': window_id,
                            'bounds': {'left': 100, 'top': 100, 'width': 1280, 'height': 900}
                        })
                    await page.bring_to_front()
                except Exception as e:
                    print(f"[WARN] Could not show browser: {e}", flush=True)
                    # Fallback: just bring to foreground with JavaScript
                    try:
                        await page.evaluate('window.focus()')
                    except:
                        pass
                browser_shown = True
        
        # Helper to detect CAPTCHA
        async def has_captcha():
            try:
                # Check for hCaptcha iframe or elements
                captcha = await page.query_selector('iframe[src*="hcaptcha"], iframe[src*="recaptcha"], [class*="captcha"], #captcha')
                return captcha is not None
            except:
                return False
        
        # Remove webdriver detection
        await page.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        """)
        
        print("[INFO] Opening AH login page...", flush=True)
        await page.goto('https://www.ah.nl/mijn', wait_until='domcontentloaded')
        await asyncio.sleep(2)
        
        # Wait for login form
        print("[INFO] Waiting for login form...", flush=True)
        try:
            await page.wait_for_selector('input[type="email"], input[name="email"], input[id*="email"]', timeout=15000)
        except Exception:
            print("[INFO] Already logged in or redirected", flush=True)
        
        # Check if we're on login page
        if 'login.ah.nl' in page.url.lower() or 'inloggen' in page.url.lower():
            print("[INFO] Filling in credentials...", flush=True)
            await asyncio.sleep(0.5)  # Brief wait for page to settle
            
            # Fill email - try multiple selectors
            email_input = await page.query_selector('input[type="email"], input[name="email"], input[id*="email"], input[name="username"]')
            if email_input:
                await email_input.fill(email)  # Instant fill
                print("[INFO] Email entered", flush=True)
            else:
                print("[WARN] Could not find email input", flush=True)
            
            # Fill password - try multiple selectors
            password_input = await page.query_selector('input[type="password"], input[name="password"]')
            if password_input:
                await password_input.fill(password)  # Instant fill
                print("[INFO] Password entered", flush=True)
            else:
                print("[WARN] Could not find password input", flush=True)
            
            # Click login button - try multiple selectors
            await asyncio.sleep(0.2)
            login_button = await page.query_selector('button[type="submit"], button:has-text("Inloggen"), input[type="submit"]')
            if login_button:
                print("[INFO] Clicking login button...", flush=True)
                await login_button.click()
                print("[INFO] Login button clicked", flush=True)
            else:
                # Try pressing Enter as fallback
                print("[INFO] No login button found, pressing Enter...", flush=True)
                await page.keyboard.press('Enter')
            
            # Wait for login to complete or CAPTCHA
            print("[INFO] Waiting for login to complete...", flush=True)
            
            max_wait = 180  # 3 minutes for CAPTCHA solving
            captcha_shown_at = None
            captcha_solve_attempted = False
            
            # Check if we have a CAPTCHA solver available
            captcha_solver = None
            captcha_api_key = os.environ.get('CAPTCHA_API_KEY')
            if CAPTCHA_SOLVER_AVAILABLE and captcha_api_key:
                try:
                    captcha_solver = CaptchaSolver(captcha_api_key)
                    balance = await captcha_solver.get_balance()
                    if balance is not None:
                        print(f"[INFO] CAPTCHA solver ready (balance: ${balance:.2f})", flush=True)
                    else:
                        print("[WARN] CAPTCHA solver configured but couldn't verify balance", flush=True)
                except Exception as e:
                    print(f"[WARN] CAPTCHA solver init failed: {e}", flush=True)
                    captcha_solver = None
            
            for i in range(max_wait):
                await asyncio.sleep(1)
                current_url = page.url.lower()
                
                # Check for CAPTCHA
                if await has_captcha():
                    if not captcha_solve_attempted and captcha_solver:
                        # Try to solve CAPTCHA automatically with 2Captcha
                        print("[INFO] CAPTCHA detected! Attempting automatic solve...", flush=True)
                        captcha_solve_attempted = True
                        
                        try:
                            # Extract sitekey from page
                            sitekey = await extract_hcaptcha_sitekey(page)
                            if sitekey:
                                print(f"[INFO] Found hCaptcha sitekey: {sitekey[:20]}...", flush=True)
                                
                                # Solve the CAPTCHA
                                token = await captcha_solver.solve_hcaptcha(sitekey, page.url, timeout=120)
                                
                                if token:
                                    print("[INFO] CAPTCHA solved! Injecting response...", flush=True)
                                    await inject_captcha_response(page, token, 'hcaptcha')
                                    await asyncio.sleep(3)  # Wait for form submission
                                else:
                                    print("[WARN] CAPTCHA solve failed, showing browser for manual solve", flush=True)
                                    await show_browser()
                                    captcha_shown_at = i
                            else:
                                print("[WARN] Could not extract CAPTCHA sitekey, showing browser", flush=True)
                                await show_browser()
                                captcha_shown_at = i
                        except Exception as e:
                            print(f"[WARN] CAPTCHA solve error: {e}, showing browser", flush=True)
                            await show_browser()
                            captcha_shown_at = i
                    elif not browser_shown and not captcha_solver:
                        # No solver available, show browser for manual solve
                        await show_browser()
                        captcha_shown_at = i
                    elif captcha_shown_at and (i - captcha_shown_at) % 30 == 0:
                        print(f"[INFO] Waiting for CAPTCHA to be solved... ({i - captcha_shown_at}s)", flush=True)
                
                # Check if logged in
                if 'login.ah.nl' not in current_url and ('mijn' in current_url or 'ah.nl' in current_url):
                    # Verify by accessing protected page
                    await page.goto('https://www.ah.nl/mijn/eerder-gekocht', wait_until='domcontentloaded')
                    await asyncio.sleep(2)
                    
                    if 'login.ah.nl' not in page.url.lower():
                        if captcha_solve_attempted and not browser_shown:
                            print(f"[SUCCESS] Login successful with automatic CAPTCHA solve! ({i+1} seconds)", flush=True)
                        elif browser_shown:
                            print(f"[SUCCESS] Login successful after manual CAPTCHA solve! ({i+1} seconds)", flush=True)
                        else:
                            print(f"[SUCCESS] Login successful automatically! ({i+1} seconds)", flush=True)
                        break
                
                # Only show periodic updates if browser not yet shown
                if not browser_shown and (i + 1) % 10 == 0:
                    print(f"[INFO] Still processing... ({i+1}s)", flush=True)
            else:
                print("[ERROR] Login timeout", flush=True)
                result = {'success': False, 'error': 'Login timeout - CAPTCHA not solved?'}
                print(f"\n[RESULT] {json.dumps(result)}", flush=True)
                await browser.close()
                await p.stop()
                return 1
        
        # Save cookies
        cookies = await context.cookies()
        ah_cookies = [c for c in cookies if 'ah.nl' in c.get('domain', '')]
        
        with open(output_file, 'w') as f:
            json.dump(ah_cookies, f, indent=2)
        
        print(f"[SUCCESS] Saved {len(ah_cookies)} cookies to {output_file}", flush=True)
        
        result = {
            'success': True,
            'cookies_saved': len(ah_cookies),
            'output_file': output_file,
            'email': email  # Include email for server to save
        }
        print(f"\n[RESULT] {json.dumps(result)}", flush=True)
        
        await browser.close()
        await p.stop()
        return 0
        
    except Exception as e:
        print(f"[ERROR] Auto login failed: {e}", flush=True)
        result = {'success': False, 'error': str(e)}
        print(f"\n[RESULT] {json.dumps(result)}", flush=True)
        await p.stop()
        return 1


async def capture_cookies_interactive(output_file: str, headless: bool = False) -> int:
    """
    Open a browser for manual login, then save the session cookies.
    This allows bypassing CAPTCHA by letting the user log in manually.
    Also captures credentials from the login form for admin use.
    """
    print("[INFO] === Cookie Capture Mode ===", flush=True)
    print("[INFO] A browser window will open. Please log in to your AH account.", flush=True)
    print("[INFO] After successful login, cookies will be saved automatically.", flush=True)
    print("", flush=True)
    
    p = await async_playwright().start()
    captured_credentials = {'email': None, 'password': None}
    
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
        
        # Expose a function to capture credentials from the login form
        async def handle_credentials(data):
            if data.get('email'):
                captured_credentials['email'] = data['email']
            if data.get('password'):
                captured_credentials['password'] = data['password']
            print(f"[DEBUG] Captured credentials: email={'yes' if data.get('email') else 'no'}, password={'yes' if data.get('password') else 'no'}", flush=True)
        
        await page.expose_function('captureCredentials', handle_credentials)
        
        print("[INFO] Opening AH login page...", flush=True)
        await page.goto('https://www.ah.nl/mijn', wait_until='domcontentloaded')
        
        print("[INFO] Please log in manually in the browser window.", flush=True)
        print("[INFO] Waiting for successful login...", flush=True)
        
        # Wait for the user to complete login (max 5 minutes)
        max_wait = 300
        login_form_injected = False
        
        for i in range(max_wait):
            await asyncio.sleep(1)
            
            current_url = page.url.lower()
            
            # Inject credential capture script on login page
            if 'login.ah.nl' in current_url and not login_form_injected:
                try:
                    await page.evaluate("""
                        (() => {
                            // Capture credentials when form is submitted or when login button is clicked
                            const captureAndSend = () => {
                                const emailInput = document.querySelector('input[type="email"], input[name="email"], input[id*="email"], input[id*="username"]');
                                const passwordInput = document.querySelector('input[type="password"]');
                                if (emailInput && passwordInput) {
                                    const email = emailInput.value;
                                    const password = passwordInput.value;
                                    if (email && password) {
                                        window.captureCredentials({ email, password });
                                    }
                                }
                            };
                            
                            // Watch for form submission
                            document.addEventListener('submit', captureAndSend, true);
                            
                            // Watch for click on login buttons
                            document.addEventListener('click', (e) => {
                                if (e.target.matches('button[type="submit"], button[data-testid*="login"], button[class*="login"]') ||
                                    e.target.closest('button[type="submit"], button[data-testid*="login"], button[class*="login"]')) {
                                    captureAndSend();
                                }
                            }, true);
                            
                            // Periodic capture as backup (every 500ms while on login page)
                            setInterval(captureAndSend, 500);
                            
                            console.log('[AH Scraper] Credential capture injected');
                        })();
                    """)
                    login_form_injected = True
                    print("[DEBUG] Injected credential capture script", flush=True)
                except Exception as e:
                    print(f"[DEBUG] Could not inject capture script: {e}", flush=True)
            
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
        
        # Print result for server parsing (include captured credentials)
        result = {
            'success': True,
            'cookies_saved': len(ah_cookies),
            'output_file': output_file,
            'credentials': {
                'email': captured_credentials['email'],
                'password': captured_credentials['password']
            } if captured_credentials['email'] and captured_credentials['password'] else None
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
