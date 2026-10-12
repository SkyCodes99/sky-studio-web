// Mixer: one channel strip per track plus the master.
import { h, clamp } from '../util.js';
import { icon } from './icons.js';
import { knob, fader } from './widgets.js';
import { trackIcon } from './arrange.js';

export function createMixer(app) {
  const root = h('div', { class: 'mixer' });
  let strips = new Map(), master = null;

  function build() {
    root.replaceChildren(); strips.clear();
    const P = app.project;
    for (const t of P.tracks) {
      const f = fader({ value: t.vol, onInput: (v) => app.setTrackProp(t.id, 'vol', v, false), onChange: (v) => app.setTrackProp(t.id, 'vol', v, true) });
      const pan = knob({ label: 'Pan', value: t.pan, min: -1, max: 1, def: 0, size: 30, fmt: (v) => (Math.abs(v) < 0.02 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100)), color: '#8f7bff', onInput: (v) => app.setTrackProp(t.id, 'pan', v, false), onChange: (v) => app.setTrackProp(t.id, 'pan', v, true) });
      const rev = knob({ label: 'Rev', value: t.send.rev, size: 30, def: 0.12, fmt: (v) => Math.round(v * 100), color: '#4aa3ff', onInput: (v) => app.setTrackProp(t.id, 'send.rev', v, false), onChange: (v) => app.setTrackProp(t.id, 'send.rev', v, true) });
      const del = knob({ label: 'Echo', value: t.send.del, size: 30, def: 0, fmt: (v) => Math.round(v * 100), color: '#2ed3b7', onInput: (v) => app.setTrackProp(t.id, 'send.del', v, false), onChange: (v) => app.setTrackProp(t.id, 'send.del', v, true) });
      const m = h('button', { class: 'mini m' + (t.mute ? ' on' : ''), onClick: () => app.toggleMute(t.id) }, 'M');
      const s = h('button', { class: 'mini s' + (t.solo ? ' on' : ''), onClick: () => app.toggleSolo(t.id) }, 'S');
      const el = h('div', { class: 'strip' + (app.sel.track === t.id ? ' sel' : ''), onPointerDown: () => app.selectTrack(t.id) },
        h('div', { class: 's-name', style: { borderColor: t.color }, title: t.name }, t.name),
        h('div', { class: 's-head' }, h('div', { class: 't-ico', style: { background: t.color, width: '24px', height: '24px', borderRadius: '7px' } }, icon(trackIcon(t), 13)), m, s),
        h('div', { class: 's-knobs' }, pan, rev, del),
        h('button', { class: 'fx-badge' + ((t.fx || []).some((e) => e.on !== false) ? ' on' : ''), title: 'Open this track\'s effects', onClick: () => { app.selectTrack(t.id); app.view.bottom = 'fx'; app.emit('layout'); } }, (t.fx || []).length ? (t.fx || []).length + ' fx' : '+ fx'), f);
      strips.set(t.id, { el, f, pan, rev, del, m, s, track: t });
      root.append(el);
    }
    if (!P.tracks.length) root.append(h('div', { class: 'empty', style: { flex: 1 } }, h('b', {}, 'No tracks yet'), 'Add a track and it will get a channel strip here.'));
    const mf = fader({ value: P.masterVol, onInput: (v) => app.setMasterVol(v, false), onChange: (v) => app.setMasterVol(v, true) });
    master = { f: mf };
    root.append(h('div', { class: 'strip master' }, h('div', { class: 's-name', style: { borderColor: '#e9ecf3' } }, 'Master'), h('div', { class: 't-ico', style: { background: '#cfd5e3', width: '28px', height: '28px' } }, icon('speaker', 15)), h('div', { style: { flex: 1 } }), mf));
  }

  function sync() {
    for (const [id, s] of strips) {
      const t = app.track(id); if (!t) continue;
      s.f.set(t.vol); s.pan.set(t.pan); s.rev.set(t.send.rev); s.del.set(t.send.del);
      s.m.classList.toggle('on', t.mute); s.s.classList.toggle('on', t.solo);
    }
    if (master) master.f.set(app.project.masterVol);
  }
  function frame() {
    for (const [id, s] of strips) s.f.level(app.engine.trackLevel(id));
    if (master) { const [l, r] = app.engine.masterLevels(); master.f.level(Math.max(l, r)); }
  }
  let pending = false;
  app.on('change', (k) => {
    if (k === 'params') { sync(); return; }
    if (k === 'recording') return;
    if (pending) return; pending = true; queueMicrotask(() => { pending = false; build(); });
  });
  app.on('selection', () => { for (const [id, s] of strips) s.el.classList.toggle('sel', app.sel.track === id); });
  build();
  return { el: root, frame };
}
