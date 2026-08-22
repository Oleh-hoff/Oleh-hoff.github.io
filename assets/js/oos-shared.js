/* ==========================================================================
   Раздел «Логистика»: общие помощники трёх страниц.

   Модуль не знает ни одной страницы в лицо и не держит расчётного состояния:
   считает `oos-engine.js`, параметры хранит `oos-params.js`. Здесь — только
   то, что иначе пришлось бы написать трижды: загрузка демо-данных, панель
   параметров, статусные плашки, форматирование и мелкая разметка.

   Три правила, из-за которых модуль вообще существует:

   1. `formatNumber(null)` возвращает «0», а `formatDayShort(undefined)`
      бросает RangeError и роняет весь mount. Движок отдаёт `null` регулярно
      («нет данных»), и путать его с нулём нельзя. Поэтому числа и даты
      выводятся только через `num()` и `day()`.
   2. `navigate()` перемонтирует раздел при смене языка и часового пояса —
      замыкание `mount()` теряется. Состояние взгляда (фильтр, выбранный
      товар, сортировка) живёт в модульных переменных, а не в замыкании.
   3. Время берётся из `asOf` данных, а не из `Date.now()`: макет обязан
      показывать одни и те же числа завтра и через год.
   ========================================================================== */

import { t, getLang, getLocale } from './i18n.js';
import { formatNumber, formatDayShort, formatDayFull, formatPercent } from './format.js';
import { el, tableWrap } from './fba-spec.js';
import { statusIcon } from './notifications.js';
import {
  getParams, getDefaults, setParam, setParams, resetParams, togglePrepCenter,
  isPrepSelected, changedKeys, isDefault, PREP_CENTERS, HORIZONS, ENUMS,
} from './oos-params.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Маршрут карточки товара. Хеш без запроса — почему, см. `productLink()`. */
export const PRODUCT_ROUTE = '#/oos-product';

/** Каналы плана заказов в порядке показа: две поставки и ускорение. */
export const CHANNELS = ['direct-fba', 'prep-refill', 'expedite'];

/** Тона тепловой карты в порядке ухудшения — он же порядок легенды. */
export const HEAT_TONES = ['ok', 'below-reserve', 'below-fba', 'oos'];

/* Уникальный номер для связки label ↔ контрол. Счётчик, а не Date.now():
   идентификаторы обязаны быть одинаковыми при каждом прогоне проверки. */
let uidCounter = 0;
function uid(prefix) { uidCounter += 1; return `${prefix}-${uidCounter}`; }

/* --------------------------------------------------------------------------
   1. Демо-данные

   Одна точка входа на три страницы. Кеш — на время сессии: при переходе
   между страницами раздела файл не перечитывается, а при смене языка
   `navigate()` вызывает mount() заново, и без кеша каждый такой вызов был бы
   сетевым запросом.

   Отказ не бросается наружу: страница обязана нарисовать честную заглушку
   (`emptyState('oos.empty.data', 'oos.empty.dataHint')`), а не упасть.
   -------------------------------------------------------------------------- */

const DATA_URL = 'data/oos-demo.json';
let dataPromise = null;

async function fetchDemoData() {
  if (typeof fetch !== 'function') throw new Error('fetch is not available');
  const response = await fetch(DATA_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data || typeof data !== 'object') throw new Error('malformed JSON');
  return { data, error: null };
}

/**
 * Демо-сырьё раздела.
 * @returns {Promise<{data: object|null, error: string|null}>}
 * Форма ответа одна и та же при успехе и при отказе — ветвление у страницы
 * ровно одно: `if (error) → заглушка`.
 */
export function loadDemoData() {
  if (!dataPromise) {
    dataPromise = fetchDemoData().catch((error) => {
      // Отказ не кешируется: следующий заход в раздел пробует снова.
      dataPromise = null;
      return { data: null, error: error?.message ? String(error.message) : String(error) };
    });
  }
  return dataPromise;
}

/* --------------------------------------------------------------------------
   2. Состояние взгляда, переживающее перемонтаж
   -------------------------------------------------------------------------- */

const MARKET_VALUES = ['DE', 'UK', 'both'];

let marketValue = 'both';
let selection = { market: null, sku: null };
let sortState = { key: 'status', dir: 'desc' };
let channelValue = 'all';
let panelOpen = false;

export function getMarketFilter() { return marketValue; }

/** Мусор приводится к «оба» молча: значение приходит из DOM, а не из кода. */
export function setMarketFilter(value) {
  marketValue = MARKET_VALUES.includes(value) ? value : 'both';
}

export function getChannelFilter() { return channelValue; }
export function setChannelFilter(value) {
  channelValue = CHANNELS.includes(value) ? value : 'all';
}

export function getSelection() { return { ...selection }; }
export function setSelection(market, sku) {
  selection = {
    market: typeof market === 'string' && market ? market : null,
    sku: typeof sku === 'string' && sku ? sku : null,
  };
}

export function getSort() { return { ...sortState }; }
export function setSort(key, dir) {
  sortState = {
    key: typeof key === 'string' && key ? key : 'status',
    dir: dir === 'asc' ? 'asc' : 'desc',
  };
}

export function setPanelOpen(open) { panelOpen = Boolean(open); }

/* Цветовой акцент рынка (§«Обзор» спецификации: у DE и UK свой цвет).
   Имя токена приходит из данных (`market.accent` = «series-1»), а не хекс:
   хардкод цвета в разделе запрещён, и тема обязана перекрашивать акцент
   сама. Карта живёт в модуле, потому что подпись рынка рисуется в пяти
   местах трёх страниц, а результат движка есть не в каждом из них. */
const marketAccents = new Map();

export function setMarketAccents(markets) {
  marketAccents.clear();
  for (const m of markets || []) {
    if (typeof m?.code === 'string' && typeof m.accent === 'string' && /^[\w-]+$/.test(m.accent)) {
      marketAccents.set(m.code, m.accent);
    }
  }
}

/**
 * Подпись рынка: код словом плюс полоска его цвета.
 * Цвет — второй носитель, а не единственный: код «DE»/«UK» стоит рядом
 * всегда, поэтому дальтонизм и монохромная печать ничего не отнимают.
 */
export function marketTag(code, className = 'oos-market') {
  const token = marketAccents.get(code);
  const node = el('span', { class: className, 'data-market': code ?? null, text: code ?? '—' });
  // Инлайном только имя переменной из данных — сам цвет остаётся в tokens.css.
  if (token) node.style.setProperty('--market-accent', `var(--${token})`);
  return node;
}

/** Пара товар×рынок так же, как её собирает движок: `DE:SQ1`. */
export function selectionKey(market, sku) { return `${market}:${sku}`; }

/**
 * Пара, выбранная сейчас, — либо первая из списка, если выбранной нет.
 * Список меняется при смене фильтра рынка, и «выбран товар, которого в списке
 * нет» — обычное дело, а не ошибка.
 */
