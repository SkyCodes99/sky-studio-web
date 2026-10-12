// Sky Synth editor: oscillators, unison, filter, envelopes, LFO and drive for the selected track, plus presets.
import { h, clamp } from '../util.js';
import { icon } from './icons.js';
import { knob, button, showMenu } from './widgets.js';
import { promptText } from './dialogs.js';
import { WAVES, FILTER_TYPES, LFO_TARGETS, LFO_WAVES, SYNTH_PRESETS, DEFAULT_PATCH } from '../audio/synthpatch.js';
import { INST_BY_ID } from '../audio/instruments.js';
import '../audio/instrument-bank.js';
import { degToMidi, parentScale } from '../theory.js';

const pct = (v) => Math.round(v * 100) + '%';
const sec = (v) => (v < 1 ? Math.round(v * 1000) + ' ms' : v.toFixed(2) + ' s');
const oct = (v) => (v > 0 ? '+' : '') + Math.round(v) + ' oct';
const semi = (v) => (v > 0 ? '+' : '') + Math.round(v) + ' st';
const cents = (v) => (v > 0 ? '+' : '') + Math.round(v) + '¢';
const ADSR = (p, color) => [
  { k: p + '.a', label: 'Attack', min: 0.001, max: 4, log: true, fmt: sec, color }, { k: p + '.d', label: 'Decay', min: 0.01, max: 4, log: true, fmt: sec, color },
  { k: p + '.s', label: 'Sustain', min: 0, max: 1, fmt: pct, color }, { k: p + '.r', label: 'Release', min: 0.01, max: 6, log: true, fmt: sec, color }];

const CARDS = [
  { title: 'Oscillator 1', color: '#4aa3ff', rows: [
    { k: 'osc1.wave', type: 'sel', label: 'Wave', opts: WAVES }, { k: 'osc1.oct', label: 'Octave', min: -3, max: 3, step: 1, fmt: oct }, { k: 'osc1.semi', label: 'Semitone', min: -12, max: 12, step: 1, fmt: semi },
    { k: 'osc1.detune', label: 'Fine tune', min: -50, max: 50, fmt: cents }, { k: 'osc1.level', label: 'Level', min: 0, max: 1, fmt: pct },
    { k: 'osc1.pw', label: 'Pulse width', min: 0.05, max: 0.95, fmt: pct, showIf: (p) => p.osc1.wave === 'pulse' }] },
  { title: 'Oscillator 2', color: '#8f7bff', toggle: 'osc2.on', rows: [
    { k: 'osc2.wave', type: 'sel', label: 'Wave', opts: WAVES }, { k: 'osc2.oct', label: 'Octave', min: -3, max: 3, step: 1, fmt: oct }, { k: 'osc2.semi', label: 'Semitone', min: -12, max: 12, step: 1, fmt: semi },
    { k: 'osc2.detune', label: 'Fine tune', min: -50, max: 50, fmt: cents }, { k: 'osc2.level', label: 'Level', min: 0, max: 1, fmt: pct },
    { k: 'osc2.pw', label: 'Pulse width', min: 0.05, max: 0.95, fmt: pct, showIf: (p) => p.osc2.wave === 'pulse' }] },
  { title: 'Sub & Noise', color: '#ff9f43', toggle: 'sub.on', rows: [
    { k: 'sub.level', label: 'Sub level', min: 0, max: 1, fmt: pct }, { k: 'noise.level', label: 'Noise', min: 0, max: 1, fmt: pct }] },
  { title: 'Unison', color: '#ff6fb5', rows: [
    { k: 'unison.voices', label: 'Voices', min: 1, max: 7, step: 1, fmt: (v) => Math.round(v) }, { k: 'unison.spread', label: 'Detune spread', min: 0, max: 100, fmt: cents }] },
  { title: 'Filter', color: '#5ed16a', rows: [
    { k: 'filter.type', type: 'sel', label: 'Type', opts: FILTER_TYPES }, { k: 'filter.cutoff', label: 'Cutoff', min: 40, max: 18000, log: true, fmt: (v) => (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v) + '') },
    { k: 'filter.res', label: 'Resonance', min: 0.3, max: 20, log: true, fmt: (v) => v.toFixed(1) }, { k: 'filter.env', label: 'Env amount', min: -5, max: 5, fmt: (v) => (v > 0 ? '+' : '') + v.toFixed(1) + ' oct' },
    { k: 'filter.keytrack', label: 'Key track', min: 0, max: 1, fmt: pct }, { k: 'filter.vel', label: 'Velocity', min: 0, max: 1, fmt: pct }] },
  { title: 'Filter envelope', color: '#2ed3b7', rows: ADSR('fenv', '#2ed3b7') },
  { title: 'Volume envelope', color: '#ffd23f', rows: ADSR('aenv', '#ffd23f') },
  { title: 'LFO', color: '#19c3e6', rows: [
    { k: 'lfo.target', type: 'sel', label: 'Moves', opts: LFO_TARGETS }, { k: 'lfo.wave', type: 'sel', label: 'Shape', opts: LFO_WAVES },
    { k: 'lfo.rate', label: 'Rate', min: 0.1, max: 25, log: true, fmt: (v) => v.toFixed(1) + ' Hz' }, { k: 'lfo.depth', label: 'Depth', min: 0, max: 1, fmt: pct }, { k: 'lfo.delay', label: 'Fade-in', min: 0, max: 2, fmt: sec }] },
  { title: 'Output', color: '#ff5f57', rows: [{ k: 'drive', label: 'Drive', min: 0, max: 1, fmt: pct }, { k: 'level', label: 'Volume', min: 0, max: 1, fmt: pct }] },
];

