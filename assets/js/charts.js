/* ==========================================================================
   Слой графиков — рисованный SVG, без внешних библиотек.

   Спецификации марок (соблюдаются во всех типах):
     • линия 2px, скруглённые стыки и концы;
     • маркер ≥ 8px (r ≥ 4) с кольцом 2px цвета поверхности — чтобы точка
       читалась там, где пересекает линию;
     • столбец ≤ 24px, скругление 4px только на конце данных, у базовой
       линии — прямой угол;
     • между соприкасающимися марками зазор 2px цветом поверхности, а не
       обводка: обводка добавляет чернил, которые не несут данных;
     • сетка и оси — сплошной hairline на шаг от поверхности, никогда не пунктир.

   Цвета берутся из CSS-переменных через inline-стиль (fill: var(--series-1)),
   поэтому смена темы не требует перерисовки — браузер пересчитает сам.
   Подписи и значения носят текстовые токены, а не цвет серии: светлые
   тональности палитры нечитаемы как текст.
   ========================================================================== */

import { formatNumber, niceTicks } from './format.js';

const NS = 'http://www.w3.org/2000/svg';

/* --------------------------------------------------------------------------
   Утилиты
   -------------------------------------------------------------------------- */

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  }
  return node;
}

/** Замер ширины текста без вставки в DOM — нужен, чтобы не обрезать подписи. */
const measureCtx = document.createElement('canvas').getContext('2d');
function measureText(text, font = '400 12px system-ui, sans-serif') {
  measureCtx.font = font;
  return measureCtx.measureText(String(text)).width;
}

/**
 * Прямоугольник со скруглением только на «конце данных».
 * side: 'top' — колонка растёт вверх, 'right' — горизонтальный столбец.
 * Скругление ужимается, если марка короче радиуса, иначе форма ломается.
 */
function barPath(x, y, w, h, radius, side) {
  const r = Math.max(0, Math.min(radius, side === 'top' ? h : w, (side === 'top' ? w : h) / 2));
  if (r === 0) return `M${x},${y}h${w}v${h}h${-w}Z`;

  if (side === 'top') {
    return `M${x},${y + h}V${y + r}a${r},${r} 0 0 1 ${r},${-r}h${w - 2 * r}`
         + `a${r},${r} 0 0 1 ${r},${r}V${y + h}Z`;
  }
  return `M${x},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}`
       + `a${r},${r} 0 0 1 ${-r},${r}H${x}Z`;
}

function seriesColor(index) {
  return `var(--series-${(index % 8) + 1})`;
}

/* --------------------------------------------------------------------------
   Подсказка (общая для всех графиков)

   Значение — сильный элемент, имя серии — вторичный: у читателя уже есть
   серия, ему нужно число. Ключ серии — короткий штрих её цвета, а не
   залитый квадрат: при такой плотности квадрат весит больше, чем должен.
   Имена категорий вставляются только textContent — они приходят из данных
   и не обязаны быть безопасной разметкой.
   -------------------------------------------------------------------------- */

function createTooltip(host) {
  const tip = document.createElement('div');
  tip.className = 'chart-tooltip';
  tip.setAttribute('role', 'status');
  tip.hidden = true;
  host.appendChild(tip);

  return {
    node: tip,

    show(title, rows, x, y) {
      tip.replaceChildren();

      const head = document.createElement('div');
      head.className = 'chart-tooltip__title';
      head.textContent = title;
      tip.appendChild(head);

      for (const row of rows) {
        const line = document.createElement('div');
        line.className = 'chart-tooltip__row';

        const key = document.createElement('span');
        key.className = 'chart-tooltip__key';
        if (row.color) key.style.background = row.color;
        line.appendChild(key);

        const name = document.createElement('span');
        name.className = 'chart-tooltip__name';
        name.textContent = row.name;
        line.appendChild(name);

        const value = document.createElement('span');
        value.className = 'chart-tooltip__value';
        value.textContent = row.value;
        line.appendChild(value);

        tip.appendChild(line);
      }

      tip.hidden = false;
      this.move(x, y);
    },

    move(x, y) {
      const box = host.getBoundingClientRect();
      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      // Держим подсказку внутри карточки: у краёв она переезжает на другую сторону
      const left = Math.min(Math.max(x + 14, 8), Math.max(8, box.width - w - 8));
      const top = Math.min(Math.max(y - h - 12, 8), Math.max(8, box.height - h - 8));
      tip.style.transform = `translate(${left}px, ${top}px)`;
    },

    hide() { tip.hidden = true; },
  };
}

