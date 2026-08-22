/* ==========================================================================
   Независимая сверка чисел движка OOS (`assets/js/oos-engine.js`).

   Смысл файла — поймать ошибку в движке, а не повторить её. Поэтому здесь
   НЕ вызываются расчётные функции движка: календарная арифметика, периоды,
   START_FBA, корекция Prime Day, рост, классификация контейнеров, кривая
   спроса и покрытие написаны заново, от исходного `data/oos-demo.json`.
   Из движка берётся только `computeAll` — его результат и есть то, что
   сверяется. Если обе реализации ошибутся одинаково, проверка бесполезна,
   поэтому вторая реализация намеренно другая: без кэшей, без нормализации
   данных, прямо по тексту `contract-spec.md`.

   jsdom не нужен: движок чистый, ни DOM, ни сети, ни localStorage.

     node tools/oos-engine-check.mjs
   ========================================================================== */
import { readFileSync } from 'node:fs';
import { computeAll } from '../assets/js/oos-engine.js';
import {
  DEFAULT_PARAMS, PREP_CENTERS, isPrepSelected, togglePrepCenter, resetParams,
} from '../assets/js/oos-params.js';

const ROOT = new URL('..', import.meta.url).pathname;
const data = JSON.parse(readFileSync(ROOT + 'data/oos-demo.json', 'utf8'));

/* --------------------------------------------------------------------------
   Протокол вывода
   -------------------------------------------------------------------------- */
const problems = [];
const say = (s) => console.log(s);
const head = (s) => console.log(`\n${s}`);

/** Сравнение с допуском. `tol = 0` — точное совпадение строк/чисел. */
function check(name, got, want, tol = 0) {
  const ok = (typeof got === 'number' && typeof want === 'number')
    ? Number.isFinite(got) && Number.isFinite(want) && Math.abs(got - want) <= tol
    : got === want;
  if (ok) say(`  ok    ${name}`);
  else {
    const line = `${name}: движок ${fmtv(got)} / независимый расчёт ${fmtv(want)}`;
    say(`  ПЛОХО ${line}`);
    problems.push(line);
  }
  return ok;
}
function must(name, cond, detail) {
  if (cond) say(`  ok    ${name}`);
  else {
    const line = detail ? `${name}: ${detail}` : name;
    say(`  ПЛОХО ${line}`);
    problems.push(line);
  }
  return cond;
}
function fmtv(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(6);
  return String(v);
}
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x);

/* ==========================================================================
   Независимая календарная арифметика (§0.3)
   ========================================================================== */
