// Main renderer process - loads pages and manages UI
import { showLoading, hideLoading, showErrorPage } from './utils/ui.js';
import { showOfflineBanner, hideOfflineBanner } from './utils/network.js';
import { fetchWithCache, DEFAULT_TTL } from './utils/cache.js';

let Utils = null;
let DEBUG = false; // Will be set from main process via IPC
let routes = {}; // Carregado da Frontend API via sidebar.js (window.routes)
// Se o perfil do user não estiver aprovado, todas as navegações são forçadas para
// 'setup' (exceto 'settings', sempre permitida). Ver checkSetupGate().
let setupGateRoute = null;
export let currentPage = null;

// ============ GLOBAL ERROR BOUNDARY ============
window.addEventListener('error', (event) => {
  console.error('[GLOBAL ERROR]', event.message, event.filename, event.lineno);
  // Não impede propagação para permitir debugging
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[UNHANDLED REJECTION]', event.reason);
  // Não impede propagação para permitir debugging
});

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
/**
 * Verifica se o perfil do user está aprovado — ver a mesma função em
 * Website/js/index.js para a explicação completa (comportamento espelhado).
 */
async function checkSetupGate() {
  try {
    if (!window.API || typeof window.API.getSetupStatus !== 'function') return;
    const response = await window.API.getSetupStatus();
    if (!response.success) return;
    const data = response.result.data || {};
    // Um user pode ter vários perfis — a app só desbloqueia quando PELO MENOS UM
    // está aprovado; perfis extra pendentes/rejeitados nunca voltam a bloquear.
    setupGateRoute = data.hasApprovedProfile ? null : 'setup';
  } catch (e) {
    DEBUG && console.warn('[Setup Gate] check failed', e);
  }
}

export async function loadPage(route) {
  if (!route) route = 'dashboard';
  if (setupGateRoute && route !== setupGateRoute && route !== 'settings') route = setupGateRoute;
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
    if (window.updateActiveMenu) window.updateActiveMenu(route);
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
// ============================================================================
// SINO DE NOTIFICAÇÕES
// ============================================================================

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function formatNotifTime(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `há ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `há ${days}d`;
  return new Date(dateStr).toLocaleDateString('pt-PT');
}

function notifIconClass(type) {
  return { success: 'fa-check-circle', warning: 'fa-exclamation-triangle', error: 'fa-times-circle' }[type] || 'fa-info-circle';
}

async function refreshNotificationBadge() {
  try {
    const res = await window.API.getMyNotificationsUnreadCount();
    const count = res?.result?.data?.count || 0;
    const badge = document.getElementById('notificationBadge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 9 ? '9+' : String(count);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch (e) { DEBUG && console.warn('[Notifications] badge refresh failed', e); }
}

async function loadNotificationBellList() {
  const list = document.getElementById('notificationBellList');
  if (!list) return;
  list.innerHTML = '<div class="notification-bell-empty">A carregar...</div>';
  try {
    const res = await window.API.getMyNotifications(1, 20);
    const items = res?.result?.data?.notifications || [];
    if (items.length === 0) {
      list.innerHTML = '<div class="notification-bell-empty">Sem notificações</div>';
      return;
    }
    list.innerHTML = items.map(n => `
      <div class="notification-bell-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}" data-link="${n.link || ''}">
        <div class="notification-bell-icon ${n.type || 'info'}"><i class="fas ${notifIconClass(n.type)}"></i></div>
        <div class="notification-bell-body">
          <div class="notification-bell-title">${escapeHtml(n.title)}</div>
          <div class="notification-bell-message">${escapeHtml(n.message)}</div>
          <div class="notification-bell-time">${formatNotifTime(n.created_at)}</div>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('.notification-bell-item').forEach(el => {
      el.addEventListener('click', async () => {
        const id = el.getAttribute('data-id');
        const link = el.getAttribute('data-link');
        if (el.classList.contains('unread')) {
          el.classList.remove('unread');
          try { await window.API.markNotificationRead(id); } catch (e) { /* ignore */ }
          refreshNotificationBadge();
        }
        if (link) {
          document.getElementById('notificationBellDropdown')?.classList.remove('show');
          window.location.hash = link;
        }
      });
    });
  } catch (e) {
    list.innerHTML = '<div class="notification-bell-empty">Erro ao carregar notificações</div>';
  }
}

function initNotificationBell() {
  const bell = document.getElementById('notificationBell');
  const dropdown = document.getElementById('notificationBellDropdown');
  const markAllBtn = document.getElementById('notificationMarkAllBtn');
  if (!bell || !dropdown) return;

  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    const isShowing = dropdown.classList.contains('show');
    document.getElementById('profileCard')?.classList.remove('show');
    if (isShowing) {
      dropdown.classList.remove('show');
    } else {
      dropdown.classList.add('show');
      loadNotificationBellList();
    }
  });

  document.addEventListener('click', (e) => {
    if (dropdown.classList.contains('show') && !dropdown.contains(e.target) && e.target.closest('#notificationBell') === null) {
      dropdown.classList.remove('show');
    }
  });

  markAllBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await window.API.markAllNotificationsRead();
      loadNotificationBellList();
      refreshNotificationBadge();
    } catch (err) { DEBUG && console.warn('[Notifications] mark all read failed', err); }
  });

  refreshNotificationBadge();
  setInterval(refreshNotificationBadge, 60000);
}

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

    // Check if server is available
    if (window.electronAPI && typeof window.electronAPI.checkServerStatus === 'function') {
      try {
        const serverAvailable = await window.electronAPI.checkServerStatus();
        if (!serverAvailable) {
          console.error('[INIT] Server is unavailable');
          hideLoading();
          try {
            window.location.replace('server-unavailable.html');
          } catch (e) {
            window.location.href = 'server-unavailable.html';
          }
          return;
        }
      } catch (e) {
        console.warn('[INIT] Could not check server status:', e.message);
      }
    }

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

    // Sincronizar tema com o servidor (localStorage já aplicou um valor otimista no <head>)
    if (window.API && typeof window.API.getMySettings === 'function') {
      API.getMySettings().then(res => {
        const themeSetting = res?.result?.data?.find?.(s => s.key === 'theme');
        if (themeSetting) {
          const theme = themeSetting.value === 'dark' ? 'dark' : 'light';
          document.documentElement.setAttribute('data-theme', theme);
          try { localStorage.setItem('bci_theme', theme); } catch (e) { /* ignore */ }
        }
      }).catch(e => console.warn('theme sync failed', e));
    }

    // Rotas e menu lateral carregados da Frontend API via sidebar.js (fonte única, partilhada com a Website)
    routes = window.routes || {};
    if (window.generateSidebarMenu) window.generateSidebarMenu();
    initNotificationBell();
    if (window.initSupportChat) window.initSupportChat();

    await checkSetupGate();

    // Hide content while loading dashboard to prevent flash
    document.body.style.opacity = '0';

    const initialRoute = setupGateRoute || (window.location.hash.substring(1) || 'dashboard');
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
