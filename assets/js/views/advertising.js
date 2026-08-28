/* ==========================================================================
   Раздел «Реклама»: помесячные траты за 12 месяцев против прошлого года.

   Читает data/ads-spend.json — выгрузку из Amazon Ads API (unified reporting,
   месячная гранулярность, аккаунт GermanyProducts24, все 13 площадок EU).

   ПОЧЕМУ ДВА ГРАФИКА, А НЕ ОДИН С ДВУМЯ ОСЯМИ
   Просилось очевидное: столбцы трат и линия ACOS на одном поле. Но у трат и
   ACOS разные единицы (евро и проценты), и совместить их можно только двумя
   осями Y. Две оси произвольны по определению: наклон линии относительно
   столбцов задаётся тем, где рисовальщик поставил ноль второй шкалы, а не
   данными. Одни и те же цифры так можно показать и как «расходы растут
   быстрее отдачи», и как обратное. Поэтому траты и ACOS — два отдельных
   графика с общей осью месяцев, читаются сверху вниз.

   ПОЧЕМУ ТЕКУЩИЙ МЕСЯЦ НЕ НА ГРАФИКЕ
   Он ещё не кончился. Столбец за неполный месяц рядом с полным прошлогодним
   читается как обвал расходов — ровно та же ловушка, из-за которой в разделе
   продаж текущая неделя вынесена из графика. Неполный месяц показан отдельной
   плиткой с пометкой, а сравнение строится по двенадцати полным месяцам.

   ПОЧЕМУ ЕВРО ЗДЕСЬ ОЦЕНОЧНЫЕ
   Первая версия этого файла утверждала, что суммы к евро приводит сам Amazon
   по `currencyOfView=EUR`. Живой отчёт это опроверг: строки приходят разбитыми
   по `budgetCurrency` в родной валюте (EUR, GBP, SEK, PLN), а убрать это поле
   из запроса нельзя — без него не принимаются метрики.

   Значит евро считаем сами. Историю курсов взять неоткуда: fx-rates.json
   держит последние три месяца, а окно тут два года. Поэтому все месяцы
   переводятся ОДНИМ курсом ЕЦБ — это «constant currency»: из сравнения год к
   году убирается валютное движение, и виден собственно рекламный бюджет, а не
   курс фунта. Число оценочное, и в сноске это сказано прямо вместе с датой
   курса. Доля неевровых площадок мала: EUR — около 85% расхода.
   ========================================================================== */

import { t } from '../i18n.js';
import { formatMoney, formatMoneyCompact, formatPercent, formatDelta, formatDateTime } from '../format.js';
import { createGroupedColumnChart, createLineChart, createBarChart, renderLegend } from '../charts.js';

const DATA_URL = 'data/ads-spend.json';

/** Сколько месяцев на графике. Тринадцатый столбец уже не читается. */
const WINDOW = 12;

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
   Разбор данных
   -------------------------------------------------------------------------- */

/** Подпись месяца «сен 25» на языке интерфейса. */
function monthLabel(key, lang) {
  const [year, month] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  const short = new Intl.DateTimeFormat(lang, { month: 'short', timeZone: 'UTC' }).format(date);
  return `${short} ${String(year).slice(2)}`;
}

/** Полное название месяца для подсказки и таблицы. */
function monthFull(key, lang) {
  const [year, month] = key.split('-').map(Number);
  return new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}

/** Ключ месяца за год до заданного: 2026-03 → 2025-03. */
function yearBefore(key) {
  const [year, month] = key.split('-');
  return `${Number(year) - 1}-${month}`;
}

/**
 * ACOS — доля рекламных трат в рекламной выручке.
 * При нулевой выручке возвращается null, а не ноль и не бесконечность:
 * месяц без продаж — это отсутствие показателя, а не ACOS 0%.
 */
function acos(row) {
  if (!row || !(row.sales > 0)) return null;
  return row.spend / row.sales;
}

/**
 * Двенадцать полных месяцев и их прошлогодние двойники.
 * Неполный месяц (обычно текущий) в окно не попадает — он перечислен в
 * data.partial и выносится в отдельную плитку.
 */
function buildWindow(data) {
  const partial = new Set(data.partial || []);
  const byKey = new Map(data.rows.map((row) => [row.m, row]));

  const complete = data.rows
    .map((row) => row.m)
    .filter((key) => !partial.has(key))
    .sort();

  const current = complete.slice(-WINDOW);
  return {
    keys: current,
    now: current.map((key) => byKey.get(key) || null),
    past: current.map((key) => byKey.get(yearBefore(key)) || null),
    running: data.rows.find((row) => partial.has(row.m)) || null,
    runningPast: (() => {
      const key = data.rows.find((row) => partial.has(row.m))?.m;
      return key ? byKey.get(yearBefore(key)) || null : null;
    })(),
  };
}

const sum = (rows, field) => rows.reduce((acc, row) => acc + (row?.[field] || 0), 0);

/* --------------------------------------------------------------------------
   Куски разметки
   -------------------------------------------------------------------------- */