const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

export function createSynthEd(app) {
  const root = h('div', { class: 'fx-rack' });
  let refs = [];

  const toNorm = (p, v) => (p.log ? Math.log(Math.max(v, p.min) / p.min) / Math.log(p.max / p.min) : (v - p.min) / (p.max - p.min));
  const fromNorm = (p, n) => { n = clamp(n, 0, 1); let v = p.log ? p.min * Math.pow(p.max / p.min, n) : p.min + n * (p.max - p.min); if (p.step) v = Math.round(v / p.step) * p.step; return v; };

  function preview(t) {
    const P = app.project, sc = parentScale(P.scale), m = (d, o = 3) => degToMidi(d, P.key, sc, o);
    const bassy = (t.patch.osc1.oct || 0) < 0 || t.patch.sub.on;
    const o = bassy ? 2 : 3;
    const notes = [[0, m(0, o)], [0.75, m(0, o)], [1.5, m(2, o)], [2.5, m(4, o)], [3.5, m(3, o)]].map(([s, p]) => ({ s, d: 0.7, p, v: 104 }));
    if (!bassy) for (const d of [0, 2, 4]) notes.push({ s: 0, d: 4, p: m(d, 3), v: 78 });
    app.ctx.resume();
    app.engine.previewLoop({ type: 'inst', inst: 'synth', params: { tone: 0.5, attack: 0.5, release: 0.5 }, patch: t.patch }, notes, 5, 112, true);
  }

  function presetMenu(ev, t) {
    const r = ev.currentTarget.getBoundingClientRect();
    const items = [];
    let last = null;
    for (const p of SYNTH_PRESETS) {
      if (p.cat !== last) { last = p.cat; items.push({ label: '— ' + p.cat + ' —', disabled: true }); }
      items.push({ label: p.name, hint: p.desc.slice(0, 22), onClick: () => { app.loadPatch(t.id, p.patch, p.name); } });
    }
    const mine = app.settings.patches || [];
    if (mine.length) { items.push({ label: '— My patches —', disabled: true }); for (const u of mine) items.push({ label: u.name, onClick: () => app.loadPatch(t.id, u.patch, u.name) }); }
    showMenu(items, r.left, r.bottom + 4);
  }

  function control(t, c, parent) {
    const p = t.patch;
    if (c.type === 'sel') {
      const cur = get(p, c.k);
      return h('div', { class: 'fx-sel' }, h('span', { class: 'k-label' }, c.label),
        h('select', { class: 'sel', onChange: (e) => { app.setPatchParam(t.id, c.k, e.target.value, true); if (c.k.endsWith('.wave') || c.k.endsWith('.type')) build(); } },
          c.opts.map(([l, v]) => h('option', { value: v, selected: cur === v }, l))));
    }
    const cur = () => get(t.patch, c.k) ?? 0;
    const k = knob({ label: c.label, value: toNorm(c, cur()), min: 0, max: 1, def: toNorm(c, get(DEFAULT_PATCH, c.k) ?? cur()), size: 38, color: c.color || parent.color, fmt: (n) => c.fmt(fromNorm(c, n)),
      onInput: (n) => app.setPatchParam(t.id, c.k, fromNorm(c, n), false), onChange: (n) => app.setPatchParam(t.id, c.k, fromNorm(c, n), true) });
    refs.push({ k, get: () => toNorm(c, cur()) });
    return k;
  }

  function build() {
    refs = [];
    root.replaceChildren();
    const t = app.selTrack;
    if (!t || t.type !== 'inst' || t.inst === 'sampler') {
      root.append(h('div', { class: 'empty', style: { margin: 'auto' } }, h('b', {}, 'Select an instrument track'), 'The Sky Synth designs sounds for instrument tracks.',
        h('div', { style: { marginTop: '10px' } }, button('New Sky Synth track', () => { app.addTrack('inst', { inst: 'synth' }); }, { class: 'primary', icon: 'plus' }))));
      return;
    }
    if (t.inst !== 'synth') {
      const cur = INST_BY_ID[t.inst];
      root.append(h('div', { class: 'empty', style: { margin: 'auto', maxWidth: '520px' } }, h('b', {}, `“${t.name}” uses ${cur ? cur.name : 'a built-in sound'}`),
        h('p', { class: 'hint' }, cur && cur.patch ? 'This is a Sky Synth preset. Open it in the editor to change oscillators, filter, envelopes and more.' : 'Built-in instruments aren’t editable. You can start a Sky Synth patch on this track instead (the notes stay, the sound changes).'),
        h('div', { class: 'row wrap', style: { justifyContent: 'center' } }, button(cur && cur.patch ? 'Edit this preset' : 'Switch to Sky Synth', () => app.makeSynthTrack(t.id), { class: 'primary', icon: 'wave' }),
          button('Browse presets', (ev) => presetMenu(ev, t), { icon: 'list' }))));
      return;
    }
    root.append(h('div', { class: 'ed-bar' },
      button('Presets', (ev) => presetMenu(ev, t), { icon: 'list', class: 'sm' }),
      button('Preview', () => preview(t), { icon: 'play', class: 'sm' }),
      button('Init', () => app.loadPatch(t.id, DEFAULT_PATCH), { class: 'sm ghost', title: 'Reset to a basic saw' }),
      button('Save patch…', async () => { const n = await promptText('Save this sound as', t.name); if (n && n.trim()) { app.saveUserPatch(t.id, n.trim()); app.toast('Saved “' + n.trim() + '” to My patches'); } }, { class: 'sm' }),
      h('span', { style: { flex: 1 } }), h('span', { class: 'hint' }, 'Changes apply to notes you play from now on. The Tone / Attack / Release knobs in the Track panel still work on top.')));
    root.append(h('div', { class: 'fx-slots' }, CARDS.map((card) => {
      const on = card.toggle ? get(t.patch, card.toggle) : true;
      const rows = card.rows.filter((c) => !c.showIf || c.showIf(t.patch));
      return h('div', { class: 'fx-card' + (on ? '' : ' off'), style: { '--fxc': card.color, width: card.rows.length > 4 ? '286px' : '230px' } },
        h('div', { class: 'fx-head' }, card.toggle ? h('button', { class: 'fx-pow' + (on ? ' on' : ''), title: on ? 'Turn off' : 'Turn on', onClick: () => { app.setPatchParam(t.id, card.toggle, !on, true); build(); } }, icon('check', 12)) : null, h('div', { class: 'fx-title' }, card.title)),
        h('div', { class: 'fx-params' }, rows.map((c) => control(t, c, card))));
    })));
  }

  function sync() { for (const { k, get: g } of refs) k.set(g()); }
  let pending = false;
  const rebuild = () => { if (pending) return; pending = true; queueMicrotask(() => { pending = false; if (app.view.bottom === 'synth' || !root.childElementCount) build(); }); };
  app.on('selection', rebuild); app.on('patches', rebuild); app.on('layout', () => { if (app.view.bottom === 'synth') rebuild(); });
  app.on('change', (kind) => { if (kind === 'params') { if (app.view.bottom === 'synth') sync(); } else if (kind !== 'recording') rebuild(); });
  build();
  return { el: root, refresh: build };
}
