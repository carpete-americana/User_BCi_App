const { BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const ElectronStorage = require('../../js/storage');
const { DEBUG } = require('./config');

function loadWindowState() {
  const state = ElectronStorage.getItem('window-state');
  DEBUG && console.log('[WINDOW] Loading window state:', state);
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

function createWindow() {
  const state = loadWindowState();
  
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

  // A janela não navega para fora: noutra origem, o preload ficava com o token.
  // file:// é a própria shell a mudar de página (validado em handleNavigate).
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
    // Nenhuma janela nova com preload: links externos abrem no browser do sistema.
    if (/^https:\/\/(www\.)?bcibizz\.pt\//.test(url)) {
      shell.openExternal(url).catch(() => {});
    } else {
      DEBUG && console.warn('[SECURITY] window.open bloqueado:', url);
    }
    return { action: 'deny' };
  });

  win.setMenu(null);
  win.loadFile(path.join(__dirname, '../../public/index.html'));
  
  let shown = false;
  const showSafely = () => {
    if (shown) return;
    shown = true;
    if (!win.isDestroyed()) {
      win.maximize();
      win.show();
    }
  };

  win.on('close', (event) => {
    saveWindowState(win);
    
    // No Windows e Linux, fechar esconde para o tray.
    if (process.platform !== 'darwin') {
      event.preventDefault();
      win.hide();
      DEBUG && console.log('[WINDOW] Window hidden to tray');
    }
  });

  ipcMain.once('renderer:ready', () => {
    showSafely();
  });

  // Se o renderer nunca avisar (arranque offline), mostra a janela na mesma.
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
 * Resolve um caminho do renderer para dentro de public/, ou devolve null.
 * Valida o caminho já resolvido; o separador final exclui pastas irmãs com o mesmo prefixo.
 */
function resolverPaginaLocal(filePath) {
  if (typeof filePath !== 'string' || !filePath) return null;

  const base = path.resolve(__dirname, '../../public');
  const alvo = path.resolve(base, filePath.replace(/^[/\\]+/, ''));

  if (alvo !== base && !alvo.startsWith(base + path.sep)) {
    DEBUG && console.warn('[NAVIGATE] Caminho fora de public/, recusado:', filePath);
    return null;
  }

  // Só HTML.
  if (path.extname(alvo).toLowerCase() !== '.html') {
    DEBUG && console.warn('[NAVIGATE] Extensão não permitida, recusado:', filePath);
    return null;
  }

  return alvo;
}

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

function handleLogout(event) {
  DEBUG && console.log('[LOGOUT] Clearing session and returning to login');
  ElectronStorage.removeItem('token');
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
