/* ==========================================================================
   Раздел «Вики» — база знаний.

   Статьи лежат в репозитории обычными файлами markdown: data/wiki/<имя>.<язык>.md.
   Указатель — data/wiki/index.json. Так статью можно править прямо на GitHub
   без единой строки кода, а история правок ведётся сама, коммитами.

   ПОЧЕМУ ЯЗЫК — ЧАСТЬ ИМЕНИ ФАЙЛА, А НЕ РАЗДЕЛ ВНУТРИ
   Перевода может не быть, и это нормально. Отдельным файлом отсутствие
   перевода видно сразу — и в репозитории, и здесь: статья открывается на
   русском с honest-пометкой, а не показывается пустой.
   ========================================================================== */

import { t, getLang } from '../i18n.js';
import { formatDayFull } from '../format.js';
import { renderMarkdown } from '../markdown.js';

const INDEX_URL = 'data/wiki/index.json';
const ARTICLE_URL = (slug, lang) => `data/wiki/${slug}.${lang}.md`;

const FALLBACK_LANG = 'ru';

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') node.textContent = value;
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  children.forEach((child) => node.appendChild(child));
  return node;
}

const titleOf = (article, lang) =>
  article.title?.[lang] || article.title?.[FALLBACK_LANG] || article.slug;

/* --------------------------------------------------------------------------
   Раздел
   -------------------------------------------------------------------------- */

export const wiki = {
  titleKey: 'page.wiki.title',
  leadKey: 'page.wiki.lead',

  async mount(view, controls) {
    controls.replaceChildren();
    view.replaceChildren(el('div', { class: 'card state', text: t('wiki.loading') }));

    let index;
    try {
      const response = await fetch(INDEX_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      index = await response.json();
      if (!Array.isArray(index.articles)) throw new Error('нет массива articles');
    } catch {
      view.replaceChildren(el('div', { class: 'card state' }, [
        document.createTextNode(t('wiki.noData')),
        el('code', { text: 'data/wiki/index.json' }),
      ]));
      return () => {};
    }

    const lang = getLang();
    const state = { query: '', tag: null, slug: index.articles[0]?.slug || null };

    /* Тело статьи читается один раз и остаётся в памяти: файлы маленькие,
       а повторное чтение при каждом клике заметно моргает содержимым. */
    const cache = new Map();

    /* --- поиск и метки --------------------------------------------------- */

    const search = el('input', {
      type: 'search', class: 'input', style: 'min-width:220px',
      placeholder: t('wiki.search'),
    });
    search.addEventListener('input', () => { state.query = search.value.trim().toLowerCase(); paintList(); });

    const tags = [...new Set(index.articles.flatMap((a) => a.tags || []))].sort();
    const tagBar = el('div', { class: 'segmented', role: 'radiogroup' });
    const tagButtons = [{ id: null, label: t('wiki.allTags') }, ...tags.map((id) => ({ id, label: id }))]
      .map(({ id, label }) => {
        const button = el('button', {
          type: 'button', class: 'segmented__item', role: 'radio', text: label,
          'aria-checked': String(state.tag === id),
        });
        button.addEventListener('click', () => { state.tag = id; paintList(); });
        tagBar.appendChild(button);
        return { id, button };
      });

    controls.append(search, tagBar);

    /* --- каркас ---------------------------------------------------------- */

    const list = el('nav', { class: 'card wiki__list', 'aria-label': t('page.wiki.title') });
    const article = el('article', { class: 'card wiki__article' });
    const layout = el('div', { class: 'wiki' }, [list, article]);
    view.replaceChildren(layout);

    /* --- список ---------------------------------------------------------- */

    function matching() {
      return index.articles.filter((item) => {
        if (state.tag && !(item.tags || []).includes(state.tag)) return false;
        if (!state.query) return true;
        const haystack = [titleOf(item, lang), item.slug, ...(item.tags || []),
          ...Object.values(item.title || {})].join(' ').toLowerCase();
        // Ищем и по телу, если оно уже прочитано: иначе поиск находит
        // только заголовки и выглядит сломанным
        const body = cache.get(item.slug)?.text?.toLowerCase() || '';
        return haystack.includes(state.query) || body.includes(state.query);
      });
    }

    function paintList() {
      tagButtons.forEach(({ id, button }) =>
        button.setAttribute('aria-checked', String(state.tag === id)));

      const items = matching();
      list.replaceChildren();

      if (!items.length) {
        list.appendChild(el('p', { class: 'wiki__empty', text: t('wiki.nothing') }));
        return;
      }

      for (const item of items) {
        const link = el('button', {
          type: 'button',
          class: `wiki__item${item.slug === state.slug ? ' wiki__item--current' : ''}`,
        });
        link.appendChild(el('span', { class: 'wiki__item-title', text: titleOf(item, lang) }));
        if (item.tags?.length) {
          link.appendChild(el('span', { class: 'wiki__item-tags', text: item.tags.join(' · ') }));
        }
        link.addEventListener('click', () => { state.slug = item.slug; paintList(); paintArticle(); });
        list.appendChild(link);
      }
    }

    /* --- статья ---------------------------------------------------------- */

    async function readArticle(item) {
      if (cache.has(item.slug)) return cache.get(item.slug);

      const langs = item.langs || [FALLBACK_LANG];
      const chosen = langs.includes(lang) ? lang : FALLBACK_LANG;

      let text = '';
      try {
        const response = await fetch(ARTICLE_URL(item.slug, chosen), { cache: 'no-store' });
        if (!response.ok) throw new Error(String(response.status));
        text = await response.text();
      } catch {
        text = '';
      }
      const entry = { text, lang: chosen, missing: !text };
      cache.set(item.slug, entry);
      return entry;
    }

    async function paintArticle() {
      const item = index.articles.find((a) => a.slug === state.slug);
      if (!item) { article.replaceChildren(el('p', { class: 'state', text: t('wiki.nothing') })); return; }

      article.replaceChildren(el('p', { class: 'state', text: t('wiki.loading') }));
      const entry = await readArticle(item);

      if (entry.missing) {
        article.replaceChildren(el('p', { class: 'state', text: t('wiki.missingFile', {
          file: ARTICLE_URL(item.slug, entry.lang),
        }) }));
        return;
      }

      const head = el('header', { class: 'wiki__head' }, [
        el('h2', { class: 'wiki__title', text: titleOf(item, lang) }),
      ]);
      const meta = [];
      if (item.updated) meta.push(t('wiki.updated', { date: formatDayFull(item.updated) }));
      if (item.tags?.length) meta.push(item.tags.join(' · '));
      if (meta.length) head.appendChild(el('p', { class: 'wiki__meta', text: meta.join(' · ') }));

      // Перевода нет — говорим об этом, а не показываем русский молча
      if (entry.lang !== lang) {
        head.appendChild(el('p', { class: 'wiki__notice', text: t('wiki.noTranslation') }));
      }

      const { node, headings } = renderMarkdown(entry.text);

      article.replaceChildren(head);
      // Оглавление имеет смысл от трёх разделов: на двух оно длиннее статьи
      if (headings.length >= 3) {
        const toc = el('nav', { class: 'wiki__toc', 'aria-label': t('wiki.contents') });
        // Заголовок первого уровня — это название статьи, оно уже в шапке
        headings.filter((h) => h.level === 2).forEach((heading) => {
          toc.appendChild(el('a', { href: `#${heading.id}`, text: heading.text }));
        });
        if (toc.children.length >= 3) article.appendChild(toc);
      }
      article.appendChild(node);
    }

    paintList();
    await paintArticle();

    return () => { cache.clear(); };
  },
};
