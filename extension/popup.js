// Popup script for Sustainable Shop extension

const AH_PURCHASE_URL = 'https://www.ah.nl/producten/eerder-gekocht?sortBy=purchase_date';

// Supabase config (same as the webapp)
const SUPABASE_URL = 'https://gfxawraapyjqtmlemskl.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_GByhVPFERsx_DD2gTB2y-w_5okCNIyM';

// Elements
const authStatus = document.getElementById('auth-status');
const authSection = document.getElementById('auth-section');
const signedInSection = document.getElementById('signed-in-section');
const authEmail = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const signInBtn = document.getElementById('sign-in-btn');
const signOutBtn = document.getElementById('sign-out-btn');
const authError = document.getElementById('auth-error');
const pageStatus = document.getElementById('page-status');
const productCount = document.getElementById('product-count');
const ahPageActions = document.getElementById('ah-page-actions');
const notAhPage = document.getElementById('not-ah-page');
const syncResult = document.getElementById('sync-result');
const syncMessage = document.getElementById('sync-message');
const scrollBtn = document.getElementById('scroll-btn');
const syncBtn = document.getElementById('sync-btn');
const openAhBtn = document.getElementById('open-ah-btn');
const apiSelect = document.getElementById('api-select');
const customUrlGroup = document.getElementById('custom-url-group');
const customUrlInput = document.getElementById('custom-url');
const saveSettingsBtn = document.getElementById('save-settings');

// Check auth status on load
async function checkAuthStatus() {
  const settings = await chrome.storage.sync.get(['userToken', 'userEmail']);
  
  if (settings.userToken && settings.userEmail) {
    // Verify token is still valid
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
          'Authorization': `Bearer ${settings.userToken}`,
          'apikey': SUPABASE_ANON_KEY
        }
      });
      
      if (res.ok) {
        showSignedIn(settings.userEmail);
        return;
      }
    } catch (e) {
      console.error('Token validation failed:', e);
    }
    
    // Token invalid, clear it
    await chrome.storage.sync.remove(['userToken', 'userEmail']);
  }
  
  showSignedOut();
}

function showSignedIn(email) {
  authStatus.textContent = `✅ ${email}`;
  authStatus.classList.add('success');
  authStatus.classList.remove('warning');
  authSection.classList.add('hidden');
  signedInSection.classList.remove('hidden');
}

function showSignedOut() {
  authStatus.textContent = '⚠️ Not signed in';
  authStatus.classList.remove('success');
  authStatus.classList.add('warning');
  authSection.classList.remove('hidden');
  signedInSection.classList.add('hidden');
}

// Sign in
signInBtn.addEventListener('click', async () => {
  const email = authEmail.value.trim();
  const password = authPassword.value;
  
  if (!email || !password) {
    authError.textContent = 'Please enter email and password';
    authError.style.display = 'block';
    return;
  }
  
  signInBtn.disabled = true;
  signInBtn.textContent = 'Signing in...';
  authError.style.display = 'none';
  
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ email, password })
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.error_description || data.msg || 'Sign in failed');
    }
    
    // Save token
    await chrome.storage.sync.set({
      userToken: data.access_token,
      userEmail: email
    });
    
    showSignedIn(email);
  } catch (e) {
    authError.textContent = e.message;
    authError.style.display = 'block';
  } finally {
    signInBtn.disabled = false;
    signInBtn.textContent = 'Sign In';
  }
});

// Sign out
signOutBtn.addEventListener('click', async () => {
  await chrome.storage.sync.remove(['userToken', 'userEmail']);
  showSignedOut();
  authEmail.value = '';
  authPassword.value = '';
});

// Initialize auth check
checkAuthStatus();

// Load saved settings
chrome.storage.sync.get(['apiBase', 'customUrl'], (result) => {
  if (result.apiBase) {
    if (result.apiBase === result.customUrl) {
      apiSelect.value = 'custom';
      customUrlGroup.classList.remove('hidden');
      customUrlInput.value = result.customUrl;
    } else {
      apiSelect.value = result.apiBase;
    }
  }
});

// Check current tab
chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
  const tab = tabs[0];
  const url = tab?.url || '';
  
  if (url.includes('ah.nl') && (
    url.includes('eerder-gekocht') || 
    url.includes('/producten/')
  )) {
    pageStatus.textContent = '✅ On AH purchases page';
    pageStatus.classList.add('success');
    ahPageActions.classList.remove('hidden');
    notAhPage.classList.add('hidden');
    
    // Get product count from content script
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getProductCount' });
      productCount.textContent = response?.count || 0;
    } catch (e) {
      productCount.textContent = 'Reload page to scan';
      productCount.classList.remove('success');
      productCount.classList.add('warning');
    }
  } else {
    pageStatus.textContent = '⚠️ Not on AH page';
    pageStatus.classList.add('warning');
    ahPageActions.classList.add('hidden');
    notAhPage.classList.remove('hidden');
  }
});

// Open AH purchases page
openAhBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: AH_PURCHASE_URL });
  window.close();
});

// Auto-scroll button
scrollBtn.addEventListener('click', async () => {
  scrollBtn.disabled = true;
  scrollBtn.textContent = '⏳ Scrolling...';
  
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'autoScroll' });
    if (response?.success) {
      productCount.textContent = response.total || '?';
      syncMessage.textContent = `Loaded ${response.total} products`;
      syncResult.classList.remove('hidden');
    }
  } catch (e) {
    console.error('Scroll failed:', e);
  }
  
  scrollBtn.disabled = false;
  scrollBtn.textContent = '📜 Auto-scroll to load all';
  
  // Refresh product count
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'getProductCount' });
    productCount.textContent = response?.count || 0;
  } catch (e) {}
});

// Sync button
syncBtn.addEventListener('click', async () => {
  syncBtn.disabled = true;
  syncBtn.textContent = '⏳ Syncing...';
  
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  // Get current API base
  const settings = await chrome.storage.sync.get(['apiBase', 'userToken']);
  
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { 
      action: 'scrape',
      apiBase: settings.apiBase,
      token: settings.userToken
    });
    
    syncResult.classList.remove('hidden');
    
    if (response?.success) {
      syncMessage.textContent = `✅ Synced ${response.stored} products!`;
      syncMessage.classList.remove('error');
      syncMessage.classList.add('success');
    } else {
      syncMessage.textContent = `❌ ${response?.error || 'Sync failed'}`;
      syncMessage.classList.remove('success');
      syncMessage.classList.add('error');
    }
  } catch (e) {
    console.error('Sync failed:', e);
    syncResult.classList.remove('hidden');
    syncMessage.textContent = `❌ ${e.message}`;
    syncMessage.classList.add('error');
  }
  
  syncBtn.disabled = false;
  syncBtn.textContent = '🔄 Sync Products';
});

// API select change
apiSelect.addEventListener('change', () => {
  if (apiSelect.value === 'custom') {
    customUrlGroup.classList.remove('hidden');
  } else {
    customUrlGroup.classList.add('hidden');
  }
});

// Save settings
saveSettingsBtn.addEventListener('click', () => {
  let apiBase = apiSelect.value;
  let customUrl = null;
  
  if (apiBase === 'custom') {
    customUrl = customUrlInput.value.trim();
    if (!customUrl) {
      alert('Please enter a custom URL');
      return;
    }
    apiBase = customUrl;
  }
  
  chrome.storage.sync.set({ apiBase, customUrl }, () => {
    saveSettingsBtn.textContent = '✓ Saved!';
    setTimeout(() => {
      saveSettingsBtn.textContent = 'Save Settings';
    }, 1500);
  });
});
