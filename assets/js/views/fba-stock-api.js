/* ==========================================================================
   Раздел «Дефицит FBA · данные SP-API».

   Та же инструкция, но без файла: каждое поле подписано вызовом, который его
   отдаёт. Смотрим на те же девять колонок с другой стороны — не «какую
   колонку заполнить», а «какой вызов сколько колонок закрывает». Иначе два
   раздела получились бы одной таблицей, показанной дважды.

   ПОЧЕМУ ОДНО ПОЛЕ ВСЁ РАВНО ОСТАЁТСЯ РУЧНЫМ
   Препцентр — склад третьей стороны (WM в Айхенцелле, WePrep в Стоумаркете).
   Amazon видит товар с момента, когда препцентр создал поставку на FBA, и не
   раньше. Пока коробки лежат у препцентра, для SP-API их не существует.
   Обещать здесь полную автоматику — значит обещать несуществующие данные.
   ========================================================================== */

import { t } from '../i18n.js';
import {
  FIELDS, EXTRA, SOURCES, MARKETS,
  el, statTile, panel, tableWrap, sourceTag, mono, steps, bullets, note,
} from '../fba-spec.js';

const FILTERS = ['all', 'auto', 'manual'];

/** Ручным считаем то, что человеку всё равно придётся ввести. */
const needsHand = (field) => field.kind === 'manual' || field.kind === 'partial';

/* --------------------------------------------------------------------------
   Раздел
   -------------------------------------------------------------------------- */