export function resolveSelection(items) {
  const list = Array.isArray(items) ? items : [];
  const found = list.find((it) => it.market === selection.market && it.sku === selection.sku);
  if (found) return found;
  const first = list[0] || null;
  if (first) setSelection(first.market, first.sku);
  else setSelection(null, null);
  return first;
}

/* --------------------------------------------------------------------------
   3. Форматирование

   `num` и `day` — единственный разрешённый способ показать число или дату из
   движка. Прямые вызовы `formatNumber`/`formatDayShort` на страницах
   запрещены: первый врёт нулём на `null`, второй бросает исключение на
   `undefined` и пустой строке.
   -------------------------------------------------------------------------- */

/** Число: `null` — прочерк, `0` — ноль. Разница между ними и есть смысл. */
export function num(value, digits = 0) {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return formatNumber(n, digits);
}

/**
 * Число без ложной точности: «4», а не «4,0», но «1,5» остаётся «1,5».
 * Одна функция на весь раздел — раньше её копии жили под именами `plain` и
 * `monthsValue` в двух вью, а третья звала `num(x, 1)`, и одна и та же фраза
 * про лид-тайм читалась то «4 мес», то «4,0 мес».
 */
export function plain(value, digits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return num(value);
  return num(value, Number.isInteger(value) ? 0 : digits);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

/** Дата: пустое значение — прочерк, непригодное — тоже прочерк, но не взрыв. */
export function day(iso, full = false) {
  if (iso === null || iso === undefined || iso === '') return '—';
  if (typeof iso === 'string' && !ISO_DAY.test(iso)) return '—';
  try {
    return full ? formatDayFull(iso) : formatDayShort(iso);
  } catch {
    // Непригодная дата в данных — это флаг движка, а не повод ронять раздел.
    return '—';
  }
}

/** Доля 0…1 в проценты: `formatPercent` ждёт проценты, а не долю. */
export function share(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return formatPercent(Number(value) * 100, 0);
}

export function months(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return t('oos.months', { n: num(value, digits) });
}

export function days(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return t('oos.days', { n: num(value) });
}

export function units(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return t('oos.units', { n: num(value) });
}

/**
 * Название товара на текущем языке. `title` в данных — объект {ru,en,uk};
 * ключами словаря названия не переводятся, они часть данных.
 */
export function pickTitle(title) {
  if (!title) return '';
  if (typeof title === 'string') return title;
  return title[getLang()] ?? title.ru ?? title.en ?? '';
}

/* Форматтер диапазона дат по локали. Календарная дата разбирается как
   полночь UTC и показывается в UTC — как это делает format.js: иначе неделя
   «с 16 августа» стала бы «с 15 августа» западнее Гринвича. */
const rangeCache = new Map();
function rangeFormat() {
  const locale = getLocale();
  if (!rangeCache.has(locale)) {
    rangeCache.set(locale, new Intl.DateTimeFormat(locale, {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    }));
  }
  return rangeCache.get(locale);
}

/**
 * Подпись полумесячного периода.
 * short — `period.label` («16–31.08»), он числовой и языка не требует;
 * full — «16–31 августа 2026» / «August 16 – 31, 2026».
 *
 * Диапазон собирает `Intl.formatRange`, а не склейка «день + полная дата»:
 * порядок дня и месяца в разных языках разный, и склеенное «16–August 31,
 * 2026» читалось бы как ошибка вёрстки.
 */
export function formatPeriod(period, full = false) {
  if (!period) return '—';
  const short = period.label ?? period.id ?? '—';
  if (!full) return short;
  if (typeof period.start !== 'string' || typeof period.end !== 'string') return short;
  if (!ISO_DAY.test(period.start) || !ISO_DAY.test(period.end)) return short;
  try {
    return rangeFormat().formatRange(new Date(`${period.start}T00:00:00Z`),
      new Date(`${period.end}T00:00:00Z`));
  } catch {
    // formatRange нет в очень старых движках — тогда две полные даты подряд.
    return `${day(period.start, true)} – ${day(period.end, true)}`;
  }
}

/**
 * Период по идентификатору.
 * Поиск был написан трижды — картой на «Обзоре» и двумя линейными `find`
 * на соседних страницах; периодов бывает до двадцати четырёх, а зовётся он
 * из каждой строки плана.
 */
export function periodById(id, periods) {
  if (!id || !Array.isArray(periods)) return null;
  return periods.find((p) => p.id === id) ?? null;
}

/**
 * Индекс периода с прижатием к краям: заказ, размещённый раньше горизонта,
 * рисуется от левого края ленты, а не пропадает.
 * Возвращает −1, только если периодов нет вовсе или дата непригодна.
 */
export function clampPeriodIndex(iso, periods) {
  if (!Array.isArray(periods) || periods.length === 0) return -1;
  if (typeof iso !== 'string' || !ISO_DAY.test(iso)) return -1;
  if (iso < periods[0].start) return 0;
  if (iso > periods[periods.length - 1].end) return periods.length - 1;
  const idx = periods.findIndex((p) => p.start <= iso && iso <= p.end);
  return idx === -1 ? periods.length - 1 : idx;
}

/* --------------------------------------------------------------------------
   4. Шапка страницы: пороги и плашка демо-данных
   -------------------------------------------------------------------------- */

function thresholdItem(labelKey, value) {
  return el('span', { class: 'oos-thresholds__item' }, [
    el('span', { text: t(labelKey) }),
    el('b', { class: 'oos-thresholds__value', text: value }),
  ]);
}

/**
 * Строка-сводка действующих порогов.
 *
 * Видна всегда и на всех трёх страницах, а не спрятана за кнопкой: §8.2
 * спецификации требует подтверждать пороги перед показом результатов, и если
 * они не подтверждены явно, берутся базовые. Значит человек обязан видеть,
 * какие именно взяты, ничего не открывая.
 */
export function thresholdLine(params = getParams(), result = null) {
  const line = el('p', {
    class: 'oos-thresholds',
    'aria-label': t('oos.thresholds.title'),
  }, [
    thresholdItem('oos.thresholds.fba', months(params.thresholdFbaMonths)),
    thresholdItem('oos.thresholds.reserve', months(params.thresholdReserveMonths)),
    thresholdItem('oos.thresholds.lead', months(params.leadTimeMonths)),
    /* Лаг «преп → FBA» показывается ПО ВЫБРАННЫМ складам, а не запасным
       `params.prepLagDays`: у AsiaLog он 45 дней, и расчёт берёт именно его.
       Число в двух местах — ровно та ошибка, из-за которой справочник
       складов объявлен единственным источником лагов. */
    thresholdItem('oos.thresholds.lag', prepLagSummary(params)),
    /* Горизонт — единственный пункт без отдельной подписи: ключ
       `oos.horizon.summary` уже начинается словом «Горизонт», и подпись
       рядом дала бы «Горизонт Горизонт до 31 января». */
    el('span', { class: 'oos-thresholds__item' }, [
      el('b', {
        class: 'oos-thresholds__value',
        // Дата полная, с годом: горизонт «до 31 января» без года читается
        // как январь этого года, а он в демо-наборе следующий.
        text: t('oos.horizon.summary', {
          date: day(result?.horizonEnd ?? params.horizonEnd, true),
          n: num(result?.periods?.length ?? null),
        }),
      }),
    ]),
  ]);

  const base = isDefault(params);
  line.appendChild(el('span', {
    class: 'oos-thresholds__state',
    'data-state': base ? 'base' : 'changed',
    text: base
      ? t('oos.thresholds.base')
      : t('oos.thresholds.changed', { n: num(changedKeys(params).length) }),
  }));

  return line;
}

/** Значок плашки: обводка `currentColor`, поэтому тема его красит сама. */
function demoIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'oos-demo__icon');
  svg.setAttribute('aria-hidden', 'true');

  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', '8');
  circle.setAttribute('cy', '8');
  circle.setAttribute('r', '7');
  circle.setAttribute('fill', 'none');
  circle.setAttribute('stroke', 'currentColor');
  circle.setAttribute('stroke-width', '1.5');
  svg.appendChild(circle);

  const mark = document.createElementNS(SVG_NS, 'path');
  mark.setAttribute('d', 'M8 7.2v4M8 4.4v.4');
  mark.setAttribute('fill', 'none');
  mark.setAttribute('stroke', 'currentColor');
  mark.setAttribute('stroke-width', '1.8');
  mark.setAttribute('stroke-linecap', 'round');
  svg.appendChild(mark);

  return svg;
}

