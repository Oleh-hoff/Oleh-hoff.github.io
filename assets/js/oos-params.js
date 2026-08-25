/* ==========================================================================
   Параметры расчёта OOS: значения, хранение, подписка.

   Каждый параметр здесь — это точка, где методичка допускала выбор
   (§15 спецификации: одиннадцать вопросов со списком вариантов). Вынесены
   наружу именно они, а не всё подряд: то, что методичка задаёт однозначно
   (порядок «конвейер → AWD → преп», ceil-округление объёмов), остаётся
   константой внутри движка и параметром не становится.

   Почему модуль отдельный, а не состояние внутри раздела: роутер вызывает
   mount() заново при смене языка и часового пояса, и замыкание mount
   теряется вместе с выбранными фильтрами. Значения обязаны пережить
   перемонтирование, поэтому живут в модуле и в localStorage.

   Секретов здесь нет — только пороги, режимы и списки складов, — поэтому
   localStorage допустим (RULES.md §1.2 запрещает класть туда именно креды).
   ========================================================================== */

export const STORAGE_KEY = 'dashboard.oos.params';

/* --------------------------------------------------------------------------
   Допустимые значения перечислений
   -------------------------------------------------------------------------- */

/** Горизонт прогноза. `jan` — «до конца января», как в методичке. */
export const HORIZONS = [
  { id: 'jan', months: null },
  { id: '6m', months: 6 },
  { id: '9m', months: 9 },
  { id: '12m', months: 12 },
];

export const ENUMS = {
  horizon: HORIZONS.map((h) => h.id),
  // Откуда берётся базовый run-rate (§5).
  t30Source: ['sbUnits', 'lastFullMonth', 'julyForecast'],
  // §6: «для всех / не применять» и «только excess / весь объём» — это один
  // выбор из трёх, а не два независимых: «не применять» обнуляет и вопрос
  // «сколько вычитать».
  primeDayMode: ['excess', 'full', 'off'],
  // §7: индивидуальный тренд / единый процент / без роста.
  growthMode: ['individual', 'fixed', 'flat'],
  /* §9.4: когда препцентр подстраховывает FBA. Все три значения дают разный
     расчёт: `emergency` — под любую достижимую нехватку периода, `zeroOnly` —
     только если полка пуста уже на день прихода подстраховки, `threshold` —
     ещё и до порога FBA. */
  safetyPolicy: ['emergency', 'threshold', 'zeroOnly'],
  // §12.3: что считать неактивным товаром.
  inactiveRule: ['t30Zero', 't30AndStockZero', 'none'],
};

/**
 * Канонические идентификаторы препцентров.
 *
 * В демо-JSON склады названы `prep-wm`, `prep-kastellaun` и т.д., в
 * спецификации — `WM_EICHENZELL`, `KASTELLAUN`. Хранить в настройках надо
 * что-то одно, иначе пользовательский выбор развалится при смене источника
 * данных. Канон — форма спецификации; сопоставление с ключами данных делает
 * движок (`canonicalPrepId`).
 */
export const PREP_CENTERS = {
  WM_EICHENZELL: {
    market: 'DE', defaultSelected: true, lagDays: 7, name: 'WM / Eichenzell',
    aliases: ['WM Warehouse', 'WM FOB', 'EXW WM', 'WM Eichenzell', 'Lager Eichenzell',
      'Eichenzell', 'prep-wm', 'WM'],
  },
  KASTELLAUN: {
    market: 'DE', defaultSelected: false, lagDays: 7, name: 'Kastellaun',
    aliases: ['Lager Kastellaun', 'prep-kastellaun', 'Kastellaun'],
  },
  ASIALOG: {
    // 45 дней — срок склада prep-asialog. Число живёт здесь одно на всех,
    // поэтому расчёт и карточка в «Интеграциях» не могут назвать разные
    // величины.
    market: 'DE', defaultSelected: false, lagDays: 45, name: 'AsiaLog',
    aliases: ['AsiaLog Shenzhen', 'prep-asialog', 'Asia Log', 'AsiaLog'],
  },
  WEPREP_STOWMARKET: {
    market: 'UK', defaultSelected: true, lagDays: 7, name: 'WePrep Stowmarket',
    aliases: ['WePrep Stowmarket', 'prep-weprep', 'WePrep', 'Stowmarket'],
  },
};

