/* ==========================================================================
   Движок «Еженедельного анализа»: расчёты по спецификации Sales/schotyzhnevyi-analiz.html
   (вкладка «Продажі» — единственная, которая в спецификации описана целиком).

   ГЛАВНОЕ ПРАВИЛО ЭТОГО ФАЙЛА: где спецификация правила не задала, движок
   не придумывает его, а возвращает причину отказа. У пользователя в исходном
   документе есть отдельный список «Відкриті питання» — он их именно вынес,
   а не додумал, и код обязан вести себя так же. Придуманный здесь порог
   через неделю станет «числом из CRM», на которое сошлются как на факт.

   Поэтому наружу уходит не число, а результат: `{ value, reason }`. `null`
   у value — это «не посчитано», и вид обязан показать помету, а не прочерк:
   прочерк читается как «ноль» или «нет продаж».

   Модуль ничего не знает про DOM, локаль, сеть и localStorage: на вход
   выгрузка и фильтры, на выход числа и причины.

   Даты — календарные строки `YYYY-MM-DD`, сравниваются как строки (ISO это
   позволяет) либо разбираются через Date.UTC. Локального пояса здесь нет:
   он сдвинул бы границу недели на сутки и переложил бы события в соседнюю.
   ========================================================================== */

/* ==========================================================================
   §0. Календарь
   ========================================================================== */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ISO-строка → миллисекунды UTC. null на непригодном входе. */
export function dateMs(iso) {
  const m = typeof iso === 'string' ? iso.match(ISO_RE) : null;
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Сдвиг на календарные месяцы. Спецификация ограничивает откат «двумя
 * месяцами», а не «девятью неделями» — считать надо календарём, иначе
 * граница поедет на несколько дней и в отдельные месяцы отсечёт лишнюю
 * неделю.
 *
 * Переполнение дня месяца зажимается вниз: 31 марта минус месяц — это
 * 28 (29) февраля, а не 3 марта.
 */
export function addMonths(iso, months) {
  const m = typeof iso === 'string' ? iso.match(ISO_RE) : null;
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);

  const target = new Date(Date.UTC(year, month + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0))
    .getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Полных месяцев между двумя ISO-датами. */
export function monthsBetween(fromIso, toIso) {
  const a = fromIso?.match(ISO_RE);
  const b = toIso?.match(ISO_RE);
  if (!a || !b) return null;
  let months = (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2]));
  if (Number(b[3]) < Number(a[3])) months -= 1;
  return months;
}

/* ==========================================================================
   §1. Каталог прапорців подій

   Оба списка — дословно из спецификации («Наші дії» и «Зовнішні події»).
   Поле `source` отвечает на вопрос, откуда флажок вообще может взяться.
   Сейчас источник есть у трёх из двадцати: купоны и дилы лежат в
   data/promotions.json. Остальные семнадцать не собираются ниоткуда —
   это открытый вопрос №10 исходного документа («не вказано, де вони
   фіксуються, у якому форматі і хто їх проставляє»).

   Список выводится на экран целиком, вместе с пометой «источника нет».
   Спрятать недостающие семнадцать значило бы показать «чистую неделю»,
   которая на деле могла быть неделей out of stock, — и уронить туда
   расчёт уровня молча.
   ========================================================================== */

export const FLAG_CATALOG = [
  // Наші дії
  { id: 'no_promo', group: 'ours', source: null },
  { id: 'coupon', group: 'ours', source: 'promotions' },
  { id: 'best_deal', group: 'ours', source: 'promotions' },
  { id: 'lightning_deal', group: 'ours', source: 'promotions' },
  { id: 'prime_exclusive', group: 'ours', source: null },
  { id: 'price_change', group: 'ours', source: null },
  { id: 'out_of_stock', group: 'ours', source: null },
  { id: 'new_child', group: 'ours', source: null },
  { id: 'listing_content', group: 'ours', source: null },
  { id: 'ab_test', group: 'ours', source: null },
  { id: 'buybox_lost', group: 'ours', source: null },
  // Зовнішні події
  { id: 'competitor_deal', group: 'external', source: null },
  { id: 'competitor_dumping', group: 'external', source: null },
  { id: 'competitor_left_top', group: 'external', source: null },
  { id: 'competitor_new', group: 'external', source: null },
  { id: 'prime_day', group: 'external', source: null },
  { id: 'black_friday', group: 'external', source: null },
  { id: 'holidays', group: 'external', source: null },
  { id: 'bsr_glitch', group: 'external', source: null },
  { id: 'rating_change', group: 'external', source: null },
];

/** Флажки, которые сегодня действительно можно проставить по данным. */
export const COLLECTED_FLAGS = FLAG_CATALOG.filter((f) => f.source).map((f) => f.id);

