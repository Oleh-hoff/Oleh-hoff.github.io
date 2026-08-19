/* ==========================================================================
   Разбор markdown в DOM.

   ПОЧЕМУ СВОЙ, А НЕ ГОТОВЫЙ
   Стек без сборки и только ресурсы GitHub: подключить marked или markdown-it
   с CDN нельзя, а класть в репозиторий минифицированный сторонний файл
   означает держать зависимость, которую никто не читает и не обновляет.
   Здесь нужен разбор статей, которые пишем мы сами, а не произвольного
   markdown из интернета — поэтому хватает подмножества.

   ЧТО ПОДДЕРЖИВАЕТСЯ
   Заголовки, абзацы, списки (в том числе нумерованные), таблицы, цитаты,
   блоки кода, горизонтальные линии, ссылки, жирный, курсив, код в строке.

   БЕЗОПАСНОСТЬ
   Дерево собирается через createElement и textContent, innerHTML не
   используется нигде. Поэтому разметка из статьи не может стать разметкой
   страницы, даже если в текст попадёт `<script>`.
   ========================================================================== */

const el = (tag, text) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};

/* --------------------------------------------------------------------------
   Строчная разметка
   -------------------------------------------------------------------------- */

/* Порядок важен: код в строке разбирается первым, иначе звёздочки и
   подчёркивания внутри `a_b_c` съест курсив. */
const INLINE = [
  { re: /`([^`]+)`/, tag: 'code', raw: true },
  { re: /\*\*([^*]+)\*\*/, tag: 'strong' },
  { re: /(?<![\w*])\*([^*\n]+)\*(?![\w*])/, tag: 'em' },
  { re: /\[([^\]]+)\]\(([^)\s]+)\)/, tag: 'a' },
];

/** Разбирает строку в набор узлов: текст, код, ссылки, выделение. */
export function inline(text) {
  const nodes = [];
  let rest = String(text);

  outer: while (rest) {
    let best = null;
    for (const rule of INLINE) {
      const match = rule.re.exec(rest);
      if (match && (!best || match.index < best.match.index)) best = { rule, match };
    }
    if (!best) break outer;

    const { rule, match } = best;
    if (match.index > 0) nodes.push(document.createTextNode(rest.slice(0, match.index)));

    if (rule.tag === 'a') {
      const link = el('a', match[1]);
      link.setAttribute('href', safeHref(match[2]));
      // Внешние ссылки уводят из приложения — открываем рядом, а не вместо
      if (/^https?:/i.test(match[2])) {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
      }
      nodes.push(link);
    } else if (rule.raw) {
      nodes.push(el(rule.tag, match[1]));
    } else {
      const node = el(rule.tag);
      inline(match[1]).forEach((child) => node.appendChild(child));
      nodes.push(node);
    }

    rest = rest.slice(match.index + match[0].length);
  }

  if (rest) nodes.push(document.createTextNode(rest));
  return nodes;
}

/** Отсекает javascript: и данные — в статье им делать нечего. */
function safeHref(href) {
  return /^(https?:|mailto:|#|\.?\/)/i.test(href) ? href : '#';
}

function fill(node, text) {
  inline(text).forEach((child) => node.appendChild(child));
  return node;
}

/* --------------------------------------------------------------------------
   Блоки
   -------------------------------------------------------------------------- */

export function renderMarkdown(source) {
  const root = document.createElement('div');
  root.className = 'prose';

  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  let i = 0;

  const headings = [];

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i += 1; continue; }

    /* --- блок кода --- */
    if (/^```/.test(line)) {
      const body = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) { body.push(lines[i]); i += 1; }
      i += 1;
      const pre = el('pre');
      pre.appendChild(el('code', body.join('\n')));
      root.appendChild(pre);
      continue;
    }

    /* --- заголовок --- */
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const node = fill(el(`h${Math.min(level + 1, 5)}`), heading[2]);
      // Якорь нужен оглавлению: по нему статья прокручивается к разделу
      const id = slug(heading[2]);
      node.id = id;
      headings.push({ id, level, text: heading[2] });
      root.appendChild(node);
      i += 1;
      continue;
    }

    /* --- горизонтальная линия --- */
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      root.appendChild(el('hr'));
      i += 1;
      continue;
    }

    /* --- таблица --- */
    if (line.includes('|') && /^\s*\|?[\s:-]*-[\s|:-]*$/.test(lines[i + 1] || '')) {
      const header = splitRow(line);
      i += 2;
      const table = el('table');
      const head = el('tr');
      header.forEach((cell) => {
        const th = el('th');
        th.setAttribute('scope', 'col');
        head.appendChild(fill(th, cell));
      });
      table.appendChild(el('thead')).appendChild(head);

      const body = el('tbody');
      while (i < lines.length && lines[i].includes('|')) {
        const row = el('tr');
        splitRow(lines[i]).forEach((cell) => row.appendChild(fill(el('td'), cell)));
        body.appendChild(row);
        i += 1;
      }
      table.appendChild(body);

      // Широкая таблица прокручивается внутри себя, а не растягивает страницу
      const wrap = el('div');
      wrap.className = 'table-wrap';
      wrap.appendChild(table);
      root.appendChild(wrap);
      continue;
    }

    /* --- цитата --- */
    if (/^>\s?/.test(line)) {
      const body = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      const quote = el('blockquote');
      quote.appendChild(fill(el('p'), body.join(' ')));
      root.appendChild(quote);
      continue;
    }

    /* --- списки --- */
    const bullet = /^\s*[-*+]\s+/.test(line);
    const numbered = /^\s*\d+[.)]\s+/.test(line);
    if (bullet || numbered) {
      const list = el(numbered ? 'ol' : 'ul');
      const test = numbered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/;
      while (i < lines.length && test.test(lines[i])) {
        const item = fill(el('li'), lines[i].replace(test, ''));
        i += 1;
        // Продолжение пункта на следующей строке без маркера — тот же пункт
        while (i < lines.length && lines[i].trim()
               && !test.test(lines[i]) && !/^(#{1,4}\s|```|>)/.test(lines[i])) {
          item.appendChild(document.createTextNode(' '));
          inline(lines[i].trim()).forEach((child) => item.appendChild(child));
          i += 1;
        }
        list.appendChild(item);
      }
      root.appendChild(list);
      continue;
    }

    /* --- абзац --- */
    const paragraph = [];
    while (i < lines.length && lines[i].trim()
           && !/^(#{1,4}\s|```|>|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[i])
           && !/^(-{3,}|\*{3,})\s*$/.test(lines[i])) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    if (paragraph.length) root.appendChild(fill(el('p'), paragraph.join(' ')));
  }

  return { node: root, headings };
}

function splitRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
}

/** Идентификатор заголовка: латиница и кириллица, остальное — дефис. */
export function slug(text) {
  return String(text).toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'section';
}

/** Первый абзац статьи — он идёт в список как краткое описание. */
export function excerpt(source, limit = 160) {
  const text = String(source)
    .replace(/^---[\s\S]*?---\n/, '')
    .split('\n')
    .filter((line) => line.trim() && !/^(#|>|```|\||-{3,})/.test(line.trim()))
    .join(' ')
    .replace(/[*`_[\]]|\(([^)\s]+)\)/g, '')
    .trim();
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}
