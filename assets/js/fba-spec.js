/* ==========================================================================
   Общая часть двух разделов о дефиците FBA.

   Список полей один на оба раздела намеренно. Раздел «выгрузка вручную»
   показывает, какую колонку файла можно закрыть через SP-API, раздел
   «данные SP-API» — чем именно она закрывается. Разойдись эти списки — и
   первая страница обещала бы то, чего вторая не делает.

   Ссылки и лимиты выписаны из моделей SP-API (docs/amazon-sp-api в приватном
   репозитории), а не по памяти: на лимитах считается длительность прогона,
   и ошибка здесь стоит часов ожидания.
   ========================================================================== */

/* --------------------------------------------------------------------------
   Источники
   -------------------------------------------------------------------------- */

/** Вызов, которым берутся данные, и его лимит из модели SP-API. */
export const SOURCES = {
  sellers: {
    name: 'Sellers API',
    ref: 'GET /sellers/v1/marketplaceParticipations',
    rate: '0.016 rps · burst 15',
  },
  fbaInventory: {
    name: 'FBA Inventory API',
    ref: 'GET /fba/inventory/v1/summaries?details=true',
    rate: '2 rps · burst 2',
  },
  catalog: {
    name: 'Catalog Items API',
    ref: 'GET /catalog/2022-04-01/items',
    rate: '2 rps · burst 2',
  },
  sales: {
    name: 'Sales API',
    ref: 'GET /sales/v1/orderMetrics',
    rate: '0.5 rps · burst 15',
  },
  planning: {
    name: 'Reports API',
    ref: 'GET_FBA_INVENTORY_PLANNING_DATA',
    rate: 'createReport 0.0167 rps · burst 15',
  },
  restock: {
    name: 'Reports API',
    ref: 'GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT',
    rate: 'createReport 0.0167 rps · burst 15',
  },
  stranded: {
    name: 'Reports API',
    ref: 'GET_STRANDED_INVENTORY_UI_DATA',
    rate: 'createReport 0.0167 rps · burst 15',
  },
  byCountry: {
    name: 'Reports API',
    ref: 'GET_AFN_INVENTORY_DATA_BY_COUNTRY',
    rate: 'createReport 0.0167 rps · burst 15',
  },
  inbound: {
    name: 'Fulfillment Inbound v0',
    ref: 'GET /fba/inbound/v0/shipments',
    rate: '2 rps · burst 30',
  },
};

/* --------------------------------------------------------------------------
   Колонки файла
   -------------------------------------------------------------------------- */

/*
   kind — откуда берётся значение:
     api      значение приходит из SP-API целиком;
     partial  часть слагаемых есть в API, часть нет;
     manual   в API этого нет вовсе;
     derived  считаем сами, но в API есть чем сверить.

   Разделение на «partial» и «derived» не косметическое. «Partial» значит,
   что автоматический сбор всё равно потребует ручного ввода. «Derived» —
   что ввод не нужен, но и слепо верить числу Amazon нельзя: их модель
   пополнения не знает нашего лид-тайма в четыре месяца.
*/
export const FIELDS = [
  {
    id: 'market', required: true, example: 'DE',
    kind: 'api', source: 'sellers', ref: 'marketplaceId',
  },
  {
    id: 'name', required: true, example: 'Kanten schwarz',
    kind: 'api', source: 'fbaInventory', ref: 'summaries[].productName',
  },
  {
    id: 'asin', required: true, example: 'B07PPXKJPQ',
    kind: 'api', source: 'fbaInventory', ref: 'summaries[].asin',
  },
  {
    id: 'start', required: true, example: '1348',
    kind: 'api', source: 'fbaInventory',
    ref: 'fulfillableQuantity + reservedQuantity.pendingTransshipmentQuantity'
       + ' + reservedQuantity.fcProcessingQuantity',
  },
  {
    id: 't30', required: true, example: '1530',
    kind: 'api', source: 'planning', ref: 'units-shipped-t30',
  },
  {
    id: 'prep', required: false, example: '300',
    kind: 'manual', source: null, ref: null,
  },
  {
    id: 'total', required: false, example: '14218',
    kind: 'partial', source: 'fbaInventory',
    ref: 'inboundWorkingQuantity + inboundShippedQuantity + inboundReceivingQuantity',
  },
  {
    id: 'oos', required: false, example: '01–15.09',
    kind: 'derived', source: 'planning',
    ref: 'days-of-supply · Total Days of Supply',
  },
  {
    id: 'order', required: false, example: '5800',
    kind: 'derived', source: 'restock',
    ref: 'Recommended replenishment qty · Recommended ship date',
  },
];

/* --------------------------------------------------------------------------
   Чего в файле нет, а SP-API отдаёт
   -------------------------------------------------------------------------- */

