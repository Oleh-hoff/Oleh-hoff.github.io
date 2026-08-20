/* ==========================================================================
   Раздел «Дефицит FBA · выгрузка вручную».

   Инструкция к пульту дефицита, который принимает файл. Отличие от исходной
   версии инструкции одно, но существенное: у каждой колонки подписан её
   источник в SP-API. Человек, готовящий файл, должен видеть, какие числа
   он переписывает из кабинета зря — их отдаёт API.

   ПОЧЕМУ ИСТОЧНИК ПОКАЗАН ДАЖЕ У ТОГО, ЧЕГО В API НЕТ
   Спрятать строку «остаток на препцентре» значило бы создать впечатление,
   что файл собирается автоматически целиком. Он не собирается: препцентр —
   склад третьей стороны, Amazon о нём не знает. Это правило раздела
   «Проверка аккаунта»: недоступное показывать с причиной, а не прятать.
   ========================================================================== */

import { t } from '../i18n.js';
import {
  FIELDS, EXTRA, SOURCES, MARKETS, CSV_SAMPLE,
  el, statTile, panel, tableWrap, sourceTag, mono, steps, bullets, note,
} from '../fba-spec.js';

/* Порядок кнопок фильтра = порядок вопросов, которые задаёт человек:
   «покажи всё» → «что можно не вводить» → «что придётся вводить». */
const FILTERS = ['all', 'auto', 'manual'];

/** Автоматическими считаем те, что приходят из API готовыми. */
const isAuto = (field) => field.kind === 'api';

/* --------------------------------------------------------------------------
   Ячейка источника
   -------------------------------------------------------------------------- */

function sourceCell(field) {
  const cell = el('div', { class: 'fba-ref' });
  cell.appendChild(sourceTag(field.kind, t(`fba.src.${field.kind}`)));

  if (field.source) {
    const source = SOURCES[field.source];
    cell.appendChild(el('span', { class: 'fba-ref__api', text: `${source.name} · ${source.ref}` }));
    cell.appendChild(mono(field.ref));
  } else {
    cell.appendChild(el('span', { class: 'fba-ref__api', text: t(`fba.f.${field.id}.note`) }));
  }
  return cell;
}

/* --------------------------------------------------------------------------
   Раздел
   -------------------------------------------------------------------------- */

