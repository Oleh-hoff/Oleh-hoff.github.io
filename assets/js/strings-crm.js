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