const MS = 86400000;
const parseD = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fmtD = (ms) => new Date(ms).toISOString().slice(0, 10);
const addD = (iso, n) => fmtD(parseD(iso) + n * MS);
const lastDay = (y, mIndex) => new Date(Date.UTC(y, mIndex + 1, 0)).getUTCDate();
/** Календарные месяцы с прижатием к концу месяца (§0.3). */
const addM = (iso, n) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const yy = t.getUTCFullYear();
  const mm = t.getUTCMonth();
  return fmtD(Date.UTC(yy, mm, Math.min(d, lastDay(yy, mm))));
};
/** Дробная часть — по 30 дней: «1.5 месяца» иначе неопределимо. */
const addFM = (iso, x) => {
  const whole = Math.trunc(x);
  return addD(addM(iso, whole), Math.round((x - whole) * 30));
};
const mkey = (iso) => String(iso).slice(0, 7);
const dim = (mk) => {
  const [y, m] = mk.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const mdiff = (a, b) => {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
};
const cmp = (a, b) => parseD(a) - parseD(b);
const endM = (iso) => {
  const [y, m] = String(iso).split('-').map(Number);
  return fmtD(Date.UTC(y, m, 0));
};
const DAYS_PER_MONTH = 30.4375;

/* Периоды §0.2, построенные заново. */
function buildPeriods(asOf, horizonEnd) {
  const out = [];
  const total = mdiff(mkey(asOf), mkey(horizonEnd));
  for (let i = 0; i <= total; i += 1) {
    const mk = mkey(addM(`${mkey(asOf)}-01`, i));
    const last = dim(mk);
    const halves = [
      { half: 'H1', s: 1, e: 15 },
      { half: 'H2', s: 16, e: last },
    ];
    for (const h of halves) {
      const rawStart = `${mk}-${String(h.s).padStart(2, '0')}`;
      const rawEnd = `${mk}-${String(h.e).padStart(2, '0')}`;
      if (cmp(rawEnd, asOf) <= 0) continue;
      if (cmp(rawStart, horizonEnd) > 0) continue;
      const start = cmp(rawStart, asOf) <= 0 ? addD(asOf, 1) : rawStart;
      const end = cmp(rawEnd, horizonEnd) > 0 ? horizonEnd : rawEnd;
      out.push({
        id: `${mk}-${h.half}`,
        start,
        end,
        days: Math.round((parseD(end) - parseD(start)) / MS) + 1,
      });
    }
  }
  return out;
}

/* ==========================================================================
   Независимое чтение демо-данных
   ========================================================================== */
const ASOF = data.asOf;
const HORIZON_END = data.horizonEnd;
const PARAMS = DEFAULT_PARAMS;
const STEP = { DE: 100, UK: 50 };
const SELECTED = { DE: ['WM_EICHENZELL'], UK: ['WEPREP_STOWMARKET'] };
/* Сопоставление идентификаторов складов демо-данных с каноном спецификации.
   Таблица короткая и написана руками намеренно: брать её из движка значило
   бы сверять движок с самим собой. */
const CANON = {
  'prep-wm': 'WM_EICHENZELL',
  'prep-kastellaun': 'KASTELLAUN',
  'prep-weprep': 'WEPREP_STOWMARKET',
  'prep-asialog': 'ASIALOG',
};

/** Пары товар×рынок прямо из JSON, без нормализации движка. */
const pairs = [];
for (const product of data.products) {
  for (const [market, pair] of Object.entries(product.markets || {})) {
    pairs.push({ key: `${market}:${product.sku}`, sku: product.sku, market, pair });
  }
}

const norm = (s) => String(s || '').toUpperCase().replace(/[^0-9A-Z]+/g, ' ').trim().replace(/\s+/g, ' ');
const SHIPMENT_RE = /FBA[0-9A-Z]{6,}/;
/** Идентификатор отправки из произвольной строки колонки. */
const shipKey = (v) => {
  const m = SHIPMENT_RE.exec(norm(v));
  return m ? m[0] : norm(v);
};
const UK_MARKER = /(^|[^A-Z])UK([^A-Z]|$)/;

/* Алиасы препцентров: имя + список aliases из самого файла складов.
   Длинные первыми — «LAGER KASTELLAUN» обязан выиграть у «LAGER». */
const prepAliases = [];
for (const w of data.warehouses || []) {
  if (w.kind !== 'prep') continue;
  const id = CANON[w.id] || norm(w.id).replace(/ /g, '_');
  for (const alias of [w.name, ...(w.aliases || [])]) {
    const a = norm(alias);
    if (a) prepAliases.push({ id, alias: a });
  }
}
prepAliases.sort((a, b) => b.alias.length - a.alias.length);

/**
 * Рынок контейнера — по UK-маркеру в forwarder-поле (§4.1), но идентификатор
 * отправки из строки предварительно вырезан: «UK» внутри случайного
 * `FBA15UK7T2P4` рынка не означает.
 */
const containerMarket = (forwarder) => (
  UK_MARKER.test(norm(forwarder).replace(/FBA[0-9A-Z]{6,}/g, ' ')) ? 'UK' : 'DE');

/** Статус в термины §4.4. Всё, чего в наборе нет, — «неизвестно». */
function statusOf(raw) {
  const s = norm(raw);
  if (s === 'ARRIVED') return 'arrived';
  if (s === 'READY FOR SHIPMENT' || s === 'READY') return 'ready';
  if (s === 'IN PRODUCE' || s === 'IN PRODUCTION') return 'in-produce';
  if (s === 'IN TRANSIT' || s === 'SCHEDULED') return 'in-transit';
  return 'unknown';
}

/**
 * Независимая классификация одного контейнера (§4.1–§4.5).
 * Возвращает либо приход, либо причину исключения.
 */
function classifyOne(c, market, shipments) {
  if (c.invoiceDivided === true) return { excluded: 'invoice-divided-parent' };
  const f = norm(c.forwarderRef);
  const status = statusOf(c.status);
  const shMatch = SHIPMENT_RE.exec(f);
  let target = null;
  let prepId = null;
  let shipmentId = null;
  if (shMatch) {
    target = 'FBA';
    shipmentId = shMatch[0];
  } else {
    const hit = prepAliases.find((e) => new RegExp(`(^| )${e.alias}( |$)`).test(f));
    if (hit) {
      target = 'PREP';
      prepId = hit.id;
    }
  }
  if (!target) return { excluded: 'unknown-destination' };
  if (target === 'PREP' && !SELECTED[market].includes(prepId)) {
    return { excluded: 'excluded-prep', prepId };
  }

  const eta = typeof c.eta === 'string' && /^\d{4}-\d{2}-\d{2}/.test(c.eta) ? c.eta : null;
  const etaPast = eta !== null && cmp(eta, ASOF) <= 0;
  const here = status === 'arrived' || etaPast;

  let date;
  if (eta && !etaPast) date = eta;
  else if (status === 'ready') date = addFM(ASOF, 2.5);
  else if (status === 'in-produce') date = addFM(ASOF, 4);
  else if (here) date = addD(ASOF, 7);
  else if (status === 'in-transit') date = addFM(ASOF, 2.5);
  // Статус вне набора §4.4 датируется консервативно, как «в производстве»:
  // оптимистичное «как Ready» рисовало бы поставку на полтора месяца раньше.
  else date = addFM(ASOF, 4);

  let qty;
  if (target === 'FBA') {
    // Ключ отправки — сам идентификатор с обеих сторон: колонка отчёта может
    // содержать вокруг него что угодно.
    const sh = shipments.find((s) => shipKey(s.shipmentId) === shipmentId);
    // `located` уже сидит в available: в дороге числится только разница.
    if (sh) qty = Math.max(0, (sh.expected || 0) - (sh.located || 0));
    else qty = here ? 0 : (c.units || 0);   // прибывший уже внутри START_FBA
  } else {
    qty = here ? 0 : (c.units || 0);        // прибывший уже внутри «коробки × штук»
  }
  return { arrival: { containerId: c.ref, target, prepId, shipmentId, date, qty, status } };
}

/** Всё, что нужно по паре товар×рынок, посчитанное независимо. */
function derive({ sku, market, pair }) {
  const fba = pair.fba || {};
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const startFba = n(fba.available) + n(fba.fcTransfer) + n(fba.reservedFcProcessing);
  const t30 = pair.t30 && Number.isFinite(pair.t30.units) ? pair.t30.units : null;
  const pdUnits = n(pair.primeDay && pair.primeDay.units);

  // §6: excess зажат снизу нулём.
  const normalDaily = t30 === null ? null : t30 / 30;
  const excess = t30 === null ? null : Math.max(0, pdUnits - 4 * normalDaily);
  const t30Adj = t30 === null ? null : t30 - excess;

  // §7: среднее арифметическое отношений месяц-к-месяцу, зажатое ПОСЛЕ усреднения.
  const hist = (pair.salesHistory || []).filter((h) => h && Number.isFinite(h.units));
  const ratios = [];
  for (let i = 1; i < hist.length; i += 1) {
    if (hist[i - 1].units > 0) ratios.push(hist[i].units / hist[i - 1].units);
  }
  const growthRaw = ratios.length ? ratios.reduce((s, x) => s + x, 0) / ratios.length : null;
  const growth = growthRaw === null ? 1 : Math.min(Math.max(growthRaw, 0.97), 1.15);

  // §3.2: только выбранные локации.
  let prepUnits = 0;
  let prepExcluded = 0;
  for (const row of pair.prep || []) {
    const id = CANON[row.warehouse] || norm(row.warehouse).replace(/ /g, '_');
    const units = n(row.unitsPerCarton) * n(row.cartons);
    if (SELECTED[market].includes(id)) prepUnits += units;
    else prepExcluded += units;
  }

  // §4: контейнеры этой пары — те, у которых совпал sku и выведенный рынок.
  const shipments = pair.shipments || [];
  const mine = (data.containers || []).filter((c) => c.sku === sku && containerMarket(c.forwarderRef) === market);
  const arrivals = [];
  const excluded = [];
  const usedShipments = new Set();
  for (const c of mine) {
    const res = classifyOne(c, market, shipments);
    if (res.excluded) { excluded.push({ id: c.ref, reason: res.excluded }); continue; }
    if (res.arrival.shipmentId) usedShipments.add(res.arrival.shipmentId);
    arrivals.push(res.arrival);
  }
  // Строки shipment-отчёта без контейнера — тоже товар в дороге (§4.5).
  for (const sh of shipments) {
    const id = shipKey(sh.shipmentId);
    if (usedShipments.has(id)) continue;
    const qty = Math.max(0, (sh.expected || 0) - (sh.located || 0));
    if (qty <= 0) continue;
    const planned = typeof sh.expectedArrival === 'string' ? sh.expectedArrival : null;
    arrivals.push({
      containerId: null, target: 'FBA', prepId: null, shipmentId: id,
      date: planned && cmp(planned, ASOF) > 0 ? planned : addD(ASOF, 7),
      qty, status: 'in-transit',
    });
  }
  const inTransit = arrivals.reduce((s, a) => s + a.qty, 0);

  return {
    key: `${market}:${sku}`, sku, market, startFba, t30, pdUnits, normalDaily, excess, t30Adj,
    ratios, growthRaw, growth, prepUnits, prepExcluded, awd: n(pair.awd && pair.awd.units),
    arrivals, excluded, inTransit, active: pair.active !== false,
  };
}

const derived = new Map();
for (const p of pairs) derived.set(p.key, derive(p));

/* ==========================================================================
   Результат движка
   ========================================================================== */
const result = computeAll(data, PARAMS);
const engineItem = (key) => result.items.find((x) => x.key === key) || null;
const engineInactive = (key) => result.inactive.find((x) => x.key === key) || null;

say('Независимая сверка движка OOS');
say(`данные: data/oos-demo.json, asOf ${ASOF}, горизонт ${HORIZON_END}`);
say(`движок: ${result.items.length} активных пар, ${result.inactive.length} неактивных, ` +
    `${result.periods.length} периодов`);

/* --------------------------------------------------------------------------
   0. Периоды — фундамент всех остальных чисел
   -------------------------------------------------------------------------- */
head('0. Полумесячные периоды (§0.2)');
const myPeriods = buildPeriods(ASOF, HORIZON_END);
check('число периодов', result.periods.length, myPeriods.length);
let periodBad = 0;
result.periods.forEach((p, i) => {
  const m = myPeriods[i];
  if (!m || p.id !== m.id || p.start !== m.start || p.end !== m.end || p.days !== m.days) periodBad += 1;
});
must('границы и длины всех периодов', periodBad === 0, `расходятся периодов: ${periodBad}`);
say(`        первый ${myPeriods[0].id} ${myPeriods[0].start}…${myPeriods[0].end} (${myPeriods[0].days} дн.), ` +
    `последний ${myPeriods.at(-1).id} ${myPeriods.at(-1).start}…${myPeriods.at(-1).end} (${myPeriods.at(-1).days} дн.)`);

/* --------------------------------------------------------------------------
   1. START_FBA = сумма трёх колонок (§2)
   -------------------------------------------------------------------------- */
head('1. START_FBA по каждому товару (§2): available + fcTransfer + reservedFcProcessing');
for (const d of derived.values()) {
  const it = engineItem(d.key) || engineInactive(d.key);
  if (!it) { must(`${d.key} есть в результате`, false, 'пара пропала и из активных, и из неактивных'); continue; }
  const got = it.baseline ? it.baseline.startFba : it.startFba;
  check(`${d.key} START_FBA`, got, d.startFba);
}
// Отдельно: reservedCustomerOrder и unfulfillable не имеют права попасть в сумму.
{
  const p = pairs.find((x) => x.key === 'DE:SQ1').pair.fba;
  const withExtra = p.available + p.fcTransfer + p.reservedFcProcessing + p.reservedCustomerOrder + p.unfulfillable;
  const it = engineItem('DE:SQ1');
  must('DE:SQ1 в START_FBA не попали reservedCustomerOrder и unfulfillable',
       it.baseline.startFba !== withExtra,
       `движок дал ${it.baseline.startFba}, что совпало с суммой ВСЕХ пяти колонок ${withExtra}`);
  say(`        2854 + 158 + 33 = ${it.baseline.startFba} (пример спецификации §18)`);
}

/* --------------------------------------------------------------------------
   2. Корекция Prime Day (§6)
   -------------------------------------------------------------------------- */
head('2. Корекция Prime Day (§6): excess = max(0, PD − 4 × t30/30), t30′ = t30 − excess');
for (const d of derived.values()) {
  const it = engineItem(d.key);
  if (!it) continue;                       // неактивные не рассчитываются
  check(`${d.key} excess`, r3(it.baseline.primeDay.excess), r3(d.excess), 1e-6);
  check(`${d.key} t30′`, r3(it.baseline.t30Adjusted), r3(d.t30Adj), 1e-6);
}
// Ветка «Prime Day НЕ превышает норму» — excess обязан быть нулём, а не минусом.
for (const key of ['DE:SQ8', 'UK:SQ8']) {
  const d = derived.get(key);
  const it = engineItem(key);
  must(`${key}: PD ${d.pdUnits} ниже нормы ${r3(4 * d.normalDaily)} → excess = 0`,
       Math.abs(it.baseline.primeDay.excess) < 1e-9,
       `движок дал excess ${it.baseline.primeDay.excess}`);
  must(`${key}: коррекции нет, t30′ = t30 = ${d.t30}`,
       Math.abs(it.baseline.t30Adjusted - d.t30) < 1e-9,
       `движок дал t30′ ${it.baseline.t30Adjusted}`);
}
for (const key of ['DE:SQ1', 'DE:SQ2', 'DE:SQ9', 'UK:SQ10']) {
  const d = derived.get(key);
  say(`        ${key}: t30 ${d.t30}, PD ${d.pdUnits}, норма 4×${r3(d.normalDaily)} = ${r3(4 * d.normalDaily)}, ` +
      `excess ${r3(d.excess)}, t30′ ${r3(d.t30Adj)}`);
}

/* --------------------------------------------------------------------------
   3. Рост (§7)
   -------------------------------------------------------------------------- */
head('3. Индивидуальный рост (§7): среднее арифметическое отношений м/м, зажим [0.97, 1.15]');
for (const d of derived.values()) {
  const it = engineItem(d.key);
  if (!it) continue;
  const g = it.baseline.growth.value;
  must(`${d.key} рост ${r3(g)} внутри [0.97, 1.15]`, g >= 0.97 - 1e-12 && g <= 1.15 + 1e-12,
       `движок дал ${g}`);
  check(`${d.key} рост`, r3(g), r3(d.growth), 1e-9);
  if (d.growthRaw !== null) check(`${d.key} сырое среднее до зажима`, r3(it.baseline.growth.raw), r3(d.growthRaw), 1e-9);
}
// Ручной пересчёт на одном товаре, числами в столбик.
{
  const key = 'DE:SQ9';
  const hist = pairs.find((x) => x.key === key).pair.salesHistory;
  const manual = [];
  for (let i = 1; i < hist.length; i += 1) manual.push(hist[i].units / hist[i - 1].units);
  const mean = manual.reduce((s, x) => s + x, 0) / manual.length;
  const clamped = Math.min(Math.max(mean, 0.97), 1.15);
  const it = engineItem(key);
  say(`        ${key} история: ${hist.map((h) => h.units).join(' → ')}`);
  say(`        отношения: ${manual.map((x) => x.toFixed(4)).join(', ')}`);
  say(`        среднее ${mean.toFixed(4)} → зажато до ${clamped.toFixed(4)}`);
  check(`${key} ручной пересчёт среднего м/м`, r3(it.baseline.growth.raw), r3(mean), 1e-9);
  check(`${key} ручной пересчёт после зажима`, r3(it.baseline.growth.value), r3(clamped), 1e-9);
  must(`${key} зажим отмечен флагом growth-clamped`,
       it.baseline.growth.clamped === true, 'движок не отметил зажатие');
}
{
  const key = 'DE:SQ8';
  const it = engineItem(key);
  const d = derived.get(key);
  say(`        ${key} падающая история: сырое ${r3(d.growthRaw)} → зажато снизу до ${r3(d.growth)}`);
  check(`${key} нижний зажим`, r3(it.baseline.growth.value), 0.97, 1e-9);
}

/* --------------------------------------------------------------------------
   4. Классификация контейнеров (§4)
   -------------------------------------------------------------------------- */
head('4. Классификация контейнеров (§4): рынок, назначение, дата, количество');
const engineArrival = (key, ref) => {
  const it = engineItem(key);
  if (!it) return null;
  return it.baseline.arrivals.find((a) => a.containerId === ref) || null;
};
const engineExcluded = (key, ref) => {
  const it = engineItem(key);
  if (!it) return null;
  return it.baseline.excludedContainers.find((e) => e.id === ref) || null;
};
let contBad = 0;
for (const c of data.containers || []) {
  const market = containerMarket(c.forwarderRef);
  const key = `${market}:${c.sku}`;
  const d = derived.get(key);
  const active = d && d.active && engineItem(key);
  const mine = d ? classifyOne(c, market, (pairs.find((x) => x.key === key) || { pair: {} }).pair.shipments || []) : null;

  if (!active) {
    // Пара не рассчитывается — контейнер обязан всплыть в «без адресата».
    const orphan = (result.orphanContainers || []).find((o) => o.id === c.ref);
    if (!orphan) { contBad += 1; problems.push(`контейнер ${c.ref}: пара ${key} не рассчитывается, но контейнера нет в orphanContainers`); }
    else if (orphan.market !== market) { contBad += 1; problems.push(`контейнер ${c.ref}: рынок ${orphan.market} вместо ${market}`); }
    continue;
  }
  if (mine.excluded) {
    const ex = engineExcluded(key, c.ref);
    if (!ex) { contBad += 1; problems.push(`контейнер ${c.ref} (${key}): ожидалось исключение «${mine.excluded}», движок его не исключил`); continue; }
    if (ex.reason !== mine.excluded) { contBad += 1; problems.push(`контейнер ${c.ref} (${key}): причина исключения «${ex.reason}» вместо «${mine.excluded}»`); }
    if (engineArrival(key, c.ref)) { contBad += 1; problems.push(`контейнер ${c.ref} (${key}): исключён и одновременно попал в приходы`); }
    continue;
  }
  const a = engineArrival(key, c.ref);
  if (!a) { contBad += 1; problems.push(`контейнер ${c.ref} (${key}): ожидался приход ${mine.arrival.qty} шт. на ${mine.arrival.date}, движок его потерял`); continue; }
  if (a.target !== mine.arrival.target) { contBad += 1; problems.push(`контейнер ${c.ref} (${key}): назначение ${a.target} вместо ${mine.arrival.target}`); }
  if (a.date !== mine.arrival.date) { contBad += 1; problems.push(`контейнер ${c.ref} (${key}): дата прибытия ${a.date} вместо ${mine.arrival.date}`); }
  if (Math.abs(a.qty - mine.arrival.qty) > 1e-9) { contBad += 1; problems.push(`контейнер ${c.ref} (${key}): количество ${a.qty} вместо ${mine.arrival.qty}`); }
  if (mine.arrival.target === 'PREP' && a.prepId !== mine.arrival.prepId) { contBad += 1; problems.push(`контейнер ${c.ref} (${key}): склад ${a.prepId} вместо ${mine.arrival.prepId}`); }
}
must(`все ${(data.containers || []).length} контейнеров классифицированы одинаково`, contBad === 0,
     `расхождений: ${contBad}`);

// 4а. «Invoice divided»: родитель не считается, дочерние считаются по одному разу.
{
  const parent = (data.containers || []).find((c) => c.invoiceDivided === true);
  const kids = (data.containers || []).filter((c) => c.parentRef === parent.ref);
  const key = `${containerMarket(parent.forwarderRef)}:${parent.sku}`;
  const it = engineItem(key);
  const inArrivals = it.baseline.arrivals.some((a) => a.containerId === parent.ref);
  must(`родитель ${parent.ref} (${parent.units} шт.) не попал в приходы`, !inArrivals,
       'родительская строка учтена — весь объём посчитан дважды');
  const kidsQty = kids.reduce((s, c) => s + c.units, 0);
  const gotKids = it.baseline.arrivals
    .filter((a) => kids.some((k) => k.ref === a.containerId))
    .reduce((s, a) => s + a.qty, 0);
  check(`дочерние ${kids.map((k) => k.ref).join(' + ')} суммарно`, gotKids, kidsQty);
  say(`        родитель ${parent.units} = дочерние ${kidsQty}; учтено ${gotKids}, а не ${parent.units + kidsQty}`);
}

// 4б. Уже прибывшие не добавляются поверх START_FBA.
{
  const arrived = (data.containers || []).filter((c) => statusOf(c.status) === 'arrived');
  let bad = 0;
  for (const c of arrived) {
    const market = containerMarket(c.forwarderRef);
    const key = `${market}:${c.sku}`;
    const it = engineItem(key);
    if (!it) continue;
    const a = it.baseline.arrivals.find((x) => x.containerId === c.ref);
    const shipments = (pairs.find((x) => x.key === key) || { pair: {} }).pair.shipments || [];
    const sh = shipments.find((s) => norm(s.shipmentId) === SHIPMENT_RE.exec(norm(c.forwarderRef))?.[0]);
    const want = sh ? Math.max(0, sh.expected - sh.located) : 0;   // чекнутая часть уже в available
    if (!a) { if (want > 0) { bad += 1; problems.push(`прибывший ${c.ref} (${key}): ожидался нечекнутый хвост ${want}, прихода нет`); } continue; }
    if (Math.abs(a.qty - want) > 1e-9) {
      bad += 1;
      problems.push(`прибывший ${c.ref} (${key}): движок добавил ${a.qty} шт. поверх START_FBA, ожидалось ${want}`);
    }
  }
  must(`уже прибывшие (${arrived.map((c) => c.ref).join(', ')}) не прибавлены к FBA`, bad === 0,
       `расхождений: ${bad}`);
}

/* 4б-бис. В демо-данных нет ни одного УЖЕ ПРИБЫВШЕГО контейнера на препцентр
   (все три «arrived» идут на FBA), а §4.3 требует не добавлять и такие: их
   объём уже сидит в «штук в коробке × коробок» листа Prepcenter. Ветка
   закрывается синтетическим набором, иначе ошибка в ней осталась бы невидимой. */
{
  const synth = {
    schemaVersion: 1, kind: 'oos-demo', asOf: ASOF, horizonEnd: HORIZON_END, demo: true,
    markets: [{ code: 'DE', domain: 'amazon.de', currency: 'EUR', locale: 'de-DE',
      orderRounding: 100, reportLanguage: 'de', accent: 'series-1' }],
    warehouses: [{ id: 'prep-wm', kind: 'prep', market: 'DE', name: 'WM / Eichenzell',
      aliases: ['WM FOB', 'Lager Eichenzell'], includedByDefault: true, prepToFbaLagDays: 7 }],
    products: [{ sku: 'PREPARR', asin: 'B0PREPARR1', category: 'test',
      title: { ru: 'тест', en: 'test', uk: 'тест' },
      markets: { DE: {
        sellerSku: 'PREPARR-DE', reportTitle: 'Eckenschutz Kindersicherung Schrank', active: true,
        fba: { available: 20000, fcTransfer: 0, reservedFcProcessing: 0, reservedCustomerOrder: 0, unfulfillable: 0 },
        awd: { units: 0 },
        prep: [{ warehouse: 'prep-wm', unitsPerCarton: 40, cartons: 10 }],
        salesHistory: [],
        t30: { units: 1000, windowFrom: '2026-07-16', windowTo: '2026-08-14' },
        primeDay: { days: 4, units: 0, from: '2026-07-14', to: '2026-07-17' },
        shipments: [],
      } } }],
    containers: [
      { ref: 'C-SYN-ARR', sku: 'PREPARR', forwarderRef: 'WM FOB 26-999', units: 700,
        status: 'arrived', eta: '2026-08-01', invoiceDivided: false, parentRef: null },
      { ref: 'C-SYN-WAY', sku: 'PREPARR', forwarderRef: 'Lager Eichenzell 26-998', units: 500,
        status: 'scheduled', eta: '2026-10-01', invoiceDivided: false, parentRef: null },
    ],
  };
  const x = computeAll(synth, PARAMS).items[0];
  const arr = x.baseline.arrivals.find((a) => a.containerId === 'C-SYN-ARR');
  const way = x.baseline.arrivals.find((a) => a.containerId === 'C-SYN-WAY');
  must('синтетика: прибывший контейнер на преп не прибавлен (0 шт., а не 700)',
       !arr || Math.abs(arr.qty) < 1e-9, `движок добавил ${arr ? arr.qty : '?'} шт.`);
  must('синтетика: контейнер в пути на преп учтён полностью (500 шт.)',
       Boolean(way) && Math.abs(way.qty - 500) < 1e-9 && way.target === 'PREP',
       way ? `${way.qty} шт., назначение ${way.target}` : 'приход потерян');
  const prepInflow = x.baseline.rows.reduce((s, r) => s + r.prepRefill, 0);
  check('синтетика: суммарное поступление на преп за горизонт', prepInflow, 500, 1e-9);
}

// 4в. Рынки не перемешались.
{
  let bad = 0;
  const byRef = new Map((data.containers || []).map((c) => [c.ref, c]));
  for (const it of result.items) {
    for (const a of it.baseline.arrivals) {
      if (!a.containerId) continue;
      const c = byRef.get(a.containerId);
      if (!c) { bad += 1; problems.push(`${it.key}: приход по контейнеру ${a.containerId}, которого нет в данных`); continue; }
      const m = containerMarket(c.forwarderRef);
      if (m !== it.market) { bad += 1; problems.push(`контейнер ${c.ref} рынка ${m} попал в расчёт ${it.key}`); }
      if (c.sku !== it.sku) { bad += 1; problems.push(`контейнер ${c.ref} товара ${c.sku} попал в расчёт ${it.key}`); }
    }
  }
  const ukRefs = (data.containers || []).filter((c) => containerMarket(c.forwarderRef) === 'UK').map((c) => c.ref);
  must(`UK-контейнеры (${ukRefs.join(', ')}) не попали в DE и наоборот`, bad === 0, `нарушений: ${bad}`);
}

// 4г. Исключённые склады: их сток не переносится на выбранный преп.
{
  let bad = 0;
  for (const d of derived.values()) {
    const it = engineItem(d.key);
    if (!it) continue;
    if (Math.abs(it.baseline.prepUnits - d.prepUnits) > 1e-9) {
      bad += 1;
      problems.push(`${d.key}: запас препа ${it.baseline.prepUnits} вместо ${d.prepUnits} (только выбранные локации)`);
    }
  }
  must('запас препцентра считается только по выбранным локациям (Kastellaun и AsiaLog исключены)', bad === 0,
       `расхождений: ${bad}`);
  const sq1 = derived.get('DE:SQ1');
  say(`        DE:SQ1: WM ${sq1.prepUnits} учтён, Kastellaun ${sq1.prepExcluded} исключён`);
}

/* --------------------------------------------------------------------------
   5. Баланс симуляции (§9)
   -------------------------------------------------------------------------- */
head('5. Баланс симуляции (§9): тождества по каждому периоду каждого товара');
{
  const TOL = 1e-6;
  let rowsChecked = 0;
  const bad = { fba: 0, prep: 0, awd: 0, sales: 0, neg: 0, cont: 0, nan: 0 };
  const firstBad = {};
  const note = (kind, msg) => { bad[kind] += 1; if (!firstBad[kind]) firstBad[kind] = msg; };

  for (const it of result.items) {
    for (const which of ['baseline', 'simulation']) {
      const rows = it[which].rows;
      rows.forEach((r, i) => {
        rowsChecked += 1;
        for (const [k, v] of Object.entries(r)) {
          if (typeof v === 'number' && !Number.isFinite(v)) note('nan', `${it.key}/${which}/${r.periodId}: поле ${k} = ${v}`);
        }
        const fbaWant = r.fbaStart + r.inflowPipeline + r.inflowAwd + r.inflowDirect + r.safety - r.salesActual;
        if (Math.abs(r.fbaEnd - fbaWant) > TOL) {
          note('fba', `${it.key}/${which}/${r.periodId}: FBA_конец ${r3(r.fbaEnd)}, а начало+поступления+прямая+подстраховка−продажи = ${r3(fbaWant)}`);
        }
        const prepWant = r.prepStart + r.prepRefill - r.safety;
        if (Math.abs(r.prepEnd - prepWant) > TOL) {
          note('prep', `${it.key}/${which}/${r.periodId}: ПРЕП_конец ${r3(r.prepEnd)}, а начало+пополнение−подстраховка = ${r3(prepWant)}`);
        }
        if (Math.abs(r.awdEnd - (r.awdStart - r.inflowAwd)) > TOL) {
          note('awd', `${it.key}/${which}/${r.periodId}: AWD_конец ${r3(r.awdEnd)} ≠ ${r3(r.awdStart - r.inflowAwd)}`);
        }
        if (Math.abs(r.salesActual + r.shortfall - r.salesPlan) > TOL) {
          note('sales', `${it.key}/${which}/${r.periodId}: отгружено ${r3(r.salesActual)} + нехватка ${r3(r.shortfall)} ≠ спрос ${r3(r.salesPlan)}`);
        }
        if (r.fbaEnd < -TOL || r.prepEnd < -TOL || r.awdEnd < -TOL) {
          note('neg', `${it.key}/${which}/${r.periodId}: отрицательный остаток fba ${r3(r.fbaEnd)}, преп ${r3(r.prepEnd)}, awd ${r3(r.awdEnd)}`);
        }
        if (i > 0) {
          const prev = rows[i - 1];
          if (Math.abs(r.fbaStart - prev.fbaEnd) > TOL || Math.abs(r.prepStart - prev.prepEnd) > TOL
              || Math.abs(r.awdStart - prev.awdEnd) > TOL) {
            note('cont', `${it.key}/${which}/${r.periodId}: начало периода не равно концу предыдущего`);
          }
        }
      });
    }
  }
  must(`баланс FBA на всех ${rowsChecked} строках`, bad.fba === 0, firstBad.fba);
  must('баланс препцентра', bad.prep === 0, firstBad.prep);
  must('баланс AWD', bad.awd === 0, firstBad.awd);
  must('отгружено + нехватка = спрос', bad.sales === 0, firstBad.sales);
  must('ни один остаток не ушёл в минус', bad.neg === 0, firstBad.neg);
  must('начало периода = конец предыдущего', bad.cont === 0, firstBad.cont);
  must('ни NaN, ни Infinity в числовых полях', bad.nan === 0, firstBad.nan);
  say(`        проверено строк: ${rowsChecked} (по два прогона на товар: без заказов и с заказами)`);

  /* §9.4. Отдельная проверка семидневного лага: если препцентра хватило
     закрыть весь достижимый дефицит, то оставшаяся недоотгрузка обязана
     ровно совпасть с окном первых семи дней. Иначе подстраховка либо
     закрывает больше, чем физически может, либо теряет единицы. */
  let lagCases = 0;
  const lagBad = [];
  for (const it of result.items) {
    for (const which of ['baseline', 'simulation']) {
      for (const r of it[which].rows) {
        if (!(r.shortfall > 1e-9 && r.reachable > 1e-9 && r.prepStart >= r.reachable - 1e-9 && r.days > 7)) continue;
        lagCases += 1;
        if (Math.abs(r.shortfall - r.lostToLag) > 1e-6) {
          lagBad.push(`${it.key}/${which}/${r.periodId}: нехватка ${r3(r.shortfall)}, лагом объяснимо ${r3(r.lostToLag)}`);
        }
      }
    }
  }
  must(`при достаточном препцентре остаётся ровно лаг 7 дней (${lagCases} случаев)`, lagBad.length === 0,
       lagBad[0]);
}

/* --------------------------------------------------------------------------
   6. Порог резерва — на СУММУ AWD + преп (§8.1)
   -------------------------------------------------------------------------- */
head('6. Порог резерва проверяется на сумму AWD + преп, а не по отдельности (§8.1)');
/**
 * Синтетический товар: FBA заведомо избыточен, роста нет, спрос ровный
 * 1000 шт./мес. AWD = 1500 (1.5 мес), преп = 1000 (1 мес). Порознь оба ниже
 * двухмесячного порога, в сумме 2.5 мес — выше. Пополнение резерва не должно
 * запускаться ни разу.
 */
function synthetic(awdUnits, prepUnits, sku) {
  return {
    schemaVersion: 1, kind: 'oos-demo', asOf: ASOF, horizonEnd: HORIZON_END, demo: true,
    markets: [{ code: 'DE', domain: 'amazon.de', currency: 'EUR', locale: 'de-DE',
      orderRounding: 100, reportLanguage: 'de', accent: 'series-1' }],
    warehouses: [{ id: 'prep-wm', kind: 'prep', market: 'DE', name: 'WM / Eichenzell',
      aliases: ['WM FOB'], includedByDefault: true, prepToFbaLagDays: 7 }],
    products: [{ sku, asin: 'B0SYNTH001', category: 'test',
      title: { ru: 'тест', en: 'test', uk: 'тест' },
      markets: { DE: {
        sellerSku: `${sku}-DE`, reportTitle: 'Eckenschutz Kindersicherung Schrank', active: true,
        fba: { available: 40000, fcTransfer: 0, reservedFcProcessing: 0, reservedCustomerOrder: 0, unfulfillable: 0 },
        awd: { units: awdUnits },
        prep: [{ warehouse: 'prep-wm', unitsPerCarton: 1, cartons: prepUnits }],
        salesHistory: [],
        t30: { units: 1000, windowFrom: '2026-07-16', windowTo: '2026-08-14' },
        primeDay: { days: 4, units: 0, from: '2026-07-14', to: '2026-07-17' },
        shipments: [],
      } } }],
    containers: [],
  };
}
{
  const pass = computeAll(synthetic(1500, 1000, 'SUM1'), PARAMS).items[0];
  const rows = pass.baseline.rows;
  const thr = rows.map((r) => r.thresholdReserve);
  const maxThr = Math.max(...thr);
  say(`        AWD 1500 (1.5 мес) + преп 1000 (1.0 мес) = 2500; порог резерва по периодам ` +
      `${r3(Math.min(...thr))}…${r3(maxThr)}`);
  must('AWD в одиночку ниже порога', 1500 < maxThr - 1e-9, `1500 против порога ${r3(maxThr)}`);
  must('преп в одиночку ниже порога', 1000 < maxThr - 1e-9, `1000 против порога ${r3(maxThr)}`);
  must('сумма выше порога', 2500 > maxThr + 1e-9, `2500 против порога ${r3(maxThr)}`);
  const refills = pass.orders.filter((o) => o.channel === 'prep-refill');
  must('пополнение резерва НЕ запускается', refills.length === 0,
       `движок выписал ${refills.length} строк пополнения на ${refills.reduce((s, o) => s + o.qty, 0)} шт.`);
  const below = rows.filter((r) => r.status === 'below-reserve');
  must('ни один период не помечен «резерв ниже порога»', below.length === 0,
       `помечено периодов: ${below.length} (${below.map((r) => r.periodId).join(', ')})`);
  const pulled = rows.reduce((s, r) => s + r.inflowAwd, 0);
  must('AWD не расходовался (FBA заведомо выше порога)', pulled < 1e-9, `израсходовано ${r3(pulled)}`);
}
// Контрольный обратный случай: сумма НИЖЕ порога — пополнение обязано появиться.
{
  const fail = computeAll(synthetic(800, 800, 'SUM2'), PARAMS).items[0];
  const refills = fail.orders.filter((o) => o.channel === 'prep-refill');
  must('контроль: при AWD 0.8 + преп 0.8 = 1.6 мес пополнение появляется', refills.length > 0,
       'движок не выписал ни одной строки — значит проверка порога вообще не работает');
  say(`        контроль: строк пополнения ${refills.length}, объём ${refills.reduce((s, o) => s + o.qty, 0)} шт.`);
}

/* --------------------------------------------------------------------------
   7. График заказов (§10)
   -------------------------------------------------------------------------- */
head('7. График заказов (§10): дата заказа = прибытие − лид-тайм, кратность шага');
{
  const earliest = addM(ASOF, 4);
  let n = 0;
  const bad = { orderBy: 0, early: 0, step: 0, zero: 0, arrivalDay: 0, sortBad: 0, past: 0 };
  const first = {};
  const note = (k, msg) => { bad[k] += 1; if (!first[k]) first[k] = msg; };
  for (const it of result.items) {
    const step = STEP[it.market];
    let prevKey = '';
    for (const o of it.orders) {
      n += 1;
      const wantOrderBy = addM(o.arrival, -4);
      if (o.orderBy !== wantOrderBy) note('orderBy', `${it.key} ${o.channel} ${o.periodId}: заказать до ${o.orderBy}, а прибытие ${o.arrival} − 4 мес = ${wantOrderBy}`);
      if (cmp(o.arrival, earliest) < 0) note('early', `${it.key} ${o.channel} ${o.periodId}: прибытие ${o.arrival} раньше ${earliest}`);
      if (cmp(o.orderBy, ASOF) < 0) note('past', `${it.key} ${o.channel} ${o.periodId}: заказать до ${o.orderBy} — раньше asOf ${ASOF}`);
      if (o.qty % step !== 0) note('step', `${it.key} ${o.channel} ${o.periodId}: ${o.qty} не кратно ${step}`);
      if (!(o.qty > 0) || o.qty < o.need - 1e-9) note('zero', `${it.key} ${o.channel} ${o.periodId}: объём ${o.qty} при нужде ${r3(o.need)}`);
      const period = myPeriods.find((p) => p.id === o.periodId);
      const wantArrival = period ? (cmp(period.start, earliest) >= 0 ? period.start : earliest) : null;
      if (o.arrival !== wantArrival) note('arrivalDay', `${it.key} ${o.channel} ${o.periodId}: прибытие ${o.arrival}, самый ранний допустимый день периода ${wantArrival}`);
      const key = `${o.orderBy}|${o.arrival}`;
      if (prevKey && key < prevKey) note('sortBad', `${it.key}: строка ${key} стоит после ${prevKey}`);
      prevKey = key;
    }
  }
  must(`дата заказа = прибытие − 4 мес на всех ${n} строках`, bad.orderBy === 0, first.orderBy);
  must(`ни одно прибытие не раньше asOf + 4 мес (${earliest})`, bad.early === 0, first.early);
  must('ни одна дата «заказать до» не в прошлом', bad.past === 0, first.past);
  must('количества кратны шагу рынка (DE 100, UK 50)', bad.step === 0, first.step);
  must('объём заказа положителен и покрывает дефицит', bad.zero === 0, first.zero);
  must('прибытие ставится на самый ранний допустимый день периода', bad.arrivalDay === 0, first.arrivalDay);
  must('список отсортирован по «заказать до», затем по прибытию', bad.sortBad === 0, first.sortBad);
  // Пример спецификации §18: прибытие 2027-01-01 → заказать до 2026-09-01.
  check('§18: addMonths(2027-01-01, −4)', addM('2027-01-01', -4), '2026-09-01');
  check('§18: earliestArrival', earliest, '2026-12-15');
  const de = result.items.find((x) => x.market === 'DE' && x.orders.length);
  const uk = result.items.find((x) => x.market === 'UK' && x.orders.length);
  say(`        DE-пример ${de.key}: ${de.orders[0].qty} шт., заказать до ${de.orders[0].orderBy}, прибытие ${de.orders[0].arrival}`);
  say(`        UK-пример ${uk.key}: ${uk.orders[0].qty} шт., заказать до ${uk.orders[0].orderBy}, прибытие ${uk.orders[0].arrival}`);
  // Ускорение партий: даты не выдумываются, а берутся у самих контейнеров.
  let expBad = 0;
  for (const it of result.items) {
    for (const e of it.expedite) {
      const a = it.baseline.arrivals.find((x) => x.containerId === e.containerId);
      if (!a || a.date !== e.arrival || Math.abs(a.qty - e.qty) > 1e-9) expBad += 1;
      if (e.orderBy !== null) expBad += 1;
    }
  }
  must('строки ускорения ссылаются на реальные контейнеры и без даты заказа', expBad === 0, `нарушений: ${expBad}`);
}

/* --------------------------------------------------------------------------
   8. Покрытие двумя методами (§11)
   -------------------------------------------------------------------------- */
head('8. «На сколько хватит стока» (§11): TOTAL, метод A (фиксированный), метод B (сезонный)');
{
  const capDays = Math.ceil(36 * DAYS_PER_MONTH);
  for (const d of derived.values()) {
    const it = engineItem(d.key);
    if (!it) continue;
    const total = d.startFba + d.awd + d.prepUnits + d.inTransit;
    check(`${d.key} TOTAL`, it.coverage.total, total, 1e-9);
    check(`${d.key} метод A`, r3(it.coverage.fixedMonths), r3(total / d.t30Adj), 1e-6);

    // Метод B: посуточное вычитание спроса с ростом, от asOf + 1 день.
    const monthUnits = (mk) => d.t30Adj * Math.pow(d.growth, mdiff(mkey(ASOF), mk));
    let rest = total;
    let days = 0;
    let day = addD(ASOF, 1);
    while (rest > 1e-9 && days < capDays) {
      const mk = mkey(day);
      rest -= monthUnits(mk) / dim(mk);
      days += 1;
      day = addD(day, 1);
    }
    check(`${d.key} метод B`, r3(it.coverage.growthMonths), r3(days / DAYS_PER_MONTH), 1e-6);
  }
  /* §11.3 спецификации утверждает: «метод B ВСЕГДА меньше». Арифметически
     это верно только при росте: метод A делит запас на ровный t30′, метод B —
     на кривую t30′ × g^k. При g > 1 кривая выше ровной линии и запас кончается
     раньше (B < A); при g < 1 она ниже, и запаса хватает ДОЛЬШЕ (B > A).
     Поэтому жёстко требуем B ≤ A только там, где спрос растёт, а падающие
     товары выносим отдельным предупреждением: их поведение — следствие
     формул §11.1–§11.2, а не ошибка движка. Обе реализации сошлись на
     значениях выше строка в строку. */
  const growing = [];
  const declining = [];
  for (const it of result.items) {
    const a = it.coverage.fixedMonths;
    const b = it.coverage.growthMonths;
    const g = it.baseline.growth.value;
    if (b > a + 1e-6) (g >= 1 ? growing : declining).push(
      `${it.key}: B ${b.toFixed(2)} > A ${a.toFixed(2)} (рост ${g.toFixed(4)})`);
  }
  must('метод B не больше метода A на растущих товарах (§11.3)', growing.length === 0, growing.join('; '));
  if (declining.length) {
    say(`  ВНИМАНИЕ §11.3 не выполняется на падающих товарах (рост < 1): ${declining.join('; ')}`);
    say('        это не расхождение движка с формулами §11.1–§11.2, а расхождение самой');
    say('        спецификации с арифметикой: при падающем спросе запаса хватает дольше средней нормы');
  }
}

/* --------------------------------------------------------------------------
   9. Исходы, заявленные в data-coverage.md
   -------------------------------------------------------------------------- */
head('9. Заявленные исходы по товарам (data-coverage.md §1–§4)');
{
  const it = (k) => engineItem(k);
  const earliest = addM(ASOF, 4);

  // SQ1 DE — OOS в непоправимом окне: дефицит наступает раньше лид-тайма.
  {
    const x = it('DE:SQ1');
    must('DE:SQ1 — «OOS в непоправимом окне»', x.status === 'unrecoverable', `статус ${x.status}`);
    const early = x.baseline.rows.filter((r) => r.shortfall > 1e-9 && cmp(r.end, earliest) < 0);
    must('DE:SQ1 дефицит есть до самой ранней поставки', early.length > 0, 'таких периодов нет');
    must('DE:SQ1 предложено ускорение готовых партий', x.expedite.length > 0, 'список ускорения пуст');
    say(`        DE:SQ1 первый провал ${early[0] ? early[0].periodId : '—'}, самая ранняя поставка ${earliest}, ` +
        `строк ускорения ${x.expedite.length}`);
    /* §3.4: включение Kastellaun обязано СДВИГАТЬ первый провал, а не просто
       уменьшать суммарные потери. Если весь остаточный дефицит лежит внутри
       семидневного лага (§9.4), склад не меняет ничего, и ветка «включить
       второй препцентр» в макете недостижима. */
    const both = computeAll(data, {
      ...PARAMS,
      selectedPrepCenters: { DE: ['WM_EICHENZELL', 'KASTELLAUN'], UK: ['WEPREP_STOWMARKET'] },
    }).items.find((y) => y.key === 'DE:SQ1');
    const firstWm = x.baseline.rows.find((r) => r.shortfall > 1e-9);
    const firstBoth = both.baseline.rows.find((r) => r.shortfall > 1e-9);
    must('DE:SQ1 — включение Kastellaun отодвигает первый провал',
         Boolean(firstWm && firstBoth) && cmp(firstBoth.start, firstWm.start) > 0,
         `с WM ${firstWm ? firstWm.periodId : '—'}, с обоими ${firstBoth ? firstBoth.periodId : '—'}`);
    must('DE:SQ1 — Kastellaun уменьшает потери', both.baseline.lostUnits < x.baseline.lostUnits - 1,
         `${r3(both.baseline.lostUnits)} против ${r3(x.baseline.lostUnits)}`);
    say(`        DE:SQ1 с Kastellaun: первый провал ${firstBoth.periodId}, ` +
        `потери ${r3(both.baseline.lostUnits)} против ${r3(x.baseline.lostUnits)}`);
  }
  // SQ4 DE — полностью здоров, заказы не нужны.
  {
    const x = it('DE:SQ4');
    must('DE:SQ4 — «здоровый, заказы не нужны»', x.status === 'ok', `статус ${x.status}`);
    must('DE:SQ4 без заказов', x.orders.length === 0, `выписано строк: ${x.orders.length}`);
    must('DE:SQ4 без дефицита во всех периодах', x.baseline.rows.every((r) => r.shortfall < 1e-9), 'дефицит есть');
    must('DE:SQ4 резерв держит порог', x.baseline.rows.every((r) => r.reserveEnd >= r.thresholdReserve - 1e-9), 'резерв просел');
  }
  // SQ3 DE — ниже порога, но без OOS.
  {
    const x = it('DE:SQ3');
    must('DE:SQ3 — «ниже порога, но не OOS»: дефицита нет', x.baseline.oosPeriodIds.length === 0,
         `периоды дефицита: ${x.baseline.oosPeriodIds.join(', ')}`);
    must('DE:SQ3 просадка ниже порога FBA есть', x.baseline.belowFbaPeriodIds.length > 0, 'просадки нет');
    must('DE:SQ3 препцентр ни разу не тратился', x.baseline.rows.every((r) => r.safety < 1e-9), 'подстраховка сработала');
    must('DE:SQ3 жёлтый только по порогу FBA — резерв держится',
         x.baseline.rows.every((r) => r.reserveEnd >= r.thresholdReserve - 1e-9),
         'резерв просел, и товар неотличим от «жёлтых по резерву»');
  }
  // SQ7 DE — то же сочетание плюс исключённый склад AsiaLog в данных.
  {
    const x = it('DE:SQ7');
    must('DE:SQ7 — просадка по FBA есть, дефицита нет',
         x.baseline.belowFbaPeriodIds.length > 0 && x.baseline.oosPeriodIds.length === 0,
         `просадок ${x.baseline.belowFbaPeriodIds.length}, дефицитов ${x.baseline.oosPeriodIds.length}`);
    must('DE:SQ7 резерв держит порог',
         x.baseline.rows.every((r) => r.reserveEnd >= r.thresholdReserve - 1e-9), 'резерв просел');
    must('DE:SQ7 сток исключённого AsiaLog в расчёт не вошёл',
         x.baseline.prepExcluded > 0, `исключено ${x.baseline.prepExcluded} шт.`);
  }
  // SQ2 DE — OOS позже лид-тайма, лечится заказом.
  {
    const x = it('DE:SQ2');
    must('DE:SQ2 — «OOS позже лид-тайма»', x.status === 'oos', `статус ${x.status}`);
    must('DE:SQ2 ни один дефицит не раньше лид-тайма',
         x.baseline.rows.every((r) => r.shortfall < 1e-9 || cmp(r.end, earliest) >= 0), 'есть непоправимый период');
    must('DE:SQ2 закрывается прямыми поставками',
         x.orders.some((o) => o.channel === 'direct-fba'), 'прямых поставок не запланировано');
    must('DE:SQ2 после заказов дефицит снят',
         x.simulation.rows.every((r) => r.shortfall < 1e-9), 'дефицит остался и с заказами');
  }
  // SQ5 DE — подстраховка из препа есть, пополнение резерва не нужно.
  {
    const x = it('DE:SQ5');
    must('DE:SQ5 — подстраховка из препцентра срабатывает',
         x.baseline.rows.some((r) => r.safety > 1e-9), 'подстраховка не сработала ни разу');
    must('DE:SQ5 резерв нигде не ниже порога',
         x.baseline.rows.every((r) => r.reserveEnd >= r.thresholdReserve - 1e-9), 'резерв просел');
    must('DE:SQ5 пополнение резерва не выписано',
         x.orders.every((o) => o.channel !== 'prep-refill'), 'строка пополнения появилась при достаточном резерве');
  }
  // SQ6 DE — резерв проседает, пополнение обязано появиться.
  {
    const x = it('DE:SQ6');
    must('DE:SQ6 — пополнение резерва выписано',
         x.orders.some((o) => o.channel === 'prep-refill'), 'строки пополнения нет');
  }
  // SQ8 DE — граница лид-тайма: дефицит позже 15.12, заказ помогает.
  {
    const x = it('DE:SQ8');
    must('DE:SQ8 — OOS, но поправимый', x.status === 'oos', `статус ${x.status}`);
    must('DE:SQ8 fcTransfer = 0 не сломал START_FBA', x.baseline.startFba === 2375, `START_FBA ${x.baseline.startFba}`);
  }
  /* SQ9 DE — корекция Prime Day меняет вердикт. data-coverage.md обещает
     «с коррекцией OOS нет», но это расчёт на бумаге, без семидневного лага
     препцентра (§9.4). Поэтому проверяется то, что от лага не зависит:
     с коррекцией весь остаточный дефицит — это ровно непокрываемое лагом
     окно первых семи дней, без коррекции дефицит кратно больше и захватывает
     лишний период. */
  {
    const x = it('DE:SQ9');
    const off = computeAll(data, { ...PARAMS, primeDayMode: 'off' }).items.find((y) => y.key === 'DE:SQ9');
    const lag = x.baseline.rows.reduce((s, r) => s + r.lostToLag, 0);
    must('DE:SQ9 — с коррекцией Prime Day остаётся только лаг препцентра',
         Math.abs(x.baseline.lostUnits - lag) < 1e-6,
         `недоотгружено ${r3(x.baseline.lostUnits)}, из них лагом объяснимо ${r3(lag)}`);
    must('DE:SQ9 — с коррекцией дефицита нет вообще', x.baseline.oosPeriodIds.length === 0,
         `периоды дефицита: ${x.baseline.oosPeriodIds.join(', ')}`);
    must('DE:SQ9 — тумблер Prime Day меняет вердикт карточки',
         x.status !== 'oos' && x.status !== 'unrecoverable'
           && (off.status === 'oos' || off.status === 'unrecoverable'),
         `с коррекцией ${x.status}, без коррекции ${off.status}`);
    must('DE:SQ9 — без коррекции Prime Day дефицит кратно больше',
         off.baseline.lostUnits > x.baseline.lostUnits + 100
           && off.baseline.oosPeriodIds.length > x.baseline.oosPeriodIds.length,
         `с коррекцией ${r3(x.baseline.lostUnits)} шт. в ${x.baseline.oosPeriodIds.length} периодах, ` +
         `без коррекции ${r3(off.baseline.lostUnits)} шт. в ${off.baseline.oosPeriodIds.length}`);
    say(`        DE:SQ9: статус ${x.status} против ${off.status} без коррекции`);
    say(`        DE:SQ9: t30′ ${r3(x.baseline.t30Adjusted)} против ${r3(off.baseline.t30Adjusted)} без коррекции; ` +
        `недоотгрузка ${r3(x.baseline.lostUnits)} против ${r3(off.baseline.lostUnits)}`);
  }
  // SQ5 UK — худший случай: длинный OOS, лечится только ускорением.
  {
    const x = it('UK:SQ5');
    must('UK:SQ5 — «длинный OOS»: три и более периода дефицита',
         x.baseline.oosPeriodIds.length >= 3, `периодов дефицита ${x.baseline.oosPeriodIds.length}`);
    must('UK:SQ5 — непоправимое окно', x.status === 'unrecoverable', `статус ${x.status}`);
    must('UK:SQ5 — предложено ускорение', x.expedite.length > 0, 'список ускорения пуст');
  }
  // SQ8 UK — почти пустой сток, подстраховаться нечем.
  {
    const x = it('UK:SQ8');
    must('UK:SQ8 — непоправимый OOS', x.status === 'unrecoverable', `статус ${x.status}`);
    must('UK:SQ8 — ни AWD, ни препа, ни подстраховки',
         x.baseline.awdUnits === 0 && x.baseline.prepUnits === 0 && x.baseline.rows.every((r) => r.safety < 1e-9),
         `awd ${x.baseline.awdUnits}, преп ${x.baseline.prepUnits}`);
  }
  // SQ2 UK — жёлтое, но без OOS: заказ не спасает и прямых поставок не нужно.
  {
    const x = it('UK:SQ2');
    must('UK:SQ2 — дефицита нет', x.baseline.oosPeriodIds.length === 0,
         `периоды дефицита: ${x.baseline.oosPeriodIds.join(', ')}`);
    must('UK:SQ2 — прямых поставок не требуется',
         x.orders.every((o) => o.channel !== 'direct-fba'), 'выписана прямая поставка');
    must('UK:SQ2 — просадка ниже порога FBA внутри непоправимого окна',
         x.baseline.belowFbaPeriodIds.length > 0
           && x.baseline.rows.filter((r) => r.status === 'below-fba')
             .every((r) => cmp(r.end, earliest) < 0),
         `просадки: ${x.baseline.belowFbaPeriodIds.join(', ') || 'нет'}`);
    must('UK:SQ2 — заказов нет вовсе: резерв в норме, а просадку не догнать',
         x.orders.length === 0, `выписано строк: ${x.orders.length}`);
    say(`        UK:SQ2: жёлтый по FBA в ${x.baseline.belowFbaPeriodIds.join(', ')}, ` +
        `резерв держит порог во всех периодах`);
  }
  // SQ3 UK — ни одного контейнера; рост в границах, зажатия нет.
  {
    const x = it('UK:SQ3');
    const cnt = (data.containers || []).filter((c) => c.sku === 'SQ3' && containerMarket(c.forwarderRef) === 'UK').length;
    must('UK:SQ3 — в данных нет ни одного контейнера', cnt === 0, `контейнеров ${cnt}`);
    must('UK:SQ3 — расчёт не упал на пустом конвейере',
         x.baseline.arrivals.length === 0 && x.baseline.rows.length === myPeriods.length,
         `приходов ${x.baseline.arrivals.length}, строк ${x.baseline.rows.length}`);
    must('UK:SQ3 — рост внутри границ, зажатия нет', x.baseline.growth.clamped === false, 'рост зажат');
  }
  // SQ10 UK — здоров, резерв ниже порога, но преп не тратился.
  {
    const x = it('UK:SQ10');
    must('UK:SQ10 — дефицита нет', x.baseline.oosPeriodIds.length === 0,
         `периоды дефицита: ${x.baseline.oosPeriodIds.join(', ')}`);
    must('UK:SQ10 — препцентр ни разу не тратился', x.baseline.rows.every((r) => r.safety < 1e-9), 'подстраховка сработала');
    must('UK:SQ10 — резерв ниже двухмесячного порога',
         x.baseline.rows.some((r) => r.reserveEnd < r.thresholdReserve - 1e-9), 'резерв везде выше порога');
    const refills = x.orders.filter((o) => o.channel === 'prep-refill').length;
    say(`        UK:SQ10: строк пополнения ${refills} — при базовом prepRefillRequiresSpend=false это ожидаемо ` +
        `(data-coverage.md описывает прочтение с true)`);
  }
  // Неактивные пары.
  {
    const wantInactive = ['DE:SQ10', 'UK:SQ4', 'UK:SQ6', 'UK:SQ7', 'UK:SQ9'];
    const got = result.inactive.map((x) => x.key).sort();
    check('набор неактивных пар', got.join(', '), wantInactive.slice().sort().join(', '));
    must('неактивные не попали в расчёт',
         wantInactive.every((k) => !engineItem(k)), 'неактивная пара оказалась среди рассчитанных');
    const orphan = (result.orphanContainers || []).find((o) => o.id === 'C-2624');
    must('C-2624 — контейнер без адресата (пара UK:SQ7 неактивна)', Boolean(orphan),
         'контейнер исчез вместо попадания в блок качества данных');
  }
}

/* --------------------------------------------------------------------------
   10. Краевые случаи и точки принятия решений (§14–§15)

   Демо-набор задевает не всё: одна отправка в двух контейнерах, битая дата
   расчёта, пустой выбор препцентров, горизонт в прошлом. Всё это проверяется
   синтетическими наборами — маленькими и посчитанными на бумаге. Без них
   ошибка в этих ветках осталась бы невидимой до первого живого файла.
   -------------------------------------------------------------------------- */
head('10. Краевые случаи и параметры (§14–§15)');

/** Минимальный набор данных: один товар, один рынок, всё остальное — по вкусу. */
function mini(o = {}) {
  const market = o.market || 'DE';
  const sku = o.sku || 'EDGE';
  const uk = market === 'UK';
  return {
    schemaVersion: 1, kind: 'oos-demo', demo: true,
    asOf: 'asOf' in o ? o.asOf : ASOF,
    horizonEnd: 'horizonEnd' in o ? o.horizonEnd : HORIZON_END,
    markets: [{
      code: market, domain: uk ? 'amazon.co.uk' : 'amazon.de',
      currency: uk ? 'GBP' : 'EUR', locale: uk ? 'en-GB' : 'de-DE',
      orderRounding: o.orderRounding === undefined ? 100 : o.orderRounding,
      reportLanguage: o.reportLanguage || (uk ? 'en' : 'de'), accent: 'series-1',
    }],
    warehouses: o.warehouses || [{
      id: uk ? 'prep-weprep' : 'prep-wm', kind: 'prep', market,
      name: uk ? 'WePrep Stowmarket' : 'WM / Eichenzell',
      aliases: uk ? ['WePrep'] : ['WM FOB', 'Lager Eichenzell'],
      includedByDefault: true, prepToFbaLagDays: 7,
    }],
    products: [{
      sku, asin: `B0${sku}0001`, category: 'test',
      title: { ru: 'тест', en: 'test', uk: 'тест' },
      markets: { [market]: {
        sellerSku: `${sku}-${market}`,
        reportTitle: o.reportTitle || (uk ? 'Corner Protector Safety Lock' : 'Eckenschutz Kindersicherung Schrank'),
        active: true,
        fba: { available: o.available === undefined ? 5000 : o.available,
               fcTransfer: 0, reservedFcProcessing: 0, reservedCustomerOrder: 0, unfulfillable: 0 },
        awd: { units: o.awd || 0 },
        prep: o.prep || [],
        salesHistory: o.history || [],
        ...(o.t30 === null ? {} : { t30: { units: o.t30 === undefined ? 1000 : o.t30,
          windowFrom: '2026-07-16', windowTo: '2026-08-14' } }),
        ...(o.forecast ? { forecast: { units: o.forecast, source: 'seller-central-july' } } : {}),
        primeDay: { days: 4, units: o.primeDay || 0, from: '2026-07-16', to: '2026-07-19' },
        shipments: o.shipments || [],
      } },
    }],
    containers: (o.containers || []).map((c, i) => ({
      ref: c.ref || `C-E${i + 1}`, sku, forwarderRef: c.forwarderRef, units: c.units,
      status: c.status === undefined ? 'scheduled' : c.status,
      eta: c.eta === undefined ? null : c.eta,
      invoiceDivided: c.invoiceDivided === true, parentRef: c.parentRef || null,
    })),
  };
}
const one = (data, params = PARAMS) => computeAll(data, params).items[0];
const flagCodes = (it) => it.flags.map((f) => f.code);

// 10.1. Одна отправка, физически разложенная по двум контейнерам.
{
  const x = one(mini({
    shipments: [{ shipmentId: 'FBA15SPLIT1', expected: 1000, located: 0, expectedArrival: '2026-10-01' }],
    containers: [
      { ref: 'C-S1', forwarderRef: 'AGL EXW FBA15SPLIT1', units: 600, eta: '2026-10-01' },
      { ref: 'C-S2', forwarderRef: 'AGL EXW FBA15SPLIT1', units: 400, eta: '2026-10-01' },
    ],
  }));
  const total = x.baseline.arrivals.reduce((s2, a) => s2 + a.qty, 0);
  check('одна отправка в двух контейнерах: в дороге ровно expected − located', total, 1000, 1e-9);
  must('одна отправка в двух контейнерах: остаток не начислен каждому',
       x.baseline.arrivals.every((a) => a.qty <= (a.containerId === 'C-S1' ? 600 : 1000) + 1e-9),
       x.baseline.arrivals.map((a) => `${a.containerId}:${a.qty}`).join(', '));
  say(`        приходы: ${x.baseline.arrivals.map((a) => `${a.containerId || '—'} ${a.qty}`).join(', ')}`);
}

// 10.2. Идентификатор отправки с хвостом в колонке отчёта.
{
  const x = one(mini({
    shipments: [{ shipmentId: 'FBA15QQQQQQ-1', expected: 400, located: 0 }],
    containers: [{ ref: 'C-Q1', forwarderRef: 'AGL EXW FBA15QQQQQQ', units: 400, eta: '2026-10-01' }],
  }));
  const total = x.baseline.arrivals.reduce((s2, a) => s2 + a.qty, 0);
  check('строка отчёта `FBA15QQQQQQ-1` сошлась с контейнером `FBA15QQQQQQ`', total, 400, 1e-9);
  must('она же не приехала вторым приходом', x.baseline.arrivals.length === 1,
       `приходов ${x.baseline.arrivals.length}: ${x.baseline.arrivals.map((a) => a.qty).join(' + ')}`);
  must('и не помечена как «нет строки отчёта»', !flagCodes(x).includes('shipment-row-missing'),
       flagCodes(x).join(', '));
}

// 10.3. Прибывший контейнер: чекнута часть, хвост едет с датой asOf + 7 дней.
{
  const base = mini({
    shipments: [{ shipmentId: 'FBA15ARR1XX', expected: 500, located: 300 }],
    containers: [{ ref: 'C-A1', forwarderRef: 'FBA15ARR1XX', units: 500, status: 'arrived', eta: '2026-08-05' }],
  });
  const x = one(base);
  const a = x.baseline.arrivals[0];
  check('прибывший контейнер: в дорогу идёт только нечекнутый хвост', a.qty, 200, 1e-9);
  check('хвост датируется как чек-ин на FC (asOf + 7 дней)', a.date, addD(ASOF, 7));
  const moved = one(base, { ...PARAMS, etaArrivedDays: 30 }).baseline.arrivals[0];
  check('параметр etaArrivedDays двигает эту дату', moved.date, addD(ASOF, 30));
}

// 10.4. Дата расчёта, которую нельзя разобрать.
{
  const shape = ['asOf', 'horizonEnd', 'periods', 'params', 'markets', 'items', 'inactive',
    'orphanContainers', 'flags', 'totals'];
  for (const [label, value] of [['15.08.2026', '15.08.2026'], ['2026/08/15', '2026/08/15'], ['нет вовсе', null]]) {
    const data2 = mini({ asOf: value });
    if (value === null) delete data2.asOf;
    let res = null;
    let boom = null;
    try { res = computeAll(data2, PARAMS); } catch (e) { boom = e; }
    must(`asOf «${label}»: расчёт не падает`, boom === null, boom ? `${boom.constructor.name}: ${boom.message}` : '');
    if (!res) continue;
    must(`asOf «${label}»: форма результата та же, что у успешного расчёта`,
         shape.every((k) => k in res), `нет полей: ${shape.filter((k) => !(k in res)).join(', ')}`);
    must(`asOf «${label}»: сводка нулевая, а не undefined`,
         res.totals && res.totals.items === 0 && res.totals.orderUnits === 0, JSON.stringify(res.totals));
    const codes = res.flags.map((f) => f.code);
    must(`asOf «${label}»: выставлен флаг ${value === null ? 'no-as-of' : 'bad-as-of'}`,
         codes.includes(value === null ? 'no-as-of' : 'bad-as-of'), codes.join(', '));
  }
}

// 10.5. Пустой выбор препцентров (§3.4, §9.4).
{
  const cfg = { available: 900, t30: 3000, prep: [{ warehouse: 'prep-wm', unitsPerCarton: 100, cartons: 60 }] };
  const withWm = one(mini(cfg));
  const empty = one(mini(cfg), { ...PARAMS, selectedPrepCenters: { DE: [], UK: [] } });
  must('контроль: с выбранным препцентром подстраховка срабатывает',
       withWm.baseline.rows.some((r) => r.safety > 1e-9), 'подстраховки нет и с выбранным складом');
  check('пустой выбор препцентров: запас препа не учитывается', empty.baseline.prepUnits, 0);
  must('пустой выбор препцентров: подстраховки нет ни в одном периоде',
       empty.baseline.rows.every((r) => r.safety < 1e-9),
       `подстраховано ${r3(empty.baseline.rows.reduce((s2, r) => s2 + r.safety, 0))} шт.`);
  must('пустой выбор препцентров: пополнение резерва не планируется',
       empty.orders.every((o) => o.channel !== 'prep-refill'),
       `строк пополнения ${empty.orders.filter((o) => o.channel === 'prep-refill').length}`);
}

// 10.6. Шаг округления: параметр главнее данных (§14).
{
  const cfg = { available: 300, t30: 3000, orderRounding: 100 };
  const byData = one(mini(cfg));
  const byParam = one(mini(cfg), { ...PARAMS, roundingStep: { DE: 250, UK: 50 } });
  must('шаг из данных действует, пока параметр не задан',
       byData.orders.length > 0 && byData.orders.every((o) => o.qty % 100 === 0),
       byData.orders.map((o) => o.qty).join(', '));
  must('шаг из параметров перекрывает шаг из данных',
       byParam.orders.length > 0 && byParam.orders.every((o) => o.qty % 250 === 0),
       byParam.orders.map((o) => o.qty).join(', '));
  check('и попадает в результат как действующий', byParam.baseline.roundingStep, 250);
}

// 10.7. Источник t30 «июльский forecast» (§15, пункт 3).
{
  const cfg = { t30: 1000, forecast: 4000 };
  check('базовый источник — SB Sales Units', one(mini(cfg)).baseline.t30, 1000);
  check('источник julyForecast читает прогноз из данных',
        one(mini(cfg), { ...PARAMS, t30Source: 'julyForecast' }).baseline.t30, 4000);
  // Прогноза нет — откат на SB Sales Units, а не ноль и не NaN.
  check('без прогноза в данных — откат на SB Sales Units',
        one(mini({ t30: 1000 }), { ...PARAMS, t30Source: 'julyForecast' }).baseline.t30, 1000);
}

// 10.8. Три политики подстраховки различимы (§15, пункт 9).
{
  // Полка кончается к концу первого периода: на день прихода подстраховки
  // (1 + 7) остаток ещё положителен. «Аварийно при нуле» в этом случае
  // отправку не шлёт, базовая политика — шлёт.
  const cfg = { available: 1200, t30: 3000, awd: 0,
    prep: [{ warehouse: 'prep-wm', unitsPerCarton: 100, cartons: 50 }] };
  const first = (policy) => one(mini(cfg), { ...PARAMS, safetyPolicy: policy }).baseline.rows[0];
  const em = first('emergency');
  const zero = first('zeroOnly');
  const thr = first('threshold');
  must('emergency: подстраховка уходит под нехватку конца периода', em.safety > 1e-9,
       `подстраховано ${r3(em.safety)}`);
  must('zeroOnly: пока полка не пуста на день прихода, отправки нет', zero.safety < 1e-9,
       `подстраховано ${r3(zero.safety)} при остатке на день 8 больше нуля`);
  must('threshold: подстраховка ещё и держит порог FBA', thr.safety > em.safety + 1e-9,
       `threshold ${r3(thr.safety)} против emergency ${r3(em.safety)}`);
  say(`        подстраховка первого периода: emergency ${r3(em.safety)}, ` +
      `zeroOnly ${r3(zero.safety)}, threshold ${r3(thr.safety)}`);
}

// 10.9. Контейнер со статусом вне набора §4.4.
{
  const x = one(mini({
    containers: [{ ref: 'C-U1', forwarderRef: 'FBA15UNKNW1', units: 500, status: 'delayed at customs' }],
    shipments: [{ shipmentId: 'FBA15UNKNW1', expected: 500, located: 0 }],
  }));
  const a = x.baseline.arrivals.find((y) => y.containerId === 'C-U1');
  check('неизвестный статус датируется консервативно (asOf + 4 мес)', a.date, addFM(ASOF, 4));
  const codes = flagCodes(x).filter((c) => c === 'container-status-unknown');
  const derived = flagCodes(x).filter((c) => c === 'eta-derived-from-status');
  check('и помечается предупреждением ровно один раз', codes.length, 1);
  check('флаг «дата выведена» тоже ставится ровно один раз', derived.length, 1);
}

// 10.10. UK внутри Shipment ID — не признак рынка (§4.1).
{
  const r = computeAll(mini({
    containers: [{ ref: 'C-M1', forwarderRef: 'AGL EXW FBA15UK7QWE9', units: 700, eta: '2026-10-01' }],
    shipments: [{ shipmentId: 'FBA15UK7QWE9', expected: 700, located: 0 }],
  }), PARAMS);
  const x = r.items[0];
  must('контейнер с «UK» внутри идентификатора остался на своём рынке',
       x.baseline.arrivals.some((a) => a.containerId === 'C-M1'),
       `приходы: ${x.baseline.arrivals.map((a) => a.containerId).join(', ') || 'нет'}; ` +
       `без адресата: ${r.orphanContainers.map((o) => o.id).join(', ') || 'нет'}`);
}

// 10.11. Горизонт: данные задают, параметр перекрывает (§0.1 против §14).
{
  const data2 = mini({ horizonEnd: '2026-10-31' });
  const fromData = computeAll(data2, PARAMS);
  check('горизонт берётся из JSON, пока пользователь его не менял', fromData.horizonEnd, '2026-10-31');
  check('и список периодов обрезан по нему', fromData.periods.at(-1).id, '2026-10-H2');
  const fromUi = computeAll(data2, { ...PARAMS, horizonEnd: '2026-09-30' });
  check('явная дата из параметров перекрывает данные', fromUi.horizonEnd, '2026-09-30');
  const preset = computeAll(data2, { ...PARAMS, horizon: '12m' });
  check('выбранный пресет тоже перекрывает данные', preset.horizonEnd, endM(addM(ASOF, 12)));
}

// 10.12. Горизонт целиком в прошлом.
{
  const r = computeAll(mini({ horizonEnd: '2026-07-31', available: 100, t30: 3000 }), PARAMS);
  const x = r.items[0];
  check('горизонт в прошлом: периодов нет', r.periods.length, 0);
  check('товар не выдаёт себя за здоровый', x.status, 'no-horizon');
  must('и помечен флагом horizon-empty', flagCodes(x).includes('horizon-empty'), flagCodes(x).join(', '));
}

// 10.13. Проверка «данные того рынка» (§1.2).
{
  const de = ['Eckenschutz XL 4er-Set', 'Kindersicherung Schublade', 'Steckdosenschutz 24 Stück'];
  const wrong = mini({ market: 'UK', reportLanguage: 'en' });
  const uk = wrong.markets[0].code;
  wrong.products = de.map((title, i) => ({
    sku: `WR${i + 1}`, asin: `B0WR${i + 1}`, category: 'test',
    title: { ru: 'тест', en: 'test', uk: 'тест' },
    markets: { [uk]: { ...JSON.parse(JSON.stringify(wrong.products[0].markets[uk])), reportTitle: title } },
  }));
  const r = computeAll(wrong, PARAMS);
  const m = r.markets[0];
  must('немецкие названия в UK-выгрузке: рынок заблокирован', m.blocked === true, `blocked=${m.blocked}`);
  must('и помечен ошибкой wrong-marketplace-report',
       m.flags.some((f) => f.code === 'wrong-marketplace-report' && f.level === 'error'),
       m.flags.map((f) => f.code).join(', '));
  check('заблокированный рынок не считается', m.items.length, 0);
  check('доля совпадения языка', m.langShare, 0);

  // Меньше трёх названий — предупреждение, но расчёт идёт.
  const few = mini({ market: 'UK' });
  const r2 = computeAll(few, PARAMS);
  must('меньше трёх названий: предупреждение, а не блокировка',
       r2.markets[0].blocked === false
         && r2.markets[0].flags.some((f) => f.code === 'lang-sample-too-small'),
       r2.markets[0].flags.map((f) => f.code).join(', '));
  check('доля при слишком малой выборке — null, а не ноль', r2.markets[0].langShare, null);

  // Подмена файла: UK-стоки побайтово повторяют DE.
  const dup = mini({ available: 4321 });
  dup.markets.push({ code: 'UK', domain: 'amazon.co.uk', currency: 'GBP', locale: 'en-GB',
    orderRounding: 50, reportLanguage: 'en', accent: 'series-4' });
  dup.products[0].markets.UK = JSON.parse(JSON.stringify(dup.products[0].markets.DE));
  dup.products[0].markets.UK.reportTitle = 'Corner Protector Safety Lock';
  const r3res = computeAll(dup, PARAMS);
  const ukMarket = r3res.markets.find((x) => x.code === 'UK');
  must('UK-стоки, повторяющие DE: флаг fba-report-duplicated-from-de',
       ukMarket.flags.some((f) => f.code === 'fba-report-duplicated-from-de'),
       ukMarket.flags.map((f) => f.code).join(', '));
  must('и рынок UK не рассчитывается', ukMarket.blocked === true && ukMarket.items.length === 0,
       `blocked=${ukMarket.blocked}, товаров ${ukMarket.items.length}`);
}

// 10.14. Продажи «нет данных» против «ноль» (§12.3).
{
  const noData = computeAll(mini({ t30: null, history: [{ month: '2026-06' }, { month: '2026-07' }] }), PARAMS);
  const zero = computeAll(mini({ t30: 0 }), PARAMS);
  check('нет строки продаж → причина «нет данных»', noData.inactive[0].reason, 'no-data');
  check('и t30 остаётся null, а не NaN и не нулём', noData.inactive[0].salesT30, null);
  check('подтверждённый ноль → причина «нет продаж за 30 дней»', zero.inactive[0].reason, 'no-sales-30d');
  // Правило неактивности переключается параметром: со стоком товар считается.
  const withStock = computeAll(mini({ t30: 0, available: 800 }), { ...PARAMS, inactiveRule: 't30AndStockZero' });
  must('inactiveRule=t30AndStockZero: товар со стоком считается активным',
       withStock.items.length === 1 && withStock.inactive.length === 0,
       `активных ${withStock.items.length}, неактивных ${withStock.inactive.length}`);
  must('и покрытие у него null, а не бесконечность',
       withStock.items[0].coverage.fixedMonths === null && withStock.items[0].coverage.growthMonths === null,
       JSON.stringify(withStock.items[0].coverage));
}

// 10.15. §18: ни NaN, ни Infinity, ни undefined во всём результате.
{
  const bad = [];
  const seen = new Set();
  const walk = (node, path) => {
    if (node === null || bad.length > 20) return;
    if (typeof node === 'number') {
      if (!Number.isFinite(node)) bad.push(`${path} = ${node}`);
      return;
    }
    if (typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach((v, i) => {
        if (v === undefined) bad.push(`${path}[${i}] = undefined`);
        walk(v, `${path}[${i}]`);
      });
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'function') continue;
      if (v === undefined) bad.push(`${path}.${k} = undefined`);
      walk(v, `${path}.${k}`);
    }
  };
  walk(result, 'result');
  must('во всём результате нет NaN, Infinity и undefined', bad.length === 0, bad.slice(0, 3).join('; '));
}

