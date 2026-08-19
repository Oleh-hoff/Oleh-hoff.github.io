/* ==========================================================================
   Журнал синхронизаций: чтение и разбор.

   Источник — data/sync-log.json, куда пишут сборщики. Формат общий для всех
   интеграций: у записи есть источник, статус, время и, если что-то пошло не
   так, причина с описанием. Новая интеграция ничего здесь менять не должна —
   достаточно писать записи с своим `source`.
   ========================================================================== */

const LOG_URL = 'data/sync-log.json';

/** Известные источники. Незнакомый покажем как есть — лучше, чем скрыть. */
export const SOURCES = {
  'amazon-spapi': { nameKey: 'log.source.amazon', schedule: 'log.schedule.4h' },
  'amazon-account': { nameKey: 'log.source.account', schedule: 'log.schedule.4h' },
  'amazon-weekly-sales': { nameKey: 'log.source.weeklySales', schedule: 'log.schedule.4h' },
  'amazon-fx': { nameKey: 'log.source.fx', schedule: 'log.schedule.4h' },
  'google-sheets': { nameKey: 'log.source.sheets', schedule: 'log.schedule.manual' },
};

/**
 * Что именно приехало за этот запуск — одной строкой.
 *
 * Без неё запись отвечает только «получилось / не получилось», а вопрос
 * «какие данные обновились» остаётся без ответа. Поля у источников разные,
 * поэтому перечисляем те, что есть, а не выдумываем общий набор.
 */
export function describeStats(entry, t) {
  const stats = entry?.stats || {};
  const parts = [];

  const add = (key, value) => {
    if (Number.isFinite(value)) parts.push(t(key, { n: value }));
  };

  add('log.stat.weeks', stats.weeks);
  add('log.stat.units', stats.units);
  add('log.stat.asins', stats.asins);
  add('log.stat.marketplaces', stats.marketplaces);
  add('log.stat.rows', stats.rows);
  add('log.stat.pages', stats.pages);
  add('log.stat.events', stats.events);
  add('log.stat.days', stats.days);
  add('log.stat.checks', stats.checks);
  add('log.stat.warnings', stats.warnings);
  add('log.stat.unavailable', stats.unavailable);
  add('log.stat.rates', stats.rates);

  return parts.join(' · ');
}

export const STATUS = {
  ok: { icon: 'check', toneKey: 'log.status.ok' },
  partial: { icon: 'warn', toneKey: 'log.status.partial' },
  error: { icon: 'error', toneKey: 'log.status.error' },
};

export async function loadSyncLog() {
  try {
    const response = await fetch(LOG_URL, { cache: 'no-store' });
    if (!response.ok) return { entries: [], missing: true };

    const data = await response.json();
    const entries = Array.isArray(data.entries) ? data.entries : [];

    // Новые сверху: в интерфейсе всегда интересует последнее состояние
    entries.sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
    return { entries, updatedAt: data.updatedAt, missing: false };
  } catch {
    // Файла ещё нет — это не ошибка, а «синхронизаций пока не было»
    return { entries: [], missing: true };
  }
}

/** Последняя запись по каждому источнику — то, что показывает колокольчик. */
export function latestBySource(entries) {
  const seen = new Map();
  for (const entry of entries) {
    if (!seen.has(entry.source)) seen.set(entry.source, entry);
  }
  return [...seen.values()];
}

/**
 * Состояние индикатора на колокольчике.
 * Тревога поднимается по последней записи каждого источника: одна давняя
 * ошибка, после которой всё починилось, не должна светиться вечно.
 */
export function overallStatus(entries) {
  const latest = latestBySource(entries);
  if (!latest.length) return 'none';
  if (latest.some((e) => e.status === 'error')) return 'error';
  if (latest.some((e) => e.status === 'partial')) return 'partial';
  return 'ok';
}

/** Сводка за сутки — показывается в шапке модального окна. */
export function last24h(entries) {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const recent = entries.filter((e) => new Date(e.finishedAt).getTime() >= since);
  return {
    total: recent.length,
    ok: recent.filter((e) => e.status === 'ok').length,
    failed: recent.filter((e) => e.status === 'error').length,
    partial: recent.filter((e) => e.status === 'partial').length,
  };
}

/** Когда ожидать следующую синхронизацию: расписание — каждые 4 часа. */
export function nextRunAfter(entry, hours = 4) {
  if (!entry?.finishedAt) return null;
  return new Date(new Date(entry.finishedAt).getTime() + hours * 3600 * 1000);
}

/**
 * Человеческое описание причины сбоя.
 * Коды Amazon сами по себе ничего не говорят тому, кто смотрит дашборд,
 * а не пишет код, — переводим их в понятную формулировку с указанием,
 * что делать.
 */
export function explainError(error, t) {
  if (!error) return null;

  const http = error.http;
  const type = String(error.type || '');

  if (http === 403) return t('log.reason.forbidden');
  if (http === 401) return t('log.reason.unauthorized');
  if (http === 429) return t('log.reason.throttled');
  if (http >= 500) return t('log.reason.amazonDown');
  if (http === 0 || type.includes('URLError')) return t('log.reason.network');
  if (type === 'sandbox-mode') return t('log.reason.sandbox');
  if (type === 'workflow-cancelled') return t('log.reason.cancelled');
  if (type === 'workflow-failure') return t('log.reason.crashed');
  if (type === 'RuntimeError' || type === 'ValueError') return t('log.reason.config');

  // Незнакомая ошибка не должна оставлять запись без причины: лучше показать
  // техническую формулировку, чем промолчать и оставить «просто не вышло».
  if (error.detail) return String(error.detail).slice(0, 300);
  if (type) return t('log.reason.unknown', { type });
  return null;
}
