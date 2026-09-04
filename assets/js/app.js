/* ==========================================================================
   Сборка оболочки CRM.

   Роутер на хеше, а не на History API: приложение открывается и как файл
   через локальный сервер, и с любого статического хостинга, где нет правил
   переписывания адресов. Переход между разделами не перезагружает страницу.
   ========================================================================== */

import './strings-crm.js';           // регистрирует словари CRM до первого t()
import { applyTranslations, onLangChange, t } from './i18n.js';
import { initTheme } from './theme.js';
import { mountSettings } from './settings.js';
import { onZoneChange } from './timezone.js';
import { requireAuth, signOut, getSession } from './auth.js';
import { resetFormatters } from './format.js';
import { mountNotifications } from './notifications.js';
import { accountCheck } from './views/account-check.js';
import { weeklySales } from './views/weekly-sales.js';
import { weeklyAnalysis } from './views/weekly-analysis.js';
import { wiki } from './views/wiki.js';
import { advertising } from './views/advertising.js';

/* --- Доступ ------------------------------------------------------------- */

const session = requireAuth('index.html');
if (!session) throw new Error('redirecting');

/* --- Разделы ------------------------------------------------------------ */

/** Заглушка для разделов, которые заложены в структуре, но ещё не наполнены. */
function placeholder(titleKey) {
  return {
    titleKey,
    leadKey: 'page.soon.lead',
    async mount(view, controls) {
      controls.replaceChildren();
      const card = document.createElement('div');
      card.className = 'card state';
      card.textContent = t('page.soon.lead');
      view.replaceChildren(card);
      return () => {};
    },
  };
}

const ROUTES = {
  'account-check': accountCheck,
  'weekly-sales': weeklySales,
  'weekly-analysis': weeklyAnalysis,
  advertising,
  wiki,
  products: placeholder('nav.products'),
  customers: placeholder('nav.customers'),
  orders: placeholder('nav.orders'),
  inventory: placeholder('nav.inventory'),
  promotions: placeholder('nav.promotions'),
  sources: placeholder('nav.sources'),
};

const DEFAULT_ROUTE = 'account-check';

/* --- Каркас ------------------------------------------------------------- */

initTheme();
mountSettings(document.getElementById('settings-slot'));
applyTranslations();

const crm = document.getElementById('crm');
const view = document.getElementById('view');
const controls = document.getElementById('page-controls');
const pageTitle = document.getElementById('page-title');
const pageLead = document.getElementById('page-lead');

const login = getSession()?.login ?? '';
document.getElementById('user-name').textContent = login;
document.getElementById('user-initial').textContent = login.slice(0, 1);

document.getElementById('logout').addEventListener('click', () => {
  signOut();
  location.replace('index.html');
});

/* Меню на узком экране выезжает поверх содержимого */
const menuToggle = document.getElementById('menu-toggle');
menuToggle.addEventListener('click', () => {
  const open = crm.dataset.mobileOpen === 'true';
  crm.dataset.mobileOpen = String(!open);
  menuToggle.setAttribute('aria-label', t(open ? 'nav.expand' : 'nav.collapse'));
});

document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => { crm.dataset.mobileOpen = 'false'; });
});

/* --- Роутер ------------------------------------------------------------- */

let disposeCurrent = () => {};
let currentRoute = null;

function routeFromHash() {
  const name = location.hash.replace(/^#\/?/, '').trim();
  return ROUTES[name] ? name : DEFAULT_ROUTE;
}

async function navigate() {
  const name = routeFromHash();
  const route = ROUTES[name];
  currentRoute = name;

  document.querySelectorAll('.nav-item').forEach((item) => {
    if (item.dataset.route === name) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });

  pageTitle.textContent = t(route.titleKey);
  pageLead.textContent = t(route.leadKey);
  document.title = `${t(route.titleKey)} · ${t('crm.name')}`;

  disposeCurrent();
  disposeCurrent = await route.mount(view, controls) || (() => {});
}

window.addEventListener('hashchange', navigate);

/* При смене языка перерисовываем текущий раздел: подписи внутри графиков
   и таблиц собраны в JS и сами не обновятся */
onLangChange(() => {
  resetFormatters();
  applyTranslations();
  navigate();
});

/* Смена пояса меняет каждую отметку времени на экране. Форматтеры кешируются
   по поясу, поэтому без сброса на экране осталось бы время прежнего пояса. */
onZoneChange(() => {
  resetFormatters();
  navigate();
});

if (!location.hash) location.replace(`#/${DEFAULT_ROUTE}`);
navigate();

/* --- Колокольчик --------------------------------------------------------
   Состояние синхронизаций общее для всех разделов, поэтому живёт в шапке
   оболочки, а не внутри дашборда. */

const bell = await mountNotifications(document.getElementById('bell-slot'));

// Значок должен переехать вместе с языком, иначе подсказка останется старой
onLangChange(() => bell.refresh());

// Данные обновляются кроном раз в 4 часа; проверяем журнал раз в 5 минут,
// чтобы вкладка, открытая надолго, не показывала вчерашнее состояние.
setInterval(() => bell.refresh(), 5 * 60 * 1000);
