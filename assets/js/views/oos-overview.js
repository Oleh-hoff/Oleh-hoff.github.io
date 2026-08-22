/* ==========================================================================
   Раздел «Логистика» → страница «Обзор OOS».

   Отвечает на один вопрос: где горит. Плитки называют масштаб, тепловая
   карта показывает, в каких периодах, сводная таблица — почему, блок
   неактивных и плашка проверки данных — чего в расчёте нет и по какой
   причине.

   Три правила, из которых выросла вся структура файла:

   1. Ни одного числа страница не придумывает. Всё считает `computeAll`
      из `oos-engine.js`; смена любого параметра пересчитывает набор целиком
      (~27 мс) и перерисовывает страницу. Промежуточного состояния, которое
      можно рассинхронизировать, здесь нет.
   2. `navigate()` перемонтирует раздел при смене языка и пояса — замыкание
      теряется. Фильтр рынка и сортировка живут в модульных переменных
      `oos-shared.js`, а не здесь.
   3. Панель параметров создаётся один раз за mount() и НЕ пересобирается
      при перерисовке: она стабильный узел `view`. Пересборка вырывала бы
      фокус из поля, в котором человек прямо сейчас правит порог.

   Графиков и наблюдателей за размером на странице нет намеренно: тепловая
   карта — настоящая `<table>`, а не SVG. Таблица даёт связь ячейки с обоими
   заголовками и чтение с клавиатуры бесплатно, SVG-сетку пришлось бы
   озвучивать руками.
   ========================================================================== */

import { t } from '../i18n.js';
import { el, statTile, tableWrap } from '../fba-spec.js';
import { statusIcon } from '../notifications.js';
import { computeAll } from '../oos-engine.js';
import { getParams, onParamsChange } from '../oos-params.js';
import {
  PRODUCT_ROUTE, setSelection, loadDemoData, dataErrorState, emptyState, fatalState,
  demoBanner, thresholdLine, paramsPanel, paramsButton, marketFilter,
  getMarketFilter, getSort, num, day, plain, share, months, units, pickTitle,
  formatPeriod, statusBadge, statusLegend, heatCell, heatTipRows,
  createTooltip, sortableHead, twinTable, productLink, marketTag, setMarketAccents,
  liveRegion, focusAddress, restoreFocus, nearestDeadline, periodById,
} from '../oos-shared.js';

/* Уровни флагов данных в порядке важности: ошибка останавливает рынок,
   предупреждение и справка — нет, но показать обязаны все три. */
const FLAG_LEVELS = ['error', 'warning', 'info'];

/* Значок уровня. «Справочно» получает галочку, а не восклицательный знак:
   это не замечание к данным, а сообщение о принятом решении движка
   («контейнер ушёл на другой рынок»), и жёлтый знак врал бы о тревоге. */
const FLAG_ICON = { error: 'error', warning: 'partial', info: 'ok' };

/**
 * Строка словаря по ключу, собранному из данных.
 * `t()` возвращает сам ключ, если строки нет, и тогда на экране появилось бы
 * «oos.flag.что-то» — а `mount-check` валит прогон на таком тексте. Поэтому
 * неизвестный код показывается как код, без префикса словаря: это честнее
 * и не притворяется переводом.
 */
function dyn(key, fallback) {
  const text = t(key);
  return text === key ? String(fallback) : text;
}

/** Заголовок панели. `panel()` из fba-spec создаёт новую секцию, а секции
    здесь стабильные — поэтому шапка дописывается в готовый узел. */
function panelHead(box, titleKey, subtitleKey, extraKey = null) {
  const titles = el('div', { class: 'panel__titles' }, [
    el('h2', { class: 'panel__title', text: t(titleKey) }),
    el('p', { class: 'panel__subtitle', text: t(subtitleKey) }),
  ]);
  if (extraKey) titles.appendChild(el('p', { class: 'panel__subtitle', text: t(extraKey) }));
  box.appendChild(el('div', { class: 'panel__header' }, [titles]));
}

/** Мелкая приписка под числом в ячейке: причина, сноска, пояснение. */
function hint(text) {
  return el('span', { class: 'oos-check__hint', text });
}

/* --------------------------------------------------------------------------
   Сортировка сводной таблицы
   -------------------------------------------------------------------------- */

/* Значение, по которому сортируется столбец. Статуса здесь нет: он
   сортируется порядком движка, а не строкой — см. `sortItems`. */