/** Пустое состояние: без него график молча рисует ничего и выглядит сломанным. */
function renderEmpty(container, text) {
  const box = document.createElement('p');
  box.className = 'chart-empty';
  box.textContent = text || '';
  container.appendChild(box);
}

/* --------------------------------------------------------------------------
   Базовый каркас: пересборка при изменении ширины
   -------------------------------------------------------------------------- */

function mountChart(container, draw) {
  container.classList.add('chart');
  container.replaceChildren();

  const tooltip = createTooltip(container);
  let state = null;

  const render = () => {
    if (!state) return;
    const width = container.clientWidth;
    if (width < 80) return;                 // карточка ещё скрыта — ждём

    container.querySelectorAll('svg, .chart-empty').forEach((n) => n.remove());
    tooltip.hide();
    draw({ container, width, tooltip, data: state });
  };

  // Ширина меняется от раскладки, а не только от окна: следим за элементом
  const observer = new ResizeObserver(() => render());
  observer.observe(container);

  return {
    update(data) { state = data; render(); },
    redraw: render,
    destroy() { observer.disconnect(); container.replaceChildren(); },
  };
}

/* ==========================================================================
   Линейный график
   Форма для изменения во времени. Кроссхэйр ищет X, чтобы читателю не
   приходилось целиться в линию толщиной 2px.
   ========================================================================== */

