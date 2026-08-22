/* ==========================================================================
   Раздел «Логистика» → страница «Карточка товара».

   Один товар на одном рынке, разложенный на пять блоков методики: из чего
   складывается запас, что с ним будет по полумесяцам, что заказать, какие
   контейнеры и склады в этом участвовали.

   Три правила, которым подчинён весь файл:

   1. Ни одного числа страница не считает сама. Всё приходит из `computeAll`
      (`oos-engine.js`); здесь только выборка полей и вёрстка. Иначе таблица
      и график однажды показали бы разные цифры одной величины.
   2. Смена любого параметра расчёта пересчитывает набор целиком (27 мс на
      демо-данных) и перерисовывает тело страницы. Инкрементального пересчёта
      нет намеренно: промежуточного состояния, которое можно рассинхронизировать,
      не появляется.
   3. Неудобное показывается, а не прячется: отброшенный контейнер, выключенный
      склад, «заказов не требуется» и непоправимое окно — это ответы, а не
      пустые места.

   Числа и даты выводятся ТОЛЬКО через `num()`/`day()` из `oos-shared.js`:
   `formatNumber(null)` возвращает «0» и тихо врёт, а `formatDayShort(undefined)`
   бросает RangeError и роняет весь mount.
   ========================================================================== */

import { t } from '../i18n.js';
import { el, statTile, panel, tableWrap } from '../fba-spec.js';
import { statusIcon } from '../notifications.js';
import { createLineChart, createStackedColumnChart, renderLegend } from '../charts.js';
import { computeAll, FORECAST_ROWS } from '../oos-engine.js';
import { getParams, onParamsChange } from '../oos-params.js';
import {
  loadDemoData, dataErrorState, emptyState, fatalState, topBar, paramsPanel, paramsButton,
  marketFilter, productPicker, getMarketFilter, getSelection, resolveSelection,
  selectionKey, num, day, plain, months, share, pickTitle, formatPeriod, statusBadge,
  explain, kpiRow, toneCell, createTooltip, statusLegend, HEAT_TONES, periodById,
  marketTag, setMarketAccents, liveRegion,
} from '../oos-shared.js';

/* --------------------------------------------------------------------------
   Мелкие помощники страницы
   -------------------------------------------------------------------------- */

/**
 * Деление, которое не даёт ни NaN, ни Infinity.
 * Ноль в знаменателе — это «покрытие не считается» (`null`), а не «хватит
 * навсегда»: товар без продаж не обеспечен на бесконечность, про него просто
 * ничего не известно.
 */
function safeDiv(a, b) {
  if (typeof a !== 'number' || !Number.isFinite(a)) return null;
  if (typeof b !== 'number' || !Number.isFinite(b) || b <= 0) return null;
  return a / b;
}

/** Пустое состояние внутри панели: без карточки, чтобы не вкладывать карточку в карточку. */
function stateBox(key, hintKey = null, vars = undefined) {
  const box = el('div', { class: 'state' }, [el('p', { text: t(key, vars) })]);
  if (hintKey) box.appendChild(el('p', { text: t(hintKey, vars) }));
  return box;
}

/** Заготовка таблицы-разбивки: шапка со `scope="col"`, пустое тело. */
function dataTable(columns, className = '', caption = null) {
  const table = el('table', { class: `breakdown ${className}`.trim() });
  // Имя таблицы обязательно: в списке таблиц скринридера соседние разбивки
  // с одинаковой шапкой иначе неразличимы.
  if (caption) table.appendChild(el('caption', { class: 'visually-hidden', text: caption }));
  const head = el('tr');
  for (const col of columns) {
    head.appendChild(el('th', {
      scope: 'col', class: col.num ? 'num' : null, text: col.label,
    }));
  }
  table.appendChild(el('thead', {}, [head]));
  const body = el('tbody');
  table.appendChild(body);
  return { table, body };
}

/** Ячейка таблицы: строка кладётся текстом, узел — вложением. */
function cell(value, { num: isNum = false, className = null } = {}) {
  const td = el('td', { class: [isNum ? 'num' : null, className].filter(Boolean).join(' ') || null });
  if (value instanceof Node) td.appendChild(value);
  else td.textContent = value === null || value === undefined ? '—' : String(value);
  return td;
}

/** Строка лесенки запаса: знак операции, название, число и подпись под ними. */
function stackRow(grid, { op = '', name, value, sub = null, total = false, off = false }) {
  const mod = `${total ? ' oos-stack__total' : ''}${off ? ' oos-stack__off' : ''}`;
  grid.appendChild(el('span', { class: `oos-stack__op${mod}`, text: op }));
  grid.appendChild(el('span', { class: `oos-stack__name${mod}`, text: name }));
  grid.appendChild(el('span', { class: `oos-stack__value${mod}`, text: value }));
  if (sub) {
    const box = el('div', { class: 'oos-stack__sub' });
    if (sub instanceof Node) box.appendChild(sub);
    else box.textContent = sub;
    grid.appendChild(box);
  }
}

/** Подпись «значение с капительной надписью» — пара для строки покрытия. */
function coverageItem(labelKey, value, vars = undefined) {
  return el('div', { class: 'oos-coverage__item' }, [
    el('span', { text: t(labelKey, vars) }),
    el('span', { class: 'oos-coverage__value', text: value }),
  ]);
}

/* Легенда прогноза собирается из тех же четырёх записей, что и легенда
   тепловой карты (`HEAT_TONES`). Раньше у неё был свой список из трёх, где
   жёлтый подписывался «Ниже порога FBA», хотя тем же жёлтым красилась строка
   резерва, а на «Обзоре» тот же жёлтый означал «Резерв ниже порога». Одно
   слово носило два цвета, один цвет — два смысла. */

/**
 * Происхождение t30 (§5) раскрывающейся строкой.
 *
 * Показывает три вещи, которых на странице не было вовсе: каким источником
 * получен базовый run-rate, каким окном он измерен и — в режиме «последний
 * полный месяц» — какой месяц взят и почему. Правило §5 («берём последний
 * полный месяц, если он максимум из трёх; иначе среднее за три») до сих пор
 * существовало только внутри движка.
 */
