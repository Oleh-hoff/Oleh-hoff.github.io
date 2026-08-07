/* ==========================================================================
   Слой финансовых данных.

   Читает crm/data/finance.json — то, что записал scripts/collect_amazon.py.
   Одна строка файла = одна проводка: дата × площадка × валюта × статья × тип.

   Суммы НЕ пересчитываются между валютами. Аккаунт торгует в EUR, GBP, PLN,
   SEK, TRY, AED, SAR, и складывать их по выдуманному курсу — значит показать
   число, которое ни с чем не сходится. Валюта выбирается фильтром, итог
   всегда в одной валюте.
   ========================================================================== */

const DATA_URL = 'data/finance.json';

/** Статьи дохода: их сумма положительна. */
export const REVENUE_CATEGORIES = ['revenue', 'revenue_shipping'];

/** Налог с покупателя — транзитный, в выручку продавца не входит. */
export const PASSTHROUGH_CATEGORIES = ['revenue_tax'];

/** Статьи расхода: в данных приходят отрицательными. */
export const EXPENSE_CATEGORIES = [
  'fee_referral', 'fee_fba', 'fee_placement', 'fee_storage',
  'fee_inbound', 'fee_ads', 'fee_promo', 'fee_other', 'refund',
];

/** Возвраты Amazon в нашу пользу и корректировки. */
export const CREDIT_CATEGORIES = ['reimbursement', 'adjustment', 'other'];

export async function loadFinance() {
  const response = await fetch(DATA_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`finance.json недоступен (HTTP ${response.status})`);

  const data = await response.json();
  if (!Array.isArray(data.rows)) throw new Error('в finance.json нет массива rows');
  return data;
}

/* --------------------------------------------------------------------------
   Справочники из самих данных
   -------------------------------------------------------------------------- */

export function listCurrencies(rows) {
  const weight = new Map();
  for (const row of rows) {
    if (!REVENUE_CATEGORIES.includes(row.category)) continue;
    weight.set(row.currency, (weight.get(row.currency) || 0) + row.amount);
  }
  // Первой идёт валюта с наибольшей выручкой — она и станет значением по умолчанию
  return [...weight.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code);
}

export function listMarketplaces(rows, currency) {
  const weight = new Map();
  for (const row of rows) {
    if (currency && row.currency !== currency) continue;
    if (!REVENUE_CATEGORIES.includes(row.category)) continue;
    weight.set(row.marketplace, (weight.get(row.marketplace) || 0) + row.amount);
  }
  return [...weight.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code);
}

export function dateRange(rows) {
  let min = null;
  let max = null;
  for (const row of rows) {
    if (min === null || row.date < min) min = row.date;
    if (max === null || row.date > max) max = row.date;
  }
  return { min, max };
}

/* --------------------------------------------------------------------------
   Срез
   -------------------------------------------------------------------------- */

/**
 * Начало периода отсчитывается от последней даты в данных, а не от «сегодня»:
 * выгрузка может отставать, и «неделя» от сегодняшнего числа дала бы пустой
 * график вместо последней недели с данными.
 */
export function periodStart(rows, period) {
  const { min, max } = dateRange(rows);
  if (!max) return min;

  const end = new Date(max + 'T00:00:00Z');
  const shift = { week: 7, month: 30, quarter: 91 }[period];

  if (!shift) return `${end.getUTCFullYear()}-01-01`;   // ytd

  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - shift + 1);
  const iso = start.toISOString().slice(0, 10);
  return iso < min ? min : iso;
}

export function sliceRows(rows, { period, currency, marketplace }) {
  const from = periodStart(rows, period);
  return rows.filter((row) =>
    row.date >= from
    && row.currency === currency
    && (marketplace === 'all' || row.marketplace === marketplace));
}

/* --------------------------------------------------------------------------
   Агрегаты
   -------------------------------------------------------------------------- */

const sum = (rows) => rows.reduce((acc, row) => acc + row.amount, 0);

/** Итоги по каждой статье. Знак сохраняется как в данных. */
export function totalsByCategory(rows) {
  const totals = new Map();
  for (const row of rows) {
    totals.set(row.category, (totals.get(row.category) || 0) + row.amount);
  }
  return totals;
}

/** Детализация статьи по исходным типам Amazon — для раскрытия строки. */
export function breakdownByType(rows, category) {
  const totals = new Map();
  for (const row of rows) {
    if (row.category !== category) continue;
    totals.set(row.type, (totals.get(row.type) || 0) + row.amount);
  }
  return [...totals.entries()]
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([type, amount]) => ({ type, amount }));
}

export function computeSummary(rows) {
  const inCategory = (list) => rows.filter((row) => list.includes(row.category));

  const revenue = sum(inCategory(REVENUE_CATEGORIES));
  const tax = sum(inCategory(PASSTHROUGH_CATEGORIES));
  const expenses = sum(inCategory(EXPENSE_CATEGORIES));      // отрицательное
  const credits = sum(inCategory(CREDIT_CATEGORIES));
  const net = revenue + expenses + credits;

  return {
    revenue,
    tax,
    expenses,
    credits,
    net,
    // Доля расходов в выручке — главный показатель здоровья юнит-экономики
    feeShare: revenue ? (Math.abs(expenses) / revenue) * 100 : 0,
    netShare: revenue ? (net / revenue) * 100 : 0,
  };
}

/**
 * Ряды по дням: выручка и расходы.
 *
 * Ось строится по календарю, а не по списку дат, в которых есть проводки.
 * Иначе день без движения просто выпадает, соседние точки смыкаются, и
 * разрыв в данных выглядит как непрерывный ряд: пропуск в полгода занял бы
 * на графике один шаг, ничем не отличимый от шага в сутки.
 */
export function dailySeries(rows) {
  const present = [...new Set(rows.map((row) => row.date))].sort();
  if (!present.length) return { dates: [], revenue: [], expenses: [] };

  const dates = [];
  const cursor = new Date(present[0] + 'T00:00:00Z');
  const last = new Date(present.at(-1) + 'T00:00:00Z');
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const index = new Map(dates.map((date, i) => [date, i]));

  const revenue = new Array(dates.length).fill(0);
  const expenses = new Array(dates.length).fill(0);

  for (const row of rows) {
    const i = index.get(row.date);
    if (REVENUE_CATEGORIES.includes(row.category)) revenue[i] += row.amount;
    else if (EXPENSE_CATEGORIES.includes(row.category)) expenses[i] += Math.abs(row.amount);
  }

  return { dates, revenue, expenses };
}

/** Накопительный итог — по нему видно, куда пришли с начала периода. */
export function cumulative(values) {
  let running = 0;
  return values.map((value) => (running += value));
}

export function revenueByMarketplace(rows) {
  const totals = new Map();
  for (const row of rows) {
    if (!REVENUE_CATEGORIES.includes(row.category)) continue;
    totals.set(row.marketplace, (totals.get(row.marketplace) || 0) + row.amount);
  }
  return [...totals.entries()]
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([marketplace, amount]) => ({ marketplace, amount }));
}
