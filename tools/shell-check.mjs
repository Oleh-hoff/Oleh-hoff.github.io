/* ==========================================================================
   Проверка оболочки: окно настроек и колокольчик.

   Разделы проверяет mount-check.mjs, но настройки и журнал живут не в
   разделе, а в шапке — и ломаются они отдельно. Здесь проверяется, что
   окно настроек собирается, что смена языка, пояса и темы доезжает до
   хранилища и до подписей, и что в журнале видно последние запуски с их
   статусом и причиной.

     npm i jsdom && node tools/shell-check.mjs
   ========================================================================== */

import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = new URL('..', import.meta.url).pathname;

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch { console.error('Нужен jsdom: npm i jsdom'); process.exit(2); }

const dom = new JSDOM('<!doctype html><body><div id="slot"></div></body>',
  { url: 'https://x.invalid/app.html', pretendToBeVisual: true });
const { window } = dom;

window.matchMedia = () => ({
  matches: false, addEventListener() {}, removeEventListener() {},
});
window.fetch = async (url) => {
  const path = ROOT + String(url).replace(/^.*\/(?=data\/)/, '').replace(/^\//, '');
  if (!existsSync(path)) return { ok: false, status: 404 };
  const body = readFileSync(path, 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
};

// jsdom не реализует модальный режим <dialog> целиком — подменяем открытие
// и закрытие, остальное поведение окна нам здесь не нужно
window.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
window.HTMLDialogElement.prototype.close = function close() { this.open = false; };

for (const k of ['window', 'document', 'navigator', 'location', 'localStorage',
  'sessionStorage', 'HTMLElement', 'Node', 'Element', 'SVGElement', 'Event',
  'matchMedia', 'fetch', 'getComputedStyle', 'Option']) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: window[k] });
}

const load = (rel) => import(pathToFileURL(ROOT + rel).href);
const problems = [];
const check = (ok, message) => { if (!ok) problems.push(message); };

await load('assets/js/strings-crm.js');
const { t, getLang, setLang } = await load('assets/js/i18n.js');
const { initTheme, getMode: themeMode } = await load('assets/js/theme.js');
const { getMode: zoneMode, getResolved: zoneResolved } = await load('assets/js/timezone.js');
const { mountSettings } = await load('assets/js/settings.js');
const { resetFormatters, formatDateTime, formatDayShort } = await load('assets/js/format.js');

/* --- Окно настроек -------------------------------------------------------- */

initTheme();
const slot = window.document.getElementById('slot');
mountSettings(slot);

const dialog = window.document.querySelector('.settings-modal');
check(Boolean(dialog), 'окно настроек не создано');
check(Boolean(window.document.getElementById('settings-button')), 'кнопки настроек нет');

const groups = dialog.querySelectorAll('.settings__group');
check(groups.length === 3, `групп настроек ${groups.length}, ожидали 3 (язык, пояс, тема)`);

const langButtons = [...groups[0].querySelectorAll('.segmented__item')].map((b) => b.textContent);
check(langButtons.join(',') === 'Українська,Русский,English',
  `языки: ${langButtons.join(', ')} — ожидали украинский, русский, английский`);

const zoneSelect = dialog.querySelector('.settings__select');
check(zoneSelect.options.length > 20, `в списке поясов ${zoneSelect.options.length} пунктов`);
check(zoneSelect.options[0].value === 'system', 'первым в списке поясов должен быть системный');

const themeButtons = [...groups[2].querySelectorAll('.segmented__item')];
check(themeButtons.length === 3, 'у темы должно быть три варианта');

console.log(`  окно настроек: групп ${groups.length}, поясов ${zoneSelect.options.length}`);

/* --- Настройки применяются ------------------------------------------------ */

langButtons.length && groups[0].querySelectorAll('.segmented__item')[0].dispatchEvent(new window.Event('click'));
check(getLang() === 'uk', `язык не переключился: ${getLang()}`);
check(t('settings.title') === 'Налаштування', `подпись не переехала: ${t('settings.title')}`);

themeButtons[1].dispatchEvent(new window.Event('click'));
check(themeMode() === 'dark', `тема не переключилась: ${themeMode()}`);
check(window.document.documentElement.dataset.theme === 'dark', 'атрибут темы не проставлен');

const instant = '2026-08-19T09:28:00Z';
zoneSelect.value = 'Asia/Tokyo';
zoneSelect.dispatchEvent(new window.Event('change'));
resetFormatters();
check(zoneMode() === 'Asia/Tokyo', `пояс не сохранился: ${zoneMode()}`);
const tokyo = formatDateTime(instant);

zoneSelect.value = 'America/Los_Angeles';
zoneSelect.dispatchEvent(new window.Event('change'));
resetFormatters();
const la = formatDateTime(instant);
check(tokyo !== la, `время не изменилось при смене пояса: ${tokyo} / ${la}`);
console.log(`  один и тот же момент: Токио «${tokyo}», Лос-Анджелес «${la}»`);

// Календарная дата не имеет права ехать вместе с поясом
const dayInLA = formatDayShort('2026-05-18');
zoneSelect.value = 'Asia/Tokyo';
zoneSelect.dispatchEvent(new window.Event('change'));
resetFormatters();
const dayInTokyo = formatDayShort('2026-05-18');
check(dayInLA === dayInTokyo,
  `календарная дата поехала за поясом: «${dayInLA}» против «${dayInTokyo}»`);
console.log(`  календарная дата 2026-05-18 в обоих поясах: «${dayInTokyo}»`);

zoneSelect.value = 'system';
zoneSelect.dispatchEvent(new window.Event('change'));
resetFormatters();
check(zoneResolved().length > 0, 'системный пояс не определился');

/* --- Колокольчик ---------------------------------------------------------- */

setLang('ru');
const { mountNotifications } = await load('assets/js/notifications.js');
const bellHost = window.document.createElement('div');
window.document.body.appendChild(bellHost);
const bell = await mountNotifications(bellHost);
check(Boolean(bell), 'колокольчик не смонтировался');

window.document.getElementById('bell').dispatchEvent(new window.Event('click'));
await new Promise((r) => setTimeout(r, 50));

const modal = window.document.querySelector('.sync-modal');
const rows = modal.querySelectorAll('.sync-row');
const recent = modal.querySelectorAll('.sync-row:not(.sync-row--current)');
check(rows.length > 0, 'в журнале нет ни одной записи');
check(recent.length === 10, `последних запусков показано ${recent.length}, ожидали 10`);

const text = modal.textContent;
check(!/amazon-weekly-sales|amazon-account|amazon-fx/.test(text),
  'источник показан кодом, а не названием');
check(/[Пп]родажи по неделям|[Пп]роверка аккаунта/.test(text),
  'названий новых источников в журнале нет');
check(modal.querySelectorAll('.sync-row__stats').length > 0,
  'ни у одной записи не показано, какие данные обновились');
check(!/NaN|undefined/.test(text), 'в журнале есть NaN или undefined');

const statuses = [...rows].map((r) => r.className.match(/sync-row--(\w+)/)?.[1]).filter(Boolean);
console.log(`  журнал: записей ${rows.length} (последних ${recent.length}), `
  + `статусы: ${[...new Set(statuses)].join(', ')}`);

console.log(problems.length ? '\nПРОБЛЕМЫ:' : '\nПроблем не найдено.');
problems.forEach((p) => console.log('  · ' + p));
process.exit(problems.length ? 1 : 0);
