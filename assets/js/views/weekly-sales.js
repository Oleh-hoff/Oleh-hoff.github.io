/* ==========================================================================
   Раздел «Продажи по неделям».

   Три месяца продаж в разрезе площадки и товара. Читает data/weekly-sales.json,
   который пишет scripts/collect_weekly_sales.py.

   ПОЧЕМУ ГЛАВНАЯ МЕТРИКА — ШТУКИ
   Аккаунт торгует в EUR, GBP, SEK и PLN. Складывать их по взятому со стороны
   курсу — значит показать число, которое не сойдётся ни с Seller Central, ни
   с банком. Штуки складываются по всем тринадцати площадкам без всякого
   курса, поэтому «вместе по всем маркетплейсам» считается в штуках, а деньги
   показываются отдельной строкой на каждую валюту.

   ПОЧЕМУ ТЕКУЩАЯ НЕДЕЛЯ НЕ НА ГРАФИКЕ
   Она ещё не кончилась. Столбец за неполную неделю читается как обвал продаж
   — на этом уже теряли время в разборе промо. Она вынесена в отдельную
   плитку с пометкой, а график строится по完 полным неделям.
   ========================================================================== */

import { t } from '../i18n.js';
import { formatNumber, formatMoney, formatCompact, formatDayShort, formatDateTime } from '../format.js';
import { createStackedColumnChart, createBarChart, renderLegend } from '../charts.js';

const DATA_URL = 'data/weekly-sales.json';
const FX_URL = 'data/fx-rates.json';

/** Значение переключателя валюты «всё в евро». */
const EUR_ALL = '__eur';

/* Больше семи площадок на одном столбце различить нельзя, а восьмой цвет
   палитры уходит под «остальные». Порядок цветов фиксирован: площадка не
   меняет цвет от того, что сосед выпал из фильтра. */
const MAX_SERIES = 7;

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
   Срез данных
   -------------------------------------------------------------------------- */

/** Строки, попавшие под фильтры площадки и товара. */
function sliceRows(data, { marketplace, asins, currency, metric }) {
  return data.rows.filter((row) => {
    if (marketplace !== 'all' && row.m !== marketplace) return false;
    if (asins.size && !asins.has(row.a)) return false;
    // Деньги считаются внутри одной валюты — смешивать их нечем. Исключение
    // одно: режим «всё в евро», где каждая сумма переведена по курсу.
    if (metric === 'money' && currency !== EUR_ALL
        && data.marketplaces[row.m]?.currency !== currency) return false;
    return true;
  });
}

/** Итог по каждой неделе. Индекс массива = индекс недели в data.weeks. */
function weeklyTotals(rows, weekCount, amount) {
  const totals = new Array(weekCount).fill(0);
  for (const row of rows) totals[row.w] += amount(row);
  return totals;
}

/** Ряды по площадкам: топ-N по объёму, остальные — одной серией. */
function marketplaceSeries(data, rows, weekCount, amount) {
  const byMarket = new Map();
  for (const row of rows) {
    if (!byMarket.has(row.m)) byMarket.set(row.m, new Array(weekCount).fill(0));
    byMarket.get(row.m)[row.w] += amount(row);
  }

  const ranked = [...byMarket.entries()]
    .map(([code, values]) => ({ code, values, total: values.reduce((a, b) => a + b, 0) }))
    .filter((s) => s.total > 0)
    .sort((a, b) => b.total - a.total);

  const head = ranked.slice(0, MAX_SERIES);
  const tail = ranked.slice(MAX_SERIES);

  const series = head.map((s) => ({
    name: data.marketplaces[s.code]?.name || s.code,
    values: s.values,
  }));

  if (tail.length) {
    const rest = new Array(weekCount).fill(0);
    tail.forEach((s) => s.values.forEach((v, i) => { rest[i] += v; }));
    series.push({ name: t('sales.otherMarkets', { count: tail.length }), values: rest });
  }
  return series;
}

