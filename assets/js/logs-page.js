/* ==========================================================================
   Страница полных логов соединений.

   Каждая запись раскрывается до технических подробностей: коды ответа,
   длительность, сколько страниц забрали, ссылка на журнал запуска. Наверху —
   человеческая формулировка причины, чтобы понять, что случилось, не читая
   стек вызовов.
   ========================================================================== */

import './strings-crm.js';
import { applyTranslations, onLangChange, t } from './i18n.js';
import { initTheme } from './theme.js';
import { mountSettings } from './settings.js';
import { onZoneChange } from './timezone.js';
import { requireAuth } from './auth.js';
import { formatDateTime, formatNumber, resetFormatters } from './format.js';
import { loadSyncLog, explainError, describeStats, SOURCES } from './sync-log.js';
import { statusIcon } from './notifications.js';

if (!requireAuth('index.html')) throw new Error('redirecting');

initTheme();
mountSettings(document.getElementById('settings-slot'));
applyTranslations();

const listBox = document.getElementById('log-list');
const statsBox = document.getElementById('log-stats');
const sourceSelect = document.getElementById('log-source');
const filterGroup = document.getElementById('log-filters');

const state = { entries: [], filter: 'all', source: 'all' };

/* --------------------------------------------------------------------------
   Помощники разметки
   -------------------------------------------------------------------------- */

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') node.textContent = value;
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  children.forEach((child) => node.appendChild(child));
  return node;
}

function sourceName(source) {
  const known = SOURCES[source];
  return known ? t(known.nameKey) : source;
}

function duration(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  return seconds < 90
    ? t('logs.seconds', { n: seconds })
    : t('logs.minutes', { n: Math.round(seconds / 60) });
}

function field(labelKey, value, wide = false) {
  if (value === null || value === undefined || value === '') return null;
  const box = el('div', { class: `log-field${wide ? ' log-field--wide' : ''}` });
  box.appendChild(el('div', { class: 'log-field__label', text: t(labelKey) }));
  const valueNode = el('div', { class: 'log-field__value' });
  if (value instanceof Node) valueNode.appendChild(value);
  else valueNode.textContent = String(value);
  box.appendChild(valueNode);
  return box;
}

function code(text) {
  return el('code', { text });
}

/* --------------------------------------------------------------------------
   Запись
   -------------------------------------------------------------------------- */

function entryNode(entry) {
  const details = el('details', { class: 'log-entry' });

  const summary = el('summary', { class: 'log-entry__summary' });
  const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chevron.setAttribute('viewBox', '0 0 16 16');
  chevron.setAttribute('class', 'log-entry__chevron');
  chevron.setAttribute('fill', 'none');
  chevron.setAttribute('aria-hidden', 'true');
  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arrow.setAttribute('d', 'M6 3.5L10.5 8 6 12.5');
  arrow.setAttribute('stroke', 'currentColor');
  arrow.setAttribute('stroke-width', '1.6');
  arrow.setAttribute('stroke-linecap', 'round');
  chevron.appendChild(arrow);

  summary.appendChild(statusIcon(entry.status));
  summary.appendChild(el('span', {
    class: 'log-entry__when', text: formatDateTime(entry.finishedAt),
  }));
  summary.appendChild(el('span', {
    class: 'log-entry__source', text: sourceName(entry.source),
  }));
  summary.appendChild(el('span', { class: 'log-entry__msg', text: entry.message || '' }));
  summary.appendChild(chevron);
  details.appendChild(summary);

  const body = el('div', { class: 'log-entry__details' });
  const stats = entry.stats || {};

  const reason = explainError(entry.error, t);
  if (reason) body.appendChild(field('logs.fieldError', reason, true));
  else if (entry.message) body.appendChild(field('logs.fieldSource', entry.message, true));

  // Отчёты и данные, которые приехали за этот запуск
  const dataLine = describeStats(entry, t);
  if (dataLine) body.appendChild(field('logs.fieldData', dataLine, true));

  [
    field('logs.fieldStarted', entry.startedAt ? formatDateTime(entry.startedAt) : null),
    field('logs.fieldFinished', entry.finishedAt ? formatDateTime(entry.finishedAt) : null),
    field('logs.fieldDuration', duration(entry.durationSec)),
    field('logs.fieldMode', entry.mode || null),
    field('logs.fieldTrigger', entry.trigger || null),
    field('logs.fieldRows', Number.isFinite(stats.rows) ? formatNumber(stats.rows) : null),
    field('logs.fieldDays', Number.isFinite(stats.days) ? formatNumber(stats.days) : null),
    field('logs.fieldPages', Number.isFinite(stats.pages) ? formatNumber(stats.pages) : null),
    field('logs.fieldWeeks', Number.isFinite(stats.weeks) ? formatNumber(stats.weeks) : null),
    field('logs.fieldUnits', Number.isFinite(stats.units) ? formatNumber(stats.units) : null),
    field('logs.fieldAsins', Number.isFinite(stats.asins) ? formatNumber(stats.asins) : null),
    field('logs.fieldMarkets',
      Number.isFinite(stats.marketplaces) ? formatNumber(stats.marketplaces) : null),
    field('logs.fieldChecks', Number.isFinite(stats.checks) ? formatNumber(stats.checks) : null),
    field('logs.fieldWarnings',
      Number.isFinite(stats.warnings) ? formatNumber(stats.warnings) : null),
    field('logs.fieldPeriod',
      stats.periodStart ? `${stats.periodStart} — ${stats.periodEnd}` : null),
  ].forEach((node) => { if (node) body.appendChild(node); });

  // Новые типы комиссий Amazon: их стоит развести по статьям вручную,
  // поэтому показываем отдельно, а не прячем в технические подробности
  if (Array.isArray(stats.unknownTypes) && stats.unknownTypes.length) {
    body.appendChild(field('logs.unknownTypes', stats.unknownTypes.join(', '), true));
  }

  if (entry.error) {
    const parts = [];
    if (entry.error.type) parts.push(code(entry.error.type));
    if (entry.error.http) parts.push(code(`HTTP ${entry.error.http}`));
    if (entry.error.path) parts.push(code(entry.error.path));

    const wrap = el('span');
    parts.forEach((part, i) => {
      if (i) wrap.append(' ');
      wrap.appendChild(part);
    });
    if (entry.error.detail) {
      wrap.appendChild(el('div', {
        style: 'margin-top:var(--sp-2); color:var(--ink-2);',
        text: entry.error.detail,
      }));
    }
    body.appendChild(field('logs.fieldTechnical', wrap, true));
  }

  if (entry.runUrl) {
    const link = el('a', {
      href: entry.runUrl, target: '_blank', rel: 'noopener noreferrer',
      text: t('logs.openRun'),
    });
    link.style.color = 'var(--accent)';
    body.appendChild(field('logs.fieldRun', link, true));
  }

  details.appendChild(body);
  return details;
}