function t30Explain(detail, sim) {
  const box = el('details', { class: 'oos-explain oos-t30' });
  const summary = el('summary', { class: 'oos-explain__summary', text: t('oos.t30.title') });
  box.appendChild(summary);

  if (!detail) {
    box.appendChild(el('p', { class: 'oos-explain__body', text: t('oos.t30.unknown') }));
    return box;
  }

  const lines = [];
  lines.push(t('oos.t30.used', {
    source: t(`oos.params.t30.${detail.used === 'none' ? 'sbUnits' : detail.used}`),
    n: num(detail.units),
  }));
  // Запрошен один источник, сработал другой — молчаливая подмена и есть та
  // причина, по которой числа «не сходятся с Seller Central».
  if (detail.requested !== detail.used) {
    lines.push(t('oos.t30.fallback', { source: t(`oos.params.t30.${detail.requested}`) }));
  }
  if (detail.window && detail.window.from && detail.window.to) {
    lines.push(t('oos.t30.window', { from: day(detail.window.from), to: day(detail.window.to) }));
  }
  if (detail.pick) {
    // Само правило §5 словами, с числами, на которых оно сработало.
    lines.push(detail.pick.mode === 'last'
      ? t('oos.t30.ruleLast', { month: detail.pick.month ?? '—' })
      : t('oos.t30.ruleAverage'));
  }
  if (detail.history && detail.history.length) {
    lines.push(`${t('oos.t30.history')}: ${detail.history
      .map((h) => `${h.month} ${num(h.units)}`).join(' · ')}`);
  }
  // Корекция Prime Day объясняет, почему «t30 с коррекцией» рядом меньше.
  if (sim?.primeDay?.excess > 0) {
    lines.push(t('oos.primeDay.applied', { qty: num(sim.primeDay.excess) }));
  }

  for (const line of lines) box.appendChild(el('p', { class: 'oos-explain__body', text: line }));
  return box;
}

/* Статусы контейнеров, у которых есть своя подпись. Всё остальное — честное
   «статус неизвестен»: движок в этом случае и дату вывел консервативно. */
const CNT_STATUSES = new Set(['arrived', 'ready', 'in-produce', 'in-transit']);

function containerStatus(status) {
  return t(CNT_STATUSES.has(status) ? `oos.cnt.status.${status}` : 'oos.cnt.status.unknown');
}

/** Откуда взялась дата прихода: из отчёта форвардера или выведена по статусу. */
function etaSource(arrival, params) {
  if (arrival.etaDerived !== true) return t('oos.cnt.eta.given');
  if (arrival.status === 'ready' || arrival.status === 'in-transit') {
    return t('oos.cnt.eta.ready', { n: plain(params.etaReadyMonths) });
  }
  if (arrival.status === 'in-produce') {
    return t('oos.cnt.eta.in-produce', { n: plain(params.etaInProduceMonths) });
  }
  if (arrival.status === 'arrived') {
    return t('oos.cnt.eta.arrived', { n: plain(params.etaArrivedDays) });
  }
  return t('oos.cnt.eta.unknown');
}

/* --------------------------------------------------------------------------
   Раздел
   -------------------------------------------------------------------------- */