/**
 * Плашка «демонстрационные данные на {дата}».
 * Дата — `result.asOf`, никогда не текущая: числа макета не должны «плыть»
 * назавтра, и человек обязан видеть, что живой Amazon не опрашивался.
 * Возвращает `null`, если данные не помечены демонстрационными.
 */
export function demoBanner(result) {
  if (!result || result.demo !== true) return null;
  return el('p', { class: 'oos-demo', role: 'note' }, [
    demoIcon(),
    el('b', { class: 'oos-demo__badge', text: t('oos.demo.badge') }),
    el('span', {
      class: 'oos-demo__text',
      text: t('oos.demo.text', { date: day(result.asOf, true) }),
    }),
  ]);
}

/** Шапка страницы целиком: плашка демо-данных плюс строка порогов. */
export function topBar(params = getParams(), result = null) {
  const bar = el('div', { class: 'oos-topbar' });
  const banner = demoBanner(result);
  if (banner) bar.appendChild(banner);
  bar.appendChild(thresholdLine(params, result));
  return bar;
}

/* --------------------------------------------------------------------------
   5. Статусы

   Форм значка всего три, а состояний семь — поэтому текст обязателен.
   Цвет никогда не единственный носитель: тон + форма значка + подпись.
   -------------------------------------------------------------------------- */

const STATUS_ICON = {
  ok: 'ok',
  'below-reserve': 'partial',
  'below-fba': 'partial',
  'no-horizon': 'partial',
  inactive: 'partial',
  oos: 'error',
  unrecoverable: 'error',
};

export function statusBadge(status, { withIcon = true, withText = true } = {}) {
  const code = STATUS_ICON[status] ? status : 'inactive';
  const label = t(`oos.status.${code}`);
  const badge = el('span', {
    class: `oos-badge oos-badge--${code}`,
    'data-status': code,
  });
  if (withIcon) badge.appendChild(statusIcon(STATUS_ICON[code]));
  // Даже без видимого текста плашка обязана иметь доступное имя: значок
  // помечен aria-hidden, и без этой строки её бы просто не озвучили.
  badge.appendChild(el('span', {
    class: withText ? 'oos-badge__text' : 'visually-hidden',
    text: label,
  }));
  return badge;
}

/** Легенда статусов: марка, название, описание. */
export function statusLegend(statuses = HEAT_TONES) {
  const box = el('div', {
    class: 'oos-legend',
    role: 'list',
    'aria-label': t('oos.legend.title'),
  });
  for (const status of statuses) {
    box.appendChild(el('span', { class: 'oos-legend__item', role: 'listitem' }, [
      el('span', {
        class: 'oos-legend__key oos-legend__key--rect',
        'data-tone': status,
        'aria-hidden': 'true',
      }),
      el('span', { class: 'oos-legend__name', text: t(`oos.status.${status}`) }),
      el('span', { class: 'oos-legend__desc', text: t(`oos.statusDesc.${status}`) }),
    ]));
  }
  return box;
}

/** Легенда каналов ленты заказов: те же три канала, что и в таблице плана. */
export function channelLegend(channels = CHANNELS) {
  const box = el('div', {
    class: 'oos-legend',
    role: 'list',
    'aria-label': t('oos.legend.title'),
  });
  for (const channel of channels) {
    box.appendChild(el('span', { class: 'oos-legend__item', role: 'listitem' }, [
      el('span', {
        class: 'oos-legend__key oos-legend__key--rect',
        'data-channel': channel,
        'aria-hidden': 'true',
      }),
      el('span', { class: 'oos-legend__name', text: t(`oos.channel.${channel}`) }),
    ]));
  }
  return box;
}

/* --------------------------------------------------------------------------
   6. Ячейка тепловой карты
   -------------------------------------------------------------------------- */

/**
 * Ячейка периода: тон + значок (его рисует CSS по `data-tone`) + скрытый
 * текст с полным отчётом. Скрытый текст — не украшение: без него цвет
 * остаётся единственным носителем смысла.
 *
 * `unrecoverable` — четвёртый канал поверх трёх тонов: «красное, но лечится
 * заказом» и «красное, лечить нечем» — разные решения человека.
 */
export function heatCell(cell = {}) {
  const {
    tone = 'ok', unrecoverable = false, focusable = false,
    product = '', market = '', period = null,
    fbaEnd = null, threshold = null, shortfall = null,
  } = cell;

  const parts = [t('oos.heat.cellAria', {
    product,
    market,
    period: formatPeriod(period, true),
    status: t(`oos.status.${tone}`),
    fba: num(fbaEnd),
    threshold: num(threshold),
    gap: shortfall > 0 ? num(shortfall) : t('oos.heat.gapNone'),
  })];
  if (unrecoverable) parts.push(t('oos.heat.unrec'));

  const td = el('td', {
    class: 'oos-heat__cell',
    'data-tone': tone,
    'data-unrec': unrecoverable ? 'true' : null,
    tabindex: focusable ? '0' : '-1',
  }, [
    el('span', { class: 'oos-heat__mark', 'aria-hidden': 'true' }),
    el('span', { class: 'visually-hidden', text: parts.join(' ') }),
  ]);
  return td;
}