/** Итоги по семьям вариаций — для столбцов «что продаётся». */
function familyTotals(data, rows, amount) {
  const totals = new Map();
  for (const row of rows) {
    const family = data.asins[row.a]?.family || row.a;
    totals.set(family, (totals.get(family) || 0) + amount(row));
  }
  return [...totals.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id, value]) => ({
      id,
      label: data.families[id]?.label || data.asins[id]?.name || id,
      value,
    }));
}

/** Деньги по каждой валюте отдельно — единственный честный способ их сложить. */
function moneyByCurrency(data, rows) {
  const totals = new Map();
  for (const row of rows) {
    const currency = data.marketplaces[row.m]?.currency;
    if (!currency) continue;
    totals.set(currency, (totals.get(currency) || 0) + row.r);
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}

/* --------------------------------------------------------------------------
   Перевод в евро
   -------------------------------------------------------------------------- */

/**
 * Курс каждой валюты на каждую неделю: среднее по рабочим дням этой недели.
 *
 * Среднее за неделю, а не курс одного дня: продажи размазаны по всей неделе,
 * и брать курс понедельника для субботней выручки — произвол. Если внутри
 * недели курсов нет вовсе (ЕЦБ публикует только по рабочим дням, а история
 * не всегда покрывает край периода), берётся ближайшая известная дата.
 */
function weeklyRates(weeks, fx) {
  if (!fx?.rates) return null;

  const dates = Object.keys(fx.rates).sort();
  if (!dates.length) return null;

  const nearest = (target) => {
    let best = dates[0];
    let bestGap = Infinity;
    for (const date of dates) {
      const gap = Math.abs(new Date(date) - new Date(target));
      if (gap < bestGap) { bestGap = gap; best = date; }
    }
    return best;
  };

  return weeks.map((week) => {
    const inside = dates.filter((date) => date >= week.start && date <= week.end);
    const used = inside.length ? inside : [nearest(week.start)];

    const sums = new Map();
    for (const date of used) {
      for (const [currency, rate] of Object.entries(fx.rates[date] || {})) {
        if (!sums.has(currency)) sums.set(currency, []);
        sums.get(currency).push(rate);
      }
    }
    const out = {};
    for (const [currency, list] of sums) {
      out[currency] = list.reduce((a, b) => a + b, 0) / list.length;
    }
    return { rates: out, exact: inside.length > 0 };
  });
}

/* --------------------------------------------------------------------------
   Фильтр товаров: семья целиком или отдельные ASIN
   -------------------------------------------------------------------------- */

function productFilter(data, selected, onChange) {
  const wrap = el('div', { class: 'picker' });

  const button = el('button', {
    type: 'button', class: 'select picker__button',
    'aria-expanded': 'false', 'aria-haspopup': 'true',
  });
  const panel = el('div', { class: 'picker__panel', hidden: 'hidden' });

  const search = el('input', {
    type: 'search', class: 'input picker__search',
    placeholder: t('sales.filter.search'),
  });
  const list = el('div', { class: 'picker__list' });

  const actions = el('div', { class: 'picker__actions' });
  const clear = el('button', { type: 'button', class: 'btn btn--ghost', text: t('sales.filter.all') });
  clear.addEventListener('click', () => { selected.clear(); onChange(); });
  actions.appendChild(clear);

  panel.append(search, list, actions);

  /* Семьи сортируются по продажам: сверху то, что человек ищет чаще всего. */
  const unitsByAsin = new Map();
  for (const row of data.rows) unitsByAsin.set(row.a, (unitsByAsin.get(row.a) || 0) + row.u);

  const families = Object.entries(data.families)
    .map(([id, family]) => ({
      id,
      label: family.label || id,
      asins: family.asins.filter((a) => unitsByAsin.has(a)),
      units: family.asins.reduce((sum, a) => sum + (unitsByAsin.get(a) || 0), 0),
    }))
    .filter((f) => f.asins.length)
    .sort((a, b) => b.units - a.units);

  function label() {
    if (!selected.size) return t('sales.filter.all');
    const whole = families.filter((f) => f.asins.every((a) => selected.has(a)));
    if (whole.length === 1 && whole[0].asins.length === selected.size) {
      return whole[0].label.slice(0, 40);
    }
    return t('sales.filter.selected', { count: selected.size });
  }

  function paint() {
    const query = search.value.trim().toLowerCase();
    list.replaceChildren();

    for (const family of families) {
      const children = family.asins.filter((asin) => {
        if (!query) return true;
        const name = (data.asins[asin]?.name || '').toLowerCase();
        return name.includes(query) || asin.toLowerCase().includes(query)
          || family.label.toLowerCase().includes(query) || family.id.toLowerCase().includes(query);
      });
      if (!children.length) continue;

      const chosen = family.asins.filter((a) => selected.has(a)).length;
      const group = el('div', { class: 'picker__group' });

      /* Строка семьи. Отметка «частично» обязательна: без неё выбор двух
         вариаций из пяти выглядит так же, как выбор всей семьи. */
      const head = el('label', { class: 'picker__row picker__row--family' });
      const box = el('input', { type: 'checkbox' });
      box.checked = chosen === family.asins.length;
      box.indeterminate = chosen > 0 && chosen < family.asins.length;
      box.addEventListener('change', () => {
        if (box.checked) family.asins.forEach((a) => selected.add(a));
        else family.asins.forEach((a) => selected.delete(a));
        onChange();
      });
      head.append(box,
        el('span', { class: 'picker__name', text: family.label }),
        el('span', { class: 'picker__count', text: formatNumber(family.units) }));
      group.appendChild(head);

      // Разворачивать нечего, когда вариация одна — это тот же самый товар
      if (family.asins.length > 1) {
        const details = el('details', { class: 'picker__children' });
        details.appendChild(el('summary', {
          text: t('sales.filter.variants', { count: family.asins.length }),
        }));
        if (query) details.setAttribute('open', 'open');

        for (const asin of children) {
          const row = el('label', { class: 'picker__row' });
          const child = el('input', { type: 'checkbox' });
          child.checked = selected.has(asin);
          child.addEventListener('change', () => {
            if (child.checked) selected.add(asin); else selected.delete(asin);
            onChange();
          });
          row.append(child,
            el('span', { class: 'picker__name', text: data.asins[asin]?.name || asin }),
            el('span', { class: 'picker__asin', text: asin }),
            el('span', { class: 'picker__count', text: formatNumber(unitsByAsin.get(asin) || 0) }));
          details.appendChild(row);
        }
        group.appendChild(details);
      }
      list.appendChild(group);
    }

    if (!list.children.length) {
      list.appendChild(el('p', { class: 'picker__empty', text: t('sales.filter.nothing') }));
    }
    button.textContent = label();
  }

  search.addEventListener('input', paint);

  button.addEventListener('click', () => {
    const open = panel.hasAttribute('hidden');
    panel.toggleAttribute('hidden', !open);
    button.setAttribute('aria-expanded', String(open));
    if (open) search.focus();
  });

  // Клик мимо панели закрывает её: иначе она перекрывает график,
  // а очевидной кнопки «закрыть» у выпадающего списка нет
  const onDocClick = (e) => {
    if (!wrap.contains(e.target)) {
      panel.setAttribute('hidden', 'hidden');
      button.setAttribute('aria-expanded', 'false');
    }
  };
  document.addEventListener('click', onDocClick);

  wrap.append(button, panel);
  return { node: wrap, paint, dispose: () => document.removeEventListener('click', onDocClick) };
}

/* --------------------------------------------------------------------------
   Плитки и таблица
   -------------------------------------------------------------------------- */

function statTile(label, value, note = null, dark = false) {
  const card = el('article', { class: `card stat${dark ? ' stat--dark' : ''}` });
  card.appendChild(el('div', { class: 'stat__label', text: label }));
  card.appendChild(el('div', { class: 'stat__value', text: value }));
  if (note) card.appendChild(el('div', { class: 'stat__delta', text: note }));
  return card;
}

/**
 * Таблица-двойник. Она обязательна, а не декоративна: три цвета палитры не
 * добирают 3:1 к поверхности, и без текстового представления часть читателей
 * не отличит серии друг от друга.
 */
function weeksTable(data, weeks, totals, series, metric, currency) {
  const table = el('table', { class: 'breakdown' });
  const format = (v) => (metric === 'money' ? formatMoney(v, currency) : formatNumber(v));

  const head = el('tr', {}, [el('th', { scope: 'col', text: t('sales.col.week') })]);
  series.forEach((s) => head.appendChild(el('th', { scope: 'col', class: 'num', text: s.name })));
  head.appendChild(el('th', { scope: 'col', class: 'num', text: t('sales.col.total') }));
  table.appendChild(el('thead', {}, [head]));

  const body = el('tbody');
  weeks.forEach((week, i) => {
    const row = el('tr', {}, [el('td', { text: weekLabel(week) })]);
    series.forEach((s) => row.appendChild(el('td', { class: 'num', text: format(s.values[i]) })));
    row.appendChild(el('td', { class: 'num', text: format(totals[i]) }));
    body.appendChild(row);
  });
  table.appendChild(body);

  const sum = totals.reduce((a, b) => a + b, 0);
  const foot = el('tr', { class: 'breakdown__total' }, [el('td', { text: t('sales.col.total') })]);
  series.forEach((s) => foot.appendChild(el('td', {
    class: 'num', text: format(s.values.reduce((a, b) => a + b, 0)),
  })));
  foot.appendChild(el('td', { class: 'num', text: format(sum) }));
  table.appendChild(el('tfoot', {}, [foot]));

  return el('div', { class: 'table-wrap' }, [table]);
}

function weekLabel(week) {
  return `${formatDayShort(week.start)} — ${formatDayShort(week.end)}`;
}

/* --------------------------------------------------------------------------
   Раздел
   -------------------------------------------------------------------------- */

export const weeklySales = {
  titleKey: 'page.weeklySales.title',
  leadKey: 'page.weeklySales.lead',

  async mount(view, controls) {
    controls.replaceChildren();
    view.replaceChildren(el('div', { class: 'card state', text: t('sales.loading') }));

    let data;
    try {
      const response = await fetch(DATA_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      data = await response.json();
      if (!Array.isArray(data.rows)) throw new Error('нет массива rows');
    } catch {
      view.replaceChildren(el('div', { class: 'card state' }, [
        document.createTextNode(t('sales.noData')),
        el('code', { text: 'python3 scripts/collect_weekly_sales.py' }),
      ]));
      return () => {};
    }

    /* Курсы — вспомогательные данные: без них раздел работает, просто без
       перевода в евро. Поэтому сбой чтения не роняет раздел. */
    let fx = null;
    try {
      const response = await fetch(FX_URL, { cache: 'no-store' });
      if (response.ok) fx = await response.json();
    } catch { /* перевод в евро будет недоступен */ }

    /* --- состояние фильтров --- */
    const currencies = [...new Set(Object.values(data.marketplaces)
      .map((m) => m.currency).filter(Boolean))];
    const rateByWeek = weeklyRates(data.weeks, fx);
    const canConvert = Boolean(rateByWeek);

    const state = {
      marketplace: 'all',
      asins: new Set(),
      metric: 'units',
      // По умолчанию — перевод в евро, если курсы есть: именно он отвечает
      // на вопрос «сколько всего», ради которого раздел и открывают
      currency: canConvert ? EUR_ALL : (currencies[0] || 'EUR'),
    };

    /* --- панель управления --- */
    const marketSelect = el('select', { class: 'select' });
    marketSelect.appendChild(el('option', { value: 'all', text: t('sales.allMarkets') }));
    Object.entries(data.marketplaces).forEach(([code, market]) => {
      marketSelect.appendChild(el('option', { value: code, text: market.name }));
    });
    marketSelect.addEventListener('change', () => {
      state.marketplace = marketSelect.value;
      render();
    });

    const metricToggle = el('div', { class: 'segmented', role: 'radiogroup' });
    const metricButtons = [['units', 'sales.metric.units'], ['money', 'sales.metric.money']]
      .map(([value, key]) => {
        const button = el('button', {
          type: 'button', class: 'segmented__item', role: 'radio', text: t(key),
          'aria-checked': String(state.metric === value),
        });
        button.addEventListener('click', () => { state.metric = value; render(); });
        metricToggle.appendChild(button);
        return { value, button };
      });

    const currencySelect = el('select', { class: 'select' });
    if (canConvert) {
      currencySelect.appendChild(el('option', { value: EUR_ALL, text: t('sales.allInEur') }));
    }
    currencies.forEach((code) => currencySelect.appendChild(
      el('option', { value: code, text: code })));
    currencySelect.value = state.currency;
    currencySelect.addEventListener('change', () => {
      state.currency = currencySelect.value;
      render();
    });
    const currencyField = el('label', { class: 'filters__group' }, [
      el('span', { class: 'filters__label', text: t('sales.currency') }), currencySelect,
    ]);

    const picker = productFilter(data, state.asins, () => { picker.paint(); render(); });

    controls.append(
      el('label', { class: 'filters__group' }, [
        el('span', { class: 'filters__label', text: t('sales.marketplace') }), marketSelect]),
      el('label', { class: 'filters__group' }, [
        el('span', { class: 'filters__label', text: t('sales.product') }), picker.node]),
      metricToggle,
      currencyField,
    );
    picker.paint();

    /* --- каркас страницы --- */
    const kpis = el('section', { class: 'kpi-grid' });

    const weekPanel = el('section', { class: 'card panel' });
    const weekHead = el('div', { class: 'panel__header' }, [
      el('div', { class: 'panel__titles' }, [
        el('h2', { class: 'panel__title', text: t('sales.chart.weeks') }),
        el('p', { class: 'panel__subtitle' }),
      ]),
    ]);
    const weekLegend = el('div', { class: 'legend' });
    const weekChartBox = el('div', { class: 'chart' });
    const weekTableBox = el('details', { class: 'check-card__details' });
    weekPanel.append(weekHead, weekLegend, weekChartBox, weekTableBox);

    const productPanel = el('section', { class: 'card panel' });
    productPanel.append(el('div', { class: 'panel__header' }, [
      el('div', { class: 'panel__titles' }, [
        el('h2', { class: 'panel__title', text: t('sales.chart.products') }),
        el('p', { class: 'panel__subtitle', text: t('sales.chart.productsHint') }),
      ]),
    ]));
    const productChartBox = el('div', { class: 'chart' });
    productPanel.appendChild(productChartBox);

    const footnote = el('p', { class: 'check-card__note' });

    view.replaceChildren(kpis, weekPanel, productPanel, footnote);

    const weekChart = createStackedColumnChart(weekChartBox);
    const productChart = createBarChart(productChartBox);

    /* --- отрисовка --- */
    function render() {
      metricButtons.forEach(({ value, button }) => {
        button.setAttribute('aria-checked', String(state.metric === value));
      });
      // Валюта имеет смысл только для денег; при одной валюте и без курсов
      // выбирать не из чего
      currencyField.hidden = state.metric !== 'money'
        || (currencies.length < 2 && !canConvert);

      const rows = sliceRows(data, state);
      const complete = data.weeks.filter((w) => !w.partial);
      const running = data.weeks.find((w) => w.partial);
      const runningIndex = running ? data.weeks.indexOf(running) : -1;

      const converting = state.metric === 'money' && state.currency === EUR_ALL;

      /* Не переведённое считаем отдельно, а не роняем в ноль молча: строка
         без курса иначе просто уменьшила бы итог, и объяснить это было бы
         нечем. «Вне Amazon» сюда не попадает — там и суммы нет. */
      const noRate = new Set();

      const amount = (row) => {
        if (state.metric !== 'money') return row.u;
        if (!converting) return row.r;

        const currency = data.marketplaces[row.m]?.currency;
        if (!currency) return 0;                 // продажи вне Amazon: суммы нет
        if (currency === 'EUR') return row.r;

        const rate = rateByWeek[row.w]?.rates?.[currency];
        if (!rate) { noRate.add(currency); return 0; }
        return row.r / rate;                     // курс ЕЦБ — единиц валюты за евро
      };

      const allTotals = weeklyTotals(rows, data.weeks.length, amount);
      const totals = complete.map((_, i) => allTotals[i]);

      const series = marketplaceSeries(data, rows, data.weeks.length, amount)
        .map((s) => ({ ...s, values: complete.map((_, i) => s.values[i]) }));

      const money = state.metric === 'money' ? (converting ? 'EUR' : state.currency) : null;
      const format = (v) => (money ? formatMoney(v, money) : formatNumber(v));
      const formatAxis = (v) => (money ? formatMoney(v, money, 0) : formatCompact(v));

      /* --- плитки --- */
      const sum = totals.reduce((a, b) => a + b, 0);
      const best = totals.reduce((acc, v, i) => (v > acc.v ? { v, i } : acc), { v: -1, i: 0 });

      kpis.replaceChildren();
      kpis.appendChild(statTile(
        money ? t('sales.kpi.revenue') : t('sales.kpi.units'),
        format(sum), t('sales.kpi.overWeeks', { count: complete.length }), true));
      kpis.appendChild(statTile(t('sales.kpi.perWeek'),
        format(complete.length ? sum / complete.length : 0)));
      kpis.appendChild(statTile(t('sales.kpi.best'), format(best.v > 0 ? best.v : 0),
        complete.length ? weekLabel(complete[best.i]) : '—'));

      /* Текущая неделя — отдельной плиткой, а не столбцом: она ещё идёт,
         и на графике её огрызок читался бы как обвал продаж. */
      if (running) {
        kpis.appendChild(statTile(t('sales.kpi.running'),
          format(allTotals[runningIndex]), t('sales.kpi.runningNote')));
      }

      // Деньги по всем валютам сразу — чтобы «вместе по всем площадкам»
      // не выглядело как одно число, которого на самом деле нет
      if (!money) {
        // Срез берём без валютного фильтра: плитки показывают все валюты
        // сразу — именно этим «вместе по всем площадкам» и честно.
        const everyCurrency = sliceRows(data, { ...state, metric: 'units' });
        moneyByCurrency(data, everyCurrency)
          .forEach(([code, value]) => kpis.appendChild(
            statTile(t('sales.kpi.revenueIn', { currency: code }), formatMoney(value, code))));
      }

      /* --- график по неделям --- */
      weekHead.querySelector('.panel__subtitle').textContent = state.marketplace === 'all'
        ? t('sales.chart.weeksAll')
        : t('sales.chart.weeksOne', { market: data.marketplaces[state.marketplace]?.name || '' });

      renderLegend(weekLegend, series, { mark: 'rect' });
      weekChart.update({
        labels: complete.map((w) => formatDayShort(w.start)),
        series,
        formatValue: formatAxis,
        emptyText: t('sales.empty'),
        ariaLabel: t('sales.chart.weeks'),
      });

      weekTableBox.replaceChildren(
        el('summary', { text: t('sales.showTable') }),
        weeksTable(data, complete, totals, series, state.metric, money || 'EUR'),
      );

      /* --- график по товарам --- */
      productChart.update({
        items: familyTotals(data, rows, amount).slice(0, 12),
        formatValue: format,
        emptyText: t('sales.empty'),
      });

      /* --- сноска: то, что иначе молча разошлось бы --- */
      const notes = [t('sales.note.generated', { at: formatDateTime(data.generatedAt) })];
      if (data.unpricedUnits) notes.push(t('sales.note.unpriced', { units: data.unpricedUnits }));

      if (converting) {
        // Перевод обязан быть подписан как оценка. Amazon конвертирует по
        // своему курсу на момент выплаты, и совпадения с кабинетом не будет.
        notes.push(t('sales.note.converted', { from: fx.periodStart, to: fx.periodEnd }));
        const approximate = complete.some((_, i) => rateByWeek[i] && !rateByWeek[i].exact);
        if (approximate) notes.push(t('sales.note.rateGap'));
        if (noRate.size) {
          notes.push(t('sales.note.noRate', { currencies: [...noRate].sort().join(', ') }));
        }
      } else if (!money && currencies.length > 1) {
        notes.push(t('sales.note.currencies'));
      }
      footnote.textContent = notes.join(' ');
    }

    render();

    return () => {
      weekChart.destroy();
      productChart.destroy();
      picker.dispose();
    };
  },
};
