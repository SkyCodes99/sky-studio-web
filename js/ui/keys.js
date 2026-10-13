// Play panel: on-screen piano, chord strip, drum pads, computer-keyboard + MIDI-keyboard input.
import { h, clamp } from '../util.js';
import { icon } from './icons.js';
import { iconBtn } from './widgets.js';
import { PAD_NAMES, PAD_BASE, padName } from '../audio/drums.js';
import { diatonicChords, isBlack, noteLabel, noteName, inScale, isRoot, NOTE_NAMES } from '../theory.js';
import { INST_BY_ID, INSTRUMENTS, INST_CATS } from '../audio/instruments.js';
import { KIT_BY_ID, KITS } from '../audio/drums.js';
import { auditionInstrument } from './preview.js';

const PIANO_CODES = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17 };
const PAD_CODES = { Digit1: 12, Digit2: 13, Digit3: 14, Digit4: 15, KeyQ: 8, KeyW: 9, KeyE: 10, KeyR: 11, KeyA: 4, KeyS: 5, KeyD: 6, KeyF: 7, KeyZ: 0, KeyX: 1, KeyC: 2, KeyV: 3 };
const PAD_KEY_LABEL = { 12: '1', 13: '2', 14: '3', 15: '4', 8: 'Q', 9: 'W', 10: 'E', 11: 'R', 4: 'A', 5: 'S', 6: 'D', 7: 'F', 0: 'Z', 1: 'X', 2: 'C', 3: 'V' };
const PAD_COLORS = ['#ff5f57', '#ff9f43', '#ffd23f', '#5ed16a', '#2ed3b7', '#4aa3ff', '#8f7bff', '#ff6fb5'];

