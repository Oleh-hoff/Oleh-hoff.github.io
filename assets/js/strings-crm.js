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
    'nav.products': 'Товары',
    'nav.orders': 'Заказы',
    'nav.inventory': 'Остатки',
    'nav.customers': 'Покупатели',
    'nav.promotions': 'Акции и купоны',
    'nav.sources': 'Источники данных',
    'nav.collapse': 'Свернуть меню',
    'nav.expand': 'Развернуть меню',

    'page.soon.title': 'Раздел в работе',
    'page.soon.lead': 'Этот раздел заложен в структуре и будет наполнен следующим шагом.',

    /* --- Отметки акций ---------------------------------------------------- */
    'sales.promo.title': 'Акции',
    'sales.promo.coupon': 'Купоны',
    'sales.promo.best_deal': 'Бест-дилы',
    'sales.promo.lightning_deal': 'Молниеносные дилы',
    'sales.promo.units': 'продано {n} шт',
    'sales.promo.more': '… и ещё {n}',
    'sales.note.promo': 'Значки над неделями — акции: {n} кампаний задели {weeks} недель в текущем срезе. Значок один на тип, счёт и список — в подсказке.',
    'sales.note.promoNone': 'В текущем срезе акций не было.',
    'log.source.promotions': 'Купоны и дилы',
    'log.stat.campaigns': 'кампаний: {n}',
    'log.stat.coupons': 'купонов: {n}',
    'log.stat.deals': 'дилов: {n}',
    'logs.fieldCampaigns': 'Кампаний',

    /* --- Настройки -------------------------------------------------------- */
    'settings.title': 'Настройки',
    'settings.close': 'Закрыть настройки',
    'settings.language': 'Язык',
    'settings.timezone': 'Часовой пояс',
    'settings.theme': 'Тема',
    'settings.tzSystem': 'Как в системе ({zone})',
    'settings.tzNow': '{offset}, сейчас {time}',

    /* --- Журнал: новые источники и подробности ---------------------------- */
    'log.source.account': 'Проверка аккаунта',
    'log.source.weeklySales': 'Продажи по неделям',
    'log.source.fx': 'Курсы валют (ЕЦБ)',
    'log.recentN': 'Последние {n} запусков',
    'log.reason.unknown': 'Неизвестная ошибка: {type}',
    'log.stat.weeks': 'недель: {n}',
    'log.stat.units': 'штук: {n}',
    'log.stat.asins': 'товаров: {n}',
    'log.stat.marketplaces': 'площадок: {n}',
    'log.stat.rows': 'строк: {n}',
    'log.stat.pages': 'страниц: {n}',
    'log.stat.events': 'событий: {n}',
    'log.stat.days': 'дней: {n}',
    'log.stat.checks': 'проверок: {n}',
    'log.stat.warnings': 'замечаний: {n}',
    'log.stat.unavailable': 'недоступно: {n}',
    'log.stat.rates': 'курсов: {n}',

    'logs.fieldData': 'Что обновилось',
    'logs.fieldWeeks': 'Недель',
    'logs.fieldUnits': 'Штук',
    'logs.fieldAsins': 'Товаров',
    'logs.fieldMarkets': 'Площадок',
    'logs.fieldChecks': 'Проверок',
    'logs.fieldWarnings': 'Замечаний',

    /* --- Перевод в евро --------------------------------------------------- */
    'sales.allInEur': 'Всё в евро',
    'sales.note.converted': 'Суммы переведены в евро по справочным курсам ЕЦБ ({from} — {to}), понедельно. Это оценка: Amazon конвертирует по своему курсу на момент выплаты, и с Seller Central цифра не сойдётся.',
    'sales.note.rateGap': 'На части недель курсов ЕЦБ нет (публикуются только по рабочим дням) — взят ближайший известный день.',
    'sales.note.noRate': 'Без курса и потому не переведено: {currencies}.',

    /* --- Вики ------------------------------------------------------------ */
    'nav.wiki': 'Вики',
    'page.wiki.title': 'Вики',
    'page.wiki.lead': 'База знаний по проекту: решения, подвохи Amazon, порядок проверки. Статьи лежат в репозитории обычными файлами markdown.',

    'wiki.loading': 'Загружаю статьи…',
    'wiki.noData': 'Указателя статей нет. Ожидается файл: ',
    'wiki.nothing': 'Ничего не найдено',
    'wiki.search': 'Поиск по статьям',
    'wiki.allTags': 'Все',
    'wiki.contents': 'Содержание',
    'wiki.updated': 'Обновлено {date}',
    'wiki.noTranslation': 'Перевода на текущий язык пока нет — статья показана на русском.',
    'wiki.missingFile': 'Статья указана в индексе, но файла нет: {file}',

    /* --- Продажи по неделям --------------------------------------------- */
    'nav.weeklySales': 'Продажи по неделям',
    'page.weeklySales.title': 'Продажи по неделям',
    'page.weeklySales.lead': 'Три месяца продаж по площадкам и товарам. Штуки складываются по всем площадкам, деньги — отдельно по каждой валюте.',

    'sales.loading': 'Загружаю продажи…',
    'sales.noData': 'Выгрузки продаж ещё нет. Соберите её: ',
    'sales.empty': 'За выбранный срез продаж нет',

    'sales.marketplace': 'Площадка',
    'sales.allMarkets': 'Все площадки',
    'sales.product': 'Товар',
    'sales.currency': 'Валюта',
    'sales.metric.units': 'Штуки',
    'sales.metric.money': 'Деньги',
    'sales.otherMarkets': 'Остальные ({count})',

    'sales.filter.search': 'Название или ASIN',
    'sales.filter.all': 'Все товары',
    'sales.filter.selected': 'Выбрано: {count}',
    'sales.filter.variants': 'Вариаций: {count}',
    'sales.filter.nothing': 'Ничего не найдено',

    'sales.kpi.units': 'Продано штук',
    'sales.kpi.revenue': 'Выручка',
    'sales.kpi.overWeeks': 'за {count} полных недель',
    'sales.kpi.perWeek': 'В среднем за неделю',
    'sales.kpi.best': 'Лучшая неделя',
    'sales.kpi.running': 'Текущая неделя',
    'sales.kpi.runningNote': 'ещё не кончилась, на графике её нет',
    'sales.kpi.revenueIn': 'Выручка, {currency}',

    'sales.chart.weeks': 'По неделям',
    'sales.chart.weeksAll': 'Столбец — неделя, цвет — площадка',
    'sales.chart.weeksOne': 'Только {market}',
    'sales.chart.products': 'Что продаётся',
    'sales.chart.productsHint': 'Вариации сведены в один товар',

    'sales.col.week': 'Неделя',
    'sales.col.total': 'Итого',
    'sales.showTable': 'Показать таблицей',

    'sales.note.generated': 'Выгрузка от {at}.',
    'sales.note.unpriced': 'Штук без цены: {units} — это продажи вне Amazon, отчёт отдаёт их без цены и валюты. В штуки они вошли, в деньги нет.',
    'sales.note.currencies': 'Деньги не пересчитываются между валютами: курса в данных Amazon нет.',







  },

  /* ------------------------------------------------------------------ EN */
  en: {
    'crm.name': 'Amazon CRM',
    'crm.workspace': 'Workspace',

    'nav.section.analytics': 'Analytics',
    'nav.section.operations': 'Operations',
    'nav.section.settings': 'Settings',
    'nav.products': 'Products',
    'nav.orders': 'Orders',
    'nav.inventory': 'Inventory',
    'nav.customers': 'Customers',
    'nav.promotions': 'Promotions & coupons',
    'nav.sources': 'Data sources',
    'nav.collapse': 'Collapse menu',
    'nav.expand': 'Expand menu',

    'page.soon.title': 'Section in progress',
    'page.soon.lead': 'This section is wired into the structure and will be filled in next.',

    /* --- Promotion marks -------------------------------------------------- */
    'sales.promo.title': 'Promotions',
    'sales.promo.coupon': 'Coupons',
    'sales.promo.best_deal': 'Best Deals',
    'sales.promo.lightning_deal': 'Lightning Deals',
    'sales.promo.units': '{n} units sold',
    'sales.promo.more': '… and {n} more',
    'sales.note.promo': 'Marks above the weeks are promotions: {n} campaigns touched {weeks} weeks in the current slice. One mark per type; the count and list are in the tooltip.',
    'sales.note.promoNone': 'No promotions in the current slice.',
    'log.source.promotions': 'Coupons and deals',
    'log.stat.campaigns': 'campaigns: {n}',
    'log.stat.coupons': 'coupons: {n}',
    'log.stat.deals': 'deals: {n}',
    'logs.fieldCampaigns': 'Campaigns',

    /* --- Settings --------------------------------------------------------- */
    'settings.title': 'Settings',
    'settings.close': 'Close settings',
    'settings.language': 'Language',
    'settings.timezone': 'Time zone',
    'settings.theme': 'Theme',
    'settings.tzSystem': 'Same as system ({zone})',
    'settings.tzNow': '{offset}, now {time}',

    /* --- Log: new sources and details ------------------------------------- */
    'log.source.account': 'Account check',
    'log.source.weeklySales': 'Weekly sales',
    'log.source.fx': 'Exchange rates (ECB)',
    'log.recentN': 'Last {n} runs',
    'log.reason.unknown': 'Unknown error: {type}',
    'log.stat.weeks': 'weeks: {n}',
    'log.stat.units': 'units: {n}',
    'log.stat.asins': 'products: {n}',
    'log.stat.marketplaces': 'marketplaces: {n}',
    'log.stat.rows': 'rows: {n}',
    'log.stat.pages': 'pages: {n}',
    'log.stat.events': 'events: {n}',
    'log.stat.days': 'days: {n}',
    'log.stat.checks': 'checks: {n}',
    'log.stat.warnings': 'warnings: {n}',
    'log.stat.unavailable': 'unavailable: {n}',
    'log.stat.rates': 'rate days: {n}',

    'logs.fieldData': 'What was updated',
    'logs.fieldWeeks': 'Weeks',
    'logs.fieldUnits': 'Units',
    'logs.fieldAsins': 'Products',
    'logs.fieldMarkets': 'Marketplaces',
    'logs.fieldChecks': 'Checks',
    'logs.fieldWarnings': 'Warnings',

    /* --- Conversion to euro ----------------------------------------------- */
    'sales.allInEur': 'All in euro',
    'sales.note.converted': 'Amounts converted to euro at ECB reference rates ({from} — {to}), week by week. This is an estimate: Amazon converts at its own rate on payout, so the figure will not match Seller Central.',
    'sales.note.rateGap': 'Some weeks have no ECB rates (published on business days only) — the nearest known day was used.',
    'sales.note.noRate': 'No rate available, so not converted: {currencies}.',

    /* --- Wiki ------------------------------------------------------------- */
    'nav.wiki': 'Wiki',
    'page.wiki.title': 'Wiki',
    'page.wiki.lead': 'Project knowledge base: decisions, Amazon gotchas, verification steps. Articles live in the repository as plain markdown files.',

    'wiki.loading': 'Loading articles…',
    'wiki.noData': 'No article index found. Expected file: ',
    'wiki.nothing': 'Nothing found',
    'wiki.search': 'Search articles',
    'wiki.allTags': 'All',
    'wiki.contents': 'Contents',
    'wiki.updated': 'Updated {date}',
    'wiki.noTranslation': 'No translation into the current language yet — showing the Russian original.',
    'wiki.missingFile': 'The article is listed in the index but the file is missing: {file}',

    /* --- Weekly sales ---------------------------------------------------- */
    'nav.weeklySales': 'Weekly sales',
    'page.weeklySales.title': 'Weekly sales',
    'page.weeklySales.lead': 'Three months of sales by marketplace and product. Units add up across all marketplaces; money is kept per currency.',

    'sales.loading': 'Loading sales…',
    'sales.noData': 'No sales export yet. Build one: ',
    'sales.empty': 'No sales in this slice',

    'sales.marketplace': 'Marketplace',
    'sales.allMarkets': 'All marketplaces',
    'sales.product': 'Product',
    'sales.currency': 'Currency',
    'sales.metric.units': 'Units',
    'sales.metric.money': 'Money',
    'sales.otherMarkets': 'Others ({count})',

    'sales.filter.search': 'Name or ASIN',
    'sales.filter.all': 'All products',
    'sales.filter.selected': 'Selected: {count}',
    'sales.filter.variants': 'Variations: {count}',
    'sales.filter.nothing': 'Nothing found',

    'sales.kpi.units': 'Units sold',
    'sales.kpi.revenue': 'Revenue',
    'sales.kpi.overWeeks': 'over {count} full weeks',
    'sales.kpi.perWeek': 'Weekly average',
    'sales.kpi.best': 'Best week',
    'sales.kpi.running': 'Current week',
    'sales.kpi.runningNote': 'still running, not on the chart',
    'sales.kpi.revenueIn': 'Revenue, {currency}',

    'sales.chart.weeks': 'By week',
    'sales.chart.weeksAll': 'One column per week, colour is the marketplace',
    'sales.chart.weeksOne': '{market} only',
    'sales.chart.products': 'What sells',
    'sales.chart.productsHint': 'Variations rolled up into one product',

    'sales.col.week': 'Week',
    'sales.col.total': 'Total',
    'sales.showTable': 'Show as table',

    'sales.note.generated': 'Export from {at}.',
    'sales.note.unpriced': 'Units without a price: {units} — these are off-Amazon sales; the report returns them with no price or currency. Counted in units, not in money.',
    'sales.note.currencies': 'Money is not converted between currencies: Amazon data carries no exchange rate.',







  },

  /* ------------------------------------------------------------------ UK */
  uk: {
    'crm.name': 'Amazon CRM',
    'crm.workspace': 'Робоча область',

    'nav.section.analytics': 'Аналітика',
    'nav.section.operations': 'Операції',
    'nav.section.settings': 'Налаштування',
    'nav.products': 'Товари',
    'nav.orders': 'Замовлення',
    'nav.inventory': 'Залишки',
    'nav.customers': 'Покупці',
    'nav.promotions': 'Акції та купони',
    'nav.sources': 'Джерела даних',
    'nav.collapse': 'Згорнути меню',
    'nav.expand': 'Розгорнути меню',

    'page.soon.title': 'Розділ у роботі',
    'page.soon.lead': 'Цей розділ закладено у структурі й буде наповнено наступним кроком.',

    /* --- Позначки акцій ---------------------------------------------------- */
    'sales.promo.title': 'Акції',
    'sales.promo.coupon': 'Купони',
    'sales.promo.best_deal': 'Бест-діли',
    'sales.promo.lightning_deal': 'Блискавичні діли',
    'sales.promo.units': 'продано {n} шт',
    'sales.promo.more': '… і ще {n}',
    'sales.note.promo': 'Значки над тижнями — акції: {n} кампаній зачепили {weeks} тижнів у поточному зрізі. Значок один на тип, лічба і список — у підказці.',
    'sales.note.promoNone': 'У поточному зрізі акцій не було.',
    'log.source.promotions': 'Купони й діли',
    'log.stat.campaigns': 'кампаній: {n}',
    'log.stat.coupons': 'купонів: {n}',
    'log.stat.deals': 'дилів: {n}',
    'logs.fieldCampaigns': 'Кампаній',

    /* --- Налаштування ----------------------------------------------------- */
    'settings.title': 'Налаштування',
    'settings.close': 'Закрити налаштування',
    'settings.language': 'Мова',
    'settings.timezone': 'Часовий пояс',
    'settings.theme': 'Тема',
    'settings.tzSystem': 'Як у системі ({zone})',
    'settings.tzNow': '{offset}, зараз {time}',

    /* --- Журнал: нові джерела й подробиці ---------------------------------- */
    'log.source.account': 'Перевірка акаунта',
    'log.source.weeklySales': 'Продажі по тижнях',
    'log.source.fx': 'Курси валют (ЄЦБ)',
    'log.recentN': 'Останні {n} запусків',
    'log.reason.unknown': 'Невідома помилка: {type}',
    'log.stat.weeks': 'тижнів: {n}',
    'log.stat.units': 'штук: {n}',
    'log.stat.asins': 'товарів: {n}',
    'log.stat.marketplaces': 'площадок: {n}',
    'log.stat.rows': 'рядків: {n}',
    'log.stat.pages': 'сторінок: {n}',
    'log.stat.events': 'подій: {n}',
    'log.stat.days': 'днів: {n}',
    'log.stat.checks': 'перевірок: {n}',
    'log.stat.warnings': 'зауважень: {n}',
    'log.stat.unavailable': 'недоступно: {n}',
    'log.stat.rates': 'курсів: {n}',

    'logs.fieldData': 'Що оновилося',
    'logs.fieldWeeks': 'Тижнів',
    'logs.fieldUnits': 'Штук',
    'logs.fieldAsins': 'Товарів',
    'logs.fieldMarkets': 'Площадок',
    'logs.fieldChecks': 'Перевірок',
    'logs.fieldWarnings': 'Зауважень',

    /* --- Переведення в євро ------------------------------------------------ */
    'sales.allInEur': 'Усе в євро',
    'sales.note.converted': 'Суми переведені в євро за довідковими курсами ЄЦБ ({from} — {to}), потижнево. Це оцінка: Amazon конвертує за власним курсом на момент виплати, і з Seller Central цифра не зійдеться.',
    'sales.note.rateGap': 'На частині тижнів курсів ЄЦБ немає (публікуються лише в робочі дні) — узято найближчий відомий день.',
    'sales.note.noRate': 'Без курсу і тому не переведено: {currencies}.',

    /* --- Вікі -------------------------------------------------------------- */
    'nav.wiki': 'Вікі',
    'page.wiki.title': 'Вікі',
    'page.wiki.lead': 'База знань по проєкту: рішення, пастки Amazon, порядок перевірки. Статті лежать у репозиторії звичайними файлами markdown.',

    'wiki.loading': 'Завантажую статті…',
    'wiki.noData': 'Покажчика статей немає. Очікується файл: ',
    'wiki.nothing': 'Нічого не знайдено',
    'wiki.search': 'Пошук по статтях',
    'wiki.allTags': 'Усі',
    'wiki.contents': 'Зміст',
    'wiki.updated': 'Оновлено {date}',
    'wiki.noTranslation': 'Перекладу поточною мовою поки немає — статтю показано російською.',
    'wiki.missingFile': 'Статтю вказано в покажчику, але файлу немає: {file}',

    /* --- Продажі по тижнях ------------------------------------------------ */
    'nav.weeklySales': 'Продажі по тижнях',
    'page.weeklySales.title': 'Продажі по тижнях',
    'page.weeklySales.lead': 'Три місяці продажів по площадках і товарах. Штуки додаються по всіх площадках, гроші — окремо по кожній валюті.',

    'sales.loading': 'Завантажую продажі…',
    'sales.noData': 'Вивантаження продажів ще немає. Зберіть його: ',
    'sales.empty': 'За обраним зрізом продажів немає',

    'sales.marketplace': 'Площадка',
    'sales.allMarkets': 'Усі площадки',
    'sales.product': 'Товар',
    'sales.currency': 'Валюта',
    'sales.metric.units': 'Штуки',
    'sales.metric.money': 'Гроші',
    'sales.otherMarkets': 'Решта ({count})',

    'sales.filter.search': 'Назва або ASIN',
    'sales.filter.all': 'Усі товари',
    'sales.filter.selected': 'Обрано: {count}',
    'sales.filter.variants': 'Варіацій: {count}',
    'sales.filter.nothing': 'Нічого не знайдено',

    'sales.kpi.units': 'Продано штук',
    'sales.kpi.revenue': 'Виторг',
    'sales.kpi.overWeeks': 'за {count} повних тижнів',
    'sales.kpi.perWeek': 'У середньому за тиждень',
    'sales.kpi.best': 'Найкращий тиждень',
    'sales.kpi.running': 'Поточний тиждень',
    'sales.kpi.runningNote': 'ще не скінчився, на графіку його немає',
    'sales.kpi.revenueIn': 'Виторг, {currency}',

    'sales.chart.weeks': 'По тижнях',
    'sales.chart.weeksAll': 'Стовпець — тиждень, колір — площадка',
    'sales.chart.weeksOne': 'Лише {market}',
    'sales.chart.products': 'Що продається',
    'sales.chart.productsHint': 'Варіації зведені в один товар',

    'sales.col.week': 'Тиждень',
    'sales.col.total': 'Разом',
    'sales.showTable': 'Показати таблицею',

    'sales.note.generated': 'Вивантаження від {at}.',
    'sales.note.unpriced': 'Штук без ціни: {units} — це продажі поза Amazon, звіт віддає їх без ціни й валюти. У штуки вони ввійшли, у гроші ні.',
    'sales.note.currencies': 'Гроші не перераховуються між валютами: курсу в даних Amazon немає.',







  },
});

