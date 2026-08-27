// Extraído de index.html: estava num bloco <script> inline,
// que obriga o CSP a manter script-src 'unsafe-inline'.


// Controle do Profile Card
document.querySelector('.user-profile').addEventListener('click', function(e) {
    e.stopPropagation();
    const card = document.getElementById('profileCard');
    document.getElementById('notificationBellDropdown')?.classList.remove('show');
    card.classList.toggle('show');
});

// Fechar quando clicar fora
document.addEventListener('click', function(e) {
    const card = document.getElementById('profileCard');
    if (!card.contains(e.target) && e.target.closest('.user-profile') === null) {
        card.classList.remove('show');
    }
});

function logout() {
    window.electronAPI.logout();
}
