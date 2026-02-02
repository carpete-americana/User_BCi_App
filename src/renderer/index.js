// Main renderer process - loads pages and manages UI
import { showLoading, hideLoading, showErrorPage } from './utils/ui.js';
import { showOfflineBanner, hideOfflineBanner } from './utils/network.js';
import { fetchWithCache, DEFAULT_TTL } from './utils/cache.js';

let Utils = null;
let DEBUG = false; // Will be set from main process via IPC
let routes = {};
export let currentPage = null;

// Load DEBUG mode from main process
(async () => {
  try {
    DEBUG = await window.electronAPI.getDebugMode();
  } catch (e) {
    console.warn('Could not load DEBUG mode from main:', e.message);
  }
})();


/* CSS injection: injects <style data-page-css> with cached content */
async function injectCSSFromRoute(route) {
  const cssPath = `${route}/styles.css`;
  try {
    const res = await fetchWithCache(cssPath);
    // remove existing
    document.querySelectorAll('[data-page-css]').forEach(n => n.remove());
    const style = document.createElement('style');
    style.setAttribute('data-page-css', route);
    style.textContent = res.content || '';
    document.head.appendChild(style);
  } catch (err) {
    console.warn('CSS load failed', err);
  }
}

/* Load all global asset CSS files from assets/css/ in the github repo */
async function loadAllAssetsCSS() {
  try {
    let list = null;
    if (window.electronAPI && typeof window.electronAPI.listAssetsCss === 'function') {
      try {
        list = await window.electronAPI.listAssetsCss();
      } catch (e) {
        console.warn('[loadAllAssetsCSS] listAssetsCss failed:', e.message);
      }
    }

    if (!list || !Array.isArray(list) || list.length === 0) {
      return;
    }

    const stylesToInsert = [];
    for (const filename of list) {
      if (!filename || typeof filename !== 'string') continue;
      const path = `assets/css/${filename}`;
      try {
        // skip if already injected
        if (document.querySelector(`style[data-asset-css="${path}"]`)) {
          DEBUG && console.log(`[loadAllAssetsCSS] already injected ${path}`);
          continue;
        }
        const r = await window.githubCache.fetchAsset(path, DEFAULT_TTL);
        if (r && r.content) {
          const style = document.createElement('style');
          style.setAttribute('data-asset-css', path);
          style.textContent = r.content;
          stylesToInsert.push(style);
        } else {
          console.warn(`[loadAllAssetsCSS] empty content for ${path}`);
        }
      } catch (err) {
        console.warn(`[loadAllAssetsCSS] failed to load ${path}:`, err.message);
      }
    }
    
    if (stylesToInsert.length > 0) {
      const frag = document.createDocumentFragment();
      stylesToInsert.forEach(s => frag.appendChild(s));
      document.head.insertBefore(frag, document.head.firstChild);
    }
  } catch (err) {
    console.error('[loadAllAssetsCSS] error:', err);
  }
}

