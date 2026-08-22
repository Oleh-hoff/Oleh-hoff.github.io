/* ==========================================================================
   Раздел «Логистика» → страница «План заказов» (маршрут oos-orders).

   Ответ на вопрос «что и когда заказывать» по всему ассортименту сразу (§10
   методики). Обзор отвечает «где горит», карточка — «что с этим товаром»,
   а здесь весь план сведён в одну ленту и одну таблицу.

   ПОЧЕМУ ЗДЕСЬ НЕТ НИ ОДНОГО ЗАХАРДКОЖЕННОГО ЧИСЛА
   Всё, что видно на экране, приходит из `computeAll()`: демо-JSON содержит
   только сырьё, готовых результатов в нём нет. Смена любого параметра
   расчёта пересчитывает страницу целиком — полный прогон занимает около
   30 мс на демо-наборе, и это дешевле, чем городить инкрементальный пересчёт
   с промежуточным состоянием, которое можно рассинхронизировать.

   ПОЧЕМУ ЛЕНТА — CSS GRID, А НЕ SVG
   Диаграммы Ганта в `charts.js` нет ни в одном из пяти конструкторов, а
   сетка ленты совпадает с сеткой полумесячных периодов. Значит хватает
   CSS Grid: подписи остаются настоящим текстом, ширину мерить не нужно,
   и `ResizeObserver` на странице не заводится вовсе. Отсюда же следует, что
   в `mount-check` у раздела не стоит ни `charts`, ни `observers`: пустой
   счётчик `disconnect()` завалил бы прогон исправного кода.

   ПОЧЕМУ СТРОКА ЛЕНТЫ — ТОВАР, А НЕ ЗАКАЗ
   Строк плана 65, и лента из 65 дорожек — это 1 800 px по вертикали.
   15 дорожек с несколькими полосами в каждой читаются целиком, поэтому
   полосы внутри дорожки раскладываются жадной упаковкой по подрядам.

   ПОЧЕМУ ЦВЕТ ПОЛОСЫ — КАТЕГОРИАЛЬНЫЙ, А НЕ СТАТУСНЫЙ
   Канал — это идентичность («куда едет»), а не состояние. Красная полоса
   «ускорения» читалась бы как ошибка, поэтому статусные токены на ленте не
   используются вовсе: цвета закреплены за каналами в `oos.css`, а ускорение
   продублировано штриховкой и знаком в подписи — без цвета оно тоже видно.
   ========================================================================== */

import { t } from '../i18n.js';
import { el, statTile, panel, tableWrap } from '../fba-spec.js';
import { computeAll, daysBetween } from '../oos-engine.js';
import { getParams, onParamsChange } from '../oos-params.js';
import {
  CHANNELS,
  loadDemoData, dataErrorState, emptyState, fatalState,
  getMarketFilter, getChannelFilter, getSort, setSelection,
  num, day, plain, units, pickTitle, formatPeriod, clampPeriodIndex, periodById,
  topBar, statusBadge, channelLegend, createTooltip, marketTag, setMarketAccents,
  marketFilter, channelFilter, paramsPanel, paramsButton, liveRegion,
  focusAddress, restoreFocus, nearestDeadline,
  kpiRow, explain, sortableHead, productLink, productHref,
} from '../oos-shared.js';

/* Ширина колонки ленты и цена одного знака в подписи — из `oos.css`
   (`minmax(56px, 1fr)`, `--fs-xs`). Числа нужны, чтобы решить, помещается ли
   количество ПРЯМО на полосе: обрезанная подпись хуже отсутствующей, а
   мерить настоящую ширину в момент сборки нечем — раздел монтируется до
   того, как браузер разложит сетку. */
const COL_WIDTH = 56;
const CHAR_WIDTH = 7;
const BAR_PADDING = 16;

/* Столбцы таблицы плана. `covers` не сортируется: это собранная фраза, а не
   величина, и сортировка по её тексту сортировала бы по алфавиту периодов. */
const COLUMNS = [
  { key: 'orderBy', labelKey: 'oos.col.orderBy', defaultDir: 'asc' },
  { key: 'arrival', labelKey: 'oos.col.arrival', defaultDir: 'asc' },
  { key: 'product', labelKey: 'oos.col.product', defaultDir: 'asc' },
  { key: 'market', labelKey: 'oos.col.market', defaultDir: 'asc' },
  { key: 'qty', labelKey: 'oos.col.qty', num: true, defaultDir: 'desc' },
  { key: 'need', labelKey: 'oos.col.need', num: true, defaultDir: 'desc' },
  { key: 'channel', labelKey: 'oos.col.channel', defaultDir: 'asc' },
  { key: 'covers', labelKey: 'oos.col.covers', sortable: false },
];

