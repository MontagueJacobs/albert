(function () {
  // Configuration - will be updated from storage
  let API_BASE = 'https://albert-rm0mq7c61-montaguejacobs-projects.vercel.app';
  let userToken = null;

  // Load settings from storage
  chrome.storage.sync.get(['apiBase', 'userToken'], (result) => {
    if (result.apiBase) API_BASE = result.apiBase;
    if (result.userToken) userToken = result.userToken;
  });

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'scrape') {
      userToken = request.token || null;
      if (request.apiBase) API_BASE = request.apiBase;
      scrapeAndSend().then(sendResponse);
      return true; // Keep channel open for async response
    }
    if (request.action === 'getProductCount') {
      const items = extractProducts();
      sendResponse({ count: items.length });
      return true;
    }
    if (request.action === 'autoScroll') {
      autoScrollAndScrape().then(sendResponse);
      return true;
    }
  });

  function createFloatingUI() {
    if (document.getElementById('sustainable-shop-ui')) return;
    
    const container = document.createElement('div');
    container.id = 'sustainable-shop-ui';
    container.innerHTML = `
      <div style="
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      ">
        <div id="ss-panel" style="
          background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
          border-radius: 16px;
          padding: 16px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.4);
          color: #f3f4f6;
          min-width: 280px;
          display: none;
        ">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
            <span style="font-size: 24px;">🌱</span>
            <span style="font-weight: 600; font-size: 14px;">Sustainable Shop</span>
          </div>
          <div id="ss-status" style="font-size: 13px; color: #9ca3af; margin-bottom: 12px;">
            Ready to sync your purchases
          </div>
          <div id="ss-count" style="font-size: 13px; color: #22c55e; margin-bottom: 12px;">
            Products found: <span id="ss-product-count">0</span>
          </div>
          <button id="ss-auto-scroll" style="
            width: 100%;
            padding: 10px;
            margin-bottom: 8px;
            background: #334155;
            color: #f3f4f6;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
          ">
            📜 Auto-scroll to load all
          </button>
          <button id="ss-sync" style="
            width: 100%;
            padding: 12px;
            background: linear-gradient(135deg, #22c55e 0%, #667eea 100%);
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
          ">
            🔄 Sync to Sustainable Shop
          </button>
        </div>
        <button id="ss-toggle" style="
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: linear-gradient(135deg, #22c55e 0%, #667eea 100%);
          border: none;
          cursor: pointer;
          box-shadow: 0 4px 20px rgba(34, 197, 94, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 28px;
          margin-top: 12px;
          margin-left: auto;
        ">
          🌱
        </button>
      </div>
    `;
    document.body.appendChild(container);

    // Toggle panel
    const toggle = document.getElementById('ss-toggle');
    const panel = document.getElementById('ss-panel');
    toggle.onclick = () => {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      if (panel.style.display === 'block') updateProductCount();
    };

    // Auto-scroll button
    document.getElementById('ss-auto-scroll').onclick = async () => {
      const btn = document.getElementById('ss-auto-scroll');
      btn.disabled = true;
      btn.textContent = '⏳ Scrolling...';
      await autoScroll();
      btn.disabled = false;
      btn.textContent = '📜 Auto-scroll to load all';
      updateProductCount();
    };

    // Sync button
    document.getElementById('ss-sync').onclick = async () => {
      const btn = document.getElementById('ss-sync');
      btn.disabled = true;
      btn.textContent = '⏳ Syncing...';
      await scrapeAndSend();
      btn.disabled = false;
      btn.textContent = '🔄 Sync to Sustainable Shop';
    };

    // Initial count
    setTimeout(updateProductCount, 1000);
  }

  function updateProductCount() {
    const items = extractProducts();
    const countEl = document.getElementById('ss-product-count');
    if (countEl) countEl.textContent = items.length;
  }

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
      if (titleEl) {
        name = titleEl.textContent?.trim() || '';
      }
      if (!name) {
        name = a.getAttribute('aria-label') || a.textContent?.trim() || '';
      }
      name = name.replace(/\s+/g, ' ').trim();

      // Get card container
      const card = a.closest('article') || 
                   a.closest('[data-testhook="product-card"]') || 
                   a.closest('[class*="product"]') ||
                   a.parentElement?.parentElement;

      // Get price
      let price = null;
      const priceEl = card?.querySelector('[data-testhook="product-price"]') ||
                      card?.querySelector('[class*="price"]') ||
                      card?.querySelector('span:has(> sup)');
      if (priceEl) {
        const raw = priceEl.textContent?.replace(',', '.').match(/(\d+\.?\d*)/);
        if (raw) price = parseFloat(raw[1]);
      }

      // Get image
      const imgEl = card?.querySelector('img[src*="static.ah.nl"]') || card?.querySelector('img');
      const image = imgEl?.src || '';

      // Get product ID from URL
      const idMatch = href.match(/wi(\d+)/);
      const productId = idMatch ? idMatch[1] : null;

      if (name && name.length > 1) {
        items.push({ 
          name, 
          url, 
          price, 
          image, 
          productId,
          source: 'ah_eerder_gekocht',
          scrapedAt: new Date().toISOString()
        });
      }
    });
    
    return items;
  }

  async function autoScroll() {
    const status = document.getElementById('ss-status');
    let lastCount = 0;
    let sameCountTimes = 0;
    
    while (sameCountTimes < 3) {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 1500));
      
      const currentCount = extractProducts().length;
      if (status) status.textContent = `Loading... ${currentCount} products found`;
      
      if (currentCount === lastCount) {
        sameCountTimes++;
      } else {
        sameCountTimes = 0;
        lastCount = currentCount;
      }
    }
    
    window.scrollTo(0, 0);
    if (status) status.textContent = `Done! ${lastCount} products loaded`;
  }

  async function autoScrollAndScrape() {
    await autoScroll();
    return await scrapeAndSend();
  }

  async function scrapeAndSend() {
    const status = document.getElementById('ss-status');
    
    try {
      const items = extractProducts();
      if (!items.length) {
        if (status) status.textContent = '⚠️ No products found. Try scrolling first.';
        return { success: false, error: 'No products found' };
      }

      if (status) status.textContent = `📤 Uploading ${items.length} products...`;

      const headers = { 'Content-Type': 'application/json' };
      if (userToken) {
        headers['Authorization'] = `Bearer ${userToken}`;
      }

      const res = await fetch(`${API_BASE}/api/ingest/scrape`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ 
          items, 
          source: 'browser_extension', 
          scraped_at: new Date().toISOString() 
        })
      });

      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data?.detail || data?.error || 'Upload failed');
      }

      const stored = data.stored || items.length;
      if (status) status.textContent = `✅ Synced ${stored} products!`;
      
      return { success: true, stored, total: items.length };
    } catch (e) {
      console.error('Sustainable Shop sync failed:', e);
      if (status) status.textContent = `❌ Error: ${e.message}`;
      return { success: false, error: e.message };
    }
  }

  // Initialize floating UI when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createFloatingUI);
  } else {
    createFloatingUI();
  }

  // Watch for dynamic content changes
  const observer = new MutationObserver(() => {
    createFloatingUI();
    // Update count periodically when products are loaded
    const countEl = document.getElementById('ss-product-count');
    if (countEl && document.getElementById('ss-panel')?.style.display === 'block') {
      updateProductCount();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
