/* ==========================================================================
   Сверка чисел раздела «Еженедельный анализ».

   Монтаж проверяет, что раздел не падает; эта проверка — что он считает
   правильное. Раздел почти целиком состоит из расчёта, и ошибка здесь не
   ломает страницу, а тихо показывает неверную оценку недели.

   Каждая величина пересчитывается независимо от движка: прямо по
   data/weekly-sales.json и data/promotions.json, другим кодом.

   Отдельно проверяются границы полос Фактора 1 на синтетике: в живых
   данных ровно −10% и ровно −20% может не встретиться никогда, а правило
   «граница принадлежит более мягкой категории» ломается именно на них.

     npm i jsdom && node tools/analysis-check.mjs
   ========================================================================== */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const E = await import(pathToFileURL(ROOT + 'assets/js/weekly-analysis-engine.js').href);

const data = JSON.parse(readFileSync(ROOT + 'data/weekly-sales.json', 'utf8'));
const promos = JSON.parse(readFileSync(ROOT + 'data/promotions.json', 'utf8'));

const problems = [];
const ok = (label, mine, theirs) => {
  const same = JSON.stringify(mine) === JSON.stringify(theirs);
  console.log(`  ${same ? 'ok ' : 'НЕТ'}  ${label}: движок ${JSON.stringify(theirs)} / расчёт ${JSON.stringify(mine)}`);
  if (!same) problems.push(label);
};

/* --------------------------------------------------------------------------
   1. Полосы Фактора 1 на границах

   Спецификация: «Межа належить м'якшій категорії: рівно −5% це норма,
   рівно −10% це незначна просадка, рівно −20% це просадка. Дзеркально вгору».
   -------------------------------------------------------------------------- */

console.log('\nПолосы Фактора 1');
const BOUNDARIES = [
  [40, 'strongGrowth'], [20.01, 'strongGrowth'],
  [20, 'growth'], [15, 'growth'], [10.01, 'growth'],
  [10, 'slightGrowth'], [7, 'slightGrowth'], [5.01, 'slightGrowth'],
  [5, 'normal'], [0, 'normal'], [-5, 'normal'],
  [-5.01, 'slightDrop'], [-7, 'slightDrop'], [-10, 'slightDrop'],
  [-10.01, 'drop'], [-15, 'drop'], [-20, 'drop'],
  [-20.01, 'strongDrop'], [-60, 'strongDrop'], [-100, 'strongDrop'],
];
let bandFails = 0;
for (const [deviation, expected] of BOUNDARIES) {
  const got = E.classifyFactor1(deviation);
  if (got !== expected) {
    console.log(`  НЕТ  ${deviation}% → ${got}, ожидалось ${expected}`);
    bandFails += 1;
  }
}
if (bandFails) problems.push('полосы Фактора 1');
else console.log(`  ok   все ${BOUNDARIES.length} точек, включая границы, попали в свою полосу`);

// Ни одно значение не должно оставаться без полосы: полосы обязаны покрывать
// всю числовую ось, иначе неделя окажется без оценки без всякой причины
const uncovered = [];
for (let d = -300; d <= 300; d += 0.5) if (!E.classifyFactor1(d)) uncovered.push(d);
if (uncovered.length) {
  problems.push('дыра в полосах');
  console.log(`  НЕТ  без полосы остались значения: ${uncovered.slice(0, 5).join(', ')}`);
} else {
  console.log('  ok   полосы покрывают ось целиком, дыр нет');
}

/* --------------------------------------------------------------------------
   2. Календарь отката
   -------------------------------------------------------------------------- */

console.log('\nОткат на два месяца');
ok('обычная дата', '2026-06-17', E.addMonths('2026-08-17', -2));
ok('через год', '2025-12-15', E.addMonths('2026-01-15', -1));
ok('зажим 31 марта', '2026-02-28', E.addMonths('2026-03-31', -1));
ok('високосный февраль', '2024-02-29', E.addMonths('2024-03-31', -1));

/* --------------------------------------------------------------------------
   3. Недельный ряд: независимая сумма по строкам
   -------------------------------------------------------------------------- */

console.log('\nНедельный ряд');

function unitsByWeek({ marketplace = 'all', asins = null }) {
  const out = data.weeks.map(() => 0);
  for (const row of data.rows) {
    if (marketplace !== 'all' && row.m !== marketplace) continue;
    if (asins && !asins.includes(row.a)) continue;
    out[row.w] += row.u || 0;
  }
  return out;
}

ok('все площадки, все товары',
  unitsByWeek({}),
  E.buildSeries(data, {}).map((w) => w.units));

