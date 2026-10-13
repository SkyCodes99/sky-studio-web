// Left panel: track inspector (sound + smart controls + mix + EQ + arpeggiator + pad samples) and the Sounds browser.
import { h, clamp } from '../util.js';
import { icon } from './icons.js';
import { knob, segmented, button, iconBtn } from './widgets.js';
import { trackIcon } from './arrange.js';
import { INSTRUMENTS, INST_BY_ID, INST_CATS } from '../audio/instruments.js';
import '../audio/instrument-bank.js';
import { KITS, KIT_BY_ID, PAD_NAMES, PAD_BASE, padName } from '../audio/drums.js';
import { TRACK_COLORS } from '../state.js';
import { auditionInstrument, auditionKit } from './preview.js';
import { REVERBS } from '../audio/engine.js';
import { noteLabel } from '../theory.js';
import { host } from '../host.js';
import { toast } from './widgets.js';
import { showNewTrack, promptText } from './dialogs.js';

const ARP_RATES = [['1/4', 1], ['1/8', 0.5], ['1/16', 0.25], ['1/32', 0.125], ['1/8T', 1 / 3], ['1/16T', 1 / 6]];
const DELAY_DIVS = [['1/4', 1], ['Dotted 1/8', 0.75], ['1/8', 0.5], ['1/16', 0.25], ['1/8 triplet', 1 / 3]];
const pct = (v) => Math.round(v * 100) + '%';
const dB = (v) => (v > 0 ? '+' : '') + v.toFixed(1);