/** Флажки из спецификации, у которых источника нет (открытый вопрос №10). */
export const UNCOLLECTED_FLAGS = FLAG_CATALOG.filter((f) => !f.source).map((f) => f.id);

/* ==========================================================================
   §2. Недельный ряд

   Единица измерения — штуки. Аккаунт торгует в EUR, GBP, SEK и PLN, и
   складывать выручку разных площадок по взятому со стороны курсу — значит
   получить число, которое не сойдётся ни с Seller Central, ни с банком.
   Спецификация и говорит про «одиниці по тижнях».
   ========================================================================== */

/**
 * Ряд недель под текущими фильтрами.
 *
 * `partial` недели остаются в ряду, но помечены: текущая незакрытая неделя
 * не «обвал продаж», а незаконченный отсчёт, и базой анализа быть не может
 * («База: останній повний тиждень, понеділок–неділя»).
 */
export function buildSeries(data, { marketplace = 'all', asins = new Set() } = {}) {
  const weeks = (data?.weeks || []).map((week, i) => ({
    index: i,
    start: week.start,
    end: week.end,
    partial: Boolean(week.partial),
    units: 0,
  }));

  for (const row of data?.rows || []) {
    const week = weeks[row.w];
    if (!week) continue;
    if (marketplace !== 'all' && row.m !== marketplace) continue;
    if (asins.size && !asins.has(row.a)) continue;
    week.units += row.u || 0;
  }
  return weeks;
}

/** Индекс базовой недели: последняя полная. -1, если полных недель нет. */
export function baseWeekIndex(weeks) {
  for (let i = weeks.length - 1; i >= 0; i -= 1) {
    if (!weeks[i].partial) return i;
  }
  return -1;
}

/* ==========================================================================
   §3. Прапорці по неделям

   Кампания задевает неделю, если пересекается с ней хотя бы одним днём.
   Это прямая буква спецификации: «Тиждень, у якому подія зайняла навіть
   частину, вважається нечистим цілком».
   ========================================================================== */

export function flagWeeks(weeks, promotions, { marketplace = 'all', asins = new Set() } = {}) {
  const out = weeks.map(() => []);
  for (const campaign of promotions?.campaigns || []) {
    if (!COLLECTED_FLAGS.includes(campaign.kind)) continue;
    if (marketplace !== 'all' && campaign.m !== marketplace) continue;
    if (asins.size && !(campaign.asins || []).some((asin) => asins.has(asin))) continue;

    weeks.forEach((week, i) => {
      if (campaign.start <= week.end && campaign.end >= week.start) {
        out[i].push({ kind: campaign.kind, campaign });
      }
    });
  }
  return out;
}

/** Неделя чистая, когда обе части прапорців пусты (буква спецификации). */
export function isClean(flags, index) {
  return (flags[index] || []).length === 0;
}

/* ==========================================================================
   §4. Рівень

   Среднее арифметическое продаж за три чистые недели, предшествующие
   текущей. Идём назад, недели с прапорцями пропускаем, текущая в расчёт
   не входит. Откат ограничен двумя месяцами от текущей недели; если трёх
   чистых недель в этом окне не набралось — уровень не считается.
   ========================================================================== */

export const CLEAN_WEEKS_REQUIRED = 3;
export const LOOKBACK_MONTHS = 2;

/**
 * @returns {{value: number|null, weeks: number[], reason: string|null}}
 *   reason: 'noBase' | 'notEnoughClean' | null
 */
export function levelAt(weeks, flags, index) {
  const current = weeks[index];
  if (!current) return { value: null, weeks: [], reason: 'noBase' };

  // Граница отката. Неполные недели в набор не идут: их отсчёт не закончен,
  // и среднее по ним занизило бы уровень.
  const earliest = addMonths(current.start, -LOOKBACK_MONTHS);
  const used = [];

  for (let i = index - 1; i >= 0 && used.length < CLEAN_WEEKS_REQUIRED; i -= 1) {
    const week = weeks[i];
    if (earliest && week.start < earliest) break;
    if (week.partial) continue;
    if (!isClean(flags, i)) continue;
    used.push(i);
  }

  if (used.length < CLEAN_WEEKS_REQUIRED) {
    return { value: null, weeks: used.reverse(), reason: 'notEnoughClean' };
  }

  const value = used.reduce((sum, i) => sum + weeks[i].units, 0) / used.length;
  return { value, weeks: used.reverse(), reason: null };
}

/* ==========================================================================
   §5. Фактор 1 — відхилення поточного тижня від рівня

   Семь полос спецификации. Граница принадлежит более мягкой категории:
   ровно −5% это норма, ровно −10% незначительная просадка, ровно −20%
   просадка; вверх зеркально.

   Отсюда несимметричные сравнения: снизу полоса включает свою границу,
   сверху — нет. Полосы перечислены сверху вниз, и первое совпадение
   выигрывает, поэтому порядок здесь значащий.
   ========================================================================== */

