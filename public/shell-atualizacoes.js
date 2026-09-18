
let DEBUG = false;

(async () => {
  try {
    DEBUG = await window.electronAPI.getDebugMode();
  } catch (e) {
    console.warn('Could not load DEBUG mode');
  }
})();

window.electronAPI.onUpdateAvailable((data) => {
  DEBUG && console.log('[UPDATE] Update available:', data);
  const badge = document.getElementById('update-badge');
  badge.style.display = 'block';
  setTimeout(() => {
    badge.classList.add('show');
  }, 100);
});

document.getElementById('download-update').addEventListener('click', () => {
  DEBUG && console.log('[UPDATE] Starting download');
  document.getElementById('download-progress-container').style.display = 'block';
  
  document.getElementById('download-update').style.display = 'none';
  
  window.electronAPI.downloadUpdate();
});

window.electronAPI.onDownloadProgress((progress) => {
  const percent = Math.round(progress.percent);
  DEBUG && console.log('[UPDATE] Download progress:', percent + '%');
  document.getElementById('download-progress-bar').style.width = `${percent}%`;
  document.getElementById('progress-text').innerText = `${percent}%`;
});

let currentUpdateInfo = null;

window.electronAPI.onUpdateDownloaded((info) => {
  DEBUG && console.log('[UPDATE] Update downloaded:', info);
  currentUpdateInfo = info;
  document.getElementById('download-progress-bar').style.width = '100%';
  document.getElementById('progress-text').innerText = '100%';
  document.getElementById('progress-info-text').innerText = 'Atualização pronta!';
  
  setTimeout(() => {
    const restartBtn = document.getElementById('restart-button');
    restartBtn.style.display = 'flex';
    setTimeout(() => {
      restartBtn.style.opacity = '1';
    }, 50);
  }, 1000);
});

window.electronAPI.onUpdateError((error) => {
  DEBUG && console.error('[UPDATE] Error:', error);
  document.getElementById('progress-info-text').innerText = 'Erro ao atualizar: ' + error.message;
  document.getElementById('download-progress-container').style.display = 'block';
});

(async () => {
  try {
    const version = await window.electronAPI.getVersion();
    const badge = document.getElementById('appVersionBadge');
    if (badge && version) badge.textContent = `v${version}`;
  } catch (e) {
    console.warn('Could not load app version');
  }
})();

document.getElementById('restart-button').addEventListener('click', () => {
  const btn = document.getElementById('restart-button');
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  DEBUG && console.log('[UPDATE] Installing update and restarting');
  
  setTimeout(() => {
    if (currentUpdateInfo && currentUpdateInfo.installerPath) {
      window.electronAPI.installAndUpdate(currentUpdateInfo.installerPath);
    } else {
      console.error('[UPDATE] Installer path not available');
      window.electronAPI.installAndUpdate();
    }
  }, 1500);
});
