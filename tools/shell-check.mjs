/* ==========================================================================
   Проверка оболочки: окно настроек и колокольчик.

   Разделы проверяет mount-check.mjs, но настройки и журнал живут не в
   разделе, а в шапке — и ломаются они отдельно. Здесь проверяется, что
   окно настроек собирается, что смена языка, пояса и темы доезжает до
   хранилища и до подписей, и что в журнале видно последние запуски с их
   статусом и причиной.

   Вторая вкладка окна — «Интеграции». Её главная проверка здесь одна и
   тяжёлая: в поля секретов кладётся узнаваемая строка, окно закрывается и
   открывается заново, и ни в одном значении localStorage этой строки быть
   не должно (RULES.md §1.2 — репозиторий публичный). Несекретные настройки,
   наоборот, обязаны пережить пересборку окна.

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
/* Настоящий <dialog>.close() поднимает событие close — на нём висит очистка
   секретных полей и досрочная запись настроек. Без него проверка секретов
   проверяла бы не то поведение, что в браузере. */
window.HTMLDialogElement.prototype.close = function close() {
  this.open = false;
  this.dispatchEvent(new window.Event('close'));
};

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

/* Полоса выбора — одна остановка Tab: внутри перемещение стрелками. Без
   roving tabindex три кнопки языка были тремя остановками, а стрелки не
   делали ничего — притом что в соседней вкладке они работают. */
const langTabIndexes = [...groups[0].querySelectorAll('.segmented__item')].map((b) => b.tabIndex);
check(langTabIndexes.filter((i) => i === 0).length === 1,
  `в группе языка ${langTabIndexes.filter((i) => i === 0).length} остановок Tab, ожидали одну`);

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

/* --- Окно настроек: вкладка «Интеграции» ---------------------------------- */

/* Утечку секрета не поймать проверкой по именам полей: утечь может что угодно
   и куда угодно. Поэтому в поля кладётся заведомо узнаваемая строка, а потом
   просматриваются все значения localStorage целиком. */
const SECRET_MARK = 'SEKRET-MARKER-7Q4Z9X-DO-NOT-STORE';

/* Текстовые узлы склеиваются через пробел, а не через textContent: соседние
   элементы стыкуются вплотную, и «…on this page.» + «Enter an address…»
   давало бы несуществующий ключ page.Enter. */
function panelText(node) {
  if (!node) return '';
  const parts = [];
  const walk = (parent) => {
    for (const child of parent.childNodes) {
      if (child.nodeType === 3) parts.push(child.nodeValue);
      else walk(child);
    }
  };
  walk(node);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/* Оба хранилища, а не одно: sessionStorage — такой же публично читаемый
   склад на этом домене, и одна строка sessionStorage.setItem в будущей правке
   прошла бы мимо всех проверок раздела. Префикс в дампе называет, какое из
   хранилищ протекло. */
function storageDump() {
  const parts = [];
  for (const [name, store] of [['local', window.localStorage], ['session', window.sessionStorage]]) {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      parts.push(`${name}:${key}=${store.getItem(key)}`);
    }
  }
  return parts.join('\n');
}

/** Ищет ключ, похожий на секрет, на любой глубине разобранного JSON. */
function secretKeys(value, path = '') {
  if (Array.isArray(value)) return value.flatMap((item, i) => secretKeys(item, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => [
      ...(/(secret|token|password|refresh)/i.test(key) ? [`${path}.${key}`] : []),
      ...secretKeys(item, `${path}.${key}`),
    ]);
  }
  return [];
}

const settingsButton = window.document.getElementById('settings-button');
const tabs = [...dialog.querySelectorAll('[role="tab"]')];
const tabGeneral = tabs.find((tab) => tab.dataset.tab === 'general');
const tabIntegrations = tabs.find((tab) => tab.dataset.tab === 'integrations');
const generalPanel = dialog.querySelector('#set-panel-general');
const intPanel = dialog.querySelector('#set-panel-integrations');