/** Алиасы всех центров таблицей `канон → список названий`. */
function prepAliasTable() {
  const out = {};
  for (const [id, center] of Object.entries(PREP_CENTERS)) out[id] = center.aliases.slice();
  return out;
}

/** Лаг «преп → FBA» по каждому центру справочника. */
function prepLagTable() {
  const out = {};
  for (const [id, center] of Object.entries(PREP_CENTERS)) out[id] = center.lagDays;
  return out;
}

/** Центры рынка, включённые в расчёт по умолчанию. */
function defaultSelection() {
  const out = {};
  for (const [id, center] of Object.entries(PREP_CENTERS)) {
    if (!out[center.market]) out[center.market] = [];
    if (center.defaultSelected) out[center.market].push(id);
  }
  // Рынок без единого включённого центра всё равно обязан быть в наборе:
  // иначе `selectedPrepCenters.UK` окажется undefined и слияние в setParams
  // потеряет рынок целиком.
  for (const center of Object.values(PREP_CENTERS)) {
    if (!out[center.market]) out[center.market] = [];
  }
  return out;
}

/* --------------------------------------------------------------------------
   Базовые значения
   -------------------------------------------------------------------------- */

/**
 * Базовый набор. Ровно он действует, пока пользователь ничего не менял, и
 * ровно к нему возвращает `resetParams()`. Значения — из §14 спецификации.
 */
