/**
 * Inline, pre-paint theme resolution (DESIGN-v2 §2.1).
 * localStorage['vx-theme'] = 'light' | 'dark' | 'system'. No stored value means LIGHT, even on a dark OS.
 * prefers-color-scheme is consulted only when the stored value is 'system', and then tracked live.
 * Every storage access is wrapped; any failure falls back to light.
 */
export const THEME_BOOT_SCRIPT = `(function(){var d=document.documentElement;function pref(){try{var v=localStorage.getItem('vx-theme');return v==='dark'||v==='system'?v:'light'}catch(e){return 'light'}}function apply(){var p=pref(),t='light';try{if(p==='dark')t='dark';else if(p==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)t='dark'}catch(e){}d.dataset.vxTheme=t}apply();try{window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',function(){if(pref()==='system'){apply();window.dispatchEvent(new CustomEvent('vx-theme',{detail:'system'}))}})}catch(e){}})();`;
