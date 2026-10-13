// Sound Lab: play any instrument or drum hit as a single tone, shape it with every knob in one place, keep it as one of
// "My sounds", turn it into a sample, or save it as a WAV — then build your own loops from it.
import { h, clamp } from '../util.js';
import { icon } from './icons.js';
import { knob, button, showMenu, toast, segmented } from './widgets.js';
import { promptText } from './dialogs.js';
import { INST_BY_ID } from '../audio/instruments.js';
import { KIT_BY_ID, PAD_BASE, padName } from '../audio/drums.js';
import { isBlack, noteLabel, inScale, isRoot } from '../theory.js';
import { showLoopBuilder } from './loopbuilder.js';

const pct = (v) => Math.round(v * 100) + '%';
const dB = (v) => (v > 0 ? '+' : '') + v.toFixed(1) + ' dB';
const hz = (f) => (f >= 1000 ? (f / 1000).toFixed(1) + 'k' : Math.round(f));

export function createSoundLab(app) {
  const root = h('div', { class: 'lab' });
  const L = { oct: 3, vel: 100, mode: 'hold', pad: 0, note: 60, noteLen: 1 };
  let knobs = {};
  const keyEls = new Map(), padEls = new Map();

  const track = () => { const t = app.selTrack; return t && t.type !== 'audio' && t.inst !== 'sampler' ? t : null; };

  function K(t, path, label, o) {
    const get = () => path.split('.').reduce((a, k) => (a == null ? a : a[k]), t);
    const k = knob({ label, value: get() ?? o.def, def: o.def, min: o.min ?? 0, max: o.max ?? 1, step: o.step, fmt: o.fmt || pct, color: o.color, size: 46,
      onInput: (v) => app.setTrackProp(t.id, path, v, false), onChange: (v) => app.setTrackProp(t.id, path, v, true) });
    knobs[path] = { k, get, def: o.def };
    return k;
  }

  // ---- header + actions
  function soundName(t) { return t.type === 'drum' ? (KIT_BY_ID[t.kit] || {}).name : (INST_BY_ID[t.inst] || {}).name; }
  function saveMenu(ev) {
    const t = track(); if (!t) return;
    const r = ev.currentTarget.getBoundingClientRect();
    const mine = app.mySounds().filter((s) => s.kind === (t.type === 'drum' ? 'drum' : 'inst'));
    const items = [{ label: 'Save this sound as…', icon: 'save', onClick: async () => { const n = await promptText('Name this sound', soundName(t) + ' (mine)'); if (n && n.trim()) { app.saveMySound(t.id, n.trim()); toast('Saved “' + n.trim() + '” to My sounds'); } } }];
    if (mine.length) {
      items.push({ sep: true }, { label: 'Use one of my sounds', disabled: true });
      for (const s of mine) items.push({ label: s.name, hint: (s.kind === 'drum' ? KIT_BY_ID[s.base] : INST_BY_ID[s.base]) ? (s.kind === 'drum' ? KIT_BY_ID[s.base] : INST_BY_ID[s.base]).name : '', onClick: () => app.applyMySound(t.id, s) });
      items.push({ sep: true }, { label: 'Delete a saved sound', disabled: true });
      for (const s of mine) items.push({ label: '✕  ' + s.name, onClick: () => { app.deleteMySound(s.id); toast('Deleted “' + s.name + '”'); } });
    }
    showMenu(items, r.left, r.bottom + 4);
  }

  function header(t) {
    const label = t.type === 'drum' ? padName(t.kit, L.pad) : noteLabel(L.note);
    return h('div', { class: 'lab-head' },
      h('div', { class: 'lab-title' }, icon(t.type === 'drum' ? 'drum' : 'wave', 18), h('b', {}, soundName(t) || 'Sound'), h('span', { class: 'hint' }, ` on “${t.name}”`)),
      h('div', { class: 'row wrap', style: { gap: '6px' } },
        button('Change sound', () => { app.view.left = true; app.view.leftTab = 'sounds'; app.emit('layout'); }, { class: 'sm', icon: 'list' }),
        button('My sounds', saveMenu, { class: 'sm', icon: 'star' }),
        button('Make a sample', () => app.bakeToSampler(t.id, { midi: t.type === 'drum' ? PAD_BASE + L.pad : L.note, label }), { class: 'sm', icon: 'wave', title: 'Render this tone (with all your settings) into a sample you can play, pitch and loop on a sampler track' }),
        button('Save as WAV', () => app.exportSoundWav(t.id, { midi: t.type === 'drum' ? PAD_BASE + L.pad : L.note, label }), { class: 'sm', icon: 'download' }),
        button('Build a loop…', () => showLoopBuilder(app), { class: 'sm primary', icon: 'magic' })));
  }

  // ---- single-tone players
  function start(midi) {
    L.note = midi; app.ctx.resume();
    app.noteOn(midi, L.vel);
    if (L.mode !== 'hold') { const ms = L.mode === 'short' ? 260 : L.mode === '1' ? 1000 : L.mode === '2' ? 2000 : 4000; setTimeout(() => app.noteOff(midi), ms); }
  }
  function playerInst(t) {
    const P = app.project;
    const lo = 12 * (L.oct + 1), whites = [];
    for (let m = lo; m <= lo + 36; m++) if (!isBlack(m)) whites.push(m);
    const piano = h('div', { class: 'piano', style: { height: '150px' } });
    const ww = 100 / whites.length;
    keyEls.clear();
    whites.forEach((m, i) => {
      const el = h('div', { class: 'pk-w' + (isRoot(m, P.key) ? ' root' : '') + (inScale(m, P.key, P.scale) ? '' : ' out'), dataset: { midi: m }, style: { left: i * ww + '%', width: ww + '%' } }, m % 12 === 0 ? h('span', {}, noteLabel(m)) : null);
      keyEls.set(m, el); piano.append(el);
    });
    whites.forEach((m, i) => {
      if (!isBlack(m + 1) || m + 1 > lo + 36) return;
      const el = h('div', { class: 'pk-b' + (inScale(m + 1, P.key, P.scale) ? '' : ' out'), dataset: { midi: m + 1 }, style: { left: (i + 1) * ww - ww * 0.3 + '%', width: ww * 0.6 + '%' } });
      keyEls.set(m + 1, el); piano.append(el);
    });
    let cur = null;
    const midiAt = (e) => { const el = document.elementFromPoint(e.clientX, e.clientY); const k = el && el.closest && el.closest('[data-midi]'); return k && piano.contains(k) ? +k.dataset.midi : null; };
    piano.addEventListener('pointerdown', (e) => { e.preventDefault(); try { piano.setPointerCapture(e.pointerId); } catch { /* synthetic */ } const m = midiAt(e); if (m != null) { cur = m; start(m); label(); } });
    piano.addEventListener('pointermove', (e) => { if (cur == null || L.mode !== 'hold') return; const m = midiAt(e); if (m != null && m !== cur) { app.noteOff(cur); cur = m; start(m); label(); } });
    const up = () => { if (cur != null && L.mode === 'hold') app.noteOff(cur); cur = null; };
    piano.addEventListener('pointerup', up); piano.addEventListener('pointercancel', up);
    const lbl = h('span', { class: 'lab-note' }, noteLabel(L.note));
    function label() { lbl.textContent = noteLabel(L.note); }
    const lens = [['hold', 'Hold'], ['short', 'Short'], ['1', '1 sec'], ['2', '2 sec'], ['4', '4 sec']];
    return h('div', { class: 'lab-card lab-player' },
      h('div', { class: 'row wrap', style: { gap: '10px', marginBottom: '8px' } },
        h('div', { class: 'row', style: { gap: '4px' } }, h('span', { class: 'hint' }, 'Octave'), button('−', () => { L.oct = clamp(L.oct - 1, 0, 6); build(); }, { class: 'sm' }), h('b', { style: { minWidth: '56px', textAlign: 'center' } }, noteLabel(lo) + '–' + noteLabel(lo + 36)), button('+', () => { L.oct = clamp(L.oct + 1, 0, 6); build(); }, { class: 'sm' })),
        h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'hint' }, 'Tone length'), h('select', { class: 'sel', onChange: (e) => { L.mode = e.target.value; } }, lens.map(([v, l]) => h('option', { value: v, selected: L.mode === v }, l)))),
        h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'hint' }, 'Strength'), h('input', { type: 'range', min: 20, max: 127, value: L.vel, onInput: (e) => { L.vel = +e.target.value; } })),
        lbl),
      piano,
      h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '10px' } },
        button('Place this note in the song', () => { const r = app.placeNote(L.note, L.noteLen); if (r) toast('Placed ' + noteLabel(L.note) + ' at the playhead — edit it in the Editor'); }, { class: 'sm', icon: 'plus' }),
        h('select', { class: 'sel', title: 'How long the placed note is', onChange: (e) => { L.noteLen = +e.target.value; } }, [[0.25, '1/16'], [0.5, '1/8'], [1, '1/4'], [2, '1/2'], [4, '1 bar']].map(([v, l]) => h('option', { value: v, selected: L.noteLen === v }, l))),
        h('span', { class: 'hint' }, 'Computer keys A–; also play (Z / X change octave). Build a pattern by placing notes, then loop them.')));
  }

  function playerDrum(t) {
    const grid = h('div', { class: 'pads', style: { maxWidth: '460px' } });
    padEls.clear();
    for (let row = 3; row >= 0; row--) for (let col = 0; col < 4; col++) {
      const pad = row * 4 + col, midi = PAD_BASE + pad;
      const el = h('button', { class: 'pad' + (L.pad === pad ? ' sel' : ''), style: { '--padc': ['#ff9f43', '#ff5f57', '#ffd23f', '#5ed16a', '#2ed3b7', '#4aa3ff', '#8f7bff', '#ff6fb5'][(row * 2 + col) % 8] } }, h('span', { class: 'pn' }, padName(t.kit, pad)));
      padEls.set(pad, el);
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch { /* synthetic */ } const was = L.pad; L.pad = pad; L.note = midi; app.ctx.resume(); app.noteOn(midi, L.vel); if (was !== pad) build(); });
      const up = () => app.noteOff(midi);
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      grid.append(el);
    }
    return h('div', { class: 'lab-card lab-player' },
      h('div', { class: 'row', style: { gap: '10px', marginBottom: '8px' } }, h('span', { class: 'hint' }, 'Hit a pad to hear it and pick it for editing'), h('span', { style: { flex: 1 } }),
        h('div', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'hint' }, 'Strength'), h('input', { type: 'range', min: 20, max: 127, value: L.vel, onInput: (e) => { L.vel = +e.target.value; } }))),
      grid,
      h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '10px' } },
        button('Place this hit in the song', () => { const r = app.placeNote(PAD_BASE + L.pad, 0.25); if (r) toast('Placed “' + padName(t.kit, L.pad) + '” at the playhead'); }, { class: 'sm', icon: 'plus' }),
        h('span', { class: 'hint' }, 'The knobs on the right shape the selected pad only. Use the beat editor to build a pattern from hits.')));
  }

  // ---- knobs
  function knobsInst(t) {
    const synthy = t.inst === 'synth' || (INST_BY_ID[t.inst] && INST_BY_ID[t.inst].patch);
    return h('div', { class: 'lab-card lab-knobs' },
      h('div', { class: 'lab-sect' }, h('div', { class: 'sect-t' }, 'Shape'), h('div', { class: 'knobs' },
        K(t, 'params.tone', t.inst === 'choir' ? 'Vowel' : 'Tone', { def: 0.5 }), K(t, 'params.attack', 'Attack', { def: 0.5 }), K(t, 'params.release', 'Release', { def: 0.5 }),
        K(t, 'transpose', 'Pitch', { def: 0, min: -24, max: 24, step: 1, fmt: (v) => (v > 0 ? '+' : '') + Math.round(v) + ' st', color: '#8f7bff' }))),
      h('div', { class: 'lab-sect' }, h('div', { class: 'sect-t' }, 'Colour'), h('div', { class: 'knobs' },
        K(t, 'filter', 'Filter', { def: 0, min: -1, max: 1, color: '#2ed3b7', fmt: (v) => (Math.abs(v) < 0.03 ? 'off' : v < 0 ? 'LP ' + hz(20000 * Math.pow(0.012, -v)) : 'HP ' + hz(20 * Math.pow(250, v))) }),
        K(t, 'drive', 'Drive', { def: 0, color: '#ff5f57' }), K(t, 'comp', 'Squash', { def: 0, color: '#ff6fb5' }),
        K(t, 'eq.lo', 'Bass', { def: 0, min: -12, max: 12, fmt: dB, color: '#ff9f43' }), K(t, 'eq.mid', 'Mid', { def: 0, min: -12, max: 12, fmt: dB, color: '#ff9f43' }), K(t, 'eq.hi', 'Treble', { def: 0, min: -12, max: 12, fmt: dB, color: '#ff9f43' }))),
      h('div', { class: 'lab-sect' }, h('div', { class: 'sect-t' }, 'Space & level'), h('div', { class: 'knobs' },
        K(t, 'send.rev', 'Reverb', { def: 0.12, color: '#4aa3ff' }), K(t, 'send.del', 'Echo', { def: 0, color: '#2ed3b7' }),
        K(t, 'pan', 'Pan', { def: 0, min: -1, max: 1, fmt: (v) => (Math.abs(v) < 0.02 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100)), color: '#8f7bff' }),
        K(t, 'vol', 'Volume', { def: 0.78, fmt: (v) => Math.round(v * 100), color: '#5ed16a' }))),
      synthy ? h('div', { class: 'row', style: { gap: '8px', marginTop: '6px' } }, button('Open the full synth editor', () => { if (t.inst !== 'synth') app.makeSynthTrack(t.id); app.view.bottom = 'synth'; app.emit('layout'); }, { class: 'sm', icon: 'wave' }), h('span', { class: 'hint' }, 'Oscillators, filter envelope, LFO…')) : null);
  }
  function knobsDrum(t) {
    const pad = L.pad, pm = (k) => `padMix.${pad}.${k}`;
    const pmv = (t.padMix && t.padMix[pad]) || {};
    return h('div', { class: 'lab-card lab-knobs' },
      h('div', { class: 'lab-sect' }, h('div', { class: 'sect-t' }, 'This hit: ' + padName(t.kit, pad)), h('div', { class: 'knobs' },
        K(t, pm('gain'), 'Level', { def: 1, min: 0, max: 2 }), K(t, pm('tune'), 'Tune', { def: 0, min: -12, max: 12, step: 0.5, fmt: (v) => (v > 0 ? '+' : '') + v.toFixed(1) + ' st', color: '#8f7bff' }),
        K(t, pm('decay'), 'Length', { def: 1, min: 0, max: 1, color: '#ff9f43' }),
        K(t, pm('filter'), 'Filter', { def: 0, min: -1, max: 1, color: '#2ed3b7', fmt: (v) => (Math.abs(v) < 0.03 ? 'off' : v < 0 ? 'LP ' + hz(20000 * Math.pow(0.012, -v)) : 'HP ' + hz(20 * Math.pow(250, v))) }),
        K(t, pm('pan'), 'Pan', { def: 0, min: -1, max: 1, fmt: (v) => (Math.abs(v) < 0.02 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100)), color: '#8f7bff' })),
        h('div', { class: 'row', style: { gap: '8px', marginTop: '6px' } },
          h('label', { class: 'row', style: { gap: '6px' } }, h('input', { type: 'checkbox', class: 'switch', checked: !!pmv.reverse, onChange: (e) => { app.setTrackProp(t.id, pm('reverse'), e.target.checked); } }), h('span', {}, 'Play backwards')),
          button('Reset this hit', () => { const m = t.padMix || (t.padMix = {}); delete m[pad]; app.commit('structure'); }, { class: 'sm ghost' }))),
      h('div', { class: 'lab-sect' }, h('div', { class: 'sect-t' }, 'Whole kit'), h('div', { class: 'knobs' },
        K(t, 'params.tone', 'Tune', { def: 0.5 }), K(t, 'params.release', 'Decay', { def: 1 }),
        K(t, 'filter', 'Filter', { def: 0, min: -1, max: 1, color: '#2ed3b7', fmt: (v) => (Math.abs(v) < 0.03 ? 'off' : v < 0 ? 'LP ' + hz(20000 * Math.pow(0.012, -v)) : 'HP ' + hz(20 * Math.pow(250, v))) }),
        K(t, 'drive', 'Drive', { def: 0, color: '#ff5f57' }), K(t, 'comp', 'Squash', { def: 0, color: '#ff6fb5' }),
        K(t, 'eq.lo', 'Bass', { def: 0, min: -12, max: 12, fmt: dB, color: '#ff9f43' }), K(t, 'eq.hi', 'Treble', { def: 0, min: -12, max: 12, fmt: dB, color: '#ff9f43' }))),
      h('div', { class: 'lab-sect' }, h('div', { class: 'sect-t' }, 'Space & level'), h('div', { class: 'knobs' },
        K(t, 'send.rev', 'Reverb', { def: 0.12, color: '#4aa3ff' }), K(t, 'send.del', 'Echo', { def: 0, color: '#2ed3b7' }), K(t, 'vol', 'Volume', { def: 0.78, fmt: (v) => Math.round(v * 100), color: '#5ed16a' }))));
  }

  function build() {
    knobs = {};
    root.replaceChildren();
    const t = track();
    if (!t) {
      root.append(h('div', { class: 'empty', style: { margin: 'auto' } }, h('b', {}, 'Pick an instrument or drum track'), 'The Sound Lab plays one note or hit at a time so you can shape it. Select a track, or start one:',
        h('div', { class: 'row wrap', style: { justifyContent: 'center', marginTop: '10px', gap: '8px' } }, button('New instrument track', () => app.addTrack('inst', { inst: 'piano' }), { class: 'primary', icon: 'plus' }), button('New drum track', () => app.addTrack('drum', { kit: '808' }), { icon: 'plus' }))));
      return;
    }
    root.append(header(t), h('div', { class: 'lab-main' }, t.type === 'drum' ? playerDrum(t) : playerInst(t), t.type === 'drum' ? knobsDrum(t) : knobsInst(t)));
  }

  let pending = false;
  const rebuild = () => { if (pending) return; pending = true; queueMicrotask(() => { pending = false; build(); }); };
  app.on('selection', rebuild);
  app.on('change', (kind) => {
    if (kind === 'params') { for (const { k, get, def } of Object.values(knobs)) k.set(get() ?? def); return; }
    if (kind === 'recording') return;
    rebuild();
  });
  app.on('keydown', (m) => { const e = keyEls.get(m); if (e) e.classList.add('on'); });
  app.on('keyup', (m) => { const e = keyEls.get(m); if (e) e.classList.remove('on'); });
  build();
  return { el: root, refresh: build, setPad(p) { L.pad = p; build(); } };
}