export const DEFAULT_PARAMS = Object.freeze({
  /* Горизонт (§0.2). Приоритет: явная дата `horizonEnd` > выбранный пресет
     `horizon` > `horizonEnd` из JSON > базовый пресет. Пока пользователь
     селектор не трогал, горизонт задают данные (§0.1). */
  horizon: 'jan',
  horizonEnd: null,

  /* Пороги (§8). Порог FBA — на FBA отдельно, порог резерва — на СУММУ
     AWD + препцентр, отдельных двухмесячных порогов у складов нет. */
  thresholdFbaMonths: 1.5,
  thresholdReserveMonths: 2,

  /* Лид-тайм (§10). Слагаемые хранятся отдельно, потому что раздел показывает
     их расшифровкой «1.5 производство + 2.5 доставка», а сумма — то, из чего
     считается дата «заказать до». */
  leadTimeMonths: 4,
  leadTimeProductionMonths: 1.5,
  leadTimeShippingMonths: 2.5,

  /* Лаг препцентр → FBA (§9.4). Из-за него подстраховка физически не может
     закрыть нехватку первых семи дней периода. */
  prepLagDays: 7,

  /* Run-rate и корекция Prime Day (§5, §6). */
  t30Source: 'sbUnits',
  primeDayMode: 'excess',

  /* Рост спроса (§7). `growthFixed` действует только при `growthMode='fixed'`,
     границы зажатия — только при `individual`. */
  growthMode: 'individual',
  growthFixed: 1.05,
  growthMin: 0.97,
  growthMax: 1.15,

  /* Препцентры, участвующие в расчёте (§3.4). Kastellaun выключен по
     Add. Info («сток не трогаем»), AsiaLog — потому что не входит ни в один
     вариант вопроса методички, а неучитываемый склад = исключённый. */
  selectedPrepCenters: defaultSelection(),

  /* Округление объёма заказа по рынку (§10.1). Шаг работает заодно как
     минимальный объём партии. Значение отсюда ГЛАВНЕЕ `orderRounding` из
     данных: §14 держит шаг в UI, а данные лишь подсказывают базовый. Для
     рынка, которого здесь нет, движок берёт шаг из данных. */
  roundingStep: { DE: 100, UK: 50 },

  /* Датирование контейнеров без ETA (§4.4). */
  etaReadyMonths: 2.5,
  etaInProduceMonths: 4,
  etaArrivedDays: 7,

  /* Правила классификации контейнеров (§4.1–§4.5). Раньше это были константы
     внутри движка, а раздел «Интеграции» давал их редактировать вхолостую:
     подпись под полем обещала влияние на расчёт, а движок читал свою
     зашитую копию. Теперь единственный источник — эти параметры.

     `forwarderField` — имя колонки исходного файла, в которой стоит
     назначение контейнера; движок ищет её в записи перед тем, как откатиться
     на `forwarder`/`forwarderRef`. `ukMarker` пустой строкой — законное
     значение: «рынок по маркеру не определяем». */
  forwarderField: 'Container number in forwarder system',
  ukMarker: 'UK',
  skipInvoiceDividedParents: true,
  /* §4.3 против §4.5: прибывший контейнер уже сидит в `available`, второй раз
     его везти нельзя. Выключение возвращает буквальное прочтение §4.5. */
  arrivedInStock: true,

  /* Названия препцентров, по которым контейнер относится к складу (§3.3).
     Ключ — канонический идентификатор, значения — как их пишут люди в
     forwarder-поле; движок сам приводит их к своему виду. */
  prepAliases: prepAliasTable(),
  /* Родовые слова: признак «на преп» есть, конкретики нет. Такой контейнер
     уходит на преп рынка по умолчанию с флагом `prep-alias-ambiguous`.
     В UI не выносится: «Lager» — это немецкое «склад», а не настройка. */
  prepGenericNames: ['Lager'],
  /* Названия препов в поле назначения (редактируется в «Интеграциях»).
     Работают как подсказка «это на преп, а не на FBA»: имя, которое назвал
     конкретный склад, ведёт к нему, остальные — к препу рынка по умолчанию
     с флагом `prep-alias-ambiguous`. */
  prepNameHints: ['Lager', 'Eichenzell', 'Kastellaun', 'AsiaLog'],
  /* Лаг «преп → FBA» по складам. Общий `prepLagDays` остаётся запасным
     значением для склада, которого здесь нет. */
  prepLagByCenter: prepLagTable(),

  /* Расширенные ветки (§9.3, §9.4, §10.3, §12.3). */
  awdAutoTopUp: true,
  safetyPolicy: 'emergency',
  prepRefillRequiresSpend: false,
  inactiveRule: 't30Zero',

  /* Фиксированные величины, в UI не выносятся, но параметром остаются —
     чтобы проверка могла их менять, не трогая код движка. */
  coverageCapMonths: 36,
  langMatchMin: 0.6,
  minTitleRows: 3,

  /* Переопределения по товару: ключ 'DE:SQ1' → частичный набор параметров.
     Нужны для §15 пунктов 1, 4, 6 («для отдельных товаров»). */
  overrides: {},
});

/* Числовые параметры и их допустимые границы. Границы — защита от битого
   localStorage и от опечатки в поле ввода, а не бизнес-правило. */
const NUMERIC_BOUNDS = {
  thresholdFbaMonths: [0, 12],
  thresholdReserveMonths: [0, 12],
  leadTimeMonths: [0, 24],
  leadTimeProductionMonths: [0, 24],
  leadTimeShippingMonths: [0, 24],
  prepLagDays: [0, 120],
  growthFixed: [0.5, 3],
  growthMin: [0.5, 3],
  growthMax: [0.5, 3],
  etaReadyMonths: [0, 24],
  etaInProduceMonths: [0, 24],
  etaArrivedDays: [0, 365],
  coverageCapMonths: [1, 120],
  langMatchMin: [0, 1],
  minTitleRows: [0, 100],
};

const BOOLEAN_KEYS = ['awdAutoTopUp', 'prepRefillRequiresSpend',
  'skipInvoiceDividedParents', 'arrivedInStock'];