/** Показатели сверх девяти колонок: их стоит завести, раз данные уже есть. */
export const EXTRA = [
  { id: 'unfulfillable', source: 'fbaInventory', ref: 'inventoryDetails.unfulfillableQuantity' },
  { id: 'inbound', source: 'fbaInventory', ref: 'inboundWorking / inboundShipped / inboundReceiving' },
  { id: 'customerOrder', source: 'fbaInventory', ref: 'reservedQuantity.pendingCustomerOrderQuantity' },
  { id: 'trend', source: 'planning', ref: 'units-shipped-t7 / t30 / t60 / t90' },
  { id: 'coverage', source: 'planning', ref: 'sell-through · weeks-of-cover-t30 · weeks-of-cover-t90' },
  { id: 'minLevel', source: 'planning', ref: 'fba-minimum-inventory-level · fba-inventory-level-health-status' },
  { id: 'excess', source: 'planning', ref: 'estimated-excess-quantity · inv-age-0-to-90-days' },
  { id: 'alert', source: 'planning', ref: 'alert · recommended-action' },
  { id: 'restockQty', source: 'restock', ref: 'Recommended replenishment qty · Recommended ship date' },
  { id: 'stranded', source: 'stranded', ref: 'stranded-reason · fulfillable-qty' },
  { id: 'byCountry', source: 'byCountry', ref: 'country · quantity-for-local-fulfillment' },
  { id: 'inTransit', source: 'inbound', ref: 'ShipmentStatus · QuantityShipped' },
  { id: 'salesCheck', source: 'sales', ref: 'unitCount (interval, asin)' },
  { id: 'title', source: 'catalog', ref: 'summaries[].itemName' },
];

/** Рынки инструкции: идентификатор площадки нужен обоим разделам. */
export const MARKETS = [
  { id: 'DE', flag: '🇩🇪', host: 'amazon.de', marketplaceId: 'A1PA6795UKMFR9' },
  { id: 'UK', flag: '🇬🇧', host: 'amazon.co.uk', marketplaceId: 'A1F83G8C2ARO7P' },
];

/** Пример файла — тот же, что в исходной инструкции. */
export const CSV_SAMPLE = [
  'market,name,asin,start,prep,t30,total,oos,order',
  'DE,Kanten schwarz,B07PPXKJPQ,1348,300,1530,14218,none,5800',
  'DE,Kanten Wollweiß,B0F63Q4BLX,449,0,1567,12329,01–15.09,3800',
  'UK,Kanten schwarz,B07PPXKJPQ,179,0,595,599,16–31.07,7900',
  'UK,Kanten Wollweiß,B0F63Q4BLX,4,0,545,724,10–15.07,6200',
].join('\n');

/* --------------------------------------------------------------------------
   Разметка
   -------------------------------------------------------------------------- */

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') node.textContent = value;
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  children.forEach((child) => node.appendChild(child));
  return node;
}

/** Плитка сводки: подпись капителью, значение крупно, пояснение под ним. */
export function statTile(label, value, note = null, dark = false) {
  const card = el('article', { class: `card stat${dark ? ' stat--dark' : ''}` });
  card.appendChild(el('div', { class: 'stat__label', text: label }));
  card.appendChild(el('div', { class: 'stat__value', text: value }));
  if (note) card.appendChild(el('div', { class: 'stat__delta', text: note }));
  return card;
}

/** Панель с заголовком; содержимое дописывает вызывающий. */
export function panel(title, subtitle = null) {
  const node = el('section', { class: 'card panel' });
  const titles = el('div', { class: 'panel__titles' }, [
    el('h2', { class: 'panel__title', text: title }),
  ]);
  if (subtitle) titles.appendChild(el('p', { class: 'panel__subtitle', text: subtitle }));
  node.appendChild(el('div', { class: 'panel__header' }, [titles]));
  return node;
}

/* Обёртка своя, а не .table-wrap: у той высота ограничена 420 px ради
   графиков, а справочная таблица должна читаться целиком, без внутренней
   прокрутки посреди текста. */
export function tableWrap(table) {
  return el('div', { class: 'fba-scroll' }, [table]);
}

/** Значок источника. Смысл несёт подпись, цвет только помогает. */
export function sourceTag(kind, label) {
  return el('span', { class: `fba-tag fba-tag--${kind}`, text: label });
}

/** Моноширинный идентификатор: имя колонки, поля ответа, типа отчёта. */
export function mono(text) {
  return el('code', { class: 'fba-mono', text });
}

/** Нумерованные шаги. */
export function steps(items) {
  const list = el('ol', { class: 'fba-steps' });
  for (const { title, text } of items) {
    list.appendChild(el('li', { class: 'fba-step' }, [
      el('h3', { class: 'fba-step__title', text: title }),
      el('p', { class: 'fba-step__text', text }),
    ]));
  }
  return list;
}

/** Список с маркером-тире: пункты методологии и подвохов. */
export function bullets(items) {
  const list = el('ul', { class: 'fba-list' });
  for (const item of items) {
    const node = el('li');
    if (typeof item === 'string') {
      node.textContent = item;
    } else {
      node.appendChild(el('b', { text: item.title }));
      node.appendChild(document.createTextNode(` — ${item.text}`));
    }
    list.appendChild(node);
  }
  return list;
}

/** Сноска-примечание под панелью. */
export function note(text, tone = 'note') {
  return el('p', { class: `alert alert--${tone} fba-note`, text });
}