/** Строки подсказки для ячейки карты: заголовок первой строкой, `value: null`. */
export function heatTipRows(cell = {}) {
  const gap = cell.shortfall > 0 ? num(cell.shortfall) : t('oos.heat.gapNone');
  return [
    { name: formatPeriod(cell.period, true), value: null },
    { name: t('oos.col.fbaEnd'), value: num(cell.fbaEnd) },
    { name: t('oos.col.threshold'), value: num(cell.threshold) },
    { name: t('oos.col.gap'), value: gap },
  ];
}

/* --------------------------------------------------------------------------
   7. Подсказка

   Нативный `title` появляется через секунду и не стилизуется — для карты и
   ленты этого мало. Подсказка ничего не запирает: каждое её число есть либо
   в скрытом тексте ячейки, либо в таблице-двойнике.
   -------------------------------------------------------------------------- */

export function createTooltip(host) {
  const tip = el('div', { class: 'oos-tip', role: 'status' });
  tip.hidden = true;
  host.appendChild(tip);

  const onKeyDown = (event) => { if (event.key === 'Escape') hide(); };
  document.addEventListener('keydown', onKeyDown);

  function hide() { tip.hidden = true; }

  function show(target, rows) {
    tip.replaceChildren();
    for (const row of rows || []) {
      if (row.value === null || row.value === undefined) {
        tip.appendChild(el('div', { class: 'oos-tip__title', text: String(row.name ?? '') }));
        continue;
      }
      tip.appendChild(el('div', { class: 'oos-tip__row' }, [
        el('span', { class: 'oos-tip__name', text: String(row.name ?? '') }),
        el('span', { class: 'oos-tip__value', text: String(row.value) }),
      ]));
    }
    tip.hidden = false;

    /* В jsdom все прямоугольники нулевые — арифметика обязана это пережить,
       как её переживает charts.js: Math.max/min со всеми нулями дают ноль,
       а не NaN. */
    const box = host.getBoundingClientRect();
    const cell = target?.getBoundingClientRect?.() ?? { left: 0, top: 0, width: 0, height: 0 };
    const w = tip.offsetWidth || 0;
    const h = tip.offsetHeight || 0;
    const x = cell.left - box.left + cell.width / 2;
    const y = cell.top - box.top;
    const left = Math.min(Math.max(x - w / 2, 8), Math.max(8, box.width - w - 8));
    const top = Math.min(Math.max(y - h - 10, 8), Math.max(8, box.height - h - 8));
    tip.style.transform = `translate(${left}px, ${top}px)`;
  }

  return {
    node: tip,
    show,
    hide,
    dispose() {
      document.removeEventListener('keydown', onKeyDown);
      tip.remove();
    },
  };
}

/* --------------------------------------------------------------------------
   8. Фильтры для зоны controls

   Все три возвращают {node, sync, dispose}. `sync()` проставляет значения из
   модульного состояния — он нужен после перерисовки соседями, `dispose()`
   снимает слушатели: без него при переключении разделов копятся наблюдатели.
   -------------------------------------------------------------------------- */

/**
 * Сегментированный переключатель — один конструктор на весь раздел.
 *
 * `role="radiogroup"` обещает поведение переключателя, а не трёх кнопок:
 * ровно одна остановка Tab на группу, стрелки переносят выбор. Без этого
 * скринридер объявляет группу переключателей, у которой ни стрелки не
 * работают, ни выбранный элемент не находится с первого раза. Такой же
 * конструктор давно работает в «Интеграциях» — здесь он общий.
 *
 * Клик слушает КАЖДАЯ кнопка, а не контейнер: делегирование ломается на
 * событиях без всплытия, а именно такие шлёт проверка монтажа.
 */
