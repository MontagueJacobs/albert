#!/usr/bin/env python3
"""
Scrape AH "eerder gekocht" page to get products sorted by last purchase date.
This allows us to infer approximate purchase dates based on sort order.

Usage:
    python3 scrape_with_dates.py
    
The script will:
1. Open a browser for manual login
2. Navigate to eerder-gekocht sorted by "laatst gekocht"
3. Extract product data with relative purchase order
4. Save to JSON file
"""

import json
import time
import re
import os
from datetime import datetime, timedelta
from playwright.sync_api import sync_playwright

SESSION_FILE = os.path.join(os.path.dirname(__file__), '..', '..', 'ah_browser_session.json')
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), '..', '..', 'products_with_dates.json')

def load_session():
    """Load saved browser session if exists"""
    if os.path.exists(SESSION_FILE):
        try:
            with open(SESSION_FILE) as f:
                return json.load(f)
        except:
            pass
    return None

def save_session(context):
    """Save browser session"""
    storage = context.storage_state()
    with open(SESSION_FILE, 'w') as f:
        json.dump(storage, f)
    print(f'Session saved to {SESSION_FILE}')

def wait_for_login(page, timeout=120):
    """Wait for user to complete manual login"""
    print(f'\nPlease log in to your AH account ({timeout}s timeout)...')
    start = time.time()
    while time.time() - start < timeout:
        if 'login' not in page.url.lower():
            print('Login detected!')
            return True
        time.sleep(2)
    return False

def scrape_products(page):
    """Extract product data from the page"""
    products = []
    
    # Wait for products to load
    print('Waiting for products to load...')
    try:
        page.wait_for_selector('[data-testhook="product-card"], [class*="product-card"]', timeout=15000)
    except:
        # Try alternative selectors
        try:
            page.wait_for_selector('article, [class*="lane"]', timeout=10000)
        except:
            print('Could not find product elements')
            return products
    
    time.sleep(2)
    
    # Try multiple selectors
    selectors = [
        '[data-testhook="product-card"]',
        'article[class*="product"]',
        '[class*="product-card"]',
        '[class*="lane-item"]'
    ]
    
    cards = []
    for selector in selectors:
        cards = page.query_selector_all(selector)
        if cards:
            print(f'Found {len(cards)} products with selector: {selector}')
            break
    
    for i, card in enumerate(cards):
        try:
            product = {'order': i}  # Order indicates recency (0 = most recent)
            
            # Title
            title_el = card.query_selector('[data-testhook="product-title"], [class*="title"]')
            if title_el:
                product['name'] = title_el.inner_text().strip()
            
            # Price
            price_el = card.query_selector('[data-testhook="product-price"], [class*="price"]')
            if price_el:
                price_text = price_el.inner_text().strip()
                product['price_text'] = price_text
            
            # Product link (contains product ID)
            link_el = card.query_selector('a[href*="/producten/"]')
            if link_el:
                href = link_el.get_attribute('href')
                product['url'] = href
                # Extract product ID from URL
                match = re.search(r'/wi(\d+)', href)
                if match:
                    product['product_id'] = f'wi{match.group(1)}'
            
            # Image
            img_el = card.query_selector('img[src*="product"]')
            if img_el:
                product['image_url'] = img_el.get_attribute('src')
            
            if product.get('name'):
                products.append(product)
                
        except Exception as e:
            print(f'Error extracting product {i}: {e}')
    
    return products

def assign_estimated_dates(products):
    """
    Assign estimated purchase dates based on sort order.
    Products are sorted by "laatst gekocht" (last purchased),
    so we can estimate dates by distributing them over time.
    """
    if not products:
        return products
    
    # Assume purchases span roughly the last 3 months
    # More recent products get more recent dates
    today = datetime.now()
    total_days = 90  # 3 months
    
    # Distribute products across the time range
    for i, product in enumerate(products):
        # Calculate days ago based on position
        # First product (i=0) = most recent = today or yesterday
        # Last product = oldest = ~90 days ago
        ratio = i / max(len(products) - 1, 1)
        days_ago = int(ratio * total_days)
        
        estimated_date = today - timedelta(days=days_ago)
        product['estimated_purchase_date'] = estimated_date.strftime('%Y-%m-%d')
        product['days_ago'] = days_ago
    
    return products

def main():
    print('AH Eerder Gekocht Scraper with Purchase Dates')
    print('=' * 50)
    
    storage_state = load_session()
    
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            args=['--disable-blink-features=AutomationControlled']
        )
        
        context_options = {
            'viewport': {'width': 1920, 'height': 1080},
            'user_agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
        }
        
        if storage_state:
            context_options['storage_state'] = storage_state
        
        context = browser.new_context(**context_options)
        page = context.new_page()
        
        # Remove webdriver indicator
        page.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined});")
        
        # Start with homepage to warm up cookies
        print('Loading AH homepage...')
        page.goto('https://www.ah.nl/', timeout=60000)
        time.sleep(2)
        
        # Check login status
        print('Checking login status...')
        page.goto('https://www.ah.nl/mijn/account', timeout=60000)
        time.sleep(2)
        
        if 'login' in page.url.lower():
            if not wait_for_login(page):
                print('Login timeout - please try again')
                browser.close()
                return
            save_session(context)
        else:
            print('Already logged in')
        
        # Navigate to eerder-gekocht
        print('\nNavigating to eerder-gekocht...')
        page.goto('https://www.ah.nl/producten/eerder-gekocht', timeout=60000)
        time.sleep(3)
        
        # Try to sort by "laatst gekocht"
        print('Looking for sort options...')
        
        # Click sort dropdown
        sort_btn = page.query_selector('[data-testhook="sorting"], button:has-text("Sorteer")')
        if sort_btn and sort_btn.is_visible():
            print('Clicking sort dropdown...')
            sort_btn.click()
            time.sleep(1)
            
            # Find "laatst gekocht" option
            options = page.query_selector_all('[role="option"], li button, [class*="option"]')
            for opt in options:
                try:
                    text = opt.inner_text().lower()
                    if 'laatst' in text and 'gekocht' in text:
                        print(f'Selecting: {opt.inner_text()}')
                        opt.click()
                        time.sleep(3)
                        break
                except:
                    pass
        else:
            print('Sort button not found - products may not be in date order')
        
        # Scrape products
        print('\nScraping products...')
        products = scrape_products(page)
        print(f'Found {len(products)} products')
        
        # Assign estimated dates
        if products:
            products = assign_estimated_dates(products)
            
            # Save to file
            output = {
                'scraped_at': datetime.now().isoformat(),
                'total_products': len(products),
                'note': 'Products sorted by "laatst gekocht" (most recent first). Dates are estimated based on sort order.',
                'products': products
            }
            
            with open(OUTPUT_FILE, 'w') as f:
                json.dump(output, f, indent=2)
            print(f'\nSaved to {OUTPUT_FILE}')
            
            # Show sample
            print('\nSample products:')
            for p in products[:5]:
                print(f"  - {p.get('name', 'N/A')[:40]} | Est: {p.get('estimated_purchase_date', 'N/A')}")
        
        # Save session for next time
        save_session(context)
        
        browser.close()
        print('\nDone!')

if __name__ == '__main__':
    main()
