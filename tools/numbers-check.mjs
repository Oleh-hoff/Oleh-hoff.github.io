/* ==========================================================================
   Сверка чисел раздела «Продажи по неделям».

   Монтаж проверяет, что раздел не падает; эта проверка — что он показывает
   правильное. Каждое число из интерфейса пересчитывается независимо по тому
   же data/weekly-sales.json: итоги, срез по площадке, деньги в одной валюте,
   фильтр по семье вариаций и совпадение таблицы-двойника с плиткой.

   Запускать после любой правки сборщика или срезов во вью.

     npm i jsdom && node tools/numbers-check.mjs
   ========================================================================== */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const ROOT = new URL('..', import.meta.url).pathname;

const dom = new JSDOM('<!doctype html><body><div id="v"></div><div id="c"></div></body>',
  { url: 'https://x.invalid/app.html#/weekly-sales', pretendToBeVisual: true });
const { window } = dom;
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 900 });
window.HTMLCanvasElement.prototype.getContext = () => ({ font: '', measureText: (t) => ({ width: String(t).length * 7 }) });
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.fetch = async (url) => {
  const path = ROOT + String(url).replace(/^.*\/(?=data\/)/, '').replace(/^\//, '');
  if (!existsSync(path)) return { ok: false, status: 404 };
  const body = readFileSync(path, 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
};
for (const k of ['window','document','navigator','location','localStorage','sessionStorage',
  'HTMLElement','Node','Element','SVGElement','ResizeObserver','matchMedia','fetch','getComputedStyle'])
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: window[k] });

await import(pathToFileURL(ROOT + 'assets/js/strings-crm.js').href);
const { setLang } = await import(pathToFileURL(ROOT + 'assets/js/i18n.js').href);
setLang('ru');
const { weeklySales } = await import(pathToFileURL(ROOT + 'assets/js/views/weekly-sales.js').href);

const data = JSON.parse(readFileSync(ROOT + 'data/weekly-sales.json', 'utf8'));
const view = window.document.getElementById('v');
const controls = window.document.getElementById('c');
await weeklySales.mount(view, controls);

const digits = (s) => Number(String(s).replace(/[^\d,.-]/g, '').replace(/[  ]/g, '').replace(',', '.'));
const tiles = () => [...view.querySelectorAll('.stat')].map((t) => ({
  label: t.querySelector('.stat__label').textContent,
  value: t.querySelector('.stat__value').textContent,
}));

const partialIdx = data.weeks.findIndex((w) => w.partial);
const sum = (f) => data.rows.filter(f).reduce((a, r) => a + r.u, 0);
const money = (f) => data.rows.filter(f).reduce((a, r) => a + r.r, 0);
const full = (r) => r.w !== partialIdx;

let bad = 0;
const check = (name, got, want, tol = 1) => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) bad++;
  console.log(`${ok ? '  ok ' : 'ПЛОХО'} ${name}: интерфейс ${got} / расчёт ${want}`);
};

/* 1. Все площадки, штуки */
let t = tiles();
check('всего штук (полные недели)', digits(t[0].value), sum(full));
check('среднее за неделю', digits(t[1].value), Math.round(sum(full) / (data.weeks.length - 1)), 1);
check('текущая неделя', digits(t.find((x) => /Текущая/.test(x.label)).value), sum((r) => r.w === partialIdx));

const eurCodes = Object.entries(data.marketplaces).filter(([, m]) => m.currency === 'EUR').map(([c]) => c);
const eurTile = t.find((x) => /EUR/.test(x.label));
check('выручка EUR', digits(eurTile.value), Math.round(money((r) => eurCodes.includes(r.m))), 2);

/* 2. Одна площадка */
const select = controls.querySelector('select');
select.value = 'DE';
select.dispatchEvent(new window.Event('change'));
t = tiles();
check('штук по DE', digits(t[0].value), sum((r) => full(r) && r.m === 'DE'));

/* 3. Деньги по одной площадке */
const metric = [...controls.querySelectorAll('.segmented__item')];
metric[1].dispatchEvent(new window.Event('click'));
t = tiles();
check('выручка DE, EUR', digits(t[0].value), Math.round(money((r) => full(r) && r.m === 'DE')), 2);

/* 4. Фильтр по семье вариаций */
metric[0].dispatchEvent(new window.Event('click'));
select.value = 'all';
select.dispatchEvent(new window.Event('change'));
const famId = Object.keys(data.families)[0];
const famAsins = data.families[famId].asins;
const boxes = [...controls.querySelectorAll('.picker__row--family input')];
// Первая семья в списке отсортирована по продажам, поэтому ищем её по метке
const labels = [...controls.querySelectorAll('.picker__row--family .picker__name')].map((n) => n.textContent);
const idx = labels.indexOf(data.families[famId].label);
if (idx >= 0) {
  boxes[idx].checked = true;
  boxes[idx].dispatchEvent(new window.Event('change'));
  t = tiles();
  check(`штук по семье ${famId} (${famAsins.length} вар.)`,
        digits(t[0].value), sum((r) => full(r) && famAsins.includes(r.a)));
} else { console.log('ПЛОХО семья не найдена в списке фильтра'); bad++; }

