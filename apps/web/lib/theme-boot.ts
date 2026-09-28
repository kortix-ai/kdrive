/** Inline, pre-paint: dark unless localStorage['vx-theme'] === 'light'. Never prefers-color-scheme. */
export const THEME_BOOT_SCRIPT = `try{if(localStorage.getItem('vx-theme')==='light'){document.documentElement.dataset.vxTheme='light'}}catch(e){}`;
