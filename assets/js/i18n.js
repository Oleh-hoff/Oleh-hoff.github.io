/* ==========================================================================
   Локализация: русский, английский, украинский.

   Разметка помечается атрибутами, а не переводится в коде:
     data-i18n="key"            → textContent
     data-i18n-attr="attr:key"  → произвольный атрибут (title, aria-label…)
   Так один и тот же HTML обслуживает все три языка без дублирования.
   ========================================================================== */

export const LANGS = ['ru', 'en', 'uk'];

/** Соответствие языка интерфейса локали Intl (числа, даты, валюта). */
export const LOCALES = { ru: 'ru-RU', en: 'en-US', uk: 'uk-UA' };

const STORAGE_KEY = 'dashboard.lang';

const DICT = {
  /* ------------------------------------------------------------------ RU */
  ru: {
    'app.name': 'Amazon Дашборд',
    'app.tagline': 'Продажи, заказы и аналитика Amazon',

    'auth.title': 'Вход в дашборд',
    'auth.subtitle': 'Введите логин и пароль, чтобы открыть аналитику',
    'auth.login': 'Логин',
    'auth.loginPlaceholder': 'ваш логин',
    'auth.password': 'Пароль',
    'auth.passwordPlaceholder': 'ваш пароль',
    'auth.submit': 'Войти',
    'auth.submitting': 'Проверяем…',
    'auth.remember': 'Запомнить меня на 7 дней',
    'auth.showPassword': 'Показать пароль',
    'auth.hidePassword': 'Скрыть пароль',
    'auth.errorEmpty': 'Заполните логин и пароль',
    'auth.errorInvalid': 'Неверный логин или пароль',
    'auth.errorLocked': 'Слишком много попыток. Подождите {sec} с.',
    'auth.securityNote': 'Сайт размещён на GitHub Pages и виден в интернете. Эта форма отсекает случайных посетителей, но не заменяет настоящую защиту — не публикуйте здесь данные, утечка которых недопустима.',

    'theme.toggle': 'Переключить тему',
    'theme.light': 'Светлая',
    'theme.dark': 'Тёмная',
    'theme.system': 'Как в системе',
    'lang.select': 'Язык интерфейса',

    'nav.signedInAs': 'Вы вошли как',
    'nav.logout': 'Выйти',
    'nav.skipToContent': 'Перейти к содержимому',

    'filters.title': 'Фильтры',
    'filters.period': 'Период',
    'filters.period7': '7 дней',
    'filters.period30': '30 дней',
    'filters.period90': '90 дней',
    'filters.marketplace': 'Площадка',
    'filters.allMarketplaces': 'Все площадки',
    'filters.updated': 'Данные обновлены',
    'filters.loading': 'Обновляем…',

    'kpi.revenue': 'Выручка',
    'kpi.orders': 'Заказы',
    'kpi.units': 'Продано единиц',
    'kpi.avgOrder': 'Средний чек',
    'kpi.vsPrev': 'к прошлому периоду',
    'kpi.sparkHint': 'Динамика за период',

    'chart.revenue.title': 'Выручка по дням',
    'chart.revenue.subtitle': 'Сумма продаж по каждой площадке',
    'chart.top.title': 'Топ товаров по выручке',
    'chart.top.subtitle': 'Десять позиций с наибольшей суммой продаж',
    'chart.orders.title': 'Заказы по площадкам',
    'chart.orders.subtitle': 'Распределение заказов по неделям',

    'view.chart': 'График',
    'view.table': 'Таблица',
    'view.switchTo': 'Показать данные таблицей',

    'table.date': 'Дата',
    'table.week': 'Неделя',
    'table.marketplace': 'Площадка',
    'table.revenue': 'Выручка',
    'table.orders': 'Заказы',
    'table.units': 'Единиц',
    'table.product': 'Товар',
    'table.share': 'Доля',
    'table.total': 'Итого',
    'table.empty': 'Нет данных за выбранный период',

    'legend.total': 'Всего',
    'chart.noData': 'Нет данных для отображения',

    'footer.demoData': 'Сейчас показаны демонстрационные данные. Реальные цифры Amazon появятся после подключения выгрузки.',
    'footer.builtWith': 'Обновляется автоматически',
  },

  /* ------------------------------------------------------------------ EN */
  en: {
    'app.name': 'Amazon Dashboard',
    'app.tagline': 'Amazon sales, orders and analytics',

    'auth.title': 'Sign in to the dashboard',
    'auth.subtitle': 'Enter your username and password to open the analytics',
    'auth.login': 'Username',
    'auth.loginPlaceholder': 'your username',
    'auth.password': 'Password',
    'auth.passwordPlaceholder': 'your password',
    'auth.submit': 'Sign in',
    'auth.submitting': 'Checking…',
    'auth.remember': 'Remember me for 7 days',
    'auth.showPassword': 'Show password',
    'auth.hidePassword': 'Hide password',
    'auth.errorEmpty': 'Please fill in both fields',
    'auth.errorInvalid': 'Wrong username or password',
    'auth.errorLocked': 'Too many attempts. Wait {sec}s.',
    'auth.securityNote': 'This site is hosted on GitHub Pages and is publicly visible. The form keeps casual visitors out, but it is not real security — do not publish data here that must not leak.',

    'theme.toggle': 'Switch theme',
    'theme.light': 'Light',
    'theme.dark': 'Dark',
    'theme.system': 'System',
    'lang.select': 'Interface language',

    'nav.signedInAs': 'Signed in as',
    'nav.logout': 'Sign out',
    'nav.skipToContent': 'Skip to content',

    'filters.title': 'Filters',
    'filters.period': 'Period',
    'filters.period7': '7 days',
    'filters.period30': '30 days',
    'filters.period90': '90 days',
    'filters.marketplace': 'Marketplace',
    'filters.allMarketplaces': 'All marketplaces',
    'filters.updated': 'Data updated',
    'filters.loading': 'Updating…',

    'kpi.revenue': 'Revenue',
    'kpi.orders': 'Orders',
    'kpi.units': 'Units sold',
    'kpi.avgOrder': 'Average order',
    'kpi.vsPrev': 'vs previous period',
    'kpi.sparkHint': 'Trend over the period',

    'chart.revenue.title': 'Revenue by day',
    'chart.revenue.subtitle': 'Sales total for each marketplace',
    'chart.top.title': 'Top products by revenue',
    'chart.top.subtitle': 'Ten positions with the highest sales total',
    'chart.orders.title': 'Orders by marketplace',
    'chart.orders.subtitle': 'Weekly distribution of orders',

    'view.chart': 'Chart',
    'view.table': 'Table',
    'view.switchTo': 'Show the data as a table',

    'table.date': 'Date',
    'table.week': 'Week',
    'table.marketplace': 'Marketplace',
    'table.revenue': 'Revenue',
    'table.orders': 'Orders',
    'table.units': 'Units',
    'table.product': 'Product',
    'table.share': 'Share',
    'table.total': 'Total',
    'table.empty': 'No data for the selected period',

    'legend.total': 'Total',
    'chart.noData': 'Nothing to display',

    'footer.demoData': 'Demo data is shown for now. Real Amazon figures will appear once the export is connected.',
    'footer.builtWith': 'Updated automatically',
  },

  /* ------------------------------------------------------------------ UK */
  uk: {
    'app.name': 'Amazon Дашборд',
    'app.tagline': 'Продажі, замовлення та аналітика Amazon',

    'auth.title': 'Вхід до дашборда',
    'auth.subtitle': 'Введіть логін і пароль, щоб відкрити аналітику',
    'auth.login': 'Логін',
    'auth.loginPlaceholder': 'ваш логін',
    'auth.password': 'Пароль',
    'auth.passwordPlaceholder': 'ваш пароль',
    'auth.submit': 'Увійти',
    'auth.submitting': 'Перевіряємо…',
    'auth.remember': 'Запам’ятати мене на 7 днів',
    'auth.showPassword': 'Показати пароль',
    'auth.hidePassword': 'Сховати пароль',
    'auth.errorEmpty': 'Заповніть логін і пароль',
    'auth.errorInvalid': 'Хибний логін або пароль',
    'auth.errorLocked': 'Забагато спроб. Зачекайте {sec} с.',
    'auth.securityNote': 'Сайт розміщено на GitHub Pages і він видимий в інтернеті. Ця форма відсікає випадкових відвідувачів, але не замінює справжній захист — не публікуйте тут дані, витік яких неприпустимий.',

    'theme.toggle': 'Перемкнути тему',
    'theme.light': 'Світла',
    'theme.dark': 'Темна',
    'theme.system': 'Як у системі',
    'lang.select': 'Мова інтерфейсу',

    'nav.signedInAs': 'Ви увійшли як',
    'nav.logout': 'Вийти',
    'nav.skipToContent': 'Перейти до вмісту',

    'filters.title': 'Фільтри',
    'filters.period': 'Період',
    'filters.period7': '7 днів',
    'filters.period30': '30 днів',
    'filters.period90': '90 днів',
    'filters.marketplace': 'Майданчик',
    'filters.allMarketplaces': 'Усі майданчики',
    'filters.updated': 'Дані оновлено',
    'filters.loading': 'Оновлюємо…',

    'kpi.revenue': 'Виторг',
    'kpi.orders': 'Замовлення',
    'kpi.units': 'Продано одиниць',
    'kpi.avgOrder': 'Середній чек',
    'kpi.vsPrev': 'до попереднього періоду',
    'kpi.sparkHint': 'Динаміка за період',

    'chart.revenue.title': 'Виторг за днями',
    'chart.revenue.subtitle': 'Сума продажів на кожному майданчику',
    'chart.top.title': 'Топ товарів за виторгом',
    'chart.top.subtitle': 'Десять позицій із найбільшою сумою продажів',
    'chart.orders.title': 'Замовлення за майданчиками',
    'chart.orders.subtitle': 'Розподіл замовлень за тижнями',

    'view.chart': 'Графік',
    'view.table': 'Таблиця',
    'view.switchTo': 'Показати дані таблицею',

    'table.date': 'Дата',
    'table.week': 'Тиждень',
    'table.marketplace': 'Майданчик',
    'table.revenue': 'Виторг',
    'table.orders': 'Замовлення',
    'table.units': 'Одиниць',
    'table.product': 'Товар',
    'table.share': 'Частка',
    'table.total': 'Разом',
    'table.empty': 'Немає даних за обраний період',

    'legend.total': 'Усього',
    'chart.noData': 'Немає даних для показу',

    'footer.demoData': 'Наразі показано демонстраційні дані. Реальні цифри Amazon з’являться після під’єднання вивантаження.',
    'footer.builtWith': 'Оновлюється автоматично',
  },
};

