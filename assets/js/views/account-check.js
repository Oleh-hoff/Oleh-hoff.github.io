/* ==========================================================================
   Раздел «Проверка аккаунта».

   Одна карточка на проверку. Недоступные через API проверки показываются
   наравне с остальными, но помеченными: спрятать их значило бы создать
   впечатление, что аккаунт проверен целиком, хотя это не так.

   Композиция взята с 21st.dev: подписи капителью, значение крупно и
   чернильно, состояние — на плашке рядом.
   ========================================================================== */

import { t } from '../i18n.js';
import { formatDateTime, formatNumber } from '../format.js';
import { statusIcon } from '../notifications.js';

const DATA_URL = 'data/account-health.json';

/** Порядок карточек = порядок пунктов, которые перечислил пользователь. */
const ORDER = [
  'actions', 'stranded', 'listingStatus', 'accountHealth', 'feedback',
  'performanceNotifications', 'pricingHealth', 'messages',
  'customerReviews', 'fbaPerformance', 'cases',
];

/* Статус проверки → значок из журнала синхронизаций: словарь форм общий,
   чтобы «зелёная галочка» на всех экранах означала одно и то же. */
const ICON_FOR = { ok: 'ok', warn: 'partial', error: 'error', unavailable: 'partial' };

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') node.textContent = value;
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  children.forEach((child) => node.appendChild(child));
  return node;
}

/* --------------------------------------------------------------------------
   Подробности проверки — таблица найденных позиций
   -------------------------------------------------------------------------- */

const COLUMNS = {
  stranded: [['sku', 'check.col.sku'], ['asin', 'ASIN'], ['title', 'check.col.title'],
    ['quantity', 'check.col.qty'], ['reason', 'check.col.reason']],
  listingStatus: [['sku', 'check.col.sku'], ['title', 'check.col.title'],
    ['previousStatus', 'check.col.was'], ['status', 'check.col.now']],
  feedback: [['date', 'check.col.date'], ['rating', 'check.col.rating'],
    ['comment', 'check.col.comment']],
  fbaPerformance: [['sku', 'check.col.sku'], ['title', 'check.col.title'],
    ['excessUnits', 'check.col.excess'], ['agedUnits', 'check.col.aged']],
};

function detailsTable(check) {
  const columns = COLUMNS[check.id];
  if (!columns || !check.items?.length) return null;

  const table = el('table', { class: 'breakdown' });
  table.appendChild(el('thead', {}, [el('tr', {}, columns.map(([, label]) =>
    el('th', { scope: 'col', text: label.startsWith('check.') ? t(label) : label })))]));

  const body = el('tbody');
  for (const item of check.items) {
    body.appendChild(el('tr', {}, columns.map(([key]) =>
      el('td', { text: String(item[key] ?? '—') }))));
  }
  table.appendChild(body);
  return el('div', { class: 'table-wrap' }, [table]);
}

/** Показатели Account Health — своя таблица: у них есть цель и условие. */
function metricsTable(check) {
  if (check.id !== 'accountHealth' || !check.items?.length) return null;

  const table = el('table', { class: 'breakdown' });
  table.appendChild(el('thead', {}, [el('tr', {}, [
    el('th', { scope: 'col', text: t('check.col.metric') }),
    el('th', { scope: 'col', class: 'num', text: t('check.col.value') }),
    el('th', { scope: 'col', class: 'num', text: t('check.col.target') }),
    el('th', { scope: 'col', text: t('check.col.state') }),
  ])]));

  const body = el('tbody');
  for (const m of check.items) {
    const bad = !['GOOD', 'GREAT', 'EXCELLENT', 'NONE'].includes(m.status);
    body.appendChild(el('tr', {}, [
      el('td', { text: m.name }),
      el('td', { class: 'num', text: m.value === null ? '—' : String(m.value) }),
      el('td', { class: 'num', text: m.target === null ? '—' : String(m.target) }),
      el('td', { class: bad ? 'amount--negative' : '', text: m.status }),
    ]));
  }
  table.appendChild(body);
  return el('div', { class: 'table-wrap' }, [table]);
}

/* --------------------------------------------------------------------------
   Карточка проверки
   -------------------------------------------------------------------------- */

