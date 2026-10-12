// Effects rack: per-track (and master) chain of insert effects drawn as cards with knobs.
import { h, clamp } from '../util.js';
import { icon } from './icons.js';
import { knob, segmented, button, iconBtn, showMenu } from './widgets.js';
import { FX, FX_ORDER, FX_PRESETS } from '../audio/fx.js';
import { listFxPlugins, fxType } from '../audio/plugins.js';
import { showPlugins } from './plugins.js';

export function createFxRack(app) {
  let mode = 'track';                       // 'track' (the selected track) | 'master'
  const root = h('div', { class: 'fx-rack' });
  let refs = [];                            // knobs to keep in sync while something else changes values

  const targetId = () => (mode === 'master' ? 'master' : app.sel.track);
  const list = () => { const id = targetId(); if (!id) return null; return app.fxList(id, false); };

  const toNorm = (p, v) => (p.log ? Math.log(v / p.min) / Math.log(p.max / p.min) : (v - p.min) / (p.max - p.min));
  const fromNorm = (p, n) => { n = clamp(n, 0, 1); let v = p.log ? p.min * Math.pow(p.max / p.min, n) : p.min + n * (p.max - p.min); if (p.step) v = Math.round(v / p.step) * p.step; return v; };

  function paramControl(id, e, p) {
    if (p.type === 'select') {
      const sel = h('select', { class: 'sel', onChange: (ev) => app.setFxParam(id, e.id, p.id, parseFloat(ev.target.value), true) },
        p.options.map(([l, v]) => h('option', { value: v, selected: Math.abs((e.p[p.id] ?? p.def) - v) < 1e-6 }, l)));
      return h('div', { class: 'fx-sel' }, h('span', { class: 'k-label' }, p.label), sel);
    }
    if (p.type === 'track') {
      const others = app.project.tracks.filter((t) => t.id !== id);
      const sel = h('select', { class: 'sel', onChange: (ev) => app.setFxParam(id, e.id, p.id, ev.target.value, true) },
        [h('option', { value: '' }, others.length ? '— choose a track —' : 'no other tracks'), ...others.map((t) => h('option', { value: t.id, selected: e.p[p.id] === t.id }, t.name))]);
      return h('div', { class: 'fx-sel wide' }, h('span', { class: 'k-label' }, p.label), sel);
    }
    const cur = () => e.p[p.id] ?? p.def;
    const k = knob({ label: p.label, value: toNorm(p, cur()), min: 0, max: 1, def: toNorm(p, p.def), size: 38, color: FX[e.type].color,
      fmt: (n) => p.fmt(fromNorm(p, n)),
      onInput: (n) => app.setFxParam(id, e.id, p.id, fromNorm(p, n), false), onChange: (n) => app.setFxParam(id, e.id, p.id, fromNorm(p, n), true) });
    refs.push({ k, get: () => toNorm(p, cur()) });
    return k;
  }

  function card(id, e, idx, total) {
    const def = FX[e.type];
    const presets = FX_PRESETS[e.type] || [];
    const visible = def.params.filter((p) => !p.showIf || p.showIf(e.p));
    return h('div', { class: 'fx-card' + (e.on === false ? ' off' : ''), style: { '--fxc': def.color } },
      h('div', { class: 'fx-head' },
        h('button', { class: 'fx-pow' + (e.on === false ? '' : ' on'), title: e.on === false ? 'Turn on' : 'Bypass', onClick: () => app.toggleFx(id, e.id) }, icon('check', 12)),
        h('div', { class: 'fx-title', title: def.desc }, def.name),
        presets.length ? h('button', { class: 'fx-btn', title: 'Presets', onClick: (ev) => { const r = ev.currentTarget.getBoundingClientRect(); showMenu(presets.map(([n, v]) => ({ label: n, onClick: () => app.applyFxPreset(id, e.id, v) })), r.left, r.bottom + 4); } }, 'Presets ▾') : null,
        h('span', { style: { flex: 1 } }),
        idx > 0 ? iconBtn('chevron', 'Move earlier', () => app.moveFx(id, e.id, -1), 'sm rot-l', 14) : null,
        idx < total - 1 ? iconBtn('chevronR', 'Move later', () => app.moveFx(id, e.id, 1), 'sm', 14) : null,
        iconBtn('close', 'Remove', () => app.removeFx(id, e.id), 'sm', 14)),
      h('div', { class: 'fx-params' }, visible.map((p) => paramControl(id, e, p))));
  }

  function build() {
    refs = [];
    root.replaceChildren();
    const id = targetId(), t = id && id !== 'master' ? app.track(id) : null;
    const fl = id ? app.fxList(id, false) || [] : [];
    const tabs = segmented([{ id: 'track', label: t ? t.name : 'Track' }, { id: 'master', label: 'Master' }], mode, (m) => { mode = m; build(); }, 'fx-seg');
    const addBtn = button('Add effect', (ev) => {
      if (!id) return;
      const r = ev.currentTarget.getBoundingClientRect();
      const plug = listFxPlugins().map((p) => ({ label: p.name, hint: (p.desc || 'plugin').split(/[.—]/)[0].slice(0, 28), onClick: () => app.addFx(id, fxType(p.id)) }));
      showMenu([...FX_ORDER.map((ty) => ({ label: FX[ty].name, hint: FX[ty].desc.split(' — ')[0].slice(0, 28), onClick: () => app.addFx(id, ty) })),
        { sep: true }, ...(plug.length ? [{ label: 'Plugins', disabled: true }, ...plug] : []), { label: 'Manage plugins…', onClick: () => showPlugins(app) }], r.left, r.bottom + 4);
    }, { icon: 'plus', class: 'primary sm' });
    root.append(h('div', { class: 'ed-bar' }, tabs, addBtn,
      fl.length ? button('Clear all', () => app.clearFx(id), { class: 'sm ghost' }) : null,
      h('span', { style: { flex: 1 } }),
      h('span', { class: 'hint' }, mode === 'master' ? 'Effects on the whole song, just before the final limiter.' : 'Effects run left → right. Double-click a knob to reset it. Tip: the Reverb / Echo knobs in the Track panel share one effect and use less CPU.')));
    if (!id) { root.append(h('div', { class: 'empty', style: { margin: 'auto' } }, h('b', {}, 'Select a track'), 'Click a track to give it effects.')); return; }
    if (!fl.length) {
      root.append(h('div', { class: 'fx-empty' }, h('div', {}, h('b', {}, mode === 'master' ? 'No master effects' : `No effects on “${t ? t.name : ''}”`),
        h('p', { class: 'hint' }, 'Add reverb, echo, chorus, distortion, a filter, a compressor, or make a track duck under the kick with Sidechain.'),
        h('div', { class: 'row wrap', style: { justifyContent: 'center' } }, ['reverb', 'delay', 'drive', 'filter', 'sidechain'].map((ty) => button(FX[ty].name, () => app.addFx(id, ty), { class: 'sm' }))))));
      return;
    }
    root.append(h('div', { class: 'fx-slots' }, fl.map((e, i) => card(id, e, i, fl.length))));
  }

  function sync() { for (const { k, get } of refs) k.set(get()); }
  let pending = false;
  const rebuild = () => { if (pending) return; pending = true; queueMicrotask(() => { pending = false; build(); }); };
  app.on('fxchanged', rebuild);
  app.on('selection', rebuild);
  app.on('change', (kind) => { if (kind === 'params') sync(); else if (kind !== 'recording') rebuild(); });
  build();
  return { el: root, refresh: build };
}