export const oosProduct = {
  titleKey: 'page.oosProduct.title',
  leadKey: 'page.oosProduct.lead',

  async mount(view, controls) {
    controls.replaceChildren();
    view.replaceChildren();

    const { data, error } = await loadDemoData();
    if (error || !data) {
      // Имя файла показывает `dataErrorState()`: «не загрузилось» без адреса — не диагноз.
      view.appendChild(dataErrorState());
      return () => {};
    }

    let result = computeAll(data, getParams());

    /* Дата расчёта непригодна — считать нечего. Раньше ветку знал только
       «Обзор», а здесь показывалось «В расчёте нет активных товаров» —
       правдоподобная, но чужая причина. */
    const fatal = fatalState(result);
    if (fatal) {
      view.replaceChildren(fatal);
      return () => {};
    }
    setMarketAccents(result.markets);

    /* Живые ресурсы, которые обязана снять уборка: без неё при переключении
       разделов копятся наблюдатели за размером у графиков. */
    const charts = [];
    let tip = null;
    let picker = null;
    let pickerKeys = '';

    const panelBox = paramsPanel();
    const button = paramsButton(panelBox.node);
    const market = marketFilter(() => render());

    controls.appendChild(market.node);
    const pickerSlot = document.createComment('oos-product-picker');
    controls.appendChild(pickerSlot);
    controls.appendChild(button.node);

    let topNode = topBar(getParams(), result);
    view.appendChild(topNode);
    /* Живая область стоит ВЫШЕ панели параметров: всё, что ниже неё,
       перерисовка снимает, и сообщение исчезало бы, не успев прозвучать. */
    const live = liveRegion();
    view.appendChild(live.node);
    view.appendChild(panelBox.node);

    /* ------------------------------------------------------------------
       Выбор товара

       `<select>` пересобирается только тогда, когда изменился сам список
       (сменился фильтр рынка). Пересборка на каждой перерисовке вырывала бы
       фокус из поля и ломала бы проверку монтажа, которая перещёлкивает
       опции одну за другой.
       ------------------------------------------------------------------ */
    function syncPicker(items) {
      const keys = items.map((it) => selectionKey(it.market, it.sku)).join(',');
      if (picker && keys === pickerKeys) { picker.sync(); return; }
      const fresh = productPicker(items, () => render());
      if (picker) {
        picker.dispose();
        picker.node.replaceWith(fresh.node);
      } else {
        pickerSlot.after(fresh.node);
      }
      picker = fresh;
      pickerKeys = keys;
    }

    /* ------------------------------------------------------------------
       Блок 1 — «Сведение стока»
       ------------------------------------------------------------------ */
    function blockStock(it, marketInfo) {
      const box = panel(t('oos.block1.title'), t('oos.block1.subtitle'));

      /* Кого именно мы смотрим — на самой странице, а не только в фильтре:
         заголовок страницы говорит «Карточка товара», и без этой строки
         скриншот блока не отвечает на вопрос «какого». `reportTitle` —
         первичная строка выгрузки, она показывается как есть: весь смысл
         проверки языка §1 в том, что там за язык. */
      const whoLine = el('p', { class: 'panel__subtitle' }, [
        el('span', { text: `${it.sku} · ${pickTitle(it.title)} · ` }),
        marketTag(it.market),
      ]);
      if (it.reportTitle) whoLine.appendChild(el('span', { text: ` · ${it.reportTitle}` }));
      box.querySelector('.panel__titles').appendChild(whoLine);

      const sim = it.simulation;
      const cov = it.coverage;
      const fba = it.item.fba || {};

      /* --- лесенка слагаемых --- */
      const grid = el('div', { class: 'oos-stack' });

      // Раскрытие трёх слагаемых стартового FBA: сумма приходит из движка,
      // слагаемые — из данных, и человек обязан видеть, что сходится.
      const fbaDetails = el('details', { class: 'oos-explain' }, [
        el('summary', { class: 'oos-explain__summary', text: t('oos.stack.fba.parts') }),
        el('p', {
          class: 'oos-explain__body',
          text: `${t('oos.stack.fba.available')} ${num(fba.available)} · `
              + `${t('oos.stack.fba.fcTransfer')} ${num(fba.fcTransfer)} · `
              + `${t('oos.stack.fba.reservedFc')} ${num(fba.reservedFcProcessing)}`,
        }),
        el('p', {
          class: 'oos-explain__body',
          text: `${t('oos.stack.fba.excluded')}: `
              + `${t('oos.stack.fba.reservedCustomer')} ${num(fba.reservedCustomerOrder)} · `
              + `${t('oos.stack.fba.unfulfillable')} ${num(fba.unfulfillable)}`,
        }),
        el('p', { class: 'oos-explain__body', text: t('oos.stack.fba.excludedWhy') }),
      ]);

      stackRow(grid, {
        name: t('oos.stack.fba'), value: num(sim.startFba), sub: fbaDetails,
      });
      stackRow(grid, { op: '+', name: t('oos.stack.awd'), value: num(sim.awdUnits) });

      // Препцентры перечисляются по локациям: выключенный склад остаётся
      // видимым строкой с зачёркнутым числом, а не исчезает из суммы молча.
      const prepList = Array.isArray(it.item.prep) ? it.item.prep : [];
      stackRow(grid, { op: '+', name: t('oos.stack.prep'), value: num(sim.prepUnits) });
      for (const prep of prepList) {
        const on = isPrepOn(prep.id, marketInfo);
        const parts = [`${prep.name}: ${num(prep.units)}`];
        if (prep.cartons) {
          parts.push(t('oos.stack.cartons', {
            cartons: num(prep.cartons), perCarton: num(prep.unitsPerCarton),
          }));
        }
        if (!on) parts.push(t('oos.wh.off'));
        grid.appendChild(el('div', {
          class: `oos-stack__sub${on ? '' : ' oos-stack__off'}`, text: parts.join(' · '),
        }));
      }

      const arrivals = (sim.arrivals || []).filter((a) => a.qty > 0);
      const inTransitSub = arrivals.length
        ? arrivals.map((a) => `${a.containerId ?? t('oos.cnt.reason.shipment')} · `
            + `${day(a.date)} · ${num(a.qty)}`).join(' · ')
        : null;
      stackRow(grid, {
        op: '+',
        name: t('oos.stack.inTransit'),
        value: num(cov.parts?.inTransit),
        sub: inTransitSub,
      });
      stackRow(grid, {
        op: '=', name: t('oos.stack.total'), value: num(cov.total), total: true,
      });
      box.appendChild(grid);

      /* --- полоса состава --- */
      const parts = [
        { key: 'fba', labelKey: 'oos.stack.fba', value: cov.parts?.fba ?? null },
        { key: 'awd', labelKey: 'oos.stack.awd', value: cov.parts?.awd ?? null },
        { key: 'prep', labelKey: 'oos.stack.prep', value: cov.parts?.prep ?? null },
        { key: 'inTransit', labelKey: 'oos.stack.inTransit', value: cov.parts?.inTransit ?? null },
      ];
      const total = typeof cov.total === 'number' && cov.total > 0 ? cov.total : null;

      const bar = el('div', {
        class: 'oos-mix', role: 'img', 'aria-label': t('oos.stack.mixTitle'),
      });
      const legend = el('div', {
        class: 'oos-legend', role: 'list', 'aria-label': t('oos.stack.mixTitle'),
      });
      for (const part of parts) {
        const frac = total === null ? null : safeDiv(part.value, total);
        const seg = el('span', { class: 'oos-mix__seg', 'data-part': part.key });
        // Ширина — единственный инлайновый стиль полосы: цвет задаёт CSS по
        // data-part, чтобы тёмная тема не пришла сюда за правкой.
        seg.style.width = `${frac === null ? 0 : frac * 100}%`;
        bar.appendChild(seg);
        legend.appendChild(el('span', { class: 'oos-legend__item', role: 'listitem' }, [
          el('span', {
            class: 'oos-legend__key oos-legend__key--rect',
            'data-part': part.key, 'aria-hidden': 'true',
          }),
          el('span', { class: 'oos-legend__name', text: t(part.labelKey) }),
          el('span', { class: 'oos-legend__desc', text: `${num(part.value)} · ${share(frac)}` }),
        ]));
      }
      box.appendChild(bar);
      box.appendChild(legend);

      /* --- откуда взят t30 (§5) ---
         Правило выбора месяца жило только внутри движка: на экране t30
         появлялся готовым числом, и проверить его было не по чему — ни
         источника, ни окна, ни истории продаж. */
      box.appendChild(t30Explain(sim.t30Source, sim));

      /* --- два метода покрытия --- */
      const coverage = el('div', { class: 'oos-coverage' }, [
        coverageItem('oos.coverage.fixed', months(cov.fixedMonths)),
        coverageItem('oos.coverage.growth', months(cov.growthMonths)),
        coverageItem('oos.col.t30', num(sim.t30Adjusted)),
        coverageItem('oos.col.growth', num(sim.growth?.value ?? null, 3)),
      ]);
      box.appendChild(coverage);

      // Подпись под покрытием: «кончится тогда-то», «хватает на весь предел»
      // или «продажи не заданы» — три разных ответа, а не одно молчание.
      const exhaust = cov.growthMonths === null
        ? t('oos.coverage.none')
        : (cov.capped
          ? t('oos.coverage.capped', { n: plain(getParams().coverageCapMonths) })
          : t('oos.coverage.exhaust', { date: day(cov.exhaustDate, true) }));
      box.appendChild(el('p', { class: 'oos-explain__body', text: exhaust }));

      // Коррекция Prime Day и зажим роста объясняют, почему t30 рядом не равен
      // продажам за 30 дней из отчёта.
      const pd = sim.primeDay;
      const pdText = !pd || pd.mode === 'off'
        ? t('oos.primeDay.off')
        : (pd.excess > 0
          ? t('oos.primeDay.applied', { qty: num(pd.t30 - pd.adjusted) })
          : t('oos.primeDay.none'));
      const growthText = sim.growth?.clamped ? ` · ${t('oos.growth.clamped')}` : '';
      box.appendChild(el('p', { class: 'oos-explain__body', text: pdText + growthText }));

      box.appendChild(explain('oos.explain.awdTitle', 'oos.explain.awdBody'));
      box.appendChild(explain('oos.explain.growthTitle', 'oos.explain.growthBody'));

      return box;
    }

    /* ------------------------------------------------------------------
       Блок 2 — «Прогноз по полумесяцам»

       Девять рядов берутся из `simulation` (с плановыми заказами), а не из
       `baseline`: иначе строка «прямая поставка» была бы пустой во всех
       периодах. Статус товара при этом остаётся из `baseline` — это разные
       вопросы: «что будет, если ничего не делать» и «из чего складывается план».
       ------------------------------------------------------------------ */
    function blockForecast(it, pending) {
      /* Третьей строкой шапки — чей это прогон. Здесь показан `simulation`
         (с плановыми заказами), а карта «Обзора» — `baseline` (без них), и
         на трёх парах из пятнадцати числа расходятся. Без подписи это
         читается как расхождение расчёта. */
      const box = panel(t('oos.block2.title'), t('oos.block2.subtitle'));
      box.querySelector('.panel__titles')
        .appendChild(el('p', { class: 'panel__subtitle', text: t('oos.run.simulation') }));
      const sim = it.simulation;
      const periods = sim.periods || [];
      const rows = sim.rows || [];
      const f = sim.forecast || {};

      if (!periods.length) {
        box.appendChild(stateBox('oos.empty.noPeriods'));
        return box;
      }

      tip = createTooltip(box);

      /* --- таблица 9 × N --- */
      const table = el('table', { class: 'oos-forecast' });
      table.appendChild(el('caption', {
        class: 'visually-hidden',
        text: `${t('oos.block2.title')} · ${it.sku} · ${it.market}`,
      }));
      const head = el('tr');
      head.appendChild(el('th', { scope: 'col', text: t('oos.col.period') }));
      for (const period of periods) {
        head.appendChild(el('th', { scope: 'col', text: formatPeriod(period) }));
      }
      table.appendChild(el('thead', {}, [head]));

      const body = el('tbody');
      for (const key of FORECAST_ROWS) {
        const values = Array.isArray(f[key]) ? f[key] : [];
        const tr = el('tr');
        tr.appendChild(el('th', {
          scope: 'row', class: 'oos-forecast__rowhead', text: t(`oos.row.${key}`),
        }));
        periods.forEach((period, i) => {
          const row = rows[i] || {};
          const value = values[i] ?? null;
          const tone = toneFor(key, row);
          const td = tone ? toneCell(num(value), tone) : cell(num(value), { num: true });

          const hint = hintFor(key, row, f, i);
          if (hint) {
            /* Подсказка появляется по наведению, а её текст лежит в ячейке
               скрытым: иначе он остался бы недоступен тем, кто мышью не
               пользуется. Своей точки табуляции ячейка не получает — 22
               лишние остановки на пути к содержимому дороже, чем польза. */
            td.appendChild(el('span', { class: 'visually-hidden', text: hint.text }));
            td.addEventListener('mouseenter', () => tip?.show(td, [
              { name: formatPeriod(period, true), value: null },
              ...hint.rows,
            ]));
            td.addEventListener('mouseleave', () => tip?.hide());
          }
          tr.appendChild(td);
        });
        body.appendChild(tr);
      }
      table.appendChild(body);
      const scroll = tableWrap(table);
      scroll.classList.add('oos-forecast-scroll');
      box.appendChild(scroll);
      box.appendChild(statusLegend(HEAT_TONES));

      /* --- два графика на одной оси X --- */
      const labels = periods.map((p) => formatPeriod(p));
      const titles = periods.map((p) => formatPeriod(p, true));
      const series = [
        { name: t('oos.series.fbaEnd'), values: f.fbaEnd || [] },
        {
          name: t('oos.series.thresholdFba'),
          values: f.thresholdFba || [],
          /* Порог — опорная линия, а не серия. Статусный жёлтый давал 1,79:1
             к поверхности графика в светлой теме: штрих в 2 px, от которого
             читается весь график, был практически невидим. Приглушённый
             чернильный проходит 3:1 в обеих темах, а пунктир говорит
             «это уровень, а не измерение». */
          color: 'var(--ink-3)',
          dash: '6 4',
        },
      ];

      const charts2 = el('div', { class: 'oos-charts' });
      const lineTitle = el('h3', { class: 'panel__title', text: t('oos.chart.fba.title') });
      const lineBox = el('div');
      const legendBox = el('div', { class: 'legend' });
      const salesTitle = el('h3', { class: 'panel__title', text: t('oos.chart.sales.title') });
      const salesBox = el('div');
      const marksLegend = el('div', { class: 'oos-legend', role: 'list', 'aria-label': t('oos.chart.marks') });
      /* Легенда идёт ПЕРЕД графиком — так же, как в «Продажах по неделям»:
         общий класс `.legend` под это заточен отступом снизу, а легенда
         после графика читается как подпись к следующему блоку. */
      charts2.append(lineTitle, legendBox, lineBox, salesTitle, marksLegend, salesBox);
      box.appendChild(charts2);

      /* Отметки прибытия поставок. Форма ромба одна на оба типа, поэтому тип
         обязан стоять в подписи: раньше там были только номер контейнера и
         количество, и «приход на FBA» от «прихода на препцентр» не отличался
         ничем — при том что готовые строки словаря на это лежали без дела. */
      const marks = periods.map((period) => (sim.arrivals || [])
        .filter((a) => a.qty > 0 && a.date >= period.start && a.date <= period.end)
        .map((a) => ({
          kind: a.target === 'PREP' ? 'prep' : 'fba',
          label: `${t(a.target === 'PREP' ? 'oos.mark.arrivalPrep' : 'oos.mark.arrivalFba')}`
            + ` · ${a.containerId ?? t('oos.cnt.reason.shipment')} · ${num(a.qty)}`,
        })));
      const markKinds = [...new Set(marks.flat().map((m) => m.kind))];
      for (const kind of markKinds) {
        marksLegend.appendChild(el('span', { class: 'oos-legend__item', role: 'listitem' }, [
          el('span', { class: 'oos-legend__key oos-legend__key--mark', 'data-mark': kind, 'aria-hidden': 'true' }),
          el('span', {
            class: 'oos-legend__name',
            text: t(kind === 'prep' ? 'oos.mark.arrivalPrep' : 'oos.mark.arrivalFba'),
          }),
        ]));
      }

      const salesValues = f.sales || [];
      const salesTotal = salesValues.reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0);

      /* Графики создаются после того, как узлы попали в документ: charts.js
         меряет `clientWidth` и на скрытом контейнере уходит в ранний возврат. */
      pending.push(() => {
        const line = createLineChart(lineBox);
        line.update({
          labels,
          tooltipTitles: titles,
          series,
          formatValue: (v) => num(v),
          ariaLabel: t('oos.chart.fba.aria'),
          emptyText: t('oos.empty.chart'),
          height: 260,
        });
        charts.push(line);
        renderLegend(legendBox, series, { mark: 'line' });

        if (salesTotal > 0) {
          const bars = createStackedColumnChart(salesBox);
          bars.update({
            labels,
            tooltipTitles: titles,
            series: [{ name: t('oos.series.sales'), values: salesValues }],
            marks,
            formatValue: (v) => num(v),
            ariaLabel: t('oos.chart.sales.aria'),
            emptyText: t('oos.empty.chart'),
            height: 220,
          });
          charts.push(bars);
        } else {
          // Столбцы из одних нулей charts.js рисует пустой сеткой и молчит —
          // молчание тут выглядит как поломка, поэтому отвечаем словами.
          salesBox.appendChild(stateBox('oos.empty.chart'));
        }
      });

      return box;
    }

    /* ------------------------------------------------------------------
       Блок 3 — «Заказы»
       ------------------------------------------------------------------ */
    function blockOrders(it, marketInfo) {
      const box = panel(t('oos.block3.title'), t('oos.block3.subtitle'));
      const periods = it.simulation.periods || [];
      const asOf = result.asOf;

      // Непоправимое окно идёт ПЕРЕД таблицей: заказ его не закрывает, и
      // человек должен прочитать это раньше, чем начнёт читать план.
      if (it.unrecoverable.length) {
        const unrec = el('div', { class: 'oos-unrec' }, [
          statusIcon('error'),
          el('b', { text: t('oos.unrec.title') }),
          el('p', { text: t('oos.unrec.body') }),
        ]);
        const list = el('ul', { class: 'oos-unrec__list' });
        for (const gap of it.unrecoverable) {
          const period = periodById(gap.periodId, periods);
          list.appendChild(el('li', {
            text: t('oos.unrec.period', {
              period: period ? formatPeriod(period) : String(gap.periodId ?? '—'),
              qty: num(gap.shortfall),
            }),
          }));
        }
        unrec.appendChild(list);
        unrec.appendChild(el('p', { text: t('oos.unrec.what') }));
        // Подпись уже содержит слово «мес.», поэтому сюда идёт голое число,
        // а не months(): иначе получилось бы «4 мес. мес.».
        unrec.appendChild(explain('oos.explain.unrecTitle', 'oos.explain.unrecBody', {
          n: plain(getParams().leadTimeMonths),
        }));
        box.appendChild(unrec);

        // Ускорять нечего — тоже ответ: значит готовых и производящихся
        // партий по товару нет, и решение придётся искать вне заказа.
        if (it.expedite.length) {
          box.appendChild(el('h3', { class: 'panel__title', text: t('oos.expedite.title') }));
          const exp = dataTable([
            { label: t('oos.col.container') },
            { label: t('oos.col.cntStatus') },
            { label: t('oos.col.units'), num: true },
            { label: t('oos.col.eta') },
            { label: t('oos.col.covers') },
          ], '', `${t('oos.expedite.title')} · ${it.sku} · ${it.market}`);
          for (const line of it.expedite) {
            const period = periodById(line.targetPeriodId, periods);
            exp.body.appendChild(el('tr', {}, [
              cell(line.containerId),
              cell(containerStatus(line.status)),
              cell(num(line.qty), { num: true }),
              cell(t('oos.expedite.current', { date: day(line.currentEta) })),
              cell(period
                ? t('oos.expedite.covers', { period: formatPeriod(period) })
                : '—'),
            ]));
          }
          box.appendChild(tableWrap(exp.table));
        } else {
          box.appendChild(stateBox('oos.expedite.none'));
        }
      }

      if (!periods.length) {
        /* Пустой горизонт — не «заказов не требуется»: считать было нечего,
           и обещать, что конвейер всё покрывает, здесь было бы неправдой. */
        box.appendChild(stateBox('oos.empty.noPeriods'));
        return box;
      }

      if (!it.orders.length) {
        box.appendChild(stateBox('oos.orders.none', 'oos.orders.noneWhy'));
        return box;
      }

      const table = dataTable([
        { label: t('oos.col.orderBy') },
        { label: t('oos.col.arrival') },
        { label: t('oos.col.qty'), num: true },
        { label: t('oos.col.need'), num: true },
        { label: t('oos.col.channel') },
        { label: t('oos.col.covers') },
      ], '', `${t('oos.block3.title')} · ${it.sku} · ${it.market}`);
      for (const order of it.orders) {
        const period = periodById(order.periodId, periods);
        const orderBy = el('td', {}, [document.createTextNode(day(order.orderBy))]);
        // «Заказать до» = дата расчёта означает «сегодня»: срок уже наступил.
        if (order.orderBy && asOf && order.orderBy === asOf) {
          orderBy.appendChild(document.createTextNode(' '));
          orderBy.appendChild(el('b', { text: t('oos.orders.today') }));
        }
        const channel = order.channel === 'prep-refill' && order.prepId
          ? `${t('oos.channel.prep-refill')} · ${prepName(order.prepId, marketInfo, it)}`
          : t(`oos.channel.${order.channel}`);
        table.body.appendChild(el('tr', {}, [
          orderBy,
          cell(day(order.arrival)),
          cell(num(order.qty), { num: true }),
          cell(num(order.need), { num: true }),
          cell(channel),
          cell(period
            ? t('oos.orders.covers', { period: formatPeriod(period), qty: num(order.need) })
            : '—'),
        ]));
      }
      box.appendChild(tableWrap(table.table));
      box.appendChild(explain('oos.explain.roundingTitle', 'oos.explain.roundingBody', {
        de: plain(getParams().roundingStep?.DE ?? null),
        uk: plain(getParams().roundingStep?.UK ?? null),
      }));
      return box;
    }

    /* ------------------------------------------------------------------
       Блок 4 — «Контейнеры»

       Учтённые и отброшенные в ОДНОЙ таблице. Отброшенная строка под
       `<details>` выглядит как потерянные данные: «где ещё 6 000 штук» —
       первый вопрос, который задают этой странице.
       ------------------------------------------------------------------ */
    function blockContainers(it, marketInfo) {
      const box = panel(t('oos.block4.title'), t('oos.block4.subtitle'));
      const sim = it.simulation;
      const params = getParams();
      const arrivals = sim.arrivals || [];
      const excluded = sim.excludedContainers || [];

      if (!arrivals.length && !excluded.length) {
        box.appendChild(stateBox('oos.cnt.empty', 'oos.cnt.emptyHint'));
        return box;
      }

      const rows = Array.isArray(it.item.containers) ? it.item.containers : [];
      const table = dataTable([
        { label: t('oos.col.container') },
        { label: t('oos.col.units'), num: true },
        { label: t('oos.col.eta') },
        { label: t('oos.col.etaSource') },
        { label: t('oos.col.target') },
        { label: t('oos.col.cntStatus') },
        { label: t('oos.col.forwarder') },
        { label: t('oos.col.reason') },
      ], 'oos-cnt', `${t('oos.block4.title')} · ${it.sku} · ${it.market}`);

      for (const arrival of arrivals) {
        const source = rows.find((c) => c.id === arrival.containerId) || null;
        const target = arrival.target === 'PREP'
          ? `${t('oos.cnt.target.PREP')} · ${prepName(arrival.prepId, marketInfo, it)}`
          : t('oos.cnt.target.FBA');

        let reason;
        if (arrival.target === 'PREP') {
          reason = t('oos.cnt.reason.prep', { prep: prepName(arrival.prepId, marketInfo, it) });
        } else if (arrival.source === 'shipment') {
          reason = t('oos.cnt.reason.shipment');
        } else if (arrival.qty === 0 && arrival.status === 'arrived') {
          reason = t('oos.cnt.reason.arrived');
        } else {
          reason = t('oos.cnt.reason.fba');
        }
        // Объём строки отличается от учтённого у прибывших и у остатков
        // отправки — тогда второе число уходит в причину, а не в колонку.
        if (arrival.units !== arrival.qty) {
          reason += ` (${t('oos.units', { n: num(arrival.units) })})`;
        }

        table.body.appendChild(el('tr', {}, [
          cell(arrival.containerId ?? arrival.shipmentId ?? '—'),
          cell(num(arrival.qty), { num: true }),
          cell(day(arrival.date)),
          cell(etaSource(arrival, params)),
          cell(target),
          cell(containerStatus(arrival.status)),
          cell(source?.forwarder ?? arrival.shipmentId ?? '—'),
          cell(el('span', {}, [
            el('b', { text: `${t('oos.cnt.counted')}. ` }),
            document.createTextNode(reason),
          ]), { className: 'oos-cnt__reason' }),
        ]));
      }

      for (const drop of excluded) {
        const vars = drop.prepId ? { prep: prepName(drop.prepId, marketInfo, it) } : undefined;
        const tr = el('tr', { class: 'oos-cnt--out' }, [
          cell(drop.id),
          cell(num(drop.units), { num: true }),
          cell('—'),
          cell('—'),
          cell('—'),
          cell('—'),
          cell(drop.forwarder ?? '—'),
          cell(el('span', {}, [
            el('b', { text: `${t('oos.cnt.dropped')}. ` }),
            document.createTextNode(t(`oos.cnt.reason.${drop.reason}`, vars)),
          ]), { className: 'oos-cnt__reason' }),
        ]);
        table.body.appendChild(tr);
      }

      box.appendChild(tableWrap(table.table));
      return box;
    }

    /* ------------------------------------------------------------------
       Блок 5 — «Склады»
       ------------------------------------------------------------------ */
    function blockWarehouses(it, marketInfo) {
      const box = panel(t('oos.block5.title'), t('oos.block5.subtitle'));
      const sim = it.simulation;
      const first = (sim.rows || [])[0] || null;
      const t30 = sim.t30Adjusted;

      const table = dataTable([
        { label: t('oos.col.warehouse') },
        { label: t('oos.col.stock'), num: true },
        { label: t('oos.col.coverMonths'), num: true },
        { label: t('oos.col.threshold'), num: true },
        { label: t('oos.col.inCalc') },
      ], 'oos-wh', `${t('oos.block5.title')} · ${it.sku} · ${it.market}`);

      const nameCell = (name, typeKey, extra = []) => cell(el('div', {}, [
        el('div', { text: name }),
        el('div', { class: 'oos-wh__note', text: t(typeKey) }),
        ...extra,
      ]));

      table.body.appendChild(el('tr', {}, [
        nameCell(t('oos.wh.fba'), 'oos.wh.type.fba'),
        cell(num(sim.startFba), { num: true }),
        cell(months(safeDiv(sim.startFba, t30)), { num: true }),
        cell(num(first ? first.thresholdFba : null), { num: true }),
        cell(t('oos.wh.inCalc.yes')),
      ]));

      table.body.appendChild(el('tr', {}, [
        nameCell(t('oos.wh.awd'), 'oos.wh.type.awd'),
        cell(num(sim.awdUnits), { num: true }),
        cell(months(safeDiv(sim.awdUnits, t30)), { num: true }),
        // Своего порога у AWD нет: он проверяется в сумме с препцентром.
        cell('—', { num: true }),
        cell(t('oos.wh.inCalc.yes')),
      ]));

      for (const prep of (it.item.prep || [])) {
        const info = findPrepInfo(prep.id, marketInfo);
        const on = isPrepOn(prep.id, marketInfo);
        const extra = [];
        if (!on) extra.push(el('div', { class: 'oos-wh__note', text: t('oos.wh.offWhy') }));
        // Примечание из файла показывается как есть: это первичные данные,
        // ключами словаря они не переводятся.
        if (info?.note) {
          extra.push(el('div', {
            class: 'oos-wh__note', text: `${t('oos.wh.note')}: ${info.note}`,
          }));
        }
        const tr = el('tr', { 'data-off': on ? null : 'true' }, [
          nameCell(prep.name || prep.id, 'oos.wh.type.prep', extra),
          cell(num(prep.units), { num: true }),
          cell(months(safeDiv(prep.units, t30)), { num: true }),
          cell('—', { num: true }),
          cell(t(`oos.wh.inCalc.${on ? 'yes' : 'no'}`)),
        ]);
        table.body.appendChild(tr);
      }

      /* Итоговая строка несёт вердикт: порог общий на сумму AWD и препа,
         распределение между складами значения не имеет. */
      const reserve = (sim.awdUnits ?? 0) + (sim.prepUnits ?? 0);
      const threshold = first ? first.thresholdReserve : null;
      const gap = threshold === null ? null : threshold - reserve;
      const verdict = threshold === null
        ? '—'
        : (gap > 0
          ? t('oos.wh.thresholdMissed', { qty: num(gap) })
          : t('oos.wh.thresholdMet'));
      const foot = el('tfoot', {}, [el('tr', { class: 'breakdown__total' }, [
        cell(t('oos.wh.reserveSum')),
        cell(num(reserve), { num: true }),
        cell(months(safeDiv(reserve, t30)), { num: true }),
        cell(num(threshold), { num: true }),
        cell(verdict),
      ])]);
      table.table.appendChild(foot);

      box.appendChild(tableWrap(table.table));
      box.appendChild(explain('oos.explain.reserveTitle', 'oos.explain.reserveBody'));
      /* Лаг берётся из строк симуляции этого товара, а не из запасного
         `params.prepLagDays`: у AsiaLog он 45 дней, расчёт применяет именно
         его, а карточка показывала общие семь — то самое «число в двух
         местах», из-за которого справочник складов объявлен единственным
         источником лагов. */
      const lagDays = [...new Set((sim.prepSources || [])
        .map((c) => c.lagDays)
        .filter((n) => Number.isFinite(n)))];
      box.appendChild(explain('oos.explain.safetyTitle', 'oos.explain.safetyBody', {
        n: lagDays.length
          ? lagDays.map((n) => plain(n)).join(' / ')
          : plain(getParams().prepLagDays),
      }));
      return box;
    }

    /* ------------------------------------------------------------------
       Плитки товара
       ------------------------------------------------------------------ */
    function tiles(it) {
      const sim = it.simulation;
      const base = it.baseline;
      const cov = it.coverage;
      const fba = it.item.fba || {};
      const periods = sim.periods || [];

      const coverNote = cov.growthMonths === null
        ? t('oos.coverage.none')
        : (cov.capped
          ? t('oos.coverage.capped', { n: plain(getParams().coverageCapMonths) })
          : t('oos.coverage.exhaust', { date: day(cov.exhaustDate, true) }));

      const problem = periodById(base.firstProblemPeriod, periods);
      const problemTile = statTile(
        t('oos.kpi.firstProblem'),
        problem ? formatPeriod(problem) : '—',
      );
      // Плашка статуса — узел, а не строка: `statTile` принимает только текст,
      // поэтому пояснение дописывается вручную.
      // Статус — из baseline: «что будет, если ничего не делать». Таблица
      // прогноза ниже — из simulation, и разница между ними и есть план.
      problemTile.appendChild(el('div', { class: 'stat__delta' }, [
        statusBadge(it.status),
        el('span', { class: 'oos-check__hint', text: t('oos.run.baseline') }),
      ]));

      return kpiRow([
        statTile(t('oos.kpi.startFba'), num(sim.startFba), t('oos.kpi.startFbaNote', {
          a: num(fba.available), b: num(fba.fcTransfer), c: num(fba.reservedFcProcessing),
        })),
        statTile(t('oos.kpi.reserve'), num((sim.awdUnits ?? 0) + (sim.prepUnits ?? 0)),
          t('oos.wh.reserveSum')),
        statTile(t('oos.kpi.cover'), months(cov.growthMonths), coverNote, true),
        problemTile,
        statTile(t('oos.kpi.orderUnits'), num(it.orderUnits),
          t('oos.kpi.orderUnitsNote', { n: num(it.orders.length) })),
      ]);
    }

    /* ------------------------------------------------------------------
       Перерисовка тела страницы
       ------------------------------------------------------------------ */
    function render() {
      const params = getParams();

      /* Панель полей не пересобирается — только синхронизируется: параметры
         правит ещё и окно настроек («Интеграции» делит с ней набор
         препцентров), и без этого её галочки разошлись бы с расчётом. */
      panelBox.sync();

      // Шапка пересобирается целиком: пороги в ней и есть то, что изменилось.
      const freshTop = topBar(params, result);
      view.replaceChild(freshTop, topNode);
      topNode = freshTop;

      // Всё, что ниже панели параметров, снимается: панель остаётся тем же
      // узлом, иначе ввод «1.5» терял бы фокус на промежуточном «1.».
      while (panelBox.node.nextSibling) view.removeChild(panelBox.node.nextSibling);
      for (const chart of charts.splice(0)) chart.destroy();
      tip?.dispose();
      tip = null;

      const filter = getMarketFilter();
      const items = result.items.filter((it) => filter === 'both' || it.market === filter);

      /* Неактивная пара опознаётся ДО пересборки списка: `productPicker`
         вызывает `resolveSelection`, а тот переводит выбор на первый активный
         товар, и ветка «выбран неактивный» иначе никогда не сработала бы. */
      const selection = getSelection();
      const inactive = result.inactive.find((row) => row.market === selection.market
        && row.sku === selection.sku
        && (filter === 'both' || row.market === filter));

      // Неактивная пара попадает в список выбора только пока она выбрана:
      // иначе select и тело страницы показывали бы разные товары.
      syncPicker(inactive ? [...items, inactive] : items);

      /* Рынок, не прошедший проверку данных §1.2, не считается вовсе. Плашка
         показывается и тогда, когда второй рынок посчитан: молчание означало
         бы, что на экране весь ассортимент, а на экране половина. */
      const blocked = result.markets.filter((m) => m.blocked
        && (filter === 'both' || m.code === filter));
      if (blocked.length) {
        view.appendChild(emptyState('oos.empty.blocked', null, {
          vars: { market: blocked.map((m) => m.code).join(', ') },
        }));
      }

      if (!items.length && !inactive) {
        // Про заблокированный рынок уже сказано выше; «под фильтр ничего не
        // попало» второй раз объясняло бы ту же пустоту другой причиной.
        if (!blocked.length) {
          view.appendChild(emptyState(filter === 'both' ? 'oos.empty.noItems' : 'oos.empty.filtered'));
        }
        return;
      }

      /* Неактивная пара выбрана на соседней странице: она не рассчитывается,
         и показывать ей прогноз нечем. Показываем то, что о ней известно,
         и причину — вместо пустых таблиц с нулями. */
      if (inactive) {
        const box = panel(t('oos.block1.title'), t('oos.block1.subtitle'));
        box.querySelector('.panel__titles').appendChild(el('p', {
          class: 'panel__subtitle',
          text: `${inactive.sku} · ${pickTitle(inactive.title)} · ${inactive.market}`,
        }));
        box.appendChild(el('p', {}, [statusBadge('inactive')]));
        box.appendChild(el('p', {
          class: 'oos-explain__body',
          text: t(`oos.inactive.reason.${inactive.reason}`),
        }));
        /* Итога у этой лесенки нет намеренно: движок для неактивной пары
           суммы не считает, а складывать её на странице значило бы завести
           второй источник числа. Продажи стоят отдельной строкой — именно они
           объясняют, почему пара выпала из расчёта. */
        const grid = el('div', { class: 'oos-stack' });
        stackRow(grid, { name: t('oos.stack.fba'), value: num(inactive.startFba) });
        stackRow(grid, { op: '+', name: t('oos.stack.awd'), value: num(inactive.awdUnits) });
        stackRow(grid, { op: '+', name: t('oos.stack.prep'), value: num(inactive.prepUnits) });
        box.appendChild(grid);
        box.appendChild(el('p', {
          class: 'oos-explain__body',
          text: `${t('oos.col.sales')}: ${num(inactive.salesT30)}`,
        }));
        view.appendChild(box);
        return;
      }

      const it = resolveSelection(items);
      if (!it) {
        view.appendChild(emptyState('oos.empty.noItems'));
        return;
      }
      picker?.sync();

      const marketInfo = result.markets.find((m) => m.code === it.market) || null;
      const pending = [];

      view.appendChild(tiles(it));
      view.appendChild(blockStock(it, marketInfo));
      view.appendChild(blockForecast(it, pending));
      view.appendChild(blockOrders(it, marketInfo));
      view.appendChild(blockContainers(it, marketInfo));
      view.appendChild(blockWarehouses(it, marketInfo));

      // Графики строятся последними: узлы уже в документе, ширина известна.
      for (const step of pending) step();

      // Пересчёт объявляется числами: «готово» ничего не сообщает.
      live.say(t('oos.live.product', {
        sku: it.sku,
        market: it.market,
        cover: months(it.coverage.growthMonths),
        qty: num(it.orderUnits),
      }));
    }

    render();

    /* Любая правка параметров пересчитывает набор целиком и перерисовывает
       страницу; панель при этом остаётся на месте и только синхронизируется. */
    const off = onParamsChange((params) => {
      result = computeAll(data, params);
      render();
    });

    return () => {
      off();
      for (const chart of charts.splice(0)) chart.destroy();
      tip?.dispose();
      tip = null;
      picker?.dispose();
      market.dispose();
      button.dispose();
      panelBox.dispose();
    };
  },
};