export const FACTOR1_BANDS = [
  { id: 'strongGrowth', test: (d) => d > 20 },
  { id: 'growth', test: (d) => d > 10 && d <= 20 },
  { id: 'slightGrowth', test: (d) => d > 5 && d <= 10 },
  { id: 'normal', test: (d) => d >= -5 && d <= 5 },
  { id: 'slightDrop', test: (d) => d >= -10 && d < -5 },
  { id: 'drop', test: (d) => d >= -20 && d < -10 },
  { id: 'strongDrop', test: (d) => d < -20 },
];

/** Тон полосы: вверх / норма / вниз. Нужен виду для расходящейся шкалы. */
export const BAND_TONE = {
  strongGrowth: 'up',
  growth: 'up',
  slightGrowth: 'up',
  normal: 'flat',
  slightDrop: 'down',
  drop: 'down',
  strongDrop: 'down',
};

export function classifyFactor1(deviationPercent) {
  if (!Number.isFinite(deviationPercent)) return null;
  return FACTOR1_BANDS.find((band) => band.test(deviationPercent))?.id ?? null;
}

/**
 * @returns {{level: number|null, deviation: number|null, band: string|null,
 *            reason: string|null, levelWeeks: number[]}}
 */
export function factor1At(weeks, flags, index) {
  const level = levelAt(weeks, flags, index);
  if (level.value === null) {
    return { level: null, deviation: null, band: null, reason: level.reason, levelWeeks: level.weeks };
  }
  // Уровень 0 — это не «падение на 100%», а «сравнивать не с чем»: делить
  // на ноль нельзя, и процент здесь не имеет смысла.
  if (level.value === 0) {
    return { level: 0, deviation: null, band: null, reason: 'zeroLevel', levelWeeks: level.weeks };
  }

  const deviation = ((weeks[index].units - level.value) / level.value) * 100;
  return {
    level: level.value,
    deviation,
    band: classifyFactor1(deviation),
    reason: null,
    levelWeeks: level.weeks,
  };
}

/* ==========================================================================
   §6. Фактор 2 — напрямок рівня

   Спецификация говорит, по чему направление определяется («по чотирьох
   останніх значеннях рівня, без відсоткових порогів»), но не говорит, по
   какому правилу ряд признаётся растущим, стоящим или падающим. Это
   открытый вопрос №4 исходного документа.

   Поэтому здесь считается ровно то, что задано, — четыре значения уровня, —
   а вердикт возвращается как `verdict: null` с причиной 'ruleUndefined'.
   Взять любое правило (наклон регрессии, знак соседних разностей, первое
   против последнего) значило бы придумать порог: на одном и том же ряде
   они дают разный ответ.
   ========================================================================== */

export const FACTOR2_POINTS = 4;

export function factor2At(weeks, flags, index, points = FACTOR2_POINTS) {
  const values = [];
  for (let step = points - 1; step >= 0; step -= 1) {
    const at = index - step;
    if (at < 0) { values.push({ index: at, value: null, reason: 'noBase' }); continue; }
    const level = levelAt(weeks, flags, at);
    values.push({ index: at, value: level.value, reason: level.reason });
  }
  return { values, verdict: null, reason: 'ruleUndefined' };
}

/* ==========================================================================
   §7. Екстремуми за три місяці

   Максимум и минимум продаж по полным неделям среза. Спецификация требует
   их «і враховувати, і підсвічувати», но не говорит, влияют ли они на
   оценку недели и вправе ли входить в расчёт уровня (открытый вопрос №5).
   Поэтому здесь они только находятся: из набора чистых недель движок их
   не исключает — такого правила не задано.
   ========================================================================== */

export function extremes(weeks) {
  const full = weeks.filter((w) => !w.partial);
  if (!full.length) return { maxIndex: null, minIndex: null };

  let max = full[0];
  let min = full[0];
  for (const week of full) {
    if (week.units > max.units) max = week;
    if (week.units < min.units) min = week;
  }
  // Все недели равны — «максимум» и «минимум» ничего не выделяют
  return max.units === min.units
    ? { maxIndex: null, minIndex: null }
    : { maxIndex: max.index, minIndex: min.index };
}

/* ==========================================================================
   §8. Декомпозиція сезонності

   Спецификация задаёт глубину истории и что делать на каждой глубине.
   Метод расчёта и форма подачи не описаны (открытый вопрос №6) — поэтому
   движок определяет только уровень глубины, а полную декомпозицию не
   изображает.

   На глубине «менше року» правило задано целиком: помесячный ряд для
   трендовости плюс обязательная пометка «продається менше 1 року». Его и
   считаем — это единственная ветка, которую можно выполнить дословно.
   ========================================================================== */

