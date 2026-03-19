/**
 * Bookmarklet for Duurzaam Boodschappen
 * 
 * Extracts products from AH "Eerder gekocht" page
 * and syncs them using bonus card identification
 */

(function() {
  'use strict';
  
  // Get API base from script URL
  const scriptTag = document.currentScript || document.querySelector('script[src*="bookmarklet.js"]');
  const srcUrl = scriptTag ? new URL(scriptTag.src) : null;
  const API_BASE = srcUrl ? srcUrl.origin : window.location.origin;
  
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
      
      // Get product name
      let name = '';
      const titleEl = a.querySelector('[data-testhook="product-title"]') ||
                      a.querySelector('span[class*="title"]') ||
                      a.closest('article')?.querySelector('h2, h3, [class*="title"]');
      if (titleEl) name = titleEl.textContent?.trim() || '';
      if (!name) name = a.getAttribute('aria-label') || '';
      name = name.replace(/\s+/g, ' ').trim();

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

      // Get image
      const imgEl = card?.querySelector('img[src*="static.ah.nl"]') || card?.querySelector('img');
      const image = imgEl?.src || '';

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
  
  async function getBonusCard() {
    // Method 1: Check if we're on klantenkaarten page or can extract from current page
    const bonusElements = document.querySelectorAll('[class*="bonus"], [class*="card-number"], [data-testid*="card"]');
    for (const el of bonusElements) {
      const text = el.textContent || '';
      const match = text.match(/\d{13}/);
      if (match) return match[0];
    }
    
    // Method 2: Try to fetch from klantenkaarten page
    try {
      statusEl.textContent = 'Bonuskaart ophalen...';
      const res = await fetch('https://www.ah.nl/mijn/klantenkaarten', { credentials: 'include' });
      const html = await res.text();
      const match = html.match(/\d{13}/);
      if (match) return match[0];
    } catch (e) {
      console.log('[Bookmarklet] Could not fetch bonus card:', e);
    }
    
    // Method 3: Check localStorage/sessionStorage
    try {
      const stored = localStorage.getItem('ah_bonus_card') || sessionStorage.getItem('ah_bonus_card');
      if (stored && /^\d{13}$/.test(stored)) return stored;
    } catch (e) {}
    
    return null;
  }
  
  // ============================================
  // AUTO SCROLL
  // ============================================
  
  async function autoScroll() {
    let lastCount = 0;
    let sameCountTimes = 0;
    
    while (sameCountTimes < 3) {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 1500));
      
      const items = extractProducts();
      countEl.textContent = `${items.length} producten gevonden`;
      progressEl.style.width = Math.min(20 + (sameCountTimes * 10), 50) + '%';
      
      if (items.length === lastCount) {
        sameCountTimes++;
      } else {
        sameCountTimes = 0;
        lastCount = items.length;
      }
    }
    
    window.scrollTo(0, 0);
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
      }
      
      const res = await fetch(`${API_BASE}/api/ingest/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      progressEl.style.width = '100%';
      
      if (!res.ok) {
        // Show both error code and detail if available
        const errMsg = data?.detail 
          ? `${data.error}: ${data.detail}` 
          : (data?.error || 'Upload mislukt');
        throw new Error(errMsg);
      }
      
      // Success!
      const stored = data.stored || items.length;
      statusEl.textContent = '✅ Gelukt!';
      
      let message = `${stored} producten gesynct`;
      if (bonusCard) {
        message += '\n\n🎫 Bonuskaart: ' + bonusCard.slice(-4).padStart(13, '•');
        // Store bonus card for future reference
        try { localStorage.setItem('ah_bonus_card', bonusCard); } catch(e) {}
      } else {
        message += '\n\n⚠️ Geen bonuskaart gevonden. Ga eerst naar ah.nl/mijn/klantenkaarten';
      }
      
      countEl.innerHTML = message.replace(/\n/g, '<br>');
      countEl.style.fontSize = '1rem';
      
      // Redirect option
      if (bonusCard && data.redirect_url) {
        const viewBtn = document.createElement('button');
        viewBtn.textContent = '📊 Bekijk resultaten';
        viewBtn.style.cssText = `
          margin-top: 16px;
          padding: 12px 32px;
          background: linear-gradient(135deg, #22c55e 0%, #667eea 100%);
          color: white;
          border: none;
          border-radius: 10px;
          cursor: pointer;
          font-size: 1rem;
          font-weight: 600;
        `;
        viewBtn.onclick = () => window.open(data.redirect_url, '_blank');
        closeBtn.parentElement.insertBefore(viewBtn, closeBtn);
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