/* Ключи сортировки. `orderBy` у ускорения отсутствует — вместо него берётся
   прибытие: строка без даты заказа не должна проваливаться в конец списка
   молча, её место определяет то, когда партия физически приедет. */
const SORT_KEYS = {
  orderBy: (r) => r.orderBy ?? r.arrival ?? '',
  arrival: (r) => r.arrival ?? '',
  product: (r) => `${r.sku} ${r.market}`,
  market: (r) => r.market ?? '',
  qty: (r) => (typeof r.qty === 'number' ? r.qty : 0),
  need: (r) => (typeof r.need === 'number' ? r.need : 0),
  channel: (r) => CHANNELS.indexOf(r.channel),
};

/* --------------------------------------------------------------------------
   Подготовка строк плана
   -------------------------------------------------------------------------- */

/**
 * Плоский список строк плана: заказы и ускорения вперемешку.
 * Ускорение — не заказ (у него нет «заказать до»), но это тоже действие,
 * которое надо совершить к дате, поэтому оно живёт в той же таблице с
 * собственным каналом, а не прячется в отдельный список.
 */
function planRows(items) {
  const rows = [];
  for (const it of items) {
    for (const order of it.orders ?? []) {
      rows.push({
        key: it.key, sku: it.sku, market: it.market, title: it.title,
        channel: order.channel,
        orderBy: order.orderBy ?? null,
        arrival: order.arrival ?? null,
        qty: order.qty ?? null,
        need: typeof order.need === 'number' ? order.need : null,
        periodId: order.periodId ?? null,
        containerId: null,
        status: null,
      });
    }
    for (const fast of it.expedite ?? []) {
      rows.push({
        key: it.key, sku: it.sku, market: it.market, title: it.title,
        channel: 'expedite',
        orderBy: null,
        arrival: fast.arrival ?? fast.currentEta ?? null,
        qty: fast.qty ?? null,
        need: null,
        periodId: fast.targetPeriodId ?? null,
        containerId: fast.containerId ?? null,
        status: fast.status ?? null,
      });
    }
  }
  return rows;
}

/** Естественный порядок: по дате действия, потом по прибытию, потом по каналу. */
function naturalOrder(a, b) {
  const ka = a.orderBy ?? a.arrival ?? '';
  const kb = b.orderBy ?? b.arrival ?? '';
  if (ka !== kb) return ka < kb ? -1 : 1;
  const aa = a.arrival ?? '';
  const ab = b.arrival ?? '';
  if (aa !== ab) return aa < ab ? -1 : 1;
  return CHANNELS.indexOf(a.channel) - CHANNELS.indexOf(b.channel);
}

/**
 * Сортировка таблицы. Естественный порядок применяется всегда, выбранный
 * столбец — поверх него: `Array.prototype.sort` устойчива, поэтому строки с
 * равным значением сохраняют осмысленный порядок движка, а не случайный.
 *
 * Ключ сортировки общий на весь раздел (страница «Обзор» сортирует по
 * статусу, которого здесь нет) — незнакомый ключ означает «порядок движка».
 */
function sortRows(rows, sort) {
  const sorted = rows.slice().sort(naturalOrder);
  const pick = SORT_KEYS[sort.key];
  if (!pick) return sorted;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return sorted.sort((a, b) => {
    const va = pick(a);
    const vb = pick(b);
    if (va === vb) return 0;
    return (va < vb ? -1 : 1) * sign;
  });
}

/**
 * Столбцы ленты, которые занимает полоса.
 * Дата «заказать до» может быть раньше первого периода (15.08 против начала
 * периода 16.08) — тогда полоса прижимается к левому краю и помечается
 * `data-from="before"`, иначе она выглядела бы начинающейся внутри горизонта.
 */
function barSpan(row, periods) {
  if (!periods.length) return null;
  const startIso = row.orderBy ?? row.arrival;
  let from = clampPeriodIndex(startIso, periods);
  let to = clampPeriodIndex(row.arrival, periods);
  if (from < 0) from = 0;
  if (to < 0) to = periods.length - 1;
  if (to < from) to = from;
  const before = typeof row.orderBy === 'string' && row.orderBy < periods[0].start;
  return { from, to, before };
}

/* --------------------------------------------------------------------------
   Раздел
   -------------------------------------------------------------------------- */

