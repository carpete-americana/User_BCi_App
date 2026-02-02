// Auto-updater configuration and handlers
const { autoUpdater } = require('electron-updater');
const { BrowserWindow, ipcMain } = require('electron');
const { DEBUG } = require('./config');
const log = require('electron-log');

// Configure auto-updater with better error handling
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.allowPrerelease = true; // Allow prerelease versions
autoUpdater.allowDowngrade = false;
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'debug';

// Disable signature verification for development (enable in production with code signing)
autoUpdater.disableWebInstaller = false;

// Configure GitHub feed (works in dev mode)
try {
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'carpete-americana',
    repo: 'User_BCi_App',
    private: false,
    token: process.env.GH_TOKEN || undefined
  });
  if (DEBUG) {
    console.log('[UPDATER] GitHub feed configured: carpete-americana/User_BCi_App');
  }
} catch (e) {
  if (DEBUG) console.error('[UPDATER] Error setting feed URL:', e.message);
}

// Event handlers
autoUpdater.on('checking-for-update', () => {
  if (DEBUG) {
    console.log('[UPDATER] ✓ Checking for update...');
    console.log('[UPDATER] Repository:', autoUpdater.app?.name, autoUpdater.currentVersion);
  }
});

autoUpdater.on('update-available', (info) => {
  if (DEBUG) {
    console.log('');
    console.log('╔════════════════════════════════════════╗');
    console.log('║      🎉 UPDATE DISPONÍVEL!             ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('[UPDATER] Nova versão detectada:', info.version);
    console.log('[UPDATER] Versão atual:', autoUpdater.currentVersion);
    console.log('[UPDATER] Release date:', info.releaseDate);
    console.log('');
  }
  const wins = BrowserWindow.getAllWindows();
  wins.forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send('update-available', { version: info.version });
    }
  });
});

autoUpdater.on('update-not-available', (info) => {
  if (DEBUG) {
    console.log('[UPDATER] ✓ App já está atualizada. Versão:', info.version);
  }
});

autoUpdater.on('error', (err) => {
  if (DEBUG) {
    console.error('[UPDATER] ❌ Erro ao verificar updates:', err.message);
  }
  log.error('[UPDATER] Error:', err);
  const wins = BrowserWindow.getAllWindows();
  wins.forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send('update-error', { message: err.message });
    }
  });
});

autoUpdater.on('download-progress', (progressObj) => {
  const percent = Math.round(progressObj.percent);
  if (DEBUG) {
    console.log(`[UPDATER] ⬇️  Download: ${percent}% (${Math.round(progressObj.transferred / 1024 / 1024)}MB / ${Math.round(progressObj.total / 1024 / 1024)}MB)`);
  }
  const wins = BrowserWindow.getAllWindows();
  wins.forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send('download-progress', {
        percent: percent,
        transferred: progressObj.transferred,
        total: progressObj.total
      });
    }
  });
});

autoUpdater.on('update-downloaded', (info) => {
  if (DEBUG) {
    console.log('');
    console.log('╔════════════════════════════════════════╗');
    console.log('║      ✅ UPDATE PRONTO!                 ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('[UPDATER] Update downloaded:', info.version);
    console.log('[UPDATER] Pronto para instalar e reiniciar');
    console.log('');
  }
  const wins = BrowserWindow.getAllWindows();
  wins.forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send('update-downloaded', { version: info.version });
    }
  });
});

// IPC handlers
function setupUpdateHandlers() {
  ipcMain.on('download-update', () => {
    if (DEBUG) console.log('[UPDATER] Starting update download');
    try {
      autoUpdater.downloadUpdate().catch(err => {
        if (DEBUG) console.error('[UPDATER] Download failed:', err);
      });
    } catch (e) {
      if (DEBUG) console.error('[UPDATER] Download error:', e);
    }
  });

  ipcMain.on('install-and-update', () => {
    if (DEBUG) console.log('[UPDATER] Installing update and restarting app');
    try {
      // Close all windows before installing
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.destroy();
        }
      });
      // Quit and install update
      autoUpdater.quitAndInstall(true, true);
    } catch (e) {
      if (DEBUG) console.error('[UPDATER] Install error:', e);
    }
  });
}

// Check for updates (delayed start to avoid startup impact)
function checkForUpdates() {
  const checkInterval = DEBUG ? 30 * 1000 : 10 * 60 * 1000; // 30s em dev, 10min em prod
  
  const performCheck = async () => {
    try {
      if (DEBUG) {
        console.log('');
        console.log('[UPDATER] ⏳ Iniciando verificação de updates...');
        console.log('[UPDATER] Versão local:', autoUpdater.currentVersion?.version || '?');
        console.log('[UPDATER] GitHub: carpete-americana/User_BCi_App');
      }
      const result = await autoUpdater.checkForUpdates();
      if (DEBUG && result?.updateInfo) {
        console.log('[UPDATER] ✓ Verificação concluída');
        console.log('[UPDATER] Versão no GitHub:', result.updateInfo.version);
        console.log('[UPDATER] É uma atualização:', result.updateInfo.version > autoUpdater.currentVersion?.version);
      }
      return result;
    } catch (e) {
      if (DEBUG) console.error('[UPDATER] Check failed:', e.message);
      log.error('[UPDATER] Check failed:', e);
    }
  };
  
  // Initial check (delayed)
  setTimeout(performCheck, 5 * 1000); // 5 seconds after startup
  
  // Periodic checks in DEBUG mode
  setInterval(performCheck, checkInterval);
}

module.exports = {
  setupUpdateHandlers,
  checkForUpdates,
  simulateUpdateAvailable
};

// Testing helper - simulates update available (DEV ONLY)
function simulateUpdateAvailable() {
  if (DEBUG) {
    console.log('');
    console.log('[UPDATER] 🧪 Simulando update disponível...');
  }
  const wins = BrowserWindow.getAllWindows();
  wins.forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send('update-available', { version: '2.0.9-test' });
    }
  });
}
