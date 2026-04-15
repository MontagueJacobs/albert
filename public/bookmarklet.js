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
      doc.querySelectorAll('script, style, svg, noscript, link, meta').forEach(el => el.remove());
      return { doc, text: doc.body?.textContent || '' };
    }
    
    // Helper: scan a DOM document for the bonus card using known AH page structure
    // On ah.nl/klantenkaarten, the card is shown as:
    //   <span class="table-block_label__XXXX">Kaartnummer</span>
    //   <span/div with the card number as text>
    function scanDomForCard(doc) {
      // Strategy A: Find "Kaartnummer" label by class pattern "table-block_label__"
      const labelsByClass = doc.querySelectorAll('[class*="table-block_label"]');
      for (const label of labelsByClass) {
        const text = label.textContent?.trim().toLowerCase();
        if (text === 'kaartnummer' || text === 'bonuskaartnummer') {
          // The value is typically the next sibling element or in a sibling with class "table-block_value__"
          const parent = label.parentElement;
          if (parent) {
            // Look for sibling with "table-block_value" class
            const valueEl = parent.querySelector('[class*="table-block_value"]');
            if (valueEl) {
              const cards = extractBonusCards(valueEl.textContent || '');
              if (cards.length > 0) return { card: cards[0], src: 'table_block_value' };
            }
            // Or just scan the parent's text content (minus the label)
            const parentText = parent.textContent || '';
            const cards = extractBonusCards(parentText);
            if (cards.length > 0) return { card: cards[0], src: 'table_block_parent' };
          }
          // Try next sibling
          let sibling = label.nextElementSibling;
          if (sibling) {
            const cards = extractBonusCards(sibling.textContent || '');
            if (cards.length > 0) return { card: cards[0], src: 'table_block_sibling' };
          }
          // Try next text node
          let next = label.nextSibling;
          while (next) {
            if (next.nodeType === 3 && next.textContent?.trim()) { // text node
              const cards = extractBonusCards(next.textContent);
              if (cards.length > 0) return { card: cards[0], src: 'table_block_textnode' };
            }
            if (next.nodeType === 1) { // element node
              const cards = extractBonusCards(next.textContent || '');
              if (cards.length > 0) return { card: cards[0], src: 'table_block_nextelem' };
            }
            next = next.nextSibling;
          }
        }
      }
      
      // Strategy B: Generic label search (span, td, div, etc.)
      const allLabels = doc.querySelectorAll('span, td, th, div, dt, dd, p, label');
      for (const label of allLabels) {
        const text = label.textContent?.trim().toLowerCase();
        if (text === 'kaartnummer' || text === 'bonuskaartnummer' || text === 'card number') {
          // Check parent container
          const parent = label.closest('tr, div, dl, section, [class*="table"], [class*="row"], [class*="card"], [class*="detail"]');
          if (parent) {
            const cards = extractBonusCards(parent.textContent || '');
            if (cards.length > 0) return { card: cards[0], src: 'label_parent' };
          }
          // Check next sibling
          let sibling = label.nextElementSibling;
          if (sibling) {
            const cards = extractBonusCards(sibling.textContent || '');
            if (cards.length > 0) return { card: cards[0], src: 'label_sibling' };
          }
        }
      }
      
      // Strategy C: Data-testid selectors
      const testIdSelectors = [
        '[data-testid="bonus-card-number"]',
        '[data-testid*="bonuskaart"]',
        '[data-testid*="bonus-card"]',
        '[data-testid*="cardNumber"]',
        '.bonus-card-number',
        '[class*="bonusCardNumber"]',
        '[class*="bonus-card"] [class*="number"]'
      ];
      for (const sel of testIdSelectors) {
        try {
          const el = doc.querySelector(sel);
          if (el) {
            const cards = extractBonusCards(el.textContent || '');
            if (cards.length > 0) return { card: cards[0], src: `selector:${sel}` };
          }
        } catch (e) { /* invalid selector */ }
      }
      
      return null;
    }

    // ========================================================
    // Method 1 (PRIMARY): Load /klantenkaarten in hidden iframe
    // This is the most reliable method because the SPA renders
    // the card number client-side — fetch() only gets the SSR shell.
    // We also intercept fetch() calls the iframe makes to catch
    // the API response that contains the card data.
    // ========================================================
    try {
      statusEl.textContent = 'Bonuskaart ophalen...';
      log('Method 1: Loading /klantenkaarten in hidden iframe + fetch intercept');
      
      // Set up a fetch interceptor to capture any card data from API calls
      let interceptedCard = null;
      const originalFetch = window.fetch;
      
      const result = await new Promise((resolve) => {
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;top:-9999px;left:-9999px;';
        iframe.src = 'https://www.ah.nl/klantenkaarten';
        
        let resolved = false;
        let pollCount = 0;
        const maxPolls = 20; // 20 * 500ms = 10 seconds max
        
        const cleanup = () => {
          resolved = true;
          if (pollInterval) clearInterval(pollInterval);
          try { iframe.remove(); } catch (e) {}
        };
        
        // Poll the iframe DOM for the card number
        let pollInterval = null;
        
        iframe.onload = () => {
          log('Method 1: Iframe loaded, starting DOM polling');
          
          // Try to intercept fetch calls inside the iframe
          try {
            const iframeWindow = iframe.contentWindow;
            if (iframeWindow && iframeWindow.fetch) {
              const iframeOriginalFetch = iframeWindow.fetch;
              iframeWindow.fetch = function(...args) {
                const promise = iframeOriginalFetch.apply(this, args);
                promise.then(response => {
                  try {
                    const url = (typeof args[0] === 'string' ? args[0] : args[0]?.url) || '';
                    // Intercept API calls that might return card data
                    if (url.includes('member') || url.includes('loyalty') || url.includes('bonus') || 
                        url.includes('card') || url.includes('kaart') || url.includes('klant')) {
                      response.clone().text().then(text => {
                        if (text.length < 100000) {
                          const cards = extractBonusCards(text);
                          if (cards.length >= 1 && cards.length <= 3 && !interceptedCard) {
                            interceptedCard = cards[0];
                            log(`Method 1: Intercepted card from iframe fetch: ${url.substring(0, 80)}`);
                          }
                        }
                      }).catch(() => {});
                    }
                  } catch (e) {}
                }).catch(() => {});
                return promise;
              };
              log('Method 1: Installed iframe fetch interceptor');
            }
          } catch (e) {
            log('Method 1: Cannot access iframe window (cross-origin?): ' + e.message);
          }
          
          pollInterval = setInterval(() => {
            pollCount++;
            if (resolved) return;
            
            try {
              const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
              if (!iframeDoc) {
                log('Method 1: Cannot access iframe document (cross-origin?)');
                cleanup();
                resolve(null);
                return;
              }
              
              // Try our scanDomForCard on the iframe document
              const result = scanDomForCard(iframeDoc);
              if (result) {
                log(`Method 1: Found card via iframe DOM (${result.src}) after ${pollCount} polls`);
                cleanup();
                resolve(result);
                return;
              }
              
              // Also check if all visible text has a 13-digit number
              const body = iframeDoc.body;
              if (body) {
                // Remove noise elements
                const clone = body.cloneNode(true);
                clone.querySelectorAll('script, style, svg, noscript').forEach(el => el.remove());
                const visibleText = clone.textContent || '';
                const cards = extractBonusCards(visibleText);
                if (cards.length === 1) {
                  log(`Method 1: Found single card in iframe visible text after ${pollCount} polls`);
                  cleanup();
                  resolve({ card: cards[0], src: 'iframe_visible_text' });
                  return;
                }
              }
              
              if (pollCount >= maxPolls) {
                // Last chance: check intercepted card from fetch calls
                if (interceptedCard) {
                  log(`Method 1: Using intercepted card after timeout`);
                  cleanup();
                  resolve({ card: interceptedCard, src: 'iframe_fetch_intercept' });
                  return;
                }
                log(`Method 1: Timeout after ${pollCount} polls — no card found in iframe`);
                cleanup();
                resolve(null);
              }
            } catch (e) {
              log(`Method 1: Poll error: ${e.message}`);
              // Might be temporary — keep trying unless at max
              if (pollCount >= maxPolls) {
                cleanup();
                resolve(null);
              }
            }
          }, 500);
        };
        
        iframe.onerror = () => {
          log('Method 1: Iframe load error');
          cleanup();
          resolve(null);
        };
        
        // Safety timeout
        setTimeout(() => {
          if (!resolved) {
            if (interceptedCard) {
              log('Method 1: Using intercepted card at safety timeout');
              cleanup();
              resolve({ card: interceptedCard, src: 'iframe_fetch_intercept_timeout' });
            } else {
              log('Method 1: Overall timeout');
              cleanup();
              resolve(null);
            }
          }
        }, 12000);
        
        document.body.appendChild(iframe);
      });
      
      if (result) {
        foundCard = result.card;
        source = `iframe:${result.src}`;
      }
    } catch (e) {
      log('Method 1: Error:', e.message);
    }

    // ========================================================
    // Method 1b: If iframe failed, try a tiny popup window
    // (can't be blocked by X-Frame-Options/CSP frame-ancestors)
    // ========================================================
    if (!foundCard) {
      try {
        log('Method 1b: Trying popup window for /klantenkaarten');
        statusEl.textContent = 'Bonuskaart ophalen (popup)...';
        
        const popup = window.open('https://www.ah.nl/klantenkaarten', '_blank', 
          'width=1,height=1,left=-9999,top=-9999,menubar=no,toolbar=no,location=no,status=no');
        
        if (popup) {
          const popResult = await new Promise((resolve) => {
            let pollCount = 0;
            const maxPolls = 20;
            let resolved = false;
            
            const cleanup = () => {
              resolved = true;
              if (interval) clearInterval(interval);
              try { popup.close(); } catch (e) {}
            };
            
            const interval = setInterval(() => {
              pollCount++;
              if (resolved) return;
              
              try {
                const popDoc = popup.document;
                if (!popDoc || !popDoc.body) {
                  if (pollCount >= maxPolls) { cleanup(); resolve(null); }
                  return;
                }
                
                const result = scanDomForCard(popDoc);
                if (result) {
                  log(`Method 1b: Found card via popup DOM (${result.src}) after ${pollCount} polls`);
                  cleanup();
                  resolve(result);
                  return;
                }
                
                // Visible text scan
                const clone = popDoc.body.cloneNode(true);
                clone.querySelectorAll('script, style, svg, noscript').forEach(el => el.remove());
                const cards = extractBonusCards(clone.textContent || '');
                if (cards.length === 1) {
                  log(`Method 1b: Found card in popup visible text after ${pollCount} polls`);
                  cleanup();
                  resolve({ card: cards[0], src: 'popup_visible_text' });
                  return;
                }
                
                if (pollCount >= maxPolls) {
                  log('Method 1b: Timeout');
                  cleanup();
                  resolve(null);
                }
              } catch (e) {
                // Cross-origin errors if popup navigated away
                if (pollCount >= maxPolls) { cleanup(); resolve(null); }
              }
            }, 500);
            
            setTimeout(() => {
              if (!resolved) { cleanup(); resolve(null); }
            }, 12000);
          });
          
          if (popResult) {
            foundCard = popResult.card;
            source = `popup:${popResult.src}`;
          }
        } else {
          log('Method 1b: Popup blocked');
        }
      } catch (e) {
        log('Method 1b: Error:', e.message);
      }
    }

    // ========================================================
    // Method 2: Try AH member REST API (JSON — most reliable if it works)
    // ========================================================
    if (!foundCard) {
      try {
        log('Method 2: Trying AH member REST API');
        const apiRes = await fetch('https://www.ah.nl/service/rest/delegate?url=/mobile-services/member/v3/info', {
          credentials: 'include',
          cache: 'no-store'
        });
        if (apiRes.ok) {
          const json = await apiRes.json();
          const cardNum = json?.bonusCard?.cardNumber || json?.bonusCardNumber 
            || json?.loyaltyCard?.cardNumber || json?.member?.bonusCard?.cardNumber;
          log('Method 2: API response keys:', Object.keys(json || {}));
          if (cardNum && isValidBonusCard(cardNum.toString())) {
            foundCard = cleanCardNumber(cardNum.toString());
            source = 'member_api';
          } else {
            const jsonStr = JSON.stringify(json);
            const cards = extractBonusCards(jsonStr);
            if (cards.length === 1) {
              foundCard = cards[0];
              source = 'member_api_scan';
            } else {
              log(`Method 2: API scan found ${cards.length} candidates`);
            }
          }
        } else {
          log(`Method 2: API returned ${apiRes.status}`);
        }
      } catch (e) {
        log('Method 2: API error:', e.message);
      }
    }

    // ========================================================
    // Method 3: Check current page DOM (user might be on /klantenkaarten already)
    // ========================================================
    if (!foundCard) {
      log('Method 3: Scanning current page DOM');
      const result = scanDomForCard(document);
      if (result) {
        foundCard = result.card;
        source = `dom:${result.src}`;
      }
    }
    
    // Method 4: Scan localStorage and sessionStorage (AH SPA stores user data here)
    if (!foundCard) {
      log('Method 4: Scanning localStorage and sessionStorage');
      for (const store of [localStorage, sessionStorage]) {
        try {
          for (let i = 0; i < store.length; i++) {
            const key = store.key(i);
            const val = store.getItem(key);
            if (!val) continue;
            // Look for keys that hint at bonus/loyalty/member/card
            const keyLower = key.toLowerCase();
            if (keyLower.includes('bonus') || keyLower.includes('card') || keyLower.includes('kaart') || 
                keyLower.includes('loyalty') || keyLower.includes('member') || keyLower.includes('user') ||
                keyLower.includes('auth') || keyLower.includes('profile') || keyLower.includes('account')) {
              const cards = extractBonusCards(val);
              if (cards.length === 1) {
                foundCard = cards[0];
                source = `storage:${key}`;
                log(`Method 4: Found card in ${store === localStorage ? 'localStorage' : 'sessionStorage'} key "${key}"`);
                break;
              } else if (cards.length >= 2 && cards.length <= 3) {
                foundCard = cards[0];
                source = `storage:${key}_first`;
                log(`Method 4: Found ${cards.length} candidates in key "${key}", using first`);
                break;
              }
            }
          }
        } catch (e) { /* storage access denied */ }
        if (foundCard) break;
      }
      // If nothing found in targeted keys, do a full scan of all storage values
      if (!foundCard) {
        for (const store of [localStorage, sessionStorage]) {
          try {
            for (let i = 0; i < store.length; i++) {
              const key = store.key(i);
              const val = store.getItem(key);
              if (!val || val.length > 50000) continue; // skip huge blobs
              const cards = extractBonusCards(val);
              if (cards.length === 1) {
                foundCard = cards[0];
                source = `storage_scan:${key}`;
                log(`Method 4: Found card in full scan of key "${key}"`);
                break;
              }
            }
          } catch (e) { /* storage access denied */ }
          if (foundCard) break;
        }
      }
    }
    
    // Method 5: Scan cookies for bonus card number
    if (!foundCard) {
      log('Method 5: Scanning cookies');
      try {
        const cookieStr = document.cookie || '';
        // Check individual cookies
        const cookies = cookieStr.split(';');
        for (const cookie of cookies) {
          const [name, ...valParts] = cookie.split('=');
          const cookieName = (name || '').trim().toLowerCase();
          const cookieVal = decodeURIComponent(valParts.join('=') || '');
          if (cookieName.includes('bonus') || cookieName.includes('card') || cookieName.includes('kaart') ||
              cookieName.includes('loyalty') || cookieName.includes('member')) {
            const cards = extractBonusCards(cookieVal);
            if (cards.length > 0 && cards.length <= 3) {
              foundCard = cards[0];
              source = `cookie:${cookieName}`;
              log(`Method 5: Found card in cookie "${cookieName}"`);
              break;
            }
          }
        }
        // Full cookie scan
        if (!foundCard) {
          const cards = extractBonusCards(cookieStr);
          if (cards.length === 1) {
            foundCard = cards[0];
            source = 'cookie_full_scan';
            log('Method 5: Found card in full cookie scan');
          }
        }
      } catch (e) {
        log('Method 5: Cookie error:', e.message);
      }
    }
    
    // Method 6: __NEXT_DATA__ / Next.js initial props (AH uses Next.js)
    if (!foundCard) {
      log('Method 6: Checking __NEXT_DATA__ and script data');
      try {
        // Check window.__NEXT_DATA__
        if (window.__NEXT_DATA__) {
          const nextStr = JSON.stringify(window.__NEXT_DATA__);
          const cards = extractBonusCards(nextStr);
          if (cards.length === 1) {
            foundCard = cards[0];
            source = '__NEXT_DATA__';
            log('Method 6: Found card in __NEXT_DATA__');
          } else if (cards.length >= 2 && cards.length <= 5) {
            foundCard = cards[0];
            source = '__NEXT_DATA__first';
            log(`Method 6: Found ${cards.length} candidates in __NEXT_DATA__, using first`);
          }
        }
        // Check script#__NEXT_DATA__ tag
        if (!foundCard) {
          const nextScript = document.getElementById('__NEXT_DATA__');
          if (nextScript) {
            const cards = extractBonusCards(nextScript.textContent || '');
            if (cards.length === 1) {
              foundCard = cards[0];
              source = '__NEXT_DATA__script';
            } else if (cards.length >= 2 && cards.length <= 5) {
              foundCard = cards[0];
              source = '__NEXT_DATA__script_first';
            }
          }
        }
      } catch (e) {
        log('Method 6: error:', e.message);
      }
    }
    
    // Method 7: Window global objects (Redux stores, Apollo cache, etc.)
    if (!foundCard) {
      log('Method 7: Scanning window global objects');
      const globalKeys = ['__APOLLO_STATE__', '__REDUX_STATE__', '__INITIAL_STATE__', 
                          '__APP_STATE__', '__store__', '__userData__', '__user__',
                          '__ah__', '__member__', 'appState', 'memberData'];
      for (const key of globalKeys) {
        try {
          if (window[key]) {
            const str = JSON.stringify(window[key]);
            if (str.length > 200000) continue; // skip massive objects
            const cards = extractBonusCards(str);
            if (cards.length === 1) {
              foundCard = cards[0];
              source = `window.${key}`;
              log(`Method 7: Found card in window.${key}`);
              break;
            }
          }
        } catch (e) { /* circular ref or access denied */ }
      }
    }
    
    // Method 8: Try additional AH API endpoints
    if (!foundCard) {
      log('Method 8: Trying additional AH API endpoints');
      const apiEndpoints = [
        '/service/rest/delegate?url=/mobile-services/member/v4/info',
        '/service/rest/delegate?url=/mobile-services/loyalty/v2/card',
        '/service/rest/delegate?url=/mobile-services/bonuscard/v1/card',
        '/api/member/info',
        '/gql', // AH GraphQL — we'll try a member query
      ];
      
      for (const endpoint of apiEndpoints) {
        if (foundCard) break;
        try {
          const url = endpoint.startsWith('/') ? `https://www.ah.nl${endpoint}` : endpoint;
          let fetchOpts = { credentials: 'include', cache: 'no-store' };
          
          // For GQL, try a member query
          if (endpoint === '/gql') {
            fetchOpts.method = 'POST';
            fetchOpts.headers = { 'Content-Type': 'application/json' };
            fetchOpts.body = JSON.stringify({
              query: '{ member { bonusCard { cardNumber } loyaltyCard { cardNumber } } }'
            });
          }
          
          const res = await fetch(url, fetchOpts);
          if (res.ok) {
            const text = await res.text();
            // Only scan if response is reasonably sized
            if (text.length < 100000) {
              const cards = extractBonusCards(text);
              if (cards.length === 1) {
                foundCard = cards[0];
                source = `api:${endpoint}`;
                log(`Method 8: Found card from ${endpoint}`);
              } else if (cards.length >= 2 && cards.length <= 3) {
                foundCard = cards[0];
                source = `api:${endpoint}_first`;
                log(`Method 8: Found ${cards.length} candidates from ${endpoint}`);
              } else {
                log(`Method 8: ${endpoint} returned ${cards.length} candidates`);
              }
            }
          } else {
            log(`Method 8: ${endpoint} returned ${res.status}`);
          }
        } catch (e) {
          log(`Method 8: ${endpoint} error: ${e.message}`);
        }
      }
    }
    
    // Method 9: Scan all <script> tags for embedded user/member data
    if (!foundCard) {
      log('Method 9: Scanning inline <script> tags for user data');
      const scripts = document.querySelectorAll('script:not([src])');
      for (const script of scripts) {
        const content = script.textContent || '';
        if (content.length > 200000 || content.length < 20) continue;
        // Only scan scripts that mention bonus/card/member/user/kaart/loyalty
        if (/bonus|card|kaart|member|user|loyalty/i.test(content)) {
          const cards = extractBonusCards(content);
          if (cards.length === 1) {
            foundCard = cards[0];
            source = 'inline_script';
            log('Method 9: Found card in inline script');
            break;
          }
        }
      }
    }
    
    // Method 10: Check URL params on current page
    if (!foundCard) {
      log('Method 10: Checking URL params');
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const cardParam = urlParams.get('bonuskaart') || urlParams.get('card') || urlParams.get('bonusCard');
        if (isValidBonusCard(cardParam)) {
          foundCard = cleanCardNumber(cardParam);
          source = 'url_param';
        }
      } catch (e) {}
    }
    
    // Log final result
    if (foundCard) {
      log(`SUCCESS: Found bonus card ****${foundCard.slice(-4)} via ${source}`);
    } else {
      log('FAILED: No bonus card found by any method');
    }
    
    return foundCard;
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