/* ==========================================================================
   Журнал синхронизаций: колокольчик, модальное окно, страница логов.

   Причины сбоев сформулированы для человека, который смотрит дашборд, а не
   пишет код: код ошибки Amazon сам по себе ничего не объясняет, поэтому
   рядом всегда сказано, что именно произошло и что с этим делать.
   ========================================================================== */

extendDict({
  ru: {
    'log.title': 'Обновления данных',
    'log.close': 'Закрыть',
    'log.more': 'Подробнее — все логи соединений →',
    'log.empty': 'Синхронизаций пока не было',
    'log.recent': 'Последние запуски',
    'log.status.ok': 'успешно',
    'log.status.partial': 'частично',
    'log.status.error': 'сбой',
    'log.source.amazon': 'Amazon SP-API',
    'log.source.sheets': 'Google Таблицы',
    'log.schedule.4h': 'каждые 4 часа',
    'log.schedule.manual': 'вручную',
    'log.summary24h': 'За сутки: {total} запусков, успешных {ok}',
    'log.summaryIssues': 'сбоев {failed}, частичных {partial}',
    'log.nextRun': 'Следующее обновление около {time}',

    'log.reason.forbidden': 'Amazon отказал в доступе (403). Обычно это значит, что отозвана авторизация приложения или у него нет нужной роли. Проверьте разрешения в Seller Central.',
    'log.reason.unauthorized': 'Amazon не принял авторизацию (401). Скорее всего истёк refresh-токен — его нужно перевыпустить в Seller Central.',
    'log.reason.throttled': 'Amazon ограничил частоту запросов (429) и отвечал отказом дольше, чем длились повторы. Данные доберутся при следующем запуске.',
    'log.reason.amazonDown': 'Сервер Amazon ответил ошибкой (5xx) — сбой на их стороне. Обычно проходит само, следующий запуск доберёт пропущенное.',
    'log.reason.network': 'Не удалось соединиться с Amazon: сеть недоступна или запрос не уложился в таймаут.',
    'log.reason.sandbox': 'Подключение настроено на песочницу вместо боевого окружения — оттуда приходят выдуманные данные. Нужно значение production.',
    'log.reason.cancelled': 'Запуск был отменён — его вытеснил следующий по расписанию. Собранное за этот заход не сохранено.',
    'log.reason.crashed': 'Сборщик завершился аварийно и не оставил подробностей. Технический журнал запуска — по ссылке в записи.',
    'log.reason.config': 'Не удалось прочитать настройки подключения: не заданы или испорчены переменные окружения.',

    'logs.title': 'Логи соединений',
    'logs.lead': 'Полная история обновлений по всем интеграциям дашборда',
    'logs.back': 'Назад к дашборду',
    'logs.filterAll': 'Все',
    'logs.filterIssues': 'Только сбои',
    'logs.statTotal': 'Всего запусков',
    'logs.statOk': 'Успешных',
    'logs.statIssues': 'Сбоев и частичных',
    'logs.statLast': 'Последняя синхронизация',
    'logs.empty': 'Записей нет. Первая появится после ближайшего запуска синхронизации.',
    'logs.fieldSource': 'Источник',
    'logs.fieldMode': 'Режим',
    'logs.fieldStarted': 'Начало',
    'logs.fieldFinished': 'Завершение',
    'logs.fieldDuration': 'Длительность',
    'logs.fieldTrigger': 'Запущено',
    'logs.fieldRows': 'Проводок получено',
    'logs.fieldDays': 'Дней в данных',
    'logs.fieldPages': 'Страниц API',
    'logs.fieldPeriod': 'Период данных',
    'logs.fieldError': 'Причина сбоя',
    'logs.fieldTechnical': 'Технические подробности',
    'logs.fieldRun': 'Журнал запуска',
    'logs.openRun': 'Открыть в GitHub Actions',
    'logs.seconds': '{n} с',
    'logs.minutes': '{n} мин',
    'logs.unknownTypes': 'Новые типы комиссий Amazon',
  },

  en: {
    'log.title': 'Data updates',
    'log.close': 'Close',
    'log.more': 'Details — all connection logs →',
    'log.empty': 'No synchronisations yet',
    'log.recent': 'Recent runs',
    'log.status.ok': 'success',
    'log.status.partial': 'partial',
    'log.status.error': 'failure',
    'log.source.amazon': 'Amazon SP-API',
    'log.source.sheets': 'Google Sheets',
    'log.schedule.4h': 'every 4 hours',
    'log.schedule.manual': 'manual',
    'log.summary24h': 'Last 24h: {total} runs, {ok} successful',
    'log.summaryIssues': '{failed} failed, {partial} partial',
    'log.nextRun': 'Next update around {time}',

    'log.reason.forbidden': 'Amazon denied access (403). Usually the app authorisation was revoked or it lacks the required role. Check permissions in Seller Central.',
    'log.reason.unauthorized': 'Amazon rejected the authorisation (401). The refresh token has most likely expired — reissue it in Seller Central.',
    'log.reason.throttled': 'Amazon rate-limited the requests (429) and kept refusing longer than the retries lasted. The data will be picked up on the next run.',
    'log.reason.amazonDown': 'Amazon returned a server error (5xx) — a failure on their side. It usually clears up by itself and the next run catches up.',
    'log.reason.network': 'Could not reach Amazon: the network was unavailable or the request timed out.',
    'log.reason.sandbox': 'The connection points at the sandbox instead of production, which returns made-up data. It must be set to production.',
    'log.reason.cancelled': 'The run was cancelled — the next scheduled run displaced it. Nothing collected in this pass was saved.',
    'log.reason.crashed': 'The collector crashed without leaving details. The technical run log is linked in the entry.',
    'log.reason.config': 'Could not read the connection settings: environment variables are missing or malformed.',

    'logs.title': 'Connection logs',
    'logs.lead': 'Full update history across every integration of the dashboard',
    'logs.back': 'Back to dashboard',
    'logs.filterAll': 'All',
    'logs.filterIssues': 'Issues only',
    'logs.statTotal': 'Total runs',
    'logs.statOk': 'Successful',
    'logs.statIssues': 'Failed and partial',
    'logs.statLast': 'Last synchronisation',
    'logs.empty': 'No entries yet. The first one appears after the next synchronisation run.',
    'logs.fieldSource': 'Source',
    'logs.fieldMode': 'Mode',
    'logs.fieldStarted': 'Started',
    'logs.fieldFinished': 'Finished',
    'logs.fieldDuration': 'Duration',
    'logs.fieldTrigger': 'Triggered by',
    'logs.fieldRows': 'Postings received',
    'logs.fieldDays': 'Days in data',
    'logs.fieldPages': 'API pages',
    'logs.fieldPeriod': 'Data period',
    'logs.fieldError': 'Failure reason',
    'logs.fieldTechnical': 'Technical details',
    'logs.fieldRun': 'Run log',
    'logs.openRun': 'Open in GitHub Actions',
    'logs.seconds': '{n}s',
    'logs.minutes': '{n} min',
    'logs.unknownTypes': 'New Amazon fee types',
  },

  uk: {
    'log.title': 'Оновлення даних',
    'log.close': 'Закрити',
    'log.more': 'Детальніше — усі логи з’єднань →',
    'log.empty': 'Синхронізацій ще не було',
    'log.recent': 'Останні запуски',
    'log.status.ok': 'успішно',
    'log.status.partial': 'частково',
    'log.status.error': 'збій',
    'log.source.amazon': 'Amazon SP-API',
    'log.source.sheets': 'Google Таблиці',
    'log.schedule.4h': 'кожні 4 години',
    'log.schedule.manual': 'вручну',
    'log.summary24h': 'За добу: {total} запусків, успішних {ok}',
    'log.summaryIssues': 'збоїв {failed}, часткових {partial}',
    'log.nextRun': 'Наступне оновлення близько {time}',

    'log.reason.forbidden': 'Amazon відмовив у доступі (403). Зазвичай це означає, що відкликано авторизацію застосунку або йому бракує потрібної ролі. Перевірте дозволи в Seller Central.',
    'log.reason.unauthorized': 'Amazon не прийняв авторизацію (401). Найімовірніше збіг термін дії refresh-токена — його треба перевипустити в Seller Central.',
    'log.reason.throttled': 'Amazon обмежив частоту запитів (429) і відмовляв довше, ніж тривали повтори. Дані доберуться наступним запуском.',
    'log.reason.amazonDown': 'Сервер Amazon відповів помилкою (5xx) — збій на їхньому боці. Зазвичай минає саме, наступний запуск добере пропущене.',
    'log.reason.network': 'Не вдалося з’єднатися з Amazon: мережа недоступна або запит не вклався в тайм-аут.',
    'log.reason.sandbox': 'З’єднання налаштоване на пісочницю замість бойового середовища — звідти надходять вигадані дані. Потрібне значення production.',
    'log.reason.cancelled': 'Запуск було скасовано — його витіснив наступний за розкладом. Зібране за цей захід не збережено.',
    'log.reason.crashed': 'Збирач завершився аварійно і не залишив подробиць. Технічний журнал запуску — за посиланням у записі.',
    'log.reason.config': 'Не вдалося прочитати налаштування з’єднання: змінні оточення не задані або пошкоджені.',

    'logs.title': 'Логи з’єднань',
    'logs.lead': 'Повна історія оновлень за всіма інтеграціями дашборда',
    'logs.back': 'Назад до дашборда',
    'logs.filterAll': 'Усі',
    'logs.filterIssues': 'Лише збої',
    'logs.statTotal': 'Усього запусків',
    'logs.statOk': 'Успішних',
    'logs.statIssues': 'Збоїв і часткових',
    'logs.statLast': 'Остання синхронізація',
    'logs.empty': 'Записів немає. Перший з’явиться після найближчого запуску синхронізації.',
    'logs.fieldSource': 'Джерело',
    'logs.fieldMode': 'Режим',
    'logs.fieldStarted': 'Початок',
    'logs.fieldFinished': 'Завершення',
    'logs.fieldDuration': 'Тривалість',
    'logs.fieldTrigger': 'Запущено',
    'logs.fieldRows': 'Проводок отримано',
    'logs.fieldDays': 'Днів у даних',
    'logs.fieldPages': 'Сторінок API',
    'logs.fieldPeriod': 'Період даних',
    'logs.fieldError': 'Причина збою',
    'logs.fieldTechnical': 'Технічні подробиці',
    'logs.fieldRun': 'Журнал запуску',
    'logs.openRun': 'Відкрити в GitHub Actions',
    'logs.seconds': '{n} с',
    'logs.minutes': '{n} хв',
    'logs.unknownTypes': 'Нові типи комісій Amazon',
  },
});

