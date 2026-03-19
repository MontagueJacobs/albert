/**
 * popup.js - Popup Script for AH Grocery Wrapped
 * 
 * Handles the popup UI and communicates with the background script
 * to trigger data extraction from the active tab.
 */

// ============================================
// DOM ELEMENTS
// ============================================

const statusEl = document.getElementById('status');
const extractBtn = document.getElementById('extractBtn');
const resultEl = document.getElementById('result');
const itemCountEl = document.getElementById('itemCount');

// ============================================
// STATUS HELPERS
// ============================================

/**
 * Update the status message with appropriate styling
 * @param {string} message - Message to display
 * @param {'info'|'success'|'error'|'warning'} type - Message type for styling
 */
function setStatus(message, type = 'info') {
  statusEl.textContent = message;
  statusEl.className = 'status';
  if (type !== 'info') {
    statusEl.classList.add(type);
  }
}

/**
 * Show the result card with item count
 * @param {number} count - Number of items extracted
 */
function showResult(count) {
  itemCountEl.textContent = count;
  resultEl.classList.add('visible');
}

/**
 * Hide the result card
 */
function hideResult() {
  resultEl.classList.remove('visible');
}

// ============================================
// TAB CHECKING
// ============================================

/**
 * Check if current tab is on ah.nl
 * @returns {Promise<{isAH: boolean, tab: chrome.tabs.Tab|null}>}
 */
async function checkCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.url) {
      return { isAH: false, tab: null };
    }
    
    const isAH = tab.url.includes('ah.nl');
    return { isAH, tab };
  } catch (error) {
    console.error('[Popup] Tab check error:', error);
    return { isAH: false, tab: null };
  }
}

// ============================================
// EXTRACTION HANDLER
// ============================================

/**
 * Main extraction handler - triggered by button click
 */
async function handleExtract() {
  console.log('[Popup] Extract button clicked');
  
  // Disable button during extraction
  extractBtn.disabled = true;
  extractBtn.textContent = '⏳ Extracting...';
  hideResult();
  
  try {
    // Check if we're on ah.nl
    const { isAH, tab } = await checkCurrentTab();
    
    if (!isAH) {
      setStatus('Please navigate to ah.nl first', 'warning');
      extractBtn.disabled = false;
      extractBtn.textContent = '🔍 Generate Wrapped';
      return;
    }
    
    setStatus('Injecting extraction script...', 'info');
    
    // Inject the content script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
    
    setStatus('Extracting products...', 'info');
    
    // Send message to content script to extract data
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'extract' });
    
    console.log('[Popup] Extraction response:', response);
    
    if (response && response.success) {
      const count = response.items?.length || 0;
      
      if (count > 0) {
        setStatus(`Successfully extracted ${count} items!`, 'success');
        showResult(count);
        
        // Log the full data structure to console
        console.log('[AH Wrapped] Extracted data:', JSON.stringify(response, null, 2));
      } else {
        setStatus('No products found on this page. Try your purchase history.', 'warning');
      }
    } else {
      setStatus(response?.error || 'Extraction failed', 'error');
    }
    
  } catch (error) {
    console.error('[Popup] Extraction error:', error);
    setStatus('Error: ' + error.message, 'error');
  }
  
  // Re-enable button
  extractBtn.disabled = false;
  extractBtn.textContent = '🔍 Generate Wrapped';
}

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize popup on load
 */
async function init() {
  console.log('[Popup] Initializing...');
  
  // Check current tab
  const { isAH } = await checkCurrentTab();
  
  if (isAH) {
    setStatus('Ready! Click the button to extract products.', 'info');
  } else {
    setStatus('Navigate to ah.nl to extract products', 'warning');
  }
  
  // Attach click handler
  extractBtn.addEventListener('click', handleExtract);
}

// Run initialization
init();