function checkCard(check) {
  const unavailable = check.status === 'unavailable';
  const card = el('article', {
    class: `card check-card${unavailable ? ' check-card--off' : ''}`,
  });

  const head = el('div', { class: 'check-card__head' });
  head.appendChild(statusIcon(ICON_FOR[check.status] || 'partial'));

  const titles = el('div', { class: 'check-card__titles' });
  titles.appendChild(el('h3', { class: 'check-card__title', text: t(`check.${check.id}`) }));
  titles.appendChild(el('div', {
    class: 'check-card__state',
    text: unavailable ? t('check.state.unavailable') : t(`check.state.${check.status}`),
  }));
  head.appendChild(titles);

  // Число найденного — крупно и справа, как счётчик в их карточках
  if (!unavailable && Number.isFinite(check.count)) {
    head.appendChild(el('div', {
      class: `check-card__count${check.count ? ' check-card__count--attention' : ''}`,
      text: formatNumber(check.count),
    }));
  }
  card.appendChild(head);

  card.appendChild(el('p', { class: 'check-card__message', text: check.message || '' }));

  // Рейтинг здоровья аккаунта — единственное число, которое стоит вынести
  const extra = check.extra || {};
  if (check.id === 'accountHealth' && extra.ahrScore != null) {
    const ahr = el('div', { class: 'check-card__ahr' });
    ahr.appendChild(el('span', { class: 'check-card__ahr-score', text: String(extra.ahrScore) }));
    ahr.appendChild(el('span', {
      class: 'stat__badge stat__badge--up', text: String(extra.ahrStatus || ''),
    }));
    card.appendChild(ahr);
  }

  if (check.id === 'listingStatus' && extra.total) {
    card.appendChild(el('p', {
      class: 'check-card__note',
      text: t('check.listingTotals', { total: extra.total, inactive: extra.inactive }),
    }));
  }

  if (unavailable && extra.workaround) {
    card.appendChild(el('p', { class: 'check-card__note', text: extra.workaround }));
  }

  const table = metricsTable(check) || detailsTable(check);
  if (table) {
    const details = el('details', { class: 'check-card__details' });
    details.appendChild(el('summary', { text: t('check.showDetails') }));
    details.appendChild(table);
    card.appendChild(details);
  }

  return card;
}

/* --------------------------------------------------------------------------
   Раздел
   -------------------------------------------------------------------------- */

export const accountCheck = {
  titleKey: 'page.accountCheck.title',
  leadKey: 'page.accountCheck.lead',

  async mount(view, controls) {
    controls.replaceChildren();
    view.replaceChildren(el('div', { class: 'card state', text: t('check.loading') }));

    let data;
    try {
      const response = await fetch(DATA_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      data = await response.json();
    } catch {
      view.replaceChildren(el('div', { class: 'card state' }, [
        document.createTextNode(t('check.noData')),
        el('code', { text: 'python3 scripts/collect_account_health.py' }),
      ]));
      return () => {};
    }

    const byId = new Map((data.checks || []).map((c) => [c.id, c]));
    const checks = ORDER.map((id) => byId.get(id)).filter(Boolean);

    const done = checks.filter((c) => c.status !== 'unavailable');
    const attention = done.filter((c) => c.status === 'warn' || c.status === 'error');

    /* Сводка сверху: сколько проверок прошло и сколько требует внимания */
    const summary = el('section', { class: 'kpi-grid' });
    summary.appendChild(statTile(t('check.kpi.passed'),
      `${done.length - attention.length} / ${done.length}`));
    summary.appendChild(statTile(t('check.kpi.attention'), formatNumber(attention.length),
      attention.length ? 'down' : 'up'));
    summary.appendChild(statTile(t('check.kpi.unavailable'),
      formatNumber(checks.length - done.length)));
    summary.appendChild(statTile(t('check.kpi.checkedAt'),
      data.generatedAt ? formatDateTime(data.generatedAt) : '—'));

    const grid = el('section', { class: 'check-grid' });
    checks.forEach((check) => grid.appendChild(checkCard(check)));

    view.replaceChildren(summary, grid);
    return () => {};
  },
};

function statTile(label, value, tone = null) {
  const card = el('article', { class: 'card stat' });
  card.appendChild(el('div', { class: 'stat__label', text: label }));
  card.appendChild(el('div', { class: 'stat__value', text: value }));
  if (tone) {
    card.appendChild(el('span', {
      class: `stat__badge stat__badge--${tone}`,
      text: tone === 'up' ? t('check.state.ok') : t('check.state.warn'),
    }));
  }
  return card;
}