export function createLineChart(container) {
  return mountChart(container, ({ width, tooltip, data }) => {
    const { labels, series, formatValue = formatNumber, height = 280 } = data;
    if (!labels.length || !series.length) { renderEmpty(container, data.emptyText); return; }

    const maxValue = Math.max(1, ...series.flatMap((s) => s.values));
    const ticks = niceTicks(maxValue);
    const top = ticks.at(-1);

    // Левое поле — под самую длинную подпись оси, иначе числа обрежутся
    const tickWidth = Math.max(...ticks.map((v) => measureText(formatValue(v))));
    const m = { top: 16, right: 64, bottom: 28, left: Math.ceil(tickWidth) + 12 };

    const plotW = Math.max(40, width - m.left - m.right);
    const plotH = height - m.top - m.bottom;

    const x = (i) => m.left + (labels.length === 1 ? plotW / 2 : (i * plotW) / (labels.length - 1));
    const y = (v) => m.top + plotH - (v / top) * plotH;

    const svg = svgEl('svg', {
      width: '100%', height, viewBox: `0 0 ${width} ${height}`,
      role: 'img', 'aria-label': data.ariaLabel || '',
    });

    /* --- сетка и деления --- */
    for (const tick of ticks) {
      svg.appendChild(svgEl('line', {
        x1: m.left, x2: m.left + plotW, y1: y(tick), y2: y(tick),
        class: 'chart-grid',
      }));
      const label = svgEl('text', {
        x: m.left - 8, y: y(tick), 'text-anchor': 'end',
        'dominant-baseline': 'middle', class: 'chart-tick',
      });
      label.textContent = formatValue(tick);
      svg.appendChild(label);
    }

    /* --- подписи оси X: показываем столько, сколько влезает без наложения --- */
    const stepPx = plotW / Math.max(1, labels.length - 1);
    const every = Math.max(1, Math.ceil(72 / Math.max(stepPx, 1)));
    labels.forEach((label, i) => {
      if (i % every !== 0 && i !== labels.length - 1) return;
      if (i !== labels.length - 1 && (labels.length - 1 - i) < every * 0.6) return;
      const node = svgEl('text', {
        x: x(i), y: height - 8,
        'text-anchor': i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle',
        class: 'chart-tick',
      });
      node.textContent = label;
      svg.appendChild(node);
    });

    /* --- заливка-подложка: только когда серия одна, иначе washes мешают --- */
    if (series.length === 1) {
      const pts = series[0].values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
      svg.appendChild(svgEl('polygon', {
        points: `${m.left},${m.top + plotH} ${pts} ${m.left + plotW},${m.top + plotH}`,
        style: `fill: ${seriesColor(0)}; opacity: 0.10`,
      }));
    }

    /* --- линии --- */
    series.forEach((s, si) => {
      const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
      svg.appendChild(svgEl('path', {
        d, class: 'chart-line',
        style: `stroke: ${s.color || seriesColor(si)}`,
      }));
    });

    /* --- маркер на последней точке: кольцо цвета поверхности --- */
    series.forEach((s, si) => {
      const i = s.values.length - 1;
      svg.appendChild(svgEl('circle', {
        cx: x(i), cy: y(s.values[i]), r: 4,
        class: 'chart-marker',
        style: `fill: ${s.color || seriesColor(si)}`,
      }));
    });

    /* --- прямые подписи концов ---
       Ставим значение у последней точки каждой серии. Если подписи налезают
       друг на друга, нижнюю снимаем: сдвигать её вертикально нельзя — она
       оторвётся от своей линии и станет шумом. Снятое значение остаётся
       доступным в подсказке и в таблице. */
    const endLabels = series
      .map((s, si) => ({
        si,
        value: s.values.at(-1),
        yPos: y(s.values.at(-1)),
        text: formatValue(s.values.at(-1)),
      }))
      .sort((a, b) => a.yPos - b.yPos);

    const placed = [];
    for (const item of endLabels) {
      if (placed.some((p) => Math.abs(p.yPos - item.yPos) < 15)) continue;
      placed.push(item);
    }
    for (const item of placed) {
      const node = svgEl('text', {
        x: m.left + plotW + 10, y: item.yPos,
        'dominant-baseline': 'middle', class: 'chart-endlabel',
      });
      node.textContent = item.text;
      svg.appendChild(node);
    }

    /* --- слой наведения: кроссхэйр + подсказка по всем сериям сразу --- */
    const crosshair = svgEl('line', {
      y1: m.top, y2: m.top + plotH, class: 'chart-crosshair', opacity: 0,
    });
    svg.appendChild(crosshair);

    const hoverDots = series.map((s, si) => {
      const dot = svgEl('circle', {
        r: 4, class: 'chart-marker', opacity: 0,
        style: `fill: ${s.color || seriesColor(si)}`,
      });
      svg.appendChild(dot);
      return dot;
    });

    const surface = svgEl('rect', {
      x: m.left, y: m.top, width: plotW, height: plotH,
      fill: 'transparent', tabindex: '0', class: 'chart-surface',
      role: 'application', 'aria-label': data.ariaLabel || '',
    });
    svg.appendChild(surface);

    let activeIndex = -1;

    const showAt = (index, clientX, clientY) => {
      if (index < 0 || index >= labels.length) return;
      activeIndex = index;

      crosshair.setAttribute('x1', x(index));
      crosshair.setAttribute('x2', x(index));
      crosshair.setAttribute('opacity', 1);

      series.forEach((s, si) => {
        hoverDots[si].setAttribute('cx', x(index));
        hoverDots[si].setAttribute('cy', y(s.values[index]));
        hoverDots[si].setAttribute('opacity', 1);
      });

      const box = container.getBoundingClientRect();
      const px = clientX !== undefined ? clientX - box.left : x(index);
      const py = clientY !== undefined ? clientY - box.top : m.top + plotH / 2;

      tooltip.show(
        data.tooltipTitles?.[index] ?? labels[index],
        series.map((s, si) => ({
          color: s.color || seriesColor(si),
          name: s.name,
          value: formatValue(s.values[index]),
        })),
        px, py,
      );
    };

    const hide = () => {
      activeIndex = -1;
      crosshair.setAttribute('opacity', 0);
      hoverDots.forEach((d) => d.setAttribute('opacity', 0));
      tooltip.hide();
    };

    const indexFromPointer = (event) => {
      const box = svg.getBoundingClientRect();
      const rel = event.clientX - box.left - m.left;
      return Math.round((rel / plotW) * (labels.length - 1));
    };

    surface.addEventListener('pointermove', (e) => {
      const i = Math.min(labels.length - 1, Math.max(0, indexFromPointer(e)));
      showAt(i, e.clientX, e.clientY);
    });
    surface.addEventListener('pointerleave', hide);
    surface.addEventListener('blur', hide);

    // С клавиатуры — те же данные, что по наведению: стрелками вдоль оси
    surface.addEventListener('focus', () => showAt(activeIndex < 0 ? labels.length - 1 : activeIndex));
    surface.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const next = (activeIndex < 0 ? labels.length - 1 : activeIndex) + (e.key === 'ArrowRight' ? 1 : -1);
      showAt(Math.min(labels.length - 1, Math.max(0, next)));
    });

    container.appendChild(svg);
  });
}

