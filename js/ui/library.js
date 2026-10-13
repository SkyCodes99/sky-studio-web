// Right panel: the loop library (searchable, draggable, auditionable) and the user's own sample folders.
import { h } from '../util.js';
import { icon } from './icons.js';
import { button, iconBtn, showMenu, toast } from './widgets.js';
import { LOOPS, LOOP_CATS, LOOP_GENRES, LOOP_BY_ID } from '../library/loops.js';
import { auditionLoop, auditionSample } from './preview.js';
import { host } from '../host.js';
import { NOTE_NAMES } from '../theory.js';
import { KIT_BY_ID } from '../audio/drums.js';
import { INST_BY_ID } from '../audio/instruments.js';
import { showLoopBuilder } from './loopbuilder.js';
import { trackFromSample } from './dialogs.js';
import { makeDraggable } from './dragdrop.js';

const CAT_ICON = { Drums: 'drum', Chords: 'piano', Bass: 'bass', Arp: 'arpeggio', Melody: 'note' };

export function mountLibrary(app, root) {
  root.replaceChildren();
  const tabs = h('div', { class: 'tabs' });
  const body = h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } });
  root.append(tabs, body);
  const F = { q: '', cat: 'All', genre: 'All', mood: 'All' };
  let playingId = null;
  const playBtns = new Map();

  function render() {
    tabs.replaceChildren(
      h('button', { class: 'tab' + (app.view.rightTab === 'loops' ? ' on' : ''), onClick: () => { app.view.rightTab = 'loops'; render(); } }, icon('note', 15), 'Loops'),
      h('button', { class: 'tab' + (app.view.rightTab === 'samples' ? ' on' : ''), onClick: () => { app.view.rightTab = 'samples'; render(); } }, icon('folder', 15), 'My samples'));
    body.replaceChildren();
    if (app.view.rightTab === 'samples') renderSamples(); else renderLoops();
  }

  // ------------------------------------------------------------ loops
  const CAT_ORDER = Object.fromEntries(LOOP_CATS.map((c, i) => [c, i]));
  const SORTED = LOOPS.map((l, i) => [l, i]).sort((x, y) => (CAT_ORDER[x[0].cat] - CAT_ORDER[y[0].cat]) || (x[1] - y[1])).map((x) => x[0]);   // by category, hand-made loops first
  const MOODS_LIST = ['Chill', 'Energetic', 'Dark', 'Uplifting', 'Cinematic'];
  const PAGE = 90;
  let shown = 0, matches = [], countEl = null;
  const favs = () => new Set(app.settings.favLoops || []);
  const mine = () => app.settings.userLoops || [];

  function renderLoops() {
    const search = h('div', { class: 'search' }, icon('search', 15), h('input', { placeholder: `Search ${LOOPS.length.toLocaleString()} loops…`, value: F.q, onInput: (e) => { F.q = e.target.value; drawList(); }, onKeyDown: (e) => e.stopPropagation() }));
    const chips = h('div', { class: 'chips' }, ['All', ...LOOP_CATS, '★ Favorites', 'Mine'].map((c) => h('button', { class: 'chip' + (F.cat === c ? ' on' : ''), onClick: () => { F.cat = c; render(); } }, c)));
    const genre = h('select', { class: 'sel', style: { flex: 1, minWidth: 0 }, onChange: (e) => { F.genre = e.target.value; drawList(); } }, [h('option', { value: 'All' }, 'All styles'), ...LOOP_GENRES.map((g) => h('option', { value: g, selected: F.genre === g }, g))]);
    const mood = h('select', { class: 'sel', style: { width: '104px' }, onChange: (e) => { F.mood = e.target.value; drawList(); } }, [h('option', { value: 'All' }, 'Any mood'), ...MOODS_LIST.map((m) => h('option', { value: m, selected: F.mood === m }, m))]);
    const P = app.project;
    const keyInfo = h('div', { class: 'hint', style: { padding: '0 12px 6px', display: 'flex', alignItems: 'center', gap: '6px' } }, icon('magic', 14), `Loops follow your key: ${NOTE_NAMES[P.key]} ${P.scale}`);
    countEl = h('span', { class: 'hint', style: { marginLeft: 'auto' } }, '');
    body.append(h('div', { style: { padding: '12px 12px 6px', display: 'grid', gap: '8px' } }, search, chips, h('div', { class: 'row', style: { gap: '6px' } }, genre, mood),
      h('div', { class: 'row', style: { gap: '8px' } }, button('Build a loop…', () => showLoopBuilder(app), { icon: 'magic', class: 'sm primary', title: 'Make your own drum, chord, bass, arpeggio or melody loop' }), countEl)), keyInfo);
    list = h('div', { class: 'panel-body', onScroll: () => { if (shown < matches.length && list.scrollTop + list.clientHeight > list.scrollHeight - 500) addMore(); } });
    body.append(list);
    drawList();
  }
  let list;
  function drawList() {
    list.replaceChildren(); playBtns.clear();
    const q = F.q.trim().toLowerCase();
    const terms = q ? q.split(/\s+/) : [];
    const fav = favs();
    const source = F.cat === 'Mine' ? mine() : F.cat === '★ Favorites' ? [...mine(), ...SORTED].filter((l) => fav.has(l.id)) : [...mine(), ...SORTED];
    matches = [];
    for (const l of source) {
      if (LOOP_CATS.includes(F.cat) && l.cat !== F.cat) continue;
      if (F.genre !== 'All' && l.genre !== F.genre && !(l.tags || []).includes(F.genre)) continue;
      if (F.mood !== 'All' && !(l.mood || []).includes(F.mood)) continue;
      if (terms.length) {
        const hay = (l.name + ' ' + l.genre + ' ' + l.cat + ' ' + (l.tags || []).join(' ') + ' ' + (l.inst ? (INST_BY_ID[l.inst] ? INST_BY_ID[l.inst].name : l.inst) : '') + ' ' + (l.kit || '')).toLowerCase();
        if (!terms.every((t) => hay.includes(t))) continue;
      }
      matches.push(l);
    }
    shown = 0; lastCat = null;
    if (countEl) countEl.textContent = matches.length.toLocaleString() + ' loop' + (matches.length === 1 ? '' : 's');
    if (!matches.length) { list.append(h('div', { class: 'empty' }, h('b', {}, F.cat === 'Mine' ? 'No loops of your own yet' : F.cat === '★ Favorites' ? 'No favourites yet' : 'No loops found'),
      F.cat === 'Mine' ? 'Use “Build a loop…” and press Save.' : F.cat === '★ Favorites' ? 'Click the ☆ on a loop to keep it here.' : 'Try a different word or style.')); return; }
    addMore();
  }
  let lastCat = null;
  function addMore() {
    const frag = document.createDocumentFragment();
    const end = Math.min(matches.length, shown + PAGE);
    for (; shown < end; shown++) {
      const l = matches[shown];
      if (F.cat === 'All' && l.cat !== lastCat) { frag.append(h('div', { class: 'cat-head' }, l.cat)); lastCat = l.cat; }
      frag.append(loopRow(l));
    }
    list.append(frag);
    // the pane may be tall enough to show more than one page: keep going until the list is scrollable
    if (shown < matches.length && list.scrollHeight <= list.clientHeight + 50) addMore();
  }
  function loopRow(l) {
    const pb = h('button', { class: 'playbtn' + (playingId === l.id ? ' on' : ''), title: 'Preview', onClick: (e) => { e.stopPropagation(); toggle(l); } }, icon(playingId === l.id ? 'stop' : 'play', 12));
    playBtns.set(l.id, pb);
    const row = h('div', { class: 'list-item', title: 'Click to hear • double-click or drag onto the timeline',
      onClick: () => { if (app.settings.autoPreview) toggle(l, true); },
      onDblclick: () => { app.engine.previewStopAll(); app.addLoop(l); } },
      pb, h('div', { class: 'li-main' }, h('div', { class: 'li-n' }, l.name), h('div', { class: 'li-s' }, `${l.genre} · ${l.bars} bar${l.bars > 1 ? 's' : ''}${l.bpm ? ' · ' + l.bpm + ' bpm' : ''}${l.kit && KIT_BY_ID[l.kit] ? ' · ' + KIT_BY_ID[l.kit].name : ''}${l.inst && INST_BY_ID[l.inst] ? ' · ' + INST_BY_ID[l.inst].name : ''}`)),
      h('button', { class: 'star' + (favs().has(l.id) ? ' on' : ''), title: 'Favourite', onClick: (e) => { e.stopPropagation(); toggleFav(l, e.currentTarget); } }, favs().has(l.id) ? '★' : '☆'),
      iconBtn('plus', 'Add to the song', (e) => { e.stopPropagation(); app.engine.previewStopAll(); app.addLoop(l); }, 'sm', 15));
    makeDraggable(app, row, () => ({ type: 'loop', id: l.id }), () => l.name);
    return row;
  }
  function toggleFav(l, btn) {
    const set = favs();
    if (set.has(l.id)) set.delete(l.id); else set.add(l.id);
    app.settings.favLoops = [...set]; app.saveSettings();
    btn.classList.toggle('on', set.has(l.id)); btn.textContent = set.has(l.id) ? '★' : '☆';
    if (F.cat === '★ Favorites') drawList();
  }
  app.on('loopsChanged', () => { if (app.view.rightTab === 'loops') drawList(); });
  function toggle(l, forcePlay) {
    if (playingId === l.id && !forcePlay) { app.engine.previewStopAll(); return; }
    playingId = l.id; markPlaying();
    auditionLoop(app, l);
  }
  function markPlaying() {
    for (const [id, b] of playBtns) { const on = id === playingId; b.classList.toggle('on', on); b.replaceChildren(icon(on ? 'stop' : 'play', 12)); }
  }
  app.engine.on('preview', (on) => { if (!on) { playingId = null; sampleOn = null; markPlaying(); markSamples(); } });

  // ------------------------------------------------------------ samples
  const cache = new Map();   // folder -> files
  let sampleQ = '', sampleOn = null; const sampleRows = new Map();
  function renderSamples() {
    const folders = app.settings.sampleFolders || [];
    const search = h('div', { class: 'search' }, icon('search', 15), h('input', { placeholder: 'Search your samples…', value: sampleQ, onInput: (e) => { sampleQ = e.target.value; drawSamples(); }, onKeyDown: (e) => e.stopPropagation() }));
    body.append(h('div', { style: { padding: '12px', display: 'grid', gap: '8px' } }, search,
      h('div', { class: 'row wrap' },
        button('Add folder', async () => { const f = await host.pickFolder('Choose a folder of samples'); if (f) { app.settings.sampleFolders = [...new Set([...folders, f])]; app.saveSettings(); cache.delete(f); render(); } }, { icon: 'plus', class: 'sm' }),
        button('Import file', async () => { const f = await host.openDialog({ title: 'Import audio', filter: 'Audio files (*.wav *.mp3 *.ogg *.flac *.m4a *.aif *.aiff)', multiple: true }); if (f.length) app.importAudio(f.map((x) => (typeof x === 'string' ? { path: x, name: x.split(/[\\/]/).pop() } : x))); }, { icon: 'upload', class: 'sm' }),
        button('Sampler track', () => trackFromSample(app), { icon: 'wave', class: 'sm', title: 'Turn a sample into a playable instrument' }))));
    samplesList = h('div', { class: 'panel-body' });
    body.append(samplesList);
    if (!host.native) { samplesList.append(h('div', { class: 'empty' }, h('b', {}, 'Folders are available in the desktop app'), 'You can still use Import file to bring audio in.')); return; }
    if (!folders.length) { samplesList.append(h('div', { class: 'empty' }, h('b', {}, 'Your own sounds, right here'), 'Add a folder full of drum hits, loops or vocals. Click to hear them, double-click or drag to put them on the timeline.')); return; }
    drawSamples();
  }
  let samplesList;
  async function drawSamples() {
    const folders = app.settings.sampleFolders || [];
    samplesList.replaceChildren(); sampleRows.clear();
    const q = sampleQ.trim().toLowerCase();
    for (const f of folders) {
      if (!cache.has(f)) cache.set(f, host.listAudio(f));
      const head = h('div', { class: 'cat-head', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } }, h('span', { title: f }, f.split(/[\\/]/).filter(Boolean).pop() || f),
        iconBtn('close', 'Remove this folder', () => { app.settings.sampleFolders = folders.filter((x) => x !== f); app.saveSettings(); render(); }, 'sm', 13));
      samplesList.append(head);
      const holder = h('div', {}, h('div', { class: 'hint', style: { padding: '6px 14px' } }, 'Scanning…'));
      samplesList.append(holder);
      cache.get(f).then((files) => {
        holder.replaceChildren();
        const shown = files.filter((x) => !q || x.rel.toLowerCase().includes(q)).slice(0, 600);
        if (!shown.length) holder.append(h('div', { class: 'hint', style: { padding: '6px 14px' } }, files.length ? 'No matches' : 'No audio files found here'));
        for (const it of shown) holder.append(sampleRow(it));
        if (files.length > shown.length && !q) holder.append(h('div', { class: 'hint', style: { padding: '6px 14px' } }, `Showing the first ${shown.length} of ${files.length} — use search to narrow.`));
      });
    }
  }
  function sampleRow(it) {
    const pb = h('button', { class: 'playbtn', onClick: (e) => { e.stopPropagation(); playSample(it); } }, icon('play', 12));
    sampleRows.set(it.path, pb);
    const row = h('div', { class: 'list-item', title: it.rel,
      onClick: () => playSample(it, true), onDblclick: () => { app.engine.previewStopAll(); app.importAudio([it]); } },
      pb, h('div', { class: 'li-main' }, h('div', { class: 'li-n' }, it.name.replace(/\.[^.]+$/, '')), h('div', { class: 'li-s' }, /[\\/]/.test(it.rel) ? it.rel.replace(/[\\/][^\\/]+$/, '') : (it.size / 1024 | 0) + ' KB')),
      iconBtn('plus', 'Add to the timeline', (e) => { e.stopPropagation(); app.importAudio([it]); }, 'sm', 15));
    makeDraggable(app, row, () => ({ type: 'sample', item: { path: it.path, name: it.name } }), () => it.name);
    return row;
  }
  function playSample(it, force) {
    if (sampleOn === it.path && !force) { app.engine.previewStopAll(); return; }
    sampleOn = it.path; markSamples();
    auditionSample(app, it).catch(() => { toast('Could not play that file', 'error'); sampleOn = null; markSamples(); });
  }
  function markSamples() { for (const [p, b] of sampleRows) { const on = p === sampleOn; b.classList.toggle('on', on); b.replaceChildren(icon(on ? 'stop' : 'play', 12)); } }

  app.on('samples', () => { cache.clear(); if (app.view.rightTab === 'samples') render(); });
  app.on('change', (k) => { if (k === 'meta' && app.view.rightTab === 'loops') { /* key line */ const kl = body.querySelector('.hint'); if (kl) kl.lastChild.textContent = `Loops follow your key: ${NOTE_NAMES[app.project.key]} ${app.project.scale}`; } if (k === 'load' && app.view.rightTab === 'loops') render(); });
  render();
}