export const fbaStock = {
  titleKey: 'page.fbaStock.title',
  leadKey: 'page.fbaStock.lead',

  async mount(view, controls) {
    controls.replaceChildren();

    const state = { filter: 'all' };

    /* --- сводка ---------------------------------------------------------- */

    const auto = FIELDS.filter(isAuto).length;
    const partial = FIELDS.filter((f) => f.kind === 'partial').length;
    const derived = FIELDS.filter((f) => f.kind === 'derived').length;
    const manual = FIELDS.filter((f) => f.kind === 'manual').length;

    const summary = el('section', { class: 'kpi-grid' }, [
      statTile(t('fba.kpi.columns'), String(FIELDS.length),
        t('fba.kpi.columnsNote', { n: FIELDS.filter((f) => f.required).length })),
      statTile(t('fba.kpi.fromApi'), `${auto} / ${FIELDS.length}`,
        t('fba.kpi.fromApiNote', { partial, derived }), true),
      statTile(t('fba.kpi.byHand'), String(manual), t('fba.kpi.byHandNote')),
      statTile(t('fba.kpi.beyond'), String(EXTRA.length), t('fba.kpi.beyondNote')),
    ]);

    /* --- фильтр таблицы -------------------------------------------------- */

    const segmented = el('div', { class: 'segmented', role: 'group',
      'aria-label': t('fba.filter.label') });
    const buttons = FILTERS.map((id) => {
      const button = el('button', {
        type: 'button', class: 'segmented__item', text: t(`fba.filter.${id}`),
        'aria-pressed': String(state.filter === id),
      });
      button.addEventListener('click', () => { state.filter = id; paintFields(); });
      segmented.appendChild(button);
      return { id, button };
    });
    controls.append(segmented);

    /* --- таблица колонок -------------------------------------------------- */

    const fieldsPanel = panel(t('fba.format.title'), t('fba.format.lead'));
    const fieldsBody = el('tbody');
    const fieldsTable = el('table', { class: 'fba-table' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { scope: 'col', text: t('fba.th.column') }),
        el('th', { scope: 'col', text: t('fba.th.what') }),
        el('th', { scope: 'col', text: t('fba.th.example') }),
        el('th', { scope: 'col', text: t('fba.th.source') }),
      ])]),
      fieldsBody,
    ]);
    const empty = el('p', { class: 'state', text: t('fba.format.empty') });
    fieldsPanel.append(tableWrap(fieldsTable), empty);

    function visibleFields() {
      if (state.filter === 'auto') return FIELDS.filter(isAuto);
      if (state.filter === 'manual') return FIELDS.filter((f) => !isAuto(f));
      return FIELDS;
    }

    function paintFields() {
      buttons.forEach(({ id, button }) =>
        button.setAttribute('aria-pressed', String(state.filter === id)));

      const rows = visibleFields();
      empty.hidden = rows.length > 0;
      fieldsBody.replaceChildren();

      for (const field of rows) {
        const name = el('td', {}, [mono(field.id)]);
        name.appendChild(el('span', {
          class: 'fba-tag fba-tag--req',
          text: t(field.required ? 'fba.req.yes' : 'fba.req.no'),
        }));

        fieldsBody.appendChild(el('tr', { 'data-kind': field.kind }, [
          name,
          el('td', { text: t(`fba.f.${field.id}.what`) }),
          el('td', {}, [mono(field.example)]),
          el('td', {}, [sourceCell(field)]),
        ]));
      }
    }
    paintFields();

    const sample = el('pre', { class: 'fba-code' }, [el('code', { text: CSV_SAMPLE })]);
    fieldsPanel.append(
      el('h3', { class: 'fba-step__title', text: t('fba.format.sample') }),
      sample,
      note(t('fba.format.note')),
    );

    /* --- что ещё отдаёт SP-API -------------------------------------------- */

    const extraPanel = panel(t('fba.extra.title'), t('fba.extra.lead'));
    const extraBody = el('tbody');
    for (const item of EXTRA) {
      const source = SOURCES[item.source];
      extraBody.appendChild(el('tr', {}, [
        el('td', { text: t(`fba.x.${item.id}`) }),
        el('td', { text: t(`fba.x.${item.id}.why`) }),
        el('td', {}, [el('div', { class: 'fba-ref' }, [
          el('span', { class: 'fba-ref__api', text: source.name }),
          mono(source.ref),
          mono(item.ref),
        ])]),
      ]));
    }
    extraPanel.appendChild(tableWrap(el('table', { class: 'fba-table' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { scope: 'col', text: t('fba.th.metric') }),
        el('th', { scope: 'col', text: t('fba.th.why') }),
        el('th', { scope: 'col', text: t('fba.th.source') }),
      ])]),
      extraBody,
    ])));
    extraPanel.appendChild(note(t('fba.extra.note')));

    /* --- как загрузить ---------------------------------------------------- */

    const loadPanel = panel(t('fba.load.title'), t('fba.load.lead'));
    loadPanel.appendChild(steps([1, 2, 3, 4].map((n) => ({
      title: t(`fba.st${n}`), text: t(`fba.st${n}.d`),
    }))));
    loadPanel.appendChild(note(t('fba.load.privacy'), 'note'));

    /* --- как читать -------------------------------------------------------- */

    const readPanel = panel(t('fba.read.title'), t('fba.read.lead'));
    const legend = el('div', { class: 'fba-legend' });
    for (const tone of ['crit', 'warn', 'watch', 'ok']) {
      legend.appendChild(el('div', { class: 'fba-legend__row' }, [
        el('div', { class: 'fba-legend__bar', 'data-tone': tone }),
        el('div', {}, [
          el('div', { class: 'fba-legend__title', text: t(`fba.lg.${tone}`) }),
          el('div', { class: 'fba-legend__text', text: t(`fba.lg.${tone}.d`) }),
        ]),
      ]));
    }
    readPanel.appendChild(legend);
    readPanel.appendChild(el('h3', { class: 'fba-step__title', text: t('fba.read.controls') }));
    readPanel.appendChild(bullets([1, 2, 3, 4].map((n) => ({
      title: t(`fba.ctl${n}`), text: t(`fba.ctl${n}.d`),
    }))));

    /* --- методология ------------------------------------------------------- */

    const methodPanel = panel(t('fba.method.title'), t('fba.method.lead'));
    methodPanel.appendChild(bullets([
      { title: t('fba.m.stock'), text: t('fba.m.stock.d') },
      { title: t('fba.m.fbaLevel'), text: t('fba.m.fbaLevel.d') },
      { title: t('fba.m.prepLevel'), text: t('fba.m.prepLevel.d') },
      { title: t('fba.m.runrate'), text: t('fba.m.runrate.d') },
      { title: t('fba.m.direct'), text: t('fba.m.direct.d') },
      { title: t('fba.m.prepChannel'), text: t('fba.m.prepChannel.d') },
    ]));
    methodPanel.appendChild(note(t('fba.m.lead')));

    /* --- рынки -------------------------------------------------------------- */

    const marketPanel = panel(t('fba.markets.title'), t('fba.markets.lead'));
    const marketBody = el('tbody');
    const ROWS = [
      ['prep', 'WM / Eichenzell', 'WePrep Stowmarket'],
      ['kast', t('fba.mk.kastDE'), t('fba.mk.kastUK')],
      ['cont', t('fba.mk.contDE'), t('fba.mk.contUK')],
      ['sales', 'amazon.de', 'amazon.co.uk'],
      ['id', MARKETS[0].marketplaceId, MARKETS[1].marketplaceId],
    ];
    for (const [key, de, uk] of ROWS) {
      marketBody.appendChild(el('tr', {}, [
        el('td', { text: t(`fba.mk.${key}`) }),
        el('td', {}, key === 'id' ? [mono(de)] : [document.createTextNode(de)]),
        el('td', {}, key === 'id' ? [mono(uk)] : [document.createTextNode(uk)]),
      ]));
    }
    marketPanel.appendChild(tableWrap(el('table', { class: 'fba-table' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { scope: 'col', text: t('fba.th.param') }),
        el('th', { scope: 'col', text: `${MARKETS[0].flag} ${MARKETS[0].id}` }),
        el('th', { scope: 'col', text: `${MARKETS[1].flag} ${MARKETS[1].id}` }),
      ])]),
      marketBody,
    ])));
    marketPanel.appendChild(note(t('fba.mk.note')));

    /* --- вопросы ------------------------------------------------------------ */

    const faqPanel = panel(t('fba.faq.title'), t('fba.faq.lead'));
    const faq = el('div', { class: 'fba-faq' });
    for (const n of [1, 2, 3, 4]) {
      const item = el('details');
      item.appendChild(el('summary', { text: t(`fba.q${n}`) }));
      item.appendChild(el('p', { text: t(`fba.a${n}`) }));
      faq.appendChild(item);
    }
    faqPanel.appendChild(faq);

    view.replaceChildren(
      summary,
      el('div', { class: 'panels' }, [
        fieldsPanel, extraPanel, loadPanel, readPanel, methodPanel, marketPanel, faqPanel,
      ]),
    );

    return () => {};
  },
};