/* ==========================================================================
   Горизонтальные столбцы
   Форма для сравнения величин по номинальным категориям (товары, площадки):
   все столбцы одного цвета — длина уже кодирует значение, тратить на него
   ещё и цвет нельзя.
   ========================================================================== */

export function createBarChart(container) {
  return mountChart(container, ({ width, tooltip, data }) => {
    const { items, formatValue = formatNumber } = data;
    if (!items.length) { renderEmpty(container, data.emptyText); return; }

    const BAR = 20;          // ≤ 24px: остаток полосы остаётся воздухом
    const GAP = 14;
    const rowH = BAR + GAP;
    const height = items.length * rowH + 8;

    const maxValue = Math.max(1, ...items.map((it) => it.value));

    // Слева — названия, справа — значения у конца столбца
    const nameW = Math.min(
      Math.max(...items.map((it) => measureText(it.label, '400 13px system-ui, sans-serif'))) + 12,
      Math.max(120, width * 0.42),
    );
    const valueW = Math.max(...items.map((it) => measureText(formatValue(it.value), '600 13px system-ui, sans-serif'))) + 12;
    const plotW = Math.max(40, width - nameW - valueW);

    const svg = svgEl('svg', {
      width: '100%', height, viewBox: `0 0 ${width} ${height}`,
      role: 'img', 'aria-label': data.ariaLabel || '',
    });

    items.forEach((item, i) => {
      const y = i * rowH + 4;
      const barW = Math.max(2, (item.value / maxValue) * plotW);

      const label = svgEl('text', {
        x: nameW - 12, y: y + BAR / 2, 'text-anchor': 'end',
        'dominant-baseline': 'middle', class: 'chart-catlabel',
      });
      label.textContent = item.label;
      svg.appendChild(label);

      svg.appendChild(svgEl('path', {
        d: barPath(nameW, y, barW, BAR, 4, 'right'),
        style: `fill: ${item.color || seriesColor(0)}`,
        class: 'chart-bar',
      }));

      // Значение у конца столбца — обязательная компенсация: светлые
      // тональности палитры не дотягивают до 3:1 к светлой поверхности
      const value = svgEl('text', {
        x: nameW + barW + 8, y: y + BAR / 2,
        'dominant-baseline': 'middle', class: 'chart-value',
      });
      value.textContent = formatValue(item.value);
      svg.appendChild(value);

      // Зона наведения шире марки: по всей строке и на всю ширину
      const hit = svgEl('rect', {
        x: 0, y, width, height: BAR, fill: 'transparent',
        tabindex: '0', class: 'chart-hit',
      });
      const show = (e) => {
        const box = container.getBoundingClientRect();
        tooltip.show(item.label, [{
          color: item.color || seriesColor(0),
          name: data.valueName || '',
          value: formatValue(item.value),
        }],
        e?.clientX !== undefined ? e.clientX - box.left : nameW + barW,
        e?.clientY !== undefined ? e.clientY - box.top : y + BAR);
      };
      hit.addEventListener('pointermove', show);
      hit.addEventListener('pointerleave', () => tooltip.hide());
      hit.addEventListener('focus', () => show());
      hit.addEventListener('blur', () => tooltip.hide());
      svg.appendChild(hit);
    });

    container.appendChild(svg);
  });
}

