/* ==========================================================================
   Раздел «Еженедельный анализ».

   Повторяет структуру исходного документа Sales/schotyzhnevyi-analiz.html:
   четыре вкладки — сводный дашборд и три анализа. Описана в спецификации
   целиком только вкладка «Продажи», BSR и «Органика» ждут подключения API
   сторонних инструментов и остаются честными заглушками.

   ПОЧЕМУ ЗДЕСЬ СТОЛЬКО ПОМЕТ «ПРАВИЛО НЕ ЗАДАНО»
   В исходном документе есть раздел «Відкриті питання»: пятнадцать мест, где
   автор сознательно не стал додумывать за процесс. Раздел ведёт себя так же.
   Помета на экране — не недоделка, а единственный честный вывод там, где
   правила нет: подставленный порог через неделю стал бы «числом из CRM».

   Расчёты живут в ../weekly-analysis-engine.js и про DOM не знают.
   ========================================================================== */

import { t } from '../i18n.js';
import { formatNumber, formatDelta, formatDayShort, formatDateTime } from '../format.js';
import { createLineChart, renderLegend } from '../charts.js';
import {
  buildSeries, baseWeekIndex, flagWeeks, isClean,
  levelAt, factor1At, factor2At, extremes,
  historyDepth, monthlyTrend, byCountry, variationRows,
  FLAG_CATALOG, COLLECTED_FLAGS,
  BAND_TONE, FACTOR1_BANDS, CLEAN_WEEKS_REQUIRED, LOOKBACK_MONTHS, STOCK_POOLS,
} from '../weekly-analysis-engine.js';

const DATA_URL = 'data/weekly-sales.json';
const PROMO_URL = 'data/promotions.json';

/* Порядок вкладок — как в исходном документе: сводка первой, дальше три
   анализа в порядке «Продажи, BSR, Органика». */
const TABS = ['dash', 'sales', 'bsr', 'organic'];

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') node.textContent = value;
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  children.forEach((child) => node.appendChild(child));
  return node;
}

/* --------------------------------------------------------------------------
   Кирпичики
   -------------------------------------------------------------------------- */

function panel(title, subtitle) {
  const box = el('section', { class: 'card panel' });
  box.appendChild(el('div', { class: 'panel__header' }, [
    el('div', { class: 'panel__titles' }, [
      el('h2', { class: 'panel__title', text: title }),
      subtitle ? el('p', { class: 'panel__subtitle', text: subtitle }) : el('span'),
    ]),
  ]));
  return box;
}

function statTile(label, value, note, dark = false) {
  const card = el('article', { class: `card stat${dark ? ' stat--dark' : ''}` });
  card.appendChild(el('div', { class: 'stat__label', text: label }));
  card.appendChild(el('div', { class: 'stat__value', text: value }));
  if (note) card.appendChild(el('div', { class: 'stat__delta', text: note }));
  return card;
}

/**
 * Помета «правило не задано». Намеренно заметная: если она сольётся с
 * обычным примечанием, её перестанут замечать и начнут читать пустое место
 * как посчитанный ноль.
 */
function marker(text) {
  return el('p', { class: 'wa-marker', role: 'note' }, [
    el('span', { class: 'wa-marker__sign', 'aria-hidden': 'true', text: '!' }),
    el('span', { text }),
  ]);
}

function note(text) {
  return el('p', { class: 'wa-note', text });
}

/**
 * Уровень — среднее трёх недель, и у мелких товаров он дробный. Округление
 * до целого показывало «0» рядом с отклонением «−100%», и строка читалась
 * как ошибка расчёта. Ниже десяти штук держим знак после запятой.
 */
function formatLevel(value) {
  return formatNumber(value, Math.abs(value) < 10 ? 1 : 0);
}

/** Подпись недели: «25 мая — 31 мая». */
function weekLabel(week) {
  return `${formatDayShort(week.start)} — ${formatDayShort(week.end)}`;
}

