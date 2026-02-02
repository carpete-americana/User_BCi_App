// Frontend API cache module with rate limiting and retry logic
const ElectronStorage = require('../../js/storage');
const { API_CONFIG, GITHUB_CONFIG, DEBUG } = require('./config');

const STORAGE_PREFIX = API_CONFIG.STORAGE_PREFIX;

// Exponential backoff configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000, // 1s
  maxDelay: 10000  // 10s
};

// Offline request queue
let offlineQueue = [];
let isOnline = true;

// No rate limiting needed for our own API (handled by the server)
// Requests are made directly without queue delays

/**
 * Fetch a file from the Frontend API with ETag-based caching and configurable TTL.
 * @param {string} pathRel - Relative path (e.g., "login/index.html")
 * @param {string} basePath - Base path prefix (e.g., "pages/", "" for assets)
 * @param {number} ttl - Time-to-live in milliseconds
 */
async function apiFetchWithCache(pathRel, basePath, ttl) {
  const key = STORAGE_PREFIX + pathRel;
  const cached = ElectronStorage.getItem(key);
  const now = Date.now();
  
  const filePath = `${basePath}${pathRel}`;
  // Adicionar versioning ao URL para invalidar cache em crítico
  const versionParam = `?v=${API_CONFIG.CACHE_BUSTER}`;
  const url = `${API_CONFIG.BASE_URL}${API_CONFIG.FILES_ENDPOINT}/${filePath}${versionParam}`;

  // Validate URL before fetching
  const security = require('./security');
  if (!security.isUrlSafe(url)) {
    throw new Error(`Unsafe URL blocked: ${url}`);
  }

  // Check if cached version is still valid
  if (cached && cached.fetchedAt && (now - cached.fetchedAt < ttl)) {
    DEBUG && console.log(`[API CACHE HIT] ${pathRel} (${Math.round((now - cached.fetchedAt) / 1000)}s old)`);
    return cached;
  }

  DEBUG && console.log(`[API FETCH] ${url}`);

  const doFetch = async (retryCount = 0) => {
    try {
      const headers = {};
      
      // Add ETag if we have one cached
      if (cached && cached.etag) {
        headers['If-None-Match'] = cached.etag;
      }
      
      const resp = await fetch(url, { headers });
      
      // Handle 304 Not Modified
      if (resp.status === 304 && cached) {
        cached.fetchedAt = now;
        ElectronStorage.setItem(key, cached);
        DEBUG && console.log(`[API CACHE HIT] ${pathRel} (304 Not Modified)`);
        
        // Track cache hit
        try {
          const metrics = require('./metrics');
          metrics.trackCacheHit(true);
        } catch (e) {}
        
        return cached;
      }
      
      if (resp.ok) {
        const text = await resp.text();
        const etag = resp.headers.get('etag');
        const payload = { content: text, etag, fetchedAt: now };
        ElectronStorage.setItem(key, payload);
        DEBUG && console.log(`[API SUCCESS] ${pathRel} (${text.length} bytes)`);
        
        // Track cache miss
        try {
          const metrics = require('./metrics');
          metrics.trackCacheHit(false);
        } catch (e) {}
        
        return payload;
      }
      
      // Handle errors
      if (resp.status === 404) {
        throw new Error(`File not found: ${pathRel}`);
      }
      
      if (resp.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }
      
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      
    } catch (err) {
      // Exponential backoff retry with jitter
      if (retryCount < RETRY_CONFIG.maxRetries) {
        const delay = Math.min(
          RETRY_CONFIG.baseDelay * Math.pow(2, retryCount) + Math.random() * 1000,
          RETRY_CONFIG.maxDelay
        );
        DEBUG && console.log(`[RETRY ${retryCount + 1}/${RETRY_CONFIG.maxRetries}] ${pathRel} after ${Math.round(delay)}ms - ${err.message}`);
        await new Promise(r => setTimeout(r, delay));
        return doFetch(retryCount + 1);
      }
      
      DEBUG && console.error(`[API ERROR] ${pathRel}:`, err);
      
      // Return cached version if available (even if expired)
      if (cached && cached.content) {
        console.warn(`[API FALLBACK] Using stale cache for ${pathRel}`);
        return cached;
      }
      
      // If all retries failed and offline, queue the request
      if (!isOnline) {
        DEBUG && console.log(`[OFFLINE QUEUE] Adding ${pathRel} to queue`);
        offlineQueue.push({ pathRel, basePath, ttl });
      }
      
      throw err;
    }
  };
  return doFetch();
}

// IPC handler to fetch page content with cache
function handleFetch(event, pathRel, ttl) {
  const effectiveTTL = ttl || API_CONFIG.PAGE_TTL;
  return apiFetchWithCache(pathRel, 'pages/', effectiveTTL);
}

// IPC handler to fetch assets (path already includes 'assets/' prefix)
function handleFetchAsset(event, pathRel, ttl) {
  const effectiveTTL = ttl || API_CONFIG.ASSET_TTL;
  // Don't add prefix - pathRel already contains full path like 'assets/js/utils.js'
  return apiFetchWithCache(pathRel, '', effectiveTTL);
}

// IPC handler to clear cache for a specific file
function handleClear(event, pathRel) {
  ElectronStorage.removeItem(STORAGE_PREFIX + pathRel);
}

// IPC handler to clear all cache
function handleClearAll() {
  Object.keys(ElectronStorage.data)
    .filter(k => k.startsWith(STORAGE_PREFIX))
    .forEach(k => ElectronStorage.removeItem(k));
}

/**
 * List CSS files under assets/css from the Frontend API.
 */
