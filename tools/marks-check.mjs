/* ==========================================================================
   Слой отметок событий над столбцами.

   Проверяется на синтетических данных, а не на выгрузке: нужны случаи,
   которых в живых данных может не оказаться — неделя без отметок, неделя с
   двумя кампаниями одного типа, полное снятие отметок.

   Главное правило, которое здесь и стережётся: значок один на тип на неделю,
   а не на кампанию, и стоит он НАД полем графика, а не поверх столбцов.

     npm i jsdom && node tools/marks-check.mjs
   ========================================================================== */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const ROOT = new URL('..', import.meta.url).pathname;

const dom = new JSDOM('<!doctype html><body><div id="c"></div></body>', { pretendToBeVisual: true });
const { window } = dom;
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
window.HTMLCanvasElement.prototype.getContext = () => ({ font: '', measureText: (t) => ({ width: String(t).length * 7 }) });
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
for (const k of ['window','document','Node','Element','HTMLElement','SVGElement','ResizeObserver'])
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: window[k] });

const { createStackedColumnChart } = await import(pathToFileURL(ROOT + 'assets/js/charts.js').href);

const box = window.document.getElementById('c');
const chart = createStackedColumnChart(box);

const labels = ['1 нед', '2 нед', '3 нед', '4 нед'];
const series = [{ name: 'DE', values: [10, 20, 30, 40] }, { name: 'FR', values: [5, 5, 5, 5] }];

let bad = 0;
const check = (ok, msg) => { if (!ok) { bad++; console.log('ПЛОХО ' + msg); } else console.log('  ok  ' + msg); };

/* --- без отметок --- */
chart.update({ labels, series });
check(box.querySelectorAll('.chart-mark').length === 0, 'без marks значков нет');
// Верх поля — самая высокая линия сетки, а не первая: первая это ноль,
// и она стоит на месте всегда, потому что высота графика фиксирована
const topGrid = () => Math.min(...[...box.querySelectorAll('.chart-grid')]
  .map((l) => Number(l.getAttribute('y1'))));
const plotTopNoMarks = topGrid();

/* --- с отметками --- */
chart.update({
  labels, series,
  marks: [
    [{ kind: 'coupon', label: 'Купон А · −10% · 2026-05-18 — 2026-05-24' }],
    [],
    [{ kind: 'coupon', label: 'Купон Б' }, { kind: 'best_deal', label: 'Дил В' },
     { kind: 'coupon', label: 'Купон Г' }],
    [{ kind: 'lightning_deal', label: 'Молния Д' }],
  ],
});

const marks = box.querySelectorAll('.chart-mark');
// Значок один на тип на неделю: у третьей недели два купона дают ОДИН круг
check(marks.length === 4, `значков ${marks.length}, ожидали 4 (1 + 0 + 2 + 1)`);

const shapes = [...marks].map((m) => m.tagName.toLowerCase());
check(shapes.filter((s) => s === 'circle').length === 2, `кругов ${shapes.filter((s) => s === 'circle').length}, ожидали 2`);
check(shapes.filter((s) => s === 'polygon').length === 2, `многоугольников ${shapes.filter((s) => s === 'polygon').length}, ожидали 2`);

// Два купона одной недели должны попасть в одну подсказку, а не потеряться
const titles = [...marks].map((m) => m.querySelector('title')?.textContent || '');
check(titles.some((x) => x.includes('Купон Б') && x.includes('Купон Г')),
  'оба купона недели попали в подсказку');
check(titles.some((x) => x.includes('2026-05-18 — 2026-05-24')), 'даты кампании видны в подсказке');

// Отметки обязаны стоять НАД полем графика, а не поверх столбцов
const plotTop = topGrid();
const maxMarkY = Math.max(...[...marks].map((m) =>
  Number(m.getAttribute('cy') ?? m.getAttribute('points').split(' ').pop().split(',')[1])));
check(plotTop > plotTopNoMarks, `поле графика опустилось под полосу отметок (${plotTopNoMarks} → ${plotTop})`);
check(maxMarkY < plotTop, `нижний край значка ${maxMarkY} выше верха поля ${plotTop}`);

/* --- отметки снимаются --- */
chart.update({ labels, series, marks: [[], [], [], []] });
check(box.querySelectorAll('.chart-mark').length === 0, 'пустые marks убирают значки');

console.log(bad ? `\nПРОБЛЕМ: ${bad}` : '\nСлой отметок в порядке.');
process.exit(bad ? 1 : 0);
