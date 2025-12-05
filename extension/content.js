(function () {
  const API_BASE = 'https://YOUR-VERCEL-DOMAIN.vercel.app'; // CHANGE THIS

  function addButton() {
    if (document.getElementById('ah-bonus-scrape-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'ah-bonus-scrape-btn';
    btn.textContent = 'Scrape this page';
    Object.assign(btn.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: 999999,
      padding: '10px 14px',
      borderRadius: '8px',
      border: 'none',
      color: '#fff',
      background: 'linear-gradient(135deg,#667eea,#764ba2)',
      boxShadow: '0 6px 14px rgba(0,0,0,.2)',
      cursor: 'pointer'
    });
    btn.onclick = scrapeAndSend;
    document.body.appendChild(btn);
  }

  function extractProducts() {
    const cards = document.querySelectorAll('a[href^="/producten/product/"], article a[href^="/producten/product/"]');
    const items = [];
    const seen = new Set();

    cards.forEach(a => {
      const url = new URL(a.href, location.origin).toString();
      if (seen.has(url)) return;
      seen.add(url);

      let name = a.getAttribute('aria-label') || a.textContent || '';
      name = name.replace(/\s+/g, ' ').trim();
      if (!name) {
        const titleEl = a.closest('article')?.querySelector('[data-testhook="product-title"], h3, h2');
        name = titleEl?.textContent?.trim() || '';
      }

      const card = a.closest('article') || a.closest('[data-testhook="product-card"]') || a.parentElement;
      let price = null;
      const priceEl = card?.querySelector('[data-testhook="product-price"], [class*="price"], span:has(> sup)');
      const raw = priceEl?.textContent?.replace(',', '.').match(/(\d+(\.\d{1,2})?)/);
      if (raw) price = parseFloat(raw[1]);

      const imgEl = card?.querySelector('img');
      const image = imgEl?.src || '';

      if (name) {
        items.push({ name, url, price, image, source: 'ah_bonus' });
      }
    });
    return items;
  }

  async function scrapeAndSend() {
    try {
      const items = extractProducts();
      if (!items.length) {
        alert('No products found yet. Scroll to load more and try again.');
        return;
      }
      const res = await fetch(`${API_BASE}/api/ingest/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, source: 'ah_bonus', scraped_at: new Date().toISOString() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'ingest_failed');
      alert(`Uploaded ${data.stored || items.length} items.`);
    } catch (e) {
      console.error('Scrape upload failed:', e);
      alert(`Upload failed: ${e.message}`);
    }
  }

  const observer = new MutationObserver(() => addButton());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addButton();
})();
