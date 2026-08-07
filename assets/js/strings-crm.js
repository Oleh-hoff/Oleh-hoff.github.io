/* ==========================================================================
   Строки CRM на трёх языках.

   Названия статей расходов намеренно оставлены с английским оригиналом в
   скобках: в Seller Central они называются именно так, и человек, который
   сверяет наш отчёт с кабинетом Amazon, должен видеть то же слово.
   ========================================================================== */

import { extendDict } from './i18n.js';

extendDict({
  /* ------------------------------------------------------------------ RU */
  ru: {
    'crm.name': 'Amazon CRM',
    'crm.workspace': 'Рабочая область',

    'nav.section.analytics': 'Аналитика',
    'nav.section.operations': 'Операции',
    'nav.section.settings': 'Настройки',
    'nav.salesAnalysis': 'Анализ продаж',
    'nav.products': 'Товары',
    'nav.orders': 'Заказы',
    'nav.inventory': 'Остатки',
    'nav.customers': 'Покупатели',
    'nav.promotions': 'Акции и купоны',
    'nav.sources': 'Источники данных',
    'nav.collapse': 'Свернуть меню',
    'nav.expand': 'Развернуть меню',

    'page.salesAnalysis.title': 'Анализ продаж',
    'page.salesAnalysis.lead': 'Выручка и полная расходная часть по данным Amazon Finances',
    'page.soon.title': 'Раздел в работе',
    'page.soon.lead': 'Этот раздел заложен в структуре и будет наполнен следующим шагом.',

    'filters.period.ytd': 'С начала года',
    'filters.period.quarter': 'Квартал',
    'filters.period.month': 'Месяц',
    'filters.period.week': 'Неделя',
    'filters.currency': 'Валюта',
    'filters.marketplaceAll': 'Все площадки',

    'kpi.grossRevenue': 'Выручка (Principal)',
    'kpi.totalFees': 'Расходы Amazon',
    'kpi.netPayout': 'Остаётся после расходов',
    'kpi.feeShare': 'Доля расходов в выручке',
    'kpi.ofRevenue': 'от выручки',

    'chart.dynamics.title': 'Динамика выручки и расходов',
    'chart.dynamics.subtitle': 'По дням, накопительно с начала периода',
    'chart.expenses.title': 'Структура расходов',
    'chart.expenses.subtitle': 'Все удержания Amazon за период',
    'chart.byMarketplace.title': 'Выручка по площадкам',
    'chart.byMarketplace.subtitle': 'Распределение по странам',

    'series.revenue': 'Выручка',
    'series.expenses': 'Расходы',
    'series.net': 'Нетто',

    'cat.revenue': 'Выручка от товаров (Principal)',
    'cat.revenue_shipping': 'Доставка с покупателя (Shipping)',
    'cat.revenue_tax': 'Налог с покупателя (Tax)',
    'cat.fee_referral': 'Комиссия за продажу (Referral Fee)',
    'cat.fee_fba': 'Логистика FBA (Fulfillment Fee)',
    'cat.fee_placement': 'Размещение запасов (Placement Fee)',
    'cat.fee_storage': 'Хранение (Storage Fee)',
    'cat.fee_inbound': 'Поставка на склад (Inbound Freight)',
    'cat.fee_ads': 'Реклама (Sponsored Ads)',
    'cat.fee_promo': 'Купоны и акции (Coupons, Deals)',
    'cat.fee_other': 'Прочие сборы Amazon',
    'cat.refund': 'Возвраты покупателям',
    'cat.reimbursement': 'Возмещения от Amazon (Reimbursement)',
    'cat.adjustment': 'Корректировки',
    'cat.other': 'Не классифицировано',

    'table.category': 'Статья',
    'table.amount': 'Сумма',
    'table.shareOfRevenue': 'Доля выручки',
    'table.perDay': 'В среднем за день',

    'status.loading': 'Загружаем данные…',
    'status.noData': 'Данных пока нет. Запустите сбор: python3 scripts/collect_amazon.py --from 2026-01-01',
    'status.partial': 'Выгрузка ещё идёт: показаны данные по {date}. Цифры пополнятся автоматически.',
    'status.updated': 'Обновлено',
    'status.period': 'Период данных',
    'status.rows': 'проводок',
  },

  /* ------------------------------------------------------------------ EN */
  en: {
    'crm.name': 'Amazon CRM',
    'crm.workspace': 'Workspace',

    'nav.section.analytics': 'Analytics',
    'nav.section.operations': 'Operations',
    'nav.section.settings': 'Settings',
    'nav.salesAnalysis': 'Sales analysis',
    'nav.products': 'Products',
    'nav.orders': 'Orders',
    'nav.inventory': 'Inventory',
    'nav.customers': 'Customers',
    'nav.promotions': 'Promotions & coupons',
    'nav.sources': 'Data sources',
    'nav.collapse': 'Collapse menu',
    'nav.expand': 'Expand menu',

    'page.salesAnalysis.title': 'Sales analysis',
    'page.salesAnalysis.lead': 'Revenue and the full expense side from Amazon Finances data',
    'page.soon.title': 'Section in progress',
    'page.soon.lead': 'This section is wired into the structure and will be filled in next.',

    'filters.period.ytd': 'Year to date',
    'filters.period.quarter': 'Quarter',
    'filters.period.month': 'Month',
    'filters.period.week': 'Week',
    'filters.currency': 'Currency',
    'filters.marketplaceAll': 'All marketplaces',

    'kpi.grossRevenue': 'Revenue (Principal)',
    'kpi.totalFees': 'Amazon expenses',
    'kpi.netPayout': 'Left after expenses',
    'kpi.feeShare': 'Expenses as share of revenue',
    'kpi.ofRevenue': 'of revenue',

    'chart.dynamics.title': 'Revenue and expenses over time',
    'chart.dynamics.subtitle': 'By day, cumulative from the start of the period',
    'chart.expenses.title': 'Expense breakdown',
    'chart.expenses.subtitle': 'Every Amazon deduction for the period',
    'chart.byMarketplace.title': 'Revenue by marketplace',
    'chart.byMarketplace.subtitle': 'Split across countries',

    'series.revenue': 'Revenue',
    'series.expenses': 'Expenses',
    'series.net': 'Net',

    'cat.revenue': 'Product revenue (Principal)',
    'cat.revenue_shipping': 'Shipping charged to buyer',
    'cat.revenue_tax': 'Tax charged to buyer',
    'cat.fee_referral': 'Referral Fee',
    'cat.fee_fba': 'FBA Fulfillment Fee',
    'cat.fee_placement': 'Inbound Placement Fee',
    'cat.fee_storage': 'Storage Fee',
    'cat.fee_inbound': 'Inbound Freight',
    'cat.fee_ads': 'Sponsored Ads',
    'cat.fee_promo': 'Coupons & Deals',
    'cat.fee_other': 'Other Amazon fees',
    'cat.refund': 'Customer refunds',
    'cat.reimbursement': 'Amazon reimbursements',
    'cat.adjustment': 'Adjustments',
    'cat.other': 'Unclassified',

    'table.category': 'Line item',
    'table.amount': 'Amount',
    'table.shareOfRevenue': 'Share of revenue',
    'table.perDay': 'Average per day',

    'status.loading': 'Loading data…',
    'status.noData': 'No data yet. Run the collector: python3 scripts/collect_amazon.py --from 2026-01-01',
    'status.partial': 'Collection still running: data through {date} is shown. Figures will fill in automatically.',
    'status.updated': 'Updated',
    'status.period': 'Data period',
    'status.rows': 'postings',
  },

  /* ------------------------------------------------------------------ UK */
  uk: {
    'crm.name': 'Amazon CRM',
    'crm.workspace': 'Робоча область',

    'nav.section.analytics': 'Аналітика',
    'nav.section.operations': 'Операції',
    'nav.section.settings': 'Налаштування',
    'nav.salesAnalysis': 'Аналіз продажів',
    'nav.products': 'Товари',
    'nav.orders': 'Замовлення',
    'nav.inventory': 'Залишки',
    'nav.customers': 'Покупці',
    'nav.promotions': 'Акції та купони',
    'nav.sources': 'Джерела даних',
    'nav.collapse': 'Згорнути меню',
    'nav.expand': 'Розгорнути меню',

    'page.salesAnalysis.title': 'Аналіз продажів',
    'page.salesAnalysis.lead': 'Виторг і повна видаткова частина за даними Amazon Finances',
    'page.soon.title': 'Розділ у роботі',
    'page.soon.lead': 'Цей розділ закладено у структурі й буде наповнено наступним кроком.',

    'filters.period.ytd': 'Від початку року',
    'filters.period.quarter': 'Квартал',
    'filters.period.month': 'Місяць',
    'filters.period.week': 'Тиждень',
    'filters.currency': 'Валюта',
    'filters.marketplaceAll': 'Усі майданчики',

    'kpi.grossRevenue': 'Виторг (Principal)',
    'kpi.totalFees': 'Витрати Amazon',
    'kpi.netPayout': 'Лишається після витрат',
    'kpi.feeShare': 'Частка витрат у виторгу',
    'kpi.ofRevenue': 'від виторгу',

    'chart.dynamics.title': 'Динаміка виторгу та витрат',
    'chart.dynamics.subtitle': 'За днями, накопичувально від початку періоду',
    'chart.expenses.title': 'Структура витрат',
    'chart.expenses.subtitle': 'Усі утримання Amazon за період',
    'chart.byMarketplace.title': 'Виторг за майданчиками',
    'chart.byMarketplace.subtitle': 'Розподіл за країнами',

    'series.revenue': 'Виторг',
    'series.expenses': 'Витрати',
    'series.net': 'Нетто',

    'cat.revenue': 'Виторг від товарів (Principal)',
    'cat.revenue_shipping': 'Доставка з покупця (Shipping)',
    'cat.revenue_tax': 'Податок з покупця (Tax)',
    'cat.fee_referral': 'Комісія за продаж (Referral Fee)',
    'cat.fee_fba': 'Логістика FBA (Fulfillment Fee)',
    'cat.fee_placement': 'Розміщення запасів (Placement Fee)',
    'cat.fee_storage': 'Зберігання (Storage Fee)',
    'cat.fee_inbound': 'Постачання на склад (Inbound Freight)',
    'cat.fee_ads': 'Реклама (Sponsored Ads)',
    'cat.fee_promo': 'Купони та акції (Coupons, Deals)',
    'cat.fee_other': 'Інші збори Amazon',
    'cat.refund': 'Повернення покупцям',
    'cat.reimbursement': 'Відшкодування від Amazon (Reimbursement)',
    'cat.adjustment': 'Коригування',
    'cat.other': 'Не класифіковано',

    'table.category': 'Стаття',
    'table.amount': 'Сума',
    'table.shareOfRevenue': 'Частка виторгу',
    'table.perDay': 'У середньому за день',

    'status.loading': 'Завантажуємо дані…',
    'status.noData': 'Даних поки немає. Запустіть збір: python3 scripts/collect_amazon.py --from 2026-01-01',
    'status.partial': 'Вивантаження ще триває: показано дані по {date}. Цифри поповняться автоматично.',
    'status.updated': 'Оновлено',
    'status.period': 'Період даних',
    'status.rows': 'проводок',
  },
});