export function mountLeft(app, root) {
  root.replaceChildren();
  const tabs = h('div', { class: 'tabs' });
  const body = h('div', { class: 'panel-body' });
  root.append(tabs, body);
  let knobs = {};     // path -> knob element (for live sync)

  const mkTab = (id, label, ic) => h('button', { class: 'tab' + (app.view.leftTab === id ? ' on' : ''), onClick: () => { app.view.leftTab = id; render(); } }, icon(ic, 15), label);

  function render() {
    renderedTab = app.view.leftTab;
    tabs.replaceChildren(mkTab('track', 'Track', 'gear'), mkTab('sounds', 'Sounds', 'speaker'));
    knobs = {};
    body.replaceChildren();
    if (app.view.leftTab === 'sounds') renderSounds(); else renderTrack();
  }

  // ------------------------------------------------------------ track tab
  function K(t, path, label, o) {
    const get = () => path.split('.').reduce((a, k) => (a == null ? a : a[k]), t);
    const k = knob({ label, value: get() ?? o.def, def: o.def, min: o.min ?? 0, max: o.max ?? 1, fmt: o.fmt || pct, color: o.color, size: 40,
      onInput: (v) => app.setTrackProp(t.id, path, v, false), onChange: (v) => app.setTrackProp(t.id, path, v, true) });
    knobs[path] = { k, get };
    return k;
  }

  function renderTrack() {
    const t = app.selTrack;
    const P = app.project;
    if (!t) {
      body.append(h('div', { class: 'empty' }, h('b', {}, 'No track selected'), 'Click a track in the timeline to shape its sound.'), projectFx());
      return;
    }
    const nameIn = h('input', { value: t.name, spellcheck: false, onChange: (e) => app.setTrackProp(t.id, 'name', e.target.value.trim() || t.name), onKeyDown: (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); } });
    body.append(h('div', { class: 'insp-head' }, h('div', { class: 't-ico', style: { background: t.color } }, icon(trackIcon(t), 20)), nameIn));
    // colour swatches
    body.append(h('div', { class: 'sect', style: { paddingBottom: '10px' } }, h('div', { class: 'row', style: { gap: '6px' } }, TRACK_COLORS.map((c) =>
      h('button', { style: { width: '22px', height: '22px', borderRadius: '50%', background: c, border: t.color === c ? '2px solid #fff' : '2px solid transparent', padding: 0 }, onClick: () => app.setTrackProp(t.id, 'color', c) })))));

    // sound
    if (t.type !== 'audio') {
      let name, desc;
      if (t.type === 'drum') { const k = KIT_BY_ID[t.kit]; name = k.name; desc = k.desc; }
      else if (t.inst === 'sampler') { const a = P.assets[t.sample && t.sample.asset]; name = 'Sampler'; desc = a ? a.name : 'No sample'; }
      else { const i = INST_BY_ID[t.inst]; name = i.name; desc = i.desc; }
      body.append(h('div', { class: 'sect' }, h('div', { class: 'sect-t' }, t.type === 'drum' ? 'Drum kit' : 'Sound'),
        h('button', { class: 'sound-btn', onClick: () => { app.view.leftTab = 'sounds'; render(); } }, icon(trackIcon(t), 20), h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { class: 'sb-n' }, name), h('div', { class: 'sb-d' }, desc)), icon('chevronR', 16))));
    }

    if (t.type !== 'audio') body.append(h('div', { class: 'row', style: { padding: '0 14px 10px' } }, button('+ Another line of this sound', () => app.addLine(t.id), { class: 'sm', title: 'A second track with the same instrument and settings, so two can play together' })));
    // smart controls
    if (t.type !== 'audio') {
      const ks = t.type === 'drum' ? [K(t, 'params.tone', 'Tune', { def: 0.5 }), K(t, 'params.release', 'Decay', { def: 1 })]
        : t.inst === 'sampler' ? [K(t, 'params.attack', 'Attack', { def: 0.5 }), K(t, 'params.release', 'Release', { def: 0.5 })]
          : [K(t, 'params.tone', INST_BY_ID[t.inst] && INST_BY_ID[t.inst].id === 'choir' ? 'Vowel' : 'Tone', { def: 0.5 }), K(t, 'params.attack', 'Attack', { def: 0.5 }), K(t, 'params.release', 'Release', { def: 0.5 }),
            K(t, 'transpose', 'Pitch', { def: 0, min: -24, max: 24, step: 1, fmt: (v) => (v > 0 ? '+' : '') + Math.round(v) + ' st', color: '#8f7bff' })];
      body.append(h('div', { class: 'sect' }, h('div', { class: 'sect-t' }, 'Smart controls'), h('div', { class: 'knobs' }, ks)));
    }

    // mix
    body.append(h('div', { class: 'sect' }, h('div', { class: 'sect-t' }, 'Mix'), h('div', { class: 'knobs' },
      K(t, 'vol', 'Volume', { def: 0.78, fmt: (v) => Math.round(v * 100), color: '#5ed16a' }),
      K(t, 'pan', 'Pan', { def: 0, min: -1, max: 1, fmt: (v) => (Math.abs(v) < 0.02 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100)), color: '#8f7bff' }),
      K(t, 'send.rev', 'Reverb', { def: 0.12, color: '#4aa3ff' }),
      K(t, 'send.del', 'Delay', { def: 0, color: '#2ed3b7' }))));

    // EQ + compressor
    const hz = (f) => (f >= 1000 ? (f / 1000).toFixed(1) + 'k' : Math.round(f));
    body.append(h('div', { class: 'sect' }, h('div', { class: 'sect-t' }, 'EQ & effects'), h('div', { class: 'knobs' },
      K(t, 'eq.lo', 'Bass', { def: 0, min: -12, max: 12, fmt: dB, color: '#ff9f43' }), K(t, 'eq.mid', 'Mid', { def: 0, min: -12, max: 12, fmt: dB, color: '#ff9f43' }),
      K(t, 'eq.hi', 'Treble', { def: 0, min: -12, max: 12, fmt: dB, color: '#ff9f43' }), K(t, 'comp', 'Squash', { def: 0, color: '#ff6fb5', fmt: pct }),
      K(t, 'drive', 'Drive', { def: 0, color: '#ff5f57', fmt: pct }),
      K(t, 'filter', 'Filter', { def: 0, min: -1, max: 1, color: '#2ed3b7', fmt: (v) => (Math.abs(v) < 0.03 ? 'off' : v < 0 ? 'LP ' + hz(20000 * Math.pow(0.012, -v)) : 'HP ' + hz(20 * Math.pow(250, v))) }))));

    // arpeggiator
    if (t.type === 'inst') {
      const a = t.arp;
      body.append(h('div', { class: 'sect' }, h('div', { class: 'sect-t' }, h('span', {}, 'Arpeggiator'),
        h('input', { type: 'checkbox', class: 'switch', checked: a.on, onChange: (e) => app.setTrackProp(t.id, 'arp.on', e.target.checked) })),
        h('div', { class: 'row wrap', style: { gap: '8px' } },
          h('select', { class: 'sel', title: 'Pattern', onChange: (e) => app.setTrackProp(t.id, 'arp.mode', e.target.value) }, [['up', 'Up'], ['down', 'Down'], ['updown', 'Up & down'], ['random', 'Random'], ['played', 'As played']].map(([v, l]) => h('option', { value: v, selected: a.mode === v }, l))),
          h('select', { class: 'sel', title: 'Speed', onChange: (e) => app.setTrackProp(t.id, 'arp.rate', +e.target.value) }, ARP_RATES.map(([l, v]) => h('option', { value: v, selected: Math.abs(a.rate - v) < 0.001 }, l))),
          h('select', { class: 'sel', title: 'Octaves', onChange: (e) => app.setTrackProp(t.id, 'arp.oct', +e.target.value) }, [1, 2, 3].map((o) => h('option', { value: o, selected: a.oct === o }, o + (o === 1 ? ' octave' : ' octaves')))),
          h('span', { class: 'hint' }, 'Turns the chords in this track\'s regions into arpeggios when played.'))));
    }

    // sampler options
    if (t.type === 'inst' && t.inst === 'sampler' && t.sample) {
      const s = t.sample;
      body.append(h('div', { class: 'sect' }, h('div', { class: 'sect-t' }, 'Sample'),
        h('div', { class: 'row wrap' },
          h('span', { class: 'hint' }, 'Original pitch'),
          h('select', { class: 'sel', onChange: (e) => app.setTrackProp(t.id, 'sample.root', +e.target.value) }, Array.from({ length: 73 }, (_, i) => 24 + i).map((m) => h('option', { value: m, selected: s.root === m }, noteLabel(m)))),
          h('label', { class: 'row' }, h('input', { type: 'checkbox', class: 'switch', checked: !!s.loop, onChange: (e) => app.setTrackProp(t.id, 'sample.loop', e.target.checked) }), h('span', {}, 'Loop while held')))));
    }

    // drum pad samples
    if (t.type === 'drum') {
      const items = PAD_NAMES.map((n0, i) => {
        const n = padName(t.kit, i);
        const ps = t.padSamples && t.padSamples[i];
        const a = ps && P.assets[typeof ps === 'object' ? ps.asset : ps];
        return h('div', { class: 'pad-item' + (a ? ' custom' : ''), title: a ? 'Using your sample: ' + a.name : 'Click to hear • use ⤒ to swap in your own sample' },
          h('span', { class: 'pn', style: { cursor: 'pointer' }, onPointerDown: () => { app.ctx.resume(); app.engine.liveOn(t, PAD_BASE + i, 110); setTimeout(() => app.engine.liveOff(t, PAD_BASE + i), 120); } }, n),
          a ? iconBtn('close', 'Back to the kit sound', () => { delete t.padSamples[i]; app.commit('structure'); }, 'sm', 13)
            : iconBtn('upload', 'Load your own sample onto this pad', () => loadPadSample(t, i), 'sm', 13));
      });
      body.append(h('div', { class: 'sect' }, h('div', { class: 'sect-t' }, 'Pads'), h('div', { class: 'pad-list' }, items)));
    }

    body.append(h('div', { class: 'sect' }, button('Delete track', () => app.deleteTrack(t.id), { icon: 'trash', class: 'sm' })), projectFx());
  }

  async function loadPadSample(t, i) {
    const f = await host.openDialog({ title: 'Choose a sample for ' + padName(t.kit, i), filter: 'Audio files (*.wav *.mp3 *.ogg *.flac *.m4a *.aif *.aiff)' });
    if (!f.length) return;
    const it = typeof f[0] === 'string' ? { path: f[0], name: f[0].split(/[\\/]/).pop() } : f[0];
    try {
      const buf = await app.decodeFile(it);
      const a = app.makeAsset(it.name.replace(/\.[^.]+$/, ''), buf);
      t.padSamples = t.padSamples || {}; t.padSamples[i] = a.id;
      app.commit('structure');
    } catch { toast('Could not read that audio file', 'error'); }
  }

  function projectFx() {
    const P = app.project;
    const kSwing = knob({ label: 'Swing', value: P.swing, def: 0, size: 40, fmt: pct, color: '#ffd23f', onInput: (v) => { P.swing = v; app.touch('params'); }, onChange: () => app.commit('meta') });
    return h('div', { class: 'sect' }, h('div', { class: 'sect-t' }, 'Whole song'),
      h('div', { class: 'row wrap', style: { gap: '10px', alignItems: 'flex-start' } }, kSwing,
        h('div', { style: { display: 'grid', gap: '6px', flex: 1 } },
          h('div', { class: 'row' }, h('span', { class: 'hint', style: { width: '58px' } }, 'Reverb'), h('select', { class: 'sel', style: { flex: 1 }, onChange: (e) => app.setFx('reverb', e.target.value) }, Object.entries(REVERBS).map(([k, v]) => h('option', { value: k, selected: P.fx.reverb === k }, v.name)))),
          h('div', { class: 'row' }, h('span', { class: 'hint', style: { width: '58px' } }, 'Echo'), h('select', { class: 'sel', style: { flex: 1 }, onChange: (e) => app.setFx('delayDiv', +e.target.value) }, DELAY_DIVS.map(([l, v]) => h('option', { value: v, selected: Math.abs(P.fx.delayDiv - v) < 0.001 }, l)))),
          h('div', { class: 'row' }, h('span', { class: 'hint', style: { width: '58px' } }, 'Repeats'), h('input', { type: 'range', min: 0, max: 0.8, step: 0.01, value: P.fx.delayFb, style: { flex: 1, width: 'auto' }, onInput: (e) => { P.fx.delayFb = +e.target.value; app.touch('params'); }, onChange: () => app.commit('params') })))));
  }

  // ------------------------------------------------------------ sounds tab
  let soundMode = 'inst', playing = null;
  function renderSounds() {
    const t = app.selTrack;
    const mode = h('div', { style: { padding: '10px 12px 4px' } }, segmented([{ id: 'inst', label: 'Instruments', icon: 'piano' }, { id: 'drum', label: 'Drum kits', icon: 'drum' }], soundMode, (m) => { soundMode = m; render(); }));
    body.append(mode);
    const q = soundQ.trim().toLowerCase();
    body.append(h('div', { style: { padding: '2px 12px 6px' } }, h('div', { class: 'search' }, icon('search', 15),
      h('input', { placeholder: soundMode === 'inst' ? `Search ${INSTRUMENTS.length} instruments…` : `Search ${KITS.length} drum kits…`, value: soundQ,
        onInput: (e) => { soundQ = e.target.value; renderSoundList(); }, onKeyDown: (e) => e.stopPropagation() }))));
    soundList = h('div', {});
    body.append(soundList);
    renderSoundList();
  }
  let soundQ = '', soundList = null;
  function renderSoundList() {
    const t = app.selTrack, q = soundQ.trim().toLowerCase();
    soundList.replaceChildren();
    const body = soundList;
    const match = (x) => !q || (x.name + ' ' + x.desc + ' ' + (x.cat || '')).toLowerCase().includes(q);
    const hint = (t && ((soundMode === 'inst' && t.type === 'inst') || (soundMode === 'drum' && t.type === 'drum')))
      ? `Click a sound to swap it onto “${t.name}”.` : `Click a sound to add it as a new ${soundMode === 'inst' ? 'instrument' : 'drum'} track.`;
    body.append(h('div', { class: 'hint', style: { padding: '4px 14px 8px' } }, hint));
    const choose = (kind, id) => {
      const cur = app.selTrack;
      if (kind === 'inst') {
        if (cur && cur.type === 'inst') { auditionInstrument(app, id); app.setInstrument(cur.id, id); }
        else { app.engine.previewStopAll(); app.addTrack('inst', { inst: id }); app.toast('Added a new track with ' + INST_BY_ID[id].name + ' — try the Play tab'); }
      } else if (cur && cur.type === 'drum') { auditionKit(app, id); app.setKit(cur.id, id); }
      else { app.engine.previewStopAll(); app.addTrack('drum', { kit: id }); app.toast('Added a new drum track with ' + KIT_BY_ID[id].name); }
    };
    const add = (kind, id) => { if (kind === 'inst') app.addTrack('inst', { inst: id }); else app.addTrack('drum', { kit: id }); };
    const row = (kind, id, name, desc, ic, active) => h('div', { class: 'list-item' + (active ? ' sel' : ''), onClick: () => choose(kind, id), onDblclick: () => add(kind, id) },
      h('div', { class: 'dot-ico' }, icon(ic, 16)), h('div', { class: 'li-main' }, h('div', { class: 'li-n' }, name), h('div', { class: 's li-s' }, desc)),
      iconBtn('plus', 'Add a new track with this sound', (e) => { e.stopPropagation(); add(kind, id); }, 'sm', 15));
    const mine = app.mySounds().filter((m) => m.kind === soundMode && (!q || m.name.toLowerCase().includes(q)));
    if (mine.length) {
      body.append(h('div', { class: 'cat-head' }, 'My sounds'));
      for (const m of mine) {
        const baseDef = soundMode === 'inst' ? INST_BY_ID[m.base] : KIT_BY_ID[m.base];
        body.append(h('div', { class: 'list-item', title: 'Click to use • double-click adds a new track',
          onClick: () => { const cur = app.selTrack; if (cur && !app.applyMySound(cur.id, m)) addMine(m); else if (!cur) addMine(m); }, onDblclick: () => addMine(m) },
          h('div', { class: 'dot-ico' }, icon(soundMode === 'inst' ? 'star' : 'drum', 16)), h('div', { class: 'li-main' }, h('div', { class: 'li-n' }, m.name), h('div', { class: 's li-s' }, 'Based on ' + (baseDef ? baseDef.name : m.base))),
          iconBtn('trash', 'Delete this saved sound', (e) => { e.stopPropagation(); app.deleteMySound(m.id); }, 'sm', 15), iconBtn('plus', 'Add a new track with this sound', (e) => { e.stopPropagation(); addMine(m); }, 'sm', 15)));
      }
    }
    function addMine(m) { const nt = m.kind === 'drum' ? app.addTrack('drum', { kit: m.base }) : app.addTrack('inst', { inst: m.base }); app.applyMySound(nt.id, m); }
    if (soundMode === 'inst') {
      for (const cat of INST_CATS) {
        const list = INSTRUMENTS.filter((x) => x.cat === cat && match(x));
        if (!list.length) continue;
        body.append(h('div', { class: 'cat-head' }, cat));
        let sub = null;
        for (const i of list) {
          if (i.sub && i.sub !== sub) { sub = i.sub; body.append(h('div', { class: 'sub-head' }, sub)); }
          body.append(row('inst', i.id, i.name, i.desc, i.icon, t && t.inst === i.id));
        }
      }
    } else for (const k of KITS.filter(match)) body.append(row('drum', k.id, k.name, k.desc, 'drum', t && t.kit === k.id));
    if (!soundList.querySelector('.list-item')) body.append(h('div', { class: 'empty' }, h('b', {}, 'No sounds found'), 'Try another word.'));
  }

  // ------------------------------------------------------------ wiring
  function syncKnobs() {
    const t = app.selTrack;
    if (!t) return;
    for (const { k, get } of Object.values(knobs)) { const v = get(); if (v != null) k.set(v); }
  }
  let pending = false;
  app.on('change', (kind) => {
    if (kind === 'params') { syncKnobs(); return; }
    if (kind === 'recording') return;
    if (pending) return;
    pending = true; queueMicrotask(() => { pending = false; render(); });
  });
  let renderedTab = null;
  app.on('selection', () => render());
  app.on('layout', () => { if (renderedTab !== app.view.leftTab) render(); });
  render();
}
