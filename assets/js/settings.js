/* ==========================================================================
   Настройки: язык, часовой пояс, тема.

   Одна кнопка и одно окно на все страницы — вход, дашборд и логи. Раньше
   переключатели стояли прямо в вёрстке каждой страницы тремя копиями, и
   добавить к ним пояс значило бы завести четвёртую.

   Настройки применяются сразу, без кнопки «Сохранить»: все три меняют вид
   мгновенно и обратимы одним кликом, а лишний шаг подтверждения в такой
   ситуации только мешает.

   Второй вкладкой в то же окно въехали «Интеграции» — откуда дашборд берёт
   данные. Отдельным окном их делать не стали: шестерёнка в шапке одна, и
   человек ищет любые настройки за ней, а не за второй кнопкой рядом.
   Раздел живёт в settings-integrations.js целиком; здесь только вкладки.
   ========================================================================== */

import { t, getLang, setLang, onLangChange, applyTranslations, LANGS } from './i18n.js';
import { getMode as themeMode, setMode as setThemeMode, onThemeChange } from './theme.js';
import {
  getMode as zoneMode, setZone, listZones, onZoneChange, systemZone,
  offsetMinutes, formatOffset,
} from './timezone.js';
import { integrationsPanel } from './settings-integrations.js';

const SVG = 'http://www.w3.org/2000/svg';

/* Порядок языков — как их назвал пользователь. Подписи не переводятся:
   человек ищет свой язык на своём языке, а не на текущем. */
const LANG_LABELS = { uk: 'Українська', ru: 'Русский', en: 'English' };

/* Вкладка не запоминается: окно всегда открывается на «Общих». Язык, тема и
   пояс — то, за чем сюда приходят ежедневно; интеграции настраивают один раз,
   и открывать окно шириной 960 px со 178 контролами ради смены темы значило
   бы наказывать за один визит во вторую вкладку. */
const FIRST_TAB = 'general';

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') node.textContent = value;
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  children.forEach((child) => node.appendChild(child));
  return node;
}

function icon(path, { width = '1.7' } = {}) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const node = document.createElementNS(SVG, 'path');
  node.setAttribute('d', path);
  node.setAttribute('stroke', 'currentColor');
  node.setAttribute('stroke-width', width);
  node.setAttribute('stroke-linecap', 'round');
  node.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(node);
  return svg;
}

const GEAR = 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z'
  + 'M19.4 14.5a1.6 1.6 0 0 0 .32 1.77l.06.06a1.9 1.9 0 1 1-2.7 2.7l-.05-.06a1.6 1.6 0 0 0-1.78-.32'
  + '1.6 1.6 0 0 0-.97 1.47v.17a1.9 1.9 0 1 1-3.8 0v-.09a1.6 1.6 0 0 0-1.05-1.47 1.6 1.6 0 0 0-1.77.32'
  + 'l-.06.06a1.9 1.9 0 1 1-2.7-2.7l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-.97H3.5a1.9 1.9 0 0 1 0-3.8h.09'
  + 'a1.6 1.6 0 0 0 1.47-1.05 1.6 1.6 0 0 0-.32-1.77l-.06-.06a1.9 1.9 0 1 1 2.7-2.7l.06.06a1.6 1.6 0 0 0 1.77.32h.08'
  + 'A1.6 1.6 0 0 0 10.26 4.4v-.17a1.9 1.9 0 1 1 3.8 0v.09a1.6 1.6 0 0 0 .97 1.47 1.6 1.6 0 0 0 1.78-.32l.05-.06'
  + 'a1.9 1.9 0 1 1 2.7 2.7l-.06.06a1.6 1.6 0 0 0-.32 1.77v.08a1.6 1.6 0 0 0 1.47.97h.17a1.9 1.9 0 1 1 0 3.8h-.09'
  + 'a1.6 1.6 0 0 0-1.47.97Z';

/* --------------------------------------------------------------------------
   Группы настроек
   -------------------------------------------------------------------------- */

