// Bookmarklet script for Sustainable Shop
// This gets loaded when users click the bookmarklet on ah.nl

(function() {
  // Get token from URL params
  const scriptTag = document.currentScript || document.querySelector('script[src*="bookmarklet.js"]');
  const srcUrl = scriptTag ? new URL(scriptTag.src) : null;
  const userToken = srcUrl ? srcUrl.searchParams.get('token') : null;
  
  // API base - detect from script source
  const API_BASE = srcUrl ? srcUrl.origin : 'https://albert-rm0mq7c61-montaguejacobs-projects.vercel.app';
  
  // Check if on correct page
  if (!window.location.href.includes('ah.nl')) {
    alert('🌱 Sustainable Shop\n\nPlease use this bookmarklet on ah.nl/producten/eerder-gekocht');
    return;
  }
  
  // Show loading overlay
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
        <h2 style="margin: 0 0 8px; font-size: 1.5rem;">Sustainable Shop</h2>
        <p id="ss-status" style="color: #9ca3af; margin-bottom: 24px;">Scanning products...</p>
        <div id="ss-progress" style="
          background: #334155;
          border-radius: 8px;
          height: 8px;
          overflow: hidden;
          margin-bottom: 24px;
        ">
          <div id="ss-progress-bar" style="
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
  const progressBar = document.getElementById('ss-progress-bar');
  const countEl = document.getElementById('ss-count');
  const closeBtn = document.getElementById('ss-close');
  
  closeBtn.onclick = () => overlay.remove();
  
  // Extract products
  function extractProducts() {
    const cards = document.querySelectorAll('a[href*="/producten/product/"]');
    const items = [];
    const seen = new Set();

    cards.forEach(a => {
      const href = a.getAttribute('href');
      if (!href || seen.has(href)) return;
      seen.add(href);

      const url = new URL(href, location.origin).toString();
      
      let name = '';
      const titleEl = a.querySelector('[data-testhook="product-title"]') ||
                      a.querySelector('span[class*="title"]') ||
                      a.closest('article')?.querySelector('h2, h3, [class*="title"]');
      if (titleEl) name = titleEl.textContent?.trim() || '';
      if (!name) name = a.getAttribute('aria-label') || a.textContent?.trim() || '';
      name = name.replace(/\s+/g, ' ').trim();

      const card = a.closest('article') || 
                   a.closest('[data-testhook="product-card"]') || 
                   a.closest('[class*="product"]') ||
                   a.parentElement?.parentElement;

      let price = null;
      const priceEl = card?.querySelector('[data-testhook="product-price"]') ||
                      card?.querySelector('[class*="price"]');
      if (priceEl) {
        const raw = priceEl.textContent?.replace(',', '.').match(/(\d+\.?\d*)/);
        if (raw) price = parseFloat(raw[1]);
      }

      const imgEl = card?.querySelector('img[src*="static.ah.nl"]') || card?.querySelector('img');
      const image = imgEl?.src || '';

      const idMatch = href.match(/wi(\d+)/);
      const productId = idMatch ? idMatch[1] : null;

      if (name && name.length > 1) {
        items.push({ name, url, price, image, productId, source: 'bookmarklet' });
      }
    });
    
    return items;
  }
  
  // Main sync function
  async function syncProducts() {
    try {
      // Step 1: Scan visible products
      statusEl.textContent = 'Scanning visible products...';
      progressBar.style.width = '20%';
      
      let items = extractProducts();
      countEl.textContent = `${items.length} products found`;
      
      // Step 2: Auto-scroll to load more
      statusEl.textContent = 'Scrolling to load all products...';
      let lastCount = 0;
      let sameCountTimes = 0;
      
      while (sameCountTimes < 3) {
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise(r => setTimeout(r, 1500));
        
        items = extractProducts();
        countEl.textContent = `${items.length} products found`;
        progressBar.style.width = Math.min(20 + (sameCountTimes / 3) * 30, 50) + '%';
        
        if (items.length === lastCount) {
          sameCountTimes++;
        } else {
          sameCountTimes = 0;
          lastCount = items.length;
        }
      }
      
      window.scrollTo(0, 0);
      
      if (!items.length) {
        statusEl.textContent = '⚠️ No products found. Make sure you\'re on the "Eerder gekocht" page.';
        closeBtn.style.display = 'inline-block';
        return;
      }
      
      // Step 3: Upload
      statusEl.textContent = `Uploading ${items.length} products...`;
      progressBar.style.width = '70%';
      
      const headers = { 'Content-Type': 'application/json' };
      if (userToken) {
        headers['Authorization'] = `Bearer ${userToken}`;
      }
      
      const res = await fetch(`${API_BASE}/api/ingest/scrape`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ 
          items, 
          source: 'bookmarklet', 
          scraped_at: new Date().toISOString() 
        })
      });
      
      const data = await res.json();
      progressBar.style.width = '100%';
      
      if (!res.ok) {
        throw new Error(data?.detail || data?.error || 'Upload failed');
      }
      
      const stored = data.stored || items.length;
      const accountMsg = userToken 
        ? (data.purchasesRecorded ? ` (${data.purchasesRecorded} added to your account)` : '')
        : '\n\n⚠️ Sign in at the website to save to your account!';
      
      statusEl.textContent = `✅ Success!`;
      countEl.textContent = `${stored} products synced${accountMsg}`;
      countEl.style.color = '#22c55e';
      
    } catch (e) {
      console.error('Sustainable Shop sync failed:', e);
      statusEl.textContent = `❌ Error: ${e.message}`;
      countEl.style.color = '#ef4444';
    }
    
    closeBtn.style.display = 'inline-block';
  }
  
  // Run
  syncProducts();
})();
