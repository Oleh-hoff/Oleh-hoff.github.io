/* ==========================================================================
   Часовой пояс интерфейса.

   Хранится отдельно от языка: продавец может смотреть кабинет на украинском,
   находясь в другом поясе, и это разные настройки.

   ВАЖНО ПРО КАЛЕНДАРНЫЕ ДАТЫ
   Пояс применяется только к моментам времени — «синхронизация в 14:03».
   К календарным датам («неделя с 18 августа») применять его нельзя: строка
   `2026-05-18` разбирается как полночь UTC, и в поясе западнее Гринвича
   она превратилась бы в 17 мая. Разделение сделано в format.js.
   ========================================================================== */

const STORAGE_KEY = 'dashboard.timezone';
const SYSTEM = 'system';

const listeners = new Set();

/** Пояс, который считает сама система. */
export function systemZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function getMode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return saved;
  } catch { /* приватный режим */ }
  return SYSTEM;
}

/**
 * Пояс для Intl. Для режима «как в системе» возвращает undefined — тогда
 * Intl берёт системный сам, и настройка следует за переездом устройства.
 */
export function getTimeZone() {
  const mode = getMode();
  return mode === SYSTEM ? undefined : mode;
}

/** Пояс, в котором интерфейс показывает время прямо сейчас. */
export function getResolved() {
  return getTimeZone() || systemZone();
}

export function setZone(zone) {
  if (zone !== SYSTEM && !isValidZone(zone)) return false;
  try { localStorage.setItem(STORAGE_KEY, zone); } catch { /* не критично */ }
  listeners.forEach((fn) => fn(getResolved(), getMode()));
  return true;
}

export function onZoneChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function isValidZone(zone) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------------------
   Список поясов
   -------------------------------------------------------------------------- */

let cachedList = null;

/**
 * Все пояса, которые знает браузер, с текущим смещением у каждого.
 * Смещение в подписи обязательно: «Europe/Kyiv» ничего не говорит тому, кто
 * выбирает по разнице с собой, а «UTC+3» говорит сразу.
 */
export function listZones() {
  if (cachedList) return cachedList;

  let names = [];
  try {
    names = Intl.supportedValuesOf('timeZone');
  } catch {
    names = [];
  }
  if (!names.length) {
    // Старый браузер без supportedValuesOf — короткий список вместо пустого
    names = ['UTC', 'Europe/Kyiv', 'Europe/Warsaw', 'Europe/Berlin', 'Europe/London',
      'Europe/Madrid', 'Europe/Rome', 'Europe/Stockholm', 'Europe/Amsterdam',
      'Europe/Dublin', 'Europe/Brussels', 'Europe/Lisbon', 'Europe/Istanbul',
      'Asia/Dubai', 'Asia/Riyadh', 'America/New_York', 'America/Los_Angeles'];
  }

  const system = systemZone();
  if (!names.includes(system)) names.unshift(system);

  cachedList = names
    .map((name) => ({ name, offset: offsetMinutes(name) }))
    .filter((zone) => zone.offset !== null)
    .sort((a, b) => a.offset - b.offset || a.name.localeCompare(b.name))
    .map((zone) => ({ ...zone, label: `${formatOffset(zone.offset)} · ${zone.name.replace(/_/g, ' ')}` }));

  return cachedList;
}

/** Смещение пояса от UTC в минутах на текущий момент. */
export function offsetMinutes(zone, when = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(when).reduce((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});

    const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day,
      +parts.hour, +parts.minute, +parts.second);
    return Math.round((asUTC - Math.floor(when.getTime() / 1000) * 1000) / 60000);
  } catch {
    return null;
  }
}

export function formatOffset(minutes) {
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hh}:${mm}`;
}
