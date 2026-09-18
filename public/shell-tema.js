// Aplica o tema guardado antes do primeiro paint.


try {
    var savedTheme = localStorage.getItem('bci_theme');
    if (savedTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
} catch (e) { /* localStorage indisponível */ }