/* --------------------------------------------------------------------------
   Вкладка «Продажи»
   -------------------------------------------------------------------------- */

/**
 * Шкала Фактора 1: семь полос спецификации, текущая — подсвечена.
 *
 * Расходящаяся шкала: просадка и рост — два полюса с нейтральной серединой.
 * Название полосы стоит текстом рядом с каждой полосой, а текущая помечена
 * не только цветом, но и словом: по одному цвету полосу не опознать.
 */
function factor1Scale(activeBand) {
  const box = el('div', { class: 'wa-scale' });
  for (const band of FACTOR1_BANDS) {
    const active = band.id === activeBand;
    const row = el('div', {
      class: `wa-scale__row wa-scale__row--${BAND_TONE[band.id]}${active ? ' is-active' : ''}`,
    });
    row.append(
      el('span', { class: 'wa-scale__range', text: t(`wa.band.range.${band.id}`) }),
      el('span', { class: 'wa-scale__bar', 'aria-hidden': 'true' }),
      el('span', { class: 'wa-scale__name', text: t(`wa.band.${band.id}`) }),
      el('span', { class: 'wa-scale__mark', text: active ? t('wa.factor1.current') : '' }),
    );
    box.appendChild(row);
  }
  return box;
}

/**
 * Таблица-двойник к графику: то же самое без цвета и без наведения.
 * Здесь же видно, какая неделя чистая, — а значит, откуда взялся уровень.
 */
function weeksTable(weeks, flags, marks, levelWeeks) {
  const table = el('table', { class: 'data-table' });
  table.appendChild(el('thead', {}, [el('tr', {}, [
    el('th', { text: t('wa.table.week') }),
    el('th', { class: 'num', text: t('wa.table.units') }),
    el('th', { text: t('wa.table.state') }),
    el('th', { text: t('wa.table.events') }),
  ])]));

  const body = el('tbody');
  for (const week of weeks) {
    const tags = [];
    if (week.partial) tags.push(t('wa.week.partial'));
    else if (isClean(flags, week.index)) tags.push(t('wa.week.clean'));
    else tags.push(t('wa.week.dirty'));
    if (week.index === marks.maxIndex) tags.push(t('wa.week.max'));
    if (week.index === marks.minIndex) tags.push(t('wa.week.min'));
    if (levelWeeks.includes(week.index)) tags.push(t('wa.week.inLevel'));

    // Событий на неделе бывает больше сотни (купоны идут почти всегда) —
    // в таблице стоит счёт по типам, полный список ушёл бы в нечитаемое
    const byKind = new Map();
    for (const flag of flags[week.index] || []) {
      byKind.set(flag.kind, (byKind.get(flag.kind) || 0) + 1);
    }
    const events = [...byKind.entries()]
      .map(([kind, n]) => `${t(`wa.flag.${kind}`)} · ${n}`)
      .join('; ');

    body.appendChild(el('tr', {}, [
      el('td', { text: weekLabel(week) }),
      el('td', { class: 'num', text: formatNumber(week.units) }),
      el('td', { text: tags.join(' · ') }),
      el('td', { text: events || t('wa.table.noEvents') }),
    ]));
  }
  table.appendChild(body);
  return el('div', { class: 'table-wrap' }, [table]);
}