/* --------------------------------------------------------------------------
   11. Настройки, которые обязаны влиять на расчёт (§4, §9.4, «Интеграции»)

   Раздел «Интеграции» даёт править правила классификации контейнеров и лаг
   каждого преп-центра. До этой проверки движок носил их своими константами:
   поле в окне настроек редактировалось, а расчёт шёл по зашитому значению.
   Каждый случай ниже — пара «базовые параметры / изменённые»: важно не число
   само по себе, а то, что оно ДВИНУЛОСЬ вслед за настройкой.
   -------------------------------------------------------------------------- */
head('11. Настройки правят расчёт, а не только подпись');

const qtySum = (list) => list.reduce((s2, a) => s2 + a.qty, 0);

// 11.1. Маркер рынка UK. Контейнер уезжает на другой рынок ровно по этой
// строке — у другого форвардера в поле стоит «GB», и тогда правило должно
// сработать на «GB», а «UK» перестать что-либо значить.
{
  const marked = mini({
    containers: [
      { ref: 'C-M1', forwarderRef: 'AGL EXW FBA15MARK01', units: 500, eta: '2026-10-01' },
      { ref: 'C-M2', forwarderRef: 'AGL EXW UK FBA15MARK02', units: 700, eta: '2026-10-01' },
      { ref: 'C-M3', forwarderRef: 'AGL EXW GB FBA15MARK03', units: 900, eta: '2026-10-01' },
    ],
  });
  const base = computeAll(marked, PARAMS);
  const withGb = computeAll(marked, { ...PARAMS, ukMarker: 'GB' });
  const baseArrivals = base.items[0].baseline.arrivals;
  const gbArrivals = withGb.items[0].baseline.arrivals;

  check('маркер «UK»: в расчёте DE остаются контейнеры без маркера и с «GB»',
    qtySum(baseArrivals), 1400, 1e-9);
  must('а помеченный «UK» ушёл на другой рынок',
    base.orphanContainers.some((c) => c.id === 'C-M2' && c.market === 'UK'),
    base.orphanContainers.map((c) => `${c.id}:${c.market}`).join(', '));

  check('маркер «GB»: в расчёте DE остаются контейнеры без маркера и с «UK»',
    qtySum(gbArrivals), 1200, 1e-9);
  must('а помеченный «GB» ушёл на другой рынок',
    withGb.orphanContainers.some((c) => c.id === 'C-M3' && c.market === 'UK'),
    withGb.orphanContainers.map((c) => `${c.id}:${c.market}`).join(', '));
  say(`        объём в расчёте DE: маркер UK ${qtySum(baseArrivals)}, маркер GB ${qtySum(gbArrivals)}`);
}