/* ==========================================================================
   Столбцы с накоплением
   Сегменты разделяет зазор 2px цветом поверхности, а не обводка.
   ========================================================================== */

/* --------------------------------------------------------------------------
   Отметки событий над столбцами

   Форма, а не цвет: отметки лежат поверх цветных столбцов, и ещё один цвет
   там читался бы как очередная серия. Круг, ромб и треугольник различимы и
   в монохроме, и при дальтонизме, а подпись у них общая — в легенде.
   -------------------------------------------------------------------------- */

const MARK_SIZE = 9;

function markShape(kind, cx, cy) {
  const r = MARK_SIZE / 2;
  if (kind === 'coupon') {
    return svgEl('circle', { cx, cy, r: r - 0.5, class: 'chart-mark' });
  }
  if (kind === 'lightning_deal') {
    return svgEl('polygon', {
      points: `${cx},${cy - r} ${cx + r},${cy + r} ${cx - r},${cy + r}`,
      class: 'chart-mark',
    });
  }
  // Ромб — под дилы: единственная форма, которая не путается с кругом
  return svgEl('polygon', {
    points: `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`,
    class: 'chart-mark',
  });
}

/** Отметки одной колонки: по одной на тип, а не на кампанию. */
function renderMarks(svg, items, cx, y) {
  const kinds = [...new Set(items.map((item) => item.kind))];
  const width = kinds.length * (MARK_SIZE + 3) - 3;
  let x = cx - width / 2 + MARK_SIZE / 2;

  for (const kind of kinds) {
    const shape = markShape(kind, x, y);
    // Подсказка списком: какая именно кампания шла на этой неделе
    const title = svgEl('title');
    title.textContent = items.filter((item) => item.kind === kind)
      .map((item) => item.label).join('\n');
    shape.appendChild(title);
    svg.appendChild(shape);
    x += MARK_SIZE + 3;
  }
}