const SORT_VALUE = {
  product: (it) => it.sku,
  market: (it) => it.market,
  startFba: (it) => it.baseline.startFba,
  awd: (it) => it.baseline.awdUnits,
  prep: (it) => it.baseline.prepUnits,
  t30: (it) => it.baseline.t30Adjusted,
  growth: (it) => it.baseline.growth?.value ?? null,
  coverageFixed: (it) => it.coverage.fixedMonths,
  coverageGrowth: (it) => it.coverage.growthMonths,
  firstOos: (it) => it.baseline.firstProblemDate,
  orderUnits: (it) => it.orderUnits,
};

/**
 * Сортировка на клиенте целиком: 15 строк, индексы не нужны.
 * «Статус» возвращает порядок движка (oos → непоправимые → ниже порога →
 * норма, внутри группы по дате первого сбоя), а не алфавит статусов:
 * алфавит поставил бы «Норма» выше «OOS» и спрятал бы риск.
 */
function sortItems(list, engineOrder) {
  const { key, dir } = getSort();

  if (key === 'status' || !SORT_VALUE[key]) {
    const sign = dir === 'asc' ? -1 : 1;
    return [...list].sort((a, b) =>
      ((engineOrder.get(a.key) ?? 0) - (engineOrder.get(b.key) ?? 0)) * sign);
  }

  const get = SORT_VALUE[key];
  const sign = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    // «Нет данных» всегда внизу, в обе стороны: прочерк наверху выглядел бы
    // как самое маленькое значение, а он вообще не значение.
    const noX = x === null || x === undefined;
    const noY = y === null || y === undefined;
    if (noX && noY) return 0;
    if (noX) return 1;
    if (noY) return -1;
    // numeric: SKU кончаются числом, и обычное сравнение строк ставит SQ10
    // сразу за SQ1. Даты в ISO при этом сравниваются по-прежнему верно.
    const cmp = typeof x === 'number' && typeof y === 'number'
      ? x - y
      : String(x).localeCompare(String(y), undefined, { numeric: true });
    return cmp * sign;
  });
}

/* --------------------------------------------------------------------------
   Тепловая карта: навигация и таблица-двойник

   Обе части вынесены из `renderHeat` — та строила шапку, тело, роверный
   tabindex, подсказку и двойника одним телом на 187 строк, и «поправить
   стрелки» означало проехать глазами мимо всего остального.
   -------------------------------------------------------------------------- */

/**
 * Подсказка и чтение карты с клавиатуры.
 * У карты ровно одна точка табуляции: 165 самостоятельных остановок сделали
 * бы её непроходимой. Стрелки переносят и фокус, и tabindex.
 * @returns {() => void} снятие слушателей.
 */
function heatNavigation(table, grid, cellData, tip) {
  const at = (node) => {
    const r = Number(node.getAttribute('data-r'));
    const c = Number(node.getAttribute('data-c'));
    return Number.isInteger(r) && Number.isInteger(c) ? cellData[r]?.[c] ?? null : null;
  };
  const cellOf = (event) => event.target?.closest?.('.oos-heat__cell') ?? null;

  const show = (event) => {
    const td = cellOf(event);
    const cell = td && at(td);
    if (cell) tip.show(td, heatTipRows(cell));
  };
  const onOut = () => tip.hide();
  const onKey = (event) => {
    const td = cellOf(event);
    if (!td) return;
    const r = Number(td.getAttribute('data-r'));
    const c = Number(td.getAttribute('data-c'));
    const lastRow = grid.length - 1;
    const lastCol = (grid[r]?.length ?? 1) - 1;
    let nr = r;
    let nc = c;
    if (event.key === 'ArrowLeft') nc = Math.max(0, c - 1);
    else if (event.key === 'ArrowRight') nc = Math.min(lastCol, c + 1);
    else if (event.key === 'ArrowUp') nr = Math.max(0, r - 1);
    else if (event.key === 'ArrowDown') nr = Math.min(lastRow, r + 1);
    else if (event.key === 'Home') nc = 0;
    else if (event.key === 'End') nc = lastCol;
    else return;
    event.preventDefault();
    const next = grid[nr]?.[nc];
    if (!next || next === td) return;
    td.setAttribute('tabindex', '-1');
    next.setAttribute('tabindex', '0');
    next.focus();
  };

  table.addEventListener('mouseover', show);
  table.addEventListener('mouseout', onOut);
  table.addEventListener('focusin', show);
  table.addEventListener('focusout', onOut);
  table.addEventListener('keydown', onKey);
  return () => {
    table.removeEventListener('mouseover', show);
    table.removeEventListener('mouseout', onOut);
    table.removeEventListener('focusin', show);
    table.removeEventListener('focusout', onOut);
    table.removeEventListener('keydown', onKey);
    tip.hide();
  };
}