// 11.2. Пропуск родительских строк «Invoice divided». Родитель и его дети
// описывают ОДНУ поставку: учесть всех троих — посчитать её дважды.
{
  const divided = mini({
    containers: [
      { ref: 'C-D0', forwarderRef: 'WM FOB', units: 1000, eta: '2026-10-01', invoiceDivided: true },
      { ref: 'C-D1', forwarderRef: 'WM FOB', units: 600, eta: '2026-10-01', parentRef: 'C-D0' },
      { ref: 'C-D2', forwarderRef: 'WM FOB', units: 400, eta: '2026-10-01', parentRef: 'C-D0' },
    ],
  });
  const skipped = one(divided);
  const counted = one(divided, { ...PARAMS, skipInvoiceDividedParents: false });
  const skipTotal = qtySum(skipped.baseline.arrivals);
  const countTotal = qtySum(counted.baseline.arrivals);

  check('родительская строка пропущена: в расчёт идут только дети', skipTotal, 1000, 1e-9);
  must('и она видна в отброшенных с причиной',
    skipped.baseline.excludedContainers.some((c) => c.id === 'C-D0' && c.reason === 'invoice-divided-parent'),
    skipped.baseline.excludedContainers.map((c) => `${c.id}:${c.reason}`).join(', '));
  check('пропуск выключен — тот же объём посчитан дважды', countTotal, skipTotal * 2, 1e-9);
  say(`        объём поставки: с пропуском ${skipTotal}, без пропуска ${countTotal}`);
}

