/* ==========================================================================
   Колокольчик в шапке: состояние синхронизаций и модальное окно.

   Окно построено на <dialog>: закрытие по Esc, возврат фокуса и блокировка
   фона достаются от браузера, а не переписываются вручную.

   Индикатор на колокольчике смотрит на последнюю запись каждого источника.
   Показывать значок по всей истории нельзя: одна давняя ошибка, после
   которой всё починилось, светилась бы вечно и перестала бы что-либо значить.
   ========================================================================== */

import { t } from './i18n.js';
import { formatDateTime } from './format.js';
import {
  loadSyncLog, latestBySource, overallStatus, last24h, nextRunAfter,
  explainError, SOURCES,
} from './sync-log.js';

const SVG = 'http://www.w3.org/2000/svg';

/* --------------------------------------------------------------------------
   Значки состояния

   Статус несут форма и подпись, а не только цвет: зелёный и красный кружок
   одинаковой формы неразличимы при дальтонизме.
   -------------------------------------------------------------------------- */

export function statusIcon(status) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', `status-icon status-icon--${status}`);
  svg.setAttribute('aria-hidden', 'true');

  const circle = document.createElementNS(SVG, 'circle');
  circle.setAttribute('cx', '8');
  circle.setAttribute('cy', '8');
  circle.setAttribute('r', '7');
  svg.appendChild(circle);

  const mark = document.createElementNS(SVG, 'path');
  mark.setAttribute('fill', 'none');
  mark.setAttribute('stroke-width', '2');
  mark.setAttribute('stroke-linecap', 'round');
  mark.setAttribute('stroke-linejoin', 'round');
  mark.setAttribute('d', status === 'ok' ? 'M4.5 8.2l2.4 2.4 4.6-5'      // галочка
    : status === 'partial' ? 'M8 4.4v4.2M8 11.2v.4'                      // восклицание
      : 'M5.5 5.5l5 5M10.5 5.5l-5 5');                                   // крест
  svg.appendChild(mark);

  return svg;
}

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

/* --------------------------------------------------------------------------
   Строка списка
   -------------------------------------------------------------------------- */

function entryRow(entry) {
  const row = el('li', { class: `sync-row sync-row--${entry.status}` });

  row.appendChild(statusIcon(entry.status));

  const body = el('div', { class: 'sync-row__body' });

  const head = el('div', { class: 'sync-row__head' });
  head.appendChild(el('span', { class: 'sync-row__source', text: sourceName(entry.source) }));
  head.appendChild(el('span', {
    class: 'sync-row__status', text: t(`log.status.${entry.status}`),
  }));
  body.appendChild(head);

  body.appendChild(el('time', {
    class: 'sync-row__time',
    datetime: entry.finishedAt,
    text: formatDateTime(entry.finishedAt),
  }));

  if (entry.message) {
    body.appendChild(el('p', { class: 'sync-row__message', text: entry.message }));
  }

  // Причина сбоя — человеческой формулировкой, а не кодом ошибки
  const reason = explainError(entry.error, t);
  if (reason) {
    body.appendChild(el('p', { class: 'sync-row__reason', text: reason }));
  }

  row.appendChild(body);
  return row;
}

/* --------------------------------------------------------------------------
   Модальное окно
   -------------------------------------------------------------------------- */

function buildDialog() {
  const dialog = el('dialog', { class: 'sync-modal', id: 'sync-modal' });

  const header = el('div', { class: 'sync-modal__header' });
  header.appendChild(el('h2', { class: 'sync-modal__title', text: t('log.title') }));

  const close = el('button', {
    type: 'button', class: 'btn btn--icon', 'aria-label': t('log.close'),
  });
  const closeIcon = document.createElementNS(SVG, 'svg');
  closeIcon.setAttribute('viewBox', '0 0 24 24');
  closeIcon.setAttribute('fill', 'none');
  closeIcon.setAttribute('aria-hidden', 'true');
  const closePath = document.createElementNS(SVG, 'path');
  closePath.setAttribute('d', 'M6 6l12 12M18 6L6 18');
  closePath.setAttribute('stroke', 'currentColor');
  closePath.setAttribute('stroke-width', '1.8');
  closePath.setAttribute('stroke-linecap', 'round');
  closeIcon.appendChild(closePath);
  close.appendChild(closeIcon);
  close.addEventListener('click', () => dialog.close());
  header.appendChild(close);

  dialog.appendChild(header);
  dialog.appendChild(el('div', { class: 'sync-modal__summary', id: 'sync-summary' }));
  dialog.appendChild(el('ul', { class: 'sync-list', id: 'sync-list' }));

  const footer = el('div', { class: 'sync-modal__footer' });
  const more = el('a', { class: 'sync-modal__more', href: 'logs.html', text: t('log.more') });
  footer.appendChild(more);
  dialog.appendChild(footer);

  // Клик по подложке вне окна закрывает его — привычное поведение
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  return dialog;
}

