/* ==========================================================================
   Движок OOS-прогнозирования: чистые расчёты §2, §4–§11 спецификации.

   Модуль намеренно ничего не знает про DOM, localStorage, сеть и локаль:
   на вход данные и параметры, на выход результат. Из-за этого его можно
   импортировать в голом node и сверять числа без jsdom
   (`tools/oos-engine-check.mjs`), а раздел дашборда остаётся тонким.

   Три правила, которые здесь соблюдаются буквально:
   1. Дата расчёта берётся из данных (`asOf`). `Date.now()` в файле нет —
      иначе завтра макет покажет другие числа и регрессионная проверка
      развалится.
   2. Всё считается в ШТУКАХ. Валюта в модели не участвует вообще.
   3. Отсутствие данных — это `null`, а не `0`. «Ноль продаж» и «продажи
      неизвестны» ведут к разным веткам (§12.3), путать их нельзя.

   Даты — календарные строки `YYYY-MM-DD`, разбор только через Date.UTC:
   локальный пояс сдвинул бы `2026-08-15` на сутки западнее Гринвича и
   переложил бы поставки в соседний полупериод.
   ========================================================================== */

import { DEFAULT_PARAMS, normalizeParams, paramsForItem } from './oos-params.js';

const MS_DAY = 86400000;
/** 365.25/12 — средняя длина месяца. Нужна, чтобы «дни» §11.2 стали
    «месяцами», сопоставимыми с порогами 1.5 и 2. */
export const DAYS_PER_MONTH = 30.4375;
const EPS = 1e-9;

/* ==========================================================================
   §0.3. Календарная арифметика
   ========================================================================== */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/** ISO-строка → миллисекунды UTC. Возвращает null на непригодном входе. */
