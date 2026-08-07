/* ==========================================================================
   Дашборд «Анализ продаж».

   Выручка и вся расходная часть Amazon за период. Источник — проводки
   Finances API, поэтому доход и комиссии сходятся между собой: они пришли
   из одних и тех же событий.

   Суммы показываются в одной валюте — той, что выбрана фильтром. Пересчёта
   между валютами нет: курса в данных Amazon не приходит, а выдуманный курс
   дал бы число, которое не сойдётся ни с Seller Central, ни с банком.
   ========================================================================== */

import { t } from '../i18n.js';
import {
  loadFinance, sliceRows, listCurrencies, listMarketplaces, dateRange,
  computeSummary, totalsByCategory, breakdownByType, dailySeries, cumulative,
  revenueByMarketplace, REVENUE_CATEGORIES, EXPENSE_CATEGORIES, CREDIT_CATEGORIES,
  PASSTHROUGH_CATEGORIES,
} from '../finance.js';
import { createLineChart, createBarChart, renderLegend } from '../charts.js';
import {
  formatMoney, formatMoneyCompact, formatPercent, formatNumber,
  formatDayShort, formatDayFull, formatDateTime,
} from '../format.js';

const PERIODS = [
  { id: 'ytd', key: 'filters.period.ytd' },
  { id: 'quarter', key: 'filters.period.quarter' },
  { id: 'month', key: 'filters.period.month' },
  { id: 'week', key: 'filters.period.week' },
];

/* Порядок строк отчёта: сначала доход, потом расходы по убыванию значимости */
const REPORT_ORDER = [
  ...REVENUE_CATEGORIES,
  ...EXPENSE_CATEGORIES,
  ...CREDIT_CATEGORIES,
];

