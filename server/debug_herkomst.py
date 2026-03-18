#!/usr/bin/env python3
"""Quick debug to find Herkomst section structure on AH product page while logged in."""

import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()
        
        # Go to login page
        await page.goto('https://www.ah.nl/mijn/inloggen', wait_until='domcontentloaded')
        await asyncio.sleep(2)
        
        # Cookie popup
        try:
            btn = await page.query_selector('button:has-text("Accepteer")')
            if btn:
                await btn.click()
                print("[OK] Cookies accepted")
                await asyncio.sleep(1)
        except:
            pass
            
        print("\n>>> PLEASE LOG IN <<<")
        print(">>> After logging in, navigate to the cucumber page <<<")
        print(">>> https://www.ah.nl/producten/product/wi54074/ah-komkommer <<<")
        print("\nPress Enter after you're on the product page...")
        
        input()  # Wait for user
        
        # Now we should be on the product page
        print("\n=== INSPECTING PAGE ===")
        
        # Scroll down
        await page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
        await asyncio.sleep(2)
        
        # Look for any element containing "Herkomst"
        print("\n=== SEARCHING FOR HERKOMST ELEMENTS ===")
        
        elements = await page.query_selector_all('*')
        for el in elements:
            try:
                text = await el.inner_text()
                if 'herkomst' in text.lower()[:50]:  # Check first 50 chars
                    tag = await el.evaluate('el => el.tagName')
                    class_attr = await el.get_attribute('class') or ''
                    attrs = await el.evaluate('el => el.outerHTML.split(">")[0] + ">"')
                    
                    if len(attrs) < 500:  # Skip huge elements
                        print(f"\n[{tag}] {attrs[:200]}")
                        if len(text) < 200:
                            print(f"  Text: {text[:100]}")
            except:
                pass
        
        # Also look for accordions/details/summary
        print("\n=== LOOKING FOR ACCORDION-LIKE ELEMENTS ===")
        
        for selector in ['details', 'summary', 'button', '[role="button"]', '[data-testid*="accordion"]']:
            els = await page.query_selector_all(selector)
            if els:
                print(f"\nFound {len(els)} {selector} elements:")
                for el in els[:10]:
                    try:
                        text = await el.inner_text()
                        if len(text) < 60:
                            attrs = await el.evaluate('el => el.outerHTML.split(">")[0] + ">"')
                            print(f"  - {attrs[:150]}")
                    except:
                        pass
        
        # Get section around Herkomst keyword
        print("\n=== EXTRACTING HERKOMST SECTION HTML ===")
        
        herkomst_html = await page.evaluate('''
            () => {
                // Find elements that mention herkomst
                const all = document.querySelectorAll('*');
                for (const el of all) {
                    if (el.innerText && el.innerText.toLowerCase().startsWith('herkomst') && el.innerText.length < 20) {
                        // Found header, get parent section
                        let parent = el.parentElement;
                        for (let i = 0; i < 5; i++) {
                            if (parent && parent.outerHTML.length < 3000) {
                                return {
                                    header: el.outerHTML,
                                    parent: parent.outerHTML,
                                    parentTag: parent.tagName
                                };
                            }
                            parent = parent?.parentElement;
                        }
                        return {header: el.outerHTML, parent: "too large", parentTag: "?"};
                    }
                }
                return null;
            }
        ''')
        
        if herkomst_html:
            print(f"\nHeader element: {herkomst_html.get('header', '')[:300]}")
            print(f"\nParent tag: {herkomst_html.get('parentTag', '?')}")
            print(f"\nParent HTML:\n{herkomst_html.get('parent', '')[:1500]}")
        else:
            print("Could not find Herkomst section")
            
        # Keep browser open
        print("\n\n>>> Browser open for inspection. Press Enter to close <<<")
        input()
        
        await browser.close()

asyncio.run(main())
