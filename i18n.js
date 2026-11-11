/* aura_all — French / English.
 * Language: ?lang=fr|en in the URL, else the last choice (FR/EN switch on the home screen), else the phone language
 * (French if it starts with "fr", English otherwise).
 * Markup keeps the French text; English goes in attributes:
 *   data-en="…"              replaces textContent
 *   data-en-html="…"         replaces innerHTML (text with links)
 *   data-en-placeholder="…"  data-en-aria="…"  data-en-title="…"
 * In JavaScript: tr('texte français', 'English text'). */
(function () {
  'use strict';
  var KEY = 'aura_all.lang';
  var query = new URLSearchParams(location.search).get('lang');
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  if (query === 'fr' || query === 'en') { try { localStorage.setItem(KEY, query); } catch (e) {} }
  var nav = ((navigator.languages && navigator.languages[0]) || navigator.language || '').toLowerCase();
  var lang = (query === 'fr' || query === 'en') ? query
    : (saved === 'fr' || saved === 'en') ? saved
    : (nav.indexOf('fr') === 0 ? 'fr' : 'en');

  window.LANG = lang;
  window.tr = function (fr, en) { return lang === 'fr' ? fr : en; };
  document.documentElement.lang = lang;

  function apply(root) {
    if (lang === 'fr') return;
    root.querySelectorAll('[data-en]').forEach(function (el) { el.textContent = el.getAttribute('data-en'); });
    root.querySelectorAll('[data-en-html]').forEach(function (el) { el.innerHTML = el.getAttribute('data-en-html'); });
    root.querySelectorAll('[data-en-placeholder]').forEach(function (el) { el.placeholder = el.getAttribute('data-en-placeholder'); });
    root.querySelectorAll('[data-en-aria]').forEach(function (el) { el.setAttribute('aria-label', el.getAttribute('data-en-aria')); });
    root.querySelectorAll('[data-en-title]').forEach(function (el) { el.title = el.getAttribute('data-en-title'); });
    var t = document.querySelector('title[data-en]');
    if (t) document.title = t.getAttribute('data-en');
  }
  window.applyLang = apply;

  // Change language and reload (the Bluetooth link reconnects by itself).
  window.setLang = function (value) {
    var stored = false;
    try { localStorage.setItem(KEY, value); stored = localStorage.getItem(KEY) === value; } catch (e) {}
    var params = new URLSearchParams(location.search);
    // Saved choice when storage works; otherwise keep the language in the URL (?lang=).
    if (stored) params.delete('lang'); else params.set('lang', value);
    var search = params.toString();
    // replaceState + reload: location.replace() to a URL that differs only by its #hash
    // (e.g. ".../#" after coming back home) does not reload the page.
    try { history.replaceState(null, '', location.pathname + (search ? '?' + search : '') + location.hash); } catch (e) {}
    location.reload();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { apply(document); });
  else apply(document);
})();
