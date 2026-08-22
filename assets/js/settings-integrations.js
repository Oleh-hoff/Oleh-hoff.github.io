/* ==========================================================================
   Окно настроек, вкладка «Интеграции»: SP-API, преп-центры, контейнеры.

   Раздел собирается целиком в JS и отдаётся окну настроек одним узлом:
   settings.js кладёт его во вторую панель вкладок и на смене языка дёргает
   sync(). Модуль сам подтягивает свой словарь — подключать строки в app.js
   не нужно, иначе раздел настроек нельзя было бы перенести на другую
   страницу, не вспомнив про второй импорт.

   Главное ограничение раздела — секреты. Client Secret, Refresh Token,
   токены преп-центров и форвардера, пароль ящика в браузере не сохраняются
   никогда: сайт лежит на GitHub Pages, репозиторий публичный, а localStorage
   читает любой скрипт этого домена (RULES.md §1.2). Поэтому у секретных
   полей нет ни одного пути в хранилище: они не попадают в состояние, их не
   слушает сохранение, а перед записью объект проверяется регуляркой и по
   именам ключей, и по самим строкам — см. commit(). Проверка значений тут не
   для красоты: ключ доступа сплошь и рядом передают прямо в адресе
   («?token=…», «https://user:pass@host»), и тогда он утёк бы в хранилище
   через совершенно несекретное поле «Базовый URL».
   ========================================================================== */

import { t, getLocale, applyTranslations } from './i18n.js';
import { formatDateTime } from './format.js';
import { loadSyncLog, latestBySource } from './sync-log.js';
import {
  DEFAULT_PARAMS, PREP_CENTERS, setParams, togglePrepCenter, movePrepCenter,
  isPrepSelected, onParamsChange,
} from './oos-params.js';
import { canonicalPrepId, normalizeName } from './oos-engine.js';
import './strings-integrations.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const STORAGE_KEY = 'dashboard.integrations';
/* Версия 2: признак «участвует в расчёте» больше не хранится здесь. Он живёт
   в `dashboard.oos.params` — см. PREP_CANON ниже. */
const SCHEMA_VERSION = 2;

/* Последний рубеж обороны перед записью: если в сохраняемом объекте вдруг
   заведётся ключ с таким именем, значит правка обошла первые два слоя защиты
   (белый список в serialize и отсутствие обработчиков у секретных полей). */
const SECRET_KEY_RE = /(secret|token|password|refresh)/i;

/* Тот же рубеж, но по строкам, а не по именам ключей: URL с ключом в
   query-string или с «user:pass@» в авторитете — обычное дело у складских
   API и у форвардеров, а поле рядом с подписью «Токен» от этого не спасает. */
const SECRET_VALUE_RE = /([?&](access_?token|token|api_?key|apikey|key|secret|password|pwd)=)|(^[a-z][a-z0-9+.-]*:\/\/[^/@\s]*:[^/@\s]+@)/i;

/* Карточки преп-центров и канонические идентификаторы расчёта.
   Таблица — только затравка базовых карточек: сам идентификатор с этого
   момента живёт НА карточке (`prep.canon`), в том числе у добавленной
   руками. Раньше его не было вовсе, и расчёт о новом складе не узнавал.

   Имена, рынки, лаги и алиасы базовых карточек берутся из PREP_CENTERS —
   справочника в `oos-params.js`. Два места одного продукта не имеют права
   называть разные числа: именно так карточка AsiaLog обещала 45 дней, а
   расчёт применял семь. */
const PREP_CANON = {
  wm: 'WM_EICHENZELL',
  kastellaun: 'KASTELLAUN',
  weprep: 'WEPREP_STOWMARKET',
  asialog: 'ASIALOG',
};

/* Признак «участвует в расчёте» ЗДЕСЬ НЕ ХРАНИТСЯ.

   У него два редактора — эта карточка и фильтр раздела «Логистика», — и пока
   каждый вёл свою копию, они перетирали друг друга: окно настроек собирало
   весь список из карточек и записывало его целиком поверх выбора,
   сделанного на странице. Хозяин состояния — `dashboard.oos.params`; сюда
   значение только читается (`isPrepSelected`), а пишется единственной
   функцией `togglePrepCenter`. Поэтому же карточка подписана на
   `onParamsChange`: правка на странице обязана быть видна здесь сразу. */
const prepActive = (prep) => (prep.canon ? isPrepSelected(prep.market, prep.canon) : false);

/* Идентификаторы площадок Amazon. Не переводятся и не вычисляются: это
   константы Amazon, человек сверяет их глазами с Seller Central.
   DE и UK первыми — именно их считает раздел «Логистика». */
const MARKETS = [
  { code: 'de', id: 'A1PA6795UKMFR9' },
  { code: 'uk', id: 'A1F83G8C2ARO7P' },
  { code: 'fr', id: 'A13V1IB3VIYZZH' },
  { code: 'it', id: 'APJ6JRA9NG5V4' },
  { code: 'es', id: 'A1RKKUPIHCS9HS' },
  { code: 'nl', id: 'A1805IZSGTT6HS' },
  { code: 'se', id: 'A2NODRKZP88ZB9' },
  { code: 'pl', id: 'A1C3SOZRARQ6R3' },
  { code: 'be', id: 'AMEN7PMS3EDWL' },
  { code: 'tr', id: 'A33AVAJ2PDY3EV' },
];

/* Рядом с каждым источником — эндпоинт или тип отчёта: без этого невозможно
   понять, что именно поедет в Amazon, а спор «почему цифры разные» упирается
   ровно в выбор отчёта. */
const SOURCES = [
  {
    id: 'fbaInventory', labelKey: 'int.src.fbaInventory',
    mono: 'FBA Inventory API · GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA',
  },
  {
    id: 'awd', labelKey: 'int.src.awd',
    mono: 'Amazon Warehousing and Distribution · awd/2024-05-09',
    hintKey: 'int.src.awdHint',
  },
  {
    id: 'inbound', labelKey: 'int.src.inbound',
    mono: 'GET_FBA_FULFILLMENT_INBOUND_SHIPMENT_ITEMS_DATA',
    hintKey: 'int.src.inboundHint',
  },
  {
    id: 'salesTraffic', labelKey: 'int.src.salesTraffic',
    mono: 'GET_SALES_AND_TRAFFIC_REPORT',
  },
  {
    id: 'orders', labelKey: 'int.src.orders',
    mono: 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL',
    hintKey: 'int.src.ordersNote',
  },
];

/* Имена переменных GitHub Actions Secrets. Статус не зашит: опросить GitHub
   со статической страницы нельзя, зато можно посмотреть в журнал
   синхронизаций — прогон, который принёс данные, без этих переменных
   не состоялся бы. См. secretsState(). */
const ACTIONS_SECRETS = [
  'SPAPI_CLIENT_ID', 'SPAPI_CLIENT_SECRET', 'SPAPI_REFRESH_TOKEN', 'SPAPI_SELLER_ID',
];

const ACTIONS_PATH = 'Settings → Secrets and variables → Actions';

/* Шаблон файла остатков преп-центра: те же колонки, что описаны в разделе. */
const CSV_TEMPLATE = 'SKU;St. in Karton;Kartons;Date\nSQ1;24;18;2026-08-15\n';

const REGIONS = ['eu', 'na', 'fe'];
const ENVS = ['production', 'sandbox'];
const CHANNELS = ['rest', 'csv', 'mail'];
const CONTAINER_SOURCES = ['file', 'sheet', 'api'];
const MARKET_CODES = ['DE', 'UK'];
const SCHEDULES = [4, 8, 12, 24, 0];

const ICON = {
  lock: 'M7 10V7a5 5 0 0 1 10 0v3M6 10h12v10H6z',
  warn: 'M12 9v4m0 3.5v.5M10.3 4.2 3.4 16.5A2 2 0 0 0 5.1 19.5h13.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z',
  info: 'M12 11v6m0-9.5v.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  check: 'M4 12.5 9.5 18 20 6.5',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 2.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z',
  eyeOff: 'M4 4l16 16M9.9 5.9A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.5 4.2'
    + 'M6.5 7.8A17 17 0 0 0 2.5 12S6 18.5 12 18.5c1 0 1.9-.2 2.7-.5',
  db: 'M4 6.5c0-1.4 3.6-2.5 8-2.5s8 1.1 8 2.5-3.6 2.5-8 2.5-8-1.1-8-2.5Z'
    + 'M4 6.5v11c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-11M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  download: 'M12 4v11m0 0 4-4m-4 4-4-4M5 19h14',
  upload: 'M12 16V5m0 0 4 4m-4-4-4 4M5 19h14',
};

/* --------------------------------------------------------------------------
   DOM-помощники

   el() и icon() повторяют settings.js намеренно: там они не экспортированы,
   а тянуть ради двух функций зависимость от чужого модуля — обменять одну
   копию на связанность двух файлов.
   -------------------------------------------------------------------------- */

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') node.textContent = value;
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  children.forEach((child) => child && node.appendChild(child));
  return node;
}

function icon(path, { width = '1.7', cls = null } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');   // смысл всегда есть текстом рядом
  if (cls) svg.setAttribute('class', cls);
  const shape = document.createElementNS(SVG_NS, 'path');
  shape.setAttribute('d', path);
  shape.setAttribute('stroke', 'currentColor');
  shape.setAttribute('stroke-width', width);
  shape.setAttribute('stroke-linecap', 'round');
  shape.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(shape);
  return svg;
}

/* --------------------------------------------------------------------------
   Хранение

   Читается всё через try/catch и приводится к типу: приватный режим, чужая
   вкладка и просто мусор в ключе не должны ронять окно настроек — вместо
   значения берётся базовое.
   -------------------------------------------------------------------------- */

function asString(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

function asBool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value, fallback, { min = -Infinity, max = Infinity, int = true } = {}) {
  const num = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(num)) return fallback;
  const clamped = Math.min(max, Math.max(min, num));
  return int ? Math.round(clamped) : clamped;
}

function asOneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function asStringList(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  return value.filter((item) => typeof item === 'string' && item.trim() !== '');
}

