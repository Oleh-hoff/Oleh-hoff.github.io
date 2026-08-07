/* ==========================================================================
   Форматирование чисел и дат.

   Всё через Intl — разделители разрядов, порядок дня и месяца, названия
   месяцев меняются вместе с языком интерфейса сами. Форматтеры кэшируются:
   создание Intl.NumberFormat стоит заметно дороже вызова, а на графике их
   тысячи.
   ========================================================================== */

import { getLocale } from './i18n.js';

const cache = new Map();

function nf(options) {
  const key = getLocale() + JSON.stringify(options);
  if (!cache.has(key)) cache.set(key, new Intl.NumberFormat(getLocale(), options));
  return cache.get(key);
}

function df(options) {
  const key = 'd' + getLocale() + JSON.stringify(options);
  if (!cache.has(key)) cache.set(key, new Intl.DateTimeFormat(getLocale(), options));
  return cache.get(key);
}

/** Сбрасывается при смене языка — иначе форматтеры останутся от старой локали. */
export function resetFormatters() { cache.clear(); }

/* --------------------------------------------------------------------------
   Числа
   -------------------------------------------------------------------------- */

export function formatNumber(value, digits = 0) {
  return nf({ maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

/** Деньги целиком: $12,480 — для подписей и таблиц. */
export function formatMoney(value, currency = 'USD', digits = 0) {
  return nf({
    style: 'currency', currency,
    maximumFractionDigits: digits, minimumFractionDigits: digits,
  }).format(value);
}

/**
 * Компактные деньги: $4.2M, $12.9K — для крупных значений в плитках,
 * где полная запись расползается и мешает сравнивать плитки между собой.
 */
export function formatMoneyCompact(value, currency = 'USD') {
  return nf({
    style: 'currency', currency,
    notation: 'compact', compactDisplay: 'short',
    maximumFractionDigits: Math.abs(value) >= 10_000 ? 1 : 0,
  }).format(value);
}

export function formatCompact(value) {
  return nf({
    notation: 'compact', compactDisplay: 'short',
    maximumFractionDigits: Math.abs(value) >= 10_000 ? 1 : 0,
  }).format(value);
}

/** Знаковый процент для дельт: +12.4 % / −3.1 % */
export function formatDelta(value, digits = 1) {
  return nf({
    style: 'percent', signDisplay: 'exceptZero',
    maximumFractionDigits: digits, minimumFractionDigits: digits,
  }).format(value / 100);
}

export function formatPercent(value, digits = 1) {
  return nf({
    style: 'percent',
    maximumFractionDigits: digits, minimumFractionDigits: digits,
  }).format(value / 100);
}

/* --------------------------------------------------------------------------
   Даты
   -------------------------------------------------------------------------- */

/** Короткая подпись оси: «5 авг» / «Aug 5» / «5 серп» */
export function formatDayShort(date) {
  return df({ day: 'numeric', month: 'short' }).format(toDate(date));
}

/** Полная дата для подсказки и таблицы. */
export function formatDayFull(date) {
  return df({ day: 'numeric', month: 'long', year: 'numeric' }).format(toDate(date));
}

export function formatDateTime(date) {
  return df({
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(toDate(date));
}

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

/* --------------------------------------------------------------------------
   Шкалы
   -------------------------------------------------------------------------- */

/**
 * Круглые деления оси: 0 / 1 000 / 2 000 вместо 0 / 1 137 / 2 274.
 * Шаг подбирается из ряда 1–2–5×10ⁿ — единственный, который даёт числа,
 * читаемые без усилий на любом порядке величин.
 */
export function niceTicks(max, count = 4) {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];

  const rawStep = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;

  const step = (normalized <= 1 ? 1
    : normalized <= 2 ? 2
      : normalized <= 5 ? 5 : 10) * magnitude;

  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  return ticks;
}
