// Extraído de index.html: estava num bloco <script> inline,
// que obriga o CSP a manter script-src 'unsafe-inline'.


try {
    var savedTheme = localStorage.getItem('bci_theme');
    if (savedTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
} catch (e) { /* localStorage indisponível */ }