/** Каталог прапорців: что собирается, а что не собирается ниоткуда. */
function flagsPanel() {
  const box = panel(t('wa.flags.title'), t('wa.flags.sub'));

  for (const group of ['ours', 'external']) {
    box.appendChild(el('h3', { class: 'wa-subtitle', text: t(`wa.flags.group.${group}`) }));
    const list = el('ul', { class: 'wa-flags' });
    for (const flag of FLAG_CATALOG.filter((f) => f.group === group)) {
      list.appendChild(el('li', {
        class: `wa-flag${flag.source ? ' wa-flag--collected' : ''}`,
      }, [
        el('span', { class: 'wa-flag__name', text: t(`wa.flag.${flag.id}`) }),
        el('span', {
          class: 'wa-flag__source',
          text: flag.source ? t('wa.flags.hasSource') : t('wa.flags.noSource'),
        }),
      ]));
    }
    box.appendChild(list);
  }

  box.appendChild(marker(t('wa.flags.marker', {
    collected: COLLECTED_FLAGS.length,
    total: FLAG_CATALOG.length,
  })));
  box.appendChild(note(t('wa.flags.openList')));
  return box;
}

function levelPanel(weeks, level) {
  const box = panel(t('wa.level.title'), t('wa.level.sub', {
    n: CLEAN_WEEKS_REQUIRED, months: LOOKBACK_MONTHS,
  }));

  if (level.value === null) {
    // Дословная помета спецификации: расчёт невозможен, нужен ручной просмотр
    box.appendChild(marker(t('wa.level.impossible', {
      reason: t(`wa.level.reason.${level.reason || 'noBase'}`),
    })));
    box.appendChild(note(t('wa.level.manual')));
    return box;
  }

  const list = el('ul', { class: 'wa-list' });
  for (const index of level.weeks) {
    list.appendChild(el('li', {
      text: `${weekLabel(weeks[index])} — ${formatNumber(weeks[index].units)} ${t('wa.units')}`,
    }));
  }
  box.append(
    el('p', { class: 'wa-figure', text: `${formatLevel(level.value)} ${t('wa.units')}` }),
    list,
  );
  return box;
}

function factor2Panel(weeks, factor2) {
  const box = panel(t('wa.factor2.title'), t('wa.factor2.sub'));

  const list = el('ul', { class: 'wa-list' });
  for (const point of factor2.values) {
    const week = weeks[point.index];
    const label = week ? weekLabel(week) : t('wa.factor2.beforeRange');
    const value = point.value === null
      ? t(`wa.level.reason.${point.reason || 'noBase'}`)
      : `${formatLevel(point.value)} ${t('wa.units')}`;
    list.appendChild(el('li', { text: `${label} — ${value}` }));
  }
  box.appendChild(list);

  // Спецификация говорит, ПО ЧЕМУ определяется направление, но не говорит,
  // ПО КАКОМУ правилу. Четыре значения показаны, вердикт не выдуман.
  box.appendChild(marker(t('wa.factor2.marker')));
  return box;
}

function seasonalityPanel(weeks) {
  const depth = historyDepth(weeks);
  const box = panel(t('wa.season.title'), t('wa.season.sub'));

  box.appendChild(el('p', {
    class: 'wa-figure',
    text: t(`wa.season.tier.${depth.tier}`),
  }));
  box.appendChild(note(t('wa.season.depth', { months: depth.months })));

  if (depth.tier === 'lessThanYear') {
    // Единственная ветка, описанная целиком: помесячный ряд для трендовости
    // плюс обязательная пометка «продаётся меньше года».
    box.appendChild(marker(t('wa.season.lessThanYear')));

    const months = monthlyTrend(weeks);
    const table = el('table', { class: 'data-table' });
    table.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { text: t('wa.season.month') }),
      el('th', { class: 'num', text: t('wa.table.units') }),
      el('th', { class: 'num', text: t('wa.season.weeks') }),
    ])]));
    const body = el('tbody');
    for (const month of months) {
      body.appendChild(el('tr', {}, [
        el('td', { text: month.month }),
        el('td', { class: 'num', text: formatNumber(month.units) }),
        el('td', { class: 'num', text: formatNumber(month.weeks) }),
      ]));
    }
    table.appendChild(body);
    box.appendChild(el('div', { class: 'table-wrap' }, [table]));
    box.appendChild(note(t('wa.season.partialMonths')));
  } else {
    box.appendChild(marker(t('wa.season.methodUndefined')));
  }
  return box;
}