/* ==========================================================================
   Раздел «Проверка аккаунта».

   Формулировки недоступных проверок объясняют не «не поддерживается», а что
   именно Amazon не отдаёт и чем это можно заменить: пользователю нужно
   понимать, чего дашборд про его аккаунт не знает.
   ========================================================================== */

extendDict({
  ru: {
    'nav.accountCheck': 'Проверка аккаунта',
    'page.accountCheck.title': 'Проверка аккаунта',
    'page.accountCheck.lead': 'Состояние аккаунта, товаров и запасов по данным Amazon',

    'check.loading': 'Выполняем проверки…',
    'check.noData': 'Проверки ещё не выполнялись. Запустите сбор:',
    'check.showDetails': 'Показать подробности',
    'check.state.ok': 'в норме',
    'check.state.warn': 'требует внимания',
    'check.state.error': 'проблема',
    'check.state.unavailable': 'недоступно через API',
    'check.listingTotals': 'Всего товаров {total}, неактивных {inactive}',

    'check.kpi.passed': 'Проверок пройдено',
    'check.kpi.attention': 'Требуют внимания',
    'check.kpi.unavailable': 'Недоступно через API',
    'check.kpi.checkedAt': 'Последняя проверка',

    'check.actions': 'Actions на главной',
    'check.stranded': 'Зависшие запасы (Stranded)',
    'check.listingStatus': 'Смена статуса товаров',
    'check.accountHealth': 'Здоровье аккаунта',
    'check.feedback': 'Новые отзывы о продавце',
    'check.performanceNotifications': 'Performance Notifications',
    'check.pricingHealth': 'Pricing Health',
    'check.messages': 'Входящие сообщения',
    'check.customerReviews': 'Отзывы о товарах',
    'check.fbaPerformance': 'Показатели FBA',
    'check.cases': 'Обращения в поддержку',

    'check.col.sku': 'SKU',
    'check.col.title': 'Товар',
    'check.col.qty': 'Кол-во',
    'check.col.reason': 'Причина',
    'check.col.was': 'Было',
    'check.col.now': 'Стало',
    'check.col.date': 'Дата',
    'check.col.rating': 'Оценка',
    'check.col.comment': 'Комментарий',
    'check.col.excess': 'Излишки',
    'check.col.aged': 'Залежалось',
    'check.col.metric': 'Показатель',
    'check.col.value': 'Значение',
    'check.col.target': 'Цель',
    'check.col.state': 'Состояние',
  },

  en: {
    'nav.accountCheck': 'Account check',
    'page.accountCheck.title': 'Account check',
    'page.accountCheck.lead': 'Account, listing and inventory health from Amazon data',

    'check.loading': 'Running checks…',
    'check.noData': 'No checks have run yet. Start the collector:',
    'check.showDetails': 'Show details',
    'check.state.ok': 'healthy',
    'check.state.warn': 'needs attention',
    'check.state.error': 'problem',
    'check.state.unavailable': 'not available via API',
    'check.listingTotals': '{total} listings in total, {inactive} inactive',

    'check.kpi.passed': 'Checks passed',
    'check.kpi.attention': 'Need attention',
    'check.kpi.unavailable': 'Not available via API',
    'check.kpi.checkedAt': 'Last check',

    'check.actions': 'Actions on Home',
    'check.stranded': 'Stranded inventory',
    'check.listingStatus': 'Listing status changes',
    'check.accountHealth': 'Account health',
    'check.feedback': 'New seller feedback',
    'check.performanceNotifications': 'Performance Notifications',
    'check.pricingHealth': 'Pricing Health',
    'check.messages': 'Inbox messages',
    'check.customerReviews': 'Customer reviews',
    'check.fbaPerformance': 'FBA performance',
    'check.cases': 'Support cases',

    'check.col.sku': 'SKU',
    'check.col.title': 'Product',
    'check.col.qty': 'Qty',
    'check.col.reason': 'Reason',
    'check.col.was': 'Was',
    'check.col.now': 'Now',
    'check.col.date': 'Date',
    'check.col.rating': 'Rating',
    'check.col.comment': 'Comment',
    'check.col.excess': 'Excess',
    'check.col.aged': 'Aged',
    'check.col.metric': 'Metric',
    'check.col.value': 'Value',
    'check.col.target': 'Target',
    'check.col.state': 'State',
  },

  uk: {
    'nav.accountCheck': 'Перевірка акаунту',
    'page.accountCheck.title': 'Перевірка акаунту',
    'page.accountCheck.lead': 'Стан акаунту, товарів і запасів за даними Amazon',

    'check.loading': 'Виконуємо перевірки…',
    'check.noData': 'Перевірки ще не виконувалися. Запустіть збір:',
    'check.showDetails': 'Показати подробиці',
    'check.state.ok': 'у нормі',
    'check.state.warn': 'потребує уваги',
    'check.state.error': 'проблема',
    'check.state.unavailable': 'недоступно через API',
    'check.listingTotals': 'Усього товарів {total}, неактивних {inactive}',

    'check.kpi.passed': 'Перевірок пройдено',
    'check.kpi.attention': 'Потребують уваги',
    'check.kpi.unavailable': 'Недоступно через API',
    'check.kpi.checkedAt': 'Остання перевірка',

    'check.actions': 'Actions на головній',
    'check.stranded': 'Завислі запаси (Stranded)',
    'check.listingStatus': 'Зміна статусу товарів',
    'check.accountHealth': "Здоров'я акаунту",
    'check.feedback': 'Нові відгуки про продавця',
    'check.performanceNotifications': 'Performance Notifications',
    'check.pricingHealth': 'Pricing Health',
    'check.messages': 'Вхідні повідомлення',
    'check.customerReviews': 'Відгуки про товари',
    'check.fbaPerformance': 'Показники FBA',
    'check.cases': 'Звернення до підтримки',

    'check.col.sku': 'SKU',
    'check.col.title': 'Товар',
    'check.col.qty': 'К-сть',
    'check.col.reason': 'Причина',
    'check.col.was': 'Було',
    'check.col.now': 'Стало',
    'check.col.date': 'Дата',
    'check.col.rating': 'Оцінка',
    'check.col.comment': 'Коментар',
    'check.col.excess': 'Надлишки',
    'check.col.aged': 'Залежалося',
    'check.col.metric': 'Показник',
    'check.col.value': 'Значення',
    'check.col.target': 'Ціль',
    'check.col.state': 'Стан',
  },
});