function prepDefaults(over = {}) {
  return {
    id: over.id || `prep-${Date.now().toString(36)}`,
    /* Канонический идентификатор расчёта. У базовых карточек он известен
       заранее, у добавленной руками появляется, как только введено название:
       без него расчёт про склад ничего не узнает, а выбор «участвует» некуда
       записать. Один раз назначенный, он больше не меняется — переименование
       карточки не должно осиротить уже сделанный выбор. */
    canon: '',
    name: '',
    market: 'DE',
    lagDays: DEFAULT_PARAMS.prepLagDays,
    aliases: [],
    channel: 'rest',
    /* Значения неиспользуемого канала сохраняются: заполнил REST, ушёл на
       почту, вернулся — URL на месте. Токенов и паролей здесь нет вовсе. */
    rest: { baseUrl: '', version: '', pollMinutes: 60, format: 'json' },
    csv: { delimiter: ';', encoding: 'utf-8' },
    mail: {
      address: '', senders: [], subject: '', attachment: '',
      imapHost: '', imapPort: 993,
    },
    ...over,
  };
}

/* Карточка базового склада целиком из справочника расчёта: имя, рынок, лаг и
   алиасы. Здесь не остаётся ни одного числа, которое можно было бы разойтись
   с движком. Kastellaun и AsiaLog выключены — это правило спецификации OOS,
   и живёт оно в `PREP_CENTERS.defaultSelected`, а не тут. */
function prepFromRegistry(cardId, over = {}) {
  const canon = PREP_CANON[cardId];
  const center = PREP_CENTERS[canon] || {};
  return prepDefaults({
    id: cardId,
    canon,
    name: center.name || '',
    market: center.market || 'DE',
    lagDays: Number.isFinite(center.lagDays) ? center.lagDays : DEFAULT_PARAMS.prepLagDays,
    aliases: (center.aliases || []).slice(),
    ...over,
  });
}

/* Базовый набор — то, с чем раздел открывается в чистом браузере. */
function defaults() {
  return {
    spapi: {
      region: 'eu',
      env: 'production',
      clientId: '',
      sellerId: '',
      marketplaces: ['A1PA6795UKMFR9', 'A1F83G8C2ARO7P'],
      sources: SOURCES.map((source) => source.id),
      schedule: { every: 4, pauseMs: 250, retries: 3 },
    },
    preps: [
      prepFromRegistry('wm', { channel: 'csv' }),
      prepFromRegistry('kastellaun', { channel: 'csv' }),
      prepFromRegistry('weprep', { channel: 'csv' }),
      prepFromRegistry('asialog', { channel: 'csv' }),
    ],
    containers: {
      source: 'file',
      sheetUrl: '',
      apiUrl: '',
      field: DEFAULT_PARAMS.forwarderField,
      ukMarker: DEFAULT_PARAMS.ukMarker,
      /* Всё, что ниже, читает расчёт (см. mirrorToForecast): базовые значения
         берутся из его параметров, чтобы поле и движок не разошлись. */
      prepNames: DEFAULT_PARAMS.prepNameHints.slice(),
      skipParents: DEFAULT_PARAMS.skipInvoiceDividedParents,
      readyMonths: DEFAULT_PARAMS.etaReadyMonths,
      produceMonths: DEFAULT_PARAMS.etaInProduceMonths,
      arrivedDays: DEFAULT_PARAMS.etaArrivedDays,
      arrivedInStock: DEFAULT_PARAMS.arrivedInStock,
    },
  };
}

function load() {
  const base = defaults();
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch { return base; }
  if (!raw) return base;

  let saved = null;
  try { saved = JSON.parse(raw); } catch { return base; }
  if (!saved || typeof saved !== 'object') return base;

  /* Чужая версия схемы игнорируется целиком. Миграций пока нет, а тихо
     съеденная несовместимость даст неверные числа в расчёте OOS. */
  if (saved.v !== SCHEMA_VERSION) return base;

  const spapi = saved.spapi && typeof saved.spapi === 'object' ? saved.spapi : {};
  base.spapi.region = asOneOf(spapi.region, REGIONS, base.spapi.region);
  base.spapi.env = asOneOf(spapi.env, ENVS, base.spapi.env);
  base.spapi.clientId = asString(spapi.clientId, base.spapi.clientId);
  base.spapi.sellerId = asString(spapi.sellerId, base.spapi.sellerId);

  const known = MARKETS.map((market) => market.id);
  const marketplaces = asStringList(spapi.marketplaces, null);
  if (marketplaces) base.spapi.marketplaces = marketplaces.filter((id) => known.includes(id));

  const sourceIds = SOURCES.map((source) => source.id);
  const sources = asStringList(spapi.sources, null);
  if (sources) base.spapi.sources = sources.filter((id) => sourceIds.includes(id));

  const schedule = spapi.schedule && typeof spapi.schedule === 'object' ? spapi.schedule : {};
  base.spapi.schedule.every = asOneOf(
    asNumber(schedule.every, base.spapi.schedule.every), SCHEDULES, base.spapi.schedule.every,
  );
  base.spapi.schedule.pauseMs = asNumber(schedule.pauseMs, base.spapi.schedule.pauseMs, { min: 0, max: 60000 });
  base.spapi.schedule.retries = asNumber(schedule.retries, base.spapi.schedule.retries, { min: 0, max: 10 });

  /* Пустой список преп-центров — законное состояние: человек мог удалить все
     карточки. Поэтому проверяется тип, а не длина. */
  if (Array.isArray(saved.preps)) {
    base.preps = saved.preps
      .filter((prep) => prep && typeof prep === 'object')
      .map((prep, index) => {
        const rest = prep.rest && typeof prep.rest === 'object' ? prep.rest : {};
        const csv = prep.csv && typeof prep.csv === 'object' ? prep.csv : {};
        const mail = prep.mail && typeof prep.mail === 'object' ? prep.mail : {};
        const id = asString(prep.id, '') || `prep-${index}-${Date.now().toString(36)}`;
        return prepDefaults({
          id,
          // Канон сохранённой карточки: у базовой он известен по таблице, у
          // добавленной руками лежит в самой записи.
          canon: asString(prep.canon, '') || PREP_CANON[id] || '',
          name: asString(prep.name, ''),
          market: asOneOf(prep.market, MARKET_CODES, 'DE'),
          lagDays: asNumber(prep.lagDays, DEFAULT_PARAMS.prepLagDays, { min: 0, max: 365 }),
          aliases: asStringList(prep.aliases, []),
          channel: asOneOf(prep.channel, CHANNELS, 'rest'),
          rest: {
            baseUrl: asString(rest.baseUrl, ''),
            version: asString(rest.version, ''),
            pollMinutes: asNumber(rest.pollMinutes, 60, { min: 1, max: 10080 }),
            format: asOneOf(rest.format, ['json', 'xml', 'csv'], 'json'),
          },
          csv: {
            delimiter: asOneOf(csv.delimiter, [',', ';', '\t'], ';'),
            encoding: asOneOf(csv.encoding, ['utf-8', 'windows-1252'], 'utf-8'),
          },
          mail: {
            address: asString(mail.address, ''),
            senders: asStringList(mail.senders, []),
            subject: asString(mail.subject, ''),
            attachment: asString(mail.attachment, ''),
            imapHost: asString(mail.imapHost, ''),
            imapPort: asNumber(mail.imapPort, 993, { min: 1, max: 65535 }),
          },
        });
      });
  }

  const cont = saved.containers && typeof saved.containers === 'object' ? saved.containers : {};
  const container = base.containers;
  container.source = asOneOf(cont.source, CONTAINER_SOURCES, container.source);
  container.sheetUrl = asString(cont.sheetUrl, container.sheetUrl);
  container.apiUrl = asString(cont.apiUrl, container.apiUrl);
  container.field = asString(cont.field, container.field);
  container.ukMarker = asString(cont.ukMarker, container.ukMarker);
  container.prepNames = asStringList(cont.prepNames, container.prepNames);
  container.skipParents = asBool(cont.skipParents, container.skipParents);
  container.readyMonths = asNumber(cont.readyMonths, container.readyMonths, { min: 0, max: 24, int: false });
  container.produceMonths = asNumber(cont.produceMonths, container.produceMonths, { min: 0, max: 24, int: false });
  container.arrivedDays = asNumber(cont.arrivedDays, container.arrivedDays, { min: 0, max: 365 });
  container.arrivedInStock = asBool(cont.arrivedInStock, container.arrivedInStock);

  return base;
}

/**
 * Белый список полей для записи.
 *
 * Объект собирается литералом из именованных значений — не Object.assign из
 * состояния и не обход DOM «все input». Поле, которого здесь нет, физически
 * не может попасть в хранилище; именно поэтому у преп-центра выписаны
 * rest.baseUrl и rest.version, но нет rest.token, а у почты — всё, кроме
 * пароля.
 */
function serialize(state) {
  return {
    v: SCHEMA_VERSION,
    spapi: {
      region: state.spapi.region,
      env: state.spapi.env,
      clientId: state.spapi.clientId,
      sellerId: state.spapi.sellerId,
      marketplaces: [...state.spapi.marketplaces],
      sources: [...state.spapi.sources],
      schedule: {
        every: state.spapi.schedule.every,
        pauseMs: state.spapi.schedule.pauseMs,
        retries: state.spapi.schedule.retries,
      },
    },
    preps: state.preps.map((prep) => ({
      id: prep.id,
      canon: prep.canon,
      name: prep.name,
      market: prep.market,
      // `active` здесь намеренно нет: см. комментарий у PREP_CANON.
      lagDays: prep.lagDays,
      aliases: [...prep.aliases],
      channel: prep.channel,
      rest: {
        baseUrl: safeUrl(prep.rest.baseUrl),
        version: prep.rest.version,
        pollMinutes: prep.rest.pollMinutes,
        format: prep.rest.format,
      },
      csv: { delimiter: prep.csv.delimiter, encoding: prep.csv.encoding },
      mail: {
        address: prep.mail.address,
        senders: [...prep.mail.senders],
        subject: prep.mail.subject,
        attachment: prep.mail.attachment,
        imapHost: prep.mail.imapHost,
        imapPort: prep.mail.imapPort,
      },
    })),
    containers: {
      source: state.containers.source,
      sheetUrl: safeUrl(state.containers.sheetUrl),
      apiUrl: safeUrl(state.containers.apiUrl),
      field: state.containers.field,
      ukMarker: state.containers.ukMarker,
      prepNames: [...state.containers.prepNames],
      skipParents: state.containers.skipParents,
      readyMonths: state.containers.readyMonths,
      produceMonths: state.containers.produceMonths,
      arrivedDays: state.containers.arrivedDays,
      arrivedInStock: state.containers.arrivedInStock,
    },
  };
}

/**
 * Убирает из адреса всё, чем передают ключ доступа: «user:pass@» в авторитете
 * и query-параметры с секретными именами. Остальной адрес сохраняется как
 * есть — он и есть та настройка, ради которой поле заведено.
 */