/* --------------------------------------------------------------------------
   Вкладка «Дашборд» — общая часть
   -------------------------------------------------------------------------- */

function countryPanel(rows) {
  const box = panel(t('wa.country.title'), t('wa.country.sub'));

  if (!rows.length) {
    box.appendChild(note(t('wa.country.empty')));
    return box;
  }

  const table = el('table', { class: 'data-table' });
  table.appendChild(el('thead', {}, [el('tr', {}, [
    el('th', { text: t('wa.country.market') }),
    el('th', { class: 'num', text: t('wa.table.units') }),
    el('th', { class: 'num', text: t('wa.country.level') }),
    el('th', { class: 'num', text: t('wa.country.deviation') }),
    el('th', { text: t('wa.country.factor1') }),
    el('th', { text: t('wa.country.pool') }),
  ])]));

  const body = el('tbody');
  for (const row of rows) {
    const pool = STOCK_POOLS.uk.includes(row.code) ? 'uk' : 'eu';
    body.appendChild(el('tr', {}, [
      el('td', { text: row.name }),
      el('td', { class: 'num', text: formatNumber(row.units) }),
      el('td', {
        class: 'num',
        text: row.level === null ? '—' : formatLevel(row.level),
      }),
      el('td', {
        class: 'num',
        text: row.deviation === null ? '—' : formatDelta(row.deviation),
      }),
      el('td', {
        text: row.band ? t(`wa.band.${row.band}`) : t(`wa.level.reason.${row.reason || 'noBase'}`),
      }),
      el('td', { text: t(`wa.pool.${pool}`) }),
    ]));
  }
  table.appendChild(body);

  box.appendChild(el('div', { class: 'table-wrap' }, [table]));
  box.appendChild(note(t('wa.country.order')));
  return box;
}

function stockPanel() {
  const box = panel(t('wa.stock.title'), t('wa.stock.sub'));

  const pools = el('div', { class: 'wa-pools' });
  for (const [pool, codes] of Object.entries(STOCK_POOLS)) {
    pools.appendChild(el('article', { class: 'wa-pool' }, [
      el('h3', { class: 'wa-pool__title', text: t(`wa.pool.${pool}`) }),
      el('p', { class: 'wa-pool__body', text: t(`wa.pool.${pool}.body`) }),
      el('p', { class: 'wa-pool__list', text: codes.join(' · ') }),
    ]));
  }
  box.appendChild(pools);

  // Остатков нет ни в одной выгрузке, а порог «проблема с наличием» не задан.
  box.appendChild(marker(t('wa.stock.marker')));
  return box;
}

function variationsPanel(data, marketplace) {
  const box = panel(t('wa.var.title'), t('wa.var.sub'));
  const rows = variationRows(data, { marketplace });

  if (!rows.length) {
    box.appendChild(note(t('wa.var.empty')));
    return box;
  }

  const table = el('table', { class: 'data-table' });
  table.appendChild(el('thead', {}, [el('tr', {}, [
    el('th', { text: t('wa.var.item') }),
    el('th', { text: t('wa.var.level2') }),
    el('th', { class: 'num', text: t('wa.var.baseUnits') }),
  ])]));

  const body = el('tbody');
  for (const family of rows) {
    body.appendChild(el('tr', { class: 'wa-var-parent' }, [
      el('td', { text: family.label }),
      el('td', { text: t('wa.var.parent') }),
      el('td', { class: 'num', text: formatNumber(family.units) }),
    ]));
    for (const child of family.children) {
      body.appendChild(el('tr', {}, [
        el('td', { class: 'wa-var-child', text: child.name }),
        el('td', { text: t('wa.var.child') }),
        el('td', { class: 'num', text: formatNumber(child.units) }),
      ]));
    }
  }
  table.appendChild(body);

  box.appendChild(el('div', { class: 'table-wrap' }, [table]));
  box.appendChild(marker(t('wa.var.marker')));
  return box;
}

