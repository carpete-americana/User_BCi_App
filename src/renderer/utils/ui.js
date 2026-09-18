export function showLoading() {
  if (document.getElementById('loading-overlay')) return;
  const loadingDiv = document.createElement('div');
  loadingDiv.id = 'loading-overlay';
  loadingDiv.innerHTML = '<div class="loading-wheel"></div><div class="loading-text">A carregar...</div>';
  document.body.appendChild(loadingDiv);
}

export async function hideLoading() {
  const loading = document.getElementById('loading-overlay');
  if (!loading) return;
  setTimeout(() => loading.remove(), 200);
}

export function escapeHtml(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

export function showErrorPage(err, route) {
  const message = escapeHtml(err.message || String(err));
  const html = `
  <div class="error-container">
    <div class="error-card">
      <div class="error-icon"><i class="fas fa-exclamation-circle"></i></div>
      <h2 class="error-title">Oops! Algo deu errado</h2>
      <p class="error-description">${navigator.onLine ? 'Não foi possível carregar a página. Verifica a tua ligação ou tenta novamente.' : 'Sem ligação à internet. Liga-te à internet e tenta novamente.'}</p>
      <div class="error-actions">
        <button id="reloadBtn" class="error-btn error-btn-primary"><i class="fas fa-sync-alt"></i> Recarregar</button>
        <button id="homeBtn" class="error-btn"><i class="fas fa-home"></i> Ir para Início</button>
      </div>
      <div class="error-details">
        <button id="detailsBtn" class="error-details-toggle"><i class="fas fa-info-circle"></i> Detalhes</button>
        <div id="errorDetails" class="error-details-content"><code>${message}</code></div>
      </div>
    </div>
  </div>`;
  document.getElementById('main-content').innerHTML = html;
  const reload = document.getElementById('reloadBtn');
  const home = document.getElementById('homeBtn');
  const details = document.getElementById('detailsBtn');
  if (reload) reload.addEventListener('click', async () => {
    const { loadPage, currentPage } = await import('./index.js');
    loadPage(currentPage || 'dashboard');
  });
  if (home) home.addEventListener('click', async () => {
    const { loadPage } = await import('./index.js');
    loadPage('dashboard');
  });
  if (details) details.addEventListener('click', () => {
    const d = document.getElementById('errorDetails');
    if (!d) return;
    d.classList.toggle('show');
  });
}
