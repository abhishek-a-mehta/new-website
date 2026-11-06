/*
 * Applies the saved colour theme before first paint so there is no flash.
 * Dark is the default; the toggle in the header stores "light" or "dark".
 * Loaded synchronously in <head> (external file, CSP-compliant).
 */
(function () {
  'use strict';
  var root = document.documentElement;
  var theme = 'dark';
  try {
    var saved = window.localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') {
      theme = saved;
    }
  } catch (e) {
    /* Storage unavailable (e.g. privacy mode) — keep the default. */
  }
  root.setAttribute('data-theme', theme);
  root.classList.add('js');
})();