export function dateMs(iso) {
  if (typeof iso !== 'string') return null;
  const m = ISO_RE.exec(iso);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Миллисекунды UTC → ISO-строка `YYYY-MM-DD`. Возвращает null на мусоре. */
export function msDate(ms) {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

export function addDays(iso, n) {
  const ms = dateMs(iso);
  return ms === null ? null : msDate(ms + Math.round(n) * MS_DAY);
}

/**
 * Прибавление календарных месяцев с прижатием к концу месяца:
 * 2026-08-31 + 1 мес = 2026-09-30, а не 2026-10-01.
 */
export function addMonths(iso, n) {
  const ms = dateMs(iso);
  if (ms === null) return null;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth() + Math.trunc(n);
  const day = d.getUTCDate();
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return msDate(Date.UTC(y, mo, Math.min(day, last)));
}

/**
 * Дробные месяцы: целая часть — календарные месяцы, дробная — по 30 дней.
 * Иначе «1.5 месяца» неопределимо: половина февраля и половина июля разные.
 */
export function addFractionalMonths(iso, x) {
  const whole = Math.trunc(x);
  const frac = x - whole;
  return addDays(addMonths(iso, whole), Math.round(frac * 30));
}

/** Число дней в месяце `YYYY-MM`. `null` — если ключ месяца непригоден. */
export function daysInMonth(monthKey) {
  if (typeof monthKey !== 'string') return null;
  const [y, m] = monthKey.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthKey(iso) {
  return typeof iso === 'string' ? iso.slice(0, 7) : null;
}

/**
 * Разница в календарных месяцах между `YYYY-MM` (может быть отрицательной).
 * `null` на непригодном входе: раньше здесь падал весь расчёт, если `asOf`
 * приходил в формате, который не разбирает `dateMs` (§0.1).
 */
export function monthDiff(fromMonth, toMonth) {
  if (typeof fromMonth !== 'string' || typeof toMonth !== 'string') return null;
  const [fy, fm] = fromMonth.split('-').map(Number);
  const [ty, tm] = toMonth.split('-').map(Number);
  if (![fy, fm, ty, tm].every(Number.isFinite)) return null;
  return (ty - fy) * 12 + (tm - fm);
}

export function endOfMonth(iso) {
  const ms = dateMs(iso);
  if (ms === null) return null;
  const d = new Date(ms);
  return msDate(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

/** Число календарных дней от `from` до `to` включительно. `null` на мусоре. */
export function daysBetween(from, to) {
  const a = dateMs(from);
  const b = dateMs(to);
  if (a === null || b === null) return null;
  return Math.round((b - a) / MS_DAY) + 1;
}

/**
 * Сравнение дат. Непригодная дата уезжает в конец сортировки, но НИКОГДА не
 * возвращает NaN: сравнение с NaN тихо ломает и сортировку, и все проверки
 * вида `cmpDate(a, b) < 0`.
 */
export function cmpDate(a, b) {
  const x = dateMs(a);
  const y = dateMs(b);
  if (x === null && y === null) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return x - y;
}

/* §0.5. Округления. Объёмы заказов — всегда вверх до шага рынка: округление
   к ближайшему может урезать объём и оставить порог непокрытым, то есть
   отменить смысл самого заказа. */
export function ceilTo(x, step) {
  if (!(step > 0)) return Math.max(0, x);
  if (!(x > 0)) return 0;
  return Math.ceil(x / step - EPS) * step;
}

export function roundTo(x, step) {
  if (!(step > 0)) return Math.max(0, x);
  if (!(x > 0)) return 0;
  return Math.round(x / step) * step;
}

/* ==========================================================================
   §0.2. Полумесячные периоды
   ========================================================================== */

/** Дата конца горизонта по пресету. `jan` — ближайшее 31 января после asOf. */
export function resolveHorizonEnd(asOf, horizon) {
  if (typeof horizon === 'string' && ISO_RE.test(horizon)) return horizon;
  // Без пригодной даты расчёта горизонт неопределим. Возвращаем null, а не
  // выдуманную дату: пустой список периодов честнее «зелёного хвоста».
  if (dateMs(asOf) === null) return null;

  let preset = horizon;
  if (horizon && typeof horizon === 'object') {
    if (typeof horizon.horizonEnd === 'string' && ISO_RE.test(horizon.horizonEnd)) {
      return horizon.horizonEnd;
    }
    preset = horizon.horizon;
  }
  if (preset === undefined || preset === null) preset = DEFAULT_PARAMS.horizon;

  if (preset === 'jan') {
    const year = Number(asOf.slice(0, 4));
    const candidate = `${year}-01-31`;
    return cmpDate(candidate, asOf) > 0 ? candidate : `${year + 1}-01-31`;
  }
  const months = Number(String(preset).replace('m', ''));
  if (!Number.isFinite(months)) return resolveHorizonEnd(asOf, 'jan');
  return endOfMonth(addMonths(asOf, months));
}

/**
 * Горизонт для расчёта. Приоритет, сверху вниз:
 *   1. явная дата в параметрах (`params.horizonEnd`) — выбор пользователя;
 *   2. пресет, отличный от базового, — тоже выбор пользователя;
 *   3. `horizonEnd` из JSON (§0.1: «горизонт — `horizonEnd` из данных»);
 *   4. базовый пресет.
 *
 * Порядок именно такой, потому что §0.1 отдаёт горизонт данным, а §14 —
 * селектору в UI. Пока пользователь селектор не трогал, побеждают данные;
 * как только тронул — побеждает он.
 */
export function horizonFor(asOf, params, dataHorizonEnd) {
  const p = params && typeof params === 'object' ? params : DEFAULT_PARAMS;
  if (typeof p.horizonEnd === 'string' && ISO_RE.test(p.horizonEnd)) return p.horizonEnd;
  const presetChosen = p.horizon !== undefined && p.horizon !== null
    && p.horizon !== DEFAULT_PARAMS.horizon;
  if (!presetChosen && typeof dataHorizonEnd === 'string' && ISO_RE.test(dataHorizonEnd)) {
    return dataHorizonEnd;
  }
  return resolveHorizonEnd(asOf, p);
}

/**
 * Список полумесячных периодов: H1 = 1–15, H2 = 16–конец месяца.
 *
 * Полумесяц календарный, а не «ровно 15 дней»: контейнеры, заказы и лаг
 * препцентра имеют календарные даты и обязаны попадать в свой столбец.
 * Фиксированные 15 дней за год дали бы дрейф почти на пять дней.
 *
 * `horizon` — пресет ('jan' | '6m' | '9m' | '12m'), готовая дата
 * `YYYY-MM-DD` или объект параметров.
 */
export function halfMonthPeriods(asOf, horizon) {
  const out = [];
  const horizonEnd = resolveHorizonEnd(asOf, horizon);
  // Ни без даты расчёта, ни без горизонта периодов не бывает. Пустой список —
  // штатный ответ: раздел покажет заглушку, а не строку с NaN.
  if (dateMs(asOf) === null || dateMs(horizonEnd) === null) return out;
  const startMonth = monthKey(asOf);
  const endMonth = monthKey(horizonEnd);
  const total = monthDiff(startMonth, endMonth);
  if (total === null || !(total >= 0)) return out;

  for (let i = 0; i <= total; i += 1) {
    const anchor = addMonths(`${startMonth}-01`, i);
    const mk = monthKey(anchor);
    const last = daysInMonth(mk);
    const halves = [
      { half: 'H1', start: `${mk}-01`, end: `${mk}-15` },
      { half: 'H2', start: `${mk}-16`, end: `${mk}-${String(last).padStart(2, '0')}` },
    ];
    for (const h of halves) {
      // Прожитые периоды выбрасываем: спрос до asOf уже сидит внутри снимка стоков.
      if (cmpDate(h.end, asOf) <= 0) continue;
      if (cmpDate(h.start, horizonEnd) > 0) continue;
      const start = cmpDate(h.start, asOf) <= 0 ? addDays(asOf, 1) : h.start;
      const end = cmpDate(h.end, horizonEnd) > 0 ? horizonEnd : h.end;
      out.push({
        id: `${mk}-${h.half}`,
        month: mk,
        half: h.half,
        start,
        end,
        days: daysBetween(start, end),
        // Подпись без языка: раздел переводит её сам, движок локали не знает.
        label: `${start.slice(8)}–${end.slice(8)}.${mk.slice(5)}`,
      });
    }
  }
  return out;
}

/* ==========================================================================
   §2. Стартовый сток FBA
   ========================================================================== */

/**
 * START_FBA = available + fc-transfer + Reserved FC Processing.
 *
 * Не входят: `reservedCustomerOrder` (уже продано покупателю),
 * `unfulfillable` (продать нельзя), AWD (§2.1 — иначе двойной счёт с
 * автопополнением §9.3) и `located` из shipment-отчёта (он уже внутри
 * `available`, §4.5).
 *
 * `row` — либо объект `fbaInventory`/`fba`, либо пара товар×рынок целиком.
 */
export function startFba(row) {
  const fba = row && (row.fbaInventory || row.fba || row);
  if (!fba || typeof fba !== 'object') return 0;
  const num = (v) => (Number.isFinite(v) ? v : 0);
  return num(fba.available) + num(fba.fcTransfer) + num(fba.reservedFcProcessing);
}

/* ==========================================================================
   §5. Базовый run-rate t30
   ========================================================================== */

/**
 * Выбор месяца для режима `lastFullMonth`: если последний полный месяц —
 * максимум из трёх, берём его; иначе среднее трёх. Сравнение нестрогое:
 * при равенстве последний месяц считается максимумом.
 */
export function pickMonth(history) {
  // Месяц без числа продаж выбрасываем целиком: он не «ноль», он «неизвестно»,
  // и в среднем превратил бы результат в NaN, который JSON.stringify потом
  // покажет как null и спрячет ошибку.
  const tail = (history || []).filter((h) => h && Number.isFinite(h.units)).slice(-3);
  if (!tail.length) return { units: null, mode: 'empty' };
  if (tail.length < 3) {
    const avg = tail.reduce((s, h) => s + h.units, 0) / tail.length;
    return { units: avg, mode: 'average', short: true };
  }
  const [m1, m2, m3] = tail;
  if (m3.units >= m2.units && m3.units >= m1.units) {
    return { units: m3.units, mode: 'last', month: m3.month };
  }
  return { units: (m1.units + m2.units + m3.units) / 3, mode: 'average' };
}

/**
 * Базовый t30 до корекции Prime Day. Базовый источник — колонка Units листа
 * SB Sales Units: это прямое измерение последних 30 дней, а не реконструкция.
 * Возвращает `null`, если источник не заполнен вообще — «нет данных» и
 * «нулевые продажи» дают разные ветки (§12.3).
 */
export function baseT30(row, params = DEFAULT_PARAMS) {
  return t30Detail(row, params).units;
}

/**
 * Происхождение t30: какой источник запрошен, какой сработал, каким окном
 * и — для режима «последний полный месяц» — какой месяц взят и почему.
 *
 * Существует потому, что правило §5 («берём последний полный месяц, если он
 * максимум из трёх; иначе среднее за три») до сих пор жило только внутри
 * расчёта. На экране t30 появлялся готовым числом, и проверить его было не
 * по чему: ни источника, ни окна, ни истории продаж.
 *
 * @returns {{requested: string, used: string, units: number|null,
 *            pick: object|null, history: object[], window: object|null}}
 */
export function t30Detail(row, params = DEFAULT_PARAMS) {
  const requested = params.t30Source || 'sbUnits';
  const sales = row && (row.salesT30 !== undefined ? row.salesT30 : row.t30 && row.t30.units);
  const history = (row && row.salesHistory) || [];
  const tail = history.slice(-3);
  const picked = pickMonth(history);
  const window = (row && row.t30Window) || null;
  // Forecast Seller Central раздувает прогноз на разовом всплеске (§7),
  // поэтому используется только по явному выбору и только если задан.
  // Поле переносится в товар нормализацией (`forecastUnits`), иначе выбор
  // в UI молча откатывался бы на SB Sales Units.
  const fc = row && (Number.isFinite(row.forecastUnits) ? row.forecastUnits
    : (row.forecast && row.forecast.units));

  if (requested === 'lastFullMonth' && Number.isFinite(picked.units)) {
    return { requested, used: 'lastFullMonth', units: picked.units, pick: picked, history: tail, window: null };
  }
  if (requested === 'julyForecast' && Number.isFinite(fc)) {
    return { requested, used: 'julyForecast', units: fc, pick: null, history: tail, window: null };
  }
  if (Number.isFinite(sales)) {
    return { requested, used: 'sbUnits', units: sales, pick: null, history: tail, window };
  }
  if (Number.isFinite(picked.units)) {
    // Запрошенный источник пуст — расчёт откатился на историю, и сказать это
    // обязательно: молчаливая подмена источника и есть та ошибка, из-за
    // которой числа «не сходятся с Seller Central».
    return { requested, used: 'lastFullMonth', units: picked.units, pick: picked, history: tail, window: null };
  }
  return { requested, used: 'none', units: null, pick: picked, history: tail, window: null };
}

/* ==========================================================================
   §6. Корекция Prime Day
   ========================================================================== */

/** Полная раскладка корекции — раздел показывает её в подсказке. */
export function primeDayDetail(t30, pdUnits, params = DEFAULT_PARAMS) {
  const mode = params.primeDayMode || 'excess';
  const base = Number.isFinite(t30) ? t30 : null;
  const pd = Number.isFinite(pdUnits) ? pdUnits : 0;
  const flags = [];

  if (base === null) return { t30: null, adjusted: null, normalDaily: null, excess: null, mode, flags };
  if (mode === 'off' || pd <= 0) {
    return { t30: base, adjusted: base, normalDaily: base / 30, excess: 0, mode, flags };
  }

  const normalDaily = base / 30;
  // excess зажимается снизу нулём: корекция создана убирать всплеск, а
  // вычитание отрицательного числа увеличило бы t30 — обратное её смыслу.
  // К тому же normalDaily выведено из t30, который сам содержит дни PD,
  // то есть систематически завышено.
  const excess = mode === 'full' ? pd : Math.max(0, pd - 4 * normalDaily);
  let adjusted = base - excess;

  if (adjusted <= 0 && base > 0) {
    // Возможно только на битых данных (PD больше всего месячного объёма).
    // Обнулять живой товар нельзя — оставляем t30 и помечаем флагом.
    adjusted = base;
    flags.push({ code: 'prime-day-exceeds-t30', level: 'warning' });
  }
  return { t30: base, adjusted, normalDaily, excess, mode, flags };
}

/** t30 после корекции Prime Day (§6). */
export function primeDayAdjust(t30, pdUnits, params = DEFAULT_PARAMS) {
  return primeDayDetail(t30, pdUnits, params).adjusted;
}

/* ==========================================================================
   §7. Рост спроса
   ========================================================================== */

/** Раскладка роста: сырое среднее, зажатое значение, признак зажатия. */
export function growthDetail(history, params = DEFAULT_PARAMS) {
  const mode = params.growthMode || 'individual';
  const min = Number.isFinite(params.growthMin) ? params.growthMin : DEFAULT_PARAMS.growthMin;
  const max = Number.isFinite(params.growthMax) ? params.growthMax : DEFAULT_PARAMS.growthMax;
  const flags = [];

  if (mode === 'flat') return { value: 1, raw: null, clamped: false, ratios: [], mode, flags };
  if (mode === 'fixed') {
    const fixed = Number.isFinite(params.growthFixed) ? params.growthFixed : DEFAULT_PARAMS.growthFixed;
    return { value: fixed, raw: fixed, clamped: false, ratios: [], mode, flags };
  }

  const rows = (history || []).filter((h) => h && Number.isFinite(h.units));
  const ratios = [];
  for (let i = 1; i < rows.length; i += 1) {
    // Нулевой знаменатель выбрасываем: иначе бесконечность утащит среднее.
    if (rows[i - 1].units > 0) ratios.push(rows[i].units / rows[i - 1].units);
  }
  if (rows.length < 3) flags.push({ code: 'history-too-short', level: 'warning' });
  if (!ratios.length) return { value: 1, raw: null, clamped: false, ratios, mode, flags };

  // Среднее арифметическое — так буквально сформулировано в методичке.
  // Геометрическое корректнее для компаундинга, но это была бы правка
  // спецификации, а не её прочтение.
  const raw = ratios.reduce((s, r) => s + r, 0) / ratios.length;
  const value = Math.min(Math.max(raw, min), max);
  // Зажим применяется К СРЕДНЕМУ, а не к каждому отношению до усреднения:
  // поштучный зажим стёр бы величину выброса и смещал бы среднее вверх
  // на падающих товарах.
  if (Math.abs(value - raw) > EPS) flags.push({ code: 'growth-clamped', level: 'info', raw });
  return { value, raw, clamped: Math.abs(value - raw) > EPS, ratios, mode, flags };
}

/** Коэффициент месячного роста, зажатый в [growthMin, growthMax]. */
export function growthRate(history, params = DEFAULT_PARAMS) {
  return growthDetail(history, params).value;
}

/* ==========================================================================
   §0.4. Кривая спроса
   ========================================================================== */

/**
 * Модель спроса: месячная величина `t30_adj`, растущая на `growth` за месяц
 * и растянутая по календарным дням.
 *
 * Кривая определена и ЗА горизонтом — `forwardDemand` в январе свободно
 * считает февраль–март. Обрезание по горизонту занизило бы пороги в
 * последних периодах и нарисовало бы «зелёный хвост», самый опасный вид
 * ложноотрицательного результата.
 *
 * Порядок «сначала Prime Day, потом рост» обязателен: иначе рост умножал бы
 * артефакт распродажи на каждый следующий месяц.
 */
export function demandByPeriod(t30, growth, periods, asOf) {
  const base = Number.isFinite(t30) ? t30 : 0;
  const g = Number.isFinite(growth) ? growth : 1;
  const anchor = monthKey(asOf || (periods && periods[0] && periods[0].start) || '1970-01-01');
  const monthCache = new Map();

  const month = (mk) => {
    let v = monthCache.get(mk);
    if (v === undefined) {
      const diff = monthDiff(anchor, mk);
      // Непригодный ключ месяца — это отсутствие спроса, а не NaN: одна
      // битая дата не имеет права утащить в NaN весь баланс периода.
      v = diff === null ? 0 : base * Math.pow(g, diff);
      monthCache.set(mk, v);
    }
    return v;
  };
  // Мемоизация по дню обязательна: планирование заказов гоняет симуляцию
  // заново на каждый период каждого прохода, и один и тот же день считается
  // десятки раз. Без кэша полный пересчёт демо-набора занимает вчетверо больше.
  const dayCache = new Map();
  const day = (iso) => {
    let v = dayCache.get(iso);
    if (v === undefined) {
      const mk = monthKey(iso);
      const len = daysInMonth(mk);
      v = len ? month(mk) / len : 0;
      dayCache.set(iso, v);
    }
    return v;
  };
  const range = (fromExclusive, toInclusive) => {
    let sum = 0;
    let d = addDays(fromExclusive, 1);
    if (d === null || dateMs(toInclusive) === null) return 0;
    while (cmpDate(d, toInclusive) <= 0) {
      sum += day(d);
      d = addDays(d, 1);
    }
    return sum;
  };

  const list = (periods || []).map((p) => ({
    id: p.id,
    units: range(addDays(p.start, -1), p.end),
  }));

  return {
    t30: base,
    growth: g,
    baseMonth: anchor,
    month,
    day,
    range,
    periods: list,
    // Список периодов кладём рядом с кривой: forwardDemand(i, …) должен
    // уметь найти конец периода, не получая periods третьим аргументом.
    periodsMeta: periods || [],
    units: list.map((p) => p.units),
    total: list.reduce((s, p) => s + p.units, 0),
  };
}

/** Спрос на `months` месяцев вперёд от даты (не от периода). */
export function forwardDemandFrom(fromDate, months, demand) {
  if (!(months > 0) || dateMs(fromDate) === null) return 0;
  return demand.range(fromDate, addFractionalMonths(fromDate, months));
}

/**
 * Forward-спрос от КОНЦА периода с индексом `periodIndex`, с учётом роста.
 * Именно на нём стоят оба порога (§8), поэтому порог в ноябре выше
 * ноябрьского спроса: впереди пиковый сезон.
 */
export function forwardDemand(periodIndex, months, demand, periods) {
  const list = periods || demand.periodsMeta;
  const from = typeof periodIndex === 'string'
    ? periodIndex
    : (list && list[periodIndex] ? list[periodIndex].end : null);
  if (from === null) return 0;
  return forwardDemandFrom(from, months, demand);
}

/* ==========================================================================
   §3.3, §4. Склады и классификация контейнеров
   ========================================================================== */

/** upper + схлопывание всего, что не буква и не цифра, в пробел. */
export function normalizeName(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^0-9A-ZÀ-ɏ]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/* Канонические имена препцентров и их алиасы (§3.3) живут в параметрах
   (`params.prepAliases`), а не константой здесь: тот же справочник правится
   в разделе «Интеграции», и пока движок носил свою копию, подпись под полем
   алиасов обещала влияние на расчёт, которого не было.

   WM Warehouse = WM FOB = EXW WM — это один склад: разные Инкотермс в
   forwarder-поле не означают разных складов.

   Кэш нужен, потому что таблица разбирается на каждый товар, а параметры
   внутри одного `computeAll` — один и тот же объект. WeakMap, а не Map:
   параметры пересобираются на каждый `getParams()`, и обычная карта росла бы
   вместе с числом перерисовок. */
const aliasCache = new WeakMap();

function aliasIndex(params) {
  const table = (params && params.prepAliases) || DEFAULT_PARAMS.prepAliases;
  const generics = (params && params.prepGenericNames) || DEFAULT_PARAMS.prepGenericNames;
  const hints = (params && params.prepNameHints) || DEFAULT_PARAMS.prepNameHints;
  const cached = aliasCache.get(table);
  if (cached && cached.generics === generics && cached.hints === hints) return cached;

  // Алиасы приводятся к нормальному виду ЗДЕСЬ, а не в настройках: в поле
  // человек пишет «WM Warehouse», а сравнивается это с нормализованной
  // forwarder-строкой. Требовать от него верхнего регистра значило бы
  // превратить настройку в ловушку.
  const byId = new Map();
  const canonByName = new Map();
  for (const [id, list] of Object.entries(table)) {
    const norm = (Array.isArray(list) ? list : [])
      .map(normalizeName).filter(Boolean);
    byId.set(id, norm);
    canonByName.set(normalizeName(id), id);
  }
  const generic = new Set((Array.isArray(generics) ? generics : []).map(normalizeName).filter(Boolean));
  /* Подсказки «это на преп» из настроек. Отличие от родовых слов: подсказка,
     которую назвал своим именем конкретный склад, ведёт к этому складу, а не
     в «догадались». Поэтому список тут отдельный. */
  const hintNames = new Set([
    ...generic,
    ...(Array.isArray(hints) ? hints : []).map(normalizeName).filter(Boolean),
  ]);
  const index = { table, generics, hints, byId, canonByName, generic, hintNames };
  aliasCache.set(table, index);
  return index;
}

/** Идентификатор склада из данных ('prep-wm', 'WM / Eichenzell') → канон. */
export function canonicalPrepId(raw, aliases, params = DEFAULT_PARAMS) {
  const norm = normalizeName(raw);
  if (!norm) return null;
  const index = aliasIndex(params);
  // Канон, записанный как есть ('WM_EICHENZELL'): подчёркивания нормализация
  // превращает в пробелы, поэтому сверяемся по нормализованному ключу.
  if (index.canonByName.has(norm)) return index.canonByName.get(norm);
  const extra = Array.isArray(aliases) ? aliases.map(normalizeName) : [];
  for (const [id, list] of index.byId) {
    if (list.includes(norm)) return id;
    if (extra.some((a) => list.includes(a))) return id;
  }
  // Неизвестный склад: канон = нормализованное имя. Так он останется
  // видимым в UI и в флагах, а не исчезнет из расчёта молча.
  return norm.replace(/ /g, '_');
}

/** Таблица алиасов для поиска склада внутри forwarder-строки. */
function buildPrepMatcher(prepCenters, params = DEFAULT_PARAMS) {
  const index = aliasIndex(params);
  const entries = [];
  const push = (id, alias) => {
    const norm = normalizeName(alias);
    if (!norm) return;
    if (entries.some((e) => e.alias === norm && e.id === id)) return;
    entries.push({ id, alias: norm, generic: index.generic.has(norm) });
  };
  for (const [id, list] of index.byId) for (const alias of list) push(id, alias);
  for (const center of prepCenters || []) {
    for (const alias of [center.name, center.dataId, ...(center.aliases || [])]) push(center.id, alias);
  }
  // Название, которое не назвал ни один склад, всё равно признак «на преп»:
  // без него контейнер уехал бы в «назначение неизвестно».
  for (const alias of index.hintNames) {
    if (!entries.some((e) => e.alias === alias)) push(null, alias);
  }
  // Длинные алиасы первыми: «LAGER KASTELLAUN» обязан выиграть у «LAGER».
  entries.sort((a, b) => b.alias.length - a.alias.length);
  return entries;
}

const SHIPMENT_RE = /FBA[0-9A-Z]{6,}/;
const SHIPMENT_RE_ALL = /FBA[0-9A-Z]{6,}/g;

/* Маркер рынка UK берётся из параметров (`params.ukMarker`): у другого
   форвардера в поле стоит «GB», «UK-LON» или вообще ничего. Регулярное
   выражение собирается по строке и кэшируется — строится оно на каждый
   контейнер, а маркер за прогон не меняется.

   Границы намеренно `[^A-Z]`, а не `\b`: forwarder-строка нормализована до
   букв, цифр и пробелов, и «UK» внутри цифробуквенного хвоста маркером не
   считается. */
const markerCache = new Map();

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ukMarkerRe(marker) {
  const norm = normalizeName(marker === undefined ? DEFAULT_PARAMS.ukMarker : marker);
  if (!norm) return null;             // пустой маркер — рынок по маркеру не ищем
  if (!markerCache.has(norm)) {
    markerCache.set(norm, new RegExp(`(^|[^A-Z])${escapeRe(norm)}([^A-Z]|$)`));
  }
  return markerCache.get(norm);
}

/**
 * Ключ отправки. Колонка shipment-отчёта и forwarder-поле контейнера пишутся
 * людьми по-разному (`FBA15ABCDEF-1` против `AGL EXW FBA15ABCDEF`), поэтому
 * обе стороны приводятся к одному виду — к самому идентификатору. Раньше
 * ключом была вся нормализованная строка колонки, и такая отправка не
 * находилась: контейнер брал свои `units`, а строка отчёта приезжала вторым
 * приходом — тот же товар считался дважды.
 */
export function shipmentKey(value) {
  const norm = normalizeName(value);
  if (!norm) return null;
  const m = SHIPMENT_RE.exec(norm);
  return m ? m[0] : norm;
}

/** Приводит статус из любого источника к внутреннему набору. */
export function normalizeStatus(status) {
  const s = normalizeName(status);
  if (s === 'ARRIVED') return 'arrived';
  if (s === 'READY FOR SHIPMENT' || s === 'READY') return 'ready';
  if (s === 'IN PRODUCE' || s === 'IN PRODUCTION') return 'in-produce';
  if (s === 'IN TRANSIT' || s === 'SCHEDULED') return 'in-transit';
  return s ? s.toLowerCase().replace(/ /g, '-') : 'unknown';
}

/**
 * Рынок контейнера: UK-маркер в forwarder-поле или рынок по умолчанию.
 *
 * Shipment ID вырезается ДО проверки. Идентификаторы Amazon — случайные
 * буквенно-цифровые строки, и сочетание «цифра-UK-цифра» в них встречается
 * (`FBA15UK7T2P4`). Без вырезания такой DE-контейнер молча уезжал на UK и
 * исчезал из расчёта DE вместе со всем своим объёмом.
 */
export function detectContainerMarket(forwarder, defaultMarket = 'DE', ukMarket = 'UK', marker) {
  const re = ukMarkerRe(marker);
  if (!re) return defaultMarket;
  const norm = normalizeName(forwarder).replace(SHIPMENT_RE_ALL, ' ');
  return re.test(norm) ? ukMarket : defaultMarket;
}

/**
 * §4. Классификация контейнеров: рынок, назначение, дата, количество.
 *
 * `market` — контекст рынка:
 *   { code, asOf, shipments, prepCenters, selectedPrepCenters, defaultPrepId, defaultMarket }
 * Строкой тоже принимается, тогда asOf берётся из `params.asOf`.
 *
 * Рынок и назначение определяются НЕЗАВИСИМО: строка `AGL EXW UK FBA15…`
 * — это UK-рынок и назначение FBA одновременно. UK-маркер отвечает «в какую
 * страну», Shipment ID против имени препа — «на какой склад».
 */
export function classifyContainers(containers, market, params = DEFAULT_PARAMS) {
  const ctx = typeof market === 'string' ? { code: market } : (market || {});
  const asOf = ctx.asOf || params.asOf;
  const code = ctx.code;
  const defaultMarket = ctx.defaultMarket || 'DE';
  const prepCenters = ctx.prepCenters || [];
  const selected = new Set(ctx.selectedPrepCenters
    || (params.selectedPrepCenters && params.selectedPrepCenters[code])
    || []);
  const defaultPrepId = ctx.defaultPrepId
    || (prepCenters[0] && prepCenters[0].id)
    || null;
  const matcher = buildPrepMatcher(prepCenters, params);
  // Строки отчёта складываются по ключу отправки: одна отправка вполне может
  // быть выгружена несколькими строками (§4.2), и тогда её остаток — сумма.
  const shipments = new Map();
  for (const sh of ctx.shipments || []) {
    const key = shipmentKey(sh.shipmentId);
    if (!key) continue;
    const prev = shipments.get(key);
    if (prev) {
      prev.expected += num(sh.expected, 0);
      prev.located += num(sh.located, 0);
      if (!prev.expectedArrival) prev.expectedArrival = sh.expectedArrival || null;
      prev.rows.push(sh);
    } else {
      shipments.set(key, {
        key,
        expected: num(sh.expected, 0),
        located: num(sh.located, 0),
        expectedArrival: sh.expectedArrival || null,
        taken: 0,
        rows: [sh],
      });
    }
  }

  const arrivals = [];
  const excluded = [];
  const flags = [];

  for (const raw of containers || []) {
    const id = raw.id || raw.ref || null;
    const forwarder = raw.forwarder || raw.forwarderRef || '';
    const norm = normalizeName(forwarder);
    const status = normalizeStatus(raw.status);
    const units = Number.isFinite(raw.units) ? raw.units : 0;

    // 0. Родительская строка «Invoice divided»: её дочерние записи лежат в
    // листе отдельно, учёт родителя удвоил бы весь объём. Правило
    // выключаемое (`params.skipInvoiceDividedParents`): у форвардера, который
    // дочерние строки не выгружает, пропуск родителя терял бы поставку.
    if (raw.invoiceDivided === true && params.skipInvoiceDividedParents !== false) {
      excluded.push({ id, reason: 'invoice-divided-parent', units, forwarder });
      continue;
    }

    // 2–3. Рынок.
    const containerMarket = detectContainerMarket(norm, defaultMarket, ctx.ukMarket || 'UK', params.ukMarker);
    if (code && containerMarket !== code) {
      // Флаг обязателен: объём уходит из расчёта этого рынка целиком, и
      // оператор должен видеть, куда он делся.
      flags.push({ code: 'container-other-market', level: 'info', containerId: id, market: containerMarket });
      excluded.push({ id, reason: 'other-market', market: containerMarket, units, forwarder });
      continue;
    }

    // 4. Назначение.
    const shipmentMatch = SHIPMENT_RE.exec(norm);
    let target = null;
    let shipmentId = null;
    let prepId = null;
    if (shipmentMatch) {
      target = 'FBA';
      shipmentId = shipmentMatch[0];
    } else {
      const hit = matcher.find((e) => new RegExp(`(^| )${escapeRe(e.alias)}( |$)`).test(norm));
      if (hit) {
        target = 'PREP';
        prepId = hit.id;
        if (hit.generic || !hit.id) {
          // «Lager» — родовое немецкое «склад», а не имя (список родовых слов
          // задаёт `params.prepGenericNames`). Признак «на преп» есть,
          // конкретика потеряна: подставляем преп рынка по умолчанию и делаем
          // догадку видимой оператору.
          prepId = defaultPrepId || hit.id;
          flags.push({ code: 'prep-alias-ambiguous', level: 'info', containerId: id });
        }
        // Родовое слово, а склада по умолчанию нет: адресата не существует,
        // и придумывать его нельзя — контейнер уходит в «назначение неизвестно».
        if (!prepId) target = null;
      }
    }
    if (!target) {
      flags.push({ code: 'container-unknown-destination', level: 'warning', containerId: id, forwarder });
      excluded.push({ id, reason: 'unknown-destination', units, forwarder });
      continue;
    }

    // 5. Исключённый препцентр: контейнер игнорируется целиком, а не
    // переносится на другой склад (§3.4).
    if (target === 'PREP' && !selected.has(prepId)) {
      flags.push({ code: 'container-excluded-prep', level: 'info', containerId: id, prepId });
      excluded.push({ id, reason: 'excluded-prep', prepId, units, forwarder });
      continue;
    }

    // 6. Дата прибытия (§4.4).
    const eta = typeof raw.eta === 'string' && ISO_RE.test(raw.eta) ? raw.eta : null;
    const etaPast = eta !== null && cmpDate(eta, asOf) <= 0;
    const alreadyHere = status === 'arrived' || etaPast;
    let date;
    let derived = false;
    if (eta && !etaPast) {
      date = eta;
    } else if (status === 'ready') {
      date = addFractionalMonths(asOf, params.etaReadyMonths);   // только доставка
      derived = true;
    } else if (status === 'in-produce') {
      date = addFractionalMonths(asOf, params.etaInProduceMonths); // производство + доставка
      derived = true;
    } else if (alreadyHere) {
      date = addDays(asOf, params.etaArrivedDays);                // чек-ин на FC
      derived = true;
    } else if (status === 'in-transit') {
      // 'In transit' без ETA ведём как готовую к отгрузке партию и помечаем.
      date = addFractionalMonths(asOf, params.etaReadyMonths);
      derived = true;
    } else {
      // Статус не из набора §4.4 ('Delayed', 'Customs', пустое поле). Раньше
      // такой контейнер получал самое оптимистичное правило — «как Ready,
      // +2.5 мес» — и появлялся в конвейере на полтора месяца раньше срока.
      // Датируем консервативно, как «в производстве», и делаем догадку
      // видимой отдельным предупреждением.
      date = addFractionalMonths(asOf, params.etaInProduceMonths);
      derived = true;
      flags.push({ code: 'container-status-unknown', level: 'warning', containerId: id, status });
    }
    // Флаг ставится РОВНО один раз: раньше нераспознанный статус получал его
    // дважды и удваивал счётчик предупреждений о качестве данных.
    if (derived) flags.push({ code: 'eta-derived-from-status', level: 'info', containerId: id, status });

    // 7. Количество (§4.5).
    let qty;
    if (target === 'FBA') {
      const sh = shipments.get(shipmentId);
      if (sh) {
        // `located` уже сидит в available: в дороге числится только разница.
        // Остаток отправки списывается ОДИН раз на все контейнеры с этим
        // Shipment ID: одна отправка, физически разложенная по двум
        // контейнерам, иначе начислялась бы каждому и удваивала объём.
        const rest = Math.max(0, sh.expected - sh.located - sh.taken);
        qty = units > 0 ? Math.min(rest, units) : rest;
        sh.taken += qty;
      } else if (alreadyHere && params.arrivedInStock !== false) {
        // Прибывший контейнер без строки отчёта. Спецификация тут спорит сама
        // с собой: §4.5 велит считать `located` нулём и везти весь объём,
        // §4.3 — что прибывшее уже сидит в `available`. Выбран §4.3: без
        // строки отчёта нечекнутый хвост неизвестен, а прибавить весь объём
        // поверх стартового стока значит посчитать его дважды — ошибка в
        // опасную сторону. Хвост появляется ровно тогда, когда строка отчёта
        // есть и в ней `expected > located`. Выключение `arrivedInStock`
        // возвращает буквальное прочтение §4.5 — ветка ниже.
        qty = 0;
        flags.push({ code: 'shipment-row-missing', level: 'warning', containerId: id, shipmentId });
      } else {
        qty = units;
        flags.push({ code: 'shipment-row-missing', level: 'warning', containerId: id, shipmentId });
      }
    } else {
      // Прибывший на преп уже посчитан в «штук в коробке × коробок».
      qty = (alreadyHere && params.arrivedInStock !== false) ? 0 : units;
    }

    arrivals.push({
      containerId: id,
      date,
      qty,
      target,
      source: 'pipeline',
      status,
      prepId,
      shipmentId,
      market: containerMarket,
      etaGiven: eta,
      etaDerived: derived,
      // Ускорять имеет смысл только то, что ещё не отгружено (§10.4).
      expedite: status === 'ready' || status === 'in-produce',
      units,
    });
  }

  // Остатки отправок, которые не разобрал ни один контейнер, — это тоже
  // товар в дороге (лист отчёта и лист контейнеров выгружаются отдельно и не
  // обязаны сходиться строка в строку). Не учесть их значило бы потерять
  // поставку; учесть дважды — нарисовать несуществующий запас.
  for (const sh of shipments.values()) {
    const qty = Math.max(0, sh.expected - sh.located - sh.taken);
    if (qty <= 0) continue;
    const key = sh.key;
    const planned = typeof sh.expectedArrival === 'string' && ISO_RE.test(sh.expectedArrival)
      ? sh.expectedArrival : null;
    const date = planned && cmpDate(planned, asOf) > 0 ? planned : addDays(asOf, params.etaArrivedDays);
    arrivals.push({
      containerId: null,
      date,
      qty,
      target: 'FBA',
      source: 'shipment',
      status: 'in-transit',
      prepId: null,
      shipmentId: key,
      market: code,
      etaGiven: planned,
      etaDerived: !planned,
      expedite: false,
      units: qty,
    });
  }

  arrivals.sort((a, b) => cmpDate(a.date, b.date) || String(a.containerId).localeCompare(String(b.containerId)));
  return { arrivals, excluded, flags };
}

/* ==========================================================================
   Нормализация входных данных

   Поддерживаются две формы: демо-JSON `data/oos-demo.json` (плоские списки
   markets/warehouses/products/containers) и форма §0.6 спецификации
   (markets как объект с вложенными products). Форма выбирается по типу
   `data.markets`: движок не должен зависеть от того, кто сегодня собрал файл.
   ========================================================================== */

function num(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Лаг «преп → FBA» конкретного склада (§9.4).
 *
 * Порядок: параметр по складу > число из данных > общий `prepLagDays`.
 * Тот же порядок, что у шага округления (§14): настройка главнее файла,
 * файл — запасной вариант. Скаляр остался последним рубежом для склада,
 * которого нет ни в справочнике, ни в данных.
 */
export function prepLagFor(prepId, dataLagDays, params = DEFAULT_PARAMS) {
  const table = params.prepLagByCenter || DEFAULT_PARAMS.prepLagByCenter || {};
  const byParam = prepId ? table[prepId] : null;
  const value = Number.isFinite(byParam) ? byParam
    : (Number.isFinite(dataLagDays) ? dataLagDays : num(params.prepLagDays, 7));
  return Math.max(0, Math.round(value));
}

function prepCenterList(data, marketCode, params = DEFAULT_PARAMS) {
  const out = [];
  if (Array.isArray(data.warehouses)) {
    for (const w of data.warehouses) {
      if (w.kind !== 'prep' || w.market !== marketCode) continue;
      const id = canonicalPrepId(w.id, [w.name, ...(w.aliases || [])], params);
      out.push({
        id,
        dataId: w.id,
        name: w.name,
        aliases: w.aliases || [],
        market: w.market,
        // `lagDays` — действующее число, `dataLagDays` — то, что стояло в
        // файле. Раздел показывает первое, а расхождение со вторым — повод
        // объяснить оператору, откуда взялась разница.
        lagDays: prepLagFor(id, num(w.prepToFbaLagDays, null), params),
        dataLagDays: num(w.prepToFbaLagDays, null),
        defaultSelected: w.includedByDefault !== false,
        note: w.note || null,
      });
    }
  }
  return out;
}

/**
 * Единый внутренний вид данных. Чистая функция, вход не мутируется.
 *
 * `params` нужны здесь потому, что уже на этом шаге читаются правила §4:
 * имя колонки назначения, маркер рынка UK и таблица алиасов складов. Раньше
 * они были константами движка, и раздел «Интеграции» правил их вхолостую.
 */
export function normalizeData(data, params = DEFAULT_PARAMS) {
  if (!data || typeof data !== 'object') {
    return { asOf: null, horizonEnd: null, markets: [], items: [], containers: [], flags: [] };
  }
  const asOf = data.asOf || null;
  const horizonEnd = data.horizonEnd || (data.horizon && data.horizon.to) || null;
  const markets = [];
  const items = [];
  const containers = [];
  const flags = [];

  /* Колонка назначения задаётся настройкой: у каждого форвардера она своя, а
     имя «Container number in forwarder system» — из файла конкретного. Своё
     имя ищется первым, `forwarder`/`forwarderRef` остаются запасными: демо-
     JSON и форма §0.6 пишут именно их. */
  const field = typeof params.forwarderField === 'string' ? params.forwarderField : '';
  const forwarderOf = (raw) => {
    const byField = field && typeof raw[field] === 'string' ? raw[field] : '';
    return byField || raw.forwarder || raw.forwarderRef || '';
  };

  const pushContainers = (list, sku) => {
    for (const raw of list || []) {
      containers.push({
        id: raw.id || raw.ref || null,
        sku: raw.sku || sku || null,
        forwarder: forwarderOf(raw),
        units: num(raw.units, 0),
        status: raw.status || null,
        eta: raw.eta || null,
        invoiceDivided: raw.invoiceDivided === true,
        parentRef: raw.parentRef || null,
        supplier: raw.supplier || null,
      });
    }
  };

  const makeItem = (product, marketCode, pair, market) => {
    const prep = (pair.prep || []).map((row) => {
      const dataId = row.warehouse || row.location || row.id;
      const known = market.prepCenters.find((c) => c.dataId === dataId
        || c.id === canonicalPrepId(dataId, null, params));
      const units = Number.isFinite(row.units)
        ? row.units
        : num(row.unitsPerCarton, 0) * num(row.cartons, 0);
      return {
        id: known ? known.id : canonicalPrepId(dataId, null, params),
        dataId: dataId || null,
        name: known ? known.name : (row.name || dataId || null),
        unitsPerCarton: Number.isFinite(row.unitsPerCarton) ? row.unitsPerCarton : null,
        cartons: Number.isFinite(row.cartons) ? row.cartons : null,
        units,
      };
    });
    const t30Raw = pair.t30 && Number.isFinite(pair.t30.units) ? pair.t30.units
      : (Number.isFinite(pair.salesT30) ? pair.salesT30 : null);
    return {
      key: `${marketCode}:${product.sku}`,
      sku: product.sku,
      asin: product.asin || null,
      category: product.category || null,
      title: product.title || null,
      market: marketCode,
      marketplace: market.domain || market.marketplace || null,
      // Горизонт из данных едет вместе с товаром: `prepareItem` вызывают и
      // напрямую, без `computeAll`, и там взять его больше неоткуда.
      horizonEnd,
      locale: market.locale || null,
      accent: market.accent || null,
      roundingStep: market.roundingStep,
      prepCenters: market.prepCenters,
      sellerSku: pair.sellerSku || null,
      reportTitle: pair.reportTitle || pair.title || null,
      // Флаг листинга сохраняем как есть: движок перепроверяет активность
      // сам (§12.3) и обязан уметь показать расхождение, а не поверить.
      listedActive: pair.active !== false,
      asOf,
      fba: pair.fba || pair.fbaInventory || null,
      awdUnits: num(pair.awd && pair.awd.units, 0),
      prep,
      // Отсутствие данных о продажах — null, ноль продаж — 0. Разные ветки.
      salesT30: t30Raw,
      // Прогноз Seller Central — альтернативный источник t30 (§15, пункт 3).
      // Без переноса в товар выбор `t30Source: 'julyForecast'` молча
      // откатывался бы на SB Sales Units.
      forecastUnits: Number.isFinite(pair.forecastUnits) ? pair.forecastUnits
        : num(pair.forecast && pair.forecast.units, null),
      t30Window: pair.t30 && pair.t30.windowFrom ? { from: pair.t30.windowFrom, to: pair.t30.windowTo } : null,
      primeDayUnits: num(pair.primeDay && pair.primeDay.units, num(pair.primeDayUnits, 0)),
      primeDayWindow: pair.primeDay && pair.primeDay.from ? { from: pair.primeDay.from, to: pair.primeDay.to } : null,
      salesHistory: (pair.salesHistory || []).filter((h) => h && Number.isFinite(h.units)),
      shipments: pair.shipments || [],
      notes: pair.notes || product.notes || [],
      containers: [],
    };
  };

  if (Array.isArray(data.markets)) {
    for (const m of data.markets) {
      markets.push({
        code: m.code,
        domain: m.domain || null,
        marketplaceId: m.marketplaceId || null,
        locale: m.locale || null,
        currency: m.currency || null,
        accent: m.accent || null,
        reportLanguage: m.reportLanguage || null,
        // Именно null, а не 1: «шаг в данных не задан» и «шаг равен единице» —
        // разные вещи, и подстановка единицы отменяла бы шаг из параметров.
        roundingStep: num(m.orderRounding, num(m.roundingStep, null)),
        prepCenters: prepCenterList(data, m.code, params),
      });
    }
    for (const product of data.products || []) {
      for (const [code, pair] of Object.entries(product.markets || {})) {
        const market = markets.find((x) => x.code === code);
        if (!market) continue;
        items.push(makeItem(product, code, pair, market));
      }
      pushContainers(product.containers, product.sku);
    }
    pushContainers(data.containers, null);
  } else if (data.markets && typeof data.markets === 'object') {
    for (const [code, m] of Object.entries(data.markets)) {
      markets.push({
        code,
        domain: m.marketplace || m.domain || null,
        marketplaceId: m.marketplaceId || null,
        locale: m.locale || null,
        currency: m.currency || null,
        accent: m.accent || null,
        reportLanguage: m.titleLang || m.reportLanguage || null,
        roundingStep: num(m.roundingStep, num(m.orderRounding, null)),
        prepCenters: (m.prepCenters || []).map((c) => {
          const id = canonicalPrepId(c.id, [c.name], params);
          return {
            id,
            dataId: c.id,
            name: c.name,
            aliases: c.aliases || [],
            market: code,
            lagDays: prepLagFor(id, num(c.prepToFbaLagDays, null), params),
            dataLagDays: num(c.prepToFbaLagDays, null),
            defaultSelected: c.defaultSelected !== false,
            note: c.note || null,
          };
        }),
      });
      for (const product of m.products || []) {
        const market = markets[markets.length - 1];
        items.push(makeItem(product, code, product, market));
        pushContainers(product.containers, product.sku);
      }
    }
    pushContainers(data.containers, null);
  } else {
    flags.push({ code: 'no-markets', level: 'error' });
  }

  // Контейнеры раскладываются по паре товар×рынок здесь, а не в данных:
  // рынок выводится из forwarder-строки (§4.1), и предварительная раскладка
  // отменила бы саму ветку классификации.
  const defaultMarket = (markets.find((m) => m.code !== 'UK') || markets[0] || {}).code || 'DE';
  const ukCode = (markets.find((m) => m.code === 'UK') || {}).code || 'UK';
  const orphanContainers = [];
  for (const c of containers) {
    const marketCode = detectContainerMarket(c.forwarder, defaultMarket, ukCode, params.ukMarker);
    const record = { ...c, market: marketCode };
    const own = items.find((it) => it.sku === c.sku && it.market === marketCode);
    if (own) own.containers.push(record);
    else orphanContainers.push({ ...record, reason: 'no-item' });

    /* §4 симметричен: «UK в forwarder-поле = отправка в Англию, для
       DE-расчёта исключается (и наоборот для UK)». Значит пара того же
       товара на ЧУЖОМ рынке обязана видеть эту строку — и отбросить её с
       причиной «контейнер другого рынка».

       Раньше контейнер раскладывался по рынку прямо здесь, и до
       `classifyContainers` чужая строка не доходила вовсе: ветка
       `other-market` была недостижима, флаг `container-other-market` не
       возникал ни разу, а из карточки DE:SQ1 строка C-2619 исчезала молча —
       при том что подзаголовок блока обещает «все строки этого товара,
       каждая с причиной». */
    for (const other of items) {
      if (other.sku !== c.sku || other.market === marketCode) continue;
      other.containers.push(record);
    }
  }

  return { asOf, horizonEnd, generatedAt: data.generatedAt || null, demo: data.demo === true,
    markets, items, containers, orphanContainers, defaultMarket, flags };
}

/* ==========================================================================
   §1.2. Проверка «данные того рынка»
   ========================================================================== */

const DE_UMLAUT = /[äöüß]/i;
/* Списки §1.2 плюс несколько слов той же природы, встречающихся в названиях
   этой товарной группы. Слово попадает в список, только если оно РАЗЛИЧАЕТ
   языки: `set` и `stopper` пишутся одинаково в немецком и английском, поэтому
   в словарях их нет — с ними «Window Stopper Set» определялось как немецкое
   и могло завалить проверку «данные того рынка» на UK-выгрузке. */
const DE_WORDS = ['eckenschutz', 'kindersicherung', 'schrank', 'schublade', 'tür', 'steckdose',
  'kantenschutz', 'schutz', 'sicherung', 'ecken', 'kanten', 'baby-', 'kinder', 'herd', 'treppe',
  'fenster', 'tisch', 'gitter'];
const EN_WORDS = ['corner', 'protector', 'cupboard', 'lock', 'safety', 'drawer', 'edge', 'guard',
  'latch', 'socket', 'cover', 'child', 'baby', 'gate', 'stair', 'window', 'table', 'stove'];

/** Язык названия по словарю маркеров. `unknown` — если счёт равный. */
export function detectLang(title) {
  const text = String(title || '').toLowerCase();
  if (!text.trim()) return 'unknown';
  let de = DE_UMLAUT.test(text) ? 1 : 0;
  for (const w of DE_WORDS) if (text.includes(w)) de += 1;
  let en = 0;
  for (const w of EN_WORDS) if (text.includes(w)) en += 1;
  if (de > en) return 'de';
  if (en > de) return 'en';
  return 'unknown';
}

/**
 * Ловит подмену файла: UK-выгрузку с немецкими названиями и DE-цифрами.
 * Расчёт на заведомо чужих стоках хуже, чем отсутствие расчёта, поэтому
 * уровень `error` останавливает рынок целиком.
 */
export function checkMarketLanguage(items, expectedLang, params = DEFAULT_PARAMS) {
  const rows = items.filter((it) => it.reportTitle && String(it.reportTitle).trim());
  const flags = [];
  if (!expectedLang) return { share: null, flags, error: false };
  if (rows.length < params.minTitleRows) {
    flags.push({ code: 'lang-sample-too-small', level: 'warning', rows: rows.length });
    return { share: null, flags, error: false };
  }
  const detected = rows.map((it) => detectLang(it.reportTitle)).filter((l) => l !== 'unknown');
  if (!detected.length) {
    flags.push({ code: 'lang-sample-too-small', level: 'warning', rows: 0 });
    return { share: null, flags, error: false };
  }
  const share = detected.filter((l) => l === expectedLang).length / detected.length;
  const error = share < params.langMatchMin;
  if (error) flags.push({ code: 'wrong-marketplace-report', level: 'error', share, expectedLang });
  return { share, flags, error };
}

/** Перекрёстная проверка: UK-стоки, побайтово повторяющие DE. */
export function checkDuplicateStock(itemsA, itemsB) {
  const key = (list) => list
    .map((it) => `${it.sku}:${num(it.fba && it.fba.available, 0)}`)
    .sort()
    .join('|');
  if (!itemsA.length || itemsA.length !== itemsB.length) return false;
  return key(itemsA) === key(itemsB);
}

/* ==========================================================================
   §9. Симуляция по полумесяцам
   ========================================================================== */

/** Всё, что нужно для прогона одной пары товар×рынок. Считается один раз. */
export function prepareItem(item, params = DEFAULT_PARAMS) {
  const p = paramsForItem(params, item.market, item.sku);
  // Дата расчёта проверяется здесь, а не «как-нибудь потом»: строка вида
  // `15.08.2026` разбору не поддаётся, и без этой проверки она доезжала до
  // арифметики месяцев и роняла весь раздел необработанным исключением.
  const rawAsOf = item.asOf || p.asOf;
  const asOf = dateMs(rawAsOf) === null ? null : rawAsOf;
  const horizonEnd = horizonFor(asOf, p, item.horizonEnd);
  const periods = halfMonthPeriods(asOf, horizonEnd);
  const dateFlags = [];
  if (asOf === null) dateFlags.push({ code: rawAsOf ? 'bad-as-of' : 'no-as-of', level: 'error', value: rawAsOf || null });

  const t30 = baseT30(item, p);
  const pd = primeDayDetail(t30, item.primeDayUnits, p);
  const growth = growthDetail(item.salesHistory, p);
  const demand = demandByPeriod(pd.adjusted, growth.value, periods, asOf);
  demand.periodsMeta = periods;

  const selected = (p.selectedPrepCenters && p.selectedPrepCenters[item.market]) || [];
  const selectedSet = new Set(selected);
  const prepSelected = (item.prep || []).filter((row) => selectedSet.has(row.id));
  const prepUnits = prepSelected.reduce((s, row) => s + num(row.units, 0), 0);
  const prepExcluded = (item.prep || [])
    .filter((row) => !selectedSet.has(row.id))
    .reduce((s, row) => s + num(row.units, 0), 0);

  /* Склады-источники подстраховки, ближний первым. У каждого свой лаг до FBA
     (§9.4): общий скаляр `prepLagDays` врал бы про AsiaLog с его 45 днями —
     карточка склада обещает одно, расчёт делал другое. Порядок по лагу
     означает «сначала тот, кто успеет раньше»; при равных лагах порядок
     остаётся тем, в котором склады перечислены в параметрах. */
  const prepSources = selected.map((id) => {
    const known = (item.prepCenters || []).find((c) => c.id === id) || null;
    const rows = (item.prep || []).filter((row) => row.id === id);
    const dataLag = known
      ? (Number.isFinite(known.dataLagDays) ? known.dataLagDays : num(known.lagDays, null))
      : null;
    return {
      id,
      name: known ? known.name : ((rows[0] && rows[0].name) || id),
      lagDays: prepLagFor(id, dataLag, p),
      units: rows.reduce((sum, row) => sum + num(row.units, 0), 0),
    };
  }).sort((a, b) => a.lagDays - b.lagDays);

  const classified = classifyContainers(item.containers, {
    code: item.market,
    asOf,
    shipments: item.shipments,
    prepCenters: item.prepCenters,
    selectedPrepCenters: selected,
    defaultPrepId: (item.prepCenters || []).find((c) => selectedSet.has(c.id))
      ? (item.prepCenters || []).find((c) => selectedSet.has(c.id)).id
      : ((item.prepCenters || [])[0] || {}).id,
    defaultMarket: item.market === 'UK' ? 'DE' : item.market,
  }, p);

  // Шаг округления: параметр главнее данных (§14 держит `roundingStep` в UI),
  // значение из JSON — запасное. Раньше приоритет был обратным, и ползунок
  // шага в интерфейсе не влиял на расчёт вообще.
  const step = num(p.roundingStep && p.roundingStep[item.market], 0) || num(item.roundingStep, 1);
  const flags = [...dateFlags, ...(item.flags || []), ...pd.flags, ...growth.flags, ...classified.flags];

  // Пороги зависят только от кривой спроса и параметров, но НЕ от заказов,
  // поэтому считаются один раз, а не заново на каждом из двух десятков
  // прогонов, которые делает планирование заказов (§10).
  const thresholds = periods.map((_, i) => ({
    fba: forwardDemand(i, p.thresholdFbaMonths, demand, periods),
    reserve: forwardDemand(i, p.thresholdReserveMonths, demand, periods),
  }));

  return {
    item, params: p, asOf, horizonEnd, periods, demand, thresholds,
    // §9.4: подстраховка возможна, только если выбран хотя бы один препцентр.
    // Без этого признака симуляция брала подстраховку из склада, который
    // пользователь из расчёта исключил.
    hasPrepCenter: selected.length > 0,
    periodDays: periods.map(periodDays),
    t30, t30Adjusted: pd.adjusted, primeDay: pd, growth,
    // Происхождение t30 — для карточки товара: §5 иначе нечем показать.
    t30Source: t30Detail(item, p),
    startFba: startFba(item), awdUnits: num(item.awdUnits, 0),
    prepUnits, prepExcluded, prepSelected, prepSources,
    arrivals: classified.arrivals, excludedContainers: classified.excluded,
    roundingStep: step,
    earliestArrival: addMonths(asOf, p.leadTimeMonths),
    flags,
  };
}

/** Раскладывает приходы по дням внутри периода. */
function bucketByDay(arrivals, period, firstDay) {
  const map = new Map();
  for (const a of arrivals) {
    if (!(a.qty > 0)) continue;
    // Приход, датированный раньше первого дня горизонта, зачисляем первым
    // днём: потерять поставку хуже, чем сдвинуть её на сутки.
    const date = cmpDate(a.date, firstDay) < 0 ? firstDay : a.date;
    if (cmpDate(date, period.start) < 0 || cmpDate(date, period.end) > 0) continue;
    map.set(date, (map.get(date) || 0) + a.qty);
  }
  return map;
}

/**
 * §9.1. Посуточный прогон одного периода.
 *
 * Приход зачисляется в начале своего календарного дня и с этого дня
 * продаётся. «Мгновенно в начале периода» спрятало бы реальный OOS у
 * поставки от 28-го числа, «в конце» — нарисовало бы фантомный OOS у
 * поставки от 2-го. Отрицательного остатка не бывает: нехватка живёт
 * отдельной величиной `shortfall`.
 */
function runPeriod(fbaStart, arrivalsByDay, period, demand, days) {
  let balance = fbaStart;
  let shortfall = 0;
  const byDay = [];
  // Остаток на конец каждого дня нужен политике `zeroOnly` (§9.4): она
  // отправляет подстраховку, только если полка пуста на день её прихода.
  const balanceByDay = [];
  const list = days || periodDays(period);
  for (let i = 0; i < list.length; i += 1) {
    const d = list[i];
    balance += arrivalsByDay.get(d) || 0;
    const need = demand.day(d);
    const take = Math.min(balance, need);
    balance -= take;
    const miss = need - take;
    byDay.push(miss);
    balanceByDay.push(balance);
    shortfall += miss;
  }
  return { fbaEnd: balance, shortfall, byDay, balanceByDay };
}

/** Календарные дни периода списком. Строковая арифметика дат недешёвая,
    поэтому список считается один раз на товар (`prepareItem`). */
export function periodDays(period) {
  const out = [];
  let d = period.start;
  for (let i = 0; i < period.days; i += 1) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

function mergeDay(map, date, qty) {
  if (!(qty > 0)) return map;
  const out = new Map(map);
  out.set(date, (out.get(date) || 0) + qty);
  return out;
}

/**
 * Полный прогон по периодам. `extra` — плановые заказы из §10:
 * `{ channel: 'direct-fba' | 'prep-refill', arrival, qty }`.
 */
export function runSimulation(prep, extra = []) {
  const { periods, demand, params } = prep;
  const firstDay = periods.length ? periods[0].start : prep.asOf;
  // Запасной лаг: склад, которого нет ни в справочнике, ни в данных.
  const lag = Math.max(0, Math.round(num(params.prepLagDays, 7)));

  /* Препцентры-источники, ближний первым. Пул остатков разбит по складам
     именно здесь: до этого лаг был один на всех, и отправка с AsiaLog
     приходила через семь дней вместо сорока пяти. */
  const sources = (prep.prepSources && prep.prepSources.length)
    ? prep.prepSources.map((c) => ({
      id: c.id,
      lagDays: Math.max(0, Math.round(num(c.lagDays, lag))),
    }))
    : [{ id: null, lagDays: lag }];
  const primaryId = sources[0].id;
  const stockById = new Map(sources.map((c) => [c.id, 0]));
  if (prep.prepSources && prep.prepSources.length) {
    for (const c of prep.prepSources) stockById.set(c.id, num(c.units, 0));
  } else {
    stockById.set(null, num(prep.prepUnits, 0));
  }
  /* Приход на склад, которого в выборе нет, зачисляется ближнему: потерять
     поставку хуже, чем приписать её соседнему складу. Такого прихода в
     обычном наборе не бывает — исключённые склады отсеивает §4. */
  const centerFor = (id) => (stockById.has(id) ? id : primaryId);
  const prepTotal = () => [...stockById.values()].reduce((sum, v) => sum + v, 0);

  // §3.4 + §9.4: при пустом выборе препцентров подстраховки не существует —
  // склада, с которого она поехала бы, в расчёте нет.
  const canSafety = prep.hasPrepCenter !== false;
  const pipelineFba = prep.arrivals.filter((a) => a.target === 'FBA');
  const pipelinePrep = prep.arrivals.filter((a) => a.target === 'PREP');
  const directOrders = extra.filter((o) => o.channel === 'direct-fba')
    .map((o) => ({ date: o.arrival, qty: o.qty }));
  // `prepId` едет вместе с заказом: пополнение приходит на конкретный склад,
  // а у складов разные лаги до FBA.
  const refillOrders = extra.filter((o) => o.channel === 'prep-refill')
    .map((o) => ({ date: o.arrival, qty: o.qty, prepId: o.prepId || null }));

  let fba = prep.startFba;
  let awd = prep.awdUnits;
  const rows = [];

  const dayLists = prep.periodDays || periods.map(periodDays);

  periods.forEach((period, index) => {
    const days = dayLists[index];
    const cached = prep.thresholds && prep.thresholds[index];
    const thresholdFba = cached ? cached.fba : forwardDemand(index, params.thresholdFbaMonths, demand, periods);
    const thresholdReserve = cached ? cached.reserve : forwardDemand(index, params.thresholdReserveMonths, demand, periods);

    const pipeMap = bucketByDay(pipelineFba, period, firstDay);
    const directMap = bucketByDay(directOrders, period, firstDay);
    const inflowPipeline = [...pipeMap.values()].reduce((s, v) => s + v, 0);
    const inflowDirect = [...directMap.values()].reduce((s, v) => s + v, 0);
    let baseMap = pipeMap;
    for (const [date, qty] of directMap) baseMap = mergeDay(baseMap, date, qty);

    // §9.2. Порядок источников строгий: конвейер и прямые поставки → AWD →
    // препцентр. Конвейер уже оплачен и едет, AWD бесплатен и автоматичен,
    // препцентр — последний рубеж.
    const r0 = runPeriod(fba, baseMap, period, demand, days);

    // §9.3. AWD подтягивает FBA к его собственному порогу и закрывает
    // нехватку. Переброс внутри сети Amazon считаем мгновенным.
    let awdPull = 0;
    if (params.awdAutoTopUp !== false && awd > 0) {
      const need = r0.shortfall + Math.max(0, thresholdFba - r0.fbaEnd);
      awdPull = Math.min(awd, Math.max(0, need));
    }
    const map1 = mergeDay(baseMap, period.start, awdPull);
    const r1 = awdPull > 0 ? runPeriod(fba, map1, period, demand, days) : r0;

    // §9.4. Подстраховка с препцентра — только против физической нехватки.
    // Отправка уходит в день 1, приходит в день 1 + лаг, поэтому нехватку
    // первых семи дней она физически закрыть не может.
    let safety = 0;
    let reachable = 0;
    // Лаг склада, который эту нехватку закрывает: им же меряется `lostToLag`.
    let sourceLag = lag;
    const policy = params.safetyPolicy || 'emergency';
    const prepStart = prepTotal();
    let map2 = map1;
    let r2 = r1;
    if (canSafety) {
      let firstSource = true;
      for (const source of sources) {
        const have = stockById.get(source.id) || 0;
        if (!(have > 0)) continue;
        let can = 0;
        for (let i = source.lagDays; i < r2.byDay.length; i += 1) can += r2.byDay[i];
        /* Ближний склад с остатком задаёт отчётные величины периода, даже
           если помочь не успевает: именно его лаг объясняет, почему часть
           нехватки осталась непокрытой. Отчёт про семь дней там, где резерв
           лежит на складе с сорокапятидневным плечом, был бы утешительной
           неправдой. */
        if (firstSource) {
          reachable = can;
          sourceLag = source.lagDays;
          firstSource = false;
        }
        // Отправка уходит в день 1 и приходит в день 1 + лаг: склад, чей лаг
        // длиннее самого периода, в этом периоде помочь не может физически.
        if (period.days <= source.lagDays) continue;
        let want = 0;
        if (r2.shortfall > EPS) want = can;
        if (policy === 'zeroOnly') {
          // «Аварийно при нуле» (§15, пункт 9): отправка уходит, только если к
          // дню прихода (1 + лаг) полка УЖЕ пуста. Предупредительной отправки
          // под провал, который случится в конце периода, в этом режиме нет —
          // этим режим и отличается от базового `emergency`.
          const balanceAtArrival = source.lagDays > 0 ? r2.balanceByDay[source.lagDays - 1] : fba;
          const empty = Number.isFinite(balanceAtArrival) && balanceAtArrival <= EPS;
          want = (empty && r2.shortfall > EPS) ? can : 0;
        }
        if (policy === 'threshold') want = can + Math.max(0, thresholdFba - r2.fbaEnd);
        const take = Math.min(have, Math.max(0, want));
        if (!(take > 0)) continue;
        map2 = mergeDay(map2, addDays(period.start, source.lagDays), take);
        r2 = runPeriod(fba, map2, period, demand, days);
        safety += take;
        stockById.set(source.id, have - take);
      }
    }

    let lostToLag = 0;
    for (let i = 0; i < Math.min(sourceLag, r2.byDay.length); i += 1) lostToLag += r2.byDay[i];

    /* Приходы на преп раскладываются по складам поштучно: у каждого свой лаг,
       и общий котёл снова стёр бы разницу между Eichenzell и AsiaLog. */
    let prepInflow = 0;
    const receive = (id, list) => {
      const sum = [...bucketByDay(list, period, firstDay).values()].reduce((s2, v) => s2 + v, 0);
      if (!(sum > 0)) return;
      const key = centerFor(id);
      stockById.set(key, (stockById.get(key) || 0) + sum);
      prepInflow += sum;
    };
    for (const a of pipelinePrep) receive(a.prepId, [a]);
    for (const o of refillOrders) receive(o.prepId, [o]);

    const fbaStart = fba;
    const awdStart = awd;
    const salesPlan = demand.periods[index].units;

    fba = r2.fbaEnd;
    awd = awdStart - awdPull;
    const prepStock = prepTotal();

    const reserveEnd = awd + prepStock;
    rows.push({
      periodId: period.id,
      index,
      start: period.start,
      end: period.end,
      days: period.days,
      label: period.label,
      salesPlan,
      salesActual: salesPlan - r2.shortfall,
      shortfall: r2.shortfall,
      lostToLag,
      inflowPipeline,
      inflowAwd: awdPull,
      inflowDirect,
      prepRefill: prepInflow,
      safety,
      reachable,
      // Лаг склада, с которого шла подстраховка: без него непонятно, почему
      // часть нехватки осталась непокрытой (`lostToLag`).
      safetyLagDays: sourceLag,
      fbaStart,
      fbaEnd: fba,
      awdStart,
      awdEnd: awd,
      prepStart,
      prepEnd: prepStock,
      reserveEnd,
      thresholdFba,
      thresholdReserve,
      status: r2.shortfall > EPS ? 'oos'
        : fba < thresholdFba - EPS ? 'below-fba'
          : reserveEnd < thresholdReserve - EPS ? 'below-reserve'
            : 'ok',
    });
  });

  return rows;
}

/** Девять рядов прогноза §12.2, в порядке строк таблицы. */
export const FORECAST_ROWS = [
  'inflow', 'direct', 'prepRefill', 'sales', 'safety',
  'fbaEnd', 'thresholdFba', 'reserve', 'thresholdReserve',
];

function forecastRows(rows) {
  return {
    // Строка 1 объединяет конвейер и автоприход из AWD: список из девяти
    // строк задан жёстко, десятой под AWD в нём нет, а с точки зрения FBA
    // это одинаковые внешние поступления. Разбивка — в подсказке.
    inflow: rows.map((r) => r.inflowPipeline + r.inflowAwd),
    inflowPipeline: rows.map((r) => r.inflowPipeline),
    inflowAwd: rows.map((r) => r.inflowAwd),
    direct: rows.map((r) => r.inflowDirect),
    prepRefill: rows.map((r) => r.prepRefill),
    sales: rows.map((r) => r.salesPlan),
    salesActual: rows.map((r) => r.salesActual),
    safety: rows.map((r) => r.safety),
    fbaEnd: rows.map((r) => r.fbaEnd),
    thresholdFba: rows.map((r) => r.thresholdFba),
    // Строка 8 — СУММА AWD + препцентр: порог строки 9 задан именно на сумму,
    // показывать рядом с ним один препцентр значило бы красить жёлтым там,
    // где резерва достаточно.
    reserve: rows.map((r) => r.reserveEnd),
    awdEnd: rows.map((r) => r.awdEnd),
    prepEnd: rows.map((r) => r.prepEnd),
    thresholdReserve: rows.map((r) => r.thresholdReserve),
  };
}

/** §9. Симуляция пары товар×рынок без плановых заказов. */
export function simulate(item, params = DEFAULT_PARAMS, prepared = null) {
  const prep = prepared || prepareItem(item, params);
  const rows = runSimulation(prep, []);
  return buildSimulation(prep, rows, []);
}

function buildSimulation(prep, rows, orders) {
  const earliest = prep.earliestArrival;
  const oosPeriods = rows.filter((r) => r.shortfall > EPS);
  const unrecoverable = oosPeriods.filter((r) => cmpDate(r.end, earliest) < 0);
  const belowFba = rows.filter((r) => r.status === 'below-fba');
  const belowReserve = rows.filter((r) => r.status === 'below-reserve');
  const flags = [...prep.flags];
  // Пустой горизонт (конец раньше даты расчёта, битая дата) — это НЕ «всё
  // хорошо»: считать нечего, и товар обязан отличаться от здорового.
  if (!rows.length) flags.push({ code: 'horizon-empty', level: 'warning' });
  if (unrecoverable.length) {
    flags.push({ code: 'unrecoverable-oos', level: 'warning', from: unrecoverable[0].start });
  }
  if (rows.some((r) => r.shortfall > EPS && r.safety > 0 && r.prepEnd <= EPS)) {
    flags.push({ code: 'prep-insufficient', level: 'warning' });
  }

  const status = !rows.length ? 'no-horizon'
    : unrecoverable.length ? 'unrecoverable'
      : oosPeriods.length ? 'oos'
        : belowFba.length ? 'below-fba'
          : belowReserve.length ? 'below-reserve'
            : 'ok';

  const firstProblem = oosPeriods[0] || belowFba[0] || belowReserve[0] || null;

  return {
    key: prep.item.key,
    sku: prep.item.sku,
    market: prep.item.market,
    asOf: prep.asOf,
    horizonEnd: prep.horizonEnd,
    periods: prep.periods,
    rows,
    forecast: forecastRows(rows),
    orders,
    status,
    firstProblemPeriod: firstProblem ? firstProblem.periodId : null,
    firstProblemDate: firstProblem ? firstProblem.start : null,
    oosPeriodIds: oosPeriods.map((r) => r.periodId),
    belowFbaPeriodIds: belowFba.map((r) => r.periodId),
    belowReservePeriodIds: belowReserve.map((r) => r.periodId),
    unrecoverablePeriodIds: unrecoverable.map((r) => r.periodId),
    lostUnits: oosPeriods.reduce((s, r) => s + r.shortfall, 0),
    earliestArrival: earliest,
    t30: prep.t30,
    t30Adjusted: prep.t30Adjusted,
    // Происхождение t30 (§5) едет вместе с прогоном: карточка показывает
    // источник, окно и выбранный месяц рядом с самим числом.
    t30Source: prep.t30Source,
    primeDay: prep.primeDay,
    growth: prep.growth,
    startFba: prep.startFba,
    awdUnits: prep.awdUnits,
    prepUnits: prep.prepUnits,
    prepExcluded: prep.prepExcluded,
    prepSources: prep.prepSources,
    arrivals: prep.arrivals,
    excludedContainers: prep.excludedContainers,
    roundingStep: prep.roundingStep,
    flags,
  };
}

/* ==========================================================================
   §10. График заказов — два прохода
   ========================================================================== */

const CHANNEL_RANK = { 'direct-fba': 0, 'prep-refill': 1, expedite: 2 };

/**
 * §10. Планирование заказов.
 *
 * Проход 1 — прямые поставки на FBA под дефицит порога; проход 2 —
 * пополнение резерва, когда СУММА AWD + препцентр ниже двухмесячного порога.
 * Проход 1 после прохода 2 не переигрывается: связь между ними слабая
 * (прямые поставки считаются против порога FBA независимо от препа), а у
 * повторного цикла нет гарантии сходимости. Результат может выйти слегка
 * консервативным — это безопасная сторона.
 */
export function planOrders(item, params = DEFAULT_PARAMS, prepared = null) {
  const prep = prepared || prepareItem(item, params);
  const { periods, params: p } = prep;
  const earliest = prep.earliestArrival;
  const step = prep.roundingStep;
  const orders = [];

  // Прибытие ставится на самый ранний допустимый день периода: раз дату
  // выбираем мы, ранняя дата максимизирует покрытие и даёт чистую дату
  // «заказать до». Раньше лид-тайма прибытий не бывает физически.
  const arrivalFor = (period) => (cmpDate(period.start, earliest) >= 0 ? period.start : earliest);
  const orderByFor = (arrival) => addMonths(arrival, -p.leadTimeMonths);

  /* Пополнение резерва едет на ближний склад: он быстрее всех отдаёт товар в
     FBA, а §10.3 конкретного адресата не называет. Показать адресата всё
     равно обязаны — «пополнить преп» без имени склада не заказ. */
  const refillTarget = (prep.prepSources && prep.prepSources[0] && prep.prepSources[0].id) || null;

  const pass = (channel) => {
    for (let i = 0; i < periods.length; i += 1) {
      const period = periods[i];
      if (cmpDate(period.end, earliest) < 0) continue;   // заказом не закрыть
      const rows = runSimulation(prep, orders);
      const res = rows[i];
      if (channel === 'prep-refill' && p.prepRefillRequiresSpend) {
        // Узкая трактовка §10.3: пополняем, только если преп реально тратился.
        const spent = rows.slice(0, i + 1).some((r) => r.safety > EPS);
        if (!spent) continue;
      }
      const gap = channel === 'direct-fba'
        ? res.thresholdFba - res.fbaEnd
        : res.thresholdReserve - res.reserveEnd;
      if (!(gap > EPS)) continue;
      const arrival = arrivalFor(period);
      orders.push({
        channel,
        periodId: period.id,
        arrival,
        orderBy: orderByFor(arrival),
        need: gap,
        qty: ceilTo(gap, step),
        target: channel === 'direct-fba' ? 'FBA' : 'PREP',
        prepId: channel === 'prep-refill' ? refillTarget : null,
      });
    }
  };

  pass('direct-fba');
  // Пополнять нечего, если ни один препцентр не выбран: заказ уехал бы на
  // склад, исключённый пользователем из расчёта (§3.4).
  if (prep.hasPrepCenter !== false) pass('prep-refill');

  const rows = runSimulation(prep, orders);
  const sim = buildSimulation(prep, rows, orders);

  // §10.4. Непоправимое окно: OOS раньше лид-тайма заказом не закрывается,
  // единственное лекарство — ускорение уже готовых или производящихся партий.
  const unrecoverable = rows.filter((r) => r.shortfall > EPS && cmpDate(r.end, earliest) < 0);
  const expedite = [];
  if (unrecoverable.length) {
    const firstGap = unrecoverable[0];
    const candidates = prep.arrivals
      .filter((a) => a.expedite && a.qty > 0 && cmpDate(a.date, firstGap.start) > 0)
      .sort((a, b) => b.qty - a.qty || cmpDate(a.date, b.date));
    for (const c of candidates) {
      expedite.push({
        channel: 'expedite',
        containerId: c.containerId,
        qty: c.qty,
        currentEta: c.date,
        status: c.status,
        targetPeriodId: firstGap.periodId,
        orderBy: null,
        arrival: c.date,
      });
    }
  }

  const sorted = orders.slice().sort((a, b) => cmpDate(a.orderBy, b.orderBy)
    || cmpDate(a.arrival, b.arrival)
    || (CHANNEL_RANK[a.channel] - CHANNEL_RANK[b.channel]));

  return {
    orders: sorted,
    expedite,
    unrecoverable: unrecoverable.map((r) => ({ periodId: r.periodId, start: r.start, shortfall: r.shortfall })),
    simulation: sim,
    earliestArrival: earliest,
    roundingStep: step,
    totalUnits: sorted.reduce((s, o) => s + o.qty, 0),
  };
}

/* ==========================================================================
   §11. «На сколько хватит стока»
   ========================================================================== */

/**
 * Два метода рядом. Метод B (с ростом) всегда меньше — запас тратится в
 * пиковый сезон, когда продажи выше средних. Это не ошибка, а его смысл:
 * он вскрывает OOS, которых фиксированный метод не видит.
 *
 * Весь TOTAL считается доступным сразу, без учёта дат прихода: §11 —
 * индикатор объёма, а таймлайн — это §9, и он отвечает на тот же вопрос
 * точнее. Приходы берутся ВСЕ, включая те, что за горизонтом.
 */
export function coverage(item, params = DEFAULT_PARAMS, prepared = null) {
  const prep = prepared || prepareItem(item, params);
  const inTransit = prep.arrivals.reduce((s, a) => s + num(a.qty, 0), 0);
  const total = prep.startFba + prep.awdUnits + prep.prepUnits + inTransit;
  const t30 = prep.t30Adjusted;

  if (!(t30 > 0) || prep.asOf === null) {
    // Нет run-rate (или нет пригодной даты расчёта) — покрытие не определено.
    // Именно null, а не «бесконечность» и не 0: товар неактивен (§12.3), и
    // это отдельная ветка.
    return {
      total,
      parts: { fba: prep.startFba, awd: prep.awdUnits, prep: prep.prepUnits, inTransit },
      fixedMonths: null, growthMonths: null, capped: false, exhaustDate: null,
    };
  }

  const fixedMonths = total / t30;

  const capDays = Math.ceil(num(prep.params.coverageCapMonths, 36) * DAYS_PER_MONTH);
  let rest = total;
  let days = 0;
  let d = addDays(prep.asOf, 1);
  while (rest > EPS && days < capDays) {
    rest -= prep.demand.day(d);
    days += 1;
    d = addDays(d, 1);
  }
  const capped = rest > EPS;
  return {
    total,
    parts: { fba: prep.startFba, awd: prep.awdUnits, prep: prep.prepUnits, inTransit },
    fixedMonths,
    growthMonths: days / DAYS_PER_MONTH,
    capped,
    // Дата исчерпания: последний день, оплаченный запасом. При capped — null,
    // потому что за 36 месяцев запас так и не кончился.
    exhaustDate: capped ? null : addDays(prep.asOf, days),
  };
}

/* ==========================================================================
   §12. Прогон по всем парам товар×рынок
   ========================================================================== */

const STATUS_RANK = { oos: 0, unrecoverable: 1, 'below-fba': 2, 'below-reserve': 3, ok: 4, 'no-horizon': 5 };

/** Товар без продаж не даёт основы для прогноза — run-rate не определён. */
export function isInactive(item, params = DEFAULT_PARAMS) {
  const rule = params.inactiveRule || 't30Zero';
  if (rule === 'none') return false;
  const t30 = baseT30(item, params);
  // Отсутствие данных о продажах трактуем как неактивность, но отдельным
  // признаком: это не то же самое, что подтверждённый ноль.
  const noSales = t30 === null || !(t30 > 0);
  if (rule === 't30AndStockZero') {
    const stock = startFba(item) + num(item.awdUnits, 0)
      + (item.prep || []).reduce((s, r) => s + num(r.units, 0), 0);
    return noSales && stock <= 0;
  }
  // Товар с продажами и нулевым стоком неактивным НЕ считается: это самый
  // острый OOS-случай, ради которого писалась вся модель (§16.17).
  return noSales;
}

/**
 * Результат-заглушка: та же форма, что у успешного расчёта, но всё пусто.
 *
 * Форма обязана совпадать, иначе раздел, читающий `result.totals.oos`, падает
 * ровно на ветке отказа — там, где вместо цифр нужно показать причину.
 */
function emptyResult(p, norm, flags) {
  return {
    asOf: null,
    horizonEnd: null,
    periods: [],
    generatedAt: (norm && norm.generatedAt) || null,
    demo: Boolean(norm && norm.demo),
    params: p,
    markets: [],
    items: [],
    inactive: [],
    orphanContainers: (norm && norm.orphanContainers) || [],
    flags: flags || [],
    totals: {
      items: 0, inactive: 0, oos: 0, lostUnits: 0,
      unrecoverable: 0, orderUnits: 0, orderRows: 0,
    },
  };
}

/**
 * §12. Полный расчёт: рынки, активные пары, неактивные, сортировка по риску.
 * `params` не читается из хранилища — движок остаётся чистым, параметры
 * передаёт вызывающий (`oos-params.getParams()`).
 */
export function computeAll(data, params = DEFAULT_PARAMS) {
  const p = normalizeParams(params);
  const norm = normalizeData(data, p);
  const flags = [...norm.flags];
  // Дата расчёта проверяется тем же ISO-разбором, что и остальные даты.
  // Раньше сюда проходила любая непустая строка (`15.08.2026`), и раздел
  // падал с TypeError из глубины арифметики месяцев вместо честного отказа.
  const asOf = dateMs(norm.asOf) === null ? null : norm.asOf;

  if (asOf === null) {
    return emptyResult(p, norm,
      [...flags, { code: norm.asOf ? 'bad-as-of' : 'no-as-of', level: 'error', value: norm.asOf || null }]);
  }

  const horizonEnd = horizonFor(asOf, p, norm.horizonEnd);
  const periods = halfMonthPeriods(asOf, horizonEnd);

  const markets = [];
  const allItems = [];
  const allInactive = [];

  for (const market of norm.markets) {
    const marketItems = norm.items.filter((it) => it.market === market.code);
    const langCheck = checkMarketLanguage(marketItems, market.reportLanguage, p);
    const marketFlags = [...langCheck.flags];

    // Подмена файла: UK-стоки, побайтово повторяющие DE.
    const other = norm.markets.find((m) => m.code !== market.code);
    if (other && market.code !== norm.defaultMarket) {
      const otherItems = norm.items.filter((it) => it.market === other.code);
      if (checkDuplicateStock(marketItems, otherItems)) {
        marketFlags.push({ code: 'fba-report-duplicated-from-de', level: 'error', from: other.code });
      }
    }
    const blocked = marketFlags.some((f) => f.level === 'error');

    const selected = new Set((p.selectedPrepCenters && p.selectedPrepCenters[market.code]) || []);
    const prepCenters = market.prepCenters.map((c) => ({ ...c, selected: selected.has(c.id) }));

    const items = [];
    const inactive = [];
    if (!blocked) {
      for (const item of marketItems) {
        if (isInactive(item, p)) {
          inactive.push({
            key: item.key, sku: item.sku, asin: item.asin, market: item.market,
            title: item.title, reportTitle: item.reportTitle,
            startFba: startFba(item),
            awdUnits: item.awdUnits,
            prepUnits: (item.prep || []).reduce((s, r) => s + num(r.units, 0), 0),
            salesT30: item.salesT30,
            listedActive: item.listedActive,
            reason: item.salesT30 === null ? 'no-data' : 'no-sales-30d',
          });
          continue;
        }
        const prep = prepareItem(item, p);
        // Два прогона: без плановых заказов и с ними.
        //
        // Статус товара берётся из ПЕРВОГО. Заказ — это предложение, а не
        // факт: если считать статус по прогону с заказами, товар, который
        // уйдёт в ноль без вмешательства, покажется здоровым ровно потому,
        // что движок сам себе выписал поставку. Строка «прямая поставка» в
        // таблице прогноза (§12.2) при этом обязана быть заполненной,
        // поэтому девять рядов рисуются по ВТОРОМУ прогону.
        const baseline = simulate(item, p, prep);
        const plan = planOrders(item, p, prep);
        const cov = coverage(item, p, prep);
        items.push({
          key: item.key, sku: item.sku, asin: item.asin, market: item.market,
          title: item.title, reportTitle: item.reportTitle, sellerSku: item.sellerSku,
          item,
          baseline,
          simulation: plan.simulation,
          orders: plan.orders,
          expedite: plan.expedite,
          unrecoverable: plan.unrecoverable,
          coverage: cov,
          status: baseline.status,
          plannedStatus: plan.simulation.status,
          orderUnits: plan.totalUnits,
          flags: plan.simulation.flags,
        });
      }
    }

    // §12.1. OOS-риски вверху; внутри группы — по дате первого проблемного
    // периода, затем по SKU.
    items.sort((a, b) => (STATUS_RANK[a.status] - STATUS_RANK[b.status])
      || cmpDate(a.baseline.firstProblemDate || '9999-12-31', b.baseline.firstProblemDate || '9999-12-31')
      || a.sku.localeCompare(b.sku));
    inactive.sort((a, b) => a.sku.localeCompare(b.sku));

    markets.push({
      code: market.code,
      domain: market.domain,
      locale: market.locale,
      currency: market.currency,
      accent: market.accent,
      reportLanguage: market.reportLanguage,
      // Действующий шаг: параметр главнее данных (§14). UI показывает именно
      // то число, которым движок округлял объёмы.
      roundingStep: num(p.roundingStep && p.roundingStep[market.code], 0)
        || num(market.roundingStep, 1),
      prepCenters,
      langShare: langCheck.share,
      blocked,
      flags: marketFlags,
      items,
      inactive,
    });
    allItems.push(...items);
    allInactive.push(...inactive);
  }

  allItems.sort((a, b) => (STATUS_RANK[a.status] - STATUS_RANK[b.status])
    || cmpDate(a.baseline.firstProblemDate || '9999-12-31', b.baseline.firstProblemDate || '9999-12-31')
    || a.sku.localeCompare(b.sku)
    || a.market.localeCompare(b.market));

  // Контейнер, приписанный паре, которой нет в расчёте, не должен ни исчезать
  // молча, ни ронять расчёт: он попадает в отдельный список «без адресата».
  const known = new Set(norm.items.map((it) => `${it.market}:${it.sku}`));
  const inactiveKeys = new Set(allInactive.map((it) => it.key));
  const orphanContainers = [
    ...(norm.orphanContainers || []),
    ...norm.items
      .filter((it) => inactiveKeys.has(it.key))
      /* Только контейнеры СВОЕГО рынка: с §4 в списке пары лежат ещё и
         чужие — те, что отбрасываются с причиной «другой рынок». Их адресат
         известен, и в «контейнеры без адресата» им нельзя. */
      .flatMap((it) => it.containers
        .filter((c) => c.market === it.market)
        .map((c) => ({ ...c, market: it.market, reason: 'inactive-item' }))),
  ].filter((c) => known.has(`${c.market}:${c.sku}`) === false || c.reason === 'inactive-item');

  return {
    asOf,
    horizonEnd,
    periods,
    generatedAt: norm.generatedAt,
    demo: norm.demo,
    params: p,
    markets,
    items: allItems,
    inactive: allInactive,
    orphanContainers,
    flags,
    totals: {
      items: allItems.length,
      inactive: allInactive.length,
      oos: allItems.filter((i) => i.status === 'oos' || i.status === 'unrecoverable').length,
      lostUnits: allItems.reduce((s2, i) => s2 + i.baseline.lostUnits, 0),
      unrecoverable: allItems.filter((i) => i.status === 'unrecoverable').length,
      orderUnits: allItems.reduce((s, i) => s + i.orderUnits, 0),
      orderRows: allItems.reduce((s, i) => s + i.orders.length, 0),
    },
  };
}
