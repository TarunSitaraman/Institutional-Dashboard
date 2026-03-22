/* ════════════════════════════════════════════════════
   THEME MANAGEMENT
════════════════════════════════════════════════════ */
function setTheme(theme) {
  var html = document.documentElement;
  html.className = theme;
  localStorage.setItem('sn-theme', theme);
  document.getElementById('lightBtn').classList.toggle('active', theme === 'light');
  document.getElementById('darkBtn').classList.toggle('active', theme === 'dark');
}

// Apply saved theme on load
(function () {
  var saved = localStorage.getItem('sn-theme') || 'light';
  setTheme(saved);
})();