export const fbaStockApi = {
  titleKey: 'page.fbaStockApi.title',
  leadKey: 'page.fbaStockApi.lead',

  async mount(view, controls) {
    controls.replaceChildren();

    const state = { filter: 'all' };

    /* --- сводка ---------------------------------------------------------- */

    const hands = FIELDS.filter((f) => f.kind === 'manual').length;
    const noHands = FIELDS.length - hands;
    const coreSources = new Set(FIELDS.map((f) => f.source).filter(Boolean));
    const allSources = new Set([...coreSources, ...EXTRA.map((x) => x.source)]);

    const summary = el('section', { class: 'kpi-grid' }, [
      statTile(t('fba.api.kpi.auto'), `${noHands} / ${FIELDS.length}`,
        t('fba.api.kpi.autoNote'), true),
      statTile(t('fba.api.kpi.calls'), String(coreSources.size),
        t('fba.api.kpi.callsNote', { n: allSources.size - coreSources.size })),
      statTile(t('fba.api.kpi.limit'), '0.0167 rps', t('fba.api.kpi.limitNote')),
      statTile(t('fba.api.kpi.hand'), String(hands), t('fba.api.kpi.handNote')),
    ]);

    /* --- порядок сбора ---------------------------------------------------- */

    const orderPanel = panel(t('fba.api.order.title'), t('fba.api.order.lead'));
    orderPanel.appendChild(steps([1, 2, 3, 4, 5].map((n) => ({
      title: t(`fba.ap${n}`), text: t(`fba.ap${n}.d`),
    }))));
    orderPanel.appendChild(note(t('fba.api.order.note')));

    /* --- вызовы и лимиты --------------------------------------------------- */

    /* Таблица строится по источникам, а не по полям: так видно, что один
       отчёт закрывает сразу несколько колонок, и сколько вызовов стоит
       прогон на самом деле. */
    const callsBody = el('tbody');
    for (const [key, source] of Object.entries(SOURCES)) {
      const covered = [
        ...FIELDS.filter((f) => f.source === key).map((f) => f.id),
        ...EXTRA.filter((x) => x.source === key).map((x) => t(`fba.x.${x.id}`)),
      ];
      const list = el('div', { class: 'fba-ref' });
      covered.forEach((name) => list.appendChild(
        FIELDS.some((f) => f.id === name)
          ? mono(name)
          : el('span', { class: 'fba-ref__api', text: name }),
      ));

      callsBody.appendChild(el('tr', {}, [
        el('td', {}, [el('div', { class: 'fba-ref' }, [
          el('span', { class: 'fba-ref__api', text: source.name }),
          mono(source.ref),
        ])]),
        el('td', { text: t(`fba.call.${key}`) }),
        el('td', {}, [mono(source.rate)]),
        el('td', {}, [list]),
      ]));
    }
    const callsPanel = panel(t('fba.api.calls.title'), t('fba.api.calls.lead'));
    callsPanel.appendChild(tableWrap(el('table', { class: 'fba-table' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { scope: 'col', text: t('fba.th.call') }),
        el('th', { scope: 'col', text: t('fba.th.gives') }),
        el('th', { scope: 'col', text: t('fba.th.limit') }),
        el('th', { scope: 'col', text: t('fba.th.covers') }),
      ])]),
      callsBody,
    ])));
    callsPanel.appendChild(note(t('fba.api.calls.note')));

    /* --- замена: было руками, стало из API --------------------------------- */

    const swapPanel = panel(t('fba.api.swap.title'), t('fba.api.swap.lead'));
    const swapBody = el('tbody');
    const swapEmpty = el('p', { class: 'state', text: t('fba.format.empty') });

    const segmented = el('div', { class: 'segmented', role: 'group',
      'aria-label': t('fba.filter.label') });
    const buttons = FILTERS.map((id) => {
      const button = el('button', {
        type: 'button', class: 'segmented__item', text: t(`fba.filter.${id}`),
        'aria-pressed': String(state.filter === id),
      });
      button.addEventListener('click', () => { state.filter = id; paintSwap(); });
      segmented.appendChild(button);
      return { id, button };
    });
    controls.append(segmented);

    function paintSwap() {
      buttons.forEach(({ id, button }) =>
        button.setAttribute('aria-pressed', String(state.filter === id)));

      let rows = FIELDS;
      if (state.filter === 'auto') rows = FIELDS.filter((f) => !needsHand(f));
      if (state.filter === 'manual') rows = FIELDS.filter(needsHand);

      swapEmpty.hidden = rows.length > 0;
      swapBody.replaceChildren();

      for (const field of rows) {
        const now = el('div', { class: 'fba-ref' });
        now.appendChild(sourceTag(field.kind, t(`fba.src.${field.kind}`)));
        if (field.source) {
          now.appendChild(el('span', {
            class: 'fba-ref__api', text: SOURCES[field.source].name,
          }));
          now.appendChild(mono(field.ref));
        } else {
          now.appendChild(el('span', {
            class: 'fba-ref__api', text: t(`fba.f.${field.id}.note`),
          }));
        }

        swapBody.appendChild(el('tr', { 'data-kind': field.kind }, [
          el('td', {}, [mono(field.id)]),
          el('td', { text: t(`fba.f.${field.id}.was`) }),
          el('td', {}, [now]),
        ]));
      }
    }

    swapPanel.appendChild(tableWrap(el('table', { class: 'fba-table' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { scope: 'col', text: t('fba.th.column') }),
        el('th', { scope: 'col', text: t('fba.th.was') }),
        el('th', { scope: 'col', text: t('fba.th.now') }),
      ])]),
      swapBody,
    ])));
    swapPanel.appendChild(swapEmpty);
    paintSwap();

    /* --- что остаётся вручную ---------------------------------------------- */

    const handPanel = panel(t('fba.api.hand.title'), t('fba.api.hand.lead'));
    handPanel.appendChild(bullets([1, 2, 3, 4, 5].map((n) => ({
      title: t(`fba.hand${n}`), text: t(`fba.hand${n}.d`),
    }))));
    handPanel.appendChild(note(t('fba.api.hand.note')));

    /* --- подвохи ------------------------------------------------------------ */

    const trapPanel = panel(t('fba.api.trap.title'), t('fba.api.trap.lead'));
    trapPanel.appendChild(bullets([1, 2, 3, 4, 5, 6].map((n) => ({
      title: t(`fba.trap${n}`), text: t(`fba.trap${n}.d`),
    }))));

    /* --- чем отличается от файла --------------------------------------------- */

    const diffPanel = panel(t('fba.api.diff.title'), t('fba.api.diff.lead'));
    const diffBody = el('tbody');
    for (const key of ['freshness', 'effort', 'coverage', 'errors', 'markets']) {
      diffBody.appendChild(el('tr', {}, [
        el('td', { text: t(`fba.diff.${key}`) }),
        el('td', { text: t(`fba.diff.${key}.file`) }),
        el('td', { text: t(`fba.diff.${key}.api`) }),
      ]));
    }
    diffPanel.appendChild(tableWrap(el('table', { class: 'fba-table' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { scope: 'col', text: t('fba.th.param') }),
        el('th', { scope: 'col', text: t('fba.th.file') }),
        el('th', { scope: 'col', text: t('fba.th.api') }),
      ])]),
      diffBody,
    ])));
    diffPanel.appendChild(note(t('fba.api.diff.note', {
      de: MARKETS[0].marketplaceId, uk: MARKETS[1].marketplaceId,
    })));

    view.replaceChildren(
      summary,
      el('div', { class: 'panels' }, [
        orderPanel, callsPanel, swapPanel, handPanel, trapPanel, diffPanel,
      ]),
    );

    return () => {};
  },
};