export function segmentedGroup({ values, onPick, label = null, labelledBy = null }) {
  const group = el('div', { class: 'segmented', role: 'radiogroup' });
  if (labelledBy) group.setAttribute('aria-labelledby', labelledBy);
  else if (label) group.setAttribute('aria-label', label);

  const buttons = [];
  const listeners = [];
  for (const item of values) {
    const button = el('button', {
      type: 'button', class: 'segmented__item', role: 'radio',
      'data-value': item.value, 'aria-checked': 'false', text: item.label,
    });
    const onClick = () => onPick(item.value);
    button.addEventListener('click', onClick);
    listeners.push([button, 'click', onClick]);
    buttons.push({ value: item.value, button });
    group.appendChild(button);
  }

  const onKey = (event) => {
    const i = buttons.findIndex(({ button }) => button === event.target);
    if (i < 0 || !buttons.length) return;
    let next = i;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (i + 1) % buttons.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (i - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else return;
    event.preventDefault();
    onPick(buttons[next].value);
    buttons[next].button.focus();
  };
  group.addEventListener('keydown', onKey);
  listeners.push([group, 'keydown', onKey]);

  /** Роверный tabindex: выбранная кнопка — единственная остановка Tab. */
  function sync(value) {
    let hit = false;
    for (const { value: own, button } of buttons) {
      const on = own === value;
      if (on) hit = true;
      button.setAttribute('aria-checked', String(on));
      button.tabIndex = on ? 0 : -1;
    }
    // Не выбрано ничего — группа обязана остаться достижимой с клавиатуры.
    if (!hit && buttons.length) buttons[0].button.tabIndex = 0;
  }

  return {
    node: group,
    sync,
    dispose() {
      for (const [target, type, handler] of listeners) target.removeEventListener(type, handler);
    },
  };
}

/**
 * Рынок: DE · UK · Оба.
 *
 * Обёртка — `div`, а не `label`: `<label>` вокруг группы кнопок пересылает
 * клик по подписи на первую кнопку, и человек, ткнувший в слово «Рынок»,
 * молча получал бы фильтр DE. Связь подписи с группой — через
 * `aria-labelledby`.
 */
export function marketFilter(onChange) {
  const labelId = uid('oos-market');
  const group = segmentedGroup({
    labelledBy: labelId,
    values: MARKET_VALUES.map((value) => ({
      value, label: value === 'both' ? t('oos.filter.market.both') : value,
    })),
    onPick: (value) => {
      setMarketFilter(value);
      group.sync(marketValue);
      onChange?.(marketValue);
    },
  });
  group.sync(marketValue);

  const node = el('div', { class: 'filters__group' }, [
    el('span', { class: 'filters__label', id: labelId, text: t('oos.filter.market') }),
    group.node,
  ]);

  return {
    node,
    sync() { group.sync(marketValue); },
    dispose() { group.dispose(); },
  };
}

/**
 * Товар: обычный `<select>` на 15 вариантов. Поле поиска на таком списке —
 * лишний слой между человеком и данными. Неактивные пары сюда не попадают:
 * их место в блоке «Неактивные товары» страницы «Обзор».
 */
export function productPicker(items, onChange) {
  const labelId = uid('oos-product');
  const select = el('select', { class: 'select oos-pick', id: labelId });
  const list = Array.isArray(items) ? items : [];

  for (const it of list) {
    select.appendChild(el('option', {
      value: selectionKey(it.market, it.sku),
      text: `${it.sku} · ${pickTitle(it.title)} · ${it.market}`,
    }));
  }

  const onSelect = () => {
    const [market, sku] = String(select.value).split(':');
    setSelection(market, sku);
    onChange?.(getSelection());
  };
  select.addEventListener('change', onSelect);

  function sync() {
    const current = resolveSelection(list);
    if (current) select.value = selectionKey(current.market, current.sku);
  }
  sync();

  const node = el('label', { class: 'filters__group', for: labelId }, [
    el('span', { class: 'filters__label', text: t('oos.filter.product') }),
    select,
  ]);

  return { node, sync, dispose() { select.removeEventListener('change', onSelect); } };
}

/** Канал плана заказов: все / прямая поставка / пополнение препа / ускорение. */
export function channelFilter(onChange) {
  const labelId = uid('oos-channel');
  const select = el('select', { class: 'select oos-channel', id: labelId });
  select.appendChild(el('option', { value: 'all', text: t('oos.filter.channel.all') }));
  for (const channel of CHANNELS) {
    select.appendChild(el('option', { value: channel, text: t(`oos.channel.${channel}`) }));
  }

  const onSelect = () => {
    setChannelFilter(select.value);
    sync();
    onChange?.(channelValue);
  };
  select.addEventListener('change', onSelect);

  function sync() { select.value = channelValue; }
  sync();

  const node = el('label', { class: 'filters__group', for: labelId }, [
    el('span', { class: 'filters__label', text: t('oos.filter.channel') }),
    select,
  ]);

  return { node, sync, dispose() { select.removeEventListener('change', onSelect); } };
}

/* --------------------------------------------------------------------------
   9. Панель параметров расчёта

   Панель лежит в теле страницы, а не в `controls`: десяток полей ломает
   флекс-строку шапки, да и `mount-check` дёргает всё, что лежит в controls, —
   проверка перещёлкивала бы горизонт и модель роста на каждом прогоне.

   Панель собирается один раз за mount() и по `onParamsChange` НЕ
   пересобирается: ввод «1.5» проходит через промежуточное «1.», и
   перерисовка на каждом нажатии вырвала бы фокус из поля. Перерисовывается
   тело страницы; панель — только `sync()` и только после сброса.
   -------------------------------------------------------------------------- */

/**
 * Группа панели: подпись, контрол и необязательная приписка.
 * Подпись ВСЕГДА получает `id`, даже когда она не `<label>`: без него
 * группу переключателей нечем назвать, и скринридер объявляет её безымянной.
 */
function paramGroup(labelKey, control, hintText = null, labelFor = null) {
  const labelId = uid('oos-lbl');
  const label = el(labelFor ? 'label' : 'div', {
    class: 'oos-params__label',
    id: labelId,
    for: labelFor,
    text: t(labelKey),
  });
  const node = el('div', { class: 'oos-params__group' }, [label, control]);
  let hint = null;
  if (hintText !== null) {
    hint = el('p', { class: 'oos-params__hint', text: hintText });
    node.appendChild(hint);
  }
  return { node, labelId, hint };
}

function numberInput(id, { step, min }) {
  return el('input', {
    type: 'number', class: 'input oos-params__number', id,
    step: String(step), min: String(min), inputmode: 'decimal',
  });
}

/* Ввод по `change`, а не по `input`: иначе пересчёт пошёл бы на каждой
   цифре, а «1.» посреди набора «1.5» откатился бы к базовому значению.

   Пустое поле и мусор дают базовое значение, а НЕ `null`: `normalizeParams`
   приводит значение через `Number()`, а `Number(null)` — это ноль, и порог
   FBA молча стал бы нулевым. `sync()` после этого возвращает полю то, что
   расчёт реально принял. */
function readNumber(input, fallback) {
  const text = String(input.value ?? '').trim().replace(',', '.');
  const typed = text === '' ? Number.NaN : Number(text);
  if (Number.isFinite(typed)) return typed;
  // У `input[type=number]` браузер чистит недопустимый ввод сам, и в
  // `value` остаётся пустая строка — тогда спрашиваем valueAsNumber.
  const native = input.valueAsNumber;
  return Number.isFinite(native) ? native : fallback;
}

/* --------------------------------------------------------------------------
   9.1. Фабрики полей панели

   Каждый контрол — самостоятельная фабрика вида {nodes, sync(p), dispose()}.
   Панель из них только собирается: раньше все одиннадцать жили одним телом
   на 235 строк, и «поправить округление» означало проехать глазами мимо
   порогов, роста и препцентров.
   -------------------------------------------------------------------------- */

/** Два порога §8: на FBA отдельно, на сумму AWD и препа. */
function thresholdFields(bind) {
  const fbaId = uid('oos-th-fba');
  const fbaInput = numberInput(fbaId, { step: 0.5, min: 0 });
  bind.number(fbaInput, 'thresholdFbaMonths');
  const fba = paramGroup('oos.params.thresholdFba', fbaInput, null, fbaId);

  const resId = uid('oos-th-res');
  const resInput = numberInput(resId, { step: 0.5, min: 0 });
  bind.number(resInput, 'thresholdReserveMonths');
  const res = paramGroup('oos.params.thresholdReserve', resInput, null, resId);

  return {
    nodes: [fba.node, res.node],
    sync(p) {
      fbaInput.value = String(p.thresholdFbaMonths);
      resInput.value = String(p.thresholdReserveMonths);
    },
  };
}

/** Лид-тайм §10 и лаг «преп → FBA» §9.4. */
function leadTimeFields(bind) {
  const leadId = uid('oos-lead');
  const leadInput = numberInput(leadId, { step: 0.5, min: 0 });
  bind.number(leadInput, 'leadTimeMonths');
  // Слагаемые лид-тайма отдельными полями не выносятся — только подписью.
  const lead = paramGroup('oos.params.leadTime', leadInput, ' ', leadId);

  const lagId = uid('oos-lag');
  const lagInput = numberInput(lagId, { step: 1, min: 0 });
  bind.number(lagInput, 'prepLagDays');
  const lag = paramGroup('oos.params.prepLag', lagInput, ' ', lagId);

  return {
    nodes: [lead.node, lag.node],
    sync(p) {
      leadInput.value = String(p.leadTimeMonths);
      lagInput.value = String(p.prepLagDays);
      lead.hint.textContent = t('oos.params.leadTimeHint', {
        p: months(p.leadTimeProductionMonths), s: months(p.leadTimeShippingMonths),
      });
      // Лаг у складов разный (AsiaLog — 45 дней), и запасное значение поля
      // без этой приписки выдавало бы себя за общий лаг расчёта.
      lag.hint.textContent = t('oos.params.prepLagHint', { list: prepLagSummary(p) });
    },
  };
}

/** §5: откуда берётся базовый run-rate t30. */
function t30Fields(bind) {
  const group = segmentedGroup({
    values: ENUMS.t30Source.map((mode) => ({ value: mode, label: t(`oos.params.t30.${mode}`) })),
    onPick: (mode) => bind.set('t30Source', mode),
  });
  bind.own(group);
  const box = paramGroup('oos.params.t30Source', group.node, t('oos.params.t30Hint'));
  group.node.setAttribute('aria-labelledby', box.labelId);
  return { nodes: [box.node], sync(p) { group.sync(p.t30Source); } };
}

/** §7: модель роста плюс поле единого процента. */
function growthFields(bind) {
  const group = segmentedGroup({
    values: ENUMS.growthMode.map((mode) => ({ value: mode, label: t(`oos.params.growth.${mode}`) })),
    onPick: (mode) => bind.set('growthMode', mode),
  });
  bind.own(group);
  const box = paramGroup('oos.params.growth', group.node, ' ');
  group.node.setAttribute('aria-labelledby', box.labelId);

  const fixedId = uid('oos-growth-fixed');
  const fixedInput = numberInput(fixedId, { step: 1, min: 0 });
  // В параметрах рост — множитель (1.05), в поле — проценты в месяц (5).
  bind.on(fixedInput, 'change', () => {
    const base = (getDefaults().growthFixed - 1) * 100;
    bind.set('growthFixed', 1 + readNumber(fixedInput, base) / 100);
  });
  const fixedWrap = el('div', { class: 'oos-params__sub' }, [
    el('label', { class: 'oos-params__label', for: fixedId, text: t('oos.params.growthFixed') }),
    fixedInput,
  ]);
  box.node.appendChild(fixedWrap);

  return {
    nodes: [box.node],
    sync(p) {
      group.sync(p.growthMode);
      fixedInput.value = String(Math.round((p.growthFixed - 1) * 1000) / 10);
      fixedWrap.hidden = p.growthMode !== 'fixed';
      box.hint.textContent = t('oos.params.growthClamp', {
        min: num(p.growthMin, 2), max: num(p.growthMax, 2),
      });
    },
  };
}

/* §6: «для всех / не применять» и «excess / весь объём» — один выбор из трёх,
   «не применять» снимает и второй вопрос. */
function primeDayFields(bind) {
  const group = segmentedGroup({
    values: ENUMS.primeDayMode.map((mode) => ({ value: mode, label: t(`oos.params.primeDay.${mode}`) })),
    onPick: (mode) => bind.set('primeDayMode', mode),
  });
  bind.own(group);
  const box = paramGroup('oos.params.primeDay', group.node);
  group.node.setAttribute('aria-labelledby', box.labelId);
  return { nodes: [box.node], sync(p) { group.sync(p.primeDayMode); } };
}

/* §3.4: препцентры. Выбор пишется только через togglePrepCenter — у набора
   один хозяин, и своего списка раздел не заводит. */
function prepCenterFields(bind) {
  const box = el('div', { class: 'oos-params__group' }, [
    el('div', { class: 'oos-params__label', text: t('oos.params.prepCenters') }),
  ]);
  const boxes = [];
  const byMarket = new Map();
  for (const [id, center] of Object.entries(PREP_CENTERS)) {
    if (!byMarket.has(center.market)) byMarket.set(center.market, []);
    byMarket.get(center.market).push([id, center]);
  }
  for (const [market, centers] of byMarket) {
    const set = el('fieldset', { class: 'oos-params__checks' }, [
      el('legend', { class: 'oos-params__market', text: market }),
    ]);
    for (const [id, center] of centers) {
      const boxId = uid('oos-prep');
      const input = el('input', { type: 'checkbox', id: boxId, 'data-prep': id });
      bind.on(input, 'change', () => togglePrepCenter(market, id, input.checked));
      boxes.push({ market, id, input });
      set.appendChild(el('label', { class: 'oos-params__check', for: boxId }, [
        input, el('span', { text: `${center.name} · ${t('oos.days', { n: num(center.lagDays) })}` }),
      ]));
    }
    box.appendChild(set);
  }
  box.appendChild(el('p', { class: 'oos-params__hint', text: t('oos.params.prepCentersHint') }));
  return {
    nodes: [box],
    sync(p) { for (const { market, id, input } of boxes) input.checked = isPrepSelected(market, id, p); },
  };
}

/** Горизонт прогноза. */
function horizonField(bind) {
  const id = uid('oos-horizon');
  const select = el('select', { class: 'select', id });
  for (const h of HORIZONS) {
    select.appendChild(el('option', { value: h.id, text: t(`oos.params.horizon.${h.id}`) }));
  }
  bind.on(select, 'change', () => {
    // Явная дата из данных перестаёт действовать, как только человек тронул
    // селектор: иначе выбор «6 месяцев» молча не сработал бы.
    setParams({ horizon: select.value, horizonEnd: null });
  });
  const box = paramGroup('oos.params.horizon', select, null, id);
  return { nodes: [box.node], sync(p) { select.value = p.horizon; } };
}

/** §10.1: шаг округления по рынкам, он же минимальный объём партии. */
function roundingFields(bind) {
  const box = el('div', { class: 'oos-params__group' }, [
    el('div', { class: 'oos-params__label', text: t('oos.params.rounding') }),
  ]);
  const inputs = [];
  for (const market of Object.keys(getParams().roundingStep ?? { DE: 100, UK: 50 })) {
    const stepId = uid('oos-round');
    const input = numberInput(stepId, { step: 10, min: 1 });
    bind.on(input, 'change', () => {
      // Слияние по первому уровню: правка DE не затирает UK.
      const base = getDefaults().roundingStep?.[market];
      setParams({ roundingStep: { [market]: readNumber(input, base) } });
    });
    inputs.push({ market, input });
    box.appendChild(el('div', { class: 'oos-params__sub' }, [
      el('label', {
        class: 'oos-params__label', for: stepId,
        text: t('oos.params.roundingMarket', { market }),
      }),
      input,
    ]));
  }
  return {
    nodes: [box],
    sync(p) { for (const { market, input } of inputs) input.value = String(p.roundingStep?.[market] ?? ''); },
  };
}

/**
 * Перечень лагов выбранных препцентров: «WM / Eichenzell 7 дн.».
 * Одно место на шапку страницы и на подпись поля: лаг у складов разный, а
 * раньше и шапка, и карточка показывали общий запасной `prepLagDays`, пока
 * расчёт брал 45 дней конкретного склада.
 */
function prepLagSummary(params = getParams()) {
  const parts = [];
  for (const [id, center] of Object.entries(PREP_CENTERS)) {
    if (!isPrepSelected(center.market, id, params)) continue;
    const lag = params.prepLagByCenter?.[id] ?? center.lagDays ?? params.prepLagDays;
    parts.push(`${center.name} ${days(lag)}`);
  }
  // Ни одного склада не выбрано — подстраховки не будет вовсе, и общий лаг
  // тогда единственное, что можно назвать честно.
  return parts.length ? parts.join(' · ') : t('oos.params.prepLagNone', { n: days(params.prepLagDays) });
}

export function paramsPanel() {
  const node = el('section', { class: 'card panel oos-params', id: 'oos-params' });
  node.hidden = !panelOpen;

  node.appendChild(el('div', { class: 'panel__header' }, [
    el('div', { class: 'panel__titles' }, [
      el('h2', { class: 'panel__title', text: t('oos.params.title') }),
      el('p', { class: 'panel__subtitle', text: t('oos.params.lead') }),
    ]),
  ]));
  node.appendChild(el('p', { class: 'oos-params__hint', text: t('oos.thresholds.note') }));

  const grid = el('div', { class: 'oos-params__grid' });
  node.appendChild(grid);

  const listeners = [];
  const owned = [];
  const bind = {
    on(target, type, handler) {
      target.addEventListener(type, handler);
      listeners.push([target, type, handler]);
    },
    own(widget) { owned.push(widget); },
    set(key, value) { setParam(key, value); sync(); },
    number(input, key) {
      bind.on(input, 'change', () => { setParam(key, readNumber(input, getDefaults()[key])); sync(); });
    },
  };

  const fields = [
    thresholdFields(bind),
    leadTimeFields(bind),
    t30Fields(bind),
    growthFields(bind),
    primeDayFields(bind),
    prepCenterFields(bind),
    horizonField(bind),
    roundingFields(bind),
  ];
  for (const field of fields) for (const child of field.nodes) grid.appendChild(child);

  const resetBtn = el('button', {
    type: 'button', class: 'btn btn--ghost oos-params__reset', text: t('oos.params.reset'),
  });
  bind.on(resetBtn, 'click', () => { resetParams(); sync(); });
  node.appendChild(el('div', { class: 'oos-params__foot' }, [
    resetBtn,
    el('p', { class: 'oos-params__hint', text: t('oos.params.notExposed') }),
    el('p', { class: 'oos-params__hint', text: t('oos.params.appliedTo') }),
  ]));

  /** Проставляет в контролы то, что расчёт реально принял. */
  function sync() {
    const p = getParams();
    for (const field of fields) field.sync(p);
  }
  sync();

  return {
    node,
    sync,
    dispose() {
      for (const [target, type, handler] of listeners) target.removeEventListener(type, handler);
      for (const widget of owned) widget.dispose();
    },
  };
}

/**
 * Кнопка «Параметры расчёта» для зоны controls.
 * Escape внутри панели закрывает её и возвращает фокус на кнопку — иначе
 * фокус остаётся в скрытом поддереве, и клавиатура упирается в никуда.
 */
export function paramsButton(panelNode) {
  const node = el('button', {
    type: 'button',
    class: 'btn btn--ghost oos-params-btn',
    'aria-controls': panelNode?.id || 'oos-params',
    'aria-expanded': String(panelOpen),
    text: panelOpen ? t('oos.params.close') : t('oos.params.open'),
  });

  function paint() {
    node.setAttribute('aria-expanded', String(panelOpen));
    node.textContent = panelOpen ? t('oos.params.close') : t('oos.params.open');
    if (panelNode) panelNode.hidden = !panelOpen;
  }

  const onClick = () => { setPanelOpen(!panelOpen); paint(); };
  node.addEventListener('click', onClick);

  const onKeyDown = (event) => {
    if (event.key !== 'Escape' || !panelOpen) return;
    setPanelOpen(false);
    paint();
    node.focus();
  };
  panelNode?.addEventListener('keydown', onKeyDown);
  paint();

  return {
    node,
    sync: paint,
    dispose() {
      node.removeEventListener('click', onClick);
      panelNode?.removeEventListener('keydown', onKeyDown);
    },
  };
}

/* --------------------------------------------------------------------------
   10. Мелкая разметка
   -------------------------------------------------------------------------- */

/** Ряд плиток из готовых `statTile`. */
export function kpiRow(tiles) {
  return el('section', { class: 'kpi-grid' }, tiles.filter(Boolean));
}

/** Раскрывающееся объяснение: сводка видна всегда, текст — по требованию. */
export function explain(titleKey, bodyKey, vars = undefined) {
  return el('details', { class: 'oos-explain' }, [
    el('summary', { class: 'oos-explain__summary', text: t(titleKey) }),
    el('p', { class: 'oos-explain__body', text: t(bodyKey, vars) }),
  ]);
}

/** Пустое состояние карточкой: причина словами и, если есть, имя файла. */
export function emptyState(key, hintKey = null, { code = null, vars = undefined } = {}) {
  const box = el('div', { class: 'card state' }, [
    el('p', { text: t(key, vars) }),
  ]);
  if (hintKey) {
    const hint = el('p', { text: t(hintKey, vars) });
    // `.state code` уже оформлен в crm.css — своего класса имени файла не нужно.
    if (code) {
      hint.appendChild(document.createTextNode(' '));
      hint.appendChild(el('code', { text: code }));
    }
    box.appendChild(hint);
  }
  return box;
}

/**
 * Заглушка на случай, когда демо-данные не загрузились.
 * Имя файла показывается прямо: «не загрузилось» без адреса — не диагноз.
 */
export function dataErrorState() {
  return emptyState('oos.empty.data', 'oos.empty.dataHint', { code: DATA_URL });
}

/* Дата расчёта непригодна — считать нечего, и все три страницы обязаны
   сказать это словами, а не показать сетку нулей. Раньше проверку делал
   только «Обзор», а «Карточка» и «Заказы» рисовали полный макет с нулями:
   «Заказов не требуется» на неразобранной дате — прямая неправда. */
const FATAL_FLAGS = ['no-as-of', 'bad-as-of'];

/**
 * Заглушка фатального флага или `null`, если расчёт состоялся.
 * @param {object|null} result — результат `computeAll`.
 */
export function fatalState(result) {
  const fatal = ((result && result.flags) || []).find((f) => FATAL_FLAGS.includes(f.code));
  return fatal ? emptyState(`oos.flag.${fatal.code}`, 'oos.empty.dataHint', { code: DATA_URL }) : null;
}

/**
 * Скрытая живая область страницы.
 * Перерисовка после смены параметра сносит семь панелей и не издаёт ни
 * звука: человек со скринридером менял порог и не получал подтверждения,
 * что что-то произошло. Узел живёт ВНЕ перерисовываемых блоков — иначе
 * сообщение исчезало бы вместе с ним, не успев прозвучать.
 */
export function liveRegion() {
  const node = el('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
  return {
    node,
    say(text) {
      // Тот же текст подряд не объявляется повторно: сначала пусто, потом
      // строка — иначе повтор порога «1,5» проходит молча.
      node.textContent = '';
      if (text) node.textContent = String(text);
    },
  };
}

/**
 * Адрес активного элемента внутри перерисовываемой области и возврат фокуса
 * по этому адресу.
 *
 * Перерисовка выбрасывает узел, на котором стоял фокус, и он уезжает в
 * `<body>`: обход с клавиатуры после каждого клика по заголовку сортировки
 * начинался заново с начала страницы.
 */
export function focusAddress(root) {
  const active = document.activeElement;
  if (!active || !root.contains(active) || active === root) return null;
  const sort = active.closest?.('.oos-sort');
  if (sort) return { kind: 'sort', key: sort.getAttribute('data-key') };
  const cell = active.closest?.('.oos-heat__cell');
  if (cell) return { kind: 'heat', r: cell.getAttribute('data-r'), c: cell.getAttribute('data-c') };
  return null;
}

export function restoreFocus(root, address) {
  if (!address) return false;
  let node = null;
  if (address.kind === 'sort') node = root.querySelector(`.oos-sort[data-key="${address.key}"]`);
  if (address.kind === 'heat') {
    node = root.querySelector(`.oos-heat__cell[data-r="${address.r}"][data-c="${address.c}"]`);
    // Ячейка карты доступна только одна — роверный tabindex надо перенести.
    if (node) {
      const current = root.querySelector('.oos-heat__cell[tabindex="0"]');
      if (current && current !== node) current.setAttribute('tabindex', '-1');
      node.setAttribute('tabindex', '0');
    }
  }
  if (!node) return false;
  node.focus();
  return true;
}

/**
 * Ближайшее «заказать до» по списку пар: дата, чья это строка и совпадает ли
 * она с датой расчёта. Одно правило на «Обзор» и «План заказов» — раньше их
 * было два, и подпись читалась то «сегодня · SQ8 на рынке DE», то наоборот.
 */
export function nearestDeadline(orders, asOf = null) {
  let best = null;
  for (const row of orders || []) {
    if (typeof row.orderBy !== 'string' || !row.orderBy) continue;
    if (!best || row.orderBy < best.orderBy) best = row;
  }
  if (!best) return { date: null, note: null };
  const who = t('oos.kpi.deadlineNote', { sku: best.sku, market: best.market });
  // Срок, совпавший с датой расчёта, — это «сегодня», и сказать это словом
  // обязательно: дата сама по себе читается как запас времени.
  const note = asOf && best.orderBy === asOf ? `${t('oos.kpi.deadlineToday')} · ${who}` : who;
  return { date: best.orderBy, note, row: best };
}

/**
 * Шапка сортируемой таблицы.
 * `aria-sort` живёт на `<th>`, кнопка внутри — только переключатель; стрелку
 * рисует CSS по `aria-sort` родителя.
 */
export function sortableHead(cols, sort = getSort(), onSort = null) {
  const row = el('tr');
  for (const col of cols) {
    const active = col.key === sort.key;
    const th = el('th', {
      scope: 'col',
      class: col.num ? 'num oos-num' : null,
      'aria-sort': col.sortable === false ? null : (active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'),
    });
    if (col.sortable === false) {
      th.textContent = col.label;
    } else {
      const button = el('button', {
        type: 'button', class: 'oos-sort', 'data-key': col.key, text: col.label,
      });
      button.addEventListener('click', () => {
        const dir = active ? (sort.dir === 'asc' ? 'desc' : 'asc') : (col.defaultDir || 'desc');
        setSort(col.key, dir);
        onSort?.(col.key, dir);
      });
      th.appendChild(button);
    }
    row.appendChild(th);
  }
  return el('thead', {}, [row]);
}

/**
 * Раскрашенная ячейка. Тон дублируется значком: цвет один смысл не несёт.
 * Значок рисует CSS по `data-tone`, поэтому в разметке он пустой.
 */
export function toneCell(value, tone = null, { mark = true, className = 'num' } = {}) {
  const td = el('td', { class: className, 'data-tone': tone });
  if (tone && tone !== 'ok' && mark) {
    td.appendChild(el('span', { class: 'oos-forecast__mark', 'aria-hidden': 'true' }));
  }
  td.appendChild(document.createTextNode(typeof value === 'string' ? value : num(value)));
  return td;
}

/**
 * Таблица-двойник графика: те же числа текстом, под `<details>`.
 * Без неё график остаётся единственным носителем значений, а он читается
 * не всеми и не всегда.
 */
export function twinTable({ summaryKey, columns = [], rows = [], tableClass = '' }) {
  const table = el('table', { class: `breakdown ${tableClass}`.trim() });
  /* Имя таблицы — та же подпись, что у раскрывающей её строки: в списке
     таблиц скринридера безымянный двойник неотличим от соседних разбивок. */
  table.appendChild(el('caption', { class: 'visually-hidden', text: t(summaryKey) }));

  const head = el('tr');
  for (const col of columns) {
    head.appendChild(el('th', {
      scope: 'col', class: col.num ? 'num' : null, text: col.label,
    }));
  }
  table.appendChild(el('thead', {}, [head]));

  const body = el('tbody');
  for (const row of rows) {
    const tr = el('tr');
    row.forEach((cell, i) => {
      if (cell instanceof Node) {
        const td = el('td', { class: columns[i]?.num ? 'num' : null });
        td.appendChild(cell);
        tr.appendChild(td);
        return;
      }
      tr.appendChild(el('td', {
        class: columns[i]?.num ? 'num' : null,
        text: cell === null || cell === undefined ? '—' : String(cell),
      }));
    });
    body.appendChild(tr);
  }
  table.appendChild(body);

  return el('details', { class: 'check-card__details' }, [
    el('summary', { text: t(summaryKey) }),
    tableWrap(table),
  ]);
}

/* --------------------------------------------------------------------------
   11. Переход на карточку товара

   `routeFromHash()` берёт всё после `#/` целиком и требует точного совпадения
   с ключом ROUTES: `#/oos-product?sku=DE:SQ1` увёл бы человека на маршрут по
   умолчанию. Поэтому выбор передаётся модульным состоянием, а хеш остаётся
   голым маршрутом — ссылка при этом настоящая, и клавиатура работает сама.
   -------------------------------------------------------------------------- */

export function productHref() { return PRODUCT_ROUTE; }

export function productLink(market, sku, label, className = 'oos-rowlink') {
  const link = el('a', { class: className, href: PRODUCT_ROUTE, text: label ?? sku });
  link.addEventListener('click', () => setSelection(market, sku));
  return link;
}
