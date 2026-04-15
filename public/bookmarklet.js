/**
 * Bookmarklet for Duurzaam Boodschappen
 * 
 * Extracts products from AH "Eerder gekocht" page
 * and syncs them using bonus card identification
 */

(function() {
  'use strict';
  
  // Get API base and optional bonus card from script URL
  const scriptTag = document.currentScript || document.querySelector('script[src*="bookmarklet.js"]');
  const srcUrl = scriptTag ? new URL(scriptTag.src) : null;
  const API_BASE = srcUrl ? srcUrl.origin : window.location.origin;
  
  // IMPORTANT: We no longer trust preset/URL-embedded bonus cards
  // This prevents issues where users share bookmarklets with their card baked in
  // The card MUST come from the user's actual AH session
  
  // Logging helper
  function log(msg, data) {
    const timestamp = new Date().toISOString().slice(11, 23);
    if (data !== undefined) {
      console.log(`[Bookmarklet ${timestamp}] ${msg}`, data);
    } else {
      console.log(`[Bookmarklet ${timestamp}] ${msg}`);
    }
  }
  
  // Check if on AH website
  if (!window.location.href.includes('ah.nl')) {
    alert('🌱 Sustainable Shopping\n\nGo to ah.nl/producten/eerder-gekocht and try again!');
    return;
  }
  
  // ============================================
  // UI OVERLAY
  // ============================================
  
  // Remove existing overlay if present
  const existingOverlay = document.getElementById('ss-overlay');
  if (existingOverlay) existingOverlay.remove();
  
  const overlay = document.createElement('div');
  overlay.id = 'ss-overlay';
  overlay.innerHTML = `
    <div style="
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.95);
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    ">
      <div style="
        background: #1e293b;
        border-radius: 20px;
        padding: 32px;
        max-width: 400px;
        text-align: center;
        color: #f3f4f6;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      ">
        <div style="font-size: 48px; margin-bottom: 16px;">🌱</div>
        <h2 style="margin: 0 0 8px; font-size: 1.5rem;">Sustainable Shopping</h2>
        <p id="ss-status" style="color: #9ca3af; margin-bottom: 24px;">Scanning products...</p>
        <div style="
          background: #334155;
          border-radius: 8px;
          height: 8px;
          overflow: hidden;
          margin-bottom: 24px;
        ">
          <div id="ss-progress" style="
            background: linear-gradient(90deg, #22c55e, #667eea);
            height: 100%;
            width: 0%;
            transition: width 0.3s;
          "></div>
        </div>
        <p id="ss-count" style="color: #22c55e; font-size: 1.25rem; font-weight: 600;">0 products found</p>
        <button id="ss-close" style="
          margin-top: 24px;
          padding: 12px 32px;
          background: #334155;
          color: #f3f4f6;
          border: none;
          border-radius: 10px;
          cursor: pointer;
          font-size: 1rem;
          display: none;
        ">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  
  const statusEl = document.getElementById('ss-status');
  const progressEl = document.getElementById('ss-progress');
  const countEl = document.getElementById('ss-count');
  const closeBtn = document.getElementById('ss-close');
  
  closeBtn.onclick = () => overlay.remove();
  
  // ============================================
  // PRODUCT EXTRACTION
  // ============================================
  
  function extractProducts() {
    const cards = document.querySelectorAll('a[href*="/producten/product/"]');
    const items = [];
    const seen = new Set();

    cards.forEach(a => {
      const href = a.getAttribute('href');
      if (!href || seen.has(href)) return;
      seen.add(href);

      const url = new URL(href, location.origin).toString();

      // Get container (article > data-testid > class-based > parent fallback)
      const card = a.closest('article') || 
                   a.closest('[data-testid="product-card"]') ||
                   a.closest('[data-testhook="product-card"]') || 
                   a.closest('[class*="product"]') ||
                   a.parentElement?.parentElement;

      // ---- PRODUCT NAME ----
      // AH now uses data-testid (was data-testhook)
      let name = '';
      const titleEl = card?.querySelector('[data-testid="product-title-line-clamp"]') ||
                      card?.querySelector('[data-testid="product-title"]') ||
                      a.querySelector('[data-testid="product-title-line-clamp"]') ||
                      a.querySelector('[data-testid="product-title"]') ||
                      a.querySelector('[data-testhook="product-title"]') ||
                      a.querySelector('span[class*="title"]') ||
                      card?.querySelector('h2, h3, [class*="title"]');
      if (titleEl) {
        name = titleEl.textContent?.trim() || '';
      }
      
      // If no title found, try the link's own title attribute (e.g. "Bekijk AH Courgette")
      if (!name) {
        const linkTitle = a.getAttribute('title') || card?.querySelector('a[title]')?.getAttribute('title') || '';
        if (linkTitle) {
          name = linkTitle.replace(/^Bekijk\s+/i, '').trim();
        }
      }
      
      // Last resort: extract clean name from URL slug
      if (!name) {
        const slugMatch = href.match(/\/producten\/product\/[^/]+\/([^/?#]+)/);
        if (slugMatch && slugMatch[1]) {
          try { name = decodeURIComponent(slugMatch[1]); } catch (_) { name = slugMatch[1]; }
          name = name.replace(/-/g, ' ');
          name = name.replace(/\b[a-z]/g, c => c.toUpperCase());
        }
      }
      
      // Clean up name - remove common noise patterns
      name = name.replace(/\s+/g, ' ').trim();
      name = name.split(/,\s*(?:Nutri-Score|per stuk|per kg|€|\d+\s*voor|vandaag|morgen)/i)[0].trim();
      // Normalize Unicode (decomposed é → composed é)
      if (name.normalize) name = name.normalize('NFC');

      // ---- PRICE ----
      // AH now splits prices into separate elements (integer, dot, fractional)
      // Best source: aria-label on sr-only span inside [data-testid="price-amount"]
      // For discount items there are two price-amount elements: "was" (old) and "highlight" (current)
      let price = null;
      if (card) {
        const priceAmounts = card.querySelectorAll('[data-testid="price-amount"]');
        if (priceAmounts.length > 0) {
          // Prefer the current/highlight price (last one, or the non-"was" one)
          let targetPriceEl = priceAmounts[priceAmounts.length - 1]; // default: last
          for (const pa of priceAmounts) {
            const cls = pa.className || '';
            // Skip "was" (old/strikethrough) price, prefer "highlight" (current) price
            if (cls.includes('highlight') && !cls.includes('was')) {
              targetPriceEl = pa;
              break;
            }
          }
          
          // Method A: Extract from aria-label on sr-only child (most reliable)
          // e.g. aria-label="Prijs: €0.65" or aria-label="Prijs: €2.30"
          const srOnly = targetPriceEl.querySelector('.sr-only[aria-label], [aria-label*="Prijs"]');
          if (srOnly) {
            const label = srOnly.getAttribute('aria-label') || '';
            const m = label.replace(',', '.').match(/€\s*(\d+\.?\d*)/);
            if (m) price = parseFloat(m[1]);
          }
          
          // Method B: Concatenate integer + fractional text from child spans
          if (price === null) {
            const intEl = targetPriceEl.querySelector('[class*="integer"]');
            const fracEl = targetPriceEl.querySelector('[class*="fractional"]');
            if (intEl && fracEl) {
              const intPart = intEl.textContent?.trim() || '0';
              const fracPart = fracEl.textContent?.trim() || '00';
              price = parseFloat(`${intPart}.${fracPart}`);
            }
          }
          
          // Method C: Fall back to full textContent of the price element
          if (price === null) {
            const raw = targetPriceEl.textContent?.replace(',', '.').match(/(\d+\.?\d*)/);
            if (raw) price = parseFloat(raw[1]);
          }
        }
        
        // Legacy fallback: old data-testhook or class-based selector
        if (price === null) {
          const legacyPriceEl = card.querySelector('[data-testhook="product-price"]') ||
                                card.querySelector('[class*="price-amount"]') ||
                                card.querySelector('[class*="price_amount"]');
          if (legacyPriceEl) {
            const raw = legacyPriceEl.textContent?.replace(',', '.').match(/(\d+\.?\d*)/);
            if (raw) price = parseFloat(raw[1]);
          }
        }
      }

      // ---- IMAGE ----
      let image = '';
      // Strategy 1: data-testid="product-image" (current AH markup)
      const imgEl = card?.querySelector('img[data-testid="product-image"]') ||
                    a.querySelector('img[data-testid="product-image"]') ||
                    card?.querySelector('img[src*="static.ah.nl"]') || 
                    card?.querySelector('img[src*="ah.nl"]') ||
                    a.querySelector('img') ||
                    card?.querySelector('img');
      if (imgEl) {
        image = imgEl.src || '';
        // Fallback: srcset (first URL), data-src (lazy-load)
        if (!image || image.endsWith('/placeholder.png') || image.includes('data:image')) {
          const srcset = imgEl.getAttribute('srcset') || '';
          if (srcset) {
            const firstSrc = srcset.split(',')[0].trim().split(/\s+/)[0];
            if (firstSrc) image = firstSrc;
          }
        }
        if (!image || image.includes('data:image')) {
          image = imgEl.dataset?.src || imgEl.dataset?.lazySrc || '';
        }
      }
      // Strategy 2: <picture> > <source> with srcset
      if (!image && card) {
        const sourceEl = card.querySelector('picture source[srcset*="ah.nl"]') ||
                         a.querySelector('picture source[srcset*="ah.nl"]');
        if (sourceEl) {
          const srcset = sourceEl.getAttribute('srcset') || '';
          image = srcset.split(',')[0].trim().split(/\s+/)[0] || '';
        }
      }
      // Strategy 3: widen search to entire article ancestor
      if (!image) {
        const article = a.closest('article');
        if (article && article !== card) {
          const articleImg = article.querySelector('img[data-testid="product-image"]') ||
                             article.querySelector('img[src*="static.ah.nl"]');
          if (articleImg) image = articleImg.src || '';
        }
      }
      if (image && !image.startsWith('http')) {
        try { image = new URL(image, location.origin).toString(); } catch (_) { image = ''; }
      }

      // ---- PRODUCT ID ----
      const idMatch = href.match(/wi(\d+)/);
      const productId = idMatch ? idMatch[1] : null;
      
      // ---- UNIT SIZE ----
      let unit_size = '';
      const unitEl = card?.querySelector('[data-testid="product-unit-size"]') ||
                     card?.querySelector('[class*="unitSize"]');
      if (unitEl) {
        unit_size = unitEl.textContent?.trim() || '';
      }

      if (name && name.length > 1) {
        items.push({ 
          name, 
          url, 
          price, 
          image_url: image, 
          ah_id: productId,
          unit_size: unit_size || undefined,
          source: 'bookmarklet' 
        });
      }
    });
    
    return items;
  }
  
  // ============================================
  // BONUS CARD EXTRACTION
  // ============================================
  
  // AH bonus cards are 13 digits, may be formatted with spaces
  // Examples: 4463986084997, 4463 9860 84997, 2621...
  
  function isValidBonusCard(card) {
    if (!card || typeof card !== 'string') return false;
    // Remove spaces, dashes, dots
    const cleaned = card.replace(/[\s\-\.]/g, '');
    // Must be exactly 13 digits
    return /^\d{13}$/.test(cleaned);
  }
  
  function cleanCardNumber(text) {
    // Remove spaces, dashes, dots and return just digits
    return text.replace(/[\s\-\.]/g, '');
  }
  
  function extractBonusCards(text) {
    const cards = new Set();
    
    // Method A: Look for 13 consecutive digits
    const consecutiveMatch = text.match(/\d{13}/g);
    if (consecutiveMatch) {
      consecutiveMatch.forEach(c => cards.add(c));
    }
    
    // Method B: Look for formatted numbers like "4463 9860 84997" or "4463-9860-84997"
    // Pattern: groups of digits separated by spaces/dashes that total 13 digits
    const formattedMatches = text.match(/\d[\d\s\-\.]{11,16}\d/g);
    if (formattedMatches) {
      formattedMatches.forEach(m => {
        const cleaned = cleanCardNumber(m);
        if (cleaned.length === 13) {
          cards.add(cleaned);
        }
      });
    }
    
    return [...cards];
  }
  
  async function getBonusCard() {
    let foundCard = null;
    let source = null;
    
    log('Starting bonus card extraction...');
    
    // Helper: extract VISIBLE text from HTML (strip scripts, styles, SVGs, etc.)
    function getVisibleText(html) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      // Remove noise elements that contain random digit sequences
      doc.querySelectorAll('script, style, svg, noscript, link, meta').forEach(el => el.remove());
      return { doc, text: doc.body?.textContent || '' };
    }

    // Method 0: Try AH member REST API (returns JSON — most reliable if available)
    try {
      statusEl.textContent = 'Retrieving bonus card from AH...';
      log('Method 0: Trying AH member REST API');
      const apiRes = await fetch('https://www.ah.nl/service/rest/delegate?url=/mobile-services/member/v3/info', {
        credentials: 'include',
        cache: 'no-store'
      });
      if (apiRes.ok) {
        const json = await apiRes.json();
        // The member info may contain bonusCard or loyaltyCard
        const cardNum = json?.bonusCard?.cardNumber || json?.bonusCardNumber 
          || json?.loyaltyCard?.cardNumber || json?.member?.bonusCard?.cardNumber;
        log('Method 0: API response keys:', Object.keys(json || {}));
        if (cardNum && isValidBonusCard(cardNum.toString())) {
          foundCard = cleanCardNumber(cardNum.toString());
          source = 'member_api';
          log(`Method 0: Got card from member API`);
        } else {
          // Scan entire JSON for any 13-digit number
          const jsonStr = JSON.stringify(json);
          const cards = extractBonusCards(jsonStr);
          if (cards.length === 1) {
            foundCard = cards[0];
            source = 'member_api_scan';
            log(`Method 0: Found card by scanning API response`);
          } else if (cards.length > 1) {
            log(`Method 0: Found ${cards.length} candidates in API, skipping`);
          }
        }
      } else {
        log(`Method 0: API returned ${apiRes.status}`);
      }
    } catch (e) {
      log('Method 0: API error:', e.message);
    }

    // Method 1: Try /klantenkaarten/bonuskaart page (most specific)
    if (!foundCard) {
      try {
        log('Method 1: Fetching from /klantenkaarten/bonuskaart');
        const res = await fetch('https://www.ah.nl/klantenkaarten/bonuskaart', { 
          credentials: 'include',
          cache: 'no-store'
        });
        
        if (res.ok) {
          const html = await res.text();
          const { doc, text } = getVisibleText(html);
          
          // Look for "Kaartnummer" label and grab the number near it
          const labels = doc.querySelectorAll('span, td, th, div, dt, dd, p, label');
          for (const label of labels) {
            const labelText = label.textContent?.trim().toLowerCase();
            if (labelText === 'kaartnummer' || labelText === 'bonuskaartnummer' || labelText === 'card number') {
              const parent = label.closest('tr, div, dl, section, [class*="table"], [class*="row"], [class*="card"], [class*="detail"]');
              if (parent) {
                const cards = extractBonusCards(parent.textContent || '');
                log('Method 1: Found label row, extracted:', cards.map(c => '****' + c.slice(-4)));
                if (cards.length > 0) {
                  foundCard = cards[0];
                  source = 'bonuskaart_page_label';
                  break;
                }
              }
            }
          }
          
          // Fallback: scan visible text only (NOT raw HTML with JS bundles)
          if (!foundCard) {
            const cards = extractBonusCards(text);
            log(`Method 1: Visible text scan found ${cards.length} potential cards:`, cards.map(c => '****' + c.slice(-4)));
            if (cards.length === 1) {
              foundCard = cards[0];
              source = 'bonuskaart_page_visible_text';
            } else if (cards.length >= 2 && cards.length <= 5) {
              foundCard = cards[0];
              source = 'bonuskaart_page_first_of_few';
            }
          }
        } else {
          log(`Method 1: Fetch failed with status ${res.status}`);
        }
      } catch (e) {
        log('Method 1: Fetch error:', e.message);
      }
    }
    
    // Method 2: Try /klantenkaarten page
    if (!foundCard) {
      try {
        log('Method 2: Fetching from /klantenkaarten');
        const res = await fetch('https://www.ah.nl/klantenkaarten', { 
          credentials: 'include',
          cache: 'no-store'
        });
        
        if (res.ok) {
          const html = await res.text();
          const { doc, text } = getVisibleText(html);
          
          const labels = doc.querySelectorAll('span, td, th, div, dt, dd, p, label');
          for (const label of labels) {
            const labelText = label.textContent?.trim().toLowerCase();
            if (labelText === 'kaartnummer' || labelText === 'bonuskaartnummer' || labelText === 'card number') {
              const parent = label.closest('tr, div, dl, section, [class*="table"], [class*="row"], [class*="card"], [class*="detail"]');
              if (parent) {
                const cards = extractBonusCards(parent.textContent || '');
                if (cards.length > 0) {
                  foundCard = cards[0];
                  source = 'klantenkaarten_label';
                  break;
                }
              }
            }
          }
          
          if (!foundCard) {
            const cardEl = doc.querySelector('[data-testid="bonus-card-number"], .bonus-card-number, [class*="cardNumber"], [class*="bonusCard"]');
            if (cardEl) {
              const cards = extractBonusCards(cardEl.textContent || '');
              if (cards.length > 0) {
                foundCard = cards[0];
                source = 'klantenkaarten_specific_element';
              }
            }
          }
          
          if (!foundCard) {
            const cards = extractBonusCards(text);
            log(`Method 2: Visible text scan found ${cards.length} cards:`, cards.map(c => '****' + c.slice(-4)));
            if (cards.length === 1) {
              foundCard = cards[0];
              source = 'klantenkaarten_visible_text';
            } else if (cards.length >= 2 && cards.length <= 5) {
              foundCard = cards[0];
              source = 'klantenkaarten_first_of_few';
            }
          }
        }
      } catch (e) {
        log('Method 2: error:', e.message);
      }
    }
    
    // Method 3: Check current page DOM
    if (!foundCard) {
      log('Method 3: Checking current page DOM');
      const selectors = [
        '[data-testid="bonus-card-number"]',
        '[data-testid*="bonuskaart"]',
        '.bonus-card-number',
        '[class*="bonusCardNumber"]',
        '[class*="bonus-card"] [class*="number"]'
      ];
      
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          const cards = extractBonusCards(el.textContent || '');
          if (cards.length > 0) {
            foundCard = cards[0];
            source = `dom:${selector}`;
            break;
          }
        }
        if (foundCard) break;
      }
    }
    
    // Method 4: MANUAL ENTRY FALLBACK — prompt user to type their card number
    // This is the guaranteed fallback when all automatic methods fail.
    if (!foundCard) {
      log('All automatic methods failed — asking user for manual entry');
      foundCard = await promptForBonusCard();
      if (foundCard) {
        source = 'manual_entry';
      }
    }
    
    // Log final result
    if (foundCard) {
      log(`SUCCESS: Found bonus card ****${foundCard.slice(-4)} via ${source}`);
    } else {
      log('FAILED: No bonus card found by any method (user cancelled manual entry)');
    }
    
    return foundCard;
  }
  
  // Prompt the user to manually enter their bonus card number
  function promptForBonusCard() {
    return new Promise((resolve) => {
      // Create modal overlay
      const modal = document.createElement('div');
      modal.style.cssText = `
        position: fixed; inset: 0; z-index: 2147483647;
        background: rgba(15, 23, 42, 0.95);
        display: flex; align-items: center; justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      `;
      
      modal.innerHTML = `
        <div style="
          background: #1e293b; border-radius: 16px; padding: 2rem;
          max-width: 420px; width: 90%; color: #f3f4f6;
          box-shadow: 0 25px 50px rgba(0,0,0,0.5);
        ">
          <h3 style="margin: 0 0 0.5rem; font-size: 1.2rem; color: #22c55e;">
            🎫 Bonuskaartnummer nodig
          </h3>
          <p style="margin: 0 0 0.5rem; font-size: 0.85rem; color: #94a3b8; line-height: 1.5;">
            We konden je bonuskaartnummer niet automatisch ophalen.
            Vul het hieronder in (13 cijfers).
          </p>
          <p style="margin: 0 0 1rem; font-size: 0.8rem; color: #64748b; line-height: 1.4;">
            Je vindt het op <a href="https://www.ah.nl/klantenkaarten/bonuskaart" target="_blank" 
            style="color: #38bdf8; text-decoration: underline;">ah.nl/klantenkaarten/bonuskaart</a>,
            op je fysieke bonuskaart, of in de AH app onder "Bonuskaart".
          </p>
          <input id="ss-card-input" type="text" inputmode="numeric" maxlength="17" 
            placeholder="bijv. 2621 0000 12345"
            style="
              width: 100%; padding: 0.75rem 1rem; font-size: 1.1rem;
              border: 2px solid #334155; border-radius: 10px;
              background: #0f172a; color: #f3f4f6;
              letter-spacing: 2px; text-align: center;
              outline: none; box-sizing: border-box;
            " />
          <p id="ss-card-error" style="
            margin: 0.5rem 0 0; font-size: 0.8rem; color: #ef4444;
            min-height: 1.2rem;
          "></p>
          <div style="display: flex; gap: 0.75rem; margin-top: 1rem;">
            <button id="ss-card-skip" style="
              flex: 1; padding: 0.7rem; border: 1px solid #334155;
              border-radius: 10px; background: transparent;
              color: #94a3b8; cursor: pointer; font-size: 0.9rem;
            ">Overslaan</button>
            <button id="ss-card-submit" style="
              flex: 2; padding: 0.7rem; border: none;
              border-radius: 10px; background: #22c55e;
              color: white; cursor: pointer; font-weight: 600;
              font-size: 0.9rem;
            ">Bevestigen</button>
          </div>
        </div>
      `;
      
      document.body.appendChild(modal);
      
      const input = modal.querySelector('#ss-card-input');
      const errorEl = modal.querySelector('#ss-card-error');
      const submitBtn = modal.querySelector('#ss-card-submit');
      const skipBtn = modal.querySelector('#ss-card-skip');
      
      input.focus();
      
      const trySubmit = () => {
        const cleaned = input.value.replace(/[\s\-\.]/g, '');
        if (!/^\d{13}$/.test(cleaned)) {
          errorEl.textContent = 'Voer een geldig 13-cijferig kaartnummer in';
          input.style.borderColor = '#ef4444';
          return;
        }
        modal.remove();
        resolve(cleaned);
      };
      
      submitBtn.addEventListener('click', trySubmit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') trySubmit();
      });
      input.addEventListener('input', () => {
        errorEl.textContent = '';
        input.style.borderColor = '#334155';
      });
      skipBtn.addEventListener('click', () => {
        modal.remove();
        resolve(null);
      });
    });
  }
  
  // ============================================
  // AUTO SCROLL - Loads all lazy-loaded products
  // ============================================
  
  async function autoScroll() {
    let lastCount = 0;
    let sameCountTimes = 0;
    let iterations = 0;
    const maxIterations = 50; // Safety limit
    const scrollStep = window.innerHeight * 0.8; // Scroll ~80% of viewport at a time
    
    statusEl.textContent = 'Scrolling to load all products...';
    
    while (sameCountTimes < 3 && iterations < maxIterations) {
      iterations++;
      
      // Scroll down in increments (more reliable for lazy loading)
      const currentScroll = window.scrollY;
      const maxScroll = document.body.scrollHeight - window.innerHeight;
      
      if (currentScroll < maxScroll) {
        // Scroll down by one viewport height
        window.scrollBy({ top: scrollStep, behavior: 'smooth' });
        await new Promise(r => setTimeout(r, 800)); // Wait for scroll animation
      }
      
      // Also try scrolling to absolute bottom to trigger any remaining loads
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 1200)); // Wait for content to load
      
      // Count products
      const items = extractProducts();
      countEl.textContent = `${items.length} products found`;
      
      // Calculate progress (10-50% during scrolling phase)
      const scrollProgress = Math.min(currentScroll / maxScroll, 1);
      progressEl.style.width = (10 + scrollProgress * 40) + '%';
      
      statusEl.textContent = `Loading... (${items.length} products)`;
      
      if (items.length === lastCount) {
        sameCountTimes++;
        // If count hasn't changed, we might be at the end
        if (sameCountTimes === 1) {
          statusEl.textContent = 'Checking if everything is loaded...';
        }
      } else {
        sameCountTimes = 0;
        lastCount = items.length;
      }
      
      // If we're at max scroll and count hasn't changed, we're probably done
      if (currentScroll >= maxScroll - 100 && items.length === lastCount) {
        sameCountTimes++;
      }
    }
    
    // Scroll back to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
    progressEl.style.width = '55%';
    
    console.log(`[Bookmarklet] Auto-scroll complete: ${lastCount} products found in ${iterations} iterations`);
  }
  
  // ============================================
  // MAIN SYNC FUNCTION
  // ============================================
  
  async function syncProducts() {
    try {
      // Step 1: Scan visible products
      statusEl.textContent = 'Scanning products...';
      progressEl.style.width = '10%';
      
      let items = extractProducts();
      countEl.textContent = `${items.length} products found`;

      // Step 2: Auto-scroll to load all
      statusEl.textContent = 'Loading all products...';
      await autoScroll();
      items = extractProducts();
      
      if (!items.length) {
        statusEl.textContent = '⚠️ No products found';
        countEl.textContent = 'Go to ah.nl/producten/eerder-gekocht';
        closeBtn.style.display = 'inline-block';
        return;
      }
      
      // Step 3: Get bonus card
      statusEl.textContent = 'Finding bonus card...';
      progressEl.style.width = '60%';
      const bonusCard = await getBonusCard();
      
      // Step 4: Upload products
      statusEl.textContent = `Uploading ${items.length} products...`;
      progressEl.style.width = '80%';
      
      const payload = {
        items,
        source: 'bookmarklet',
        scraped_at: new Date().toISOString()
      };
      
      // Add bonus card if found
      if (bonusCard) {
        payload.bonus_card = bonusCard;
        log(`Sending ${items.length} products with bonus card ****${bonusCard.slice(-4)}`);
      } else {
        log(`WARNING: Sending ${items.length} products WITHOUT bonus card - purchases won't be recorded!`);
      }
      
      log('API request payload:', { 
        itemCount: items.length, 
        source: payload.source,
        bonusCard: bonusCard ? '****' + bonusCard.slice(-4) : 'NONE',
        sampleItem: items[0] ? { name: items[0].name, url: items[0].url?.slice(0, 50) } : null
      });
      
      const res = await fetch(`${API_BASE}/api/ingest/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      // Handle non-JSON responses (e.g. Vercel timeout pages)
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const text = await res.text();
        log('Non-JSON response:', text.slice(0, 200));
        throw new Error(res.status >= 500 
          ? 'Server timed out — try again with fewer products loaded on the page'
          : `Server error (${res.status})`);
      }
      const data = await res.json();
      progressEl.style.width = '100%';
      
      log('API response:', { 
        ok: res.ok, 
        stored: data.stored, 
        purchasesRecorded: data.purchasesRecorded,
        purchaseError: data.purchaseError,
        bonusCard: data.bonusCard
      });
      
      if (!res.ok) {
        // Show both error code and detail if available
        const errMsg = data?.detail 
          ? `${data.error}: ${data.detail}` 
          : (data?.error || 'Upload failed');
        throw new Error(errMsg);
      }
      
      // Success!
      const stored = data.stored || items.length;
      const purchasesRecorded = data.purchasesRecorded || 0;
      statusEl.textContent = '✅ Done!';
      
      let message = `${stored} products synced`;
      
      // Show purchase recording result
      if (purchasesRecorded > 0) {
        message += `\n✅ ${purchasesRecorded} purchases saved`;
      } else if (data.purchaseError) {
        console.error('[Bookmarklet] Purchase error:', data.purchaseError);
        message += '\n⚠️ Purchases not saved: ' + (data.purchaseError.message || 'unknown error');
      }
      
      if (bonusCard) {
        message += '\n\n🎫 Bonuskaart: ••••' + bonusCard.slice(-4);
      } else {
        message += '\n\n⚠️ No bonus card found. Go to ah.nl/mijn/klantenkaarten first';
      }
      
      countEl.innerHTML = message.replace(/\n/g, '<br>');
      countEl.style.fontSize = '1rem';
      
      // Auto-redirect back to experiment flow
      if (data.redirect_url) {
        statusEl.textContent = '✅ Done! Redirecting to experiment...';
        setTimeout(() => {
          window.location.href = data.redirect_url;
        }, 1500);
      } else {
        // No redirect URL - show close button
        closeBtn.style.display = 'inline-block';
      }
      
    } catch (e) {
      console.error('[Bookmarklet] Sync failed:', e);
      statusEl.textContent = '❌ Error: ' + e.message;
      countEl.style.color = '#ef4444';
    }
    
    closeBtn.style.display = 'inline-block';
  }
  
  // Run!
  syncProducts();
})();