check(Boolean(dialog.querySelector('[role="tablist"]')), 'полосы вкладок в окне настроек нет');
check(tabs.length === 2, `вкладок ${tabs.length}, ожидали 2 — «Общие» и «Интеграции»`);
check(Boolean(tabGeneral), 'вкладки «Общие» нет');
check(Boolean(tabIntegrations), 'вкладки «Интеграции» нет');
check(generalPanel?.getAttribute('role') === 'tabpanel', 'у панели «Общие» нет role=tabpanel');
check(intPanel?.getAttribute('role') === 'tabpanel', 'у панели «Интеграции» нет role=tabpanel');

for (const tab of tabs) {
  const panel = dialog.querySelector(`#${tab.getAttribute('aria-controls')}`);
  check(Boolean(panel), `aria-controls вкладки «${tab.textContent}» указывает в никуда`);
  check(panel?.getAttribute('aria-labelledby') === tab.id,
    `панель вкладки «${tab.textContent}» не ссылается обратно на свою вкладку`);
}

/* Порядок панелей — не вкусовщина: dialog.querySelector('.settings__select')
   выше ищет первый селект окна и обязан попасть в список поясов. */
const panelOrder = generalPanel && intPanel
  ? generalPanel.compareDocumentPosition(intPanel) & window.Node.DOCUMENT_POSITION_FOLLOWING
  : 0;
check(panelOrder !== 0, 'панель «Интеграции» стоит в DOM раньше «Общих»');

/* Без вкладок и панелей остальное проверять не на чем: инструмент обязан
   назвать проблему, а не упасть с TypeError на первом же обращении. */
