/**
 * Inline, pre-paint theme resolution (UNIFY-SPEC §1.2), inlined in the root layout's <head> so it runs on every
 * route (landing, app, sign-in, OAuth, share, 404) before anything paints.
 *
 * localStorage['vx-theme'] = 'dark' | 'light' | 'system'. No stored value means DARK, even on a light OS, except on
 * the public landing (/ and /pricing), which opens LIGHT; components/landing/landing-theme.tsx keeps that in step
 * across client navigation.
 * prefers-color-scheme is consulted only when the stored value is 'system', and then tracked live.
 * Every storage access is wrapped; any failure falls back to dark.
 *
 * Cross-tab sync lives here (not in a React hook): a `storage` listener re-applies the theme and dispatches the
 * `vx-theme` window event, so every page follows another tab within a frame, with or without React mounted.
 */
const src = function boot() {
  var d = document.documentElement;
  var C: Record<string, string> = { dark: '#0a0a0b', light: '#f4f4f6' };
  function fallback() {
    try {
      return /^\/(pricing\/?)?$/.test(window.location.pathname) ? 'light' : 'dark';
    } catch (e) {
      return 'dark';
    }
  }
  function pref() {
    try {
      var v = localStorage.getItem('vx-theme');
      return v === 'light' || v === 'system' || v === 'dark' ? v : fallback();
    } catch (e) {
      return 'dark';
    }
  }
  function osLight() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
    } catch (e) {
      return false;
    }
  }
  function apply(animate?: boolean) {
    var p = pref();
    var t = p === 'light' || (p === 'system' && osLight()) ? 'light' : 'dark';
    if (animate) d.classList.add('vx-theme-switching');
    d.setAttribute('data-vx-theme', t);
    d.style.colorScheme = t;
    var ms = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < ms.length; i++) ms[i].setAttribute('content', C[t]);
    if (animate)
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          d.classList.remove('vx-theme-switching');
        });
      });
    return p;
  }
  apply();
  // The theme-color meta is parsed after this script: correct it once the head is complete.
  document.addEventListener('DOMContentLoaded', function () {
    apply();
  });
  try {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () {
      if (pref() === 'system') {
        apply(true);
        window.dispatchEvent(new CustomEvent('vx-theme', { detail: 'system' }));
      }
    });
  } catch (e) {}
  window.addEventListener('storage', function (e) {
    if (e.key !== 'vx-theme' && e.key !== null) return;
    var p = apply(true);
    window.dispatchEvent(new CustomEvent('vx-theme', { detail: p }));
  });
};

export const THEME_BOOT_SCRIPT = `(${src.toString()})();`;
