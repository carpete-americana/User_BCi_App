// Extraído de index.html: estava num bloco <script> inline,
// que obriga o CSP a manter script-src 'unsafe-inline'.


let DEBUG = false;

// Load DEBUG mode from main process
(async () => {
  try {
    DEBUG = await window.electronAPI.getDebugMode();
  } catch (e) {
    console.warn('Could not load DEBUG mode');
  }
})();

// Mostrar o badge com animação quando houver atualização
window.electronAPI.onUpdateAvailable((data) => {
  DEBUG && console.log('[UPDATE] Update available:', data);
  const badge = document.getElementById('update-badge');
  badge.style.display = 'block';
  setTimeout(() => {
    badge.classList.add('show');
  }, 100);
});

// Baixar quando clicar
document.getElementById('download-update').addEventListener('click', () => {
  DEBUG && console.log('[UPDATE] Starting download');
  // Mostrar o container de progresso
  document.getElementById('download-progress-container').style.display = 'block';
  
  // Esconder o botão de download enquanto baixa
  document.getElementById('download-update').style.display = 'none';
  
  // Iniciar o download
  window.electronAPI.downloadUpdate();
});

// Monitorar progresso
window.electronAPI.onDownloadProgress((progress) => {
  const percent = Math.round(progress.percent);
  DEBUG && console.log('[UPDATE] Download progress:', percent + '%');
  document.getElementById('download-progress-bar').style.width = `${percent}%`;
  document.getElementById('progress-text').innerText = `${percent}%`;
});

// Armazenar info do update para usar depois
let currentUpdateInfo = null;

// Quando o download estiver completo
window.electronAPI.onUpdateDownloaded((info) => {
  DEBUG && console.log('[UPDATE] Update downloaded:', info);
  currentUpdateInfo = info; // Guardar para usar no click
  document.getElementById('download-progress-bar').style.width = '100%';
  document.getElementById('progress-text').innerText = '100%';
  document.getElementById('progress-info-text').innerText = 'Atualização pronta!';
  
  // Mostrar botão de reiniciar com animação
  setTimeout(() => {
    const restartBtn = document.getElementById('restart-button');
    restartBtn.style.display = 'flex';
    setTimeout(() => {
      restartBtn.style.opacity = '1';
    }, 50);
  }, 1000);
});

// Tratar erros de update
window.electronAPI.onUpdateError((error) => {
  DEBUG && console.error('[UPDATE] Error:', error);
  document.getElementById('progress-info-text').innerText = 'Erro ao atualizar: ' + error.message;
  document.getElementById('download-progress-container').style.display = 'block';
});

// Mostrar a versão da app discretamente no canto da sidebar
(async () => {
  try {
    const version = await window.electronAPI.getVersion();
    const badge = document.getElementById('appVersionBadge');
    if (badge && version) badge.textContent = `v${version}`;
  } catch (e) {
    console.warn('Could not load app version');
  }
})();

// Reiniciar aplicação quando clicar
document.getElementById('restart-button').addEventListener('click', () => {
  const btn = document.getElementById('restart-button');
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  DEBUG && console.log('[UPDATE] Installing update and restarting');
  
  // Chamar método correto para instalar e atualizar com o caminho do instalador
  setTimeout(() => {
    if (currentUpdateInfo && currentUpdateInfo.installerPath) {
      window.electronAPI.installAndUpdate(currentUpdateInfo.installerPath);
    } else {
      console.error('[UPDATE] Installer path not available');
      window.electronAPI.installAndUpdate(); // Fallback sem path
    }
  }, 1500);
});