// 11.3. Датировка контейнера без ETA по статусу «Ready for shipment».
{
  const ready = mini({
    containers: [{ ref: 'C-R1', forwarderRef: 'AGL EXW FBA15READY1', units: 800, status: 'ready-for-shipment', eta: null }],
  });
  const dateOf = (x) => (x.baseline.arrivals.find((a) => a.containerId === 'C-R1') || {}).date;
  const base = dateOf(one(ready));
  const moved = dateOf(one(ready, { ...PARAMS, etaReadyMonths: 1 }));

  check('Ready без ETA: базовые 2.5 месяца от даты расчёта', base, addFM(ASOF, 2.5));
  check('настройка 1 месяц сдвигает дату прибытия', moved, addFM(ASOF, 1));
  must('и дата действительно уехала раньше', cmp(moved, base) < 0, `${moved} против ${base}`);
  say(`        прибытие Ready-контейнера: 2.5 мес → ${base}, 1 мес → ${moved}`);
}

// 11.4. Названия препов в поле назначения. Склад, которого нет ни в одном
// справочнике, попадает в расчёт только через этот список.
{
  const hinted = mini({
    containers: [{ ref: 'C-H1', forwarderRef: 'AGL EXW NORDHALLE BREMEN', units: 400, eta: '2026-10-01' }],
  });
  const unknown = one(hinted);
  const known = one(hinted, { ...PARAMS, prepNameHints: [...PARAMS.prepNameHints, 'Nordhalle'] });
  must('незнакомое название: контейнер отброшен как «назначение неизвестно»',
    unknown.baseline.excludedContainers.some((c) => c.id === 'C-H1' && c.reason === 'unknown-destination'),
    unknown.baseline.excludedContainers.map((c) => `${c.id}:${c.reason}`).join(', '));
  const hit = known.baseline.arrivals.find((a) => a.containerId === 'C-H1');
  must('добавили название в список — контейнер поехал на преп',
    Boolean(hit) && hit.target === 'PREP', hit ? hit.target : 'прихода нет');
  must('и догадка помечена флагом prep-alias-ambiguous',
    flagCodes(known).includes('prep-alias-ambiguous'), flagCodes(known).join(', '));
}