/* Load all global asset JS files from assets/js/ with guaranteed order (utils.js, api.js first) */
async function loadAllAssetsJS() {
  try {
    let names = [];
    if (window.electronAPI && typeof window.electronAPI.listAssetsJs === 'function') {
      try {
        names = await window.electronAPI.listAssetsJs();
      } catch (e) {
        console.warn('[loadAllAssetsJS] listAssetsJs failed:', e.message);
      }
    }
    if (!Array.isArray(names) || names.length === 0) return;

    // Ensure critical modules load first (utils, api)
    const critical = ['utils.js', 'api.js'];
    const ordered = [...critical.filter(c => names.includes(c)), ...names.filter(n => !critical.includes(n))];

    for (const name of ordered) {
      const path = `assets/js/${name}`;
      try {
        const res = await window.githubCache.fetchAsset(path, DEFAULT_TTL);
        if (!res || !res.content) {
          console.warn('[loadAllAssetsJS] empty content for', path);
          continue;
        }
        const blob = new Blob([res.content], { type: 'text/javascript' });
        const url = URL.createObjectURL(blob);
        try {
          const mod = await import(/* @vite-ignore */ url);
          if (name.toLowerCase() === 'utils.js') {
            Utils = mod.default || mod.Utils || mod;
            window.Utils = Utils;
          } else if (name.toLowerCase() === 'api.js') {
            const API = mod.default || mod.API || mod;
            window.API = API;
          }
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch (err) {
        console.warn('[loadAllAssetsJS] failed to load', path, err.message);
      }
    }
  } catch (err) {
    console.error('[loadAllAssetsJS] error:', err);
  }
}

/* Execute page script: import from blob so modules work */
async function executePageScript(route) {
  const jsPath = `${route}/index.js`;
  try {
    const res = await fetchWithCache(jsPath);
    const content = res.content || '';
    if (!content.trim()) return;
    const blob = new Blob([content], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      const mod = await import(/* @vite-ignore */ url);
      if (mod && typeof mod.init === 'function') {
        await mod.init();
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    console.warn('Page script error', err);
  }
}

/* Load HTML, CSS, JS for a route */
export async function loadPage(route) {
  if (!route) route = 'dashboard';
  if (route === currentPage) return;
  if (!routes[route]) route = 'dashboard';
  currentPage = route;
  
  const pageLoadStart = Date.now();
  
  try {
    showLoading();
    const htmlRes = await fetchWithCache(`${route}/index.html`);
    const html = htmlRes.content;
    if (!html) throw new Error('HTML vazio');
    // inject HTML
    document.getElementById('main-content').innerHTML = html;
    const meta = routes[route] || {};
    document.title = `${meta.title || route} | BCi`;
    // CSS and JS
    await injectCSSFromRoute(route);
    await executePageScript(route);
    updateActiveMenu(route);
    window.history.pushState({}, '', `#${route}`);
    
    // Track page load performance
    if (window.electronAPI && window.electronAPI.trackPageLoad) {
      window.electronAPI.trackPageLoad(route, pageLoadStart);
    }
  } catch (err) {
    console.error('loadPage error', err);
    showErrorPage(err, route);
  } finally {
    await hideLoading();
  }
}

/* Menu generation */
function generateSidebarMenu() {
  const menu = document.getElementById('sidebar-menu');
  if (!menu) return;
  const items = [
    { category: 'Menu' },
    { route: 'dashboard', name: routes.dashboard?.title || 'Dashboard', icon: 'fa-chart-bar' },
    { route: 'rules', name: routes.rules?.title || 'Regras', icon: 'fa-scroll' },
    { route: 'casinoaccounts', name: routes.casinoaccounts?.title || 'Contas Casinos', icon: 'fa-dice' },
    { category: 'Ações' },
    { route: 'withdraw', name: routes.withdraw?.title || 'Levantamento', icon: 'fa-money-bill-wave' },
  ];
  let out = '<ul>';
  for (const it of items) {
    if (it.category) out += `<li><span class="category">${it.category}</span></li>`;
    else {
      const isActive = window.location.hash.substring(1) === it.route || (!window.location.hash && it.route === 'dashboard');
      out += `<li><a href="#${it.route}" class="${isActive ? 'active' : ''}" data-route="${it.route}"><i class="menu-icon fas ${it.icon}"></i> ${it.name}</a></li>`;
    }
  }
  out += '</ul>';
  menu.innerHTML = out;
  menu.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', (e) => {
      const r = a.getAttribute('data-route');
      if (r) {
        e.preventDefault();
        navigateTo(r);
      }
    });
  });
}

/* Update active menu */
function updateActiveMenu(route) {
  document.querySelectorAll('#sidebar-menu a').forEach(link => {
    link.classList.toggle('active', link.getAttribute('data-route') === route);
  });
}

/* navigateTo */
window.navigateTo = async (route) => {
  await hideLoading();
  
  // Track navigation feature usage
  if (window.electronAPI && window.electronAPI.trackFeature) {
    window.electronAPI.trackFeature(`navigate-${route}`);
  }
  
  loadPage(route);
};

/* Birthday check */
async function isItBirthday() {
  try {
    const user_response = await API.getUserData();
    const profile_response = await API.getProfileByPhone(user_response.result.data.phone);
    const birthdate = profile_response.result.birth_date;
    if (!birthdate) return false;
    const [y,m,d] = birthdate.split('-').map(Number);
    const b = new Date(y, m-1, d);
    const t = new Date();
    const isBirthday = b.getDate() === t.getDate() && b.getMonth() === t.getMonth();
    if (isBirthday) window.showNotification('congrats','Parabéns!','Parabéns! A equipa BCI deseja-te um dia maravilhoso.');
    return isBirthday;
  } catch (err) {
    console.error('isItBirthday', err);
    return false;
  }
}