function segmentedGroup(labelText, options, isCurrent, onPick) {
  const group = el('div', { class: 'settings__group' });
  const label = el('div', { class: 'settings__label', text: labelText });
  const bar = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': labelText });

  const buttons = options.map(({ value, text }) => {
    const button = el('button', {
      type: 'button', class: 'segmented__item', role: 'radio', text,
      'aria-checked': String(isCurrent(value)),
    });
    button.addEventListener('click', () => { onPick(value); sync(); });
    bar.appendChild(button);
    return { value, button };
  });

  /* Roving tabindex: группа радиокнопок — одна остановка Tab, внутри
     перемещение стрелками. Без этого три кнопки языка были тремя остановками,
     а ArrowRight не делал ничего — и та же на вид полоса в соседней вкладке
     «Интеграции» вела себя по-другому. */
  const sync = () => buttons.forEach(({ value, button }) => {
    const on = isCurrent(value);
    button.setAttribute('aria-checked', String(on));
    button.tabIndex = on ? 0 : -1;
  });

  bar.addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = buttons.findIndex(({ button }) => button.tabIndex === 0);
    const next = buttons[((index < 0 ? 0 : index) + step + buttons.length) % buttons.length];
    next.button.click();
    next.button.focus();
  });

  sync();

  group.append(label, bar);
  return { node: group, sync };
}

function zoneGroup() {
  const group = el('div', { class: 'settings__group' });
  const label = el('div', { class: 'settings__label', text: t('settings.timezone') });

  const select = el('select', { class: 'select settings__select' });
  const hint = el('p', { class: 'settings__hint' });

  const fill = () => {
    const current = zoneMode();
    select.replaceChildren();

    // «Как в системе» первым: это значение по умолчанию и самый частый выбор
    select.appendChild(el('option', {
      value: 'system',
      text: t('settings.tzSystem', { zone: systemZone().replace(/_/g, ' ') }),
    }));

    for (const zone of listZones()) {
      select.appendChild(el('option', { value: zone.name, text: zone.label }));
    }
    select.value = current;
    if (!select.value) select.value = 'system';
  };

  const syncHint = () => {
    const offset = offsetMinutes(zoneMode() === 'system' ? systemZone() : zoneMode());
    hint.textContent = offset === null ? ''
      : t('settings.tzNow', {
        offset: formatOffset(offset),
        time: new Intl.DateTimeFormat(getLang(), {
          hour: '2-digit', minute: '2-digit',
          timeZone: zoneMode() === 'system' ? systemZone() : zoneMode(),
        }).format(new Date()),
      });
  };

  select.addEventListener('change', () => {
    if (!setZone(select.value)) fill();      // пояс не принят — возвращаем прежний
    syncHint();
  });

  fill();
  syncHint();
  group.append(label, select, hint);
  return { node: group, sync: () => { label.textContent = t('settings.timezone'); fill(); syncHint(); } };
}

/* --------------------------------------------------------------------------
   Сборка
   -------------------------------------------------------------------------- */