// 11.5. «Прибывшее уже в стоке» (§4.3 против §4.5).
{
  const arrived = mini({
    containers: [{ ref: 'C-A1', forwarderRef: 'AGL EXW FBA15ARRIV1', units: 600, status: 'arrived', eta: null }],
  });
  const inStock = one(arrived);
  const literal = one(arrived, { ...PARAMS, arrivedInStock: false });
  check('прибывший контейнер без строки отчёта не прибавляется к стоку',
    qtySum(inStock.baseline.arrivals), 0, 1e-9);
  check('буквальное прочтение §4.5 везёт его весь',
    qtySum(literal.baseline.arrivals), 600, 1e-9);
}

/* 11.6. Лаг «преп → FBA» берётся у КОНКРЕТНОГО склада.
   Два набора отличаются ровно одним: на каком складе лежит резерв. Лаг WM —
   семь дней, у AsiaLog — сорок пять, и в шестнадцатидневном периоде второй
   не успевает физически. Общий скаляр `prepLagDays` этой разницы не видел:
   карточка склада обещала 45 дней, расчёт применял 7. */
{
  const twoWarehouses = [
    { id: 'prep-wm', kind: 'prep', market: 'DE', name: 'WM / Eichenzell',
      aliases: ['WM FOB'], includedByDefault: true, prepToFbaLagDays: 7 },
    { id: 'prep-asialog', kind: 'prep', market: 'DE', name: 'AsiaLog Shenzhen',
      aliases: ['AsiaLog'], includedByDefault: false, prepToFbaLagDays: 45 },
  ];
  const lagParams = {
    ...PARAMS,
    selectedPrepCenters: { ...PARAMS.selectedPrepCenters, DE: ['WM_EICHENZELL', 'ASIALOG'] },
  };
  const build = (warehouse) => mini({
    sku: 'LAG', available: 100, t30: 1550,
    warehouses: twoWarehouses,
    prep: [{ warehouse, unitsPerCarton: 100, cartons: 50 }],
  });
  const near = one(build('prep-wm'), lagParams);
  const far = one(build('prep-asialog'), lagParams);
  const nearRow = near.baseline.rows[0];
  const farRow = far.baseline.rows[0];

  check('лаг склада-источника: WM — семь дней', nearRow.safetyLagDays, 7);
  check('лаг склада-источника: AsiaLog — сорок пять', farRow.safetyLagDays, 45);
  must('резерв на ближнем складе успевает подстраховать первый период',
    nearRow.safety > 0, `подстраховка ${nearRow.safety}`);
  must('резерв на AsiaLog в тот же период не успевает физически',
    farRow.safety === 0, `подстраховка ${farRow.safety}`);
  must('и нехватка при этом никуда не делась',
    farRow.shortfall > nearRow.shortfall,
    `AsiaLog ${r3(farRow.shortfall)} против WM ${r3(nearRow.shortfall)}`);
  say(`        первый период: WM подстраховал ${Math.round(nearRow.safety)} шт, `
    + `AsiaLog ${Math.round(farRow.safety)} шт при лаге ${farRow.safetyLagDays} дн`);

  // Тот же лаг обязан доехать до карточки склада в результате — раздел
  // показывает именно это число.
  const asialog = (result.markets.find((m) => m.code === 'DE') || { prepCenters: [] })
    .prepCenters.find((c) => c.id === 'ASIALOG');
  check('в результате у AsiaLog действующий лаг 45 дней', asialog ? asialog.lagDays : null, 45);
  check('и он совпадает с числом из демо-данных', asialog ? asialog.dataLagDays : null, 45);
}

