/* ==========================================================================
   Тема оформления: светлая / тёмная / как в системе.

   Значение хранится в localStorage и проставляется атрибутом data-theme
   на <html>. Первичная простановка делается встроенным скриптом в <head>
   каждой страницы — до первой отрисовки, иначе на долю секунды мелькает
   светлый фон в тёмной теме.

   Графики читают цвета через CSS-переменные в inline-style (fill: var(--…)),
   поэтому при смене темы перерисовывать SVG не нужно — браузер пересчитает
   значения сам.
   ========================================================================== */

const STORAGE_KEY = 'dashboard.theme';
const MODES = ['light', 'dark', 'system'];

const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set();

export function getMode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (MODES.includes(saved)) return saved;
  } catch { /* приватный режим */ }
  return 'system';
}

/** Во что реально разворачивается режим прямо сейчас: 'light' | 'dark'. */
export function getResolved() {
  const mode = getMode();
  if (mode === 'system') return media.matches ? 'dark' : 'light';
  return mode;
}

export function setMode(mode) {
  if (!MODES.includes(mode)) return;
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* не критично */ }
  apply();
}

function apply() {
  const resolved = getResolved();
  document.documentElement.dataset.theme = resolved;

  // Цвет системной панели браузера на мобильных
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.content = resolved === 'dark' ? '#0d0d0d' : '#f9f9f7';
  }

  listeners.forEach((fn) => fn(resolved, getMode()));
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Связывает группу кнопок [data-theme-mode] с текущим состоянием. */
export function bindThemeControls(container) {
  const buttons = container.querySelectorAll('[data-theme-mode]');

  const sync = () => {
    const mode = getMode();
    buttons.forEach((btn) => {
      btn.setAttribute('aria-checked', String(btn.dataset.themeMode === mode));
    });
  };

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      setMode(btn.dataset.themeMode);
      sync();
    });
  });

  onThemeChange(sync);
  sync();
}

export function initTheme() {
  apply();
  // Системная тема может смениться на лету — реагируем, только если выбран 'system'
  media.addEventListener('change', () => {
    if (getMode() === 'system') apply();
  });
}