export const oosOrders = {
  titleKey: 'page.oosOrders.title',
  leadKey: 'page.oosOrders.lead',

  async mount(view, controls) {
    view.replaceChildren();
    controls.replaceChildren();

    const { data, error } = await loadDemoData();
    if (error || !data) {
      // Честная заглушка с именем файла: «не загрузилось» без адреса — не диагноз.
      view.appendChild(dataErrorState());
      return () => {};
    }

    let result = computeAll(data, getParams());

    /* Дата расчёта непригодна — считать нечего. Раньше эту ветку знал только
       «Обзор», а здесь рисовался полный макет с нулями и утешительным
       «Заказов не требуется»: ложный ответ хуже отсутствия ответа. */
    const fatal = fatalState(result);
    if (fatal) {
      view.replaceChildren(fatal);
      return () => {};
    }
    setMarketAccents(result.markets);

    /* Подсказка живёт на уровне раздела, а не внутри перерисовываемого тела:
       её узел переживает пересборку, и слушатель Escape заводится один раз. */
    const tip = createTooltip(view);
    /* Данные полосы держит WeakMap, а не атрибуты: числа в подсказке должны
       быть отформатированы теми же `num`/`day`, а не разобраны обратно
       из строки. Записи исчезают вместе с узлами при следующей перерисовке. */
    let barData = new WeakMap();

    /* --- Шапка и тело ---------------------------------------------------- */

    let topNode = topBar(getParams(), result);
    view.appendChild(topNode);

    const params = paramsPanel();
    view.appendChild(params.node);

    /* Живая область — стабильный узел: положи её в перерисовываемый блок, и
       сообщение исчезло бы вместе с ним, не успев прозвучать. */
    const live = liveRegion();
    view.appendChild(live.node);

    /* Блоки страницы кладутся прямо в `#view`, без общей обёртки: у него
       `display:flex; gap:var(--sp-5)`, и лишний div схлопнул бы все отступы
       между панелями в один. Поэтому перерисовка снимает свои прошлые узлы
       поимённо, а не через `replaceChildren()` — шапка и панель параметров
       живут там же и пересборку переживать не должны. */
    let blockNodes = [];

    /* --- Зона controls --------------------------------------------------- */

    const market = marketFilter(() => render());
    const channel = channelFilter(() => render());
    const button = paramsButton(params.node);
    controls.append(market.node, channel.node, button.node);

    /* --- Отрисовка ------------------------------------------------------- */

    // Периоды ищутся общим помощником: та же функция зовётся из каждой
    // строки плана и каждой полосы ленты.
    const periodOfPlan = (id) => periodById(id, result.periods);

    /** Что закрывает строка плана: период и величина нехватки. */
    function coversText(row) {
      const period = formatPeriod(periodOfPlan(row.periodId));
      if (row.channel === 'expedite') return t('oos.expedite.covers', { period });
      return t('oos.orders.covers', { period, qty: num(row.need, 0) });
    }

    function tipRows(row) {
      return [
        { name: `${row.sku} · ${row.market}`, value: null },
        { name: t('oos.col.channel'), value: t(`oos.channel.${row.channel}`) },
        { name: t('oos.col.orderBy'), value: day(row.orderBy) },
        { name: t('oos.col.arrival'), value: day(row.arrival) },
        { name: t('oos.col.qty'), value: num(row.qty) },
        { name: t('oos.col.covers'), value: coversText(row) },
      ];
    }

    /* --- Плитки KPI ------------------------------------------------------ */

    /**
     * Плитки плана.
     *
     * Пустой план и «заказов не требуется» — разные ответы, и раньше страница
     * подставляла второй под любую пустоту: под фильтром «ускорение партии»
     * рядом с таблицей на 12 400 штук стояло «Конвейер уже покрывает спрос
     * горизонта», а на незасчитанном рынке — то же самое. `scope` и есть
     * причина пустоты: рынок заблокирован, фильтр сузил выборку или
     * заказывать действительно нечего.
     */
    function kpiSection(rows, items, scope) {
      /* «Всего единиц» считает только заказы. Ускорение штук не добавляет:
         те контейнеры уже произведены и уже сидят в конвейере прогноза —
         сложить их с заказами значило бы посчитать один товар дважды.
         Неокруглённая потребность по той же причине есть только у заказов. */
      const needRows = rows.filter((r) => typeof r.need === 'number');
      const qtySum = needRows.reduce((sum, r) => sum + (r.qty ?? 0), 0);
      /* Итог складывается из ТЕХ ЖЕ округлённых чисел, что стоят в столбце
         «потребность без округления». Сумма точных дробей давала 79 600
         против 79 599 в столбце, и разница в штуку читалась как ошибка
         ровно потому, что столбец рядом и его складывают. */
      const needSum = needRows.reduce((sum, r) => sum + Math.round(r.need), 0);

      const fastUnits = rows
        .filter((r) => r.channel === 'expedite')
        .reduce((sum, r) => sum + (r.qty ?? 0), 0);

      const byChannel = CHANNELS
        .map((code) => ({ code, n: rows.filter((r) => r.channel === code).length }))
        .filter((x) => x.n > 0)
        .map((x) => `${t(`oos.channel.${x.code}`)} ${num(x.n)}`);

      const deadline = nearestDeadline(rows, result.asOf);

      /* Почему в плитке ноль — четыре разных ответа. Порядок важен: рынок,
         который не считался, не «покрыт конвейером» ни при каком фильтре. */
      const emptyReason = () => {
        if (scope.blocked) return t('oos.orders.noneBlocked');
        if (rows.length) return t('oos.orders.expediteOnly');
        if (scope.narrowed && scope.hasAny) return t('oos.empty.filtered');
        return t('oos.orders.none');
      };

      let unitsNote;
      if (needRows.length) {
        const total = t('oos.round.total', { need: num(needSum), qty: num(qtySum) });
        // Столбец «количество» в таблице ниже даёт БОЛЬШЕ этой плитки на
        // объём ускорения — про это надо сказать здесь, а не в комментарии.
        unitsNote = fastUnits > 0
          ? `${total} · ${t('oos.orders.plusExpedite', { n: num(fastUnits) })}`
          : total;
      } else {
        unitsNote = emptyReason();
      }

      const deadlineNote = deadline.date
        ? deadline.note
        : (rows.length && !scope.blocked ? t('oos.orders.deadlineExpedite') : emptyReason());

      const unrec = items.filter((it) => (it.unrecoverable ?? []).length > 0).length;

      return kpiRow([
        statTile(
          t('oos.kpiOrders.rows'),
          num(rows.length),
          byChannel.length ? byChannel.join(' · ') : emptyReason(),
        ),
        statTile(t('oos.kpiOrders.units'), num(qtySum), unitsNote, true),
        statTile(t('oos.kpiOrders.deadline'), day(deadline.date), deadlineNote),
        statTile(t('oos.kpiOrders.unrec'), num(unrec), t('oos.unrec.body')),
      ]);
    }

    /* --- Календарь-лента ------------------------------------------------- */

    function ganttPanel(rows, items) {
      const box = panel(t('oos.gantt.title'), t('oos.gantt.subtitle'));
      box.appendChild(channelLegend());

      const periods = result.periods;
      if (!periods.length) {
        box.appendChild(emptyState('oos.empty.noPeriods'));
        return box;
      }
      if (!rows.length) {
        box.appendChild(emptyState('oos.gantt.empty'));
        return box;
      }

      /* Роль — `group`, а не `table`. Табличная роль обещает прямоугольную
         сетку: 12 заголовков столбцов и столько же ячеек в каждой строке.
         В дорожке ячеек столько, сколько понадобилось подрядов упаковки
         (от двух до восьми), и в табличном режиме скринридер сопоставлял бы
         полосу не с тем периодом. Текстовый двойник у ленты есть — таблица
         «Все заказы плана» ниже, — а каждая полоса несёт полный aria-label. */
      const grid = el('div', {
        class: 'oos-gantt',
        role: 'group',
        'aria-label': t('oos.gantt.aria'),
        // Число колонок задаётся страницей: горизонт переключается параметром,
        // и захардкоженное «11» сломало бы ленту на «6 месяцев».
        style: `--oos-cols: ${periods.length}`,
      });

      const head = el('div', { class: 'oos-gantt__head' }, [
        el('span', { class: 'oos-gantt__corner', text: t('oos.col.product') }),
      ]);
      periods.forEach((period, i) => {
        // Отметка даты расчёта стоит на первом столбце: горизонт начинается
        // «завтра» относительно asOf, и левый край обязан это показывать.
        const col = el('span', {
          class: i === 0 ? 'oos-gantt__col oos-gantt__today' : 'oos-gantt__col',
        }, [el('span', { text: formatPeriod(period) })]);
        if (i === 0) {
          col.appendChild(el('span', { class: 'visually-hidden', text: t('oos.gantt.today') }));
        }
        head.appendChild(col);
      });
      grid.appendChild(head);

      for (const it of items) {
        const own = rows.filter((r) => r.key === it.key);
        if (!own.length) continue;

        const label = el('span', { class: 'oos-gantt__label' }, [
          el('span', { text: it.sku }),
          marketTag(it.market),
        ]);
        const lane = el('div', { class: 'oos-gantt__lane' }, [label]);

        /* Жадная упаковка: полоса кладётся в первый подряд, где она ни с чем
           не пересекается. Лид-тайм у всех товаров один, полосы выходят
           широкими, и подрядов на демо-наборе набирается до восьми. */
        const tracks = [];
        const placed = own
          .map((row) => ({ row, span: barSpan(row, periods) }))
          .filter((x) => x.span)
          .sort((a, b) => a.span.from - b.span.from || a.span.to - b.span.to);

        for (const { row, span } of placed) {
          let track = tracks.find((tr) => tr.lastTo < span.from);
          const prevTo = track ? track.lastTo : -1;
          if (!track) {
            track = { lastTo: -1, node: el('div', { class: 'oos-gantt__track' }) };
            tracks.push(track);
            lane.appendChild(track.node);
          }
          const drawn = bar(row, span);
          track.node.appendChild(drawn.node);
          track.lastTo = span.to;

          /* Подпись, не поместившаяся на полосу, встаёт СОСЕДНЕЙ колонкой —
             так же, как прямая подпись конца линии на графиках. Колонка при
             этом занимается: следующая полоса подряда обязана начаться
             правее, иначе она наедет на подпись. Место выбирается здесь, а
             не в `bar()`, потому что состояние подряда известно только тут. */
          if (drawn.label && span.to + 1 < periods.length) {
            track.node.appendChild(el('span', {
              class: 'oos-gantt__qty oos-gantt__qty--out',
              'aria-hidden': 'true',
              style: `grid-column: ${span.to + 2} / ${span.to + 3}`,
              text: drawn.label,
            }));
            track.lastTo = span.to + 1;
          } else if (drawn.label && span.from > 0 && span.from - 1 > prevTo) {
            track.node.appendChild(el('span', {
              class: 'oos-gantt__qty oos-gantt__qty--out oos-gantt__qty--left',
              'aria-hidden': 'true',
              style: `grid-column: ${span.from} / ${span.from + 1}`,
              text: drawn.label,
            }));
          }
        }

        /* Число подрядов уходит в CSS инлайном: подписи дорожки нужно
           перекрыть их все, а `grid-row: 1 / -1` на НЕЯВНЫХ строках не
           работает — отрицательный индекс адресует только явную сетку, и
           подпись оставалась бы напротив одной первой полосы. */
        lane.style.setProperty('--oos-rows', String(Math.max(1, tracks.length)));

        grid.appendChild(lane);
      }

      const scroll = tableWrap(grid);
      /* Лента бывает под 1 700 px высотой, а строка дат в ней не липла:
         `.fba-scroll` уже прокручиваемый бокс, но без ограничения по высоте
         прокручивается страница, и `position: sticky` внутри него ничего не
         даёт. Ограничиваем высоту — тогда шапка периодов остаётся на месте. */
      scroll.classList.add('oos-gantt-scroll');
      box.appendChild(scroll);
      return box;
    }

    function bar(row, span) {
      const qtyText = num(row.qty);
      const aria = [
        t('oos.gantt.barAria', {
          product: `${row.sku} ${pickTitle(row.title)}`,
          market: row.market,
          channel: t(`oos.channel.${row.channel}`),
          orderBy: day(row.orderBy),
          arrival: day(row.arrival),
          qty: qtyText,
        }),
        span.before ? t('oos.gantt.beforeStart') : null,
      ].filter(Boolean).join(' ');

      const node = el('a', {
        class: 'oos-gantt__bar',
        href: productHref(),
        'data-channel': row.channel,
        'data-from': span.before ? 'before' : null,
        style: `grid-column: ${span.from + 1} / ${span.to + 2}`,
        'aria-label': aria,
      });

      /* Знак «!» у ускорения — второй носитель поверх штриховки: у него нет
         даты «заказать до», и это должно быть видно без цвета. Рисуется он
         ВСЕГДА и отдельным узлом: раньше он входил в строку количества и
         вместе с ней отбрасывался проверкой вместимости — а все полосы
         ускорения однопериодные, то есть знак не появлялся ни разу. */
      if (row.channel === 'expedite') {
        node.appendChild(el('span', { class: 'oos-gantt__flag', 'aria-hidden': 'true', text: '!' }));
      }

      /* Вместимость считается по МИНИМУМУ колонки (`minmax(56px, 1fr)`):
         настоящая ширина известна только после раскладки, а раздел
         намеренно не заводит наблюдателя за размером. Значит оценка обязана
         быть заниженной — обрезанная подпись хуже отсутствующей.

         Не поместившаяся подпись не пропадает, а встаёт СОСЕДНЕЙ колонкой:
         раньше она просто отбрасывалась, и на однопериодных полосах
         количество читалось только из подсказки и из таблицы на 69 строк. */
      const width = (span.to - span.from + 1) * COL_WIDTH
        - (row.channel === 'expedite' ? CHAR_WIDTH * 2 : 0);
      let label = null;
      if (width >= qtyText.length * CHAR_WIDTH + BAR_PADDING) {
        node.appendChild(el('span', { class: 'oos-gantt__qty', text: qtyText }));
      } else {
        label = qtyText;
      }

      barData.set(node, row);
      return { node, label };
    }

    /* --- Таблица заказов -------------------------------------------------- */

    function ordersPanel(rows, scope) {
      const box = panel(t('oos.orders.title'), t('oos.orders.subtitle'));
      box.appendChild(el('p', { class: 'oos-params__hint', text: t('oos.filter.sortHint') }));

      if (!rows.length) {
        // Пустая таблица молчит, а причина у пустоты разная: рынок не
        // считался, фильтр срезал строки или заказывать нечего. Это три
        // разных ответа, и путать их нельзя.
        if (scope.blocked) box.appendChild(emptyState('oos.orders.noneBlocked'));
        else if (scope.narrowed && scope.hasAny) box.appendChild(emptyState('oos.empty.filtered'));
        else box.appendChild(emptyState('oos.orders.none', 'oos.orders.noneWhy'));
        return box;
      }

      const sort = getSort();
      const table = el('table', { class: 'breakdown' });
      table.appendChild(el('caption', { class: 'visually-hidden', text: t('oos.orders.title') }));
      table.appendChild(sortableHead(
        COLUMNS.map((col) => ({ ...col, label: t(col.labelKey) })),
        sort,
        () => render(),
      ));

      const tbody = el('tbody');
      for (const row of rows) {
        const orderCell = el('td', {}, [
          document.createTextNode(day(row.orderBy)),
        ]);
        if (row.channel === 'expedite' && row.status) {
          // У ускорения нет «заказать до»: партия уже в работе, и вместо даты
          // честнее показать её текущий статус, чем пустой прочерк.
          orderCell.appendChild(el('span', {
            class: 'oos-heat__market',
            text: `· ${t(`oos.cnt.status.${row.status}`)}`,
          }));
        } else if (row.orderBy && row.orderBy === result.asOf) {
          orderCell.appendChild(el('span', {
            class: 'oos-heat__market',
            text: `· ${t('oos.orders.today')}`,
          }));
        }

        tbody.appendChild(el('tr', {}, [
          orderCell,
          el('td', { text: day(row.arrival) }),
          el('td', {}, [productLink(row.market, row.sku, `${row.sku} · ${pickTitle(row.title)}`)]),
          el('td', {}, [marketTag(row.market)]),
          el('td', { class: 'num oos-num', text: num(row.qty) }),
          el('td', { class: 'num oos-num', text: num(row.need, 0) }),
          el('td', { text: t(`oos.channel.${row.channel}`) }),
          el('td', { text: coversText(row) }),
        ]));
      }
      table.appendChild(tbody);

      box.appendChild(tableWrap(table));
      return box;
    }

    /* --- Непоправимое окно ------------------------------------------------ */

    function unrecPanel(items, current) {
      const box = panel(t('oos.unrec.title'), t('oos.unrec.body'));
      box.classList.add('oos-unrec-panel');
      // Число без ложной точности: «4 мес», а не «4,0 мес» — та же функция,
      // что и на двух других страницах, иначе одна фраза читается по-разному.
      box.appendChild(explain('oos.explain.unrecTitle', 'oos.explain.unrecBody', {
        n: plain(current.leadTimeMonths),
      }));

      const stuck = items.filter((it) => (it.unrecoverable ?? []).length > 0);
      if (!stuck.length) {
        box.appendChild(emptyState('oos.unrec.empty'));
        return box;
      }

      for (const it of stuck) {
        const card = el('div', { class: 'oos-unrec' });

        card.appendChild(el('div', {}, [
          productLink(it.market, it.sku, `${it.sku} · ${pickTitle(it.title)}`),
          marketTag(it.market),
          statusBadge(it.status),
        ]));

        /* Насколько раньше: сколько дней между первым нулём и самой ранней
           возможной поставкой. Обе даты — из движка; если хоть одной нет,
           строка не рисуется вовсе, а не показывает придуманный ноль. */
        const first = it.baseline?.firstProblemDate ?? null;
        const earliest = it.baseline?.earliestArrival ?? null;
        if (first && earliest) {
          const gap = daysBetween(first, earliest);
          if (Number.isFinite(gap)) {
            card.appendChild(el('div', { text: t('oos.unrec.gap', { n: num(gap) }) }));
          }
        }

        const shortfall = it.unrecoverable.reduce((sum, u) => sum + (u.shortfall ?? 0), 0);
        card.appendChild(el('div', {}, [
          el('span', { class: 'oos-thresholds__item' }, [
            el('span', { text: t('oos.col.gap') }),
            el('b', { class: 'oos-thresholds__value', text: units(shortfall) }),
          ]),
        ]));

        const list = el('ul', { class: 'oos-unrec__list' });
        for (const gapPeriod of it.unrecoverable) {
          list.appendChild(el('li', {
            text: t('oos.unrec.period', {
              period: formatPeriod(periodOfPlan(gapPeriod.periodId)),
              qty: num(gapPeriod.shortfall, 0),
            }),
          }));
        }
        card.appendChild(list);
        card.appendChild(el('p', { text: t('oos.unrec.what') }));

        if (!(it.expedite ?? []).length) {
          // «Ускорять нечего» — тоже ответ, и он обязан быть произнесён:
          // пустое место читалось бы как «данные не догрузились».
          card.appendChild(el('p', { text: t('oos.expedite.none') }));
        } else {
          const table = el('table', { class: 'breakdown' });
          /* Подряд идут несколько таблиц с одинаковой шапкой; без имени в
             списке таблиц скринридера они неразличимы. */
          table.appendChild(el('caption', {
            class: 'visually-hidden',
            text: `${t('oos.expedite.title')} · ${it.sku} · ${it.market}`,
          }));
          table.appendChild(el('thead', {}, [
            el('tr', {}, [
              el('th', { scope: 'col', text: t('oos.col.container') }),
              el('th', { scope: 'col', text: t('oos.col.cntStatus') }),
              el('th', { scope: 'col', class: 'num', text: t('oos.col.units') }),
              el('th', { scope: 'col', text: t('oos.col.eta') }),
              el('th', { scope: 'col', text: t('oos.col.covers') }),
            ]),
          ]));
          const tbody = el('tbody');
          for (const fast of it.expedite) {
            tbody.appendChild(el('tr', {}, [
              el('td', { text: fast.containerId ?? '—' }),
              el('td', { text: t(`oos.cnt.status.${fast.status ?? 'unknown'}`) }),
              el('td', { class: 'num oos-num', text: num(fast.qty) }),
              el('td', { text: t('oos.expedite.current', { date: day(fast.currentEta) }) }),
              el('td', { text: t('oos.expedite.covers', { period: formatPeriod(periodOfPlan(fast.targetPeriodId)) }) }),
            ]));
          }
          table.appendChild(tbody);
          card.appendChild(el('p', { text: t('oos.expedite.title') }));
          card.appendChild(tableWrap(table));
        }

        box.appendChild(card);
      }
      return box;
    }

    /* --- Итог по округлению ----------------------------------------------- */

    function roundingPanel(rows, current) {
      const box = panel(t('oos.round.title'), t('oos.round.subtitle'));
      const grid = el('div', { class: 'oos-round' });

      const wanted = getMarketFilter();
      for (const marketInfo of result.markets ?? []) {
        if (wanted !== 'both' && marketInfo.code !== wanted) continue;
        const own = rows.filter((r) => r.market === marketInfo.code && typeof r.need === 'number');
        grid.appendChild(el('div', {
          class: 'oos-round__row',
          text: t('oos.round.market', {
            market: marketInfo.code,
            step: num(current.roundingStep?.[marketInfo.code] ?? marketInfo.roundingStep ?? null),
            rows: num(own.length),
          }),
        }));
      }

      const needRows = rows.filter((r) => typeof r.need === 'number');
      // Итог складывается из тех же округлённых чисел, что показаны в столбце
      // «потребность без округления»: иначе он расходится со столбцом на
      // штуку-другую и выглядит ошибкой.
      grid.appendChild(el('div', {
        class: 'oos-round__row',
        text: t('oos.round.total', {
          need: num(needRows.reduce((sum, r) => sum + Math.round(r.need), 0)),
          qty: num(needRows.reduce((sum, r) => sum + (r.qty ?? 0), 0)),
        }),
      }));

      box.appendChild(grid);
      box.appendChild(explain('oos.explain.roundingTitle', 'oos.explain.roundingBody', {
        de: num(current.roundingStep?.DE ?? null),
        uk: num(current.roundingStep?.UK ?? null),
      }));
      return box;
    }

    /* --- Сборка страницы -------------------------------------------------- */

    function render() {
      const current = getParams();
      const wantedMarket = getMarketFilter();
      const wantedChannel = getChannelFilter();

      // Подсказка прячется до перерисовки: её цель вот-вот исчезнет из DOM.
      tip.hide();
      barData = new WeakMap();

      /* Адрес фокуса запоминается ДО того, как узлы уйдут из документа:
         перерисовка выбрасывает заголовок сортировки вместе с фокусом, и
         обход с клавиатуры начинался заново с начала страницы. */
      const address = focusAddress(view);

      const newTop = topBar(current, result);
      topNode.replaceWith(newTop);
      topNode = newTop;

      const items = (result.items ?? [])
        .filter((it) => wantedMarket === 'both' || it.market === wantedMarket);
      const all = planRows(items);
      const filtered = wantedChannel === 'all'
        ? all
        : all.filter((r) => r.channel === wantedChannel);
      const rows = sortRows(filtered, getSort());

      /* Рынок, не прошедший проверку языка, не рассчитан вовсе: его строк в
         плане нет, и молчать об этом нельзя — иначе пустота выглядит как
         «заказывать нечего». Причина пустоты передаётся плиткам и таблице
         одним объектом: три разных ответа на один и тот же пустой список. */
      const blockedMarkets = (result.markets ?? []).filter((m) => m.blocked
        && (wantedMarket === 'both' || m.code === wantedMarket));
      const scope = {
        blocked: blockedMarkets.length > 0 && items.length === 0,
        narrowed: wantedChannel !== 'all' || wantedMarket !== 'both',
        hasAny: all.length > 0,
      };

      const blocks = [];
      for (const marketInfo of blockedMarkets) {
        blocks.push(emptyState('oos.empty.blocked', null, { vars: { market: marketInfo.code } }));
      }

      blocks.push(kpiSection(rows, items, scope));
      blocks.push(ganttPanel(rows, items));
      blocks.push(ordersPanel(rows, scope));
      blocks.push(unrecPanel(items, current));
      blocks.push(roundingPanel(rows, current));

      for (const node of blockNodes) node.remove();
      blockNodes = blocks;
      view.append(...blocks);

      restoreFocus(view, address);
      // Перерисовка после смены параметра не издавала ни звука: скринридер
      // получал новую страницу молча. Итог называется числом, а не «готово».
      live.say(t('oos.live.orders', {
        rows: num(rows.length),
        qty: num(rows.filter((r) => typeof r.need === 'number').reduce((sum, r) => sum + (r.qty ?? 0), 0)),
      }));
    }

    /* --- Подсказка и переход на карточку ----------------------------------- */

    const barOf = (event) => {
      const target = event.target;
      if (!target || typeof target.closest !== 'function') return null;
      return target.closest('.oos-gantt__bar');
    };

    const onOver = (event) => {
      const node = barOf(event);
      const row = node ? barData.get(node) : null;
      if (row) tip.show(node, tipRows(row));
    };
    const onOut = (event) => {
      const node = barOf(event);
      // Уход внутрь той же полосы — не уход: подсказка не должна мигать.
      if (node && node.contains(event.relatedTarget)) return;
      if (node) tip.hide();
    };
    const onClick = (event) => {
      const node = barOf(event);
      const row = node ? barData.get(node) : null;
      // Хеш остаётся голым маршрутом: `routeFromHash()` требует точного
      // совпадения, и `#/oos-product?sku=…` увёл бы на маршрут по умолчанию.
      if (row) setSelection(row.market, row.sku);
    };

    view.addEventListener('pointerover', onOver);
    view.addEventListener('pointerout', onOut);
    view.addEventListener('focusin', onOver);
    view.addEventListener('focusout', onOut);
    view.addEventListener('click', onClick);

    /* --- Пересчёт по смене параметров -------------------------------------- */

    const off = onParamsChange((next) => {
      // Пересчитывается весь набор: промежуточного состояния, которое можно
      // рассинхронизировать, при этом не появляется.
      result = computeAll(data, next);
      params.sync();
      render();
    });

    render();

    return () => {
      off();
      tip.dispose();
      market.dispose();
      channel.dispose();
      button.dispose();
      params.dispose();
      view.removeEventListener('pointerover', onOver);
      view.removeEventListener('pointerout', onOut);
      view.removeEventListener('focusin', onOver);
      view.removeEventListener('focusout', onOut);
      view.removeEventListener('click', onClick);
    };
  },
};