function structurePanel() {
  const box = panel(t('wa.structure.title'), t('wa.structure.sub'));
  const list = el('ol', { class: 'wa-list' });
  for (const id of ['sales', 'bsr', 'organic']) {
    list.appendChild(el('li', {}, [
      el('span', { text: t(`wa.tab.${id}`) }),
      el('span', { class: 'wa-chip', text: t(`wa.structure.state.${id}`) }),
    ]));
  }
  box.appendChild(list);
  box.appendChild(note(t('wa.structure.conclusion')));
  return box;
}

/** Заглушка вкладки: заголовок, что здесь будет, и почему пусто. */
function stub(titleKey, leadKey, lines = []) {
  const box = panel(t(titleKey), t(leadKey));
  box.appendChild(el('span', { class: 'wa-badge', text: t('wa.stub.badge') }));
  for (const line of lines) box.appendChild(note(t(line)));
  return box;
}

/* --------------------------------------------------------------------------
   Раздел
   -------------------------------------------------------------------------- */

export const weeklyAnalysis = {
  titleKey: 'wa.title',
  leadKey: 'wa.lead',

  async mount(view, controls) {
    controls.replaceChildren();
    view.replaceChildren(el('div', { class: 'card state', text: t('wa.loading') }));

    let data;
    try {
      const response = await fetch(DATA_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      data = await response.json();
      if (!Array.isArray(data.rows)) throw new Error('нет массива rows');
    } catch {
      view.replaceChildren(el('div', { class: 'card state' }, [
        document.createTextNode(t('wa.noData')),
        el('code', { text: 'python3 scripts/collect_weekly_sales.py' }),
      ]));
      return () => {};
    }

    /* Акции — вспомогательные данные: без них раздел работает, просто без
       трёх прапорців из двадцати, и помета об этом станет только строже. */
    let promotions = null;
    try {
      const response = await fetch(PROMO_URL, { cache: 'no-store' });
      if (response.ok) promotions = await response.json();
    } catch { /* прапорців по акциям не будет */ }

    const state = { tab: 'sales', marketplace: 'all', asins: new Set() };

    /* --- панель управления --- */
    const tabBar = el('div', { class: 'segmented', role: 'radiogroup' });
    const tabButtons = TABS.map((id) => {
      const button = el('button', {
        type: 'button', class: 'segmented__item', role: 'radio',
        text: t(`wa.tab.${id}`), 'aria-checked': String(state.tab === id),
      });
      button.addEventListener('click', () => { state.tab = id; render(); });
      tabBar.appendChild(button);
      return { id, button };
    });

    const marketSelect = el('select', { class: 'select' });
    marketSelect.appendChild(el('option', { value: 'all', text: t('wa.allMarkets') }));
    for (const [code, market] of Object.entries(data.marketplaces || {})) {
      if (code === 'other') continue;
      marketSelect.appendChild(el('option', { value: code, text: market.name }));
    }
    marketSelect.addEventListener('change', () => {
      state.marketplace = marketSelect.value;
      render();
    });

    /* Товар выбирается семьёй вариаций или отдельным ASIN. Семья идёт
       первой строкой группы: анализ спецификации требует обоих уровней, и
       выбор «вся вариация» — это ровно parent-уровень. */
    const productSelect = el('select', { class: 'select' });
    productSelect.appendChild(el('option', { value: '', text: t('wa.allProducts') }));
    for (const [familyId, family] of Object.entries(data.families || {})) {
      const group = el('optgroup', { label: family.label || familyId });
      group.appendChild(el('option', {
        value: `family:${familyId}`, text: t('wa.wholeVariation'),
      }));
      for (const asin of family.asins || []) {
        group.appendChild(el('option', {
          value: `asin:${asin}`, text: data.asins?.[asin]?.name || asin,
        }));
      }
      productSelect.appendChild(group);
    }
    productSelect.addEventListener('change', () => {
      const value = productSelect.value;
      state.asins = new Set();
      if (value.startsWith('family:')) {
        const family = data.families?.[value.slice(7)];
        (family?.asins || []).forEach((asin) => state.asins.add(asin));
      } else if (value.startsWith('asin:')) {
        state.asins.add(value.slice(5));
      }
      render();
    });

    controls.append(
      tabBar,
      el('label', { class: 'filters__group' }, [
        el('span', { class: 'filters__label', text: t('wa.marketplace') }), marketSelect]),
      el('label', { class: 'filters__group' }, [
        el('span', { class: 'filters__label', text: t('wa.product') }), productSelect]),
    );

    /* --- отрисовка --- */
    let chart = null;

    /** График живёт только на вкладке «Продажи»; уходя с неё — уничтожаем,
        иначе наблюдатель за размером остаётся висеть на снятом узле. */
    function dropChart() {
      if (chart) { chart.destroy(); chart = null; }
    }

    function render() {
      tabButtons.forEach(({ id, button }) => {
        button.setAttribute('aria-checked', String(state.tab === id));
      });
      dropChart();

      const weeks = buildSeries(data, state);
      const flags = flagWeeks(weeks, promotions, state);
      const base = baseWeekIndex(weeks);

      if (state.tab === 'dash') return renderDash(weeks, base);
      if (state.tab === 'sales') return renderSales(weeks, flags, base);
      return renderStub(state.tab);
    }

    function renderDash(weeks, base) {
      const blocks = [
        stub('wa.dash.title', 'wa.dash.lead', ['wa.dash.await']),
        structurePanel(),
        countryPanel(byCountry(data, promotions, { asins: state.asins })),
        stockPanel(),
        variationsPanel(data, state.marketplace),
      ];

      if (base >= 0) {
        const tiles = el('div', { class: 'kpi-grid' });
        tiles.appendChild(statTile(
          t('wa.kpi.baseWeek'), weekLabel(weeks[base]),
          t('wa.kpi.baseWeekNote'), true,
        ));
        tiles.appendChild(statTile(
          t('wa.kpi.units'), formatNumber(weeks[base].units), t('wa.kpi.unitsNote'),
        ));
        tiles.appendChild(statTile(
          t('wa.kpi.generatedAt'),
          data.generatedAt ? formatDateTime(data.generatedAt) : t('wa.kpi.unknownTime'),
        ));
        blocks.unshift(tiles);
      }

      view.replaceChildren(...blocks);
    }

    function renderSales(weeks, flags, base) {
      if (base < 0) {
        view.replaceChildren(el('div', { class: 'card state', text: t('wa.noFullWeek') }));
        return;
      }

      const level = levelAt(weeks, flags, base);
      const factor1 = factor1At(weeks, flags, base);
      const factor2 = factor2At(weeks, flags, base);
      const marks = extremes(weeks);

      /* --- плитки --- */
      const tiles = el('div', { class: 'kpi-grid' });
      tiles.appendChild(statTile(
        t('wa.kpi.baseWeek'), weekLabel(weeks[base]),
        `${formatNumber(weeks[base].units)} ${t('wa.units')}`, true,
      ));
      tiles.appendChild(statTile(
        t('wa.kpi.level'),
        level.value === null ? t('wa.kpi.noLevel') : formatLevel(level.value),
        level.value === null
          ? t(`wa.level.reason.${level.reason || 'noBase'}`)
          : t('wa.kpi.levelNote', { n: CLEAN_WEEKS_REQUIRED }),
      ));
      tiles.appendChild(statTile(
        t('wa.kpi.factor1'),
        factor1.band ? t(`wa.band.${factor1.band}`) : t('wa.kpi.notCalculated'),
        factor1.deviation === null ? t('wa.kpi.noBaseline') : formatDelta(factor1.deviation),
      ));
      tiles.appendChild(statTile(
        t('wa.kpi.factor2'), t('wa.kpi.ruleUndefined'), t('wa.kpi.factor2Note'),
      ));

      /* --- график: недели и уровень --- */
      const chartPanel = panel(t('wa.chart.title'), t('wa.chart.sub'));
      const legend = el('div', { class: 'legend' });
      const chartBox = el('div', { class: 'chart-box' });
      chartPanel.append(legend, chartBox);

      /* --- итог по двум факторам --- */
      const verdict = panel(t('wa.verdict.title'), t('wa.verdict.sub'));
      verdict.appendChild(el('ul', { class: 'wa-list' }, [
        el('li', {
          text: `${t('wa.kpi.factor1')}: ${factor1.band
            ? t(`wa.band.${factor1.band}`) : t('wa.kpi.notCalculated')}`,
        }),
        el('li', { text: `${t('wa.kpi.factor2')}: ${t('wa.kpi.ruleUndefined')}` }),
      ]));
      verdict.appendChild(marker(t('wa.verdict.marker')));

      const extremesPanel = panel(t('wa.extremes.title'), t('wa.extremes.sub'));
      if (marks.maxIndex === null) {
        extremesPanel.appendChild(note(t('wa.extremes.none')));
      } else {
        extremesPanel.appendChild(el('ul', { class: 'wa-list' }, [
          el('li', {
            text: `${t('wa.week.max')}: ${weekLabel(weeks[marks.maxIndex])} — `
              + `${formatNumber(weeks[marks.maxIndex].units)} ${t('wa.units')}`,
          }),
          el('li', {
            text: `${t('wa.week.min')}: ${weekLabel(weeks[marks.minIndex])} — `
              + `${formatNumber(weeks[marks.minIndex].units)} ${t('wa.units')}`,
          }),
        ]));
        extremesPanel.appendChild(marker(t('wa.extremes.marker')));
      }

      const factor1Panel = panel(t('wa.factor1.title'), t('wa.factor1.sub'));
      factor1Panel.appendChild(factor1Scale(factor1.band));
      factor1Panel.appendChild(note(t('wa.factor1.bounds')));
      if (factor1.reason) {
        factor1Panel.appendChild(marker(t(`wa.level.reason.${factor1.reason}`)));
      }

      const tablePanel = panel(t('wa.weeks.title'), t('wa.weeks.sub'));
      tablePanel.appendChild(weeksTable(weeks, flags, marks, level.weeks));

      view.replaceChildren(
        tiles, chartPanel, tablePanel,
        levelPanel(weeks, level), factor1Panel, factor2Panel(weeks, factor2),
        verdict, extremesPanel, flagsPanel(), seasonalityPanel(weeks),
      );

      /* График строится после вставки в дерево: до этого ширина нулевая
         и кривая свернулась бы в точку. */
      const full = weeks.filter((w) => !w.partial);
      const series = [{ name: t('wa.chart.units'), values: full.map((w) => w.units) }];
      if (level.value !== null) {
        // Уровень — опорная линия, а не измерение: пунктир, иначе он читается
        // как ещё одна серия продаж.
        series.push({
          name: t('wa.chart.level'),
          values: full.map(() => level.value),
          dash: '5 4',
        });
      }

      chart = createLineChart(chartBox);
      chart.update({
        labels: full.map((w) => formatDayShort(w.start)),
        series,
        emptyText: t('wa.chart.empty'),
        ariaLabel: t('wa.chart.aria'),
      });
      renderLegend(legend, series, { mark: 'line' });
    }

    function renderStub(tab) {
      view.replaceChildren(stub(
        `wa.${tab}.title`, `wa.${tab}.lead`,
        [`wa.${tab}.await`, 'wa.stub.competitorIndex'],
      ));
    }

    render();

    return () => { dropChart(); };
  },
};
