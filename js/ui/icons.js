// Inline SVG icons (24x24 viewBox, stroke/fill with currentColor).
import { h } from '../util.js';

const P = {
  play: 'M8 5.5v13l11-6.5z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  stop: 'M6.5 6.5h11v11h-11z',
  rec: 'M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12z',
  rewind: 'M6 5.5h2.2v13H6zM19 5.5v13L9.5 12z',
  loop: 'M17 2l4 4-4 4V7H6a2 2 0 0 0-2 2v2H2V9a4 4 0 0 1 4-4h11zM7 22l-4-4 4-4v3h11a2 2 0 0 0 2-2v-2h2v2a4 4 0 0 1-4 4H7z',
  metro: 'M9 3h6l3.5 17.5h-13zM12 17l4-9',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  scissors: 'M6 8a2.5 2.5 0 1 0 0-.01zM6 17a2.5 2.5 0 1 0 0-.01zM8 9l12 9M8 16L20 6',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  save: 'M5 4h12l3 3v13H5zM8 4v5h8V4M8 20v-6h8v6',
  folder: 'M3 6h6l2 2h10v11H3z',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  upload: 'M12 16V5M7 9l5-5 5 5M5 20h14',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 13a7.5 7.5 0 0 0 0-2l2-1.5-2-3.5-2.3.9a7.5 7.5 0 0 0-1.7-1L15 3.5h-4l-.4 2.4a7.5 7.5 0 0 0-1.7 1L6.6 6 4.6 9.5l2 1.5a7.5 7.5 0 0 0 0 2l-2 1.5 2 3.5 2.3-.9c.5.4 1.1.7 1.7 1l.4 2.4h4l.4-2.4c.6-.3 1.2-.6 1.7-1l2.3.9 2-3.5z',
  piano: 'M3 5h18v14H3zM8 5v14M13 5v14M18 5v14M6 5v8h4V5M11 5v8h4V5M16 5v8h4V5',
  drum: 'M4 9c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 9v7c0 1.7 3.6 3 8 3s8-1.3 8-3V9M8 3l3 5M16 3l-3 5',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4M9 21h6',
  wave: 'M2 12h3l2-6 3 12 3-9 2 5 2-2h5',
  guitar: 'M14 4l6 6-2 1-1 3-3 1-1 3a5 5 0 1 1-8-5l3-1 1-3 3-1zM15 9l-5 5',
  organ: 'M3 7h18v10H3zM7 7v10M11 7v10M15 7v10M19 7v10',
  mallet: 'M4 20l8-8M12 12l3-3a3 3 0 1 1 4 4l-3 3M8 4l2 4M14 3l-1 4M5 8l4-1',
  bass: 'M5 19L19 5M15 5l4 4M8 12l4 4',
  pad: 'M3 15c3-8 6-8 9 0s6 8 9 0',
  violin: 'M9 4h6l-1 4 2 3-1 4 1 5H8l1-5-1-4 2-3zM12 8v10',
  horn: 'M4 10h4l10-5v14L8 14H4zM8 14l1 5',
  voice: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM5 21c0-4 3-7 7-7s7 3 7 7',
  speaker: 'M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5 9-10',
  chevron: 'M8 10l4 4 4-4',
  chevronR: 'M10 8l4 4-4 4',
  mixer: 'M6 3v18M12 3v18M18 3v18M4 8h4M10 15h4M16 7h4',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  list: 'M5 7h14M5 12h14M5 17h14',
  note: 'M9 18V6l10-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM19 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z',
  arpeggio: 'M3 18l4-6 4 3 4-9 6 6',
  star: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.3 6L12 16.4 6.6 19.4l1.3-6L3.4 9.3l6-.7z',
  magic: 'M4 20L16 8M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 12l.7 1.3L21 14l-1.3.7L19 16l-.7-1.3L17 14l1.3-.7z',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  external: 'M10 5H5v14h14v-5M13 4h7v7M20 4L11 13',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.01',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  magnet: 'M5 4h4v8a3 3 0 0 0 6 0V4h4v8a7 7 0 0 1-14 0zM5 8h4M15 8h4',
};
const FILLED = new Set(['play', 'pause', 'stop', 'rec', 'rewind', 'star']);

export function icon(name, size = 18, extra = {}) {
  const d = P[name] || P.note;
  const fill = FILLED.has(name);
  return h('svg:svg', { viewBox: '0 0 24 24', width: size, height: size, class: 'ico ' + (extra.class || ''), fill: fill ? 'currentColor' : 'none', stroke: fill ? 'none' : 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
    h('svg:path', { d }));
}
export const hasIcon = (n) => !!P[n];
