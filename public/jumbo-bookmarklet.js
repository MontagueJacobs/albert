/**
 * Bookmarklet for Duurzaam Boodschappen - JUMBO
 * 
 * Extracts products from Jumbo "Bestellingen" page
 * Fetches receipt JSON and syncs products
 */

(function() {
  'use strict';
  
  // Get API base from script URL
  const scriptTag = document.currentScript || document.querySelector('script[src*="jumbo-bookmarklet.js"]');
  const srcUrl = scriptTag ? new URL(scriptTag.src) : null;
  const API_BASE = srcUrl ? srcUrl.origin : 'https://www.bubblebrainz.com';
  
  // Check if on Jumbo website
  if (!window.location.href.includes('jumbo.com')) {
    alert('🌱 Duurzaam Boodschappen\n\nGa naar jumbo.com/bestellingen en probeer opnieuw!');
    return;
  }
  
  // ============================================
  // UI OVERLAY
  // ============================================
  
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
        max-width: 450px;
        text-align: center;
        color: #f3f4f6;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      ">
        <div style="font-size: 48px; margin-bottom: 16px;">🌱</div>
        <h2 style="margin: 0 0 8px; font-size: 1.5rem;">Duurzaam Boodschappen</h2>
        <p style="color: #fbbf24; font-size: 0.9rem; margin-bottom: 8px;">🍊 Jumbo Import</p>
        <p id="ss-status" style="color: #9ca3af; margin-bottom: 24px;">Bonnetjes zoeken...</p>
        <div style="
          background: #334155;
          border-radius: 8px;
          height: 8px;
          overflow: hidden;
          margin-bottom: 24px;
        ">
          <div id="ss-progress" style="
            background: linear-gradient(90deg, #fbbf24, #f97316);
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
  // JUMBO EXTRAS CARD EXTRACTION
  // ============================================
  
  async function getJumboCard() {
    // Look for Jumbo Extra's card number in page content
    // Common places: account menu, cookie, localStorage
    
    // Method 1: Try localStorage/sessionStorage
    try {
      const stored = localStorage.getItem('jumbo_card') || sessionStorage.getItem('jumbo_card');
      if (stored && /^\d{13,16}$/.test(stored)) return stored;
    } catch (e) {}
    
    // Method 2: Look in page content for card number patterns
    const pageText = document.body.innerText || '';
    const cardMatch = pageText.match(/(?:Extra's|Klantnummer|Pasnummer)[:\s]*(\d{13,16})/i);
    if (cardMatch) return cardMatch[1];
    
    // Method 3: Try to extract from account API
    try {
      statusEl.textContent = 'Klantnummer ophalen...';
      const res = await fetch('https://www.jumbo.com/api/account', { 
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });
      if (res.ok) {
        const data = await res.json();
        // Look for card number in account data
        const cardNum = data?.loyaltyCard?.number || data?.jumboExtras?.cardNumber || data?.customerId;
        if (cardNum && /^\d{8,16}$/.test(cardNum)) return cardNum;
      }
    } catch (e) {
      console.log('[Jumbo Bookmarklet] Could not fetch account:', e);
    }
    
    // Method 4: Generate a session-based ID from email hash or use timestamp
    // This allows tracking purchases per session even without explicit card
    try {
      const emailEl = document.querySelector('[data-testid="email"], .account-email, [class*="email"]');
      if (emailEl?.textContent) {
        const email = emailEl.textContent.trim().toLowerCase();
        // Simple hash for privacy
        let hash = 0;
        for (let i = 0; i < email.length; i++) {
          hash = ((hash << 5) - hash) + email.charCodeAt(i);
          hash = hash & hash;
        }
        return 'jumbo-' + Math.abs(hash).toString().padStart(10, '0');
      }
    } catch (e) {}
    
    return null;
  }
  
  // ============================================
  // RECEIPT EXTRACTION
  // ============================================
  
  function findReceiptLinks() {
    const links = [];
    
    // Look for receipt/bonnetje links
    // Pattern 1: Direct JSON links
    const jsonLinks = document.querySelectorAll('a[href*="/bonnetjes/"]');
    jsonLinks.forEach(a => {
      const href = a.getAttribute('href');
      if (href && href.includes('.json')) {
        links.push(href);
      }
    });
    
    // Pattern 2: Order links that we can convert to receipt URLs
    const orderLinks = document.querySelectorAll('a[href*="/bestellingen/"], a[href*="/order/"]');
    orderLinks.forEach(a => {
      const href = a.getAttribute('href');
      // Extract order ID and look for associated receipt
      const orderMatch = href?.match(/(?:bestellingen|order)\/([a-z0-9-]+)/i);
      if (orderMatch) {
        const orderId = orderMatch[1];
        // Also check for date in nearby elements
        const container = a.closest('[class*="order"], article, li, tr');
        const dateEl = container?.querySelector('[class*="date"], time');
        const dateText = dateEl?.textContent || dateEl?.getAttribute('datetime') || '';
        
        links.push({
          orderId,
          dateText,
          element: a
        });
      }
    });
    
    // Pattern 3: Look for data attributes with receipt info
    const dataEls = document.querySelectorAll('[data-receipt-id], [data-order-id], [data-bonnetje]');
    dataEls.forEach(el => {
      const receiptId = el.dataset.receiptId || el.dataset.orderId || el.dataset.bonnetje;
      if (receiptId) {
        links.push({ orderId: receiptId, element: el });
      }
    });
    
    return links;
  }
  
  async function fetchReceipt(receiptUrl) {
    try {
      const res = await fetch(receiptUrl, { 
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) {
        console.log(`[Jumbo] Failed to fetch receipt: ${res.status}`);
        return null;
      }
      return await res.json();
    } catch (e) {
      console.error('[Jumbo] Receipt fetch error:', e);
      return null;
    }
  }
  
  function extractProductsFromReceipt(receipt) {
    const products = [];
    
    // Handle different possible JSON structures
    // Structure 1: Direct items array
    const items = receipt?.items || receipt?.products || receipt?.orderLines || receipt?.lines || [];
    
    for (const item of items) {
      // Extract product info - try multiple field names
      const name = item.name || item.productName || item.title || item.description || '';
      const price = item.price || item.totalPrice || item.amount || item.unitPrice || null;
      const quantity = item.quantity || item.amount || item.count || 1;
      const sku = item.sku || item.productId || item.id || item.ean || '';
      const imageUrl = item.imageUrl || item.image || item.imageURL || '';
      const url = item.url || item.productUrl || item.link || '';
      
      if (name && name.length > 1) {
        products.push({
          name: name.trim(),
          price: typeof price === 'number' ? price : parseFloat(String(price).replace(',', '.')) || null,
          quantity,
          image_url: imageUrl || null,
          url: url || null,
          jumbo_id: sku || null,
          source: 'jumbo_receipt',
          store: 'jumbo'
        });
      }
    }
    
    return products;
  }
  
  // ============================================
  // ALTERNATIVE: SCRAPE FROM PAGE
  // ============================================
  
  function extractProductsFromPage() {
    const products = [];
    const seen = new Set();
    
    // Look for product elements on the page
    // This handles cases where JSON API isn't available
    
    // Pattern 1: Product cards/tiles
    const productCards = document.querySelectorAll(
      '[class*="product-card"], [class*="order-line"], [class*="product-item"], ' +
      '[data-testid*="product"], [class*="basket-item"], [class*="order-item"]'
    );
    
    productCards.forEach(card => {
      // Get product name
      const nameEl = card.querySelector(
        '[class*="product-name"], [class*="title"], h2, h3, h4, ' +
        '[data-testid="product-name"], [class*="description"]'
      );
      const name = nameEl?.textContent?.trim();
      if (!name || name.length < 2) return;
      
      // Dedupe
      if (seen.has(name.toLowerCase())) return;
      seen.add(name.toLowerCase());
      
      // Get price
      let price = null;
      const priceEl = card.querySelector('[class*="price"], [data-testid="price"]');
      if (priceEl) {
        const priceText = priceEl.textContent?.replace(/[€$£\s]/g, '').replace(',', '.');
        price = parseFloat(priceText) || null;
      }
      
      // Get image
      const imgEl = card.querySelector('img');
      const imageUrl = imgEl?.src || imgEl?.dataset?.src || null;
      
      // Get link
      const linkEl = card.querySelector('a[href*="/product"]') || card.closest('a[href*="/product"]');
      const url = linkEl?.href || null;
      
      // Extract product ID from URL if available
      let jumboId = null;
      if (url) {
        const idMatch = url.match(/\/(\d{6,})/);
        if (idMatch) jumboId = idMatch[1];
      }
      
      products.push({
        name,
        price,
        url,
        image_url: imageUrl,
        jumbo_id: jumboId,
        source: 'jumbo_page',
        store: 'jumbo'
      });
    });
    
    return products;
  }
  
  // ============================================
  // MAIN SYNC FUNCTION
  // ============================================
  
  async function syncProducts() {
    try {
      // Step 1: Try to find receipt links
      statusEl.textContent = 'Bonnetjes zoeken...';
      progressEl.style.width = '10%';
      
      let allProducts = [];
      const receiptLinks = findReceiptLinks();
      
      if (receiptLinks.length > 0) {
        statusEl.textContent = `${receiptLinks.length} bonnetjes gevonden`;
        
        // Fetch each receipt
        let fetched = 0;
        for (const link of receiptLinks) {
          fetched++;
          progressEl.style.width = (10 + (fetched / receiptLinks.length) * 40) + '%';
          statusEl.textContent = `Bonnetje ${fetched}/${receiptLinks.length} ophalen...`;
          
          let receiptUrl;
          if (typeof link === 'string') {
            receiptUrl = link.startsWith('http') ? link : `https://www.jumbo.com${link}`;
          } else if (link.orderId) {
            // Try to construct receipt URL
            receiptUrl = `https://www.jumbo.com/bonnetjes/${link.orderId}.json`;
          }
          
          if (receiptUrl) {
            const receipt = await fetchReceipt(receiptUrl);
            if (receipt) {
              const products = extractProductsFromReceipt(receipt);
              allProducts.push(...products);
              countEl.textContent = `${allProducts.length} producten gevonden`;
            }
          }
          
          // Small delay between requests
          await new Promise(r => setTimeout(r, 200));
        }
      }
      
      // Step 2: If no receipts found or no products, try scraping page
      if (allProducts.length === 0) {
        statusEl.textContent = 'Producten op pagina zoeken...';
        progressEl.style.width = '50%';
        
        allProducts = extractProductsFromPage();
        countEl.textContent = `${allProducts.length} producten gevonden`;
      }
      
      if (allProducts.length === 0) {
        statusEl.textContent = '⚠️ Geen producten gevonden';
        countEl.innerHTML = 'Ga naar <b>jumbo.com/bestellingen</b><br>of open een bonnetje';
        closeBtn.style.display = 'inline-block';
        return;
      }
      
      // Step 3: Get Jumbo card/customer ID
      statusEl.textContent = 'Klantnummer zoeken...';
      progressEl.style.width = '60%';
      const jumboCard = await getJumboCard();
      
      // Step 4: Deduplicate products
      const uniqueProducts = [];
      const seenNames = new Set();
      for (const p of allProducts) {
        const key = p.jumbo_id || p.name.toLowerCase();
        if (!seenNames.has(key)) {
          seenNames.add(key);
          uniqueProducts.push(p);
        }
      }
      
      // Step 5: Upload products
      statusEl.textContent = `${uniqueProducts.length} producten uploaden...`;
      progressEl.style.width = '80%';
      
      // Transform for API - adapt to AH format for compatibility
      const items = uniqueProducts.map(p => ({
        name: p.name,
        url: p.url || `https://www.jumbo.com/product/${p.jumbo_id || encodeURIComponent(p.name)}`,
        price: p.price,
        image_url: p.image_url,
        jumbo_id: p.jumbo_id,
        source: 'jumbo_bookmarklet',
        store: 'jumbo'
      }));
      
      const payload = {
        items,
        source: 'jumbo_bookmarklet',
        store: 'jumbo',
        scraped_at: new Date().toISOString()
      };
      
      if (jumboCard) {
        payload.bonus_card = jumboCard;
      }
      
      const res = await fetch(`${API_BASE}/api/ingest/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      progressEl.style.width = '100%';
      
      if (!res.ok) {
        const errMsg = data?.detail || data?.error || 'Upload mislukt';
        throw new Error(errMsg);
      }
      
      // Success!
      const stored = data.stored || uniqueProducts.length;
      statusEl.textContent = '✅ Gelukt!';
      
      let message = `${stored} producten gesynct van Jumbo`;
      
      if (data.purchasesRecorded > 0) {
        message += `\n✅ ${data.purchasesRecorded} aankopen opgeslagen`;
      }
      
      if (jumboCard) {
        message += '\n\n🎫 Klantnummer: ••••' + jumboCard.slice(-4);
      }
      
      countEl.innerHTML = message.replace(/\n/g, '<br>');
      countEl.style.fontSize = '1rem';
      
      // Redirect to dashboard
      if (jumboCard && data.redirect_url) {
        statusEl.textContent = '✅ Gelukt! Doorsturen naar dashboard...';
        setTimeout(() => {
          window.location.href = data.redirect_url;
        }, 1500);
      } else {
        closeBtn.style.display = 'inline-block';
      }
      
    } catch (e) {
      console.error('[Jumbo Bookmarklet] Sync failed:', e);
      statusEl.textContent = '❌ Fout: ' + e.message;
      countEl.style.color = '#ef4444';
      closeBtn.style.display = 'inline-block';
    }
  }
  
  // Run!
  syncProducts();
})();
