// Beat sequencer for drum regions: 16 pads x steps, click or paint to place hits, shift-click to change accent.
import { h, clamp, uid } from '../util.js';
import { icon } from './icons.js';
import { iconBtn, button, dragTracker, showMenu } from './widgets.js';
import { PAD_NAMES, PAD_BASE, padName } from '../audio/drums.js';
import { LOOPS, buildLoop } from '../library/loops.js';

const LABEL_W = 104, RULER = 22, ROW_H = 26;
const RES = [['1/8', 0.5], ['1/16', 0.25], ['1/32', 0.125], ['1/16 triplet', 1 / 6], ['1/8 triplet', 1 / 3]];

export function createStepSeq(app) {
  let regionId = null, res = 0.25, scrollL = 0, scrollT = 0;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cv = h('canvas', { style: { position: 'sticky', left: 0, top: 0, display: 'block' } });
  const content = h('div', { style: { position: 'relative' } }, cv);
  const scroller = h('div', { class: 'pr-scroll' }, content);
  const playhead = h('div', { style: { position: 'absolute', top: 0, bottom: 0, width: '2px', background: '#fff', boxShadow: '0 0 6px #fff9', pointerEvents: 'none', display: 'none', zIndex: 3 } });
  const wrap = h('div', { class: 'ed-canvas-wrap' }, scroller, playhead);
  const bar = h('div', { class: 'ed-bar' });
  const root = h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } }, bar, h('div', { class: 'ed-body' }, wrap));

  const info = () => (regionId ? app.regionInfo(regionId) : null);
  const L = (r) => r.loopLen || r.len;
  const stepW = () => {
    const base = clamp(res >= 0.5 ? 40 : res >= 0.25 ? 28 : 18, 14, 44);
    const i = info();
    if (!i) return base;
    const fit = (scroller.clientWidth - LABEL_W - 24) / cols(i.region);       // short patterns stretch to fill the panel
    return clamp(Math.max(base, Math.min(60, fit)), 14, 60);
  };
  const cols = (r) => Math.max(1, Math.round(L(r) / res));
  const lenInput = h('input', { class: 'num', type: 'text', style: { width: '44px' }, onChange: (e) => setBars(parseFloat(e.target.value)), onKeyDown: (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); } });
  const resSel = h('select', { class: 'sel', title: 'Step size', onChange: (e) => { res = +e.target.value; refresh(); } }, RES.map(([l, v]) => h('option', { value: v, selected: v === res }, l)));
  const patSel = h('select', { class: 'sel', title: 'Replace this pattern with a library groove', style: { maxWidth: '170px' }, onChange: (e) => { if (e.target.value) loadPattern(e.target.value); e.target.value = ''; } },
    [h('option', { value: '' }, 'Load a groove…'), ...groupBy(LOOPS.filter((l) => l.kind === 'drum' && l.cat === 'Drums'), (l) => l.genre).map(([g, ls]) => h('optgroup', { label: g }, ls.map((l) => h('option', { value: l.id }, l.name))))]);
  function groupBy(arr, f) { const m = new Map(); for (const x of arr) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return [...m.entries()]; }
  bar.append(h('span', { class: 'lbl' }, 'Steps'), resSel, h('span', { class: 'lbl' }, 'Length'), lenInput, h('span', { class: 'lbl' }, 'bars'), patSel,
    button('Copy to 2×', () => doubleIt(), { class: 'sm', title: 'Repeat the pattern to fill a pattern twice as long' }),
    iconBtn('chevronR', 'Shift all hits one step later', () => shift(1), 'sm', 15),
    button('Variation', () => variation(), { class: 'sm', title: 'Add small random changes — ghost notes, moved kick, loudness wobble' }),
    button('Clear', () => { const i = info(); i.region.notes = []; done(); }, { class: 'sm' }),
    h('div', { style: { flex: 1 } }),
    h('span', { class: 'hint' }, 'Click or drag to paint • Shift-click a hit for loudness • right-click a pad name for level, tune & row tools'));

  function layout() {
    const i = info(); if (!i) return;
    const r = i.region;
    content.style.width = Math.max(scroller.clientWidth, LABEL_W + cols(r) * stepW() + 40) + 'px';
    content.style.height = RULER + 16 * ROW_H + 10 + 'px';
    const w = Math.max(10, scroller.clientWidth), hh = Math.max(10, scroller.clientHeight);
    if (cv.width !== Math.floor(w * dpr) || cv.height !== Math.floor(hh * dpr)) { cv.width = Math.floor(w * dpr); cv.height = Math.floor(hh * dpr); cv.style.width = w + 'px'; cv.style.height = hh + 'px'; }
  }

  const padOfRow = (row) => row;                     // Kick on top
  const noteNear = (r, pad, b, tol) => r.notes.filter((n) => n.p === PAD_BASE + pad && Math.abs(n.s - b) <= tol);

  function draw() {
    const i = info(); if (!i) return;
    const { track, region: r } = i;
    scrollL = scroller.scrollLeft; scrollT = scroller.scrollTop;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = cv.width / dpr, hh = cv.height / dpr, sw = stepW(), n = cols(r);
    g.clearRect(0, 0, w, hh);
    g.fillStyle = '#14161c'; g.fillRect(0, 0, w, hh);
    const stepsPerBeat = Math.round(1 / res * 1000) / 1000;
    for (let row = 0; row < 16; row++) {
      const y = RULER + row * ROW_H - scrollT;
      if (y + ROW_H < RULER || y > hh) continue;
      g.fillStyle = row % 2 ? '#191c23' : '#1c1f27'; g.fillRect(LABEL_W, y, w, ROW_H);
      // cells
      for (let c = 0; c < n; c++) {
        const x = LABEL_W + c * sw - scrollL;
        if (x + sw < LABEL_W || x > w) continue;
        const beatIdx = Math.floor((c * res) + 1e-6);
        const strong = Math.floor((c * res) / 1 + 1e-6) % 2 === 0;
        g.fillStyle = strong ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.14)';
        g.fillRect(x + 1, y + 2, sw - 2, ROW_H - 4);
      }
    }
    // hits
    for (const nn of r.notes) {
      const pad = nn.p - PAD_BASE;
      if (pad < 0 || pad > 15) continue;
      const row = pad, y = RULER + row * ROW_H - scrollT;
      const x = LABEL_W + (nn.s / res) * sw - scrollL;
      if (x + sw < LABEL_W || x > w || y + ROW_H < RULER || y > hh) continue;
      const a = 0.4 + 0.6 * (nn.v / 127);
      g.globalAlpha = a; g.fillStyle = track.color;
      rr(g, x + 1, y + 2, sw - 2, ROW_H - 4, 4); g.fill();
      g.globalAlpha = 1;
      if (nn.v >= 118) { g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(x + 4, y + 4, sw - 8, 3); }
      else if (nn.v < 70) { g.fillStyle = 'rgba(0,0,0,.35)'; rr(g, x + 1, y + 2, sw - 2, ROW_H - 4, 4); g.fill(); }
    }
    // beat lines + ruler
    g.fillStyle = '#181b22'; g.fillRect(0, 0, w, RULER);
    g.font = '10.5px "Segoe UI"'; g.textBaseline = 'middle';
    for (let c = 0; c <= n; c++) {
      const beat = c * res, x = LABEL_W + c * sw - scrollL;
      if (x < LABEL_W - 1 || x > w) continue;
      const isBeat = Math.abs(beat - Math.round(beat)) < 1e-6;
      const abs = r.start + beat, isBar = isBeat && Math.abs(((abs % app.bpb) + app.bpb) % app.bpb) < 1e-6;
      if (isBeat) { g.fillStyle = isBar ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.12)'; g.fillRect(x, RULER, 1, hh); }
      if (isBar) { g.fillStyle = '#c3cadb'; g.fillText(String(Math.round(abs / app.bpb) + 1), x + 4, 11); }
      else if (isBeat) { g.fillStyle = '#626a7c'; g.fillText(String((Math.round(beat) % app.bpb) + 1), x + 4, 11); }
    }
    g.fillStyle = '#0b0c10'; g.fillRect(0, RULER - 1, w, 1);
    // labels
    g.fillStyle = '#181b22'; g.fillRect(0, 0, LABEL_W, hh);
    for (let row = 0; row < 16; row++) {
      const y = RULER + row * ROW_H - scrollT;
      if (y + ROW_H < RULER || y > hh) continue;
      const has = track.padSamples && track.padSamples[row];
      g.fillStyle = row % 2 ? '#1d2028' : '#20232c'; g.fillRect(0, y, LABEL_W - 1, ROW_H);
      g.fillStyle = track.color; g.fillRect(0, y + 3, 3, ROW_H - 6);
      g.fillStyle = has ? '#9fd0ff' : '#c3cadb'; g.font = '12px "Segoe UI"'; g.textBaseline = 'middle';
      g.fillText(padName(track.kit, row) + (has ? ' ♪' : ''), 12, y + ROW_H / 2);
    }
    g.fillStyle = '#181b22'; g.fillRect(0, 0, LABEL_W, RULER);
    g.fillStyle = '#626a7c'; g.font = '10.5px "Segoe UI"'; g.fillText('Pad', 12, 11);
    g.fillStyle = '#0b0c10'; g.fillRect(LABEL_W - 1, 0, 1, hh);
  }
  function rr(g, x, y, w, h2, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h2, r); g.arcTo(x + w, y + h2, x, y + h2, r); g.arcTo(x, y + h2, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  // ---- interaction
  const cellAt = (e) => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    return { x, y, col: Math.floor((x - LABEL_W + scrollL) / stepW()), row: Math.floor((y - RULER + scrollT) / ROW_H) };
  };
  function audition(pad, v = 105) {
    const i = info(); if (!i) return;
    app.ctx.resume(); app.engine.liveOn(i.track, PAD_BASE + pad, v); setTimeout(() => app.engine.liveOff(i.track, PAD_BASE + pad), 150);
  }
  cv.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const i = info(); if (!i) return;
    const c = cellAt(e);
    if (c.x >= LABEL_W || c.row < 0 || c.row > 15) return;
    const t = i.track, pm = (t.padMix = t.padMix || {}), cur = (pm[c.row] = pm[c.row] || {});
    const set = (k, v) => { cur[k] = v; if ((cur.gain ?? 1) === 1 && !cur.tune) delete pm[c.row]; app.commit('structure'); };
    showMenu([
      { label: padName(t.kit, c.row) + ' — level', disabled: true },
      ...[0.5, 0.75, 1, 1.25, 1.6].map((g) => ({ label: Math.round(g * 100) + '%', checked: (cur.gain ?? 1) === g, onClick: () => set('gain', g) })),
      { sep: true }, { label: padName(t.kit, c.row) + ' — tuning', disabled: true },
      ...[-12, -5, -2, 0, 2, 5, 12].map((st) => ({ label: (st > 0 ? '+' : '') + st + ' semitones', checked: (cur.tune || 0) === st, onClick: () => set('tune', st) })),
      { sep: true }, { label: padName(t.kit, c.row) + ' — row tools', disabled: true },
      { label: 'Fill every step', onClick: () => fillRow(c.row, (n) => n % 1 === 0) },
      { label: 'Every 2nd step', onClick: () => fillRow(c.row, (n) => n % 2 === 0) },
      { label: 'Every 4th step (four on the floor)', onClick: () => fillRow(c.row, (n) => n % 4 === 0) },
      { label: 'Off-beats', onClick: () => fillRow(c.row, (n) => n % 4 === 2) },
      ...[3, 5, 7].map((k) => ({ label: `Euclidean — ${k} hits spread evenly`, onClick: () => euclid(c.row, k) })),
      { label: 'Random sprinkle', onClick: () => fillRow(c.row, () => Math.random() < 0.25) },
      { label: 'Clear this row', onClick: () => fillRow(c.row, () => false) },
    ], e.clientX, e.clientY);
  });
  cv.addEventListener('pointerdown', (e) => {
    const i = info(); if (!i) return;
    const r = i.region, c = cellAt(e);
    if (c.x < LABEL_W) { if (c.row >= 0 && c.row < 16) audition(c.row); return; }
    if (c.y < RULER) { const b = Math.max(0, (c.x - LABEL_W + scrollL) / stepW() * res); app.seek(r.start + b); return; }
    if (c.row < 0 || c.row > 15 || c.col < 0 || c.col >= cols(r)) return;
    const right = e.button === 2;
    const first = noteNear(r, c.row, c.col * res, res * 0.49);
    if (e.shiftKey && first.length) {
      const cur = first[0].v, nv = cur >= 118 ? 52 : cur >= 85 ? 125 : 100;
      for (const n of first) n.v = nv;
      audition(c.row, nv); done(); return;
    }
    const mode = right || first.length ? 'erase' : 'add';
    const seen = new Set();
    const apply = (col, row) => {
      const key = row * 10000 + col; if (seen.has(key) || row < 0 || row > 15 || col < 0 || col >= cols(r)) return; seen.add(key);
      const near = noteNear(r, row, col * res, res * 0.49);
      if (mode === 'erase') { if (near.length) r.notes = r.notes.filter((n) => !near.includes(n)); }
      else if (!near.length) { r.notes.push({ id: uid(), s: col * res, d: Math.min(0.25, res), p: PAD_BASE + row, v: 100 }); audition(row); }
      draw();
    };
    apply(c.col, c.row);
    dragTracker(e, (dx, dy, m) => { const k = cellAt(m); apply(k.col, k.row); }, () => done());
  });

  function stepsOf(r) { return Math.max(1, Math.round(L(r) / res)); }
  function fillRow(row, pick) {
    const i = info(); if (!i) return;
    const r = i.region, n = stepsOf(r);
    r.notes = r.notes.filter((x) => x.p !== PAD_BASE + row);
    for (let k = 0; k < n; k++) if (pick(k, n)) r.notes.push({ id: uid(), s: k * res, d: Math.min(0.25, res), p: PAD_BASE + row, v: k % 4 === 0 ? 110 : 92 });
    done();
  }
  function euclid(row, hits) {
    const i = info(); if (!i) return;
    const n = stepsOf(i.region), on = new Set();
    for (let k = 0; k < hits; k++) on.add(Math.floor((k * n) / hits));
    fillRow(row, (k) => on.has(k));
  }
  /** Gentle random variation: ghost hats, a moved kick, a snare ghost note, loudness wobble. */
  function variation() {
    const i = info(); if (!i) return;
    const r = i.region, n = stepsOf(r), has = (row, k) => r.notes.some((x) => x.p === PAD_BASE + row && Math.abs(x.s - k * res) < res * 0.45);
    for (let k = 0; k < n; k++) {
      if (Math.random() < 0.12 && !has(5, k) && !has(6, k)) r.notes.push({ id: uid(), s: k * res, d: 0.125, p: PAD_BASE + 6, v: 55 + Math.random() * 20 });
      if (Math.random() < 0.06 && !has(2, k) && k % 4 !== 0) r.notes.push({ id: uid(), s: k * res, d: 0.125, p: PAD_BASE + 2, v: 48 + Math.random() * 16 });
    }
    for (const x of r.notes) x.v = clamp(Math.round(x.v + (Math.random() - 0.5) * 16), 30, 127);
    const kicks = r.notes.filter((x) => x.p === PAD_BASE).filter((x) => x.s > 0.4);
    if (kicks.length && Math.random() < 0.6) { const kx = kicks[Math.floor(Math.random() * kicks.length)]; kx.s = clamp(kx.s + (Math.random() < 0.5 ? -res : res), 0, L(r) - res); }
    done();
  }
  function done() { app.commit('structure'); }
  function setBars(b) {
    const i = info(); if (!i || !(b > 0)) { refresh(); return; }
    const r = i.region, oldL = L(r), newL = Math.max(0.25, Math.round(b * 4) / 4 * app.bpb);
    r.loopLen = newL;
    if (Math.abs(r.len - oldL) < 1e-6 || r.len < newL) r.len = newL;
    r.notes = r.notes.filter((n) => n.s < newL);
    done();
  }
  function doubleIt() {
    const i = info(); if (!i) return;
    const r = i.region, l0 = L(r);
    const add = r.notes.map((n) => ({ ...n, id: uid(), s: n.s + l0 }));
    r.notes.push(...add); r.loopLen = l0 * 2; if (r.len < r.loopLen) r.len = r.loopLen;
    done();
  }
  function shift(d) {
    const i = info(); if (!i) return;
    const r = i.region, l0 = L(r);
    for (const n of r.notes) n.s = (((n.s + d * res) % l0) + l0) % l0;
    done();
  }
  function loadPattern(id) {
    const i = info(); if (!i) return;
    const loop = LOOPS.find((l) => l.id === id);
    const b = buildLoop(loop, app.project);
    const r = i.region;
    r.notes = b.notes.map((n) => ({ id: uid(), ...n })); r.loopLen = b.len; if (r.len < b.len || Math.abs(r.len - L(r)) < 1e-6) r.len = Math.max(r.len, b.len);
    r.name = loop.name;
    done();
  }

  scroller.addEventListener('scroll', () => requestAnimationFrame(draw));
  new ResizeObserver(() => { layout(); draw(); }).observe(wrap);

  function refresh() {
    const i = info(); if (!i) return;
    if (document.activeElement !== lenInput) lenInput.value = +(L(i.region) / app.bpb).toFixed(2);
    resSel.value = String(res);
    layout(); draw();
  }
  function setRegion(id) { regionId = id; scroller.scrollLeft = 0; scroller.scrollTop = 0; refresh(); }
  function frame() {
    const i = info(); if (!i) return;
    const r = i.region, l0 = L(r);
    let b = app.pos - r.start;
    if (app.engine.playing && b >= 0 && b < r.len) {
      b = ((b % l0) + l0) % l0;
      const x = LABEL_W + (b / res) * stepW() - scrollL;
      playhead.style.display = x >= LABEL_W && x < wrap.clientWidth ? 'block' : 'none';
      playhead.style.transform = `translateX(${x}px)`;
    } else playhead.style.display = 'none';
  }
  return { el: root, setRegion, refresh, frame, resize: () => { layout(); draw(); }, get regionId() { return regionId; } };
}
