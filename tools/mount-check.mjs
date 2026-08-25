/* ==========================================================================
   Монтаж раздела в headless-DOM.

   Браузера в среде сборки нет, а «синтаксис в порядке» ничего не значит:
   половина ошибок этого дашборда появлялась именно при отрисовке — в момент
   обращения к отсутствующему ключу словаря, к нулевой ширине контейнера или
   к canvas, которого в jsdom нет.

   Проверяется: раздел монтируется, элементы на месте, в тексте нет NaN и
   undefined, переключение фильтров не роняет отрисовку, уборка снимает
   наблюдателей.

   ЗАПУСК
     npm i jsdom            # в этот каталог или в любой, указанный в NODE_PATH
     node tools/mount-check.mjs weekly-sales

   jsdom намеренно не в зависимостях репозитория: на GitHub Pages он не
   нужен, а Actions собирают данные, а не страницу.
   ========================================================================== */

import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = new URL('..', import.meta.url).pathname;

let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch {
  console.error('Нужен jsdom: npm i jsdom (или NODE_PATH на каталог, где он есть)');
  process.exit(2);
}

const route = process.argv[2] || 'weekly-sales';

/* --- Окружение браузера -------------------------------------------------- */

const dom = new JSDOM(
  '<!doctype html><html><body><div id="view"></div><div id="controls"></div></body></html>',
  { url: 'https://example.invalid/app.html#/' + route, pretendToBeVisual: true },
);

const { window } = dom;

// Ширина берётся из вёрстки, а в jsdom вёрстки нет: без подмены все графики
// уходят в ранний возврат «карточка ещё скрыта» и ничего не рисуют.
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get() { return 900; },
});

// canvas в jsdom не реализован, а charts.js меряет им ширину подписей ещё
// на загрузке модуля. Ширина приблизительная — для проверки монтажа хватает.
window.HTMLCanvasElement.prototype.getContext = () => ({
  font: '',
  measureText: (text) => ({ width: String(text).length * 7 }),
});

window.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() { ResizeObserverCalls.disconnected += 1; }
};
const ResizeObserverCalls = { disconnected: 0 };

window.matchMedia = () => ({
  matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
});