export const salesAnalysis = {
  titleKey: 'page.salesAnalysis.title',
  leadKey: 'page.salesAnalysis.lead',

  async mount(view, controls) {
    view.replaceChildren(el('div', { class: 'state', text: t('status.loading') }));

    let data;
    try {
      data = await loadFinance();
    } catch {
      view.replaceChildren(el('div', { class: 'card state', html: [
        document.createTextNode(t('status.noData')),
      ] }));
      return () => {};
    }

    if (!data.rows.length) {
      view.replaceChildren(el('div', { class: 'card state', text: t('status.noData') }));
      return () => {};
    }

    const currencies = listCurrencies(data.rows);
    const state = {
      period: 'ytd',
      currency: currencies[0] || 'EUR',
      marketplace: 'all',
    };

    /* --- панель фильтров в шапке страницы --- */
    controls.replaceChildren();

    const periodGroup = el('div', {
      class: 'segmented', role: 'radiogroup',
      'aria-label': t('filters.period'),
    });
    for (const period of PERIODS) {
      const button = el('button', {
        type: 'button', class: 'segmented__item', role: 'radio',
        text: t(period.key),
        'aria-checked': String(period.id === state.period),
      });
      button.addEventListener('click', () => {
        state.period = period.id;
        [...periodGroup.children].forEach((b) =>
          b.setAttribute('aria-checked', String(b === button)));
        render();
      });
      periodGroup.appendChild(button);
    }
    controls.appendChild(periodGroup);

    const currencySelect = el('select', { class: 'select', 'aria-label': t('filters.currency') });
    for (const code of currencies) currencySelect.appendChild(new Option(code, code));
    currencySelect.value = state.currency;
    currencySelect.addEventListener('change', () => {
      state.currency = currencySelect.value;
      fillMarketplaces();
      state.marketplace = 'all';
      render();
    });
    controls.appendChild(currencySelect);

    const marketplaceSelect = el('select', {
      class: 'select', 'aria-label': t('filters.marketplaceAll'),
    });
    const fillMarketplaces = () => {
      marketplaceSelect.replaceChildren();
      marketplaceSelect.appendChild(new Option(t('filters.marketplaceAll'), 'all'));
      for (const code of listMarketplaces(data.rows, state.currency)) {
        marketplaceSelect.appendChild(new Option(data.marketplaces?.[code] || code, code));
      }
    };
    fillMarketplaces();
    marketplaceSelect.addEventListener('change', () => {
      state.marketplace = marketplaceSelect.value;
      render();
    });
    controls.appendChild(marketplaceSelect);

    /* --- каркас страницы --- */
    const banner = el('div');
    const kpiGrid = el('section', { class: 'kpi-grid' });

    const dynamicsBox = el('div');
    const dynamicsLegend = el('div', { class: 'legend' });
    const dynamicsPanel = panel('chart.dynamics.title', 'chart.dynamics.subtitle',
      [dynamicsLegend, dynamicsBox]);

    const expensesBox = el('div');
    const expensesPanel = panel('chart.expenses.title', 'chart.expenses.subtitle',
      [expensesBox], 'panel--half');

    const marketBox = el('div');
    const marketPanel = panel('chart.byMarketplace.title', 'chart.byMarketplace.subtitle',
      [marketBox], 'panel--half');

    const tableBox = el('div', { class: 'table-wrap' });
    const tablePanel = panel('chart.expenses.title', null, [tableBox]);
    tablePanel.querySelector('.panel__title').textContent = t('table.category');

    const footer = el('p', {
      class: 'workspace__lead',
      style: 'font-size:var(--fs-xs); color:var(--ink-3);',
    });

    view.replaceChildren(
      banner, kpiGrid,
      el('div', { class: 'panels' }, [dynamicsPanel, expensesPanel, marketPanel, tablePanel]),
      footer,
    );

    const charts = {
      dynamics: createLineChart(dynamicsBox),
      expenses: createBarChart(expensesBox),
      market: createBarChart(marketBox),
    };

    /* --- отрисовка --- */
    function render() {
      const rows = sliceRows(data.rows, state);
      const money = (v) => formatMoney(v, state.currency);
      const moneyShort = (v) => formatMoneyCompact(v, state.currency);

      /* Выгрузка ещё идёт — честно предупреждаем, иначе неполные цифры
         выглядят как падение продаж */
      banner.replaceChildren();
      if (data.complete === false) {
        banner.appendChild(el('div', { class: 'banner' }, [
          icon('M12 8v5M12 16.2v.6', true),
          el('span', { text: t('status.partial', { date: data.periodEnd }) }),
        ]));
      }

      const summary = computeSummary(rows);

      /* --- плитки --- */
      kpiGrid.replaceChildren(
        statTile(t('kpi.grossRevenue'), money(summary.revenue)),
        statTile(t('kpi.totalFees'), money(Math.abs(summary.expenses)), 'negative'),
        statTile(t('kpi.netPayout'), money(summary.net), summary.net >= 0 ? 'positive' : 'negative'),
        statTile(t('kpi.feeShare'), formatPercent(summary.feeShare),
          null, `${formatPercent(summary.netShare)} ${t('series.net').toLowerCase()}`),
      );

      /* --- динамика: накопительно, две серии --- */
      const daily = dailySeries(rows);
      const series = [
        { name: t('series.revenue'), values: cumulative(daily.revenue), color: 'var(--series-1)' },
        { name: t('series.expenses'), values: cumulative(daily.expenses), color: 'var(--series-2)' },
      ];
      renderLegend(dynamicsLegend, series, { mark: 'line' });
      charts.dynamics.update({
        labels: daily.dates.map(formatDayShort),
        tooltipTitles: daily.dates.map(formatDayFull),
        series,
        formatValue: moneyShort,
        emptyText: t('chart.noData'),
        ariaLabel: t('chart.dynamics.title'),
      });

      /* --- структура расходов: номинальные статьи, поэтому один цвет --- */
      const totals = totalsByCategory(rows);
      const expenseItems = EXPENSE_CATEGORIES
        .map((category) => ({ label: t(`cat.${category}`), value: Math.abs(totals.get(category) || 0) }))
        .filter((item) => item.value > 0)
        .sort((a, b) => b.value - a.value);

      charts.expenses.update({
        items: expenseItems,
        formatValue: moneyShort,
        valueName: t('kpi.totalFees'),
        emptyText: t('chart.noData'),
        ariaLabel: t('chart.expenses.title'),
      });

      /* --- выручка по площадкам --- */
      charts.market.update({
        items: revenueByMarketplace(rows).map((item) => ({
          label: data.marketplaces?.[item.marketplace] || item.marketplace,
          value: item.amount,
        })),
        formatValue: moneyShort,
        valueName: t('kpi.grossRevenue'),
        emptyText: t('chart.noData'),
        ariaLabel: t('chart.byMarketplace.title'),
      });

      /* --- таблица статей с раскрытием до исходных типов Amazon --- */
      tableBox.replaceChildren(buildBreakdown(rows, totals, summary, money, state));

      const { min, max } = dateRange(rows);
      footer.textContent = [
        `${t('status.period')}: ${min ? formatDayFull(min) : '—'} — ${max ? formatDayFull(max) : '—'}`,
        `${formatNumber(rows.length)} ${t('status.rows')}`,
        `${t('status.updated')}: ${data.generatedAt ? formatDateTime(data.generatedAt) : '—'}`,
      ].join('  ·  ');
    }

    render();
    return () => Object.values(charts).forEach((chart) => chart.destroy());
  },
};

/* --------------------------------------------------------------------------
   Таблица статей
   -------------------------------------------------------------------------- */

