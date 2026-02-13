// Auth Check - Protezione pagine del sito
(function() {
    const STORAGE_KEY = 'panoramica_auth';
    
    // Controlla se l'utente è autenticato
    if (sessionStorage.getItem(STORAGE_KEY) !== 'true') {
        // Non autenticato, reindirizza alla home
        window.location.href = 'index.html';
    }
})();