/* --------------------------------------------------------------------------
   Отрисовка
   -------------------------------------------------------------------------- */

function visibleEntries() {
  return state.entries.filter((entry) => {
    if (state.source !== 'all' && entry.source !== state.source) return false;
    if (state.filter === 'issues' && entry.status === 'ok') return false;
    return true;
  });
}

function statTile(labelKey, value) {
  const card = el('article', { class: 'card stat' });
  card.appendChild(el('div', { class: 'stat__label', text: t(labelKey) }));
  card.appendChild(el('div', {
    class: 'stat__value', style: 'font-size:var(--fs-lg);', text: value,
  }));
  return card;
}

function render() {
  const all = state.entries;
  const ok = all.filter((e) => e.status === 'ok').length;
  const issues = all.length - ok;
  const last = all[0];

  statsBox.replaceChildren(
    statTile('logs.statTotal', formatNumber(all.length)),
    statTile('logs.statOk', formatNumber(ok)),
    statTile('logs.statIssues', formatNumber(issues)),
    statTile('logs.statLast', last ? formatDateTime(last.finishedAt) : '—'),
  );

  const rows = visibleEntries();
  listBox.replaceChildren();
  if (!rows.length) {
    listBox.appendChild(el('div', { class: 'card state', text: t('logs.empty') }));
    return;
  }
  rows.forEach((entry) => listBox.appendChild(entryNode(entry)));
}

function fillSourceSelect() {
  const previous = sourceSelect.value || 'all';
  sourceSelect.replaceChildren();
  sourceSelect.appendChild(new Option(t('logs.filterAll'), 'all'));
  for (const source of [...new Set(state.entries.map((e) => e.source))]) {
    sourceSelect.appendChild(new Option(sourceName(source), source));
  }
  sourceSelect.value = previous;
}

/* --------------------------------------------------------------------------
   События
   -------------------------------------------------------------------------- */

filterGroup.querySelectorAll('[data-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    state.filter = button.dataset.filter;
    filterGroup.querySelectorAll('[data-filter]').forEach((other) =>
      other.setAttribute('aria-checked', String(other === button)));
    render();
  });
});

sourceSelect.addEventListener('change', () => {
  state.source = sourceSelect.value;
  render();
});

onLangChange(() => {
  resetFormatters();
  applyTranslations();
  fillSourceSelect();
  render();
});

onZoneChange(() => {
  resetFormatters();
  render();
});

/* --- Старт --------------------------------------------------------------- */

(async function start() {
  const log = await loadSyncLog();
  state.entries = log.entries;
  fillSourceSelect();
  render();
})();