export function mountSettings(host) {
  const button = el('button', {
    type: 'button', class: 'btn btn--icon', id: 'settings-button',
    'aria-haspopup': 'dialog', 'aria-label': t('settings.title'), title: t('settings.title'),
  });
  button.appendChild(icon(GEAR));
  host.appendChild(button);

  const dialog = el('dialog', { class: 'settings-modal', 'aria-labelledby': 'set-title' });

  const header = el('div', { class: 'settings-modal__header' });
  const title = el('h2', {
    class: 'settings-modal__title', id: 'set-title', text: t('settings.title'),
  });
  const close = el('button', {
    type: 'button', class: 'btn btn--icon', 'aria-label': t('settings.close'),
  });
  close.appendChild(icon('M6 6l12 12M18 6L6 18', { width: '1.8' }));
  close.addEventListener('click', () => dialog.close());
  header.append(title, close);

  const body = el('div', { class: 'settings-modal__body' });

  /* --- Вкладка «Общие»: язык, пояс, тема --------------------------------- */

  const generalPanel = el('div', {
    class: 'settings-panel', id: 'set-panel-general',
    role: 'tabpanel', 'aria-labelledby': 'set-tab-general', tabindex: '0',
  });

  const language = segmentedGroup(
    t('settings.language'),
    // Порядок как назвал пользователь: украинский, русский, английский
    ['uk', 'ru', 'en'].filter((code) => LANGS.includes(code))
      .map((code) => ({ value: code, text: LANG_LABELS[code] || code })),
    (value) => getLang() === value,
    (value) => setLang(value),
  );

  const zone = zoneGroup();

  const theme = segmentedGroup(
    t('settings.theme'),
    [
      { value: 'light', text: t('theme.light') },
      { value: 'dark', text: t('theme.dark') },
      { value: 'system', text: t('theme.system') },
    ],
    (value) => themeMode() === value,
    (value) => setThemeMode(value),
  );

  generalPanel.append(language.node, zone.node, theme.node);

  /* --- Вкладка «Интеграции» ---------------------------------------------- */

  /* Собирается сразу вместе с окном, а не при первом открытии вкладки: это
     чистый DOM без единого запроса, а ленивая сборка сделала бы содержимое
     окна зависящим от того, заглядывал ли человек во вторую вкладку. */
  const integrations = integrationsPanel();

  const panels = { general: generalPanel, integrations: integrations.node };

  const tabs = el('div', {
    class: 'settings-modal__tabs', role: 'tablist',
    'data-i18n-attr': 'aria-label:int.tabs.aria',
  });

  const tabButtons = [
    { name: 'general', key: 'int.tab.general' },
    { name: 'integrations', key: 'int.tab.integrations' },
  ].map(({ name, key }) => {
    const tab = el('button', {
      type: 'button', class: 'settings-tab', id: `set-tab-${name}`,
      role: 'tab', 'aria-controls': `set-panel-${name}`,
      'data-tab': name, 'data-i18n': key, text: t(key),
    });
    tab.addEventListener('click', () => selectTab(name));
    tabs.appendChild(tab);
    return tab;
  });

  function selectTab(name) {
    const target = panels[name] ? name : FIRST_TAB;
    dialog.dataset.tab = target;
    /* Ширина переезжает классом, а не инлайновым стилем: инлайновый пришлось
       бы считать в JS и пересчитывать при повороте экрана, а так все размеры
       остаются в CSS вместе с медиазапросами. */
    dialog.classList.toggle('settings-modal--wide', target === 'integrations');
    for (const tab of tabButtons) {
      const on = tab.dataset.tab === target;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;        // roving tabindex: полоса — одна остановка Tab
      panels[tab.dataset.tab].hidden = !on;
    }
    body.scrollTop = 0;                  // новая вкладка начинается сверху, а не с середины
    /* Фокус переезжает здесь, а не в обработчике стрелок: после клика мышью
       он иначе оставался бы на прежней вкладке, у которой уже tabindex="-1"
       и aria-selected="false". Закрытое окно display:none — focus() там
       ничего не делает и никого не дёргает. */
    if (dialog.open) tabButtons.find((tab) => tab.dataset.tab === target)?.focus();
  }

  /* Стрелки внутри полосы — как у радиогруппы: иначе до содержимого пришлось
     бы добираться, протыкав Tab-ом каждую вкладку. */
  tabs.addEventListener('keydown', (event) => {
    const index = tabButtons.indexOf(event.target);
    if (index < 0) return;
    const last = tabButtons.length - 1;
    const next = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      ArrowDown: index === last ? 0 : index + 1,
      ArrowUp: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    selectTab(tabButtons[next].dataset.tab);
  });

  body.append(generalPanel, integrations.node);
  dialog.append(header, tabs, body);
  document.body.appendChild(dialog);
  selectTab(FIRST_TAB);

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  /* Секреты живут только в полях: окно закрылось — их больше нет нигде.
     Несохранённое дописывается до очистки; секретов в записи нет по
     построению (RULES.md §1.2), очистка полей — отдельный слой. */
  dialog.addEventListener('close', () => {
    integrations.flush();
    integrations.clearSecrets();
  });

  const open = () => {
    zone.sync();                 // время в подсказке успевает уйти между открытиями
    dialog.showModal();
    // Фокус на вкладке, а не на крестике: он называет, где человек оказался.
    // Ставит его selectTab — сначала окно, потом вкладка, иначе фокус ушёл бы
    // в закрытое (display:none) окно и никуда не встал
    selectTab(FIRST_TAB);
  };

  button.addEventListener('click', open);

  /* Подписи внутри окна собраны в JS и сами не обновятся: перерисовываем их
     на смене языка, иначе окно останется на прежнем до перезагрузки. */
  const retitle = () => {
    title.textContent = t('settings.title');
    button.setAttribute('aria-label', t('settings.title'));
    button.setAttribute('title', t('settings.title'));
    close.setAttribute('aria-label', t('settings.close'));
    language.node.querySelector('.settings__label').textContent = t('settings.language');
    theme.node.querySelector('.settings__label').textContent = t('settings.theme');
    [...theme.node.querySelectorAll('.segmented__item')].forEach((item, i) => {
      item.textContent = t(['theme.light', 'theme.dark', 'theme.system'][i]);
    });
    zone.sync();
    language.sync();
    theme.sync();
    // Вкладки размечены data-i18n — их переводит сам i18n, списком их держать не нужно
    applyTranslations(tabs);
    // Раздел интеграций переводит себя сам: полторы сотни подписей списком не выживут
    integrations.sync();
  };

  onLangChange(retitle);
  onThemeChange(() => theme.sync());
  onZoneChange(() => zone.sync());

  return { open, refresh: retitle };
}