/* --------------------------------------------------------------------------
   Функции, которым не нужно замыкание mount()
   -------------------------------------------------------------------------- */

/** Участвует ли склад в расчёте — по снимку рынка из результата движка. */
function isPrepOn(prepId, marketInfo) {
  const info = findPrepInfo(prepId, marketInfo);
  // Склад, которого нет в справочнике рынка, движок в расчёт не берёт.
  return info ? info.selected === true : false;
}

function findPrepInfo(prepId, marketInfo) {
  if (!prepId || !marketInfo || !Array.isArray(marketInfo.prepCenters)) return null;
  return marketInfo.prepCenters.find((p) => p.id === prepId) || null;
}

/** Имя склада для подписи: из справочника рынка, из товара или сам идентификатор. */
function prepName(prepId, marketInfo, it) {
  if (!prepId) return '—';
  const info = findPrepInfo(prepId, marketInfo);
  if (info?.name) return info.name;
  const own = (it?.item?.prep || []).find((p) => p.id === prepId);
  return own?.name || String(prepId);
}

/**
 * Тон ячейки. Раскрашиваются ровно две строки из девяти: светофор из 99
 * ячеек не читается вовсе — цвет перестаёт означать «сюда смотри», когда он
 * стоит везде.
 */
function toneFor(key, row) {
  // Имена тонов — те же, что у карты и у плашек статуса. Общий «warn» на две
  // разные строки означал, что «Ниже порога FBA» и «Резерв ниже порога»
  // выглядят одинаково, а легенда объясняет обе одним словом.
  if (key === 'fbaEnd') {
    if (row.shortfall > 0) return 'oos';
    return row.fbaEnd < row.thresholdFba ? 'below-fba' : 'ok';
  }
  if (key === 'reserve') {
    return row.reserveEnd < row.thresholdReserve ? 'below-reserve' : 'ok';
  }
  return null;
}