async function listCssFiles() {
  try {
    DEBUG && console.log('[assets:listCss] fetching from Frontend API...');
    const apiUrl = `${API_CONFIG.BASE_URL}/api/list`;
    
    const resp = await fetch(apiUrl);
    if (resp && resp.ok) {
      const data = await resp.json();
      if (data && data.success && Array.isArray(data.files)) {
        // Filter CSS files from assets/css/
        const cssFiles = data.files
          .filter(f => f.startsWith('assets/css/') && f.endsWith('.css'))
          .map(f => f.replace('assets/css/', ''));
        DEBUG && console.log('[assets:listCss] ✓ API success:', cssFiles);
        return cssFiles;
      }
    }
    console.warn('[assets:listCss] ✗ API failed with status', resp?.status);
    return [];
  } catch (e) {
    console.error('[assets:listCss] error:', e.message);
    return [];
  }
}

/**
 * List JS files under assets/js from the Frontend API.
 */
async function listJsFiles() {
  try {
    DEBUG && console.log('[assets:listJs] fetching from Frontend API...');
    const apiUrl = `${API_CONFIG.BASE_URL}/api/list`;
    
    const resp = await fetch(apiUrl);
    if (resp && resp.ok) {
      const data = await resp.json();
      if (data && data.success && Array.isArray(data.files)) {
        // Filter JS files from assets/js/
        const jsFiles = data.files
          .filter(f => f.startsWith('assets/js/') && f.endsWith('.js'))
          .map(f => f.replace('assets/js/', ''));
        DEBUG && console.log('[assets:listJs] ✓ API success:', jsFiles);
        return jsFiles;
      }
    }
    console.warn('[assets:listJs] ✗ API failed with status', resp?.status);
    return [];
  } catch (e) {
    console.error('[assets:listJs] error:', e.message);
    return [];
  }
}

// Clean old cache entries (remove entries older than MAX_CACHE_AGE)
function cleanOldCache() {
  const now = Date.now();
  const keys = Object.keys(ElectronStorage.data).filter(k => k.startsWith(API_CONFIG.STORAGE_PREFIX));
  let cleaned = 0;
  keys.forEach(k => {
    const item = ElectronStorage.getItem(k);
    if (item && item.fetchedAt && (now - item.fetchedAt > API_CONFIG.MAX_CACHE_AGE)) {
      ElectronStorage.removeItem(k);
      cleaned++;
    }
  });
  DEBUG && cleaned > 0 && console.log(`[CACHE CLEANUP] Removed ${cleaned} old entries`);
}

// Set online/offline status
function setOnlineStatus(online) {
  const wasOffline = !isOnline;
  isOnline = online;
  
  DEBUG && console.log(`[NETWORK] Status changed: ${online ? 'ONLINE' : 'OFFLINE'}`);
  
  // Process offline queue when coming back online
  if (online && wasOffline && offlineQueue.length > 0) {
    processOfflineQueue();
  }
}

// Process offline queue
async function processOfflineQueue() {
  if (offlineQueue.length === 0) return;
  
  DEBUG && console.log(`[OFFLINE QUEUE] Processing ${offlineQueue.length} queued requests`);
  
  const queue = [...offlineQueue];
  offlineQueue = [];
  
  for (const { pathRel, basePath, ttl } of queue) {
    try {
      await apiFetchWithCache(pathRel, basePath, ttl);
      DEBUG && console.log(`[OFFLINE QUEUE] ✓ Synced ${pathRel}`);
    } catch (err) {
      DEBUG && console.log(`[OFFLINE QUEUE] ✗ Failed to sync ${pathRel}:`, err.message);
    }
  }
  
  DEBUG && console.log('[OFFLINE QUEUE] Sync complete');
}

// Preload frequently accessed pages
async function preloadFrequentPages() {
  const frequentPages = ['dashboard', 'rules', 'withdraw'];
  
  DEBUG && console.log('[CACHE] Preloading frequent pages...');
  
  for (const page of frequentPages) {
    try {
      await apiFetchWithCache(`${page}/index.html`, 'pages/', API_CONFIG.PAGE_TTL);
      await apiFetchWithCache(`${page}/styles.css`, 'pages/', API_CONFIG.PAGE_TTL);
      DEBUG && console.log(`[CACHE] ✓ Preloaded ${page}`);
    } catch (err) {
      DEBUG && console.log(`[CACHE] ✗ Failed to preload ${page}:`, err.message);
    }
  }
}

// Background cache refresh (updates cache without blocking)
function startBackgroundSync() {
  // Refresh cache every 30 minutes
  setInterval(async () => {
    if (!isOnline) return;
    
    DEBUG && console.log('[BACKGROUND SYNC] Starting cache refresh...');
    
    try {
      // Refresh CSS/JS assets
      const cssFiles = await listCssFiles();
      const jsFiles = await listJsFiles();
      
      for (const file of cssFiles) {
        await apiFetchWithCache(`css/${file}`, 'assets/', API_CONFIG.ASSET_TTL);
      }
      
      for (const file of jsFiles) {
        await apiFetchWithCache(`js/${file}`, 'assets/', API_CONFIG.ASSET_TTL);
      }
      
      DEBUG && console.log('[BACKGROUND SYNC] Cache refresh complete');
    } catch (err) {
      DEBUG && console.log('[BACKGROUND SYNC] Error:', err.message);
    }
  }, 30 * 60 * 1000); // 30 minutes
  
  DEBUG && console.log('[BACKGROUND SYNC] Background sync started (30min interval)');
}

module.exports = {
  handleFetch,
  handleFetchAsset,
  handleClear,
  handleClearAll,
  listCssFiles,
  listJsFiles,
  cleanOldCache,
  setOnlineStatus,
  preloadFrequentPages,
  startBackgroundSync
};
