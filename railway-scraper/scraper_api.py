"""
Railway Scraper API - Handles remote scraping with visible browser via noVNC
"""
import os
import json
import asyncio
from flask import Flask, request, jsonify
from flask_cors import CORS
from playwright.async_api import async_playwright
import threading
import time
from datetime import datetime
import requests

app = Flask(__name__)
CORS(app, origins=["*"])  # Allow all origins for API

# Supabase config
SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://lachplbmhctoaynpkmye.supabase.co')
SUPABASE_KEY = os.environ.get('SUPABASE_ANON_KEY', '')

# Active scraping sessions
active_sessions = {}

class ScraperSession:
    def __init__(self, session_id):
        self.session_id = session_id
        self.status = 'initializing'
        self.message = 'Starting browser...'
        self.bonus_card = None
        self.email = None
        self.products_scraped = 0
        self.error = None
        self.browser = None
        self.page = None
        
    def to_dict(self):
        return {
            'session_id': self.session_id,
            'status': self.status,
            'message': self.message,
            'bonus_card': self.bonus_card,
            'email': self.email,
            'products_scraped': self.products_scraped,
            'error': self.error
        }

async def run_scraper(session: ScraperSession):
    """Run the actual scraper with Playwright"""
    try:
        session.status = 'launching'
        session.message = 'Launching browser...'
        
        async with async_playwright() as p:
            # Launch visible browser (will show in VNC)
            browser = await p.chromium.launch(
                headless=False,
                args=[
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-blink-features=AutomationControlled'
                ]
            )
            
            context = await browser.new_context(
                viewport={'width': 1280, 'height': 720},
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            )
            
            page = await context.new_page()
            session.browser = browser
            session.page = page
            
            # Navigate to AH login
            session.status = 'waiting_login'
            session.message = 'Please log in to Albert Heijn in the browser window'
            
            await page.goto('https://www.ah.nl/mijn/instellingen')
            
            # Wait for user to complete login (check for logged-in state)
            max_wait = 300  # 5 minutes
            waited = 0
            while waited < max_wait:
                await asyncio.sleep(2)
                waited += 2
                
                # Check if logged in by looking for account elements
                try:
                    # Check URL or page content for login success
                    current_url = page.url
                    if 'mijn/instellingen' in current_url or 'mijn/eerder-gekocht' in current_url:
                        # Try to find logout button or account menu
                        logged_in = await page.locator('[data-testhook="customer-menu-toggle"]').count() > 0
                        if logged_in:
                            session.status = 'logged_in'
                            session.message = 'Login detected! Extracting bonus card...'
                            break
                except:
                    pass
                    
                session.message = f'Waiting for login... ({waited}s)'
            
            if session.status != 'logged_in':
                session.status = 'timeout'
                session.error = 'Login timeout - please try again'
                await browser.close()
                return
            
            # Extract bonus card number
            session.message = 'Navigating to bonus card page...'
            await page.goto('https://www.ah.nl/mijn/klantenkaarten')
            await asyncio.sleep(2)
            
            # Try to extract bonus card number
            try:
                # Look for card number in page content
                content = await page.content()
                import re
                
                # AH bonus cards typically start with 2610
                card_match = re.search(r'2610\s*\d{4}\s*\d{4}\s*\d{4,5}', content)
                if card_match:
                    session.bonus_card = card_match.group().replace(' ', '')
                    session.message = f'Found bonus card: {session.bonus_card[:4]}****'
                else:
                    # Try alternative patterns
                    card_match = re.search(r'data-card[^>]*>([^<]+)', content)
                    if card_match:
                        digits = re.sub(r'\D', '', card_match.group(1))
                        if len(digits) >= 13:
                            session.bonus_card = digits
            except Exception as e:
                print(f'Error extracting bonus card: {e}')
            
            # Get email from settings page
            session.message = 'Getting account info...'
            await page.goto('https://www.ah.nl/mijn/instellingen')
            await asyncio.sleep(1)
            
            try:
                email_elem = await page.locator('input[type="email"], [data-testhook*="email"]').first
                if email_elem:
                    session.email = await email_elem.get_attribute('value')
            except:
                pass
            
            # Navigate to purchase history
            session.status = 'scraping'
            session.message = 'Scraping purchase history...'
            await page.goto('https://www.ah.nl/mijn/eerder-gekocht')
            await asyncio.sleep(2)
            
            products = []
            
            # Scroll and collect products
            for scroll_count in range(5):
                session.message = f'Scrolling page... ({scroll_count + 1}/5)'
                await page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
                await asyncio.sleep(1)
            
            # Extract product data
            session.message = 'Extracting product data...'
            product_cards = await page.locator('[data-testhook="product-card"], .product-card, [class*="ProductCard"]').all()
            
            for card in product_cards[:100]:  # Limit to 100 products
                try:
                    name = await card.locator('[class*="title"], h3, h4').first.text_content()
                    if name:
                        products.append({
                            'name': name.strip(),
                            'scraped_at': datetime.now().isoformat()
                        })
                        session.products_scraped = len(products)
                except:
                    continue
            
            session.message = f'Scraped {len(products)} products'
            
            # Save to Supabase
            if session.bonus_card and SUPABASE_KEY:
                session.message = 'Saving to database...'
                try:
                    # Register/update user
                    headers = {
                        'apikey': SUPABASE_KEY,
                        'Authorization': f'Bearer {SUPABASE_KEY}',
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                    }
                    
                    user_data = {
                        'bonus_card_number': session.bonus_card,
                        'ah_email': session.email,
                        'last_scrape_at': datetime.now().isoformat(),
                        'scrape_count': 1
                    }
                    
                    resp = requests.post(
                        f'{SUPABASE_URL}/rest/v1/ah_bonus_users',
                        headers=headers,
                        json=user_data
                    )
                    
                    session.message = f'Saved {len(products)} products to account'
                except Exception as e:
                    print(f'Error saving to Supabase: {e}')
            
            session.status = 'complete'
            session.message = f'Done! Scraped {len(products)} products'
            
            await browser.close()
            
    except Exception as e:
        session.status = 'error'
        session.error = str(e)
        print(f'Scraper error: {e}')

def start_scraper_thread(session: ScraperSession):
    """Run scraper in a separate thread with its own event loop"""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(run_scraper(session))
    loop.close()

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'vnc_available': True})

@app.route('/api/scrape/start', methods=['POST'])
def start_scrape():
    """Start a new scraping session"""
    session_id = f'session_{int(time.time() * 1000)}'
    session = ScraperSession(session_id)
    active_sessions[session_id] = session
    
    # Start scraper in background thread
    thread = threading.Thread(target=start_scraper_thread, args=(session,))
    thread.daemon = True
    thread.start()
    
    return jsonify({
        'session_id': session_id,
        'vnc_url': f'/vnc.html',
        'status_url': f'/api/scrape/status/{session_id}'
    })

@app.route('/api/scrape/status/<session_id>', methods=['GET'])
def get_status(session_id):
    """Get status of a scraping session"""
    session = active_sessions.get(session_id)
    if not session:
        return jsonify({'error': 'Session not found'}), 404
    return jsonify(session.to_dict())

@app.route('/api/scrape/sessions', methods=['GET'])
def list_sessions():
    """List all active sessions"""
    return jsonify({
        'sessions': [s.to_dict() for s in active_sessions.values()]
    })

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)