export function createStackedColumnChart(container) {
  return mountChart(container, ({ width, tooltip, data }) => {
    const { labels, series, formatValue = formatNumber, height = 260, marks = null } = data;
    if (!labels.length || !series.length) { renderEmpty(container, data.emptyText); return; }

    const totals = labels.map((_, i) => series.reduce((sum, s) => sum + s.values[i], 0));
    const maxTotal = Math.max(1, ...totals);
    const ticks = niceTicks(maxTotal);
    const top = ticks.at(-1);

    const tickWidth = Math.max(...ticks.map((v) => measureText(formatValue(v))));
    // Отметкам нужна своя полоса над столбцами: положить их внутрь поля
    // графика значило бы накрыть ими самые высокие недели
    const hasMarks = Array.isArray(marks) && marks.some((list) => list?.length);
    const m = {
      top: hasMarks ? 16 + MARK_SIZE + 6 : 16,
      right: 8, bottom: 28, left: Math.ceil(tickWidth) + 12,
    };

    const plotW = Math.max(40, width - m.left - m.right);
    const plotH = height - m.top - m.bottom;

    const band = plotW / labels.length;
    const barW = Math.min(24, band * 0.62);      // остаток полосы — воздух
    const yOf = (v) => m.top + plotH - (v / top) * plotH;

    const svg = svgEl('svg', {
      width: '100%', height, viewBox: `0 0 ${width} ${height}`,
      role: 'img', 'aria-label': data.ariaLabel || '',
    });

    for (const tick of ticks) {
      svg.appendChild(svgEl('line', {
        x1: m.left, x2: m.left + plotW, y1: yOf(tick), y2: yOf(tick), class: 'chart-grid',
      }));
      const label = svgEl('text', {
        x: m.left - 8, y: yOf(tick), 'text-anchor': 'end',
        'dominant-baseline': 'middle', class: 'chart-tick',
      });
      label.textContent = formatValue(tick);
      svg.appendChild(label);
    }

    const GAP = 2;   // зазор поверхности между сегментами стопки

    labels.forEach((label, i) => {
      const cx = m.left + band * i + band / 2;
      const x = cx - barW / 2;
      let cursor = 0;

      series.forEach((s, si) => {
        const value = s.values[i];
        if (value <= 0) return;

        const yTop = yOf(cursor + value);
        const yBottom = yOf(cursor);
        const isTop = series.slice(si + 1).every((rest) => rest.values[i] <= 0);
        const h = Math.max(1, yBottom - yTop - (isTop ? 0 : GAP));

        svg.appendChild(svgEl('path', {
          d: barPath(x, yTop, barW, h, isTop ? 4 : 0, 'top'),
          style: `fill: ${s.color || seriesColor(si)}`,
          class: 'chart-bar',
        }));

        cursor += value;
      });

      // Отметка стоит над столбцом на одной высоте у всех недель: скачущая
      // по вершинам, она читалась бы как ещё один ряд данных
      if (hasMarks && marks[i]?.length) {
        renderMarks(svg, marks[i], cx, 16 + MARK_SIZE / 2);
      }

      const tick = svgEl('text', {
        x: cx, y: height - 8, 'text-anchor': 'middle', class: 'chart-tick',
      });
      tick.textContent = label;
      svg.appendChild(tick);

      // Наведение на всю полосу целиком, а не на отдельный сегмент
      const hit = svgEl('rect', {
        x: m.left + band * i, y: m.top, width: band, height: plotH,
        fill: 'transparent', tabindex: '0', class: 'chart-hit',
      });
      const show = (e) => {
        const box = container.getBoundingClientRect();
        const rows = series.map((s, si) => ({
          color: s.color || seriesColor(si),
          name: s.name,
          value: formatValue(s.values[i]),
        }));
        rows.push({ color: null, name: data.totalLabel || 'Σ', value: formatValue(totals[i]) });
        tooltip.show(
          data.tooltipTitles?.[i] ?? label, rows,
          e?.clientX !== undefined ? e.clientX - box.left : cx,
          e?.clientY !== undefined ? e.clientY - box.top : yOf(totals[i]),
        );
      };
      hit.addEventListener('pointermove', show);
      hit.addEventListener('pointerleave', () => tooltip.hide());
      hit.addEventListener('focus', () => show());
      hit.addEventListener('blur', () => tooltip.hide());
      svg.appendChild(hit);
    });

    container.appendChild(svg);
  });
}

/* ==========================================================================
   Спарклайн для плитки статистики: 12 точек, без осей и подписей.
   Это не самостоятельный график, а форма числа — подсказки ему не нужны.
   ========================================================================== */

export function renderSparkline(container, values, { height = 36 } = {}) {
  container.replaceChildren();
  if (!values?.length) return;

  const width = Math.max(60, container.clientWidth || 120);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const x = (i) => (i * width) / Math.max(1, values.length - 1);
  const y = (v) => height - 4 - ((v - min) / span) * (height - 8);

  const svg = svgEl('svg', {
    width: '100%', height, viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false',
  });

  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  svg.appendChild(svgEl('path', { d, class: 'chart-sparkline' }));

  // Последняя точка в акценте — она и есть «сейчас»
  svg.appendChild(svgEl('circle', {
    cx: x(values.length - 1), cy: y(values.at(-1)), r: 2.5,
    class: 'chart-spark-dot',
  }));

  container.appendChild(svg);
}

/* ==========================================================================
   Легенда: обязательна от двух серий. Ключ повторяет марку — штрих для
   линий, прямоугольник для заливок.
   ========================================================================== */

export function renderLegend(container, series, { mark = 'line' } = {}) {
  container.replaceChildren();
  if (series.length < 2) return;      // одна серия — её называет заголовок

  series.forEach((s, i) => {
    const item = document.createElement('span');
    item.className = 'legend__item';

    const key = document.createElement('span');
    key.className = `legend__key legend__key--${mark}`;
    key.style.background = s.color || seriesColor(i);
    item.appendChild(key);

    const name = document.createElement('span');
    name.textContent = s.name;
    item.appendChild(name);

    container.appendChild(item);
  });
}
