#!/usr/bin/env python3
"""
CAPTCHA Solver using 2Captcha API

Supports hCaptcha (used by Albert Heijn) and reCAPTCHA.
"""

import os
import time
import asyncio
import aiohttp
from typing import Optional, Dict, Any


class CaptchaSolver:
    """Solve CAPTCHAs using 2Captcha service."""
    
    API_BASE = "http://2captcha.com"
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize the solver.
        
        Args:
            api_key: 2Captcha API key. If not provided, reads from CAPTCHA_API_KEY env var.
        """
        self.api_key = api_key or os.environ.get('CAPTCHA_API_KEY')
        if not self.api_key:
            raise ValueError("No CAPTCHA API key provided. Set CAPTCHA_API_KEY environment variable.")
    
    async def solve_hcaptcha(self, sitekey: str, page_url: str, timeout: int = 120) -> Optional[str]:
        """
        Solve an hCaptcha challenge.
        
        Args:
            sitekey: The hCaptcha sitekey (found in data-sitekey attribute)
            page_url: The URL of the page with the CAPTCHA
            timeout: Maximum time to wait for solution (seconds)
            
        Returns:
            The CAPTCHA token/response to submit, or None if failed
        """
        print(f"[CAPTCHA] Submitting hCaptcha to 2Captcha...", flush=True)
        print(f"[CAPTCHA] Sitekey: {sitekey[:20]}...", flush=True)
        print(f"[CAPTCHA] Page URL: {page_url}", flush=True)
        
        try:
            async with aiohttp.ClientSession() as session:
                # Step 1: Submit the CAPTCHA
                submit_url = f"{self.API_BASE}/in.php"
                submit_data = {
                    'key': self.api_key,
                    'method': 'hcaptcha',
                    'sitekey': sitekey,
                    'pageurl': page_url,
                    'json': 1
                }
                
                async with session.post(submit_url, data=submit_data) as resp:
                    result = await resp.json()
                    
                if result.get('status') != 1:
                    error = result.get('request', 'Unknown error')
                    print(f"[CAPTCHA] Submit failed: {error}", flush=True)
                    return None
                
                request_id = result.get('request')
                print(f"[CAPTCHA] Submitted! Request ID: {request_id}", flush=True)
                print(f"[CAPTCHA] Waiting for solution (this takes 20-60 seconds)...", flush=True)
                
                # Step 2: Poll for the result
                result_url = f"{self.API_BASE}/res.php"
                result_params = {
                    'key': self.api_key,
                    'action': 'get',
                    'id': request_id,
                    'json': 1
                }
                
                start_time = time.time()
                poll_interval = 5  # seconds
                
                while time.time() - start_time < timeout:
                    await asyncio.sleep(poll_interval)
                    elapsed = int(time.time() - start_time)
                    
                    async with session.get(result_url, params=result_params) as resp:
                        result = await resp.json()
                    
                    if result.get('status') == 1:
                        token = result.get('request')
                        print(f"[CAPTCHA] Solved in {elapsed}s!", flush=True)
                        return token
                    
                    error = result.get('request', '')
                    if error == 'CAPCHA_NOT_READY':
                        print(f"[CAPTCHA] Still solving... ({elapsed}s)", flush=True)
                    elif error in ['ERROR_CAPTCHA_UNSOLVABLE', 'ERROR_BAD_DUPLICATES']:
                        print(f"[CAPTCHA] Unsolvable: {error}", flush=True)
                        return None
                    else:
                        print(f"[CAPTCHA] Error: {error}", flush=True)
                        # Continue polling for non-fatal errors
                
                print(f"[CAPTCHA] Timeout after {timeout}s", flush=True)
                return None
                
        except Exception as e:
            print(f"[CAPTCHA] Exception: {e}", flush=True)
            return None
    
    async def solve_recaptcha_v2(self, sitekey: str, page_url: str, timeout: int = 120) -> Optional[str]:
        """
        Solve a reCAPTCHA v2 challenge.
        
        Args:
            sitekey: The reCAPTCHA sitekey
            page_url: The URL of the page with the CAPTCHA
            timeout: Maximum time to wait for solution (seconds)
            
        Returns:
            The CAPTCHA token/response to submit, or None if failed
        """
        print(f"[CAPTCHA] Submitting reCAPTCHA v2 to 2Captcha...", flush=True)
        
        try:
            async with aiohttp.ClientSession() as session:
                # Step 1: Submit the CAPTCHA
                submit_url = f"{self.API_BASE}/in.php"
                submit_data = {
                    'key': self.api_key,
                    'method': 'userrecaptcha',
                    'googlekey': sitekey,
                    'pageurl': page_url,
                    'json': 1
                }
                
                async with session.post(submit_url, data=submit_data) as resp:
                    result = await resp.json()
                    
                if result.get('status') != 1:
                    print(f"[CAPTCHA] Submit failed: {result.get('request')}", flush=True)
                    return None
                
                request_id = result.get('request')
                print(f"[CAPTCHA] Submitted! Request ID: {request_id}", flush=True)
                
                # Step 2: Poll for the result
                result_url = f"{self.API_BASE}/res.php"
                result_params = {
                    'key': self.api_key,
                    'action': 'get',
                    'id': request_id,
                    'json': 1
                }
                
                start_time = time.time()
                
                while time.time() - start_time < timeout:
                    await asyncio.sleep(5)
                    
                    async with session.get(result_url, params=result_params) as resp:
                        result = await resp.json()
                    
                    if result.get('status') == 1:
                        token = result.get('request')
                        print(f"[CAPTCHA] Solved!", flush=True)
                        return token
                    
                    if result.get('request') not in ['CAPCHA_NOT_READY']:
                        print(f"[CAPTCHA] Error: {result.get('request')}", flush=True)
                        return None
                
                print(f"[CAPTCHA] Timeout", flush=True)
                return None
                
        except Exception as e:
            print(f"[CAPTCHA] Exception: {e}", flush=True)
            return None
    
    async def get_balance(self) -> Optional[float]:
        """Get the current account balance."""
        try:
            async with aiohttp.ClientSession() as session:
                url = f"{self.API_BASE}/res.php"
                params = {
                    'key': self.api_key,
                    'action': 'getbalance',
                    'json': 1
                }
                async with session.get(url, params=params) as resp:
                    result = await resp.json()
                    if result.get('status') == 1:
                        return float(result.get('request', 0))
                    return None
        except:
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
        # Try iframe src parameter
        iframe = await page.query_selector('iframe[src*="hcaptcha"]')
        if iframe:
            src = await iframe.get_attribute('src')
            if src and 'sitekey=' in src:
                import re
                match = re.search(r'sitekey=([a-f0-9-]+)', src)
                if match:
                    return match.group(1)
        
        # Try data-sitekey attribute
        captcha_div = await page.query_selector('[data-sitekey]')
        if captcha_div:
            sitekey = await captcha_div.get_attribute('data-sitekey')
            if sitekey:
                return sitekey
        
        # Try to find in page content
        content = await page.content()
        import re
        # Look for sitekey in various formats
        patterns = [
            r'data-sitekey="([a-f0-9-]+)"',
            r"data-sitekey='([a-f0-9-]+)'",
            r'sitekey["\']?\s*[:=]\s*["\']([a-f0-9-]+)["\']',
            r'hcaptcha\.com/1/api\.js\?.*?sitekey=([a-f0-9-]+)',
        ]
        for pattern in patterns:
            match = re.search(pattern, content)
            if match:
                return match.group(1)
        
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
            print(f"[CAPTCHA] 2Captcha balance: ${balance:.2f}")
        else:
            print("[CAPTCHA] Failed to get balance")
    except Exception as e:
        print(f"[CAPTCHA] Test failed: {e}")


if __name__ == '__main__':
    asyncio.run(test_solver())
