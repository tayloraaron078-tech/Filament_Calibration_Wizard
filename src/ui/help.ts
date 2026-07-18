import { h, clear } from './dom';
import { GLOSSARY } from '../data/glossary';
import { MODEL_MANIFEST } from '../data/models';
import { SLICER_CONTENT } from '../data/slicers';

export function renderHelp(root: HTMLElement, term?: string): void {
  const search = h('input', { type: 'text', placeholder: 'Search the glossary… (e.g. "pressure", "stringing")', value: term ?? '', 'aria-label': 'Search glossary' });
  const list = h('dl', {});

  const refresh = () => {
    clear(list);
    const q = search.value.trim().toLowerCase();
    const hits = GLOSSARY.filter(g =>
      !q || g.term.toLowerCase().includes(q) || g.definition.toLowerCase().includes(q));
    if (!hits.length) list.append(h('p', { class: 'field-help' }, 'No matches. Try a shorter word.'));
    for (const g of hits) {
      list.append(h('div', { class: 'glossary-item' },
        h('dt', {}, g.term),
        h('dd', {}, g.definition,
          g.related?.length ? h('p', { class: 'field-help' }, 'Related: ', g.related.join(' · ')) : null)));
    }
  };
  search.addEventListener('input', refresh);
  refresh();

  root.append(
    h('h1', {}, 'Help & glossary'),
    h('div', { class: 'card' },
      h('h2', { style: 'margin-top:0' }, 'How PerfectFit works'),
      h('p', {}, 'Each calibration project walks one spool through up to six calibration tests plus a final verification print. The wizard tells you exactly what to click in your slicer, how to judge the print, and does every calculation in the open — inputs, formula, result.'),
      h('p', {}, 'Your data never leaves this device: no account, no uploads, no analytics, no telemetry. Photos you attach are stored locally in your browser\'s storage. External model links open third-party sites in a new tab.'),
      h('p', {}, 'Recommended order and formulas follow the official Orca Slicer documentation; Bambu Studio paths are covered where its features differ. Sources: ',
        ...SLICER_CONTENT.map((s, i) => h('span', {}, i ? ' · ' : '', h('a', { href: s.docsUrl, target: '_blank', rel: 'noopener' }, `${s.slicerLabel} docs ↗`)))
      )
    ),
    h('div', { class: 'card' },
      h('h2', { style: 'margin-top:0' }, 'Glossary'),
      h('div', { class: 'field' }, search),
      list
    ),
    h('div', { class: 'card' },
      h('h2', { style: 'margin-top:0' }, 'Test models'),
      h('p', { class: 'field-help' }, 'Orca Slicer generates every core calibration test in-slicer — no downloads needed. These external models are optional helpers. Links open third-party sites; licenses belong to their authors.'),
      h('div', { class: 'table-scroll' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Use'), h('th', {}, 'Source'), h('th', {}, 'License'), h('th', {}, 'Attribution'))),
        h('tbody', {}, MODEL_MANIFEST.map(m => h('tr', {},
          h('td', {}, m.test, h('div', { class: 'field-help' }, m.recommendedUse)),
          h('td', {}, h('a', { href: m.sourceUrl, target: '_blank', rel: 'noopener' }, 'Link ↗'), m.bundled ? ' (bundled)' : ' (download)'),
          h('td', {}, m.license),
          h('td', {}, m.attribution))))
      ))
    )
  );
}