export function historyDepth(weeks) {
  const full = weeks.filter((w) => !w.partial);
  if (!full.length) return { months: 0, tier: 'lessThanYear' };

  const months = monthsBetween(full[0].start, full.at(-1).end) ?? 0;
  let tier = 'lessThanYear';
  if (months >= 24) tier = 'full';
  else if (months >= 18) tier = 'oneAndHalf';
  else if (months >= 12) tier = 'oneYear';
  return { months, tier };
}

/**
 * Помесячные суммы для трендовости. Неделя относится к месяцу своего
 * понедельника: делить неделю между двумя месяцами нечем — дневных данных
 * в выгрузке нет, и распил по долям был бы выдуманным числом.
 */
export function monthlyTrend(weeks) {
  const byMonth = new Map();
  for (const week of weeks) {
    if (week.partial) continue;
    const key = week.start.slice(0, 7);
    const bucket = byMonth.get(key) || { month: key, units: 0, weeks: 0 };
    bucket.units += week.units;
    bucket.weeks += 1;
    byMonth.set(key, bucket);
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/* ==========================================================================
   §9. Розрізи по країнах

   «Продажі аналізуються окремо по кожній країні. Порядок країн — від
   найсильнішої до найслабшої». Порядок берётся из данных, а не из списка
   в документе: список там — снимок того же правила на момент написания,
   и зашитый порядок разошёлся бы с продажами при первом же сдвиге.
   ========================================================================== */

/**
 * Оценка базовой недели по каждой площадке, отсортированная по продажам.
 * Псевдоплощадка `other` («Вне Amazon») в разрез не идёт: это не страна.
 */
export function byCountry(data, promotions, { asins = new Set() } = {}) {
  const rows = [];
  for (const code of Object.keys(data?.marketplaces || {})) {
    if (code === 'other') continue;

    const weeks = buildSeries(data, { marketplace: code, asins });
    const index = baseWeekIndex(weeks);
    if (index < 0) continue;

    const flags = flagWeeks(weeks, promotions, { marketplace: code, asins });
    const factor1 = factor1At(weeks, flags, index);

    rows.push({
      code,
      name: data.marketplaces[code]?.name || code,
      units: weeks[index].units,
      clean: isClean(flags, index),
      flags: flags[index],
      ...factor1,
    });
  }
  return rows.sort((a, b) => b.units - a.units);
}

/* ==========================================================================
   §10. Два пули стоку

   «Спільний сток ЄС» и «Окремий сток UK». Спецификация относит остатки к
   дополнительным входным данным, которые учитываются на этапе вывода,
   и оставляет открытыми единицы измерения и порог «проблема з наявністю»
   (открытый вопрос №15). Данных об остатках в выгрузке тоже нет.

   Здесь только разбиение площадок по пулам — это задано дословно. Числа
   остатков появятся, когда появится сборщик и когда будет задан порог.
   ========================================================================== */

export const STOCK_POOLS = {
  eu: ['DE', 'FR', 'ES', 'IT', 'NL', 'SE', 'IE', 'BE', 'PL'],
  uk: ['GB'],
};

export function poolFor(code) {
  if (STOCK_POOLS.uk.includes(code)) return 'uk';
  if (STOCK_POOLS.eu.includes(code)) return 'eu';
  return null;
}

/* ==========================================================================
   §11. Варіації

   Семьи вариаций уже сведены сборщиком: `families[].parents` и `asins[].family`.
   Спецификация требует видеть динамику на обоих уровнях, но не говорит,
   применяется ли оценка недели к паренту так же, как к чайлду, и делает ли
   прапорець на одном чайлде нечистым весь парент (открытый вопрос №7).

   Поэтому движок собирает ряды обоих уровней, а оценку уровня и факторов
   для парента не выдаёт: она зависит ровно от того правила, которого нет.
   ========================================================================== */

export function variationRows(data, { marketplace = 'all' } = {}) {
  const out = [];
  for (const [familyId, family] of Object.entries(data?.families || {})) {
    const children = family.asins || [];
    if (children.length < 2) continue;      // одиночный товар — не вариация

    const parentWeeks = buildSeries(data, { marketplace, asins: new Set(children) });
    const parentIndex = baseWeekIndex(parentWeeks);

    out.push({
      familyId,
      label: family.label || familyId,
      units: parentIndex < 0 ? 0 : parentWeeks[parentIndex].units,
      children: children.map((asin) => {
        const weeks = buildSeries(data, { marketplace, asins: new Set([asin]) });
        const index = baseWeekIndex(weeks);
        return {
          asin,
          name: data.asins?.[asin]?.name || asin,
          units: index < 0 ? 0 : weeks[index].units,
        };
      }).sort((a, b) => b.units - a.units),
    });
  }
  return out.sort((a, b) => b.units - a.units);
}