function safeUrl(value) {
  const raw = typeof value === 'string' ? value : '';
  if (raw === '' || !SECRET_VALUE_RE.test(raw)) return raw;
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    for (const name of [...url.searchParams.keys()]) {
      if (SECRET_KEY_RE.test(name) || /^(api_?key|apikey|key|pwd)$/i.test(name)) {
        url.searchParams.delete(name);
      }
    }
    return url.toString();
  } catch {
    // Недописанный адрес разобрать нечем — режем по первому «?» и по «@»
    return raw.split('?')[0].replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/i, '$1');
  }
}

/** Ищет ключ, похожий на секрет, на любой глубине объекта. */
function hasSecretKey(value) {
  if (Array.isArray(value)) return value.some(hasSecretKey);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, item]) => SECRET_KEY_RE.test(key) || hasSecretKey(item));
  }
  return false;
}

/** Ищет строку, похожую на переданный в адресе ключ, на любой глубине. */
function hasSecretValue(value) {
  if (typeof value === 'string') return SECRET_VALUE_RE.test(value);
  if (Array.isArray(value)) return value.some(hasSecretValue);
  if (value && typeof value === 'object') return Object.values(value).some(hasSecretValue);
  return false;
}

/**
 * Переносит в параметры расчёта всё, что редактируется здесь, а считается в
 * «Логистике»: правила классификации контейнеров §4, датировку без ETA,
 * названия складов и лаг до FBA у каждого. Раньше сюда доезжала только
 * датировка, а остальные поля были подписаны правдой и действовали мимо
 * движка — тот носил свои константы (UK_MARKER, PREP_ALIASES, безусловный
 * пропуск «Invoice divided»).
 *
 * Признака «участвует в расчёте» здесь НЕТ намеренно: его пишет
 * `togglePrepCenter` прямо из обработчика тумблера — одна функция записи на
 * оба редактора. Иначе это зеркало затирало бы выбор, сделанный на странице.
 */
function mirrorToForecast(state) {
  const aliases = {};
  const lags = {};
  for (const prep of state.preps) {
    if (!prep.canon) continue;      // безымянная карточка расчёту неизвестна
    /* Название склада — тоже алиас: в forwarder-поле пишут именно его.
       Дубликаты убираются по нормализованному виду, а не по строке: иначе
       «WM / Eichenzell» и «WM Eichenzell» приехали бы двумя записями, набор
       перестал бы совпадать с базовым, и подпись «базовые пороги» гасла бы
       от одного открытия окна настроек. */
    const seen = new Set();
    const list = [];
    for (const value of [...prep.aliases, prep.name]) {
      const text = String(value || '').trim();
      const norm = normalizeName(text);
      if (!text || !norm || seen.has(norm)) continue;
      seen.add(norm);
      list.push(text);
    }
    aliases[prep.canon] = list;
    lags[prep.canon] = prep.lagDays;
  }
  try {
    setParams({
      etaReadyMonths: state.containers.readyMonths,
      etaInProduceMonths: state.containers.produceMonths,
      etaArrivedDays: state.containers.arrivedDays,
      forwarderField: state.containers.field,
      ukMarker: state.containers.ukMarker,
      skipInvoiceDividedParents: state.containers.skipParents,
      arrivedInStock: state.containers.arrivedInStock,
      prepNameHints: state.containers.prepNames,
      prepAliases: aliases,
      prepLagByCenter: lags,
    });
  } catch { /* расчёт переживёт: параметры останутся прежними */ }
}

/* --------------------------------------------------------------------------
   Проверки значений полей
   -------------------------------------------------------------------------- */

const isUrl = (value) => /^https?:\/\/\S+$/i.test(value);
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isPort = (value) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535;
const isNumber = (value) => Number.isFinite(Number.parseFloat(value));

/* --------------------------------------------------------------------------
   Сборка раздела
   -------------------------------------------------------------------------- */

/**
 * Строит вкладку «Интеграции» окна настроек.
 *
 * @returns {{node: HTMLElement, sync: () => void,
 *            clearSecrets: () => void, flush: () => void}}
 *   node — корень панели, sync() — перерисовка подписей на смене языка,
 *   clearSecrets() — очистка секретных полей (окно обязано звать её на close),
 *   flush() — досрочная запись отложенного сохранения.
 */