/* 11.7. Один хозяин у набора препцентров.
   Раздел «Логистика» и окно «Интеграции» правят один и тот же параметр через
   `togglePrepCenter`. Проверяем сам контракт: запись видна чтением, а справочник
   складов и таблица лагов не расходятся между собой. */
{
  const before = isPrepSelected('DE', 'ASIALOG', DEFAULT_PARAMS);
  must('AsiaLog базово исключён из расчёта', before === false, String(before));
  togglePrepCenter('DE', 'ASIALOG', true);
  must('включение видно через ту же функцию чтения',
    isPrepSelected('DE', 'ASIALOG'), 'значение не записалось');
  must('и не задело набор UK',
    isPrepSelected('UK', 'WEPREP_STOWMARKET'), 'UK потерял свой склад');
  resetParams();
  must('сброс возвращает базовый набор',
    isPrepSelected('DE', 'ASIALOG') === false, 'AsiaLog остался включённым');

  const mismatched = Object.entries(PREP_CENTERS)
    .filter(([id, center]) => DEFAULT_PARAMS.prepLagByCenter[id] !== center.lagDays)
    .map(([id]) => id);
  must('справочник складов и таблица лагов называют одни и те же числа',
    mismatched.length === 0, mismatched.join(', '));
}

/* --------------------------------------------------------------------------
   Итог
   -------------------------------------------------------------------------- */
if (!problems.length) {
  console.log('\nПроблем не найдено');
  process.exit(0);
}
console.log(`\nПРОБЛЕМЫ (${problems.length}):`);
problems.forEach((p, i) => console.log(`${String(i + 1).padStart(3)}. ${p}`));
process.exit(1);
