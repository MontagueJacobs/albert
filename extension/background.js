/**
 * background.js - Service Worker for AH Grocery Wrapped Extension
 * 
 * Handles communication between popup and content script.
 * Injects content.js into the active tab when requested.
 */

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle extraction request from popup
  if (message.action === 'extractData') {
    handleExtraction(sendResponse);
    return true; // Keep message channel open for async response
  }
});

/**
 * Inject content script and extract product data from the current tab
 * @param {Function} sendResponse - Callback to send result back to popup
 */
async function handleExtraction(sendResponse) {
  try {
    // Get the currently active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Verify we're on an ah.nl page
    if (!tab.url || !tab.url.includes('ah.nl')) {
      sendResponse({ 
        success: false, 
        error: 'Please navigate to ah.nl first' 
      });
      return;
    }

    // Inject the content script into the page
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    // After injection, send message to content script to extract data
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'extract' });
    
    sendResponse(response);
    
  } catch (error) {
    console.error('[Background] Extraction failed:', error);
    sendResponse({ 
      success: false, 
      error: error.message || 'Failed to extract data' 
    });
  }
}

// Log when service worker starts
console.log('[AH Grocery Wrapped] Service worker started');