ok('только DE',
  unitsByWeek({ marketplace: 'DE' }),
  E.buildSeries(data, { marketplace: 'DE' }).map((w) => w.units));

const family = Object.entries(data.families).find(([, f]) => (f.asins || []).length > 2);
ok(`семья ${family[0]}`,
  unitsByWeek({ asins: family[1].asins }),
  E.buildSeries(data, { asins: new Set(family[1].asins) }).map((w) => w.units));

// Сумма по всем площадкам обязана сойтись с общим итогом: если фильтр
// теряет строки, разойдётся именно здесь
const perMarket = Object.keys(data.marketplaces)
  .map((code) => E.buildSeries(data, { marketplace: code }).reduce((s, w) => s + w.units, 0))
  .reduce((a, b) => a + b, 0);
ok('сумма площадок = общий итог',
  E.buildSeries(data, {}).reduce((s, w) => s + w.units, 0),
  perMarket);

/* --------------------------------------------------------------------------
   4. Базовая неделя и прапорцы
   -------------------------------------------------------------------------- */

console.log('\nБазовая неделя и прапорцы');

const lastFull = data.weeks.reduce((acc, w, i) => (w.partial ? acc : i), -1);
ok('последняя полная неделя', lastFull, E.baseWeekIndex(E.buildSeries(data, {})));

const SLICE = { marketplace: 'PL', asins: new Set(['B072PPT9V3']) };
const weeks = E.buildSeries(data, SLICE);
const flags = E.flagWeeks(weeks, promos, SLICE);

// Независимый пересчёт задетых недель: кампания задевает неделю, если
// пересекается с ней хотя бы одним днём
const dirtyMine = data.weeks.map((week) => promos.campaigns.some((c) =>
  ['coupon', 'best_deal', 'lightning_deal'].includes(c.kind)
  && c.m === 'PL'
  && (c.asins || []).includes('B072PPT9V3')
  && c.start <= week.end && c.end >= week.start));

ok('недели с прапорцами (PL / B072PPT9V3)',
  dirtyMine,
  weeks.map((w) => !E.isClean(flags, w.index)));

/* --------------------------------------------------------------------------
   5. Уровень: три чистые недели в пределах двух месяцев
   -------------------------------------------------------------------------- */

console.log('\nУровень');

const base = E.baseWeekIndex(weeks);
const engineLevel = E.levelAt(weeks, flags, base);

// Пересчёт вручную: идём назад, пропускаем неполные и задетые, стоп по дате
const earliest = E.addMonths(weeks[base].start, -2);
const mineUsed = [];
for (let i = base - 1; i >= 0 && mineUsed.length < 3; i -= 1) {
  if (weeks[i].start < earliest) break;
  if (weeks[i].partial) continue;
  if (dirtyMine[i]) continue;
  mineUsed.push(i);
}
const mineValue = mineUsed.length === 3
  ? mineUsed.reduce((s, i) => s + weeks[i].units, 0) / 3
  : null;

ok('недели, вошедшие в уровень', mineUsed.slice().reverse(), engineLevel.weeks);
ok('значение уровня', mineValue, engineLevel.value);

// Ни одна неделя уровня не смеет быть задетой, неполной или позже базовой
for (const i of engineLevel.weeks) {
  if (dirtyMine[i]) problems.push(`в уровень попала задетая неделя ${i}`);
  if (weeks[i].partial) problems.push(`в уровень попала неполная неделя ${i}`);
  if (i >= base) problems.push(`в уровень попала неделя ${i} не раньше базовой`);
  if (weeks[i].start < earliest) problems.push(`неделя ${i} вышла за окно отката`);
}
console.log(`  ok   ${engineLevel.weeks.length} недель уровня: все чистые, полные, раньше базовой и внутри окна`);

// Текущая неделя в расчёт не входит — проверяем явно
if (engineLevel.weeks.includes(base)) problems.push('базовая неделя вошла в собственный уровень');

/* --------------------------------------------------------------------------
   6. Фактор 1 на живом срезе
   -------------------------------------------------------------------------- */

console.log('\nФактор 1');

const f1 = E.factor1At(weeks, flags, base);
const mineDeviation = mineValue === null || mineValue === 0
  ? null
  : ((weeks[base].units - mineValue) / mineValue) * 100;

ok('отклонение', mineDeviation, f1.deviation);
ok('полоса', mineDeviation === null ? null : E.classifyFactor1(mineDeviation), f1.band);