/* Init */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Check version and clear cache if major update (1.x -> 2.x)
    const currentVersion = await window.electronAPI.getVersion();
    const lastVersion = await window.electronStorage.getItem('app-version');
    
    if (lastVersion && lastVersion.startsWith('1.')) {
      DEBUG && console.log('[VERSION] Major update detected, clearing all caches');
      // Clear GitHub cache
      await window.githubCache.clearAll();
      // Clear browser cache
      if (window.electronAPI && window.electronAPI.clearBrowserCache) {
        await window.electronAPI.clearBrowserCache();
      }
      // Store new version
      await window.electronStorage.setItem('app-version', currentVersion);
      DEBUG && console.log('[VERSION] Cache cleared, reloading...');
      // Reload to get fresh content
      window.location.reload();
      return;
    }
    
    // Store version if not set
    if (!lastVersion) {
      await window.electronStorage.setItem('app-version', currentVersion);
    }
    
    // Network status banner handlers
    window.addEventListener('offline', () => {
      if (document.getElementById('offline-start-flag')) return;
      showOfflineBanner();
      
      // Notify main process
      if (window.electronAPI && window.electronAPI.trackFeature) {
        window.electronAPI.trackFeature('network-offline');
      }
    });
    
    window.addEventListener('online', () => {
      hideOfflineBanner();
      
      // Notify main process
      if (window.electronAPI && window.electronAPI.trackFeature) {
        window.electronAPI.trackFeature('network-online');
      }
    });

    // If we started offline, navigate to standalone offline page
    if (!navigator.onLine) {
      hideOfflineBanner();
      try {
        window.location.replace('offline.html');
      } catch (e) {
        window.location.href = 'offline.html';
      }
      return;
    }

    showLoading();

    // Load global JS assets first (utils/api)
    await loadAllAssetsJS().catch(e => console.warn('loadAllAssetsJS failed', e));

    const session = await Utils.findSession(false);
    if (!session) {
      // No session: load login page from GitHub repo
      try {
        showLoading();
        const htmlRes = await fetchWithCache('login/index.html');
        const html = htmlRes.content;
        if (!html) throw new Error('Login HTML vazio');

        // Remove app chrome
        try {
          const chromeSelectors = ['.sidebar', '.main-header', '#update-badge', '.profile-card', '#sidebar-menu'];
          chromeSelectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(n => n.remove());
          });
        } catch (e) {
          DEBUG && console.warn('Could not remove chrome elements:', e.message);
        }

        // Load CSS FIRST to prevent FOUC
        await injectCSSFromRoute('login');
        
        // Then inject HTML
        document.body.innerHTML = html;
        document.title = 'Login | BCi';
        
        // Execute page script
        await executePageScript('login');
        
        // Hide loading and show page
        await hideLoading();
        
        // Make body visible with smooth transition
        requestAnimationFrame(() => {
          document.body.classList.add('ready');
        });

        // Signal renderer ready after everything is loaded and visible
        setTimeout(() => {
          window.electronAPI.rendererReady && window.electronAPI.rendererReady();
        }, 150);
      } catch (err) {
        console.error('Failed to load login page from repo', err);
        await hideLoading();
        showErrorPage(err, 'login');
        document.body.classList.add('ready');
        // Still signal ready even on error so window shows
        window.electronAPI.rendererReady && window.electronAPI.rendererReady();
      }
      return;
    }

    // Authenticated: load global asset CSS
    await loadAllAssetsCSS().catch(e => console.warn('loadAllAssetsCSS failed', e));

    routes = await window.electronAPI.loadRouteConfig();
    generateSidebarMenu();
    
    // Hide content while loading dashboard to prevent flash
    document.body.style.opacity = '0';
    
    const initialRoute = window.location.hash.substring(1) || 'dashboard';
    await loadPage(initialRoute);
    await Utils.notification();
    
    await hideLoading();
    
    // Make body visible with smooth fade-in
    requestAnimationFrame(() => {
      document.body.style.opacity = '1';
      document.body.classList.add('ready');
    });

    // Signal main process that renderer is ready
    if (window.electronAPI && typeof window.electronAPI.rendererReady === 'function') {
      setTimeout(() => {
        window.electronAPI.rendererReady && window.electronAPI.rendererReady();
      }, 150);
    }
    
    setTimeout(isItBirthday, 4000);
    window.addEventListener('popstate', () => {
      const r = window.location.hash.substring(1);
      loadPage(r);
    });
  } catch (err) {
    console.error('renderer init error', err);
    await hideLoading();
    showErrorPage(err, 'dashboard');
    document.body.classList.add('ready');
  }
});
