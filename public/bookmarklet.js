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
    alert('🌱 Duurzaam Boodschappen\n\nGa naar ah.nl/producten/eerder-gekocht en probeer opnieuw!');
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
        <h2 style="margin: 0 0 8px; font-size: 1.5rem;">Duurzaam Boodschappen</h2>
        <p id="ss-status" style="color: #9ca3af; margin-bottom: 24px;">Producten scannen...</p>
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
        <p id="ss-count" style="color: #22c55e; font-size: 1.25rem; font-weight: 600;">0 producten gevonden</p>
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
        ">Sluiten</button>
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
      
      // Get product name - prefer specific title element, avoid aria-label (too verbose)
      let name = '';
      const titleEl = a.querySelector('[data-testhook="product-title"]') ||
                      a.querySelector('span[class*="title"]') ||
                      a.closest('article')?.querySelector('h2, h3, [class*="title"]');
      if (titleEl) {
        name = titleEl.textContent?.trim() || '';
      }
      
      // If no title found, extract clean name from URL slug
      if (!name) {
        const slugMatch = href.match(/\/producten\/product\/[^/]+\/([^/?#]+)/);
        if (slugMatch && slugMatch[1]) {
          name = slugMatch[1].replace(/-/g, ' ');
          // Capitalize first letter of each word
          name = name.replace(/\b[a-z]/g, c => c.toUpperCase());
        }
      }
      
      // Clean up name - remove common noise patterns
      name = name.replace(/\s+/g, ' ').trim();
      // Remove everything after common separators (Nutri-Score, price info, etc.)
      name = name.split(/,\s*(?:Nutri-Score|per stuk|per kg|€|\d+\s*voor|vandaag|morgen)/i)[0].trim();

      // Get container
      const card = a.closest('article') || 
                   a.closest('[data-testhook="product-card"]') || 
                   a.closest('[class*="product"]') ||
                   a.parentElement?.parentElement;

      // Get price
      let price = null;
      const priceEl = card?.querySelector('[data-testhook="product-price"]') ||
                      card?.querySelector('[class*="price"]');
      if (priceEl) {
        const raw = priceEl.textContent?.replace(',', '.').match(/(\d+\.?\d*)/);
        if (raw) price = parseFloat(raw[1]);
      }

      // Get image - try multiple selectors
      let image = '';
      const imgEl = card?.querySelector('img[src*="static.ah.nl"]') || 
                    card?.querySelector('img[src*="ah.nl"]') ||
                    a.querySelector('img') ||
                    card?.querySelector('img');
      if (imgEl) {
        // Get highest quality image URL
        image = imgEl.src || imgEl.dataset?.src || '';
        // Ensure full URL
        if (image && !image.startsWith('http')) {
          image = new URL(image, location.origin).toString();
        }
      }

      // Get product ID
      const idMatch = href.match(/wi(\d+)/);
      const productId = idMatch ? idMatch[1] : null;

      if (name && name.length > 1) {
        items.push({ 
          name, 
          url, 
          price, 
          image_url: image, 
          ah_id: productId,
          source: 'bookmarklet' 
        });
      }
    });
    
    return items;
  }
  
  // ============================================
  // BONUS CARD EXTRACTION
  // ============================================
  
  // AH bonus cards typically start with certain prefixes
  // Common patterns: 4463, 2621, etc. (13 digits total starting with 2 or 4)
  const BONUS_CARD_REGEX = /\b([24]\d{12})\b/g;
  
  function isValidBonusCard(card) {
    if (!card || typeof card !== 'string') return false;
    // Must be exactly 13 digits starting with 2 or 4
    return /^[24]\d{12}$/.test(card);
  }
  
  function extractBonusCards(text) {
    const cards = [];
    let match;
    while ((match = BONUS_CARD_REGEX.exec(text)) !== null) {
      if (isValidBonusCard(match[1])) {
        cards.push(match[1]);
      }
    }
    // Reset regex state
    BONUS_CARD_REGEX.lastIndex = 0;
    return [...new Set(cards)]; // Remove duplicates
  }
  
  async function getBonusCard() {
    let foundCard = null;
    let source = null;
    
    log('Starting bonus card extraction...');
    
    // Method 1: Try to fetch FRESH from klantenkaarten page (most reliable)
    try {
      statusEl.textContent = 'Bonuskaart ophalen van AH...';
      log('Method 1: Fetching from /mijn/klantenkaarten');
      const res = await fetch('https://www.ah.nl/mijn/klantenkaarten', { 
        credentials: 'include',
        cache: 'no-store'  // Don't use cached response
      });
      
      if (res.ok) {
        const html = await res.text();
        const cards = extractBonusCards(html);
        log(`Method 1: Found ${cards.length} potential cards:`, cards.map(c => '****' + c.slice(-4)));
        
        if (cards.length === 1) {
          foundCard = cards[0];
          source = 'klantenkaarten_fetch';
        } else if (cards.length > 1) {
          // Multiple cards found - look for one in a specific element
          log('Method 1: Multiple cards, looking for specific element');
          // Parse and look for card number in specific context
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          const cardEl = doc.querySelector('[data-testid="bonus-card-number"], .bonus-card-number, [class*="cardNumber"]');
          if (cardEl) {
            const cardText = cardEl.textContent;
            const specificCards = extractBonusCards(cardText);
            if (specificCards.length === 1) {
              foundCard = specificCards[0];
              source = 'klantenkaarten_specific_element';
            }
          }
          // Fallback: use first card
          if (!foundCard) {
            foundCard = cards[0];
            source = 'klantenkaarten_first_of_multiple';
            log('Method 1: WARNING - using first of multiple cards');
          }
        }
      } else {
        log(`Method 1: Fetch failed with status ${res.status}`);
      }
    } catch (e) {
      log('Method 1: Fetch error:', e.message);
    }
    
    // Method 2: Check current page DOM (if on a relevant AH page)
    if (!foundCard) {
      log('Method 2: Checking current page DOM');
      // Look for specific AH bonus card elements
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
          if (cards.length === 1) {
            foundCard = cards[0];
            source = `dom_selector:${selector}`;
            log(`Method 2: Found card via ${selector}`);
            break;
          }
        }
        if (foundCard) break;
      }
    }
    
    // Method 3: Check URL params on current page (AH sometimes includes it)
    if (!foundCard) {
      log('Method 2b: Checking URL params');
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const cardParam = urlParams.get('bonuskaart') || urlParams.get('card');
        if (isValidBonusCard(cardParam)) {
          foundCard = cardParam;
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
    
    statusEl.textContent = 'Scrollen om alle producten te laden...';
    
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
      countEl.textContent = `${items.length} producten gevonden`;
      
      // Calculate progress (10-50% during scrolling phase)
      const scrollProgress = Math.min(currentScroll / maxScroll, 1);
      progressEl.style.width = (10 + scrollProgress * 40) + '%';
      
      statusEl.textContent = `Laden... (${items.length} producten)`;
      
      if (items.length === lastCount) {
        sameCountTimes++;
        // If count hasn't changed, we might be at the end
        if (sameCountTimes === 1) {
          statusEl.textContent = 'Controleren of alles geladen is...';
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
      statusEl.textContent = 'Producten scannen...';
      progressEl.style.width = '10%';
      
      let items = extractProducts();
      countEl.textContent = `${items.length} producten gevonden`;
      
      // Step 2: Auto-scroll to load all
      statusEl.textContent = 'Alle producten laden...';
      await autoScroll();
      items = extractProducts();
      
      if (!items.length) {
        statusEl.textContent = '⚠️ Geen producten gevonden';
        countEl.textContent = 'Ga naar ah.nl/producten/eerder-gekocht';
        closeBtn.style.display = 'inline-block';
        return;
      }
      
      // Step 3: Get bonus card
      statusEl.textContent = 'Bonuskaart zoeken...';
      progressEl.style.width = '60%';
      const bonusCard = await getBonusCard();
      
      // Step 4: Upload products
      statusEl.textContent = `${items.length} producten uploaden...`;
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
          : (data?.error || 'Upload mislukt');
        throw new Error(errMsg);
      }
      
      // Success!
      const stored = data.stored || items.length;
      const purchasesRecorded = data.purchasesRecorded || 0;
      statusEl.textContent = '✅ Gelukt!';
      
      let message = `${stored} producten gesynct`;
      
      // Show purchase recording result
      if (purchasesRecorded > 0) {
        message += `\n✅ ${purchasesRecorded} aankopen opgeslagen`;
      } else if (data.purchaseError) {
        console.error('[Bookmarklet] Purchase error:', data.purchaseError);
        message += '\n⚠️ Aankopen niet opgeslagen: ' + (data.purchaseError.message || 'onbekende fout');
      }
      
      if (bonusCard) {
        message += '\n\n🎫 Bonuskaart: ••••' + bonusCard.slice(-4);
      } else {
        message += '\n\n⚠️ Geen bonuskaart gevonden. Ga eerst naar ah.nl/mijn/klantenkaarten';
      }
      
      countEl.innerHTML = message.replace(/\n/g, '<br>');
      countEl.style.fontSize = '1rem';
      
      // Auto-redirect to dashboard with bonus card
      if (bonusCard && data.redirect_url) {
        statusEl.textContent = '✅ Gelukt! Doorsturen naar dashboard...';
        setTimeout(() => {
          window.location.href = data.redirect_url;
        }, 1500);
      } else {
        // No bonus card - show close button
        closeBtn.style.display = 'inline-block';
      }
      
    } catch (e) {
      console.error('[Bookmarklet] Sync failed:', e);
      statusEl.textContent = '❌ Fout: ' + e.message;
      countEl.style.color = '#ef4444';
    }
    
    closeBtn.style.display = 'inline-block';
  }
  
  // Run!
  syncProducts();
})();