export function integrationsPanel() {
  let state = load();

  /* Подписи, зависящие от значений (состояние плитки, пилюли, aria-label с
     именем). Статические подписи так не хранятся: они помечены data-i18n и
     переводятся applyTranslations — иначе список из полутора сотен строк
     пришлось бы править при каждой правке разметки. */
  const refreshers = [];
  const secrets = new Map();
  let lastTest = null;
  let saveTimer = 0;

  /* Состояние сборщика по журналу синхронизаций. Плитке и статусам переменных
     GitHub брать его больше неоткуда: страница статическая, спросить у Amazon
     или у GitHub ей нечем, а выдумывать «подключено» нельзя. */
  const syncState = { loaded: false, entry: null };

  const live = el('div', {
    class: 'int-live visually-hidden', role: 'status', 'aria-live': 'polite',
  });

  /* Видимая половина той же новости. До неё зрячий не видел ни подтверждения
     записи, ни отказа записи, ни отказа добавить дубликат: role="status" в
     visually-hidden слышно только скринридеру. Здесь aria-hidden — иначе одно
     и то же сообщение объявлялось бы дважды. */
  const status = el('p', { class: 'int-status', 'aria-hidden': 'true', hidden: '' });

  const node = el('div', {
    class: 'settings-panel settings-panel--wide',
    id: 'set-panel-integrations',
    role: 'tabpanel',
    'aria-labelledby': 'set-tab-integrations',
    tabindex: '0',
  });

  function refresh(owner, fn) {
    refreshers.push({ owner, fn });
    fn();
  }

  function runRefreshers() {
    for (let i = refreshers.length - 1; i >= 0; i -= 1) {
      const entry = refreshers[i];
      // Узел выброшен из панели (удалили карточку) — запись больше не нужна
      if (entry.owner && !node.contains(entry.owner)) refreshers.splice(i, 1);
      else entry.fn();
    }
  }

  function announce(key, vars, tone = 'ok') {
    const text = t(key, vars);
    live.textContent = text;
    status.textContent = text;
    status.dataset.tone = tone;
    status.hidden = false;
  }

  /* --- запись ------------------------------------------------------------ */

  function nowTime() {
    try {
      return new Intl.DateTimeFormat(getLocale(), {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).format(new Date());
    } catch { return ''; }
  }

  function commit() {
    clearTimeout(saveTimer);
    const payload = serialize(state);

    /* Третий слой защиты (см. шапку файла) — и по именам ключей, и по самим
       строкам. Сюда попадают только те правки, которые обошли белый список;
       молча записать такое нельзя, и молча промолчать об этом тоже. */
    if (hasSecretKey(payload) || hasSecretValue(payload)) {
      console.error('[integrations] в сохраняемом объекте нашлось похожее на секрет — запись отменена');
      announce('int.storage.blocked', null, 'alert');
      return;
    }

    /* Ключ, вписанный в адрес, до хранилища не доезжает: serialize() режет
       query и «user:pass@». Сказать об этом обязаны — иначе человек уверен,
       что сохранил рабочий адрес с ключом. */
    const strippedUrl = [
      state.containers.sheetUrl, state.containers.apiUrl,
      ...state.preps.map((prep) => prep.rest.baseUrl),
    ].some((raw) => typeof raw === 'string' && raw !== '' && safeUrl(raw) !== raw);

    let json = '';
    try { json = JSON.stringify(payload); } catch { return; }

    try {
      localStorage.setItem(STORAGE_KEY, json);
      // Датировка и участие препцентров нужны расчёту «Логистики», а он
      // читает свой ключ — зеркалим, иначе подпись под тумблером врёт
      mirrorToForecast(state);
      if (strippedUrl) announce('int.storage.keyInUrl', null, 'alert');
      else announce('int.savedAt', { time: nowTime() });
    } catch {
      // приватный режим или переполненная квота: окно продолжает работать
      announce('int.saveFailed', null, 'alert');
    }
  }

  /* Кнопки «Сохранить» в этом окне нет — как и у языка, пояса и темы.
     Дребезг в 300 мс не даёт писать в хранилище на каждую букву. */
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(commit, 300);
  }

  /* --- секреты ----------------------------------------------------------- */

  function registerSecret(id, input) {
    secrets.set(id, input);
  }

  function secretValue(id) {
    return (secrets.get(id)?.value || '').trim();
  }

  /* Карточку удалили — её поля больше не в панели, и держать их в карте
     незачем: за сессию она иначе распухает на каждое «добавить → удалить». */
  function dropDetachedSecrets() {
    for (const [id, input] of secrets) {
      if (!node.contains(input)) secrets.delete(id);
    }
  }

  /** Значения секретов живут только в полях; окно закрылось — их нет. */
  function clearSecrets() {
    for (const input of secrets.values()) {
      input.value = '';
      input.type = 'password';
    }
  }

  /* --- кирпичи ----------------------------------------------------------- */

  function groupHead(headId, titleKey, leadKey) {
    return el('header', { class: 'int-group__head' }, [
      el('h3', { class: 'int-group__title', id: headId, 'data-i18n': titleKey }),
      el('p', { class: 'int-group__lead', 'data-i18n': leadKey }),
    ]);
  }

  function note(key) {
    return el('p', { class: 'alert alert--note int-note' }, [
      icon(ICON.info, { cls: 'int-ico' }),
      el('span', { 'data-i18n': key }),
    ]);
  }

  /* id нужен там, где подсказку надо связать с чекбоксом: у флажков нет
     fieldShell, а без aria-describedby скринридер объявит «Заказы, флажок» и
     ни слова про 30-дневное окно отчёта. */
  function hint(key, extraClass = '', id = null) {
    return el('p', {
      class: `int-field__hint ${extraClass}`.trim(), ...(id ? { id } : {}),
    }, [el('span', { 'data-i18n': key })]);
  }

  function warnBlock(key, level) {
    return el('p', {
      class: `int-warn int-warn--${level}`, role: 'status', hidden: '',
    }, [icon(ICON.warn, { cls: 'int-ico' }), el('span', { 'data-i18n': key })]);
  }

  function fieldset(legendKey, hintKey) {
    const box = el('fieldset', { class: 'int-fieldset' }, [
      el('legend', { class: 'int-fieldset__legend', 'data-i18n': legendKey }),
    ]);
    if (hintKey) box.appendChild(hint(hintKey));
    return box;
  }

  function fieldShell({ id, labelKey, unitKey, hintKey, errKey, savedHint = false }) {
    const wrap = el('div', { class: 'int-field' });
    const label = el('label', { class: 'int-field__label', for: id }, [
      el('span', { 'data-i18n': labelKey }),
    ]);
    /* Единица измерения — внутри подписи: «Лаг до FBA, дней» читается одной
       фразой, а не двумя обрывками по разные стороны поля. */
    if (unitKey) {
      label.appendChild(document.createTextNode(', '));
      label.appendChild(el('span', { class: 'int-unit', 'data-i18n': unitKey }));
    }
    wrap.appendChild(label);

    const describedBy = [];
    const hintNodes = [];
    let savedNode = null;
    let errorNode = null;
    // hintKey может быть списком: у адресов к пояснению добавляется отдельная
    // строка про то, что ключ доступа в URL писать не надо
    (Array.isArray(hintKey) ? hintKey : [hintKey]).filter(Boolean).forEach((key, index) => {
      const hintId = `${id}-hint${index ? index + 1 : ''}`;
      hintNodes.push(el('p', { class: 'int-field__hint', id: hintId }, [
        el('span', { 'data-i18n': key }),
      ]));
      describedBy.push(hintId);
    });
    /* Помечено то, что сохраняется, — и помечено всё, что сохраняется из
       свободного текста. Раньше подпись стояла только у Client ID и Seller ID,
       и человек достраивал обратное правило: раз у адреса пометки нет, значит
       адрес не сохраняется. Числа, флажки и сегменты сохраняются тоже — про
       них говорит подвал раздела, иначе строка «сохраняется в браузере»
       стояла бы под каждым полем и перестала бы читаться. */
    if (savedHint) {
      savedNode = el('p', {
        class: 'int-field__hint int-field__hint--saved', id: `${id}-saved`,
      }, [icon(ICON.db, { cls: 'int-ico' }), el('span', { 'data-i18n': 'int.storage.fieldSaved' })]);
      describedBy.push(`${id}-saved`);
    }
    if (errKey) {
      errorNode = el('p', {
        class: 'int-field__hint int-field__error', id: `${id}-err`, role: 'status', hidden: '',
      }, [icon(ICON.warn, { cls: 'int-ico' }), el('span', { 'data-i18n': errKey })]);
      describedBy.push(`${id}-err`);
    }
    return { wrap, hintNodes, savedNode, errorNode, describedBy };
  }

  function textField({
    id, labelKey, hintKey, errKey, unitKey, value = '', type = 'text',
    placeholderKey, attrs = {}, validate, onInput,
  }) {
    /* Сохраняется ровно то, у чего есть data-store; число помечать не надо —
       см. комментарий в fieldShell. */
    const savedHint = type !== 'number' && Boolean(attrs['data-store']);
    const shell = fieldShell({ id, labelKey, unitKey, hintKey, errKey, savedHint });
    const input = el('input', {
      class: 'input int-input', id, type, autocomplete: 'off', spellcheck: 'false', ...attrs,
    });
    input.value = value;
    if (placeholderKey) input.setAttribute('data-i18n-attr', `placeholder:${placeholderKey}`);
    if (shell.describedBy.length) input.setAttribute('aria-describedby', shell.describedBy.join(' '));

    input.addEventListener('input', () => {
      const raw = input.value.trim();
      if (validate && shell.errorNode) {
        const bad = raw !== '' && !validate(raw);
        shell.errorNode.hidden = !bad;
        input.setAttribute('aria-invalid', String(bad));
      }
      onInput?.(input.value, input);
      save();
    });

    // Отфильтровать обязательно: append(null) кладёт в разметку текст «null»,
    // а поля без подсказки — половина раздела
    shell.wrap.append(...[input, ...shell.hintNodes, shell.savedNode, shell.errorNode].filter(Boolean));
    return { node: shell.wrap, input };
  }

  function numberField({
    id, labelKey, unitKey, hintKey, value, min, max, step = 1, integer = true,
    errKey = 'int.err.number', validate = isNumber, onChange,
  }) {
    /* Текущее значение держится в замыкании и обновляется на каждый ввод:
       иначе стёртое поле откатывается к тому, что стояло при сборке панели, —
       поменял лаг на 14, стёр поле, получил 7. */
    let current = value;
    const field = textField({
      id, labelKey, unitKey, hintKey, errKey,
      type: 'number', value: String(value),
      attrs: { min: String(min), max: String(max), step: String(step), inputmode: integer ? 'numeric' : 'decimal' },
      validate,
      onInput: (raw) => {
        // Пустое поле не затирает значение: человек стирает, чтобы набрать заново
        if (raw.trim() === '') return;
        current = asNumber(raw, current, { min, max, int: integer });
        onChange(current);
      },
    });
    // При уходе из поля значение приводится к границам — иначе в хранилище
    // осталось бы то, что человек набрал «на секунду»
    field.input.addEventListener('change', () => {
      current = asNumber(field.input.value, current, { min, max, int: integer });
      field.input.value = String(current);
      onChange(current);
      save();
    });
    return field;
  }

  function secretField({ id, labelKey }) {
    const wrap = el('div', { class: 'int-field int-field--secret' });
    wrap.appendChild(el('label', { class: 'int-field__label', for: id }, [
      el('span', { 'data-i18n': labelKey }),
    ]));

    /* У поля нет ни data-store, ни обработчика сохранения: сохранение слушает
       только [data-store], а секретные поля туда не входят по построению. */
    const input = el('input', {
      class: 'input int-input', id, type: 'password',
      autocomplete: 'off', spellcheck: 'false',
      'data-secret': 'true', 'aria-describedby': `${id}-note`,
    });

    const toggle = el('button', {
      type: 'button', class: 'input-group__action', 'aria-pressed': 'false',
      'data-i18n-attr': 'aria-label:int.secretShow',
    }, [icon(ICON.eye)]);

    toggle.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.setAttribute('aria-pressed', String(show));
      toggle.setAttribute('data-i18n-attr', `aria-label:${show ? 'int.secretHide' : 'int.secretShow'}`);
      toggle.setAttribute('aria-label', t(show ? 'int.secretHide' : 'int.secretShow'));
      toggle.replaceChildren(icon(show ? ICON.eyeOff : ICON.eye));
      input.focus();
    });

    wrap.appendChild(el('div', { class: 'input-group' }, [input, toggle]));
    wrap.appendChild(el('p', {
      class: 'int-field__hint int-field__hint--secret', id: `${id}-note`,
    }, [icon(ICON.lock, { cls: 'int-ico' }), el('span', { 'data-i18n': 'int.secretNotSaved' })]));

    registerSecret(id, input);
    return wrap;
  }

  function selectField({ id, labelKey, hintKey, options, value, onChange }) {
    const shell = fieldShell({ id, labelKey, hintKey });
    const select = el('select', { class: 'select int-select', id });
    for (const option of options) {
      select.appendChild(el('option', {
        value: option.value,
        ...(option.textKey ? { 'data-i18n': option.textKey } : { text: option.text }),
      }));
    }
    select.value = String(value);
    if (shell.describedBy.length) select.setAttribute('aria-describedby', shell.describedBy.join(' '));
    select.addEventListener('change', () => { onChange(select.value); save(); });
    shell.wrap.append(...[select, ...shell.hintNodes].filter(Boolean));
    return shell.wrap;
  }

  function checkPlate({ labelKey, text, mono, checked, onChange, describedBy }) {
    const input = el('input', { type: 'checkbox' });
    input.checked = checked;
    // Без этого скринридер объявляет флажок без объяснения — а объяснения
    // здесь самые содержательные в разделе (30 дней, «Invoice divided»)
    if (describedBy) input.setAttribute('aria-describedby', describedBy);
    input.addEventListener('change', () => { onChange(input.checked); save(); });
    const name = el('span', {
      class: 'int-check__name', ...(labelKey ? { 'data-i18n': labelKey } : { text }),
    });
    const plate = el('label', { class: 'int-check' }, [input, name]);
    if (mono) plate.appendChild(el('code', { class: 'fba-mono', text: mono }));
    return { node: plate, input };
  }

  /* Сегментированный переключатель: radiogroup со стрелками и roving
     tabindex — внутри группы одна остановка Tab, как у радиокнопок. */
  function segmented({ labelKey, options, current, onPick }) {
    const wrap = el('div', { class: 'int-field' });
    wrap.appendChild(el('span', { class: 'int-field__label', 'data-i18n': labelKey }));

    const bar = el('div', {
      class: 'segmented', role: 'radiogroup', 'data-i18n-attr': `aria-label:${labelKey}`,
    });

    const buttons = options.map((option) => {
      const button = el('button', {
        type: 'button', class: 'segmented__item', role: 'radio',
        'data-value': option.value,
        ...(option.textKey ? { 'data-i18n': option.textKey } : { text: option.text }),
      });
      button.addEventListener('click', () => {
        onPick(option.value);
        syncBar();
        save();
      });
      bar.appendChild(button);
      return button;
    });

    function syncBar() {
      buttons.forEach((button) => {
        const on = button.dataset.value === String(current());
        button.setAttribute('aria-checked', String(on));
        button.tabIndex = on ? 0 : -1;
      });
    }

    bar.addEventListener('keydown', (event) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      const index = buttons.findIndex((button) => button.tabIndex === 0);
      const next = buttons[(index + step + buttons.length) % buttons.length];
      next.click();
      next.focus();
    });

    refresh(wrap, syncBar);
    wrap.appendChild(bar);
    return wrap;
  }

  /* Список чипов-алиасов: по ним контейнеры классифицируются, поэтому он
     редактируемый, а не зашит в код. */
  function aliasList({ id, legendKey, hintKey, getList, onChange }) {
    const box = fieldset(legendKey, hintKey);
    const list = el('ul', { class: 'int-aliases' });
    const input = el('input', {
      class: 'input int-input int-alias__input', id, type: 'text', autocomplete: 'off',
      'data-i18n-attr': 'placeholder:int.prep.aliasPlaceholder, aria-label:int.prep.aliasAdd',
    });
    const addButton = el('button', {
      type: 'button', class: 'btn btn--ghost int-alias__add', 'data-i18n': 'int.prep.aliasAdd',
    });
    /* Отказ добавить дубликат обязан быть виден: без этой строки нажатие
       Enter выглядит как сломанная кнопка — чип не появился, поле не
       очистилось, на экране не изменилось ничего. */
    const duplicate = el('p', {
      class: 'int-field__hint int-field__error', id: `${id}-dup`, hidden: '',
    }, [icon(ICON.warn, { cls: 'int-ico' }), el('span', { 'data-i18n': 'int.prep.aliasDuplicate' })]);
    input.setAttribute('aria-describedby', `${id}-dup`);
    input.addEventListener('input', () => {
      duplicate.hidden = true;
      input.removeAttribute('aria-invalid');
    });

    function remove(index) {
      const items = getList();
      items.splice(index, 1);
      onChange(items);
      renderChips();
      save();
      // Фокус переезжает на соседний чип, а если он был последним — в поле ввода
      const next = list.querySelectorAll('.int-alias__x')[Math.min(index, items.length - 1)];
      (next || input).focus();
    }

    function renderChips() {
      list.replaceChildren();
      getList().forEach((alias, index) => {
        const kill = el('button', { type: 'button', class: 'int-alias__x' }, [
          icon(ICON.x, { width: '2' }),
        ]);
        kill.setAttribute('aria-label', t('int.prep.aliasRemove', { alias }));
        refresh(kill, () => kill.setAttribute('aria-label', t('int.prep.aliasRemove', { alias })));
        kill.addEventListener('click', () => remove(index));
        list.appendChild(el('li', { class: 'int-alias' }, [el('span', { text: alias }), kill]));
      });
      list.appendChild(el('li', { class: 'int-alias--add' }, [input, addButton]));
    }

    function add() {
      const value = input.value.trim();
      if (value === '') return;
      const items = getList();
      if (items.some((alias) => alias.toLowerCase() === value.toLowerCase())) {
        duplicate.hidden = false;              // молча проглотить — значит соврать
        input.setAttribute('aria-invalid', 'true');
        announce('int.prep.aliasDuplicate', null, 'alert');
        return;
      }
      duplicate.hidden = true;
      input.removeAttribute('aria-invalid');
      items.push(value);
      onChange(items);
      renderChips();
      input.value = '';
      input.focus();     // алиасы обычно вводят несколько подряд
      save();
    }

    addButton.addEventListener('click', add);
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();   // иначе Enter отправит форму окна и закроет его
      add();
    });

    renderChips();
    box.append(list, duplicate);
    return box;
  }

  /* Зона загрузки: файл не читается и никуда не отправляется — со статической
     страницы разбирать чужую выгрузку нечем, а класть её содержимое в
     localStorage нельзя тем более. Показывается только имя. */
  function dropZone({ id, labelKey }) {
    /* tabindex="-1": .visually-hidden убирает элемент с экрана, но не из
       порядка обхода, и Tab уводил фокус в никуда — рамки не видно нигде.
       Зона .int-drop сама фокусируемая и сама открывает выбор файла. */
    const input = el('input', {
      type: 'file', id, class: 'visually-hidden', tabindex: '-1',
      // Без видимой подписи имя полю даёт та же фраза, что стоит в зоне
      ...(labelKey ? {} : { 'data-i18n-attr': 'aria-label:int.prep.csv.drop' }),
    });
    const zone = el('div', { class: 'int-drop', role: 'button', tabindex: '0' }, [
      icon(ICON.upload, { cls: 'int-ico' }),
      el('span', { 'data-i18n': 'int.prep.csv.drop' }),
    ]);
    const picked = el('p', { class: 'int-field__hint', hidden: '' });

    // Имя держится переменной, а не второй записью в refreshers: иначе после
    // третьего выбора файла на экране осталось бы имя первого
    let pickedName = '';
    refresh(picked, () => {
      picked.hidden = pickedName === '';
      picked.textContent = pickedName === '' ? '' : t('int.prep.csv.picked', { name: pickedName });
    });
    const show = (name) => {
      pickedName = name;
      picked.hidden = false;
      picked.textContent = t('int.prep.csv.picked', { name });
    };

    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (file) show(file.name);
    });
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      input.click();
    });
    zone.addEventListener('dragover', (event) => {
      event.preventDefault();
      zone.classList.add('is-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      zone.classList.remove('is-over');
      const file = event.dataTransfer?.files?.[0];
      if (file) show(file.name);
    });

    const wrap = el('div', { class: 'int-field' });
    if (labelKey) {
      wrap.appendChild(el('label', { class: 'int-field__label', for: id }, [
        el('span', { 'data-i18n': labelKey }),
      ]));
    }
    wrap.append(zone, input, hint('int.prep.csv.dropHint'), picked);
    return wrap;
  }

  /* Шаблон CSV: собирается в памяти и отдаётся Blob-ссылкой. Если браузер
     (или песочница просмотрщика) загрузку не пустит, содержимое остаётся на
     экране в <pre> — скопировать руками всегда можно. */
  function templateButton() {
    const preview = el('pre', { class: 'int-template', hidden: '', text: CSV_TEMPLATE });
    /* Подпись — во вложенном span: applyTranslations пишет в textContent, и
       data-i18n прямо на кнопке стёр бы иконку при первой же смене языка. */
    const button = el('button', { type: 'button', class: 'btn btn--ghost' }, [
      icon(ICON.download), el('span', { 'data-i18n': 'int.prep.csv.template' }),
    ]);

    /* Показ содержимого — отдельная кнопка, а не довесок к загрузке. Успешную
       загрузку страница увидеть не может: заблокированный песочницей клик
       ничем не отличается от сработавшего, и «показывать <pre> всегда» значило
       бы оставлять на дашборде кусок текста, который нечем убрать. */
    const toggleLabel = el('span', { 'data-i18n': 'int.prep.csv.templateShow' });
    const toggle = el('button', {
      type: 'button', class: 'btn btn--ghost int-template-toggle', 'aria-expanded': 'false',
    }, [toggleLabel]);

    function syncToggle() {
      toggle.setAttribute('aria-expanded', String(!preview.hidden));
      toggleLabel.setAttribute('data-i18n',
        preview.hidden ? 'int.prep.csv.templateShow' : 'int.prep.csv.templateHide');
      toggleLabel.textContent = t(preview.hidden ? 'int.prep.csv.templateShow' : 'int.prep.csv.templateHide');
    }
    toggle.addEventListener('click', () => { preview.hidden = !preview.hidden; syncToggle(); });
    refresh(toggle, syncToggle);

    button.addEventListener('click', () => {
      try {
        if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
          throw new Error('blob download unavailable');
        }
        const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' }));
        const link = el('a', { href: url, download: 'prep-stock-template.csv' });
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch {
        // Загрузку собрать не из чего — показываем содержимое сразу,
        // скопировать руками можно всегда
        preview.hidden = false;
        syncToggle();
      }
    });

    return el('div', { class: 'int-template-wrap' }, [
      el('div', { class: 'int-template-actions' }, [button, toggle]), preview,
    ]);
  }

  /* --- Группа 1: Amazon SP-API ------------------------------------------- */

  function metaItem(labelKey, valueNode) {
    return el('div', { class: 'int-meta' }, [
      el('dt', { 'data-i18n': labelKey }),
      el('dd', {}, [valueNode]),
    ]);
  }

  function buildSpapi() {
    const section = el('section', { class: 'int-group', 'aria-labelledby': 'int-h-spapi' });
    section.appendChild(groupHead('int-h-spapi', 'int.spapi.title', 'int.spapi.lead'));

    const stateTitle = el('span', { class: 'int-state__title' });
    const stateWhy = el('p', { class: 'int-state__why' });
    const regionValue = el('code', { class: 'fba-mono' });
    const envValue = el('code', { class: 'fba-mono' });
    const lastSyncValue = el('time', {});

    /* Регион и среда продублированы в плитке моноширинно: предупреждение
       внизу можно проскроллить мимо, а действующее значение должно быть
       видно там же, где состояние подключения. */
    const tile = el('div', { class: 'int-state' }, [
      el('span', { class: 'int-state__dot' }),
      el('div', { class: 'int-state__main' }, [stateTitle, stateWhy]),
      el('dl', { class: 'int-state__meta' }, [
        metaItem('int.spapi.lastSync', lastSyncValue),
        metaItem('int.spapi.regionCurrent', regionValue),
        metaItem('int.spapi.envCurrent', envValue),
      ]),
    ]);
    section.appendChild(tile);

    const app = fieldset('int.spapi.app');
    const appFields = el('div', { class: 'int-fields' }, [
      textField({
        id: 'int-spapi-clientId', labelKey: 'int.spapi.clientId', hintKey: 'int.spapi.clientIdHint',
        value: state.spapi.clientId, attrs: { 'data-store': 'spapi.clientId' },
        onInput: (value) => { state.spapi.clientId = value; syncSpapi(); },
      }).node,
      secretField({ id: 'int-spapi-clientSecret', labelKey: 'int.spapi.clientSecret' }),
      secretField({ id: 'int-spapi-refreshToken', labelKey: 'int.spapi.refreshToken' }),
      textField({
        id: 'int-spapi-sellerId', labelKey: 'int.spapi.sellerId', hintKey: 'int.spapi.sellerIdHint',
        value: state.spapi.sellerId, attrs: { 'data-store': 'spapi.sellerId' },
        onInput: (value) => { state.spapi.sellerId = value; syncSpapi(); },
      }).node,
    ]);
    app.appendChild(appFields);
    section.appendChild(app);

    section.appendChild(el('div', { class: 'int-row' }, [
      segmented({
        labelKey: 'int.spapi.region',
        options: REGIONS.map((value) => ({ value, textKey: `int.spapi.region.${value}` })),
        current: () => state.spapi.region,
        onPick: (value) => { state.spapi.region = value; syncSpapi(); },
      }),
      segmented({
        labelKey: 'int.spapi.env',
        options: ENVS.map((value) => ({ value, textKey: `int.spapi.env.${value}` })),
        current: () => state.spapi.env,
        onPick: (value) => { state.spapi.env = value; syncSpapi(); },
      }),
    ]));

    /* Ни одно предупреждение не блокирует выбор: человек вправе поставить na,
       он должен лишь знать цену. na — красное (данных не будет вовсе),
       sandbox — жёлтое (данные придут, но выдуманные). */
    const warnNa = warnBlock('int.spapi.region.warnNa', 'critical');
    const warnSandbox = warnBlock('int.spapi.env.warnSandbox', 'warning');
    section.append(warnNa, warnSandbox);

    const markets = fieldset('int.spapi.markets', 'int.spapi.marketsHint');
    const marketChecks = el('div', { class: 'int-checks' });
    for (const market of MARKETS) {
      marketChecks.appendChild(checkPlate({
        labelKey: `int.market.${market.code}`,
        mono: market.id,
        checked: state.spapi.marketplaces.includes(market.id),
        onChange: (on) => {
          const set = new Set(state.spapi.marketplaces);
          if (on) set.add(market.id); else set.delete(market.id);
          state.spapi.marketplaces = MARKETS.map((m) => m.id).filter((id) => set.has(id));
        },
      }).node);
    }
    markets.appendChild(marketChecks);
    section.appendChild(markets);

    const sources = fieldset('int.spapi.sources', 'int.spapi.sourcesHint');
    const sourceList = el('ul', { class: 'int-sources' });
    for (const source of SOURCES) {
      const item = el('li', { class: 'int-source' });
      const hintId = source.hintKey ? `int-src-${source.id}-hint` : null;
      item.appendChild(checkPlate({
        labelKey: source.labelKey,
        describedBy: hintId,
        checked: state.spapi.sources.includes(source.id),
        onChange: (on) => {
          const set = new Set(state.spapi.sources);
          if (on) set.add(source.id); else set.delete(source.id);
          state.spapi.sources = SOURCES.map((s) => s.id).filter((id) => set.has(id));
        },
      }).node);
      item.appendChild(el('code', { class: 'fba-mono', text: source.mono }));
      if (source.hintKey) item.appendChild(hint(source.hintKey, '', hintId));
      sourceList.appendChild(item);
    }
    sources.appendChild(sourceList);
    sources.appendChild(note('int.src.cancelledNote'));
    section.appendChild(sources);

    const schedule = fieldset('int.spapi.schedule');
    schedule.appendChild(el('div', { class: 'int-fields' }, [
      selectField({
        id: 'int-spapi-every', labelKey: 'int.sched.every',
        options: [
          { value: '4', textKey: 'int.sched.every4' },
          { value: '8', textKey: 'int.sched.every8' },
          { value: '12', textKey: 'int.sched.every12' },
          { value: '24', textKey: 'int.sched.every24' },
          { value: '0', textKey: 'int.sched.manual' },
        ],
        value: state.spapi.schedule.every,
        onChange: (value) => { state.spapi.schedule.every = Number(value); },
      }),
      numberField({
        id: 'int-spapi-pause', labelKey: 'int.sched.pause', unitKey: 'int.sched.pauseUnit',
        hintKey: 'int.sched.pauseHint', value: state.spapi.schedule.pauseMs,
        min: 0, max: 60000, step: 50,
        onChange: (value) => { state.spapi.schedule.pauseMs = value; },
      }).node,
      numberField({
        id: 'int-spapi-retries', labelKey: 'int.sched.retries', hintKey: 'int.sched.retriesHint',
        value: state.spapi.schedule.retries, min: 0, max: 10,
        onChange: (value) => { state.spapi.schedule.retries = value; },
      }).node,
    ]));
    schedule.appendChild(note('int.sched.rateNote'));
    section.appendChild(schedule);

    const secretsBox = el('div', { class: 'int-secrets' }, [
      el('h4', { class: 'int-secrets__title', 'data-i18n': 'int.secrets.title' }),
      el('p', { class: 'int-group__lead', 'data-i18n': 'int.secrets.lead' }),
    ]);
    /* Статус выводится из журнала, а не зашит: прогон, который принёс данные,
       без этих переменных не состоялся бы; журнала нет — значит сборщик ни
       разу не запускался; прогон упал — сказать про переменные нечего. */
    function secretsState() {
      if (!syncState.loaded) return 'unknown';
      if (!syncState.entry) return 'unset';
      if (syncState.entry.status === 'error') return 'unknown';
      return 'set';
    }

    const secretsList = el('ul', { class: 'int-secrets__list' });
    for (const name of ACTIONS_SECRETS) {
      const pill = el('span', { class: 'int-pill' });
      refresh(pill, () => {
        const value = secretsState();
        pill.dataset.state = value;
        pill.textContent = t(`int.secrets.${value}`);
      });
      secretsList.appendChild(el('li', { class: 'int-secret' }, [
        el('code', { class: 'fba-mono', text: name }), pill,
      ]));
    }
    secretsBox.appendChild(secretsList);
    secretsBox.appendChild(el('p', { class: 'int-path' }, [
      el('span', { 'data-i18n': 'int.secrets.path' }),
      el('code', { class: 'fba-mono', text: ACTIONS_PATH }),
    ]));
    secretsBox.appendChild(hint('int.secrets.demoNote'));
    section.appendChild(secretsBox);

    /* Проверка связи. Реального запроса нет и быть не может: страница
       статическая, секретов у неё нет. Поэтому кнопка не изображает успех —
       она сверяет заполненность полей и говорит об этом прямо. */
    let testing = false;
    const testLabel = el('span');
    const testButton = el('button', { type: 'button', class: 'btn btn--ghost int-test' }, [testLabel]);
    const result = el('div', { class: 'int-result', role: 'status', hidden: '' });

    function renderTest() {
      testLabel.textContent = t(testing ? 'int.test.running' : 'int.test.button');
      if (!lastTest) { result.hidden = true; result.replaceChildren(); return; }
      result.hidden = false;
      result.replaceChildren(
        el('span', { class: 'int-badge', text: t('int.demoBadge') }),
        el('p', { class: 'int-result__title', text: t('int.test.title') }),
        el('p', { text: t('int.test.demo') }),
        el('p', { text: t('int.test.fieldsOk', { n: lastTest.filled, total: lastTest.total }) }),
      );
      if (lastTest.missing.length) {
        result.appendChild(el('p', {
          text: t('int.test.missing', { list: lastTest.missing.map((key) => t(key)).join(', ') }),
        }));
      } else {
        result.appendChild(el('p', { text: t('int.test.ready') }));
      }
    }

    testButton.addEventListener('click', () => {
      if (testing) return;
      testing = true;
      testButton.disabled = true;
      testButton.setAttribute('aria-busy', 'true');
      renderTest();

      // Полсекунды — чтобы результат читался как ответ, а не как мигание
      setTimeout(() => {
        const checks = [
          { key: 'int.spapi.clientId', filled: () => state.spapi.clientId.trim() !== '' },
          { key: 'int.spapi.clientSecret', filled: () => secretValue('int-spapi-clientSecret') !== '' },
          { key: 'int.spapi.refreshToken', filled: () => secretValue('int-spapi-refreshToken') !== '' },
          { key: 'int.spapi.sellerId', filled: () => state.spapi.sellerId.trim() !== '' },
          { key: 'int.spapi.region', filled: () => REGIONS.includes(state.spapi.region) },
          { key: 'int.spapi.env', filled: () => ENVS.includes(state.spapi.env) },
          { key: 'int.spapi.markets', filled: () => state.spapi.marketplaces.length > 0 },
          { key: 'int.spapi.sources', filled: () => state.spapi.sources.length > 0 },
        ];
        const missing = checks.filter((check) => !check.filled()).map((check) => check.key);
        lastTest = { total: checks.length, filled: checks.length - missing.length, missing };
        testing = false;
        testButton.disabled = false;
        testButton.removeAttribute('aria-busy');
        renderTest();
      }, 500);
    });

    refresh(testButton, renderTest);
    section.appendChild(el('div', { class: 'int-actions' }, [testButton, result]));

    function syncSpapi() {
      /* «Подключено» говорится только про то, что действительно произошло:
         последний прогон сборщика принёс данные. Заполненные Client ID и
         Seller ID — это «настройки заполнены», а не связь: ни Client Secret,
         ни Refresh Token в браузере не живут, и подключаться ими некому. */
      const configured = state.spapi.clientId.trim() !== '' && state.spapi.sellerId.trim() !== '';
      const entry = syncState.entry;
      let value = 'absent';
      if (entry && entry.status === 'error') value = 'error';
      else if (entry) value = 'connected';
      else if (configured) value = 'filled';

      tile.dataset.state = value;
      stateTitle.textContent = t(`int.spapi.state.${value}`);
      stateWhy.textContent = t(`int.spapi.state.${value}Why`);
      stateWhy.hidden = false;

      if (entry?.finishedAt) {
        lastSyncValue.setAttribute('datetime', entry.finishedAt);
        lastSyncValue.textContent = formatDateTime(entry.finishedAt);
      } else {
        lastSyncValue.removeAttribute('datetime');
        lastSyncValue.textContent = t('int.spapi.lastSyncNever');
      }

      regionValue.textContent = state.spapi.region;
      envValue.textContent = state.spapi.env;
      warnNa.hidden = state.spapi.region !== 'na';
      warnSandbox.hidden = state.spapi.env !== 'sandbox';
    }

    refresh(tile, syncSpapi);
    return section;
  }

  /* --- Группа 2: преп-центры --------------------------------------------- */

  function restChannel(prep, idBase) {
    return el('div', { class: 'int-channel', 'data-channel': 'rest' }, [
      el('div', { class: 'int-fields' }, [
        textField({
          id: `${idBase}-restUrl`, labelKey: 'int.prep.rest.baseUrl', type: 'url',
          hintKey: 'int.url.keyHint',
          value: prep.rest.baseUrl, errKey: 'int.err.url', validate: isUrl,
          attrs: { 'data-store': 'rest.baseUrl' },
          onInput: (value) => { prep.rest.baseUrl = value; },
        }).node,
        textField({
          id: `${idBase}-restVersion`, labelKey: 'int.prep.rest.version', value: prep.rest.version,
          attrs: { 'data-store': 'rest.version' },
          onInput: (value) => { prep.rest.version = value; },
        }).node,
        secretField({ id: `${idBase}-restToken`, labelKey: 'int.prep.rest.token' }),
        numberField({
          id: `${idBase}-restPoll`, labelKey: 'int.prep.rest.poll', unitKey: 'int.prep.rest.pollUnit',
          value: prep.rest.pollMinutes, min: 1, max: 10080,
          onChange: (value) => { prep.rest.pollMinutes = value; },
        }).node,
        selectField({
          id: `${idBase}-restFormat`, labelKey: 'int.prep.rest.format',
          options: ['json', 'xml', 'csv'].map((value) => ({ value, textKey: `int.prep.rest.format.${value}` })),
          value: prep.rest.format,
          onChange: (value) => { prep.rest.format = value; },
        }),
      ]),
    ]);
  }

  /* Имена колонок приходят из чужого файла — их нельзя переводить, иначе
     сверять присланную выгрузку будет не с чем. Переводится только пояснение,
     что колонка означает. */
  const CSV_COLUMNS = [
    { mono: 'SKU', key: 'int.prep.csv.colSku' },
    { mono: 'St. in Karton', key: 'int.prep.csv.colUnits' },
    { mono: 'Kartons', key: 'int.prep.csv.colBoxes' },
    { mono: 'Date', key: 'int.prep.csv.colDate' },
  ];

  const DELIMITERS = [
    { value: 'comma', raw: ',', textKey: 'int.prep.csv.delim.comma' },
    { value: 'semicolon', raw: ';', textKey: 'int.prep.csv.delim.semicolon' },
    { value: 'tab', raw: '\t', textKey: 'int.prep.csv.delim.tab' },
  ];

  function csvChannel(prep, idBase) {
    const columns = el('ul', { class: 'int-cols' });
    for (const column of CSV_COLUMNS) {
      columns.appendChild(el('li', {}, [
        el('code', { class: 'fba-mono', text: column.mono }),
        el('span', { 'data-i18n': column.key }),
      ]));
    }

    const columnsBox = fieldset('int.prep.csv.columns');
    columnsBox.append(columns, hint('int.prep.csv.columnsHint'));

    const current = DELIMITERS.find((item) => item.raw === prep.csv.delimiter) || DELIMITERS[1];

    return el('div', { class: 'int-channel', 'data-channel': 'csv' }, [
      columnsBox,
      el('div', { class: 'int-fields' }, [
        selectField({
          id: `${idBase}-csvDelim`, labelKey: 'int.prep.csv.delimiter',
          options: DELIMITERS.map(({ value, textKey }) => ({ value, textKey })),
          value: current.value,
          onChange: (value) => {
            // В хранилище лежит сам символ, а в списке — его имя: табуляцию
            // в атрибуте option не разглядеть ни глазом, ни отладчиком
            prep.csv.delimiter = (DELIMITERS.find((item) => item.value === value) || current).raw;
          },
        }),
        selectField({
          id: `${idBase}-csvEnc`, labelKey: 'int.prep.csv.encoding',
          options: [
            { value: 'utf-8', textKey: 'int.prep.csv.enc.utf8' },
            { value: 'windows-1252', textKey: 'int.prep.csv.enc.cp1252' },
          ],
          value: prep.csv.encoding,
          onChange: (value) => { prep.csv.encoding = value; },
        }),
      ]),
      templateButton(),
      dropZone({ id: `${idBase}-csvFile` }),
    ]);
  }

  function mailChannel(prep, idBase) {
    return el('div', { class: 'int-channel', 'data-channel': 'mail' }, [
      el('div', { class: 'int-fields' }, [
        textField({
          id: `${idBase}-mailAddress`, labelKey: 'int.prep.mail.address', type: 'email',
          value: prep.mail.address, errKey: 'int.err.email', validate: isEmail,
          attrs: { 'data-store': 'mail.address' },
          onInput: (value) => { prep.mail.address = value; },
        }).node,
        textField({
          id: `${idBase}-mailSenders`, labelKey: 'int.prep.mail.senders',
          hintKey: 'int.prep.mail.sendersHint', value: prep.mail.senders.join(', '),
          attrs: { 'data-store': 'mail.senders' },
          onInput: (value) => {
            prep.mail.senders = value.split(',').map((item) => item.trim()).filter(Boolean);
          },
        }).node,
        textField({
          id: `${idBase}-mailSubject`, labelKey: 'int.prep.mail.subject', value: prep.mail.subject,
          attrs: { 'data-store': 'mail.subject' },
          onInput: (value) => { prep.mail.subject = value; },
        }).node,
        textField({
          id: `${idBase}-mailAttachment`, labelKey: 'int.prep.mail.attachment',
          value: prep.mail.attachment, attrs: { 'data-store': 'mail.attachment' },
          onInput: (value) => { prep.mail.attachment = value; },
        }).node,
        textField({
          id: `${idBase}-mailHost`, labelKey: 'int.prep.mail.host', value: prep.mail.imapHost,
          attrs: { 'data-store': 'mail.imapHost' },
          onInput: (value) => { prep.mail.imapHost = value; },
        }).node,
        numberField({
          id: `${idBase}-mailPort`, labelKey: 'int.prep.mail.port', value: prep.mail.imapPort,
          min: 1, max: 65535, errKey: 'int.err.port', validate: isPort,
          onChange: (value) => { prep.mail.imapPort = value; },
        }).node,
        secretField({ id: `${idBase}-mailPassword`, labelKey: 'int.prep.mail.password' }),
      ]),
    ]);
  }

  function prepCard(prep) {
    const idBase = `int-prep-${prep.id}`;
    const card = el('section', {
      class: 'int-prep', role: 'group', 'data-id': prep.id,
      'aria-labelledby': `${idBase}-h`,
    });

    const title = el('h4', { class: 'int-prep__title', id: `${idBase}-h` });
    const pill = el('span', { class: 'int-pill' });
    const removeButton = el('button', {
      type: 'button', class: 'btn btn--icon int-prep__remove',
    }, [icon(ICON.x, { width: '1.8' })]);
    card.appendChild(el('header', { class: 'int-prep__head' }, [title, pill, removeButton]));

    const fields = el('div', { class: 'int-fields' });
    fields.appendChild(textField({
      id: `${idBase}-name`, labelKey: 'int.prep.name', placeholderKey: 'int.prep.namePlaceholder',
      value: prep.name, attrs: { 'data-store': 'name' },
      onInput: (value) => {
        prep.name = value;
        /* Канон назначается по ПЕРВОМУ непустому названию и дальше не
           меняется. Переименование склада не должно осиротить уже сделанный
           выбор «участвует в расчёте»: он записан под этим идентификатором.
           `canonicalPrepId` заодно узнаёт уже известный склад — «WM FOB»
           даёт WM_EICHENZELL, а не новый идентификатор. */
        if (!prep.canon && value.trim()) prep.canon = canonicalPrepId(value);
        syncCard();
      },
    }).node);

    fields.appendChild(segmented({
      labelKey: 'int.prep.market',
      // DE и UK — идентификаторы рынков, а не слова: не переводятся
      options: MARKET_CODES.map((value) => ({ value, text: value })),
      current: () => prep.market,
      onPick: (value) => {
        const from = prep.market;
        prep.market = value;
        // Список выбранных складов хранится по рынкам: без переноса склад
        // остался бы включённым на прежнем рынке навсегда.
        if (prep.canon) movePrepCenter(prep.canon, from, value);
        syncCard();
      },
    }));

    /* Нативный чекбокс с role="switch": клавиатура и скринридер достаются
       бесплатно, div-имитации пришлось бы обучать обоим. */
    const switchId = `${idBase}-active`;
    const switchInput = el('input', {
      type: 'checkbox', role: 'switch', class: 'int-switch', id: switchId,
      'aria-describedby': `${idBase}-excluded`,
    });
    switchInput.checked = prepActive(prep);
    switchInput.addEventListener('change', () => {
      /* Единственная запись признака — и отсюда, и из фильтра «Логистики».
         Второй копии состояния нет, поэтому и расходиться нечему. */
      togglePrepCenter(prep.market, prep.canon, switchInput.checked);
      syncCard();
    });
    fields.appendChild(el('div', { class: 'int-field int-field--switch' }, [
      el('label', { class: 'int-field__label', for: switchId }, [
        el('span', { 'data-i18n': 'int.prep.active' }),
      ]),
      switchInput,
    ]));

    fields.appendChild(numberField({
      id: `${idBase}-lag`, labelKey: 'int.prep.lag', unitKey: 'int.prep.lagUnit',
      hintKey: 'int.prep.lagHint', value: prep.lagDays, min: 0, max: 365,
      onChange: (value) => { prep.lagDays = value; },
    }).node);
    card.appendChild(fields);

    const excluded = el('p', { class: 'int-field__hint', id: `${idBase}-excluded` }, [
      el('span', { 'data-i18n': 'int.prep.excludedHint' }),
    ]);
    card.appendChild(excluded);

    /* Идентификатор расчёта показывается прямо на карточке: под этим именем
       склад виден в параметрах, во флагах и в разделе «Логистика». Пока
       названия нет — нет и идентификатора, и об этом надо сказать, а не
       делать вид, что склад участвует. */
    const canonLine = el('p', { class: 'int-field__hint int-prep__canon' }, [
      el('span', { 'data-i18n': 'int.prep.canon' }),
      el('code', { class: 'fba-mono' }),
    ]);
    const canonPending = el('p', { class: 'int-field__hint' }, [
      el('span', { 'data-i18n': 'int.prep.canonPending' }),
    ]);
    card.append(canonLine, canonPending);

    card.appendChild(aliasList({
      id: `${idBase}-alias`, legendKey: 'int.prep.aliases', hintKey: 'int.prep.aliasesHint',
      getList: () => prep.aliases,
      onChange: (items) => { prep.aliases = items; },
    }));

    card.appendChild(segmented({
      labelKey: 'int.prep.channel',
      options: CHANNELS.map((value) => ({ value, textKey: `int.prep.channel.${value}` })),
      current: () => prep.channel,
      onPick: (value) => { prep.channel = value; syncChannels(); },
    }));

    const panels = [restChannel(prep, idBase), csvChannel(prep, idBase), mailChannel(prep, idBase)];
    panels.forEach((panel) => card.appendChild(panel));
    card.appendChild(hint('int.prep.demoCollect', 'int-why'));

    /* Скрытая панель именно hidden, а не класс с display:none: скрытое
       поддерево целиком выпадает из обхода клавиатурой и из дерева
       доступности — без ручного tabindex="-1" на каждом поле.
       Значения неактивного канала при этом сохраняются: заполнил REST,
       ушёл на почту, вернулся — URL на месте. */
    function syncChannels() {
      panels.forEach((panel) => { panel.hidden = panel.dataset.channel !== prep.channel; });
    }

    function syncCard() {
      const name = prep.name.trim() || t('int.prep.namePlaceholder');
      const active = prepActive(prep);
      title.textContent = name;
      card.dataset.active = String(active);
      card.dataset.canon = prep.canon || '';
      pill.dataset.state = active ? 'set' : 'unset';
      pill.textContent = t(active ? 'int.prep.activeOn' : 'int.prep.activeOff');
      // Без имени скринридер объявил бы просто «Удалить преп-центр»
      removeButton.setAttribute('aria-label', t('int.prep.removeAria', { name }));
      excluded.hidden = active;
      // Тумблер синхронизируется и при правке с другой страницы: состояние
      // одно на всех, и карточка обязана показывать текущее, а не своё.
      if (switchInput.checked !== active) switchInput.checked = active;
      switchInput.disabled = !prep.canon;
      canonLine.hidden = !prep.canon;
      canonPending.hidden = Boolean(prep.canon);
      canonLine.querySelector('code').textContent = prep.canon || '';
      syncChannels();
    }

    removeButton.addEventListener('click', () => {
      const name = prep.name.trim() || t('int.prep.namePlaceholder');
      const index = state.preps.indexOf(prep);
      if (index >= 0) state.preps.splice(index, 1);
      // Удалённый склад выходит и из расчёта: иначе он остался бы выбранным
      // в параметрах — складом, которого больше нет ни в одном списке.
      if (prep.canon) togglePrepCenter(prep.market, prep.canon, false);
      card.remove();
      dropDetachedSecrets();
      save();
      // Второго модального подтверждения нет: окно настроек уже модальное,
      // а ошибочное удаление чинится кнопкой «Сбросить к базовым»
      announce('int.prep.removed', { name });
      prepAddButton?.focus();
    });

    refresh(card, syncCard);
    return card;
  }

  let prepAddButton = null;

  function buildPreps() {
    const section = el('section', { class: 'int-group', 'aria-labelledby': 'int-h-prep' });
    section.appendChild(groupHead('int-h-prep', 'int.prep.title', 'int.prep.lead'));
    section.appendChild(note('int.prep.whyManual'));

    const cards = el('div', { class: 'int-preps' });
    state.preps.forEach((prep) => cards.appendChild(prepCard(prep)));
    section.appendChild(cards);

    prepAddButton = el('button', { type: 'button', class: 'btn btn--ghost int-prep-add' }, [
      icon(ICON.plus), el('span', { 'data-i18n': 'int.prep.add' }),
    ]);
    prepAddButton.addEventListener('click', () => {
      const prep = prepDefaults({ id: `prep-${Date.now().toString(36)}-${state.preps.length}` });
      state.preps.push(prep);
      const card = prepCard(prep);
      cards.appendChild(card);
      applyTranslations(card);
      save();
      announce('int.prep.added');
      card.querySelector('input')?.focus();
      card.scrollIntoView?.({ block: 'nearest' });
    });
    section.appendChild(prepAddButton);
    return section;
  }

  /* --- Группа 3: контейнеры и форвардер ---------------------------------- */

  function buildContainers() {
    const cont = state.containers;
    const section = el('section', { class: 'int-group', 'aria-labelledby': 'int-h-cont' });
    section.appendChild(groupHead('int-h-cont', 'int.cont.title', 'int.cont.lead'));

    const sourceBox = fieldset('int.cont.source');
    sourceBox.appendChild(segmented({
      labelKey: 'int.cont.source',
      options: CONTAINER_SOURCES.map((value) => ({ value, textKey: `int.cont.source.${value}` })),
      current: () => cont.source,
      onPick: (value) => { cont.source = value; syncSource(); },
    }));

    const filePanel = el('div', { class: 'int-channel', 'data-source': 'file' }, [
      dropZone({ id: 'int-cont-file', labelKey: 'int.cont.file.label' }),
    ]);
    const sheetPanel = el('div', { class: 'int-channel', 'data-source': 'sheet' }, [
      textField({
        id: 'int-cont-sheetUrl', labelKey: 'int.cont.sheet.url', type: 'url',
        hintKey: ['int.cont.sheet.hint', 'int.url.keyHint'], errKey: 'int.err.url', validate: isUrl,
        value: cont.sheetUrl, attrs: { 'data-store': 'containers.sheetUrl' },
        onInput: (value) => { cont.sheetUrl = value; },
      }).node,
    ]);
    const apiPanel = el('div', { class: 'int-channel', 'data-source': 'api' }, [
      el('div', { class: 'int-fields' }, [
        textField({
          id: 'int-cont-apiUrl', labelKey: 'int.cont.api.url', type: 'url',
          hintKey: 'int.url.keyHint',
          errKey: 'int.err.url', validate: isUrl, value: cont.apiUrl,
          attrs: { 'data-store': 'containers.apiUrl' },
          onInput: (value) => { cont.apiUrl = value; },
        }).node,
        secretField({ id: 'int-cont-apiToken', labelKey: 'int.cont.api.token' }),
      ]),
    ]);
    const panels = [filePanel, sheetPanel, apiPanel];
    panels.forEach((panel) => sourceBox.appendChild(panel));
    section.appendChild(sourceBox);

    function syncSource() {
      panels.forEach((panel) => { panel.hidden = panel.dataset.source !== cont.source; });
    }
    refresh(sourceBox, syncSource);

    const rules = fieldset('int.cont.rules', 'int.cont.rulesHint');
    rules.appendChild(el('div', { class: 'int-fields' }, [
      textField({
        id: 'int-cont-field', labelKey: 'int.cont.field', hintKey: 'int.cont.fieldHint',
        value: cont.field, attrs: { 'data-store': 'containers.field' },
        onInput: (value) => { cont.field = value; },
      }).node,
      textField({
        id: 'int-cont-ukMarker', labelKey: 'int.cont.ukMarker', hintKey: 'int.cont.ukMarkerHint',
        value: cont.ukMarker, attrs: { 'data-store': 'containers.ukMarker' },
        onInput: (value) => { cont.ukMarker = value; },
      }).node,
    ]));

    rules.appendChild(aliasList({
      id: 'int-cont-prepNames', legendKey: 'int.cont.prepNames', hintKey: 'int.cont.prepNamesHint',
      getList: () => cont.prepNames,
      onChange: (items) => { cont.prepNames = items; },
    }));

    const skip = checkPlate({
      labelKey: 'int.cont.skipParents', checked: cont.skipParents,
      describedBy: 'int-cont-skipParents-hint',
      onChange: (on) => { cont.skipParents = on; },
    });
    rules.append(skip.node, hint('int.cont.skipParentsHint', '', 'int-cont-skipParents-hint'));

    const arrived = checkPlate({
      labelKey: 'int.cont.arrivedInStock', checked: cont.arrivedInStock,
      describedBy: 'int-cont-arrived-hint',
      onChange: (on) => { cont.arrivedInStock = on; },
    });
    rules.append(arrived.node, hint('int.cont.arrivedInStockHint', '', 'int-cont-arrived-hint'));
    rules.appendChild(note('int.cont.rulesDemo'));
    rules.appendChild(note('int.cont.shipmentIdHint'));
    section.appendChild(rules);

    const dating = fieldset('int.cont.dating');
    dating.appendChild(el('div', { class: 'int-fields' }, [
      numberField({
        id: 'int-cont-ready', labelKey: 'int.cont.dating.ready', unitKey: 'int.cont.dating.monthsUnit',
        value: cont.readyMonths, min: 0, max: 24, step: 0.5, integer: false,
        onChange: (value) => { cont.readyMonths = value; },
      }).node,
      numberField({
        id: 'int-cont-produce', labelKey: 'int.cont.dating.produce', unitKey: 'int.cont.dating.monthsUnit',
        value: cont.produceMonths, min: 0, max: 24, step: 0.5, integer: false,
        onChange: (value) => { cont.produceMonths = value; },
      }).node,
      numberField({
        id: 'int-cont-arrived', labelKey: 'int.cont.dating.arrived', unitKey: 'int.cont.dating.daysUnit',
        value: cont.arrivedDays, min: 0, max: 365,
        onChange: (value) => { cont.arrivedDays = value; },
      }).node,
    ]));
    dating.appendChild(hint('int.cont.datingHint'));
    section.appendChild(dating);

    return section;
  }

  /* --- Подвал ------------------------------------------------------------ */

  function buildFooter() {
    const reset = el('button', { type: 'button', class: 'btn btn--ghost int-reset' }, [
      el('span', { 'data-i18n': 'int.reset' }),
    ]);
    reset.addEventListener('click', () => {
      state = defaults();
      lastTest = null;
      render();
      commit();                      // сброс пишется сразу, без дребезга
      announce('int.resetDone');
      node.querySelector('.int-reset')?.focus();
    });

    return el('footer', { class: 'int-storage' }, [
      el('h4', { class: 'int-secrets__title', 'data-i18n': 'int.storage.title' }),
      el('p', { class: 'int-storage__yes' }, [
        icon(ICON.check, { cls: 'int-ico' }),
        el('span', { 'data-i18n': 'int.storage.saved' }),
      ]),
      el('p', { class: 'int-storage__no' }, [
        icon(ICON.lock, { cls: 'int-ico' }),
        el('span', { 'data-i18n': 'int.storage.notSaved' }),
      ]),
      hint('int.storage.why'),
      el('p', { class: 'int-field__hint' }, [
        el('span', { 'data-i18n': 'int.storage.key' }),
        el('code', { class: 'fba-mono', text: STORAGE_KEY }),
      ]),
      status,
      reset,
    ]);
  }

  /* --- сборка и перевод -------------------------------------------------- */

  function render() {
    refreshers.length = 0;
    secrets.clear();
    node.replaceChildren(
      el('p', { class: 'int-lead', 'data-i18n': 'int.lead' }),
      buildSpapi(),
      buildPreps(),
      buildContainers(),
      buildFooter(),
      live,
    );
    applyTranslations(node);
    runRefreshers();
  }

  /* Подписи внутри окна настроек собраны в JS и сами не обновятся: на смене
     языка settings.js зовёт sync(). Статические подписи переводит
     applyTranslations по атрибутам, значения — refreshers. */
  function sync() {
    applyTranslations(node);
    runRefreshers();
    live.textContent = '';   // старое сообщение на новом языке уже не к месту
    status.textContent = '';
    status.hidden = true;
  }

  render();

  /* Журнал читается один раз при сборке окна и обновляет уже собранную
     плитку: держать окно пустым до ответа файла незачем — все остальные
     настройки к нему не относятся. */
  loadSyncLog()
    .then(({ entries }) => {
      syncState.entry = latestBySource(entries).find((item) => item.source === 'amazon-spapi') || null;
    })
    .catch(() => { syncState.entry = null; })
    .finally(() => { syncState.loaded = true; runRefreshers(); });

  /* Признак «участвует в расчёте» лежит в параметрах расчёта, и менять его
     умеет не только это окно: те же склады показывает фильтр «Логистики».
     Подписка держит тумблеры в актуальном виде — без неё правка на странице
     была бы видна здесь только после перезагрузки. Обратно в параметры
     `runRefreshers` ничего не пишет, так что круга не возникает.

     Отписки нет намеренно: панель живёт ровно столько же, сколько окно
     настроек, а окно собирается один раз на страницу. */
  onParamsChange(() => runRefreshers());

  /* Закрытие окна стирает все секреты. Событие close не всплывает, но фаза
     перехвата на документе его ловит; окно может позвать clearSecrets() и
     само — оба пути ведут к одному. */
  document.addEventListener('close', (event) => {
    if (typeof event.target?.contains === 'function' && event.target.contains(node)) clearSecrets();
  }, true);

  return { node, sync, clearSecrets, flush: commit };
}