/* Строковые параметры и предел длины. Предел — защита от подсунутого в
   localStorage мегабайта, из которого потом строится регулярное выражение. */
const STRING_BOUNDS = { ukMarker: 40, forwarderField: 200 };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/* --------------------------------------------------------------------------
   Чтение и запись
   -------------------------------------------------------------------------- */

const listeners = new Set();

/* Кэш нужен, потому что getParams() зовётся на каждую перерисовку строки
   таблицы, а JSON.parse из localStorage на каждый вызов — заметная трата.
   Инвалидация только через setParams/resetParams: другого источника
   изменений в пределах вкладки нет. */
let cache = null;

function readStorage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    // Приватный режим, отключённое хранилище или испорченный JSON.
    // Молча откатываемся на базовые значения — раздел обязан открыться.
    return null;
  }
}

function writeStorage(value) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch { /* не критично: расчёт всё равно пойдёт по значениям в памяти */ }
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = clone(value[key]);
    return out;
  }
  return value;
}

function numberOr(value, fallback, bounds) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (!bounds) return n;
  return Math.min(Math.max(n, bounds[0]), bounds[1]);
}

function stringOr(value, fallback, maxLength) {
  if (typeof value !== 'string') return fallback;
  // Пустая строка — законное значение («маркер не задан»), поэтому проверяется
  // только тип и длина, а не «непустота».
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function stringList(value, fallback) {
  if (!Array.isArray(value)) return fallback.slice();
  const out = value.filter((x) => typeof x === 'string');
  return out;               // пустой список — законный выбор «ни одного склада»
}

/**
 * Приводит произвольный объект к валидному набору параметров.
 * Всё неизвестное отбрасывается, всё кривое заменяется базовым значением:
 * данные приходят из localStorage, то есть из места, куда мог залезть кто
 * угодно, и падать из-за этого раздел не должен.
 */
export function normalizeParams(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = clone(DEFAULT_PARAMS);

  for (const [key, bounds] of Object.entries(NUMERIC_BOUNDS)) {
    if (key in src) out[key] = numberOr(src[key], DEFAULT_PARAMS[key], bounds);
  }
  for (const key of BOOLEAN_KEYS) {
    if (key in src) out[key] = Boolean(src[key]);
  }
  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (typeof src[key] === 'string' && allowed.includes(src[key])) out[key] = src[key];
  }
  if (typeof src.horizonEnd === 'string' && ISO_DATE.test(src.horizonEnd)) {
    out.horizonEnd = src.horizonEnd;
  } else if (src.horizonEnd === null) {
    out.horizonEnd = null;
  }

  for (const [key, maxLength] of Object.entries(STRING_BOUNDS)) {
    if (key in src) out[key] = stringOr(src[key], DEFAULT_PARAMS[key], maxLength);
  }
  for (const key of ['prepGenericNames', 'prepNameHints']) {
    if (key in src) out[key] = stringList(src[key], DEFAULT_PARAMS[key]);
  }

  /* Таблицы препцентров заменяются целиком, а не сливаются по ключу: это
     снимок справочника складов. Слияние воскресило бы центр, который в
     «Интеграциях» только что удалили, — и расчёт продолжил бы учитывать
     несуществующий склад. */
  if (src.prepAliases && typeof src.prepAliases === 'object' && !Array.isArray(src.prepAliases)) {
    const table = {};
    for (const [id, list] of Object.entries(src.prepAliases)) {
      if (typeof id !== 'string' || !id) continue;
      table[id] = stringList(list, []);
    }
    out.prepAliases = table;
  }
  if (src.prepLagByCenter && typeof src.prepLagByCenter === 'object'
      && !Array.isArray(src.prepLagByCenter)) {
    const table = {};
    for (const [id, value] of Object.entries(src.prepLagByCenter)) {
      if (typeof id !== 'string' || !id) continue;
      const n = numberOr(value, null, [0, 365]);
      if (n !== null) table[id] = Math.round(n);
    }
    out.prepLagByCenter = table;
  }

  if (src.selectedPrepCenters && typeof src.selectedPrepCenters === 'object') {
    const sel = {};
    for (const market of Object.keys(DEFAULT_PARAMS.selectedPrepCenters)) {
      sel[market] = stringList(
        src.selectedPrepCenters[market],
        DEFAULT_PARAMS.selectedPrepCenters[market],
      );
    }
    // Рынки, которых нет в базовом наборе, тоже сохраняем: набор рынков
    // задаётся данными, а не этим модулем.
    for (const market of Object.keys(src.selectedPrepCenters)) {
      if (!(market in sel)) sel[market] = stringList(src.selectedPrepCenters[market], []);
    }
    out.selectedPrepCenters = sel;
  }

  if (src.roundingStep && typeof src.roundingStep === 'object') {
    const step = clone(DEFAULT_PARAMS.roundingStep);
    for (const [market, value] of Object.entries(src.roundingStep)) {
      const n = numberOr(value, null, [1, 100000]);
      if (n !== null) step[market] = Math.round(n);
    }
    out.roundingStep = step;
  }

  if (src.overrides && typeof src.overrides === 'object' && !Array.isArray(src.overrides)) {
    const overrides = {};
    for (const [key, patch] of Object.entries(src.overrides)) {
      if (!patch || typeof patch !== 'object') continue;
      const clean = {};
      for (const [pk, pv] of Object.entries(patch)) {
        if (pk in NUMERIC_BOUNDS) clean[pk] = numberOr(pv, DEFAULT_PARAMS[pk], NUMERIC_BOUNDS[pk]);
        else if (BOOLEAN_KEYS.includes(pk)) clean[pk] = Boolean(pv);
        else if (ENUMS[pk] && typeof pv === 'string' && ENUMS[pk].includes(pv)) clean[pk] = pv;
        else if (pk === 'selectedPrepCenters' && Array.isArray(pv)) clean[pk] = stringList(pv, []);
      }
      if (Object.keys(clean).length) overrides[key] = clean;
    }
    out.overrides = overrides;
  }

  // growthMin выше growthMax — единственная пара, которую пользователь может
  // ввести в противоречии друг с другом; молча меняем местами.
  if (out.growthMin > out.growthMax) {
    const min = out.growthMax;
    out.growthMax = out.growthMin;
    out.growthMin = min;
  }
  return out;
}