function buildBreakdown(rows, totals, summary, money, state) {
  const table = el('table', { class: 'breakdown' });

  table.appendChild(el('thead', {}, [
    el('tr', {}, [
      el('th', { text: t('table.category'), scope: 'col' }),
      el('th', { text: t('table.amount'), class: 'num', scope: 'col' }),
      el('th', { text: t('table.shareOfRevenue'), class: 'num', scope: 'col' }),
    ]),
  ]));

  const tbody = el('tbody');
  const revenue = summary.revenue || 1;

  for (const category of REPORT_ORDER) {
    const amount = totals.get(category);
    if (!amount) continue;

    const share = (Math.abs(amount) / revenue) * 100;
    const details = breakdownByType(rows, category);

    const row = el('tr', { class: 'breakdown__group' });
    const nameCell = el('td');

    // Раскрытие только там, где под статьёй больше одного типа Amazon
    if (details.length > 1) {
      const toggle = el('button', {
        type: 'button',
        class: 'btn btn--ghost',
        style: 'min-height:28px; padding:0 var(--sp-2); font-size:var(--fs-sm);',
        text: `＋ ${t(`cat.${category}`)}`,
        'aria-expanded': 'false',
      });
      const detailRows = details.map((item) => el('tr', { class: 'breakdown__detail', hidden: '' }, [
        el('td', { text: item.type }),
        el('td', { class: `num ${item.amount < 0 ? 'amount--negative' : ''}`, text: money(item.amount) }),
        el('td', { class: 'num', text: formatPercent((Math.abs(item.amount) / revenue) * 100) }),
      ]));

      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!open));
        toggle.textContent = `${open ? '＋' : '−'} ${t(`cat.${category}`)}`;
        detailRows.forEach((r) => { r.hidden = open; });
      });

      nameCell.appendChild(toggle);
      row.appendChild(nameCell);
      row.appendChild(el('td', {
        class: `num ${amount < 0 ? 'amount--negative' : 'amount--positive'}`,
        text: money(amount),
      }));
      row.appendChild(shareCell(share));
      tbody.appendChild(row);
      detailRows.forEach((r) => tbody.appendChild(r));
      continue;
    }

    nameCell.textContent = t(`cat.${category}`);
    row.appendChild(nameCell);
    row.appendChild(el('td', {
      class: `num ${amount < 0 ? 'amount--negative' : 'amount--positive'}`,
      text: money(amount),
    }));
    row.appendChild(shareCell(share));
    tbody.appendChild(row);
  }

  table.appendChild(tbody);

  const tax = totals.get(PASSTHROUGH_CATEGORIES[0]);
  const foot = el('tfoot');
  foot.appendChild(el('tr', { class: 'breakdown__total' }, [
    el('td', { text: t('kpi.netPayout') }),
    el('td', {
      class: `num ${summary.net < 0 ? 'amount--negative' : 'amount--positive'}`,
      text: money(summary.net),
    }),
    el('td', { class: 'num', text: formatPercent(summary.netShare) }),
  ]));
  if (tax) {
    foot.appendChild(el('tr', {}, [
      el('td', { text: t('cat.revenue_tax'), style: 'color:var(--ink-3);' }),
      el('td', { class: 'num', style: 'color:var(--ink-3);', text: money(tax) }),
      el('td', { class: 'num', style: 'color:var(--ink-3);', text: '—' }),
    ]));
  }
  table.appendChild(foot);

  return table;
}

function shareCell(share) {
  const cell = el('td', { class: 'num' });
  const bar = el('span', { class: 'share-bar' });
  bar.style.width = `${Math.max(2, Math.min(100, share) * 0.6)}px`;
  cell.appendChild(bar);
  cell.append(formatPercent(share));
  return cell;
}

/* --------------------------------------------------------------------------
   Мелкие помощники разметки
   -------------------------------------------------------------------------- */

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') node.textContent = value;
    else if (key === 'html') value.forEach((child) => node.appendChild(child));
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  children.forEach((child) => node.appendChild(child));
  return node;
}

function icon(path, warning = false) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', '12'); circle.setAttribute('cy', '12'); circle.setAttribute('r', '9');
  circle.setAttribute('stroke', 'currentColor'); circle.setAttribute('stroke-width', '1.8');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line.setAttribute('d', path);
  line.setAttribute('stroke', 'currentColor');
  line.setAttribute('stroke-width', '1.8');
  line.setAttribute('stroke-linecap', 'round');
  svg.append(circle, line);
  return svg;
}

function statTile(label, value, tone = null, caption = null) {
  const card = el('article', { class: 'card stat' });
  card.appendChild(el('div', { class: 'stat__label', text: label }));
  const valueNode = el('div', { class: 'stat__value', text: value });
  if (tone) valueNode.classList.add(`amount--${tone}`);
  card.appendChild(valueNode);
  if (caption) {
    card.appendChild(el('div', { class: 'stat__delta' }, [el('span', { text: caption })]));
  }
  return card;
}

function panel(titleKey, subtitleKey, children, extraClass = '') {
  const section = el('section', { class: `card panel ${extraClass}`.trim() });
  const header = el('div', { class: 'panel__header' });
  const titles = el('div', { class: 'panel__titles' });
  titles.appendChild(el('h2', { class: 'panel__title', text: t(titleKey) }));
  if (subtitleKey) {
    titles.appendChild(el('p', { class: 'panel__subtitle', text: t(subtitleKey) }));
  }
  header.appendChild(titles);
  section.appendChild(header);
  children.forEach((child) => section.appendChild(child));
  return section;
}