/**
 * Догружает словарь раздела.
 * Строки CRM живут в своём файле, а не разбухают этот: движок остаётся
 * переиспользуемым, а поиск нужной фразы не превращается в пролистывание.
 */
export function extendDict(entries) {
  for (const [lang, pairs] of Object.entries(entries)) {
    if (!DICT[lang]) DICT[lang] = {};
    Object.assign(DICT[lang], pairs);
  }
}

let current = detectInitial();
const listeners = new Set();

/** Язык из сохранённого выбора, иначе из настроек браузера, иначе русский. */
function detectInitial() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LANGS.includes(saved)) return saved;
  } catch { /* приватный режим — просто идём дальше */ }

  for (const tag of navigator.languages || [navigator.language || '']) {
    const base = String(tag).slice(0, 2).toLowerCase();
    if (LANGS.includes(base)) return base;
  }
  return 'ru';
}

export function getLang() { return current; }

export function getLocale() { return LOCALES[current]; }

export function setLang(lang) {
  if (!LANGS.includes(lang) || lang === current) return;
  current = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* не критично */ }
  document.documentElement.lang = lang;
  applyTranslations();
  listeners.forEach((fn) => fn(lang));
}

/** Подписка на смену языка — дашборд перерисовывает по ней графики. */
export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Перевод по ключу. Подстановка вида {name} — из vars.
 * Неизвестный ключ возвращается как есть: пропажа видна сразу, но не ломает вёрстку.
 */
export function t(key, vars) {
  const raw = DICT[current]?.[key] ?? DICT.ru[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : m);
}

/** Связывает группу кнопок [data-lang] с текущим языком. */
export function bindLangControls(container) {
  const buttons = container.querySelectorAll('[data-lang]');

  const sync = () => buttons.forEach((btn) => {
    btn.setAttribute('aria-checked', String(btn.dataset.lang === current));
  });

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => { setLang(btn.dataset.lang); sync(); });
  });

  sync();
}

/** Проставляет переводы во всё дерево (или в переданный корень). */
export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });

  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    // формат: "placeholder:auth.loginPlaceholder, title:theme.toggle"
    el.dataset.i18nAttr.split(',').forEach((pair) => {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    });
  });

  document.documentElement.lang = current;
}
