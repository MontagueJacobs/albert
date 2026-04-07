/**
 * content.js - DOM Extraction Script for AH Grocery Wrapped
 * 
 * This script extracts product/purchase data from Albert Heijn pages.
 * It runs in the context of the ah.nl webpage.
 * 
 * IMPORTANT: Selectors may need adjustment if AH updates their website.
 * Look for TODO comments marking places that may need updates.
 */

(function() {
  'use strict';

  // Prevent multiple injections
  if (window.__ahGroceryWrappedInjected) {
    console.log('[AH Wrapped] Already injected, skipping');
    return;
  }
  window.__ahGroceryWrappedInjected = true;

  console.log('[AH Wrapped] Content script loaded');

  // ============================================================
  // CONFIGURATION - Adjust selectors here if AH changes their DOM
  // ============================================================
  
  // TODO: Update these selectors if AH website structure changes
  const SELECTORS = {
    // Product card containers - common patterns on AH website
    productCards: [
      '[data-testid="product-card"]',              // Current AH product cards
      '[data-testhook="product-card"]',            // Legacy product cards
      '.product-card',                             // Generic product card class
      '[class*="ProductCard"]',                    // React-style class names
      'article[data-product]',                     // Article with product data
      '.lane-item',                                // Items in product lanes
      '[class*="product_root"]',                   // Product root containers
      'a[href*="/producten/product/"]',            // Product links
    ],
    
    // Product name selectors (tried in order)
    productName: [
      '[data-testid="product-title-line-clamp"]',
      '[data-testid="product-title"]',
      '[data-testhook="product-title"]',
      '.product-title',
      '[class*="title"]',
      'h3',
      'h2',
      '.product-card__title',
    ],
    
    // Price selectors
    price: [
      '[data-testhook="product-price"]',
      '.price',
      '[class*="price"]',
      '.product-price',
    ],
    
    // Category/label selectors
    category: [
      '[data-testhook="product-category"]',
      '.category',
      '[class*="Category"]',
      '.product-label',
      '[class*="Shield"]',                         // Bonus/discount labels
    ],
  };

  // ============================================================
  // EXTRACTION FUNCTIONS
  // ============================================================

  /**
   * Find an element using multiple selector strategies
   * @param {Element} container - Parent element to search within
   * @param {string[]} selectors - Array of CSS selectors to try
   * @returns {Element|null} First matching element or null
   */
  function findElement(container, selectors) {
    for (const selector of selectors) {
      try {
        const element = container.querySelector(selector);
        if (element) return element;
      } catch (e) {
        // Invalid selector, skip
      }
    }
    return null;
  }

  /**
   * Extract text content from an element, cleaned up
   * @param {Element|null} element - Element to extract text from
   * @returns {string|null} Cleaned text or null
   */
  function extractText(element) {
    if (!element) return null;
    const text = element.textContent?.trim();
    return text || null;
  }

  /**
   * Parse price from text (handles € symbol and comma decimals)
   * @param {string|null} priceText - Raw price text like "€ 2,49"
   * @returns {number|null} Parsed price as number or null
   */
  function parsePrice(priceText) {
    if (!priceText) return null;
    
    // Remove currency symbol and whitespace
    const cleaned = priceText
      .replace(/[€$£\s]/g, '')
      .replace(',', '.');  // Dutch format uses comma as decimal
    
    const price = parseFloat(cleaned);
    return isNaN(price) ? null : price;
  }

  /**
   * Find all product card elements on the page
   * @returns {Element[]} Array of product card elements
   */
  function findProductCards() {
    const cards = new Set();
    
    // Try each selector pattern
    for (const selector of SELECTORS.productCards) {
      try {
        const found = document.querySelectorAll(selector);
        if (found.length > 0) {
          console.log(`[AH Wrapped] Found ${found.length} products using: ${selector}`);
          found.forEach(el => cards.add(el));
        }
      } catch (e) {
        // Invalid selector, skip
      }
    }
    
    return Array.from(cards);
  }

  /**
   * Extract product data from a single card element
   * @param {Element} card - Product card element
   * @returns {Object} Extracted product data
   */
  function extractProductFromCard(card) {
    // Get the article/card container
    const container = card.closest('article') || 
                      card.closest('[data-testhook="product-card"]') || 
                      card.closest('[class*="product"]') ||
                      card;
    
    // Extract name
    const nameEl = findElement(container, SELECTORS.productName);
    let name = extractText(nameEl);
    
    // Fallback: try aria-label or link text
    if (!name) {
      name = card.getAttribute('aria-label') || extractText(card);
    }
    
    // Clean up name
    if (name) {
      name = name.replace(/\s+/g, ' ').trim();
    }
    
    // Extract price
    const priceEl = findElement(container, SELECTORS.price);
    const priceText = extractText(priceEl);
    const price = parsePrice(priceText);
    
    // Extract category/label
    const categoryEl = findElement(container, SELECTORS.category);
    const category = extractText(categoryEl);
    
    // Try to get product URL
    const linkEl = container.querySelector('a[href*="/producten/"]') || 
                   (card.tagName === 'A' ? card : null);
    const url = linkEl?.href || null;
    
    // Try to get product image - prefer data-testid, then src patterns
    const imgEl = container.querySelector('img[data-testid="product-image"]') ||
                  container.querySelector('img[src*="static.ah.nl"]') ||
                  container.querySelector('img[src*="ah.nl"]') ||
                  container.querySelector('img');
    let imageUrl = imgEl?.src || null;
    // Fallback: srcset or data-src for lazy-loaded images
    if ((!imageUrl || imageUrl.includes('data:image')) && imgEl) {
      const srcset = imgEl.getAttribute('srcset') || '';
      if (srcset) imageUrl = srcset.split(',')[0].trim().split(/\s+/)[0] || null;
      if (!imageUrl) imageUrl = imgEl.dataset?.src || imgEl.dataset?.lazySrc || null;
    }
    
    return {
      name,
      price,
      category,
      url,
      imageUrl
    };
  }

  /**
   * Main extraction function - extracts all visible products
   * @returns {Object} Extraction result with items array
   */
  function extractAllProducts() {
    console.log('[AH Wrapped] Starting extraction...');
    
    const cards = findProductCards();
    console.log(`[AH Wrapped] Found ${cards.length} total product cards`);
    
    const items = [];
    const seen = new Set();  // Track seen products to avoid duplicates
    
    for (const card of cards) {
      const product = extractProductFromCard(card);
      
      // Skip products without a name
      if (!product.name || product.name.length < 2) {
        continue;
      }
      
      // Skip duplicates (same name and price)
      const key = `${product.name}-${product.price}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      
      items.push({
        name: product.name,
        price: product.price,
        category: product.category,
      });
    }
    
    console.log(`[AH Wrapped] Extracted ${items.length} unique products`);
    
    return {
      success: true,
      items,
      metadata: {
        extractedAt: new Date().toISOString(),
        pageUrl: window.location.href,
        pageTitle: document.title,
        totalCards: cards.length,
        uniqueProducts: items.length
      }
    };
  }

  // ============================================================
  // MESSAGE HANDLER
  // ============================================================

  /**
   * Listen for messages from background script
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'extract') {
      console.log('[AH Wrapped] Received extract request');
      
      // Run extraction
      const result = extractAllProducts();
      
      // Log to console for debugging
      console.log('[AH Wrapped] Extraction result:', result);
      console.table(result.items.slice(0, 10));  // Show first 10 in table
      
      // Show alert to user
      if (result.items.length > 0) {
        alert(`✅ Extracted ${result.items.length} items!\n\nCheck the browser console (F12) for full data.`);
      } else {
        alert('⚠️ No products found on this page.\n\nTry navigating to:\n• Your purchase history\n• A product category page\n• Search results');
      }
      
      sendResponse(result);
    }
    
    return true;  // Keep channel open for async
  });

  // Log page detection
  if (window.location.href.includes('eerder-gekocht')) {
    console.log('[AH Wrapped] Purchase history page detected');
  }

})();
