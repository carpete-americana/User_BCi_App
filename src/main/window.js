// Window management with state persistence
const { BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const ElectronStorage = require('../../js/storage');
const { DEBUG } = require('./config');

// Window state persistence
function loadWindowState() {
  const state = ElectronStorage.getItem('window-state');
  DEBUG && console.log('[WINDOW] Loading window state:', state);
  // Always default to maximized
  return state || { width: 1200, height: 800, x: undefined, y: undefined, isMaximized: true };
}

function saveWindowState(win) {
  if (win.isDestroyed()) return;
  const bounds = win.getBounds();
  const state = {
    ...bounds,
    isMaximized: win.isMaximized()
  };
  DEBUG && console.log('[WINDOW] Saving window state:', state);
  ElectronStorage.setItem('window-state', state);
}

// Create main window with state persistence
function createWindow() {
  const state = loadWindowState();
  
  // Load app icon
  let icon;
  try {
    const iconPath = path.join(__dirname, '../../assets/icons/icon.png');
    icon = require('electron').nativeImage.createFromPath(iconPath);
  } catch (e) {
    DEBUG && console.warn('[WINDOW] Could not load app icon:', e.message);
  }
  
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 1200,
    minHeight: 800,
    show: false,
    fullscreenable: true,
    icon: icon,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: true,
      webSecurity: true
    },
  });

  // ---------------------------------------------------------------------
  // A JANELA NÃO SAI DAQUI.
  //
  // Sem estas duas guardas, código a correr no renderer faz
  // `location.href = 'https://evil.tld'` e nada o intercepta. O preload é
  // reanexado na página nova, portanto a origem do atacante fica com o bridge
  // inteiro nas mãos — incluindo `electronStorage.getItem('token')`, que
  // devolve o JWT de sessão em claro.
  //
  // A CSP não trava isto: é aplicada por `onHeadersReceived` a TODAS as
  // respostas com `default-src 'self'`, e depois da navegação `'self'` passa a
  // ser o site do atacante.
  //
  // É a peça que faltava a um conjunto que de resto está montado como deve ser
  // (nodeIntegration false, contextIsolation true, webSecurity true, CSP sem
  // 'unsafe-inline' no script-src). O renderer carrega páginas da rede — é o
  // desenho desta app — por isso tem de se assumir que pode ser hostil.
  //
  // `file://` é a própria shell a navegar entre páginas de public/ (ver
  // handleNavigate, que já valida o caminho). Tudo o resto é recusado, e os
  // links externos legítimos abrem no browser do sistema em vez de dentro da
  // app — que é onde um link externo deve abrir de qualquer maneira.
  const ORIGENS_PERMITIDAS = new Set(['https://bcibizz.pt']);

  const destinoPermitido = (url) => {
    if (typeof url !== 'string') return false;
    if (url.startsWith('file://')) return true;
    try { return ORIGENS_PERMITIDAS.has(new URL(url).origin); }
    catch (e) { return false; }
  };

  win.webContents.on('will-navigate', (event, url) => {
    if (destinoPermitido(url)) return;
    DEBUG && console.warn('[SECURITY] Navegação bloqueada:', url);
    event.preventDefault();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    // Nenhuma janela nova com preload. Um link externo legítimo abre no browser
    // do sistema; o resto morre aqui.
    if (/^https:\/\/(www\.)?bcibizz\.pt\//.test(url)) {
      shell.openExternal(url).catch(() => {});
    } else {
      DEBUG && console.warn('[SECURITY] window.open bloqueado:', url);
    }
    return { action: 'deny' };
  });

  win.setMenu(null);
  // Load main shell
  win.loadFile(path.join(__dirname, '../../public/index.html'));
  
  // Show window when renderer signals it's ready
  let shown = false;
  const showSafely = () => {
    if (shown) return;
    shown = true;
    if (!win.isDestroyed()) {
      // Always maximize on startup for better UX
      win.maximize();
      win.show();
    }
  };

  // Save window state on close
  win.on('close', (event) => {
    saveWindowState(win);
    
    // On Windows/Linux, minimize to tray instead of closing
    if (process.platform !== 'darwin') {
      event.preventDefault();
      win.hide();
      DEBUG && console.log('[WINDOW] Window hidden to tray');
    }
  });

  ipcMain.once('renderer:ready', () => {
    showSafely();
  });

  // Fallback: if app starts offline and renderer never sends ready, show anyway after longer delay
  const fallbackTimer = setTimeout(() => {
    showSafely();
  }, 5000);

  win.on('closed', () => clearTimeout(fallbackTimer));
  win.webContents.on('did-fail-load', () => {
    showSafely();
  });
  
  DEBUG && win.openDevTools({ mode: 'detach' });
  
  return win;
}