if (!tabGeneral || !tabIntegrations || !generalPanel || !intPanel) {
  check(false, 'вкладок или панелей окна настроек нет — проверки «Интеграций» пропущены');
} else {
  settingsButton.dispatchEvent(new window.Event('click'));
  check(dialog.open === true, 'окно настроек не открылось по кнопке');
  check(tabGeneral.getAttribute('aria-selected') === 'true'
    && tabIntegrations.getAttribute('aria-selected') === 'false',
    'при открытии активной должна быть вкладка «Общие»');
  check(tabGeneral.tabIndex === 0 && tabIntegrations.tabIndex === -1,
    `roving tabindex сломан: ${tabGeneral.tabIndex} / ${tabIntegrations.tabIndex}`);
  check(intPanel.hidden === true, 'панель «Интеграции» видна, пока выбрана вкладка «Общие»');

  // Полоса вкладок — одна остановка Tab: внутри перемещение стрелками
  tabGeneral.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  check(dialog.dataset.tab === 'integrations', 'стрелка вправо не переключила вкладку');
  tabIntegrations.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  check(dialog.dataset.tab === 'general', 'стрелка влево не вернула вкладку');

  tabIntegrations.dispatchEvent(new window.Event('click'));
  check(dialog.dataset.tab === 'integrations', `data-tab окна после клика: ${dialog.dataset.tab}`);
  check(intPanel.hidden === false, 'панель «Интеграции» не показалась');
  check(generalPanel.hidden === true, 'панель «Общие» не спряталась');
  check(intPanel.children.length > 0, 'раздел «Интеграции» собрался пустым');
  check(panelText(intPanel).length > 500,
    `в разделе «Интеграции» всего ${panelText(intPanel).length} знаков текста`);

  // Вкладка не имеет права сломать то, на чём стоят проверки выше
  check(dialog.querySelectorAll('.settings__group').length === 3,
    'класс .settings__group уехал за пределы вкладки «Общие»');
  check(dialog.querySelector('.settings__select') === zoneSelect,
    'первым селектом окна перестал быть список поясов');

  /* --- Состав раздела ------------------------------------------------------- */

  const intGroups = intPanel.querySelectorAll('.int-group');
  check(intGroups.length === 3,
    `групп интеграций ${intGroups.length}, ожидали 3 (SP-API, преп-центры, контейнеры)`);

  const MARKET_IDS = ['A1PA6795UKMFR9', 'A1F83G8C2ARO7P', 'A13V1IB3VIYZZH', 'APJ6JRA9NG5V4',
    'A1RKKUPIHCS9HS', 'A1805IZSGTT6HS', 'A2NODRKZP88ZB9', 'A1C3SOZRARQ6R3',
    'AMEN7PMS3EDWL', 'A33AVAJ2PDY3EV'];
  const marketPlates = [...intPanel.querySelectorAll('.int-checks .int-check')];
  const marketIds = marketPlates.map((plate) => plate.querySelector('code')?.textContent);
  check(marketPlates.length === 10, `площадок ${marketPlates.length}, ожидали 10`);
  const missingMarkets = MARKET_IDS.filter((id) => !marketIds.includes(id));
  check(!missingMarkets.length, `нет идентификаторов площадок: ${missingMarkets.join(', ')}`);
  const checkedMarkets = marketPlates
    .filter((plate) => plate.querySelector('input').checked)
    .map((plate) => plate.querySelector('code').textContent);
  check(checkedMarkets.join(',') === 'A1PA6795UKMFR9,A1F83G8C2ARO7P',
    `базово отмечены ${checkedMarkets.join(', ') || '—'}, ожидали DE и UK`);

  const sourceItems = intPanel.querySelectorAll('.int-source');
  check(sourceItems.length === 5, `источников данных ${sourceItems.length}, ожидали 5`);

  const intText = panelText(intPanel);
  const REPORTS = ['GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA', 'awd/2024-05-09',
    'GET_FBA_FULFILLMENT_INBOUND_SHIPMENT_ITEMS_DATA', 'GET_SALES_AND_TRAFFIC_REPORT',
    'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL'];
  const missingReports = REPORTS.filter((name) => !intText.includes(name));
  check(!missingReports.length, `у источников не показан эндпоинт: ${missingReports.join(', ')}`);
  check(/CANCELLED/.test(intText), 'нет примечания про статус CANCELLED');
  check(/30/.test(intText), 'нет примечания про окно отчёта заказов в 30 дней');

  const ACTIONS_SECRETS = ['SPAPI_CLIENT_ID', 'SPAPI_CLIENT_SECRET',
    'SPAPI_REFRESH_TOKEN', 'SPAPI_SELLER_ID'];
  const missingActions = ACTIONS_SECRETS.filter((name) => !intText.includes(name));
  check(!missingActions.length, `не перечислены переменные GitHub Actions: ${missingActions.join(', ')}`);
  check(intText.includes('Settings → Secrets and variables → Actions'),
    'не показан путь к секретам в интерфейсе GitHub');

  const prepCards = intPanel.querySelectorAll('.int-prep');
  check(prepCards.length === 4, `карточек преп-центров ${prepCards.length}, ожидали 4`);
  check(intPanel.querySelectorAll('.int-prep[data-active="false"]').length === 2,
    'исключённых преп-центров не два (ожидали Kastellaun и AsiaLog)');

  const secretFields = [...intPanel.querySelectorAll('[data-secret]')];
  check(secretFields.length >= 5, `секретных полей ${secretFields.length}, ожидали не меньше пяти`);
  check(secretFields.every((input) => input.getAttribute('type') === 'password'),
    'секретное поле собрано не как type=password');
  check(secretFields.every((input) => !input.hasAttribute('data-store')),
    'у секретного поля есть data-store — сохранение его подхватит');
  check(intPanel.querySelectorAll('.int-field--secret .input-group__action').length === secretFields.length,
    'не у каждого секретного поля есть кнопка «показать значение»');
  check(intPanel.querySelectorAll('.int-field__hint--secret').length === secretFields.length,
    'не у каждого секретного поля есть пометка, что значение не сохраняется');

  /* Помечено то, что сохраняется: у каждого текстового поля с data-store
     обязана быть подпись «сохраняется в браузере». Выборочная пометка хуже
     её отсутствия — человек достраивает правило по тому, что видит. */
  const storedFields = [...intPanel.querySelectorAll('input[data-store]')];
  const unmarked = storedFields.filter((input) => !intPanel.querySelector(`#${input.id}-saved`));
  check(storedFields.length > 10 && !unmarked.length,
    `сохраняемые поля без пометки «сохраняется в браузере»: ${unmarked.map((i) => i.id).join(', ')}`);

  /* Журнал читается запросом — дадим ему доехать до плитки */
  await new Promise((r) => setTimeout(r, 200));

  /* Статус переменных GitHub выводится из журнала, а не зашит: прогон,
     который принёс данные, без них бы не состоялся. Сверяем с самим файлом. */
  const logEntries = JSON.parse(readFileSync(ROOT + 'data/sync-log.json', 'utf8')).entries || [];
  const lastSpapi = logEntries
    .filter((entry) => entry.source === 'amazon-spapi')
    .sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)))[0] || null;
  const expectedPill = !lastSpapi ? 'unset' : (lastSpapi.status === 'error' ? 'unknown' : 'set');
  const pillStates = [...intPanel.querySelectorAll('.int-secret .int-pill')].map((p) => p.dataset.state);
  check(pillStates.length === 4 && pillStates.every((state) => state === expectedPill),
    `статус переменных GitHub «${pillStates.join(', ')}» разошёлся с журналом (ожидали ${expectedPill})`);

  /* Плитка состояния показывает время последнего прогона, а не «ещё не было» */
  const lastSyncNode = intPanel.querySelector('.int-state time');
  check(Boolean(lastSyncNode), 'в плитке состояния нет времени последней синхронизации');
  check(!lastSpapi || lastSyncNode?.getAttribute('datetime') === lastSpapi.finishedAt,
    `в плитке стоит не время последнего прогона: ${lastSyncNode?.getAttribute('datetime')}`);

  // Скрытый input[type=file] не имеет права ловить Tab: рамки фокуса не видно
  const focusableFiles = [...intPanel.querySelectorAll('input[type="file"]')]
    .filter((input) => input.tabIndex >= 0);
  check(!focusableFiles.length,
    `скрытых полей выбора файла в порядке обхода: ${focusableFiles.length}`);

  // Шаблон CSV не вываливает <pre> в панель, пока его не попросили
  const template = intPanel.querySelector('.int-template');
  check(template?.hidden === true, 'содержимое шаблона показано до того, как его попросили');
  intPanel.querySelector('.int-template-toggle').dispatchEvent(new window.Event('click'));
  check(template?.hidden === false, 'кнопка показа шаблона ничего не показала');
  intPanel.querySelector('.int-template-toggle').dispatchEvent(new window.Event('click'));

  console.log(`  интеграции: групп ${intGroups.length}, площадок ${marketPlates.length}, `
    + `источников ${sourceItems.length}, преп-центров ${prepCards.length}, `
    + `секретных полей ${secretFields.length}; пометок «сохраняется» ${storedFields.length}, `
    + `переменные GitHub: ${expectedPill}`);

  /* --- Раздел на трёх языках ------------------------------------------------ */

  // Непереведённый ключ t() отдаёт как есть — он и виден в тексте
  const KEY_RE = /\b(sales|check|page|nav|fba|int|settings)\.[a-zA-Z.]+\b/g;

  for (const lang of ['ru', 'en', 'uk']) {
    setLang(lang);
    const text = panelText(intPanel);
    check(text.length > 500, `[${lang}] раздел «Интеграции» собрался пустым или обрезанным`);
    check(!/NaN/.test(text), `[${lang}] в разделе «Интеграции» есть NaN`);
    check(!/undefined/.test(text), `[${lang}] в разделе «Интеграции» есть undefined`);
    check(!/\bnull\b/.test(text), `[${lang}] в разделе «Интеграции» есть null`);
    const raw = text.match(KEY_RE);
    check(!raw, `[${lang}] непереведённые ключи: ${[...new Set(raw || [])].join(', ')}`);
  }
  setLang('ru');

  /* Ключ, забытый в en или uk, подменяется русской строкой — в тексте его не
     видно, поэтому наборы ключей сверяются по самому словарю. */
  const dictSource = readFileSync(ROOT + 'assets/js/strings-integrations.js', 'utf8');
  const dictKeys = { ru: new Set(), en: new Set(), uk: new Set() };
  let dictBlock = null;
  for (const line of dictSource.split('\n')) {
    const opened = line.match(/^ {2}(ru|en|uk): \{$/);
    if (opened) { dictBlock = opened[1]; continue; }
    if (!dictBlock) continue;
    if (/^ {2}\},?$/.test(line)) { dictBlock = null; continue; }
    const key = line.match(/^ {4}'([^']+)':/);
    if (key) dictKeys[dictBlock].add(key[1]);
  }
  const ruKeys = [...dictKeys.ru];
  check(ruKeys.length > 100, `в словаре интеграций разобрано ${ruKeys.length} ключей — разбор сломался`);
  for (const lang of ['en', 'uk']) {
    const missing = ruKeys.filter((key) => !dictKeys[lang].has(key));
    const extra = [...dictKeys[lang]].filter((key) => !dictKeys.ru.has(key));
    check(!missing.length, `[${lang}] в словаре нет ключей: ${missing.slice(0, 8).join(', ')}`);
    check(!extra.length, `[${lang}] в словаре лишние ключи: ${extra.slice(0, 8).join(', ')}`);
  }
  console.log(`  словарь интеграций: ключей ${ruKeys.length} × 3 языка`);

  /* --- Предупреждения о регионе и среде ------------------------------------- */

  const warnNa = intPanel.querySelector('.int-warn--critical');
  const warnSandbox = intPanel.querySelector('.int-warn--warning');
  check(warnNa?.hidden === true && warnSandbox?.hidden === true,
    'при eu/production предупреждения показаны, хотя показывать нечего');

  intPanel.querySelector('[data-value="na"]').dispatchEvent(new window.Event('click'));
  check(warnNa.hidden === false, 'регион na не поднял предупреждение о 403');
  intPanel.querySelector('[data-value="eu"]').dispatchEvent(new window.Event('click'));
  check(warnNa.hidden === true, 'предупреждение о 403 не убралось при возврате на eu');

  intPanel.querySelector('[data-value="sandbox"]').dispatchEvent(new window.Event('click'));
  check(warnSandbox.hidden === false, 'sandbox не поднял предупреждение о выдуманных данных');
  intPanel.querySelector('[data-value="production"]').dispatchEvent(new window.Event('click'));
  check(warnSandbox.hidden === true, 'предупреждение о sandbox не убралось при возврате на production');

  /* --- Канал преп-центра ---------------------------------------------------- */

  const card = intPanel.querySelector('.int-prep');
  const channelPanels = [...card.querySelectorAll('.int-channel')];
  check(channelPanels.length === 3, `панелей канала у карточки ${channelPanels.length}, ожидали 3`);

  const shownChannels = () => channelPanels.filter((panel) => !panel.hidden)
    .map((panel) => panel.dataset.channel);
  const shownFields = () => channelPanels.filter((panel) => !panel.hidden)
    .flatMap((panel) => [...panel.querySelectorAll('input, select')].map((field) => field.id))
    .sort().join(',');

  check(shownChannels().join(',') === 'csv',
    `у карточки WM виден канал «${shownChannels().join(', ') || '—'}», ожидали csv`);
  const csvFields = shownFields();

  card.querySelector('.segmented [data-value="rest"]').dispatchEvent(new window.Event('click'));
  check(shownChannels().join(',') === 'rest',
    `после выбора REST видно каналов: ${shownChannels().join(', ') || '—'}`);
  const restFields = shownFields();
  check(restFields !== csvFields, 'смена канала не поменяла набор видимых полей');
  check(/-restToken\b/.test(restFields), 'в канале REST не видно поля токена');

  card.querySelector('.segmented [data-value="mail"]').dispatchEvent(new window.Event('click'));
  const mailFields = shownFields();
  check(shownChannels().join(',') === 'mail',
    `после выбора почты видно каналов: ${shownChannels().join(', ') || '—'}`);
  check(/-mailPassword\b/.test(mailFields), 'в почтовом канале не видно поля пароля');
  check(!/-restToken\b/.test(mailFields), 'поле токена REST осталось видимым в почтовом канале');
  console.log(`  каналы преп-центра: csv ${csvFields.split(',').length} полей, `
    + `rest ${restFields.split(',').length}, mail ${mailFields.split(',').length}`);

  /* --- Числовое поле помнит текущее значение, а не то, что было при сборке -- */

  const lagField = card.querySelector('[id$="-lag"]');
  lagField.value = '14';
  lagField.dispatchEvent(new window.Event('input'));
  lagField.value = '';
  lagField.dispatchEvent(new window.Event('change'));
  check(lagField.value === '14',
    `после очистки поле лага откатилось на «${lagField.value}», ожидали 14`);

  /* --- Добавление и удаление преп-центра ------------------------------------ */

  intPanel.querySelector('.int-prep-add').dispatchEvent(new window.Event('click'));
  check(intPanel.querySelectorAll('.int-prep').length === 5,
    `после «Добавить преп-центр» карточек ${intPanel.querySelectorAll('.int-prep').length}, ожидали 5`);
  const addedCard = [...intPanel.querySelectorAll('.int-prep')].pop();
  check(addedCard.querySelectorAll('.int-channel').length === 3, 'у новой карточки нет панелей канала');
  check(Boolean(addedCard.querySelector('[data-secret]')), 'у новой карточки нет секретных полей');

  /* Новая карточка без названия расчёту неизвестна: идентификатора нет,
     записать выбор «участвует» некуда — и тумблер это показывает, а не
     притворяется работающим. Название даёт идентификатор. */
  check(addedCard.dataset.canon === '', `у безымянной карточки уже есть канон: ${addedCard.dataset.canon}`);
  const addedSwitch = addedCard.querySelector('.int-switch');
  check(addedSwitch?.disabled === true, 'тумблер безымянной карточки нажимается, а записать выбор некуда');
  const addedName = addedCard.querySelector('[id$="-name"]');
  addedName.value = 'Nordhalle Bremen';
  addedName.dispatchEvent(new window.Event('input'));
  check(addedCard.dataset.canon === 'NORDHALLE_BREMEN',
    `идентификатор новой карточки: «${addedCard.dataset.canon}», ожидали NORDHALLE_BREMEN`);
  check(addedSwitch.disabled === false, 'тумблер не включился после того, как появился идентификатор');
  addedCard.querySelector('.int-prep__remove').dispatchEvent(new window.Event('click'));
  check(intPanel.querySelectorAll('.int-prep').length === 4,
    `после удаления карточек ${intPanel.querySelectorAll('.int-prep').length}, ожидали 4`);

  /* --- «Проверить связь» не изображает успех -------------------------------- */

  intPanel.querySelector('.int-test').dispatchEvent(new window.Event('click'));
  await new Promise((r) => setTimeout(r, 700));
  const testResult = intPanel.querySelector('.int-result');
  check(testResult?.hidden === false, 'результат проверки связи не показался');
  const testText = panelText(testResult);
  /* Плашка ищется узлом, а не регуляркой по тексту: \b в JS считает границей
     только латиницу и цифры, и «\bдемо\b» не совпало бы никогда. */
  const demoBadge = testResult?.querySelector('.int-badge');
  check(demoBadge?.textContent.trim() === t('int.demoBadge'),
    `в результате проверки нет пометки «${t('int.demoBadge')}»: ${testText}`);
  check(testResult?.firstElementChild === demoBadge,
    'пометка «демо» стоит не первой — её прочтут после текста, а не до');
  check(!/подключено|успешно|connected|success/i.test(testText),
    `проверка связи изображает успех: ${testText}`);

  /* --- ГЛАВНОЕ: секреты не попадают в localStorage -------------------------- */

  const marked = [...intPanel.querySelectorAll('[data-secret]')];
  marked.forEach((input, index) => {
    input.value = `${SECRET_MARK}-${index}`;
    input.dispatchEvent(new window.Event('input'));
    input.dispatchEvent(new window.Event('change'));
  });

  /* Ключ доступа сплошь и рядом передают прямо в адресе, а поле «Токен» рядом
     от этого не спасает: маркер кладётся в URL-поля и не должен всплыть в
     хранилище ни разу. Сам адрес при этом обязан сохраниться — без ключа. */
  const apiUrlField = intPanel.querySelector('#int-cont-apiUrl');
  apiUrlField.value = `https://forwarder.example/api?token=${SECRET_MARK}`;
  apiUrlField.dispatchEvent(new window.Event('input'));
  const restUrlField = intPanel.querySelector('[id$="-restUrl"]');
  restUrlField.value = `https://wm.example/v1?apikey=${SECRET_MARK}&shop=7`;
  restUrlField.dispatchEvent(new window.Event('input'));

  // Несекретные значения меняются заодно: без них сохранения бы не случилось,
  // и «секрета нет в хранилище» означало бы только, что хранилище пустое
  const clientIdField = intPanel.querySelector('#int-spapi-clientId');
  clientIdField.value = 'amzn1.application-oa2-client.DEMO';
  clientIdField.dispatchEvent(new window.Event('input'));
  const sellerIdField = intPanel.querySelector('#int-spapi-sellerId');
  sellerIdField.value = 'A2DEMOSELLER00';
  sellerIdField.dispatchEvent(new window.Event('input'));
  const ukMarkerField = intPanel.querySelector('#int-cont-ukMarker');
  ukMarkerField.value = 'UK-DEMO';
  ukMarkerField.dispatchEvent(new window.Event('input'));
  const frCheckbox = marketPlates
    .find((plate) => plate.querySelector('code').textContent === 'A13V1IB3VIYZZH')
    .querySelector('input');
  frCheckbox.checked = true;
  frCheckbox.dispatchEvent(new window.Event('change'));

  tabGeneral.dispatchEvent(new window.Event('click'));
  tabIntegrations.dispatchEvent(new window.Event('click'));
  await new Promise((r) => setTimeout(r, 500));

  check(!storageDump().includes(SECRET_MARK),
    'значение секретного поля попало в localStorage ещё до закрытия окна');

  /* Отказ сохранить ключ из адреса обязан быть виден глазами, а не только
     слышен скринридеру: живая область раздела — visually-hidden. */
  const liveStatus = intPanel.querySelector('.int-status');
  check(liveStatus?.hidden === false && (liveStatus?.textContent || '').length > 10,
    'видимой строки состояния нет — о записи и об отказе записи знает только скринридер');
  check(liveStatus?.dataset.tone === 'alert',
    `о вырезанном из адреса ключе сказано тоном «${liveStatus?.dataset.tone}», ожидали alert`);

  dialog.close();
  check(dialog.open === false, 'окно настроек не закрылось');
  const stillFilled = marked.filter((input) => input.value !== '').length;
  check(stillFilled === 0, `после закрытия окна не очищено секретных полей: ${stillFilled}`);
  check(marked.every((input) => input.getAttribute('type') === 'password'),
    'после закрытия окна секретное поле осталось открытым текстом');
  check(!storageDump().includes(SECRET_MARK),
    'значение секретного поля попало в localStorage при закрытии окна');

  settingsButton.dispatchEvent(new window.Event('click'));
  /* Вкладка не запоминается: за настройками темы и пояса приходят каждый
     день, за интеграциями — один раз. */
  check(dialog.dataset.tab === 'general' && tabGeneral.getAttribute('aria-selected') === 'true',
    `после визита в «Интеграции» окно открылось на вкладке «${dialog.dataset.tab}»`);
  tabIntegrations.dispatchEvent(new window.Event('click'));
  await new Promise((r) => setTimeout(r, 500));
  check(!storageDump().includes(SECRET_MARK),
    'секрет всплыл в хранилище после повторного открытия окна');
  check(marked.every((input) => input.value === ''),
    'секретные поля не пусты после повторного открытия окна');

  const storedRaw = window.localStorage.getItem('dashboard.integrations');
  check(Boolean(storedRaw), 'несекретные настройки интеграций не сохранились');
  let stored = null;
  try { stored = JSON.parse(storedRaw || 'null'); }
  catch { check(false, 'сохранённые настройки интеграций — не JSON'); }
  const leakedKeys = stored ? secretKeys(stored) : [];
  check(!leakedKeys.length, `в сохранённых настройках есть ключи-секреты: ${leakedKeys.join(', ')}`);
  const leakedInStorage = storageDump().includes(SECRET_MARK);
  console.log(`  хранилище: ключ dashboard.integrations, ${(storedRaw || '').length} знаков; `
    + `секретная строка на этот момент ${leakedInStorage ? 'НАЙДЕНА в localStorage' : 'не встречается ни в одном значении'}`);

  /* --- Несекретное переживает пересборку окна ------------------------------- */

  check(stored?.spapi?.clientId === 'amzn1.application-oa2-client.DEMO',
    `Client ID не сохранился: ${stored?.spapi?.clientId}`);
  check(stored?.spapi?.sellerId === 'A2DEMOSELLER00',
    `Seller ID не сохранился: ${stored?.spapi?.sellerId}`);
  check(stored?.containers?.ukMarker === 'UK-DEMO',
    `правило «маркер UK» не сохранилось: ${stored?.containers?.ukMarker}`);

  /* Правила классификации обязаны доехать до параметров РАСЧЁТА: «Логистика»
     читает dashboard.oos.params, а не dashboard.integrations. Раньше сюда
     доезжала одна датировка, и маркер рынка правился вхолостую. */
  let forecast = null;
  try { forecast = JSON.parse(window.localStorage.getItem('dashboard.oos.params') || 'null'); }
  catch { check(false, 'параметры расчёта сохранены не как JSON'); }
  check(forecast?.ukMarker === 'UK-DEMO',
    `маркер рынка не доехал до параметров расчёта: ${forecast?.ukMarker}`);
  check(forecast?.prepLagByCenter?.ASIALOG === 45,
    `лаг AsiaLog в параметрах расчёта ${forecast?.prepLagByCenter?.ASIALOG}, ожидали 45`);
  check(Array.isArray(forecast?.prepAliases?.WM_EICHENZELL)
    && forecast.prepAliases.WM_EICHENZELL.length > 0,
    'алиасы преп-центра не доехали до параметров расчёта');

  /* Набор препцентров хранится в одном месте — там, где его читает расчёт.
     Вторая копия в настройках интеграций затирала бы выбор, сделанный в
     фильтрах «Логистики». */
  check(Array.isArray(forecast?.selectedPrepCenters?.DE)
    && forecast.selectedPrepCenters.DE.includes('WM_EICHENZELL')
    && !forecast.selectedPrepCenters.DE.includes('KASTELLAUN'),
    `набор препцентров DE в параметрах расчёта: ${JSON.stringify(forecast?.selectedPrepCenters?.DE)}`);
  check(!stored?.preps?.some((prep) => 'active' in prep),
    'признак «участвует в расчёте» снова лежит второй копией в dashboard.integrations');
  check(stored?.preps?.[0]?.canon === 'WM_EICHENZELL',
    `канонический идентификатор карточки не сохранился: ${stored?.preps?.[0]?.canon}`);
  check(Boolean(stored?.spapi?.marketplaces?.includes('A13V1IB3VIYZZH')),
    'отметка площадки FR не сохранилась');
  check(stored?.containers?.apiUrl === 'https://forwarder.example/api',
    `адрес форвардера сохранён не в очищенном виде: ${stored?.containers?.apiUrl}`);
  const restStored = stored?.preps?.[0]?.rest?.baseUrl;
  check(restStored === 'https://wm.example/v1?shop=7',
    `из базового URL преп-центра вырезан не только ключ: ${restStored}`);

  // Пересборка окна с нуля: то же, что перезагрузка страницы
  const slot2 = window.document.createElement('div');
  window.document.body.appendChild(slot2);
  mountSettings(slot2);
  const dialog2 = [...window.document.querySelectorAll('.settings-modal')].pop();
  check(dialog2 !== dialog, 'второе окно настроек не создалось');
  const intPanel2 = dialog2.querySelector('#set-panel-integrations');
  check(Boolean(intPanel2), 'в пересобранном окне нет панели «Интеграции»');
  check(intPanel2?.querySelector('#int-spapi-clientId')?.value === 'amzn1.application-oa2-client.DEMO',
    'Client ID не пережил пересборку окна');
  check(intPanel2?.querySelector('#int-cont-ukMarker')?.value === 'UK-DEMO',
    'правило «маркер UK» не пережило пересборку окна');
  const frPlate2 = [...(intPanel2?.querySelectorAll('.int-checks .int-check') || [])]
    .find((plate) => plate.querySelector('code')?.textContent === 'A13V1IB3VIYZZH');
  check(frPlate2?.querySelector('input').checked === true,
    'отметка площадки FR не пережила пересборку окна');
  const secrets2 = [...(intPanel2?.querySelectorAll('[data-secret]') || [])];
  check(secrets2.length > 0 && secrets2.every((input) => input.value === ''),
    'секретное поле восстановилось из хранилища при пересборке окна');
  const kept2 = intPanel2?.querySelector('#int-spapi-clientId')?.value ? 'на месте' : 'ПОТЕРЯНЫ';
  const empty2 = secrets2.filter((input) => input.value === '').length;
  console.log(`  после пересборки окна: несекретные значения ${kept2}, `
    + `пусты ${empty2} секретных полей из ${secrets2.length}`);
}

setLang('ru');

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
