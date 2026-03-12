#!/usr/bin/env python3
"""
CAPTCHA Solver using Anti-Captcha compatible API

Supports hCaptcha (used by Albert Heijn) and reCAPTCHA.
Works with:
  - CapMonster Cloud (capmonster.cloud) - AI-based, cheaper, faster
  - Anti-Captcha (anti-captcha.com) - Human workers, reliable
"""

import os
import time
import asyncio
import aiohttp
from typing import Optional, Dict, Any


class CaptchaSolver:
    """Solve CAPTCHAs using CapMonster or Anti-Captcha service."""
    
    # API endpoints - CapMonster is default (cheaper, faster, AI-based)
    # Set CAPTCHA_SERVICE=anticaptcha to use Anti-Captcha instead
    SERVICES = {
        'capmonster': 'https://api.capmonster.cloud',
        'anticaptcha': 'https://api.anti-captcha.com'
    }
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize the solver.
        
        Args:
            api_key: API key. If not provided, reads from CAPTCHA_API_KEY env var.
        """
        self.api_key = api_key or os.environ.get('CAPTCHA_API_KEY')
        if not self.api_key:
            raise ValueError("No CAPTCHA API key provided. Set CAPTCHA_API_KEY environment variable.")
        
        # Choose service based on env var (default: capmonster)
        service = os.environ.get('CAPTCHA_SERVICE', 'capmonster').lower()
        self.API_BASE = self.SERVICES.get(service, self.SERVICES['capmonster'])
        print(f"[CAPTCHA] Using service: {service} ({self.API_BASE})", flush=True)
    
    async def solve_hcaptcha(self, sitekey: str, page_url: str, timeout: int = 180) -> Optional[str]:
        """
        Solve an hCaptcha challenge using Anti-Captcha API.
        
        Args:
            sitekey: The hCaptcha sitekey (found in data-sitekey attribute)
            page_url: The URL of the page with the CAPTCHA
            timeout: Maximum time to wait for solution (seconds)
            
        Returns:
            The CAPTCHA token/response to submit, or None if failed
        """
        print(f"[CAPTCHA] Submitting hCaptcha to Anti-Captcha...", flush=True)
        print(f"[CAPTCHA] Sitekey: {sitekey}", flush=True)
        print(f"[CAPTCHA] Page URL: {page_url}", flush=True)
        
        try:
            import json as json_mod
            
            async with aiohttp.ClientSession() as session:
                # Step 1: Create the task
                create_url = f"{self.API_BASE}/createTask"
                
                task_payload = {
                    "clientKey": self.api_key,
                    "task": {
                        "type": "HCaptchaTaskProxyless",
                        "websiteURL": page_url,
                        "websiteKey": sitekey
                    }
                }
                
                print(f"[CAPTCHA] Creating task at: {create_url}", flush=True)
                
                async with session.post(create_url, json=task_payload) as resp:
                    result = await resp.json()
                    print(f"[CAPTCHA] Create response: {result}", flush=True)
                
                if result.get('errorId') != 0:
                    error_code = result.get('errorCode', 'Unknown')
                    error_desc = result.get('errorDescription', '')
                    print(f"[CAPTCHA] Create task failed: {error_code} - {error_desc}", flush=True)
                    return None
                
                task_id = result.get('taskId')
                print(f"[CAPTCHA] Task created! ID: {task_id}", flush=True)
                print(f"[CAPTCHA] Waiting for solution (this takes 30-90 seconds)...", flush=True)
                
                # Step 2: Poll for the result
                result_url = f"{self.API_BASE}/getTaskResult"
                result_payload = {
                    "clientKey": self.api_key,
                    "taskId": task_id
                }
                
                start_time = time.time()
                poll_interval = 5  # seconds
                
                # Wait initial 10 seconds before first poll
                await asyncio.sleep(10)
                
                while time.time() - start_time < timeout:
                    elapsed = int(time.time() - start_time)
                    
                    async with session.post(result_url, json=result_payload) as resp:
                        result = await resp.json()
                    
                    if result.get('errorId') != 0:
                        error_code = result.get('errorCode', 'Unknown')
                        print(f"[CAPTCHA] Error: {error_code}", flush=True)
                        return None
                    
                    status = result.get('status')
                    
                    if status == 'ready':
                        solution = result.get('solution', {})
                        token = solution.get('gRecaptchaResponse')
                        if token:
                            print(f"[CAPTCHA] Solved in {elapsed}s!", flush=True)
                            print(f"[CAPTCHA] Token length: {len(token)}", flush=True)
                            return token
                        else:
                            print(f"[CAPTCHA] No token in solution: {solution}", flush=True)
                            return None
                    
                    elif status == 'processing':
                        print(f"[CAPTCHA] Still solving... ({elapsed}s)", flush=True)
                    else:
                        print(f"[CAPTCHA] Unknown status: {status}", flush=True)
                    
                    await asyncio.sleep(poll_interval)
                
                print(f"[CAPTCHA] Timeout after {timeout}s", flush=True)
                return None
                
        except Exception as e:
            print(f"[CAPTCHA] Exception: {e}", flush=True)
            import traceback
            traceback.print_exc()
            return None
    
    async def solve_recaptcha_v2(self, sitekey: str, page_url: str, timeout: int = 180) -> Optional[str]:
        """
        Solve a reCAPTCHA v2 challenge using Anti-Captcha.
        
        Args:
            sitekey: The reCAPTCHA sitekey
            page_url: The URL of the page with the CAPTCHA
            timeout: Maximum time to wait for solution (seconds)
            
        Returns:
            The CAPTCHA token/response to submit, or None if failed
        """
        print(f"[CAPTCHA] Submitting reCAPTCHA v2 to Anti-Captcha...", flush=True)
        
        try:
            async with aiohttp.ClientSession() as session:
                # Step 1: Create task
                create_url = f"{self.API_BASE}/createTask"
                task_payload = {
                    "clientKey": self.api_key,
                    "task": {
                        "type": "RecaptchaV2TaskProxyless",
                        "websiteURL": page_url,
                        "websiteKey": sitekey
                    }
                }
                
                async with session.post(create_url, json=task_payload) as resp:
                    result = await resp.json()
                    
                if result.get('errorId') != 0:
                    print(f"[CAPTCHA] Create task failed: {result.get('errorCode')}", flush=True)
                    return None
                
                task_id = result.get('taskId')
                print(f"[CAPTCHA] Task created! ID: {task_id}", flush=True)
                
                # Step 2: Poll for result
                result_url = f"{self.API_BASE}/getTaskResult"
                result_payload = {
                    "clientKey": self.api_key,
                    "taskId": task_id
                }
                
                start_time = time.time()
                await asyncio.sleep(10)
                
                while time.time() - start_time < timeout:
                    async with session.post(result_url, json=result_payload) as resp:
                        result = await resp.json()
                    
                    if result.get('errorId') != 0:
                        print(f"[CAPTCHA] Error: {result.get('errorCode')}", flush=True)
                        return None
                    
                    if result.get('status') == 'ready':
                        token = result.get('solution', {}).get('gRecaptchaResponse')
                        print(f"[CAPTCHA] Solved!", flush=True)
                        return token
                    
                    await asyncio.sleep(5)
                
                print(f"[CAPTCHA] Timeout", flush=True)
                return None
                
        except Exception as e:
            print(f"[CAPTCHA] Exception: {e}", flush=True)
            return None
    
    async def get_balance(self) -> Optional[float]:
        """Get the current Anti-Captcha account balance."""
        try:
            async with aiohttp.ClientSession() as session:
                url = f"{self.API_BASE}/getBalance"
                payload = {"clientKey": self.api_key}
                async with session.post(url, json=payload) as resp:
                    result = await resp.json()
                    if result.get('errorId') == 0:
                        return float(result.get('balance', 0))
                    print(f"[CAPTCHA] Balance error: {result.get('errorCode')}", flush=True)
                    return None
        except Exception as e:
            print(f"[CAPTCHA] Balance check failed: {e}", flush=True)
            return None


async def extract_hcaptcha_sitekey(page) -> Optional[str]:
    """
    Extract the hCaptcha sitekey from a page.
    
    Args:
        page: Playwright page object
        
    Returns:
        The sitekey string or None if not found
    """
    try:
        import re
        
        # Method 1: Try h-captcha div with data-sitekey
        captcha_div = await page.query_selector('.h-captcha[data-sitekey], div[data-sitekey]')
        if captcha_div:
            sitekey = await captcha_div.get_attribute('data-sitekey')
            if sitekey:
                print(f"[CAPTCHA] Found sitekey via data-sitekey: {sitekey[:20]}...", flush=True)
                return sitekey
        
        # Method 2: Try iframe src parameter
        for iframe_selector in ['iframe[src*="hcaptcha"]', 'iframe[src*="newassets.hcaptcha"]', 'iframe[title*="hCaptcha"]']:
            iframe = await page.query_selector(iframe_selector)
            if iframe:
                src = await iframe.get_attribute('src')
                if src and 'sitekey=' in src:
                    match = re.search(r'sitekey=([a-f0-9-]+)', src)
                    if match:
                        print(f"[CAPTCHA] Found sitekey in iframe src: {match.group(1)[:20]}...", flush=True)
                        return match.group(1)
        
        # Method 3: Try to get sitekey via JavaScript
        try:
            sitekey = await page.evaluate('''() => {
                // Check for hcaptcha render config
                if (window.hcaptcha && window.hcaptcha.getResponse) {
                    const widgets = document.querySelectorAll('.h-captcha');
                    for (const widget of widgets) {
                        const sitekey = widget.getAttribute('data-sitekey');
                        if (sitekey) return sitekey;
                    }
                }
                // Check global config
                if (window.hcaptchaConfig && window.hcaptchaConfig.sitekey) {
                    return window.hcaptchaConfig.sitekey;
                }
                // Check for hCaptcha params in script tags
                const scripts = document.querySelectorAll('script');
                for (const script of scripts) {
                    const text = script.textContent || '';
                    const match = text.match(/sitekey['"\\s]*[:=]['"\\s]*([a-f0-9-]+)/i);
                    if (match) return match[1];
                }
                return null;
            }''')
            if sitekey:
                print(f"[CAPTCHA] Found sitekey via JS: {sitekey[:20]}...", flush=True)
                return sitekey
        except Exception as e:
            print(f"[CAPTCHA] JS extraction failed: {e}", flush=True)
        
        # Method 4: Search page content
        content = await page.content()
        
        # Debug: Check what captcha-related elements exist
        captcha_elements = re.findall(r'(h-captcha|hcaptcha|data-sitekey)[^>]{0,200}', content, re.IGNORECASE)
        if captcha_elements:
            print(f"[CAPTCHA] Found {len(captcha_elements)} captcha-related elements", flush=True)
            for elem in captcha_elements[:3]:
                print(f"[CAPTCHA] Element snippet: {elem[:80]}...", flush=True)
        
        # Look for sitekey in various formats
        patterns = [
            r'data-sitekey="([a-f0-9-]{30,50})"',
            r"data-sitekey='([a-f0-9-]{30,50})'",
            r'sitekey["\']?\s*[:=]\s*["\']([a-f0-9-]{30,50})["\']',
            r'hcaptcha\.com/1/api\.js\?.*?sitekey=([a-f0-9-]{30,50})',
            r'"sitekey"\s*:\s*"([a-f0-9-]{30,50})"',
            r'hcaptcha[^}]*sitekey[^}]*?([a-f0-9-]{30,50})',
        ]
        for pattern in patterns:
            match = re.search(pattern, content, re.IGNORECASE)
            if match:
                print(f"[CAPTCHA] Found sitekey via pattern: {match.group(1)[:20]}...", flush=True)
                return match.group(1)
        
        print("[CAPTCHA] Could not find sitekey in any location", flush=True)
        return None
    except Exception as e:
        print(f"[CAPTCHA] Failed to extract sitekey: {e}", flush=True)
        return None


async def inject_captcha_response(page, token: str, captcha_type: str = 'hcaptcha') -> bool:
    """
    Inject the CAPTCHA response token into the page and submit.
    
    Args:
        page: Playwright page object
        token: The solved CAPTCHA token
        captcha_type: 'hcaptcha' or 'recaptcha'
        
    Returns:
        True if injection succeeded
    """
    try:
        if captcha_type == 'hcaptcha':
            # Inject into hCaptcha response fields
            await page.evaluate(f"""
                (token) => {{
                    // Set the response in various possible locations
                    const responseFields = [
                        'h-captcha-response',
                        'g-recaptcha-response'
                    ];
                    
                    for (const fieldName of responseFields) {{
                        // Try textarea
                        const textarea = document.querySelector(`textarea[name="${{fieldName}}"]`);
                        if (textarea) {{
                            textarea.value = token;
                            textarea.innerHTML = token;
                        }}
                        
                        // Try hidden input
                        const input = document.querySelector(`input[name="${{fieldName}}"]`);
                        if (input) {{
                            input.value = token;
                        }}
                    }}
                    
                    // Also set in any elements with these IDs
                    const byId = document.getElementById('h-captcha-response') || 
                                 document.getElementById('g-recaptcha-response');
                    if (byId) {{
                        byId.value = token;
                        byId.innerHTML = token;
                    }}
                    
                    // Try to call hcaptcha callback if available
                    if (typeof hcaptcha !== 'undefined' && hcaptcha.execute) {{
                        try {{
                            // Some implementations have a callback we can trigger
                            const widget = document.querySelector('[data-hcaptcha-widget-id]');
                            if (widget) {{
                                const widgetId = widget.getAttribute('data-hcaptcha-widget-id');
                                // Manually set response
                                hcaptcha.setResponse(token, widgetId);
                            }}
                        }} catch (e) {{}}
                    }}
                    
                    return true;
                }}
            """, token)
            
            print("[CAPTCHA] Token injected into page", flush=True)
            
            # Try to submit the form or click the submit button
            await asyncio.sleep(0.5)
            
            # Look for and click submit button
            submit_btn = await page.query_selector('button[type="submit"], input[type="submit"], button:has-text("Inloggen")')
            if submit_btn:
                await submit_btn.click()
                print("[CAPTCHA] Clicked submit button", flush=True)
            
            return True
            
        elif captcha_type == 'recaptcha':
            await page.evaluate(f"""
                (token) => {{
                    document.querySelector('textarea[name="g-recaptcha-response"]').value = token;
                    if (typeof grecaptcha !== 'undefined') {{
                        grecaptcha.callback(token);
                    }}
                }}
            """, token)
            return True
            
    except Exception as e:
        print(f"[CAPTCHA] Failed to inject token: {e}", flush=True)
        return False
    
    return False


# Test function
async def test_solver():
    """Test the CAPTCHA solver balance check."""
    try:
        solver = CaptchaSolver()
        balance = await solver.get_balance()
        if balance is not None:
            print(f"[CAPTCHA] Balance: ${balance:.2f}")
        else:
            print("[CAPTCHA] Failed to get balance - check API key")
    except Exception as e:
        print(f"[CAPTCHA] Test failed: {e}")


if __name__ == '__main__':
    asyncio.run(test_solver())
