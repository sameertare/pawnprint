/** Registers the service worker (offline support) — safe to call from every page's entry module. */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const base = import.meta.env.BASE_URL;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
      // offline support just won't be available — not worth surfacing to the user
    });
  });
}