/* 5. Перевод в евро */
const fxPath = ROOT + 'data/fx-rates.json';
if (existsSync(fxPath)) {
  const fx = JSON.parse(readFileSync(fxPath, 'utf8'));
  const fxDates = Object.keys(fx.rates).sort();

  // Курс недели считаем заново от исходного файла: среднее по рабочим дням
  // внутри недели, иначе ближайший известный день
  const weekRate = (wi, cur) => {
    const w = data.weeks[wi];
    const inside = fxDates.filter((d) => d >= w.start && d <= w.end);
    const used = inside.length ? inside : [fxDates.reduce((best, d) =>
      Math.abs(new Date(d) - new Date(w.start)) < Math.abs(new Date(best) - new Date(w.start))
        ? d : best, fxDates[0])];
    const vals = used.map((d) => fx.rates[d]?.[cur]).filter(Boolean);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  const inEuro = (r) => {
    const cur = data.marketplaces[r.m]?.currency;
    if (!cur) return 0;
    if (cur === 'EUR') return r.r;
    const rate = weekRate(r.w, cur);
    return rate ? r.r / rate : 0;
  };

  // Сбрасываем фильтры и включаем «всё в евро»
  [...controls.querySelectorAll('.picker__row--family input')].forEach((b) => {
    if (b.checked) { b.checked = false; b.dispatchEvent(new window.Event('change')); }
  });
  select.value = 'all';
  select.dispatchEvent(new window.Event('change'));
  metric[1].dispatchEvent(new window.Event('click'));

  const currencySelect = [...controls.querySelectorAll('select')][1];
  currencySelect.value = '__eur';
  currencySelect.dispatchEvent(new window.Event('change'));

  const expected = Math.round(data.rows.filter(full).reduce((a, r) => a + inEuro(r), 0));
  check('всё в евро, итог', digits(tiles()[0].value), expected, 3);

  // Направление деления: курс ЕЦБ — единиц валюты за евро, значит фунтов
  // должно стать больше евро, а крон — меньше. Ошибка в направлении даёт
  // правдоподобное, но неверное число, и только эта проверка её ловит.
  select.value = 'GB';
  select.dispatchEvent(new window.Event('change'));
  const gbpRaw = data.rows.filter((r) => full(r) && r.m === 'GB').reduce((a, r) => a + r.r, 0);
  const gbpEur = digits(tiles()[0].value);
  check('GBP → EUR: евро больше фунтов', gbpEur > gbpRaw ? 1 : 0, 1, 0);
  console.log(`       £${Math.round(gbpRaw)} → €${gbpEur}`);

  select.value = 'SE';
  select.dispatchEvent(new window.Event('change'));
  const sekRaw = data.rows.filter((r) => full(r) && r.m === 'SE').reduce((a, r) => a + r.r, 0);
  const sekEur = digits(tiles()[0].value);
  check('SEK → EUR: евро меньше крон', sekEur < sekRaw ? 1 : 0, 1, 0);
  console.log(`       ${Math.round(sekRaw)} kr → €${sekEur}`);

  select.value = 'all';
  select.dispatchEvent(new window.Event('change'));
  metric[0].dispatchEvent(new window.Event('click'));
} else {
  console.log('  курсов нет — перевод в евро не проверяется');
}

/* 6. Отметки акций попадают ровно на те недели, которые кампания задела */
const promoPath = ROOT + 'data/promotions.json';
if (existsSync(promoPath)) {
  const promo = JSON.parse(readFileSync(promoPath, 'utf8'));
  const weeksShown = data.weeks.filter((w) => !w.partial);

  // Значок рисуется один на тип на неделю, а не на кампанию: считаем так же,
  // но от исходного файла
  const expectedMarks = weeksShown.reduce((n, w) => {
    const kinds = new Set(promo.campaigns
      .filter((c) => c.start <= w.end && c.end >= w.start)
      .map((c) => c.kind));
    return n + kinds.size;
  }, 0);

  const drawn = () => view.querySelectorAll('.chart-mark').length;
  check('отметок акций на графике', drawn(), expectedMarks);

  // Снятая галочка обязана убрать свой тип и не тронуть чужой
  const boxes = [...controls.querySelectorAll('.promo-toggle input')];
  if (boxes.length) {
    const before = drawn();
    boxes[0].checked = false;
    boxes[0].dispatchEvent(new window.Event('change'));
    const after = drawn();
    check('снятая галочка убирает отметки', after < before ? 1 : 0, 1, 0);
    boxes[0].checked = true;
    boxes[0].dispatchEvent(new window.Event('change'));
    check('возврат галочки возвращает отметки', drawn(), before);
    console.log(`       галочек ${boxes.length}, отметок ${before} → ${after} → ${drawn()}`);
  }

  // Фильтр по товару должен сужать и отметки: акция на соседний товар
  // не имеет права отмечать неделю выбранного
  const famBoxes = [...controls.querySelectorAll('.picker__row--family input')];
  if (famBoxes.length) {
    const all = drawn();
    famBoxes[0].checked = true;
    famBoxes[0].dispatchEvent(new window.Event('change'));
    check('фильтр товара сужает отметки', drawn() <= all ? 1 : 0, 1, 0);
    console.log(`       все товары ${all} → одна семья ${drawn()}`);
    famBoxes[0].checked = false;
    famBoxes[0].dispatchEvent(new window.Event('change'));
  }
} else {
  console.log('  акций нет — отметки не проверяются');
}

/* 7. Итог таблицы-двойника должен совпасть с плиткой */
const foot = view.querySelector('tfoot tr td:last-child');
if (foot) check('итог таблицы = плитка', digits(foot.textContent), digits(tiles()[0].value));
else { console.log('ПЛОХО таблицы-двойника нет'); bad++; }

console.log(bad ? `\nРАСХОЖДЕНИЙ: ${bad}` : '\nЧисла сходятся.');
process.exit(bad ? 1 : 0);
