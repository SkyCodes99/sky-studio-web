// Top bar: file menu, transport, LCD (position / tempo / key / time signature), master volume, panel toggles.
import { h, clamp } from '../util.js';
import { icon } from './icons.js';
import { iconBtn, showMenu } from './widgets.js';
import { NOTE_NAMES, SCALE_NAMES } from '../theory.js';
import { STARTERS } from '../library/loops.js';
import { showExport, showSettings, showStarters, showAbout, showShortcuts, promptText } from './dialogs.js';
import { showPlugins } from './plugins.js';
import { fmtTime } from '../util.js';

export function mountTopbar(app, root) {
  const nameInput = h('input', { class: 'proj-name', value: app.project.name, spellcheck: false, title: 'Rename project',
    onChange: (e) => app.setName(e.target.value.trim()), onKeyDown: (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); } });

  const fileBtn = h('button', { class: 'btn', onClick: (e) => fileMenu(e) }, icon('file', 15), h('span', {}, 'File'));
  const undoBtn = iconBtn('undo', 'Undo (Ctrl+Z)', () => app.undo());
  const redoBtn = iconBtn('redo', 'Redo (Ctrl+Y)', () => app.redo());

  function fileMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const items = [
      { label: 'New project', icon: 'file', hint: 'Ctrl+N', onClick: () => app.newProject() },
      { label: 'New from a song starter…', icon: 'magic', onClick: () => showStarters(app) },
      { label: 'Open…', icon: 'folder', hint: 'Ctrl+O', onClick: () => app.openProject() },
      { label: 'Save', icon: 'save', hint: 'Ctrl+S', onClick: () => app.saveProject() },
      { label: 'Save as…', hint: 'Ctrl+Shift+S', onClick: () => app.saveProject(true) },
      { label: 'Rename song…', onClick: async () => { const n = await promptText('Song name', app.project.name); if (n && n.trim()) app.setName(n.trim()); } },
      { sep: true },
      { label: 'Import audio file…', icon: 'upload', onClick: async () => { const f = await (await import('../host.js')).host.openDialog({ title: 'Import audio', filter: 'Audio files (*.wav *.mp3 *.ogg *.flac *.m4a *.aif *.aiff)', multiple: true }); if (f.length) app.importAudio(f.map((x) => (typeof x === 'string' ? { path: x, name: x.split(/[\\/]/).pop() } : x))); } },
      { label: 'Export song as WAV…', icon: 'download', hint: 'Ctrl+E', onClick: () => showExport(app) },
      { label: 'Export MIDI…', onClick: () => app.exportMidi() },
    ];
    const rec = app.settings.recent || [];
    if (rec.length) {
      items.push({ sep: true });
      for (const p of rec.slice(0, 5)) items.push({ label: p.split(/[\\/]/).pop().replace(/\.skystudio$/i, ''), icon: 'folder', hint: 'recent', onClick: () => app.openProject(p) });
    }
    items.push({ sep: true }, { label: 'Plugins…', icon: 'magic', onClick: () => showPlugins(app) }, { label: 'Settings…', icon: 'gear', onClick: () => showSettings(app) }, { label: 'Keyboard shortcuts', onClick: () => showShortcuts() }, { label: 'About Sky Studio', icon: 'info', onClick: () => showAbout(app) });
    showMenu(items, r.left, r.bottom + 6);
  }

  // ---- transport
  const bRew = h('button', { class: 'tbtn', title: 'Go to start (Enter)', onClick: () => app.rewind() }, icon('rewind', 17));
  const bPlay = h('button', { class: 'tbtn play', title: 'Play / Pause (Space)', onClick: () => app.togglePlay() });
  const bStop = h('button', { class: 'tbtn', title: 'Stop (playhead stays — press Enter to go back to start)', onClick: () => app.pause() }, icon('stop', 15));
  const bRec = h('button', { class: 'tbtn rec', title: 'Record (R) — plays what you perform on the selected track', onClick: () => app.toggleRecord() }, icon('rec', 17));
  const bLoop = h('button', { class: 'tbtn', title: 'Cycle / loop (C)', onClick: () => app.toggleLoop() }, icon('loop', 18));
  const bMetro = h('button', { class: 'tbtn', title: 'Metronome (K)', onClick: () => app.toggleMetronome() }, icon('metro', 18));
  const bCount = h('button', { class: 'tbtn', title: 'Count-in before recording', onClick: () => app.toggleCountIn(), style: { width: '30px', fontSize: '11px', fontWeight: 700 } }, '1▸');

  // ---- LCD
  const posBar = h('div', { class: 'lcd-v' }, '001.1.1');
  const posTime = h('div', { class: 'lcd-l' }, '0:00.0');
  const bpmVal = h('div', { class: 'lcd-v', style: { cursor: 'ns-resize' }, title: 'Drag up/down, scroll, or double-click to type the tempo' }, '100');
  const keySel = h('select', { class: 'lcd-sel', title: 'Song key', onChange: (e) => app.setKey(+e.target.value) }, NOTE_NAMES.map((n, i) => h('option', { value: i }, n)));
  const scaleSel = h('select', { class: 'lcd-sel', title: 'Scale', onChange: (e) => app.setScale(e.target.value) }, SCALE_NAMES.map((n) => h('option', { value: n }, n)));
  const tsSel = h('select', { class: 'lcd-sel', title: 'Time signature', onChange: (e) => { const [a, b] = e.target.value.split('/').map(Number); app.setTimeSig(a, b); } },
    ['4/4', '3/4', '2/4', '6/8', '5/4', '7/8', '12/8'].map((t) => h('option', { value: t }, t)));
  let tapTimes = [];
  const tap = h('button', { class: 'btn sm ghost', title: 'Tap tempo', onClick: () => {
    const now = performance.now();
    tapTimes = tapTimes.filter((t) => now - t < 2500); tapTimes.push(now);
    if (tapTimes.length >= 3) { const iv = []; for (let i = 1; i < tapTimes.length; i++) iv.push(tapTimes[i] - tapTimes[i - 1]); app.setBpm(60000 / (iv.reduce((a, b) => a + b, 0) / iv.length)); }
  } }, 'Tap');

  bpmVal.addEventListener('pointerdown', (e) => {
    e.preventDefault(); try { bpmVal.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    const y0 = e.clientY, v0 = app.project.bpm;
    const mv = (m) => { app.setBpm(v0 + Math.round((y0 - m.clientY) / 3)); };
    const up = () => { bpmVal.removeEventListener('pointermove', mv); bpmVal.removeEventListener('pointerup', up); };
    bpmVal.addEventListener('pointermove', mv); bpmVal.addEventListener('pointerup', up);
  });
  bpmVal.addEventListener('wheel', (e) => { e.preventDefault(); app.setBpm(app.project.bpm - Math.sign(e.deltaY) * (e.shiftKey ? 0.1 : 1)); }, { passive: false });
  bpmVal.addEventListener('dblclick', () => {
    const inp = h('input', { class: 'num', value: app.project.bpm, style: { width: '64px' } });
    bpmVal.replaceChildren(inp); inp.focus(); inp.select();
    const done = () => { app.setBpm(parseFloat(inp.value) || app.project.bpm); render(); };
    inp.addEventListener('blur', done); inp.addEventListener('keydown', (k) => { k.stopPropagation(); if (k.key === 'Enter') inp.blur(); });
  });

  const lcd = h('div', { class: 'lcd' },
    h('div', { class: 'lcd-cell', style: { minWidth: '108px' } }, posBar, posTime),
    h('div', { class: 'lcd-cell' }, bpmVal, h('div', { class: 'lcd-l', style: { display: 'flex', justifyContent: 'space-between' } }, h('span', {}, 'BPM'), tap)),
    h('div', { class: 'lcd-cell' }, h('div', { class: 'row', style: { gap: '4px' } }, keySel, scaleSel), h('div', { class: 'lcd-l' }, 'Key')),
    h('div', { class: 'lcd-cell', style: { minWidth: '56px' } }, tsSel, h('div', { class: 'lcd-l' }, 'Time')));

  // ---- master
  const mv = h('input', { type: 'range', min: 0, max: 1, step: 0.005, value: app.project.masterVol, title: 'Master volume', onInput: (e) => app.setMasterVol(+e.target.value, false), onChange: (e) => app.setMasterVol(+e.target.value, true) });
  const mL = h('div'), mR = h('div');
  const meter = h('div', { class: 'mini-meter' }, mL, mR);

  const tgl = (ic, title, key, area) => { const b = iconBtn(ic, title, () => { app.view[key] = !app.view[key]; app.emit('layout'); }, '', 19); b.dataset.key = key; return b; };
  const bLeft = tgl('speaker', 'Sounds & track inspector (I)', 'left');
  const bRight = tgl('note', 'Loop library (L)', 'right');

  root.append(
    h('div', { class: 'brand' }, h('div', { class: 'logo' }, icon('wave', 18, { class: 'wh' })), h('span', {}, 'Sky Studio')),
    h('div', { class: 'tb-group' }, fileBtn, undoBtn, redoBtn),
    h('div', { class: 'tb-spacer' }),
    h('div', { class: 'transport' }, bRew, bPlay, bStop, bRec, h('div', { style: { width: '6px' } }), bLoop, bMetro, bCount),
    lcd,
    h('div', { class: 'tb-spacer' }),
    nameInput,
    h('div', { class: 'master' }, icon('speaker', 17), mv, meter),
    h('div', { class: 'tb-group' }, bLeft, bRight, h('button', { class: 'btn primary', onClick: () => showExport(app) }, icon('download', 15), h('span', {}, 'Export')), iconBtn('gear', 'Settings', () => showSettings(app), '', 19)),
  );

  function render() {
    const P = app.project, eng = app.engine;
    if (document.activeElement !== nameInput) nameInput.value = P.name;
    keySel.value = P.key; scaleSel.value = P.scale; tsSel.value = P.ts.join('/');
    if (!bpmVal.querySelector('input')) bpmVal.textContent = Number.isInteger(P.bpm) ? P.bpm : P.bpm.toFixed(1);
    if (document.activeElement !== mv) mv.value = P.masterVol;
    bPlay.replaceChildren(icon(eng.playing ? 'pause' : 'play', 18));
    bPlay.classList.toggle('on', eng.playing);
    bRec.classList.toggle('on', !!app.rec);
    bLoop.classList.toggle('on', P.loop.on);
    bMetro.classList.toggle('on', P.metronome);
    bCount.classList.toggle('on', P.countIn);
    bLeft.classList.toggle('on', app.view.left); bRight.classList.toggle('on', app.view.right);
    undoBtn.style.opacity = app.history.canUndo() ? 1 : 0.35; redoBtn.style.opacity = app.history.canRedo() ? 1 : 0.35;
  }

  let lastTxt = '';
  function frame() {
    const eng = app.engine, beat = app.pos, bpb = app.bpb;
    let txt;
    if (eng.inCountIn()) {
      const b = eng.beatsHeard() - eng.from;
      txt = 'Count ' + Math.max(1, Math.ceil(-b - 1e-6 + 0.0001));
    } else {
      const bar = Math.floor(beat / bpb) + 1, inBar = Math.floor(beat % bpb) + 1, div = Math.floor((beat % 1) * 4) + 1;
      txt = String(bar).padStart(3, '0') + '.' + inBar + '.' + div;
    }
    if (txt !== lastTxt) { posBar.textContent = txt; lastTxt = txt; }
    posTime.textContent = fmtTime(beat * app.spb);
    const [l, r] = eng.masterLevels();
    mL.style.transform = `scaleX(${clamp((20 * Math.log10(Math.max(l, 1e-4)) + 54) / 54, 0, 1)})`;
    mR.style.transform = `scaleX(${clamp((20 * Math.log10(Math.max(r, 1e-4)) + 54) / 54, 0, 1)})`;
  }
  app.on('change', render); app.on('transport', render); app.on('layout', render);
  render();
  return { frame, render };
}