function statTile(label, value, note, dark = false) {
  const card = el('article', { class: `card stat${dark ? ' stat--dark' : ''}` });
  card.appendChild(el('div', { class: 'stat__label', text: label }));
  card.appendChild(el('div', { class: 'stat__value', text: value }));
  if (note) card.appendChild(el('div', { class: 'stat__delta', text: note }));
  return card;
}

function panel(titleKey, subtitle) {
  const box = el('section', { class: 'card panel' });
  const head = el('div', { class: 'panel__head' }, [
    el('h2', { class: 'panel__title', text: t(titleKey) }),
    el('p', { class: 'panel__subtitle', text: subtitle || '' }),
  ]);
  box.appendChild(head);
  return box;
}

/** Таблица-двойник: то же, что на графиках, но читаемое без цвета. */
function monthsTable(win, lang, currency) {
  const table = el('table', { class: 'data-table' });
  const head = el('tr', {}, [
    el('th', { text: t('ads.table.month') }),
    el('th', { class: 'num', text: t('ads.table.spendNow') }),
    el('th', { class: 'num', text: t('ads.table.spendPast') }),
    el('th', { class: 'num', text: t('ads.table.delta') }),
    el('th', { class: 'num', text: t('ads.table.acosNow') }),
    el('th', { class: 'num', text: t('ads.table.acosPast') }),
  ]);
  table.appendChild(el('thead', {}, [head]));

  const body = el('tbody');
  win.keys.forEach((key, i) => {
    const now = win.now[i];
    const past = win.past[i];
    const nowSpend = now?.spend || 0;
    const pastSpend = past?.spend || 0;
    // Прошлогоднего месяца может не быть в выгрузке вовсе — тогда сравнивать
    // не с чем, и прочерк честнее, чем «рост на 100%» от несуществующего нуля
    const delta = past ? (pastSpend > 0 ? (nowSpend - pastSpend) / pastSpend : null) : null;
    const acosNow = acos(now);
    const acosPast = acos(past);

    body.appendChild(el('tr', {}, [
      el('td', { text: monthFull(key, lang) }),
      el('td', { class: 'num', text: formatMoney(nowSpend, currency) }),
      el('td', { class: 'num', text: past ? formatMoney(pastSpend, currency) : '—' }),
      el('td', { class: 'num', text: delta === null ? '—' : formatDelta(delta * 100) }),
      el('td', { class: 'num', text: acosNow === null ? '—' : formatPercent(acosNow * 100) }),
      el('td', { class: 'num', text: acosPast === null ? '—' : formatPercent(acosPast * 100) }),
    ]));
  });
  table.appendChild(body);
  return table;
}

/* --------------------------------------------------------------------------
   Раздел
   -------------------------------------------------------------------------- */