// Уровень нуль не должен давать ни −100%, ни бесконечности
const zero = E.factor1At([{ index: 0, units: 0, partial: false, start: '2026-01-05', end: '2026-01-11' },
  { index: 1, units: 0, partial: false, start: '2026-01-12', end: '2026-01-18' },
  { index: 2, units: 0, partial: false, start: '2026-01-19', end: '2026-01-25' },
  { index: 3, units: 7, partial: false, start: '2026-01-26', end: '2026-02-01' }],
[[], [], [], []], 3);
ok('нулевой уровень не даёт процента', { deviation: null, reason: 'zeroLevel' },
  { deviation: zero.deviation, reason: zero.reason });

/* --------------------------------------------------------------------------
   7. Фактор 2 — вердикта быть не должно

   Это не придирка к оформлению: если однажды кто-то подставит сюда правило,
   на дашборде появится вердикт, которого процесс не задавал.
   -------------------------------------------------------------------------- */

console.log('\nФактор 2');
const f2 = E.factor2At(weeks, flags, base);
ok('четыре точки', 4, f2.values.length);
ok('вердикт не выдуман', { verdict: null, reason: 'ruleUndefined' },
  { verdict: f2.verdict, reason: f2.reason });

/* --------------------------------------------------------------------------
   8. Экстремумы и глубина истории
   -------------------------------------------------------------------------- */

console.log('\nЭкстремумы и история');

const all = E.buildSeries(data, {});
const full = all.filter((w) => !w.partial);
const mineMax = full.reduce((a, b) => (b.units > a.units ? b : a)).index;
const mineMin = full.reduce((a, b) => (b.units < a.units ? b : a)).index;
ok('максимум и минимум', { maxIndex: mineMax, minIndex: mineMin }, E.extremes(all));

// Неполная неделя не имеет права стать минимумом: её отсчёт не закончен
const marks = E.extremes(all);
if (all[marks.minIndex]?.partial || all[marks.maxIndex]?.partial) {
  problems.push('в экстремумы попала неполная неделя');
}

const depth = E.historyDepth(all);
ok('глубина истории — меньше года', 'lessThanYear', depth.tier);

const monthly = E.monthlyTrend(all);
const mineMonthly = {};
for (const w of all) {
  if (w.partial) continue;
  const key = w.start.slice(0, 7);
  mineMonthly[key] = (mineMonthly[key] || 0) + w.units;
}
ok('помесячные суммы', mineMonthly,
  Object.fromEntries(monthly.map((m) => [m.month, m.units])));
ok('месяцы покрывают все полные недели',
  full.length, monthly.reduce((s, m) => s + m.weeks, 0));

/* --------------------------------------------------------------------------
   9. Разрез по странам
   -------------------------------------------------------------------------- */

console.log('\nРазрез по странам');

const countries = E.byCountry(data, promos, {});
ok('псевдоплощадки «Вне Amazon» в разрезе нет', false,
  countries.some((r) => r.code === 'other'));

const sorted = countries.every((r, i) => i === 0 || countries[i - 1].units >= r.units);
ok('порядок от сильной к слабой', true, sorted);

// Продажи страны в разрезе обязаны сойтись с прямой суммой по строкам
for (const row of countries.slice(0, 3)) {
  const mine = data.rows
    .filter((r) => r.m === row.code && r.w === lastFull)
    .reduce((s, r) => s + (r.u || 0), 0);
  ok(`${row.code}: продажи базовой недели`, mine, row.units);
}

// Каждая страна разложена ровно в один пул стока
for (const row of countries) {
  if (!E.poolFor(row.code)) problems.push(`площадка ${row.code} не попала ни в один пул стока`);
}
console.log(`  ok   все ${countries.length} площадок разложены по пулам ЕС / UK`);

/* --------------------------------------------------------------------------
   10. Вариации: парент = сумма чайлдов
   -------------------------------------------------------------------------- */

console.log('\nВариации');

const vars = E.variationRows(data, {});
let varFails = 0;
for (const family of vars) {
  const sum = family.children.reduce((s, c) => s + c.units, 0);
  if (sum !== family.units) {
    console.log(`  НЕТ  ${family.familyId}: парент ${family.units}, сумма чайлдов ${sum}`);
    varFails += 1;
  }
}
if (varFails) problems.push('парент не равен сумме чайлдов');
else console.log(`  ok   во всех ${vars.length} вариациях парент = сумма чайлдов`);

/* --------------------------------------------------------------------------
   Итог
   -------------------------------------------------------------------------- */

console.log(problems.length ? '\nПРОБЛЕМЫ:' : '\nЧисла сходятся.');
problems.forEach((p) => console.log('  · ' + p));
process.exit(problems.length ? 1 : 0);