/** Текущие параметры. Всегда свежая копия — вызывающий её волен мутировать. */
export function getParams() {
  if (!cache) cache = normalizeParams(readStorage());
  return clone(cache);
}

/** Базовые значения отдельной копией — для кнопки «сбросить» и для сравнения. */
export function getDefaults() {
  return clone(DEFAULT_PARAMS);
}

/**
 * Меняет часть параметров. Вложенные объекты (`selectedPrepCenters`,
 * `roundingStep`, `overrides`) сливаются по ключу первого уровня, чтобы
 * `setParams({ selectedPrepCenters: { DE: [...] } })` не стирал UK.
 */
export function setParams(patch) {
  const current = getParams();
  const merged = { ...current, ...(patch || {}) };
  for (const key of ['selectedPrepCenters', 'roundingStep', 'overrides']) {
    if (patch && patch[key] && typeof patch[key] === 'object' && !Array.isArray(patch[key])) {
      merged[key] = { ...current[key], ...patch[key] };
    }
  }
  cache = normalizeParams(merged);
  writeStorage(cache);
  notify();
  return clone(cache);
}

/** Один параметр — сахар над setParams для обработчиков контролов. */
export function setParam(key, value) {
  return setParams({ [key]: value });
}

/**
 * Включить/выключить препцентр на рынке (§15, пункт 1).
 *
 * ЕДИНСТВЕННЫЙ путь записи признака «участвует в расчёте». У этого параметра
 * два редактора — карточка склада в «Интеграциях» и фильтр «Логистики», — и
 * пока каждый вёл свою копию состояния, они перетирали друг друга: окно
 * настроек собирало весь список из своих карточек и записывало его целиком,
 * стирая то, что только что выбрали на странице.
 *
 * Хозяин состояния — этот модуль (`dashboard.oos.params`); справочник
 * складов — имена, алиасы, каналы получения остатков — остаётся в
 * «Интеграциях». Оба редактора ЧИТАЮТ `isPrepSelected` и пишут сюда, второй
 * копии больше нет, поэтому правка в одном месте видна в другом сразу:
 * подписчики `onParamsChange` получают уведомление.
 */
