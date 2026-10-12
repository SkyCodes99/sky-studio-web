// Audio region editor: waveform, gain, fades, speed, looping and tempo sync.
import { h, clamp, gainToDb } from '../util.js';
import { icon } from './icons.js';
import { knob, button } from './widgets.js';
import { showSlice } from './slicedialog.js';

export function createAudioEditor(app) {
  let regionId = null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cv = h('canvas', { style: { position: 'absolute', inset: 0, width: '100%', height: '100%' } });
  const wrap = h('div', { class: 'ed-canvas-wrap', style: { background: '#101319' } }, cv);
  const bar = h('div', { class: 'ed-bar', style: { gap: '16px', alignItems: 'flex-start', paddingTop: '8px', paddingBottom: '8px' } });
  const root = h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } }, bar, h('div', { class: 'ed-body' }, wrap));
  const info = () => (regionId ? app.regionInfo(regionId) : null);

  function renderBar() {
    const i = info(); bar.replaceChildren(); if (!i) return;
    const r = i.region, a = app.project.assets[r.asset];
    const upd = (fn, final) => { fn(r); final ? app.commit('structure') : app.touch('structure'); };
    const k = (label, val, o) => knob({ label, value: val, size: 40, ...o });
    const maxFade = Math.max(0.25, r.len / 2);
    bar.append(
      h('div', { style: { minWidth: '150px', maxWidth: '220px' } }, h('div', { style: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, a ? a.name : 'Missing audio'), h('div', { class: 'hint' }, a ? `${a.duration.toFixed(2)} s · ${a.buffer ? a.buffer.numberOfChannels : '?'} ch` : 'This audio file was not saved with the project')),
      k('Volume', r.gain ?? 1, { min: 0, max: 2, def: 1, fmt: (v) => (v < 0.01 ? '-∞' : gainToDb(v).toFixed(1) + ' dB'), onInput: (v) => upd((x) => (x.gain = v), false), onChange: () => app.commit('structure') }),
      k('Fade in', r.fadeIn || 0, { min: 0, max: maxFade, def: 0, fmt: (v) => v.toFixed(2) + ' b', onInput: (v) => upd((x) => (x.fadeIn = v), false), onChange: () => app.commit('structure') }),
      k('Fade out', r.fadeOut || 0, { min: 0, max: maxFade, def: 0, fmt: (v) => v.toFixed(2) + ' b', onInput: (v) => upd((x) => (x.fadeOut = v), false), onChange: () => app.commit('structure') }),
      k('Speed', r.rate || 1, { min: 0.5, max: 2, def: 1, fmt: (v) => v.toFixed(2) + '×', onInput: (v) => { const old = r.rate || 1; r.len = Math.max(0.25, r.len * old / v); r.rate = v; r.sync = false; app.touch('structure'); }, onChange: () => app.commit('structure') }),
      h('div', { style: { display: 'grid', gap: '8px' } },
        h('label', { class: 'row' }, h('input', { type: 'checkbox', class: 'switch', checked: !!r.loop, onChange: (e) => { r.loop = e.target.checked; if (r.loop && a) r.srcLen = a.duration - (r.offset || 0); app.commit('structure'); } }), h('span', {}, 'Loop to fill region')),
        h('div', { class: 'row' }, h('span', { class: 'hint' }, 'Sample tempo'), h('input', { class: 'num', type: 'text', style: { width: '56px' }, value: a && a.bpm ? a.bpm : '', placeholder: '—', title: 'The tempo of this recording (BPM), if you know it', onKeyDown: (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); }, onChange: (e) => { if (a) { a.bpm = clamp(parseFloat(e.target.value) || 0, 0, 300); if (r.sync) app.syncRegion(r); app.commit('structure'); } } }),
          h('label', { class: 'row', title: 'Speed the audio up/down so it matches the song tempo' }, h('input', { type: 'checkbox', class: 'switch', checked: !!r.sync, onChange: (e) => { if (!a || !a.bpm) { e.target.checked = false; app.toast('Type the sample\'s tempo first', 'warn'); return; } r.sync = e.target.checked; if (r.sync) app.syncRegion(r); else { r.rate = 1; r.len = (a.duration - (r.offset || 0)) / app.spb; } app.commit('structure'); } }), h('span', {}, 'Match song tempo')))),
      button('Slice…', () => showSlice(app, r.asset), { class: 'sm', icon: 'scissors', title: 'Chop this audio into pieces on drum pads' }),
      button('Normalize', () => { if (!a || !a.buffer) return; let pk = 0; for (let c = 0; c < a.buffer.numberOfChannels; c++) { const d = a.buffer.getChannelData(c); for (let n = 0; n < d.length; n++) { const v = Math.abs(d[n]); if (v > pk) pk = v; } } if (pk > 0) { r.gain = clamp(0.95 / pk, 0.05, 2); app.commit('structure'); } }, { class: 'sm', title: 'Raise the volume until the loudest point just touches full scale' }));
  }

  function draw() {
    const i = info(); if (!i) return;
    const r = i.region, a = app.project.assets[r.asset];
    const w = wrap.clientWidth, hh = wrap.clientHeight;
    if (cv.width !== Math.floor(w * dpr) || cv.height !== Math.floor(hh * dpr)) { cv.width = Math.floor(w * dpr); cv.height = Math.floor(hh * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hh);
    g.fillStyle = '#101319'; g.fillRect(0, 0, w, hh);
    if (!a || !a.peaks) { g.fillStyle = '#626a7c'; g.font = '14px "Segoe UI"'; g.fillText('Audio not available', 20, 40); return; }
    const mid = hh / 2, amp = hh / 2 - 14, rate = r.rate || 1, gain = r.gain ?? 1;
    const beatPx = Math.max(10, (w - 20) / Math.max(r.len, 0.5));
    const lenSec = r.len * app.spb * rate;
    g.fillStyle = '#ffffff10'; g.fillRect(0, mid, w, 1);
    // beat grid
    for (let b = 0; b <= r.len; b++) { const x = 10 + b * beatPx; const bar = Math.abs(((r.start + b) % app.bpb)) < 1e-6; g.fillStyle = bar ? '#ffffff2a' : '#ffffff0f'; g.fillRect(x, 0, 1, hh); }
    const tr = i.track;
    g.fillStyle = tr.color;
    const srcLoop = r.loop ? (r.srcLen || a.duration - (r.offset || 0)) : Infinity;
    for (let x = 0; x < w - 20; x++) {
      const sec0 = (x / beatPx) * app.spb * rate, sec1 = ((x + 1) / beatPx) * app.spb * rate;
      let s0 = (r.offset || 0) + (r.loop ? sec0 % srcLoop : sec0), s1 = s0 + (sec1 - sec0);
      if (!r.loop && sec0 > a.duration - (r.offset || 0)) break;
      let mn = 1, mx = -1;
      for (let b = Math.floor(s0 * 200); b <= Math.max(Math.floor(s0 * 200), Math.floor(s1 * 200)); b++) {
        if (b * 2 + 1 >= a.peaks.length || b < 0) continue;
        if (a.peaks[b * 2] < mn) mn = a.peaks[b * 2]; if (a.peaks[b * 2 + 1] > mx) mx = a.peaks[b * 2 + 1];
      }
      if (mn > mx) continue;
      const fi = (r.fadeIn || 0) * beatPx, fo = (r.fadeOut || 0) * beatPx;
      let f = 1; if (fi > 0 && x < fi) f = x / fi; if (fo > 0 && x > r.len * beatPx - fo) f = Math.min(f, (r.len * beatPx - x) / fo);
      g.globalAlpha = 0.55 + 0.45 * f;
      g.fillRect(10 + x, mid - mx * amp * gain * f, 1, Math.max(1, (mx - mn) * amp * gain * f));
    }
    g.globalAlpha = 1;
    // playhead
    const b = app.pos - r.start;
    if (b >= 0 && b <= r.len && app.engine.playing) { g.fillStyle = '#fff'; g.fillRect(10 + b * beatPx, 0, 2, hh); }
  }
  new ResizeObserver(() => draw()).observe(wrap);
  return { el: root, setRegion(id) { regionId = id; renderBar(); draw(); }, refresh() { renderBar(); draw(); }, frame() { if (app.engine.playing) draw(); }, resize: draw, get regionId() { return regionId; } };
}