/**
 * Resolve um caminho vindo do renderer para dentro de `public/`, ou devolve null.
 *
 * O CAMINHO VEM DO RENDERER, E O RENDERER NÃO É DE CONFIANÇA.
 *
 * É a mesma falha que já tinha sido corrigida em `src/main/assets.js` — ler lá
 * o comentário do topo, explica-a por extenso — e que aqui ficou por corrigir.
 * `path.join(__dirname, '../../public', filePath)` resolve os `..`, portanto
 * `navigate('../../../../../../Users/x/Desktop/y.html')` saía da pasta e o
 * `loadFile` carregava o que quisesse COM O PRELOAD ANEXADO, ou seja como
 * página privilegiada, com `electronStorage` (o token) ao alcance.
 *
 * Porque é que isto importa mesmo com a CSP: as páginas desta app são
 * descarregadas da Frontend API em runtime e executadas por `import()` de um
 * blob. Quem controlar esse conteúdo escolhe o ficheiro.
 *
 * A verificação é feita sobre o caminho JÁ RESOLVIDO (`path.resolve`), o único
 * que não se deixa enganar por `..`, por barras invertidas ou por um caminho
 * absoluto vindo do outro lado. O separador no fim evita que uma pasta irmã
 * chamada "public-outra-coisa" passe por estar contida em "public".
 */
function resolverPaginaLocal(filePath) {
  if (typeof filePath !== 'string' || !filePath) return null;

  const base = path.resolve(__dirname, '../../public');
  const alvo = path.resolve(base, filePath.replace(/^[/\\]+/, ''));

  if (alvo !== base && !alvo.startsWith(base + path.sep)) {
    DEBUG && console.warn('[NAVIGATE] Caminho fora de public/, recusado:', filePath);
    return null;
  }

  // Só HTML. Sem isto, um caminho válido dentro da pasta ainda conseguia pedir
  // qualquer outro ficheiro que lá estivesse.
  if (path.extname(alvo).toLowerCase() !== '.html') {
    DEBUG && console.warn('[NAVIGATE] Extensão não permitida, recusado:', filePath);
    return null;
  }

  return alvo;
}

// Navigation handler - hides window when navigating
function handleNavigate(event, filePath) {
  DEBUG && console.log('[NAVIGATE] Navigating to:', filePath);
  const fullPath = resolverPaginaLocal(filePath);
  if (!fullPath) return false;

  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    win.hide();
    DEBUG && console.log('[NAVIGATE] Full path:', fullPath);
    win.loadFile(fullPath);
    let shown = false;
    const showSafely = () => {
      if (shown) return;
      shown = true;
      if (!win.isDestroyed()) win.show();
    };
    const fallbackTimer = setTimeout(showSafely, 3000);
    ipcMain.once('renderer:ready', () => {
      clearTimeout(fallbackTimer);
      showSafely();
    });
    win.webContents.once('did-fail-load', showSafely);
  }
  return true;
}

// Logout handler
function handleLogout(event) {
  DEBUG && console.log('[LOGOUT] Clearing session and returning to login');
  // Clear token from storage
  ElectronStorage.removeItem('token');
  // Navigate to login page
  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    win.hide();
    win.loadFile(path.join(__dirname, '../../public/index.html'));
    let shown = false;
    const showSafely = () => {
      if (shown) return;
      shown = true;
      if (!win.isDestroyed()) win.show();
    };
    const fallbackTimer = setTimeout(showSafely, 3000);
    ipcMain.once('renderer:ready', () => {
      clearTimeout(fallbackTimer);
      showSafely();
    });
    win.webContents.once('did-fail-load', showSafely);
  }
  return true;
}

// Fullscreen toggle
function toggleFullscreen() {
  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    win.setFullScreen(!win.isFullScreen());
  }
}

module.exports = {
  createWindow,
  handleNavigate,
  handleLogout,
  toggleFullscreen
};