/* ==========================================================================
   Раздел «Реклама».

   ACOS намеренно оставлен латиницей во всех трёх языках: в рекламном
   кабинете Amazon показатель называется именно так, и человек, который
   сверяет наши цифры с кабинетом, должен видеть то же слово.
   ========================================================================== */

extendDict({
  ru: {
    'nav.advertising': 'Реклама',

    'ads.fixture.title': 'Это не настоящие данные',
    'ads.fixture.text': 'В файле лежит заглушка для проверки вёрстки: числа выдуманы. Раздел нельзя публиковать, пока её не заменит выгрузка из Amazon Ads API.',

    'ads.title': 'Реклама',
    'ads.lead': 'Расходы на рекламу по месяцам и сравнение с тем же месяцем год назад.',
    'ads.loading': 'Загружаем расходы…',
    'ads.error': 'Не удалось загрузить данные о рекламе. Выгрузка либо ещё не собрана, либо недоступна.',
    'ads.empty': 'За выбранный период расходов не было.',

    'ads.kpi.total': 'Расходы за 12 месяцев',
    'ads.kpi.vsLastYear': '{delta} к прошлому году',
    'ads.kpi.noLastYear': 'сравнить не с чем',
    'ads.kpi.perMonth': 'В среднем за месяц',
    'ads.kpi.acos': 'ACOS за 12 месяцев',
    'ads.kpi.acosLastYear': 'год назад {value}',
    'ads.kpi.running': '{month} — идёт',
    'ads.kpi.runningNote': 'месяц не закончился, на графике его нет',

    'ads.series.now': 'Текущие 12 месяцев',
    'ads.series.past': 'Год назад',
    'ads.tooltip.delta': 'Разница',

    'ads.chart.spend': 'Расходы по месяцам',
    'ads.chart.spendSub': 'Каждый месяц рядом со своим прошлогодним двойником.',
    'ads.chart.spendAria': 'Столбчатый график расходов на рекламу по месяцам в сравнении с прошлым годом',
    'ads.chart.acos': 'ACOS по месяцам',
    'ads.chart.acosSub': 'Доля расходов в рекламной выручке. Отдельным графиком: у процентов и евро разные шкалы.',
    'ads.chart.acosAria': 'Линейный график ACOS по месяцам в сравнении с прошлым годом',
    'ads.chart.country': 'Расходы по площадкам',
    'ads.chart.countrySub': 'Сумма за двенадцать полных месяцев.',
    'ads.chart.countryAria': 'Расходы на рекламу по площадкам',
    'ads.country.unavailable': 'Разрез по площадкам этот отчёт Amazon не отдаёт: страна есть только у кампаний, не у сводки. Нужна отдельная выгрузка по кампаниям.',

    'ads.showTable': 'Показать таблицей',
    'ads.table.month': 'Месяц',
    'ads.table.spendNow': 'Расходы',
    'ads.table.spendPast': 'Год назад',
    'ads.table.delta': 'Разница',
    'ads.table.acosNow': 'ACOS',
    'ads.table.acosPast': 'ACOS год назад',

    'ads.note.generated': 'Данные собраны {at}.',
    'ads.note.currency': 'Площадки в GBP, SEK и PLN переведены в евро по курсу ЕЦБ на {date} — одним курсом для всех месяцев, чтобы в сравнении год к году не сидело движение валют. Это оценка: с выплатами Amazon она не совпадёт.',
    'ads.note.running': '{month} ещё идёт и в сравнение не входит.',
    'ads.note.gaps': 'За часть прошлогодних месяцев данных нет — в таблице у них прочерк.',
  },

  en: {
    'nav.advertising': 'Advertising',

    'ads.fixture.title': 'This is not real data',
    'ads.fixture.text': 'The file holds a fixture used to check the layout: the numbers are made up. This section must not be published until a real Amazon Ads API export replaces it.',

    'ads.title': 'Advertising',
    'ads.lead': 'Monthly ad spend and how each month compares with the same month a year ago.',
    'ads.loading': 'Loading spend…',
    'ads.error': 'Could not load advertising data. The export is either not collected yet or unavailable.',
    'ads.empty': 'No spend in the selected period.',

    'ads.kpi.total': 'Spend over 12 months',
    'ads.kpi.vsLastYear': '{delta} vs last year',
    'ads.kpi.noLastYear': 'nothing to compare with',
    'ads.kpi.perMonth': 'Monthly average',
    'ads.kpi.acos': 'ACOS over 12 months',
    'ads.kpi.acosLastYear': 'a year ago {value}',
    'ads.kpi.running': '{month} — in progress',
    'ads.kpi.runningNote': 'the month is not over; it is not on the chart',

    'ads.series.now': 'Current 12 months',
    'ads.series.past': 'A year ago',
    'ads.tooltip.delta': 'Difference',

    'ads.chart.spend': 'Spend by month',
    'ads.chart.spendSub': 'Each month next to its counterpart from last year.',
    'ads.chart.spendAria': 'Column chart of monthly ad spend compared with last year',
    'ads.chart.acos': 'ACOS by month',
    'ads.chart.acosSub': 'Share of spend in ad revenue. A separate chart: percentages and euros do not share a scale.',
    'ads.chart.acosAria': 'Line chart of monthly ACOS compared with last year',
    'ads.chart.country': 'Spend by marketplace',
    'ads.chart.countrySub': 'Total over twelve complete months.',
    'ads.chart.countryAria': 'Ad spend by marketplace',
    'ads.country.unavailable': 'This Amazon report does not break spend down by marketplace: country belongs to campaigns, not to the summary. A separate campaign-level export is needed.',

    'ads.showTable': 'Show as table',
    'ads.table.month': 'Month',
    'ads.table.spendNow': 'Spend',
    'ads.table.spendPast': 'Last year',
    'ads.table.delta': 'Difference',
    'ads.table.acosNow': 'ACOS',
    'ads.table.acosPast': 'ACOS last year',

    'ads.note.generated': 'Data collected {at}.',
    'ads.note.currency': 'Marketplaces in GBP, SEK and PLN were converted to euro at the ECB rate of {date} — one rate for every month, so that currency movement does not sit inside the year-on-year comparison. This is an estimate: it will not match Amazon payouts.',
    'ads.note.running': '{month} is still in progress and is left out of the comparison.',
    'ads.note.gaps': 'Some months of last year have no data — they show a dash in the table.',
  },

  uk: {
    'nav.advertising': 'Реклама',

    'ads.fixture.title': 'Це не справжні дані',
    'ads.fixture.text': 'У файлі лежить заглушка для перевірки верстки: числа вигадані. Розділ не можна публікувати, доки її не замінить вивантаження з Amazon Ads API.',

    'ads.title': 'Реклама',
    'ads.lead': 'Витрати на рекламу помісячно й порівняння з тим самим місяцем торік.',
    'ads.loading': 'Завантажуємо витрати…',
    'ads.error': 'Не вдалося завантажити дані про рекламу. Вивантаження або ще не зібране, або недоступне.',
    'ads.empty': 'За вибраний період витрат не було.',

    'ads.kpi.total': 'Витрати за 12 місяців',
    'ads.kpi.vsLastYear': '{delta} до торішнього',
    'ads.kpi.noLastYear': 'порівняти нема з чим',
    'ads.kpi.perMonth': 'У середньому за місяць',
    'ads.kpi.acos': 'ACOS за 12 місяців',
    'ads.kpi.acosLastYear': 'торік {value}',
    'ads.kpi.running': '{month} — триває',
    'ads.kpi.runningNote': 'місяць не закінчився, на графіку його немає',

    'ads.series.now': 'Поточні 12 місяців',
    'ads.series.past': 'Торік',
    'ads.tooltip.delta': 'Різниця',

    'ads.chart.spend': 'Витрати помісячно',
    'ads.chart.spendSub': 'Кожен місяць поряд зі своїм торішнім двійником.',
    'ads.chart.spendAria': 'Стовпчиковий графік витрат на рекламу помісячно проти торішніх',
    'ads.chart.acos': 'ACOS помісячно',
    'ads.chart.acosSub': 'Частка витрат у рекламній виручці. Окремим графіком: у відсотків і євро різні шкали.',
    'ads.chart.acosAria': 'Лінійний графік ACOS помісячно проти торішнього',
    'ads.chart.country': 'Витрати за площадками',
    'ads.chart.countrySub': 'Сума за дванадцять повних місяців.',
    'ads.chart.countryAria': 'Витрати на рекламу за площадками',
    'ads.country.unavailable': 'Розрізу за площадками цей звіт Amazon не дає: країна є лише в кампаній, а не у зведенні. Потрібне окреме вивантаження за кампаніями.',

    'ads.showTable': 'Показати таблицею',
    'ads.table.month': 'Місяць',
    'ads.table.spendNow': 'Витрати',
    'ads.table.spendPast': 'Торік',
    'ads.table.delta': 'Різниця',
    'ads.table.acosNow': 'ACOS',
    'ads.table.acosPast': 'ACOS торік',

    'ads.note.generated': 'Дані зібрано {at}.',
    'ads.note.currency': 'Площадки в GBP, SEK і PLN переведено в євро за курсом ЄЦБ на {date} — одним курсом для всіх місяців, щоб у порівнянні рік до року не сиділо валютне коливання. Це оцінка: з виплатами Amazon вона не збіжиться.',
    'ads.note.running': '{month} ще триває і в порівняння не входить.',
    'ads.note.gaps': 'За частину торішніх місяців даних немає — у таблиці в них прочерк.',
  },
});