function renderDialog(dialog, state) {
  const summary = dialog.querySelector('#sync-summary');
  const list = dialog.querySelector('#sync-list');

  summary.replaceChildren();
  list.replaceChildren();

  if (state.missing || !state.entries.length) {
    list.appendChild(el('li', { class: 'sync-empty', text: t('log.empty') }));
    return;
  }

  const day = last24h(state.entries);
  summary.appendChild(el('span', {
    text: t('log.summary24h', { total: day.total, ok: day.ok }),
  }));

  if (day.failed || day.partial) {
    summary.appendChild(el('span', {
      class: 'sync-modal__alarm',
      text: t('log.summaryIssues', { failed: day.failed, partial: day.partial }),
    }));
  }

  // Сначала текущее состояние каждой интеграции, затем недавние запуски
  for (const entry of latestBySource(state.entries)) {
    const row = entryRow(entry);
    row.classList.add('sync-row--current');

    const next = nextRunAfter(entry);
    if (next && entry.status !== 'error') {
      row.querySelector('.sync-row__body').appendChild(el('p', {
        class: 'sync-row__next',
        text: t('log.nextRun', { time: formatDateTime(next) }),
      }));
    }
    list.appendChild(row);
  }

  const rest = state.entries.slice(0, 8);
  if (rest.length) {
    list.appendChild(el('li', { class: 'sync-list__divider', text: t('log.recent') }));
    rest.forEach((entry) => list.appendChild(entryRow(entry)));
  }
}

/* --------------------------------------------------------------------------
   Сборка
   -------------------------------------------------------------------------- */

export async function mountNotifications(host) {
  const button = el('button', {
    type: 'button', class: 'btn btn--icon bell', id: 'bell',
    'aria-haspopup': 'dialog', 'aria-label': t('log.title'), title: t('log.title'),
  });

  const bellIcon = document.createElementNS(SVG, 'svg');
  bellIcon.setAttribute('viewBox', '0 0 24 24');
  bellIcon.setAttribute('fill', 'none');
  bellIcon.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(SVG, 'path');
  shape.setAttribute('d', 'M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5Z'
    + 'M10.3 19a2 2 0 0 0 3.4 0');
  shape.setAttribute('stroke', 'currentColor');
  shape.setAttribute('stroke-width', '1.7');
  shape.setAttribute('stroke-linecap', 'round');
  shape.setAttribute('stroke-linejoin', 'round');
  bellIcon.appendChild(shape);
  button.appendChild(bellIcon);

  const badge = el('span', { class: 'bell__badge', hidden: '' });
  button.appendChild(badge);
  host.appendChild(button);

  const dialog = buildDialog();
  document.body.appendChild(dialog);

  let state = { entries: [], missing: true };

  async function refresh() {
    state = await loadSyncLog();
    const status = overallStatus(state.entries);

    badge.hidden = status === 'ok' || status === 'none';
    badge.className = `bell__badge bell__badge--${status}`;
    button.setAttribute('aria-label',
      `${t('log.title')} — ${status === 'none' ? t('log.empty') : t(`log.status.${status}`)}`);
  }

  button.addEventListener('click', async () => {
    await refresh();               // на момент открытия данные должны быть свежими
    renderDialog(dialog, state);
    dialog.showModal();
  });

  await refresh();

  return { refresh };
}
