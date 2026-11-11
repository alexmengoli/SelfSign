// Applies a stored explicit theme before Angular boots to avoid a flash of the wrong theme.
try {
  var theme = localStorage.getItem('selfsign.theme');
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.dataset.theme = theme;
  }
} catch (e) {
  // Storage unavailable: keep following the system theme.
}
