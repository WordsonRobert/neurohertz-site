/** theme.js — Light/dark switching, remembered per viewer, announced to the canvases. */
export function initTheme(onChange) {
  const root = document.documentElement;
  const btn = document.getElementById('theme-toggle');
  const meta = document.querySelector('meta[name="theme-color"]');
  const mq = matchMedia('(prefers-color-scheme: light)');
  const current = () => root.dataset.theme || (mq.matches ? 'light' : 'dark');

  const sync = () => {
    const t = current();
    btn?.setAttribute('aria-label', t === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
    meta?.setAttribute('content', t === 'light' ? '#f5f4fa' : '#07070d');
  };

  btn?.addEventListener('click', () => {
    const next = current() === 'light' ? 'dark' : 'light';
    root.dataset.theme = next;
    try { localStorage.setItem('nh-theme', next); } catch { /* storage may be unavailable */ }
    sync();
    onChange?.(next);
  });
  mq.addEventListener('change', () => { if (!root.dataset.theme) { sync(); onChange?.(current()); } });
  sync();
  return { current };
}