export const advertising = {
  titleKey: 'ads.title',
  leadKey: 'ads.lead',

  async mount(view, controls) {
    controls.replaceChildren();
    view.replaceChildren(el('div', { class: 'card state', text: t('ads.loading') }));

    let data;
    try {
      const response = await fetch(DATA_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      data = await response.json();
    } catch {
      view.replaceChildren(el('div', { class: 'card state' }, [
        el('p', { text: t('ads.error') }),
      ]));
      return () => {};
    }

    if (!data?.rows?.length) {
      view.replaceChildren(el('div', { class: 'card state', text: t('ads.empty') }));
      return () => {};
    }

    const lang = document.documentElement.lang || 'ru';
    const currency = data.currency || 'EUR';
    const win = buildWindow(data);

    const labels = win.keys.map((key) => monthLabel(key, lang));
    const spendNow = win.now.map((row) => row?.spend || 0);
    const spendPast = win.past.map((row) => row?.spend || 0);

    const totalNow = sum(win.now, 'spend');
    const totalPast = sum(win.past, 'spend');
    const salesNow = sum(win.now, 'sales');
    const salesPast = sum(win.past, 'sales');

    /* --- каркас --- */
    const kpis = el('div', { class: 'stat-grid' });

    const spendPanel = panel('ads.chart.spend', t('ads.chart.spendSub'));
    const spendLegend = el('div', { class: 'chart-legend' });
    const spendBox = el('div', { class: 'chart-box' });
    spendPanel.append(spendLegend, spendBox);

    const acosPanel = panel('ads.chart.acos', t('ads.chart.acosSub'));
    const acosLegend = el('div', { class: 'chart-legend' });
    const acosBox = el('div', { class: 'chart-box' });
    acosPanel.append(acosLegend, acosBox);

    const tableBox = el('details', { class: 'check-card__details' });

    const countryPanel = panel('ads.chart.country', t('ads.chart.countrySub'));
    const countryBox = el('div', { class: 'chart-box' });
    countryPanel.appendChild(countryBox);

    const footnote = el('p', { class: 'check-card__note' });

    view.replaceChildren(kpis, spendPanel, acosPanel, tableBox, countryPanel, footnote);

    /* Заглушка обязана кричать о себе. Файл с выдуманными числами внешне
       неотличим от настоящей выгрузки, а репозиторий публичный: молчаливая
       заглушка на живом дашборде — это опубликованная ложь про расходы. */
    if (data.fixture) {
      view.prepend(el('div', { class: 'card state', role: 'alert' }, [
        el('strong', { text: t('ads.fixture.title') }),
        el('p', { text: t('ads.fixture.text') }),
      ]));
    }

    const spendChart = createGroupedColumnChart(spendBox);
    const acosChart = createLineChart(acosBox);
    const countryChart = createBarChart(countryBox);

    /* --- плитки --- */
    const deltaNote = totalPast > 0
      ? t('ads.kpi.vsLastYear', { delta: formatDelta(((totalNow - totalPast) / totalPast) * 100) })
      : t('ads.kpi.noLastYear');

    kpis.appendChild(statTile(t('ads.kpi.total'), formatMoney(totalNow, currency), deltaNote, true));
    kpis.appendChild(statTile(t('ads.kpi.perMonth'),
      formatMoney(win.keys.length ? totalNow / win.keys.length : 0, currency)));

    const acosNow = salesNow > 0 ? totalNow / salesNow : null;
    const acosPast = salesPast > 0 ? totalPast / salesPast : null;
    kpis.appendChild(statTile(
      t('ads.kpi.acos'),
      acosNow === null ? '—' : formatPercent(acosNow * 100),
      acosPast === null ? t('ads.kpi.noLastYear')
        : t('ads.kpi.acosLastYear', { value: formatPercent(acosPast * 100) }),
    ));

    /* Неполный месяц — отдельной плиткой. На графике его столбец рядом с
       полным прошлогодним читался бы как обвал расходов. */
    if (win.running) {
      kpis.appendChild(statTile(
        t('ads.kpi.running', { month: monthFull(win.running.m, lang) }),
        formatMoney(win.running.spend, currency),
        t('ads.kpi.runningNote'),
      ));
    }

    /* --- график трат --- */
    const spendSeries = [
      { name: t('ads.series.now'), values: spendNow, color: 'var(--series-1)' },
      { name: t('ads.series.past'), values: spendPast, color: 'var(--series-2)' },
    ];
    renderLegend(spendLegend, spendSeries, { mark: 'rect' });

    // Разницу год к году считаем здесь, а не в слое рисования: график не
    // обязан знать, что вторая серия — это тот же месяц год назад
    const extraRows = win.keys.map((_, i) => {
      if (!(spendPast[i] > 0)) return [];
      return [{
        color: null,
        name: t('ads.tooltip.delta'),
        value: formatDelta(((spendNow[i] - spendPast[i]) / spendPast[i]) * 100),
      }];
    });

    spendChart.update({
      labels,
      series: spendSeries,
      extraRows,
      tooltipTitles: win.keys.map((key) => monthFull(key, lang)),
      formatValue: (v) => formatMoneyCompact(v, currency),
      emptyText: t('ads.empty'),
      ariaLabel: t('ads.chart.spendAria'),
    });

    /* --- график ACOS --- */
    const acosSeries = [
      { name: t('ads.series.now'), values: win.now.map((row) => (acos(row) ?? 0) * 100), color: 'var(--series-1)' },
      { name: t('ads.series.past'), values: win.past.map((row) => (acos(row) ?? 0) * 100), color: 'var(--series-2)' },
    ];
    renderLegend(acosLegend, acosSeries, { mark: 'line' });

    acosChart.update({
      labels,
      series: acosSeries,
      formatValue: (v) => formatPercent(v, 0),
      emptyText: t('ads.empty'),
      ariaLabel: t('ads.chart.acosAria'),
      height: 240,
    });

    /* --- таблица-двойник --- */
    tableBox.replaceChildren(
      el('summary', { text: t('ads.showTable') }),
      monthsTable(win, lang, currency),
    );

    /* --- разрез по странам --- */
    if (data.byCountry?.length) {
      countryChart.update({
        items: [...data.byCountry]
          .sort((a, b) => b.spend - a.spend)
          .map((row) => ({ label: row.c, value: row.spend })),
        formatValue: (v) => formatMoney(v, currency),
        emptyText: t('ads.empty'),
        ariaLabel: t('ads.chart.countryAria'),
      });
    } else {
      /* Скрывать недоступное нельзя: пустой раздел читается как «по странам
         рекламы нет», хотя на деле её просто не отдаёт этот отчёт. */
      countryBox.replaceChildren(el('p', { class: 'chart-empty', text: t('ads.country.unavailable') }));
    }

    /* --- сноска --- */
    const notes = [
      t('ads.note.generated', { at: formatDateTime(data.generatedAt) }),
      t('ads.note.currency', { date: data.converted?.rateDate || '—' }),
    ];
    if (win.running) notes.push(t('ads.note.running', { month: monthFull(win.running.m, lang) }));
    if (win.past.some((row) => !row)) notes.push(t('ads.note.gaps'));
    footnote.textContent = notes.join(' ');

    return () => {
      spendChart.destroy();
      acosChart.destroy();
      countryChart.destroy();
    };
  },
};