export function togglePrepCenter(market, prepId, on) {
  if (!market || !prepId) return getParams();
  const current = getParams();
  const list = new Set(current.selectedPrepCenters[market] || []);
  if (on) list.add(prepId); else list.delete(prepId);
  return setParams({ selectedPrepCenters: { [market]: [...list] } });
}

/** Участвует ли центр в расчёте на этом рынке. Чтение — для обоих редакторов. */
export function isPrepSelected(market, prepId, params = getParams()) {
  if (!market || !prepId) return false;
  const list = (params.selectedPrepCenters && params.selectedPrepCenters[market]) || [];
  return list.includes(prepId);
}

/**
 * Переносит центр с рынка на рынок, сохраняя признак участия. Карточка склада
 * в «Интеграциях» умеет менять рынок, а список выбранных хранится по рынкам —
 * без переноса центр остался бы включённым на старом рынке навсегда.
 */
export function movePrepCenter(prepId, fromMarket, toMarket) {
  if (!prepId || fromMarket === toMarket) return getParams();
  const on = isPrepSelected(fromMarket, prepId);
  const current = getParams();
  const from = (current.selectedPrepCenters[fromMarket] || []).filter((id) => id !== prepId);
  const to = new Set(current.selectedPrepCenters[toMarket] || []);
  if (on) to.add(prepId); else to.delete(prepId);
  return setParams({ selectedPrepCenters: { [fromMarket]: from, [toMarket]: [...to] } });
}

/** Возврат к базовым значениям: и в памяти, и в хранилище. */
export function resetParams() {
  cache = clone(DEFAULT_PARAMS);
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
  } catch { /* не критично */ }
  notify();
  return clone(cache);
}

/**
 * Подписка на изменение. Возвращает функцию отписки — раздел обязан вызвать
 * её в уборке mount(), иначе слушатели копятся при каждом переключении
 * раздела (та же схема, что в theme.js и timezone.js).
 */
export function onParamsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  const snapshot = clone(cache);
  listeners.forEach((fn) => fn(snapshot));
}

/* --------------------------------------------------------------------------
   Сравнение с базовыми — для подписи «базовые пороги» (§8.2)
   -------------------------------------------------------------------------- */

function sameValue(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((k) => sameValue(a[k], b[k]));
  }
  return a === b;
}

/** Список параметров, отличающихся от базовых. Пустой — значит «всё базовое». */
export function changedKeys(params = getParams()) {
  return Object.keys(DEFAULT_PARAMS).filter((key) => !sameValue(params[key], DEFAULT_PARAMS[key]));
}

/** true, если пользователь ничего не менял. Панель параметров пишет «базовые». */
export function isDefault(params = getParams()) {
  return changedKeys(params).length === 0;
}

/**
 * Параметры конкретной пары товар×рынок: базовый набор + переопределения
 * по ключу `'<MARKET>:<SKU>'`. Чистая функция, движок зовёт её сам.
 */
export function paramsForItem(params, market, sku) {
  const patch = params && params.overrides ? params.overrides[`${market}:${sku}`] : null;
  if (!patch) return params;
  const merged = { ...params, ...patch };
  if (Array.isArray(patch.selectedPrepCenters)) {
    merged.selectedPrepCenters = { ...params.selectedPrepCenters, [market]: patch.selectedPrepCenters };
  }
  return merged;
}