export function createKeys(app) {
  const root = h('div', { class: 'keys-wrap' });
  const keyEls = new Map();           // midi -> element
  const down = new Map();             // keyboard code -> midi
  let vel = 100, seven = false;
  const pointerNotes = new Map();     // pointerId -> midi[]
  const base = () => 12 * (app.settings.keysOctave + 1);

  function track() { return app.selTrack; }

  let lastSig = '';
  const sig = () => { const t = track(), P = app.project; return t ? [t.id, P.tracks.map((x) => x.id + x.name).join(','), t.type, t.inst, t.kit, t.name, P.key, P.scale, app.settings.keysOctave, app.view.scaleSnap].join('|') : 'none'; };
  function build() {
    lastSig = sig();
    root.replaceChildren(); keyEls.clear();
    const t = track();
    const bar = h('div', { class: 'keys-bar' });
    root.append(bar);
    if (!t || t.type === 'audio') {
      bar.append(h('span', { class: 'hint' }, 'Select an instrument or drum track to play it here.'));
      return;
    }
    const playable = app.project.tracks.filter((x) => x.type !== 'audio');
    bar.append(h('label', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'hint' }, 'Playing'),
      h('select', { class: 'sel', title: 'Which track your keys play', onChange: (e) => app.selectTrack(e.target.value) }, playable.map((x) => h('option', { value: x.id, selected: x.id === t.id }, x.name)))));
    if (t.type === 'drum') {
      bar.append(h('label', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'hint' }, 'Kit'),
        h('select', { class: 'sel', onChange: (e) => app.setKit(t.id, e.target.value) }, KITS.map((k) => h('option', { value: k.id, selected: k.id === t.kit }, k.name)))));
    } else if (t.inst !== 'sampler') {
      bar.append(h('label', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'hint' }, 'Sound'),
        h('select', { class: 'sel', title: 'Change the instrument of this track', onChange: (e) => { app.setInstrument(t.id, e.target.value); auditionInstrument(app, e.target.value); } },
          INST_CATS.map((c) => h('optgroup', { label: c }, INSTRUMENTS.filter((i) => i.cat === c).map((i) => h('option', { value: i.id, selected: i.id === t.inst }, i.name)))))));
    }
    bar.append(h('span', { class: 'tag', title: 'Your computer keyboard plays this track while this panel is open' }, '⌨ keyboard is live'));
    if (t.type === 'inst') {
      const octLbl = h('span', { style: { minWidth: '34px', textAlign: 'center', fontWeight: 600 } }, 'C' + (app.settings.keysOctave));
      const shiftOct = (d) => { app.settings.keysOctave = clamp(app.settings.keysOctave + d, 0, 7); build(); };
      bar.append(h('div', { class: 'row', style: { gap: '2px' } }, iconBtn('minus', 'Octave down (Z)', () => shiftOct(-1), 'sm', 15), octLbl, iconBtn('plus', 'Octave up (X)', () => shiftOct(1), 'sm', 15)));
    }
    bar.append(h('label', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'hint' }, 'Touch'), h('input', { type: 'range', min: 20, max: 127, value: vel, style: { width: '90px' }, onInput: (e) => (vel = +e.target.value) })));
    if (t.type === 'inst') bar.append(h('button', { class: 'btn sm' + (app.view.scaleSnap ? ' on' : ''), title: 'Wrong notes snap to the song key', onClick: () => { app.view.scaleSnap = !app.view.scaleSnap; app.emit('layout'); build(); } }, icon('magnet', 13), h('span', {}, 'Lock to key')));
    bar.append(h('label', { class: 'row', style: { gap: '6px' }, title: 'When recording, nudge notes onto the grid' }, h('span', { class: 'hint' }, 'Tighten timing'),
      h('select', { class: 'sel', onChange: (e) => { app.settings.recQuant = e.target.value; app.saveSettings(); } }, [['off', 'Off'], ['1/32', '1/32'], ['1/16', '1/16'], ['1/8', '1/8']].map(([v, l]) => h('option', { value: v, selected: app.settings.recQuant === v }, l)))));
    if (t.type === 'drum') buildPads(t); else buildPiano(t);
  }

  // ------------------------------------------------------------ pads
  function buildPads(t) {
    const grid = h('div', { class: 'pads' });
    for (let row = 3; row >= 0; row--) for (let col = 0; col < 4; col++) {
      const pad = row * 4 + col, midi = PAD_BASE + pad;
      const el = h('button', { class: 'pad', style: { '--padc': PAD_COLORS[(row * 2 + col) % 8] } }, h('span', { class: 'pn' }, padName(t.kit, pad)), h('span', { class: 'pk' }, PAD_KEY_LABEL[pad]));
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } app.noteOn(midi, clamp(vel + (e.pressure ? 0 : 0), 20, 127)); });
      const up = () => app.noteOff(midi);
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      keyEls.set(midi, el); grid.append(el);
    }
    root.append(grid);
  }

  // ------------------------------------------------------------ piano + chords
  function buildPiano(t) {
    const P = app.project;
    // chord strip
    const chords = diatonicChords(P.key, P.scale, seven ? 4 : 3, app.settings.keysOctave);
    const strip = h('div', { class: 'chord-strip' }, h('span', { class: 'hint' }, 'Chords in ' + NOTE_NAMES[P.key] + ' ' + P.scale + ':'),
      chords.map((c, i) => {
        const b = h('button', { class: 'chord-btn' }, h('span', { style: { fontWeight: 700 } }, c.name || '—'), h('small', {}, ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][i]));
        const notes = c.midis;
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } b.classList.add('on'); notes.forEach((m, k) => setTimeout(() => app.noteOn(m, vel - k * 3), k * 10)); });
        const up = () => { b.classList.remove('on'); notes.forEach((m) => app.noteOff(m)); };
        b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
        return b;
      }),
      h('label', { class: 'row', style: { gap: '6px', marginLeft: '8px' } }, h('input', { type: 'checkbox', class: 'switch', checked: seven, onChange: (e) => { seven = e.target.checked; build(); } }), h('span', { class: 'hint' }, '7ths')));
    root.append(strip);
    // piano keyboard: 3 octaves + top C
    const lo = base(), whites = [];
    for (let m = lo; m <= lo + 36; m++) if (!isBlack(m)) whites.push(m);
    const piano = h('div', { class: 'piano' });
    const ww = 100 / whites.length;
    whites.forEach((m, i) => {
      const lab = m % 12 === 0 ? noteLabel(m) : '';
      const el = h('div', { class: 'pk-w' + (isRoot(m, P.key) ? ' root' : '') + (inScale(m, P.key, P.scale) ? '' : ' out'), dataset: { midi: m }, style: { left: i * ww + '%', width: ww + '%' } }, lab);
      keyEls.set(m, el); piano.append(el);
    });
    whites.forEach((m, i) => {
      if (!isBlack(m + 1) || m + 1 > lo + 36) return;
      const el = h('div', { class: 'pk-b' + (inScale(m + 1, P.key, P.scale) ? '' : ' out'), dataset: { midi: m + 1 }, style: { left: (i + 1) * ww - ww * 0.3 + '%', width: ww * 0.6 + '%' } });
      keyEls.set(m + 1, el); piano.append(el);
    });
    const midiAt = (e) => { const el = document.elementFromPoint(e.clientX, e.clientY); const k = el && el.closest && el.closest('[data-midi]'); return k && piano.contains(k) ? +k.dataset.midi : null; };
    piano.addEventListener('pointerdown', (e) => {
      e.preventDefault(); try { piano.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      const m = midiAt(e); if (m == null) return;
      pointerNotes.set(e.pointerId, m); app.noteOn(m, clamp(vel, 20, 127));
    });
    piano.addEventListener('pointermove', (e) => {
      if (!pointerNotes.has(e.pointerId)) return;
      const m = midiAt(e), cur = pointerNotes.get(e.pointerId);
      if (m != null && m !== cur) { app.noteOff(cur); pointerNotes.set(e.pointerId, m); app.noteOn(m, clamp(vel, 20, 127)); }
    });
    const up = (e) => { const cur = pointerNotes.get(e.pointerId); if (cur != null) app.noteOff(cur); pointerNotes.delete(e.pointerId); };
    piano.addEventListener('pointerup', up); piano.addEventListener('pointercancel', up);
    root.append(piano);
  }

  // ------------------------------------------------------------ app events -> highlight
  app.on('keydown', (m) => { const el = keyEls.get(m); if (el) el.classList.add('on'); });
  app.on('keyup', (m) => { const el = keyEls.get(m); if (el) el.classList.remove('on'); });

  // ------------------------------------------------------------ computer keyboard
  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const t = track();
    if (!t || t.type === 'audio') return false;
    if (t.type === 'drum') {
      const pad = PAD_CODES[e.code];
      if (pad == null) return false;
      if (!e.repeat && !down.has(e.code)) { down.set(e.code, PAD_BASE + pad); app.noteOn(PAD_BASE + pad, vel); }
      return true;
    }
    if (e.code === 'KeyZ' || e.code === 'KeyX') {
      if (!e.repeat) { app.settings.keysOctave = clamp(app.settings.keysOctave + (e.code === 'KeyX' ? 1 : -1), 0, 7); build(); }
      return true;
    }
    const off = PIANO_CODES[e.code];
    if (off == null) return false;
    if (!e.repeat && !down.has(e.code)) { const m = base() + off; down.set(e.code, m); app.noteOn(m, vel); }
    return true;
  }
  function onKeyUp(e) {
    if (down.has(e.code)) { app.noteOff(down.get(e.code)); down.delete(e.code); return true; }
    return false;
  }
  function releaseAll() { for (const m of down.values()) app.noteOff(m); down.clear(); }

  app.on('selection', () => { if (sig() !== lastSig) { releaseAll(); build(); } });
  app.on('layout', () => { if (sig() !== lastSig) build(); });
  app.on('change', (k) => { if (k !== 'params' && k !== 'recording' && sig() !== lastSig) build(); });
  window.addEventListener('blur', releaseAll);
  build();
  return { el: root, onKeyDown, onKeyUp, releaseAll, build };
}

/** Optional hardware MIDI keyboard. Never required; silently skipped if unavailable. */
export async function initMidi(app) {
  if (!navigator.requestMIDIAccess) return;
  try {
    const access = await navigator.requestMIDIAccess({ sysex: false });
    const hook = () => {
      for (const input of access.inputs.values()) {
        input.onmidimessage = (m) => {
          const [st, a, b] = m.data, cmd = st & 0xf0;
          if (cmd === 0x90 && b > 0) app.noteOn(a, b);
          else if (cmd === 0x80 || (cmd === 0x90 && b === 0)) app.noteOff(a);
        };
      }
    };
    hook(); access.onstatechange = hook;
    app.midiInputs = () => [...access.inputs.values()].map((i) => i.name);
  } catch { /* permission denied or no MIDI */ }
}