/** Подсказка ячейки: разбивка величины, которую само число не показывает. */
function hintFor(key, row, f, i) {
  // Разбивка нужна там, где есть что разбивать: «конвейер 0, из AWD 0» —
  // шум, который прячет настоящие подсказки соседних ячеек.
  if (key === 'inflow' && (f.inflow?.[i] ?? 0) > 0) {
    const vars = { pipeline: num(f.inflowPipeline?.[i]), awd: num(f.inflowAwd?.[i]) };
    return { text: t('oos.row.inflow.hint', vars), rows: [
      { name: t('oos.row.inflow'), value: t('oos.row.inflow.hint', vars) },
    ] };
  }
  if (key === 'sales' && row.salesActual < row.salesPlan) {
    const vars = { plan: num(row.salesPlan), actual: num(row.salesActual) };
    return { text: t('oos.row.sales.hint', vars), rows: [
      { name: t('oos.row.sales'), value: t('oos.row.sales.hint', vars) },
    ] };
  }
  if (key === 'fbaEnd') {
    const gap = row.shortfall > 0 ? num(row.shortfall) : t('oos.heat.gapNone');
    return {
      text: `${t('oos.col.fbaEnd')} ${num(row.fbaEnd)} · `
          + `${t('oos.col.threshold')} ${num(row.thresholdFba)} · ${t('oos.col.gap')} ${gap}`,
      rows: [
        { name: t('oos.col.fbaEnd'), value: num(row.fbaEnd) },
        { name: t('oos.col.threshold'), value: num(row.thresholdFba) },
        { name: t('oos.col.gap'), value: gap },
      ],
    };
  }
  if (key === 'reserve') {
    const vars = { awd: num(row.awdEnd), prep: num(row.prepEnd) };
    return { text: t('oos.row.reserve.hint', vars), rows: [
      { name: t('oos.row.reserve'), value: t('oos.row.reserve.hint', vars) },
    ] };
  }
  return null;
}