/**
 * Таблица-двойник карты: каждая непроблемная ячейка пропускается, остальные
 * идут строкой. Цвет здесь не нужен вовсе — значения читаются словами.
 * @returns {Node|null} `null`, если проблемных периодов нет.
 */
function heatTwin(cellData) {
  const rows = [];
  for (const rowData of cellData) {
    for (const cell of rowData) {
      if (cell.tone === 'ok') continue;
      rows.push([
        cell.product,
        cell.market,
        formatPeriod(cell.period),
        statusBadge(cell.tone),
        num(cell.fbaEnd),
        num(cell.threshold),
        cell.shortfall > 0 ? num(cell.shortfall) : '—',
      ]);
    }
  }
  if (!rows.length) return null;
  return twinTable({
    summaryKey: 'oos.heat.twin',
    tableClass: 'oos-heat-twin',
    columns: [
      { label: t('oos.col.product') },
      { label: t('oos.col.market') },
      { label: t('oos.col.period') },
      { label: t('oos.col.status') },
      { label: t('oos.col.fbaEnd'), num: true },
      { label: t('oos.col.threshold'), num: true },
      { label: t('oos.col.gap'), num: true },
    ],
    rows,
  });
}

/* ========================================================================== */

export const oosOverview = {
  titleKey: 'page.oosOverview.title',
  leadKey: 'page.oosOverview.lead',

  async mount(view, controls) {
    controls.replaceChildren();
    view.replaceChildren();

    const { data, error } = await loadDemoData();
    if (error || !data) {
      // Имя файла показывается прямо: «не загрузилось» без адреса — не диагноз.
      view.replaceChildren(dataErrorState());
      return () => {};
    }

    let result = computeAll(data, getParams());

    // Расчёт невозможен целиком — показываем причину, а не сетку нулей.
    // Ветка общая на три страницы: «Заказы» и «Карточка» звали её мимо и
    // рисовали полный макет с нулями.
    const fatal = fatalState(result);
    if (fatal) {
      view.replaceChildren(fatal);
      return () => {};
    }
    setMarketAccents(result.markets);

    /* --- Стабильные узлы страницы ---------------------------------------
       `.workspace__body` — флекс-колонка с зазором, поэтому секции обязаны
       быть прямыми детьми `view`: обёртка склеила бы их в один элемент.
       Узлы создаются один раз и наполняются заново — так панель параметров
       переживает перерисовку вместе с фокусом в своём поле. */
    const headBox = el('div', { class: 'oos-topbar' });
    const panel = paramsPanel();
    const kpiBox = el('section', { class: 'kpi-grid' });
    const heatBox = el('section', { class: 'card panel oos-heat-panel' });
    const summaryBox = el('section', { class: 'card panel oos-summary-panel' });
    const inactiveBox = el('section', { class: 'card panel oos-inactive-panel' });
    const checkBox = el('section', { class: 'card panel oos-check-panel' });

    /* Живая область — стабильный узел вне перерисовываемых панелей: положи
       её внутрь, и сообщение исчезло бы вместе с панелью, не прозвучав. */
    const live = liveRegion();

    view.replaceChildren(headBox, panel.node, live.node, kpiBox, heatBox, summaryBox,
      inactiveBox, checkBox);

    // Подсказка живёт в панели карты: `.oos-tip` позиционируется от ближайшего
    // предка, который её прямо содержит.
    const tip = createTooltip(heatBox);

    // Слушатели живут ровно столько, сколько узел, на котором они висят.
    // Узлы пересобираются каждой перерисовкой, поэтому старые снимаются явно:
    // иначе после десятка смен фильтра карта отвечала бы на события дважды.
    let detachHeat = null;
    let detachSummary = null;

    /* Причина пустоты у списка товаров бывает разная, и путать их нельзя:
       фильтр рынка что-то отсёк — это одно, в расчёте нет активных пар
       вовсе — совсем другое, и решение человека в этих случаях разное. */
    function emptyItemsKey() {
      return (result.items || []).length ? 'oos.empty.filtered' : 'oos.empty.noItems';
    }

    /* --- Плитки KPI ---------------------------------------------------- */

    function renderKpi(items, inactive) {
      kpiBox.replaceChildren();
      if (!items.length) {
        kpiBox.appendChild(emptyState(emptyItemsKey()));
        return;
      }

      const params = getParams();
      // totals движка посчитаны по всему набору; под фильтром рынка они бы
      // врали, поэтому пересчитываются страницей из отфильтрованного списка.
      const oosCount = items.filter((it) => it.status === 'oos' || it.status === 'unrecoverable').length;
      const unrec = items.filter((it) => it.status === 'unrecoverable').length;
      const below = items.filter((it) => it.status === 'below-fba' || it.status === 'below-reserve').length;
      const orderUnits = items.reduce((sum, it) => sum + (it.orderUnits || 0), 0);
      const orderRows = items.reduce((sum, it) => sum + (it.orders?.length || 0), 0);

      /* Ближайший срок считает общий помощник: у «Плана заказов» была своя
         копия правила, и одна и та же подпись читалась то «сегодня · SQ8 на
         рынке DE», то «SQ8 на рынке DE · сегодня». */
      const deadline = nearestDeadline(
        items.flatMap((it) => (it.orders || []).map((o) => ({ ...o, sku: it.sku, market: it.market }))),
        result.asOf,
      );

      /* Упущенные штуки — единственное число, отвечающее на вопрос «сколько
         это стоит». Движок считает его всегда, а страница до сих пор его
         выбрасывала. Дробное по природе (13 337,69…), выводится целым. */
      const lostUnits = items.reduce((sum, it) => sum + (it.baseline?.lostUnits ?? 0), 0);

      kpiBox.append(
        statTile(t('oos.kpi.items'), num(items.length),
          t('oos.kpi.itemsNote', { n: num(inactive.length) })),
        // Главный показатель страницы — инвертированной тёмной карточкой.
        statTile(t('oos.kpi.oos'), num(oosCount),
          `${t('oos.kpi.oosNote', { n: num(unrec) })} · ${t('oos.kpi.lost')}: ${num(lostUnits, 0)}`, true),
        statTile(t('oos.kpi.unrecoverable'), num(unrec),
          t('oos.kpi.unrecoverableNote', { n: plain(params.leadTimeMonths) })),
        statTile(t('oos.kpi.below'), num(below), t('oos.kpi.belowNote')),
        statTile(t('oos.kpi.orderUnits'), num(orderUnits),
          t('oos.kpi.orderUnitsNote', { n: num(orderRows) })),
        statTile(t('oos.kpi.deadline'), day(deadline.date), deadline.note),
      );
    }

    /* --- Тепловая карта ------------------------------------------------- */

    function blockedRows(markets) {
      return markets
        .filter((m) => m.blocked)
        .map((m) => el('div', { class: 'card state' }, [
          el('p', { text: t('oos.empty.blocked', { market: m.code }) }),
        ]));
    }

    function renderHeat(items, markets) {
      detachHeat?.();
      detachHeat = null;
      heatBox.replaceChildren();
      /* Третьей строкой шапки — чей это прогон. Карта показывает baseline
         (без плановых заказов), а карточка товара — simulation (с ними), и
         на трёх парах из пятнадцати числа расходятся. Без подписи это
         выглядит как расхождение расчёта. */
      panelHead(heatBox, 'oos.heat.title', 'oos.heat.subtitle', 'oos.run.baseline');
      heatBox.appendChild(el('p', { class: 'oos-check__hint', text: t('oos.heat.keyboard') }));
      for (const node of blockedRows(markets)) heatBox.appendChild(node);

      const periods = result.periods;
      if (!periods.length) {
        heatBox.appendChild(emptyState('oos.empty.noPeriods'));
        heatBox.appendChild(tip.node);
        return;
      }
      if (!items.length) {
        heatBox.appendChild(emptyState(emptyItemsKey()));
        heatBox.appendChild(tip.node);
        return;
      }

      heatBox.appendChild(statusLegend());

      const table = el('table', { class: 'oos-heat' });
      table.appendChild(el('caption', { class: 'visually-hidden', text: t('oos.heat.subtitle') }));

      const headRow = el('tr', {}, [
        el('th', { scope: 'col', class: 'oos-heat__corner', text: t('oos.col.product') }),
      ]);
      for (const period of periods) {
        // Подпись периода числовая («16–31.08») и перевода не требует; месяц
        // выносится вторым этажом, чтобы столбец остался узким.
        const parts = String(period.label ?? '').split('.');
        const th = el('th', { scope: 'col', class: 'oos-heat__colhead' });
        if (parts.length === 2) {
          th.appendChild(el('span', { text: parts[1] }));
          th.appendChild(el('span', { text: parts[0] }));
        } else {
          th.appendChild(el('span', { text: period.label ?? period.id ?? '—' }));
        }
        // Полная подпись — только для чтения вслух: «16–31.08» на слух не период.
        th.appendChild(el('span', { class: 'visually-hidden', text: formatPeriod(period, true) }));
        headRow.appendChild(th);
      }
      table.appendChild(el('thead', {}, [headRow]));

      const grid = [];   // td по [строка][столбец] — для роверного tabindex
      const cellData = [];
      const body = el('tbody');

      items.forEach((it, r) => {
        const rowCells = [];
        const rowData = [];
        const tr = el('tr', {}, [
          el('th', { scope: 'row', class: 'oos-heat__rowhead' }, [
            productLink(it.market, it.sku, it.sku),
            marketTag(it.market),
          ]),
        ]);

        periods.forEach((period, c) => {
          // Тон — из baseline, симуляции БЕЗ плановых заказов: карта показывает
          // риск, а не то, что будет, если заказы разместить.
          const row = it.baseline.rows[c] || null;
          const cell = {
            tone: row?.status ?? 'ok',
            unrecoverable: Boolean(row)
              && (it.baseline.unrecoverablePeriodIds || []).includes(row.periodId),
            focusable: r === 0 && c === 0,
            product: it.sku,
            market: it.market,
            period,
            fbaEnd: row ? row.fbaEnd : null,
            threshold: row ? row.thresholdFba : null,
            shortfall: row ? row.shortfall : null,
          };
          const td = heatCell(cell);
          td.setAttribute('data-r', String(r));
          td.setAttribute('data-c', String(c));
          tr.appendChild(td);
          rowCells.push(td);
          rowData.push(cell);
        });

        grid.push(rowCells);
        cellData.push(rowData);
        body.appendChild(tr);
      });

      table.appendChild(body);
      const scroll = tableWrap(table);
      // Ограничение по высоте нужно, чтобы шапка периодов могла липнуть:
      // без него прокручивается страница, и `top: 0` внутри бокса не работает.
      scroll.classList.add('oos-heat-scroll');
      heatBox.appendChild(scroll);

      detachHeat = heatNavigation(table, grid, cellData, tip);

      const twin = heatTwin(cellData);
      // Пустой список означает «проблемных периодов нет» — это уже сказано
      // самой картой, и пустая таблица под ней ничего бы не добавила.
      if (twin) heatBox.appendChild(twin);

      heatBox.appendChild(tip.node);
    }

    /* --- Сводная таблица ------------------------------------------------ */

    function renderSummary(items, markets) {
      detachSummary?.();
      detachSummary = null;
      summaryBox.replaceChildren();
      panelHead(summaryBox, 'oos.summary.title', 'oos.filter.sortHint');
      for (const node of blockedRows(markets)) summaryBox.appendChild(node);

      if (!items.length) {
        summaryBox.appendChild(emptyState(emptyItemsKey()));
        return;
      }

      const params = getParams();
      const engineOrder = new Map(result.items.map((it, i) => [it.key, i]));

      const columns = [
        { key: 'product', label: t('oos.col.product'), defaultDir: 'asc' },
        { key: 'market', label: t('oos.col.market'), defaultDir: 'asc' },
        { key: 'startFba', label: t('oos.col.startFba'), num: true },
        { key: 'awd', label: t('oos.col.awd'), num: true },
        { key: 'prep', label: t('oos.col.prep'), num: true },
        { key: 't30', label: t('oos.col.t30'), num: true },
        { key: 'growth', label: t('oos.col.growth'), num: true },
        { key: 'coverageFixed', label: t('oos.col.coverageFixed'), num: true },
        { key: 'coverageGrowth', label: t('oos.col.coverageGrowth'), num: true },
        { key: 'firstOos', label: t('oos.col.firstOos'), defaultDir: 'asc' },
        { key: 'status', label: t('oos.col.status') },
        { key: 'orderUnits', label: t('oos.col.orderUnits'), num: true },
      ];

      const table = el('table', { class: 'breakdown oos-summary' });
      table.appendChild(el('caption', { class: 'visually-hidden', text: t('oos.summary.title') }));
      table.appendChild(sortableHead(columns, getSort(), () => render()));

      const body = el('tbody');
      for (const it of sortItems(items, engineOrder)) {
        const bl = it.baseline;

        const prepCell = el('td', { class: 'num' }, [
          el('span', { text: num(bl.prepUnits) }),
        ]);
        // Выключенный препцентр не прячется: его сток есть, но в расчёт
        // не идёт, и молчание об этом выглядело бы как потеря данных.
        if (bl.prepExcluded > 0) {
          prepCell.appendChild(hint(`${t('oos.wh.off')}: ${units(bl.prepExcluded)}`));
        }

        const t30Cell = el('td', { class: 'num' }, [
          el('span', { text: num(bl.t30Adjusted) }),
        ]);
        // Показываем только те два случая, где коррекция что-то изменила или
        // была отключена руками. «Коррекции нет» верно для большинства строк,
        // и приписка на каждой из них превратила бы таблицу в шум.
        if (bl.primeDay?.excess > 0) {
          t30Cell.appendChild(hint(t('oos.primeDay.applied', { qty: num(bl.primeDay.excess) })));
        } else if (params.primeDayMode === 'off') {
          t30Cell.appendChild(hint(t('oos.primeDay.off')));
        }

        const growthCell = el('td', { class: 'num' }, [
          el('span', { text: num(bl.growth?.value ?? null, 3) }),
        ]);
        if (bl.growth?.clamped) growthCell.appendChild(hint(t('oos.growth.clamped')));

        const firstPeriod = periodById(bl.firstProblemPeriod, result.periods);

        const tr = el('tr', { 'data-key': it.key }, [
          el('td', { class: 'oos-summary__title' }, [
            productLink(it.market, it.sku, it.sku),
            el('span', { text: pickTitle(it.title) }),
          ]),
          el('td', {}, [marketTag(it.market)]),
          el('td', { class: 'num', text: num(bl.startFba) }),
          el('td', { class: 'num', text: num(bl.awdUnits) }),
          prepCell,
          t30Cell,
          growthCell,
          el('td', { class: 'num', text: months(it.coverage.fixedMonths) }),
          el('td', { class: 'num', text: months(it.coverage.growthMonths) }),
          el('td', { text: firstPeriod ? formatPeriod(firstPeriod) : '—' }),
          el('td', {}, [statusBadge(it.status)]),
          el('td', { class: 'num', text: num(it.orderUnits) }),
        ]);
        body.appendChild(tr);
      }
      table.appendChild(body);
      summaryBox.appendChild(tableWrap(table));

      /* Клик по строке — удобство для мыши; доступный способ перехода —
         ссылка в первом столбце, и клик по ней обрабатывается ею самой.
         Выбранная пара передаётся не через хеш: `routeFromHash()` берёт всё
         после `#/` целиком, и `#/oos-product?sku=DE:SQ1` увёл бы человека
         на маршрут по умолчанию. */
      const onRowClick = (event) => {
        if (event.target?.closest?.('a')) return;
        const key = event.target?.closest?.('tr')?.getAttribute('data-key');
        if (!key) return;
        const [market, sku] = key.split(':');
        if (!market || !sku) return;
        setSelection(market, sku);
        window.location.hash = PRODUCT_ROUTE;
      };
      body.addEventListener('click', onRowClick);
      detachSummary = () => body.removeEventListener('click', onRowClick);
    }

    /* --- Неактивные товары ---------------------------------------------- */

    function renderInactive(list) {
      inactiveBox.replaceChildren();
      panelHead(inactiveBox, 'oos.inactive.title', 'oos.inactive.subtitle');

      if (!list.length) {
        inactiveBox.appendChild(emptyState('oos.inactive.empty'));
        return;
      }

      const table = el('table', { class: 'breakdown oos-inactive' });
      table.appendChild(el('caption', { class: 'visually-hidden', text: t('oos.inactive.title') }));
      const columns = [
        t('oos.col.product'), t('oos.col.market'), t('oos.col.reason'), t('oos.col.listing'),
        t('oos.col.startFba'), t('oos.col.awd'), t('oos.col.prep'), t('oos.col.sales'),
      ];
      table.appendChild(el('thead', {}, [
        el('tr', {}, columns.map((label, i) => el('th', {
          scope: 'col', class: i >= 4 ? 'num' : null, text: label,
        }))),
      ]));

      const body = el('tbody');
      for (const row of list) {
        body.appendChild(el('tr', {}, [
          el('td', { class: 'oos-summary__title' }, [
            el('span', { text: row.sku }),
            el('span', { text: pickTitle(row.title) }),
          ]),
          el('td', {}, [marketTag(row.market)]),
          el('td', { class: 'oos-cnt__reason', text: dyn(`oos.inactive.reason.${row.reason}`, row.reason) }),
          el('td', { text: row.listedActive ? t('oos.inactive.listed.yes') : t('oos.inactive.listed.no') }),
          el('td', { class: 'num', text: num(row.startFba) }),
          el('td', { class: 'num', text: num(row.awdUnits) }),
          el('td', { class: 'num', text: num(row.prepUnits) }),
          el('td', { class: 'num', text: num(row.salesT30) }),
        ]));
      }
      table.appendChild(body);
      inactiveBox.appendChild(tableWrap(table));
    }

    /* --- Проверка данных, контейнеры без адресата и флаги ---------------- */

    function checkRow(market) {
      /* Проверку языка движок уже сделал; страница показывает её вердикт и
         то, на чём он получен, — сами названия из выгрузки.

         «Не сошлось» и «судить не о чем» — разные вердикты. Движок различает
         их явно (`error: false` у `lang-sample-too-small`), а страница
         сваливала все три флага в один фильтр и выносила «Проверка не
         пройдена» над примерами на заведомо правильном языке. */
      const failFlags = (market.flags || []).filter((f) =>
        f.code === 'wrong-marketplace-report'
        || f.code === 'fba-report-duplicated-from-de');
      const tooSmall = (market.flags || []).some((f) => f.code === 'lang-sample-too-small');

      let state = 'ok';
      let verdict = t('oos.check.pass');
      if (market.blocked) {
        state = 'error';
        verdict = t('oos.check.blocked');
      } else if (failFlags.length) {
        state = 'partial';
        verdict = t('oos.check.fail');
      } else if (tooSmall) {
        state = 'partial';
        verdict = t('oos.flag.lang-sample-too-small');
      }

      const lang = dyn(`oos.check.lang.${market.reportLanguage}`, market.reportLanguage ?? '—');
      const text = el('div', { class: 'oos-check__lang' }, [
        el('b', { text: verdict }),
        el('span', {
          text: ` · ${t('oos.check.market', {
            market: market.code, lang, share: share(market.langShare),
          })}`,
        }),
      ]);

      const box = el('div', {}, [text]);
      const samples = (market.items || [])
        .map((it) => it.reportTitle)
        .filter((title) => typeof title === 'string' && title)
        .slice(0, 3);
      if (samples.length) {
        box.appendChild(el('div', {
          class: 'oos-check__hint',
          text: t('oos.check.samples', { list: samples.join(' · ') }),
        }));
      }

      return el('div', { class: 'oos-check__row' }, [statusIcon(state), box]);
    }

    function orphanTable(orphans) {
      const table = el('table', { class: 'breakdown' });
      table.appendChild(el('caption', { class: 'visually-hidden', text: t('oos.check.orphans') }));
      table.appendChild(el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: t('oos.col.container') }),
          el('th', { scope: 'col', text: t('oos.col.market') }),
          el('th', { scope: 'col', class: 'num', text: t('oos.col.units') }),
          el('th', { scope: 'col', text: t('oos.col.forwarder') }),
          el('th', { scope: 'col', text: t('oos.col.reason') }),
        ]),
      ]));
      const body = el('tbody');
      for (const c of orphans) {
        body.appendChild(el('tr', {}, [
          el('td', { text: c.id ?? '—' }),
          el('td', { text: c.market ?? '—' }),
          el('td', { class: 'num', text: num(c.units) }),
          el('td', { text: c.forwarder ?? '—' }),
          el('td', { class: 'oos-cnt__reason', text: dyn(`oos.check.orphanReason.${c.reason}`, c.reason) }),
        ]));
      }
      table.appendChild(body);
      return tableWrap(table);
    }

    function flagList(markets, items) {
      /* Флаги трёх уровней собираются в один список и складываются по коду:
         одиннадцать одинаковых строк «дата выведена по статусу» — это шум,
         а один пункт с перечнем товаров — сведение. Ни один флаг при этом
         не пропадает: молча проглоченное предупреждение и есть те данные,
         которых человек не увидел. */
      const seen = new Map();
      const add = (flag, ownerKey) => {
        if (!flag?.code) return;
        const level = FLAG_LEVELS.includes(flag.level) ? flag.level : 'info';
        const id = `${level}:${flag.code}`;
        if (!seen.has(id)) seen.set(id, { code: flag.code, level, owners: [] });
        if (ownerKey) seen.get(id).owners.push(ownerKey);
      };

      for (const flag of result.flags || []) add(flag, null);
      for (const market of markets) for (const flag of market.flags || []) add(flag, market.code);
      for (const it of items) for (const flag of it.flags || []) add(flag, it.key);

      const list = [...seen.values()]
        .sort((a, b) => FLAG_LEVELS.indexOf(a.level) - FLAG_LEVELS.indexOf(b.level));

      if (!list.length) {
        return el('div', { class: 'card state' }, [el('p', { text: t('oos.check.noFlags') })]);
      }

      const ul = el('ul', { class: 'oos-flags' });
      for (const flag of list) {
        const li = el('li', { class: 'oos-flag', 'data-level': flag.level }, [
          statusIcon(FLAG_ICON[flag.level]),
        ]);
        const text = el('div', {}, [
          el('span', {
            text: `${t(`oos.flag.level.${flag.level}`)}: ${dyn(`oos.flag.${flag.code}`, flag.code)}`,
          }),
        ]);
        if (flag.owners.length) {
          text.appendChild(el('div', { class: 'oos-check__hint', text: flag.owners.join(', ') }));
        }
        li.appendChild(text);
        ul.appendChild(li);
      }
      return ul;
    }

    function renderCheck(markets, items, orphans) {
      checkBox.replaceChildren();
      panelHead(checkBox, 'oos.check.title', 'oos.check.subtitle');

      const box = el('div', { class: 'oos-check' });
      if (markets.length) {
        for (const market of markets) box.appendChild(checkRow(market));
      } else {
        // Рынков нет вовсе — это порок данных, а не следствие фильтра.
        box.appendChild(emptyState((result.markets || []).length ? 'oos.empty.filtered' : 'oos.flag.no-markets'));
      }
      // Что произойдёт, если проверка не пройдёт, — сказано до того, как это
      // случится: иначе смысл зелёной галочки остаётся неочевидным.
      box.appendChild(el('p', { class: 'oos-explain__body', text: t('oos.check.explain') }));

      if (orphans.length) {
        box.appendChild(el('h3', { class: 'panel__title', text: t('oos.check.orphans') }));
        box.appendChild(el('p', { class: 'oos-check__hint', text: t('oos.check.orphansHint') }));
        box.appendChild(orphanTable(orphans));
      }

      box.appendChild(flagList(markets, items));
      checkBox.appendChild(box);
    }

    /* --- Полная перерисовка --------------------------------------------- */

    function render() {
      const filter = getMarketFilter();
      const inScope = (code) => filter === 'both' || code === filter;

      /* Адрес фокуса запоминается ДО перерисовки: панели пересобираются
         целиком, и фокус с заголовка сортировки или ячейки карты уезжал
         в `<body>` — обход с клавиатуры начинался с начала страницы. */
      const address = focusAddress(view);

      const items = (result.items || []).filter((it) => inScope(it.market));
      const inactive = (result.inactive || []).filter((row) => inScope(row.market));
      const markets = (result.markets || []).filter((m) => inScope(m.code));
      const orphans = (result.orphanContainers || []).filter((c) => inScope(c.market));

      // Пороги видны всегда, а не только при открытой панели: спецификация
      // требует подтверждать их до показа результатов, значит человек обязан
      // видеть, какие именно взяты, ничего не открывая.
      headBox.replaceChildren(
        ...[demoBanner(result), thresholdLine(getParams(), result)].filter(Boolean),
      );

      renderKpi(items, inactive);
      renderHeat(items, markets);
      renderSummary(items, markets);
      renderInactive(inactive);
      renderCheck(markets, items, orphans);

      restoreFocus(view, address);
      // Итог пересчёта называется числами: «готово» ничего не сообщает.
      live.say(t('oos.live.overview', {
        oos: num(items.filter((it) => it.status === 'oos' || it.status === 'unrecoverable').length),
        qty: num(items.reduce((sum, it) => sum + (it.orderUnits || 0), 0)),
      }));
    }

    /* --- Зона фильтров и подписка --------------------------------------- */

    const market = marketFilter(() => render());
    const paramsBtn = paramsButton(panel.node);
    controls.append(market.node, paramsBtn.node);

    // Смена параметра пересчитывает весь набор и перерисовывает страницу.
    // Панель при этом остаётся тем же узлом — фокус в поле не теряется.
    const offParams = onParamsChange((params) => {
      result = computeAll(data, params);
      render();
    });

    render();

    return () => {
      offParams();
      detachHeat?.();
      detachSummary?.();
      tip.dispose();
      market.dispose();
      paramsBtn.dispose();
      panel.dispose();
    };
  },
};