// fetch читает файлы репозитория с диска: сеть в проверке не участвует
window.fetch = async (url) => {
  const name = String(url).replace(/^.*\/(?=data\/)/, '').replace(/^\//, '');
  const path = ROOT + name;
  if (!existsSync(path)) return { ok: false, status: 404, json: async () => ({}) };
  const body = readFileSync(path, 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
};

for (const key of ['window', 'document', 'navigator', 'location', 'localStorage',
  'sessionStorage', 'HTMLElement', 'Node', 'Element', 'SVGElement', 'CustomEvent',
  'ResizeObserver', 'matchMedia', 'fetch', 'getComputedStyle', 'requestAnimationFrame']) {
  // defineProperty, а не присваивание: у свежих Node часть глобальных имён
  // (navigator) объявлена только на чтение, и обычное присваивание падает
  Object.defineProperty(globalThis, key, {
    configurable: true, writable: true, value: window[key],
  });
}

/* --- Монтаж -------------------------------------------------------------- */

const problems = [];
const load = (rel) => import(pathToFileURL(ROOT + rel).href);

/* Текст узла с пробелом между соседними элементами.

   textContent склеивает ячейки таблицы вплотную: фраза, кончающаяся на
   «…towards sales.», и следующая ячейка «Reports API» дают в сумме
   «sales.Reports» — ровно форму ключа словаря. Проверка на непереведённые
   ключи ловила это как ошибку раздела, которой нет. */
function visibleText(node) {
  const parts = [];
  const walk = (el) => {
    for (const child of el.childNodes) {
      if (child.nodeType === 3) parts.push(child.nodeValue);
      else walk(child);
    }
  };
  walk(node);
  return parts.join(' ');
}

await load('assets/js/strings-crm.js');
const { setLang, t } = await load('assets/js/i18n.js');

/* Что раздел обязан построить. Проверять графики у текстового раздела
   бессмысленно, а требовать уборку наблюдателей — только у тех, кто их
   заводит: иначе проверка ругается на исправный код. */
const VIEWS = {
  'weekly-sales': {
    path: 'assets/js/views/weekly-sales.js', name: 'weeklySales',
    expect: { charts: true, tiles: true, observers: true },
  },
  'account-check': {
    path: 'assets/js/views/account-check.js', name: 'accountCheck',
    expect: { tiles: true },
  },
  wiki: {
    path: 'assets/js/views/wiki.js', name: 'wiki',
    expect: { selectors: ['.wiki__item', '.prose', '.prose h2'] },
  },
};
const { path: modulePath, name: exportName, expect = {} } = VIEWS[route] || {};
if (!modulePath) {
  console.error(`Не знаю раздел «${route}». Известны: ${Object.keys(VIEWS).join(', ')}`);
  process.exit(2);
}

const view = window.document.getElementById('view');
const controls = window.document.getElementById('controls');
const section = (await load(modulePath))[exportName];

for (const lang of ['ru', 'en', 'uk']) {
  setLang(lang);
  view.replaceChildren();
  controls.replaceChildren();

  const dispose = await section.mount(view, controls);

  const text = `${visibleText(view)} ${visibleText(controls)}`;
  if (!view.children.length) problems.push(`[${lang}] раздел смонтировался пустым`);
  if (/NaN/.test(text)) problems.push(`[${lang}] в тексте есть NaN`);
  if (/undefined/.test(text)) problems.push(`[${lang}] в тексте есть undefined`);
  if (/\bnull\b/.test(text)) problems.push(`[${lang}] в тексте есть null`);

  // Непереведённый ключ отдаётся самим t() как есть — он и виден в тексте
  const raw = text.match(/\b(sales|check|page|nav|settings|int)\.[a-zA-Z.]+\b/g);
  if (raw) problems.push(`[${lang}] непереведённые ключи: ${[...new Set(raw)].join(', ')}`);

  if (lang === 'ru') {
    const svg = view.querySelectorAll('svg').length;
    const tiles = view.querySelectorAll('.stat').length;
    console.log(`  смонтировано: плиток ${tiles}, графиков ${svg}, ` +
                `узлов управления ${controls.querySelectorAll('select, button, input').length}`);
    // Пустая выгрузка — не повод для жалобы: график обязан честно показать
    // «данных нет», и именно это проверяется вместо наличия svg.
    const empties = view.querySelectorAll('.chart-empty').length;
    if (expect.charts && !svg && !empties) {
      problems.push('[ru] график не нарисован и не показал пустое состояние');
    }
    if (expect.charts && !svg && empties) {
      console.log(`  внимание: данных нет, графиков ${empties} в пустом состоянии`);
    }
    if (expect.tiles && !tiles) problems.push('[ru] ни одной плитки не построено');
    for (const selector of expect.selectors || []) {
      const found = view.querySelectorAll(selector).length;
      console.log(`  ${selector}: ${found}`);
      if (!found) problems.push(`[ru] на странице нет ${selector}`);
    }

    /* Переключение фильтров — та часть, что ломается чаще всего: серии
       пересобираются, а недели остаются от прошлого среза. */
    for (const select of controls.querySelectorAll('select')) {
      for (const option of [...select.options].slice(0, 3)) {
        select.value = option.value;
        select.dispatchEvent(new window.Event('change'));
      }
    }
    for (const button of controls.querySelectorAll('.segmented__item')) {
      button.dispatchEvent(new window.Event('click'));
    }
    // Галочки акций выключаем и включаем обратно: отметки на графике
    // пересобираются заново, и именно здесь ломается их привязка к неделям
    for (const box of controls.querySelectorAll('.promo-toggle input')) {
      box.checked = !box.checked;
      box.dispatchEvent(new window.Event('change'));
      box.checked = !box.checked;
      box.dispatchEvent(new window.Event('change'));
    }
    for (const box of controls.querySelectorAll('.picker__row--family input')) {
      box.checked = true;
      box.dispatchEvent(new window.Event('change'));
      break;
    }
    const after = visibleText(view);
    if (/NaN|undefined/.test(after)) problems.push('[ru] после смены фильтров появились NaN/undefined');
    if (!view.children.length) problems.push('[ru] после смены фильтров раздел опустел');
  }

  dispose?.();
}

if (expect.observers && ResizeObserverCalls.disconnected === 0) {
  problems.push('уборка не сняла наблюдателей за размером — при смене разделов они копятся');
}

console.log(problems.length ? '\nПРОБЛЕМЫ:' : '\nПроблем не найдено.');
problems.forEach((p) => console.log('  · ' + p));

// В приложении живёт setInterval, он удержит процесс без явного выхода
process.exit(problems.length ? 1 : 0);
