/* ==========================================================================
   Вход по логину и паролю.

   ЧЕСТНО О ГРАНИЦАХ ЭТОЙ ЗАЩИТЫ
   Сайт статический и лежит на GitHub Pages: весь код страницы доступен любому
   посетителю. Значит эта проверка — гейт от случайных людей, а не защита от
   целенаправленного взлома. Тот, кто откроет исходники, увидит и алгоритм, и
   хэш; тот, кто наберёт адрес dashboard.html напрямую, упрётся только в
   редирект, который сам же может отключить.
   Отсюда правило: НИКАКИХ реальных секретов в этом репозитории — ни ключей
   Amazon, ни персональных данных покупателей. Только те цифры, публикация
   которых допустима.
   Настоящая авторизация появится при переезде на хостинг с сервером
   (Cloudflare Access, Vercel, собственный бэкенд) — тогда меняется только
   этот файл, остальной дашборд остаётся как есть.

   Что здесь всё же сделано правильно:
   • пароль не лежит в коде — только результат PBKDF2-SHA256, 150 000 итераций;
   • сравнение хэшей идёт за постоянное время, без ранних выходов;
   • после серии неудач включается пауза, чтобы подбор в лоб был медленным.
   ========================================================================== */

export const AUTH_CONFIG = {
  /* Соль привязывает хэши к этому сайту: одинаковый пароль на другом
     проекте даст другой хэш, и общие радужные таблицы бесполезны. */
  salt: 'oleh-hoff.github.io/dashboard/v1',
  iterations: 150_000,
  keyLengthBits: 256,

  /* Учётные записи. Пароли здесь не хранятся — только их производные.
     Новый хэш считается страницей tools/password.html.

     Стартовые данные: логин «oleh», пароль «AmazonDash-2026».
     СМЕНИТЕ ПАРОЛЬ — он опубликован в истории репозитория и в переписке. */
  users: [
    { login: 'oleh', hash: '7c38b9bd3f261b6f44c8c7c252c166af305fd8acc2a554d73c3c110fb3d2ca00' },
  ],

  sessionHours: 12,   // обычный вход — до закрытия вкладки, но не дольше
  rememberDays: 7,    // с галочкой «запомнить меня»
  maxAttempts: 5,     // после этого — пауза
  lockoutSeconds: 60,
};

const SESSION_KEY = 'dashboard.session';
const ATTEMPTS_KEY = 'dashboard.attempts';

/* --------------------------------------------------------------------------
   Хэширование
   -------------------------------------------------------------------------- */

/** Есть ли в браузере WebCrypto. На http:// и в старых браузерах его нет. */
export function isCryptoAvailable() {
  return Boolean(globalThis.crypto?.subtle);
}

/**
 * PBKDF2-SHA256 → hex-строка.
 * Растяжение ключа делает перебор по словарю дорогим: каждая проверка
 * пароля стоит атакующему столько же, сколько нам — одну.
 */
export async function deriveHash(password) {
  const enc = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode(AUTH_CONFIG.salt),
      iterations: AUTH_CONFIG.iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    AUTH_CONFIG.keyLengthBits,
  );

  return [...new Uint8Array(bits)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Сравнение за постоянное время.
 * Обычное === выходит на первом различии, и по времени ответа можно
 * восстанавливать хэш посимвольно. Здесь проходим строку целиком всегда.
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/* --------------------------------------------------------------------------
   Ограничение частоты попыток
   -------------------------------------------------------------------------- */

function readAttempts() {
  try {
    return JSON.parse(localStorage.getItem(ATTEMPTS_KEY)) || { count: 0, until: 0 };
  } catch {
    return { count: 0, until: 0 };
  }
}

function writeAttempts(state) {
  try { localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(state)); } catch { /* */ }
}

/** Сколько секунд осталось ждать. 0 — можно пробовать. */
export function lockoutRemaining() {
  const { until } = readAttempts();
  const left = Math.ceil((until - Date.now()) / 1000);
  return left > 0 ? left : 0;
}

function registerFailure() {
  const state = readAttempts();
  state.count += 1;
  if (state.count >= AUTH_CONFIG.maxAttempts) {
    state.until = Date.now() + AUTH_CONFIG.lockoutSeconds * 1000;
    state.count = 0;
  }
  writeAttempts(state);
}

function clearFailures() {
  writeAttempts({ count: 0, until: 0 });
}

/* --------------------------------------------------------------------------
   Проверка учётных данных
   -------------------------------------------------------------------------- */

/**
 * @returns {Promise<{ok: true} | {ok: false, reason: 'invalid'|'locked'|'nocrypto', sec?: number}>}
 */
export async function signIn(login, password, remember = false) {
  if (!isCryptoAvailable()) return { ok: false, reason: 'nocrypto' };

  const wait = lockoutRemaining();
  if (wait > 0) return { ok: false, reason: 'locked', sec: wait };

  const candidate = String(login).trim().toLowerCase();
  const user = AUTH_CONFIG.users.find((u) => u.login.toLowerCase() === candidate);

  /* Хэш считаем всегда, даже когда логина нет: иначе несуществующий логин
     отвечает мгновенно, а существующий — с задержкой, и по этому зазору
     перебираются имена пользователей. */
  const hash = await deriveHash(password);
  const expected = user?.hash ?? '0'.repeat(AUTH_CONFIG.keyLengthBits / 4);

  if (!user || !timingSafeEqual(hash, expected)) {
    registerFailure();
    return { ok: false, reason: 'invalid' };
  }

  clearFailures();
  createSession(user.login, remember);
  return { ok: true };
}

/* --------------------------------------------------------------------------
   Сессия
   -------------------------------------------------------------------------- */

function createSession(login, remember) {
  const ttlMs = remember
    ? AUTH_CONFIG.rememberDays * 24 * 60 * 60 * 1000
    : AUTH_CONFIG.sessionHours * 60 * 60 * 1000;

  const payload = JSON.stringify({ login, exp: Date.now() + ttlMs });

  try {
    // «Запомнить» переживает закрытие браузера, обычный вход — нет
    (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, payload);
  } catch { /* приватный режим: сессия проживёт до перезагрузки страницы */ }
}

/** @returns {{login: string} | null} */
export function getSession() {
  for (const store of [sessionStorage, localStorage]) {
    try {
      const raw = store.getItem(SESSION_KEY);
      if (!raw) continue;
      const data = JSON.parse(raw);
      if (data?.exp > Date.now() && data.login) return { login: data.login };
      store.removeItem(SESSION_KEY);   // просрочена — убираем
    } catch { /* повреждённое значение игнорируем */ }
  }
  return null;
}

export function signOut() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* */ }
  try { localStorage.removeItem(SESSION_KEY); } catch { /* */ }
}

/**
 * Охрана закрытой страницы. Вызывается первой строкой дашборда.
 * @returns {{login: string} | null} сессия, если вход есть
 */
export function requireAuth(loginUrl = 'index.html') {
  const session = getSession();
  if (!session) {
    location.replace(loginUrl);
    return null;
  }
  return session;
}

/** Обратное: со страницы входа сразу уводим внутрь, если сессия жива. */
export function redirectIfAuthed(dashboardUrl = 'dashboard.html') {
  if (getSession()) {
    location.replace(dashboardUrl);
    return true;
  }
  return false;
}
