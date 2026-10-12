// Piano roll: canvas note editor with draw / move / resize / marquee, velocity lane, quantize, transpose, scale highlight.
import { h, clamp, uid } from '../util.js';
import { icon } from './icons.js';
import { iconBtn, button, segmented, dragTracker, showMenu } from './widgets.js';
import { SNAPS } from '../app.js';
import { inScale, isRoot, isBlack, noteLabel, NOTE_NAMES } from '../theory.js';

const KEYW = 66, RULER = 22;

export function createPianoRoll(app) {
  let regionId = null;
  const S = { tool: 'draw', ppb: 64, rowH: 15, sel: new Set(), lastDur: 0, clip: null, chord: 'off' };
  const CHORDS = { off: null, major: [0, 4, 7], minor: [0, 3, 7], '7th': [0, 4, 7, 10], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], sus2: [0, 2, 7], sus4: [0, 5, 7], power: [0, 7, 12], 'add9': [0, 4, 7, 14] };
  let scrollerLeft = 0, scrollerTop = 0;
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  // ---- elements
  const gridCv = h('canvas', { tabindex: 0, style: { position: 'sticky', left: 0, top: 0, display: 'block', outline: 'none' } });
  const content = h('div', { style: { position: 'relative' } }, gridCv);
  const scroller = h('div', { class: 'pr-scroll' }, content);
  const playhead = h('div', { style: { position: 'absolute', top: 0, bottom: 0, width: '2px', background: '#fff', boxShadow: '0 0 6px #fff9', pointerEvents: 'none', display: 'none', zIndex: 3 } });
  const wrap = h('div', { class: 'ed-canvas-wrap' }, scroller, playhead);
  const keysCv = h('canvas', { style: { width: KEYW + 'px', flex: 'none', display: 'block', background: '#14161c', cursor: 'pointer' } });
  const main = h('div', { class: 'ed-body' }, keysCv, wrap);
  const velCv = h('canvas', { style: { display: 'block', width: '100%', height: '100%' } });
  const velLane = h('div', { class: 'vel-lane' }, velCv);
  const bar = h('div', { class: 'ed-bar' });
  const root = h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } }, bar, main, velLane);

  const lenInput = h('input', { class: 'num', type: 'text', style: { width: '44px' }, title: 'Pattern length in bars', onChange: (e) => setBars(parseFloat(e.target.value)), onKeyDown: (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); } });
  const toolSeg = segmented([{ id: 'draw', icon: 'note', title: 'Draw: click to add notes' }, { id: 'select', icon: 'grid', title: 'Select: drag a box around notes' }], S.tool, (t) => { S.tool = t; });
  const scaleBtn = h('button', { class: 'btn sm', title: 'Only allow notes that are in the song key', onClick: () => { app.view.scaleSnap = !app.view.scaleSnap; app.emit('layout'); refresh(); } }, icon('magnet', 14), h('span', {}, 'Lock to key'));
  bar.append(toolSeg,
    h('span', { class: 'lbl' }, 'Length'), lenInput, h('span', { class: 'lbl' }, 'bars'),
    scaleBtn,
    button('Quantize', () => quantize(), { class: 'sm', title: 'Snap selected notes (or all) to the grid' }),
    iconBtn('up', 'Transpose up (↑)', () => transpose(1), 'sm', 15), iconBtn('down', 'Transpose down (↓)', () => transpose(-1), 'sm', 15),
    button('Octave +', () => transpose(12), { class: 'sm' }), button('Octave −', () => transpose(-12), { class: 'sm' }),
    button('Humanize', () => humanize(), { class: 'sm', title: 'Add tiny timing and loudness variations' }),
    h('label', { class: 'row', style: { gap: '5px' }, title: 'Click once to place a whole chord' }, h('span', { class: 'lbl' }, 'Chord'),
      h('select', { class: 'sel', onChange: (e) => (S.chord = e.target.value) }, Object.keys(CHORDS).map((k) => h('option', { value: k }, k === 'off' ? 'Single notes' : k)))),
    button('Strum', () => strum(), { class: 'sm', title: 'Spread a chord out in time like a guitar strum' }),
    button('Arpeggiate', () => arpeggiate(), { class: 'sm', title: 'Turn chords into a running 16th-note arpeggio' }),
    button('Legato', () => legato(), { class: 'sm', title: 'Stretch each note up to the next one' }),
    button('Flip', () => flip(), { class: 'sm', title: 'Play the notes backwards' }),
    h('div', { style: { flex: 1 } }),
    h('span', { class: 'hint' }, 'Click to add • drag to move • right edge to stretch • right-click to delete'));

  // ---- helpers
  const info = () => (regionId ? app.regionInfo(regionId) : null);
  const grid = () => app.snapBeats() || 0.25;
  const loopLen = (r) => r.loopLen || r.len;
  const W = () => Math.max(scroller.clientWidth, (loopLen(info().region) + 0) * S.ppb + 40);
  const rowY = (p) => (127 - p) * S.rowH - scrollerTop + RULER;
  const xOf = (b) => b * S.ppb - scrollerLeft;

  function sizeCanvas(cv, w, hgt) {
    const W2 = Math.max(10, Math.floor(w)), H2 = Math.max(10, Math.floor(hgt));
    if (cv.width !== W2 * dpr || cv.height !== H2 * dpr) { cv.width = W2 * dpr; cv.height = H2 * dpr; cv.style.width = W2 + 'px'; cv.style.height = H2 + 'px'; }
    return [W2, H2];
  }

  function layout() {
    const i = info();
    if (!i) return;
    content.style.width = Math.max(scroller.clientWidth, loopLen(i.region) * S.ppb + 60) + 'px';
    content.style.height = 128 * S.rowH + RULER + 'px';
    sizeCanvas(gridCv, scroller.clientWidth, scroller.clientHeight);
    sizeCanvas(keysCv, KEYW, wrap.clientHeight);
    keysCv.style.height = wrap.clientHeight + 'px';
    const vw = sizeCanvas(velCv, velLane.clientWidth, velLane.clientHeight);
  }

  // ---- drawing
  function draw() {
    const i = info();
    if (!i) return;
    const { track, region: r } = i;
    scrollerLeft = scroller.scrollLeft; scrollerTop = scroller.scrollTop;
    const [w, hgt] = [gridCv.width / dpr, gridCv.height / dpr];
    const g = gridCv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);
    const P = app.project, L = loopLen(r), bpb = app.bpb, gsnap = grid();
    // rows
    const p0 = clamp(127 - Math.floor((scrollerTop) / S.rowH), 0, 127), p1 = clamp(127 - Math.ceil((scrollerTop + hgt - RULER) / S.rowH), 0, 127);
    for (let p = p0; p >= p1; p--) {
      const y = rowY(p);
      const root = isRoot(p, P.key), insc = inScale(p, P.key, P.scale);
      g.fillStyle = root ? '#1f2a3a' : isBlack(p) ? '#14161b' : '#1a1d24';
      if (insc && !root && !isBlack(p)) g.fillStyle = '#1d212a';
      g.fillRect(0, y, w, S.rowH);
      g.fillStyle = '#0d0f13'; g.fillRect(0, y + S.rowH - 1, w, 1);
      if (!insc) { g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, y, w, S.rowH - 1); }
    }
    // beyond cycle
    const xEnd = xOf(L);
    if (xEnd < w) { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(Math.max(0, xEnd), RULER, w, hgt); }
    // vertical grid
    const b0 = scrollerLeft / S.ppb, b1 = (scrollerLeft + w) / S.ppb;
    for (let b = Math.floor(b0 / gsnap) * gsnap; b < Math.min(b1, L + 0.001); b += gsnap) {
      const x = Math.round(xOf(b)) + 0.5;
      const bar1 = Math.abs(((b + r.start) % bpb + bpb) % bpb) < 1e-6 || Math.abs((((b + r.start) % bpb) + bpb) % bpb - bpb) < 1e-6, beat = Math.abs(b % 1) < 1e-6;
      g.fillStyle = bar1 ? 'rgba(255,255,255,.28)' : beat ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.055)';
      g.fillRect(x, RULER, 1, hgt);
    }
    // ruler
    g.fillStyle = '#181b22'; g.fillRect(0, 0, w, RULER);
    g.fillStyle = '#0b0c10'; g.fillRect(0, RULER - 1, w, 1);
    g.font = '10.5px "Segoe UI", sans-serif'; g.textBaseline = 'middle';
    for (let b = Math.floor(b0); b < Math.min(b1, L + 4); b++) {
      const x = xOf(b);
      const absBeat = r.start + b, isBar = Math.abs(((absBeat % bpb) + bpb) % bpb) < 1e-6;
      g.fillStyle = isBar ? '#aeb6c8' : '#4b5266';
      g.fillRect(x, isBar ? 4 : 13, 1, isBar ? RULER - 4 : RULER - 13);
      if (isBar) { g.fillStyle = '#c3cadb'; g.fillText(String(Math.round(absBeat / bpb) + 1), x + 4, 10); }
    }
    // loop markers for region tiles
    for (let k = 1; k * L < r.len; k++) { const x = xOf(k * L); g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(x, RULER, 1, hgt); }
    // notes
    const col = track.color;
    const draws = [];
    for (const n of r.notes) draws.push(n);
    for (const n of draws) {
      const x = xOf(n.s), nw = Math.max(3, n.d * S.ppb - 1), y = rowY(n.p) + 1;
      if (x + nw < 0 || x > w || y + S.rowH < RULER || y > hgt) continue;
      const sel = S.sel.has(n.id);
      g.fillStyle = col;
      g.globalAlpha = 0.45 + 0.55 * (n.v / 127);
      roundRect(g, x, y, nw, S.rowH - 2, 3); g.fill();
      g.globalAlpha = 1;
      if (sel) { g.strokeStyle = '#fff'; g.lineWidth = 2; roundRect(g, x, y, nw, S.rowH - 2, 3); g.stroke(); }
      else { g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1; roundRect(g, x + 0.5, y + 0.5, nw - 1, S.rowH - 3, 3); g.stroke(); }
      if (nw > 28 && S.rowH >= 13) { g.fillStyle = 'rgba(0,0,0,.7)'; g.font = '10px "Segoe UI", sans-serif'; g.textBaseline = 'middle'; g.fillText(noteLabel(n.p), x + 4, y + (S.rowH - 2) / 2 + 0.5); }
    }
    // ghost repeats
    if (r.len > L) {
      g.globalAlpha = 0.22; g.fillStyle = col;
      for (let k = 1; k * L < r.len; k++) for (const n of r.notes) {
        const s = k * L + n.s; if (s >= r.len) continue;
        const x = xOf(s), nw = Math.max(3, Math.min(n.d, r.len - s) * S.ppb - 1), y = rowY(n.p) + 1;
        if (x + nw < 0 || x > w) continue;
        g.fillRect(x, y, nw, S.rowH - 2);
      }
      g.globalAlpha = 1;
    }
    if (marquee) { g.fillStyle = 'rgba(74,163,255,.18)'; g.strokeStyle = '#4aa3ff'; g.lineWidth = 1; g.fillRect(marquee.x, marquee.y, marquee.w, marquee.h); g.strokeRect(marquee.x + 0.5, marquee.y + 0.5, marquee.w, marquee.h); }
    drawKeys(); drawVel();
  }
  function roundRect(g, x, y, w, h2, r) { r = Math.min(r, w / 2, h2 / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h2, r); g.arcTo(x + w, y + h2, x, y + h2, r); g.arcTo(x, y + h2, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  let heldKey = -1;
  function drawKeys() {
    const g = keysCv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const hgt = keysCv.height / dpr;
    g.clearRect(0, 0, KEYW, hgt);
    g.fillStyle = '#181b22'; g.fillRect(0, 0, KEYW, RULER);
    const P = app.project;
    for (let p = 127; p >= 0; p--) {
      const y = rowY(p);
      if (y + S.rowH < RULER || y > hgt) continue;
      const black = isBlack(p);
      g.fillStyle = p === heldKey ? '#4aa3ff' : black ? '#20232b' : '#e6e9f1';
      g.fillRect(0, y, black ? KEYW * 0.62 : KEYW, S.rowH - 0.5);
      if (black) { g.fillStyle = '#d9dde8'; g.fillRect(KEYW * 0.62, y, KEYW * 0.38, S.rowH - 0.5); }
      g.fillStyle = '#0d0f13'; g.fillRect(0, y + S.rowH - 1, KEYW, 1);
      if (p % 12 === 0) { g.fillStyle = '#3a4150'; g.font = '10px "Segoe UI"'; g.textBaseline = 'middle'; g.fillText(noteLabel(p), KEYW - 24, y + S.rowH / 2); }
      else if (S.rowH >= 14 && inScale(p, P.key, P.scale) && !black && isRoot(p, P.key)) { g.fillStyle = '#6a56d6'; g.fillRect(2, y + 3, 4, S.rowH - 7); }
    }
  }

  function drawVel() {
    const i = info();
    if (!i) return;
    const g = velCv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = velCv.width / dpr, hgt = velCv.height / dpr;
    g.clearRect(0, 0, w, hgt);
    g.fillStyle = '#14161c'; g.fillRect(0, 0, w, hgt);
    const x0 = KEYW;
    g.fillStyle = '#181b22'; g.fillRect(0, 0, x0, hgt);
    g.fillStyle = '#626a7c'; g.font = '10.5px "Segoe UI"'; g.textBaseline = 'top'; g.fillText('Velocity', 8, 6);
    g.strokeStyle = '#ffffff10'; g.beginPath(); for (let k = 1; k < 4; k++) { const y = (hgt - 6) * (k / 4) + 3; g.moveTo(x0, y); g.lineTo(w, y); } g.stroke();
    for (const n of i.region.notes) {
      const x = x0 + xOf(n.s);
      if (x < x0 - 6 || x > w) continue;
      const bh = (hgt - 8) * (n.v / 127), sel = S.sel.has(n.id);
      g.fillStyle = sel ? '#ffffff' : i.track.color;
      g.fillRect(x, hgt - 4 - bh, 5, bh);
      g.beginPath(); g.arc(x + 2.5, hgt - 4 - bh, 3.2, 0, 7); g.fill();
    }
  }

  // ---- hit testing
  function noteAt(x, y) {
    const i = info(); if (!i) return null;
    const b = (x + scrollerLeft) / S.ppb, p = 127 - Math.floor((y - RULER + scrollerTop) / S.rowH);
    for (let k = i.region.notes.length - 1; k >= 0; k--) {
      const n = i.region.notes[k];
      if (n.p === p && b >= n.s - 0.001 && b <= n.s + n.d + 0.001) return n;
    }
    return null;
  }
  const evXY = (e) => { const r = gridCv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  let marquee = null;
  function audition(p, v = 100) {
    const i = info(); if (!i) return;
    app.ctx.resume();
    const t = i.track;
    if (t.type === 'drum' || p < 0 || p > 127) return;
    app.engine.liveOn(t, p, v);
    setTimeout(() => app.engine.liveOff(t, p), 220);
  }
  function snapPitch(p) { return app.view.scaleSnap ? snapScale(p) : p; }
  function snapScale(p) { const P = app.project; for (let d = 0; d < 7; d++) { if (inScale(p + d, P.key, P.scale)) return p + d; if (inScale(p - d, P.key, P.scale)) return p - d; } return p; }

  gridCv.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const [x, y] = evXY(e); const n = noteAt(x, y);
    if (n) { const r = info().region; r.notes = r.notes.filter((q) => q !== n); S.sel.delete(n.id); done(); }
  });
  gridCv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    gridCv.focus();
    const i = info(); if (!i) return;
    const r = i.region, L = loopLen(r), [x, y] = evXY(e);
    if (y < RULER) { const b = clamp((x + scrollerLeft) / S.ppb, 0, L); app.seek(r.start + b); dragTracker(e, (dx, dy, m) => { const [xx] = evXY(m); app.seek(r.start + clamp((xx + scrollerLeft) / S.ppb, 0, L)); }); return; }
    const hit = noteAt(x, y);
    const gs = grid();
    if (hit) {
      if (e.shiftKey || e.ctrlKey) { S.sel.has(hit.id) ? S.sel.delete(hit.id) : S.sel.add(hit.id); }
      else if (!S.sel.has(hit.id)) S.sel = new Set([hit.id]);
      const nx = xOf(hit.s + hit.d);
      const zone = x > nx - 7 && hit.d * S.ppb > 12 ? 'resize' : 'move';
      if (zone === 'move') audition(hit.p, hit.v);
      startDrag(e, zone, hit, r);
      draw(); return;
    }
    if (S.tool === 'draw' && !e.shiftKey) {
      const b = (x + scrollerLeft) / S.ppb;
      const s = Math.floor(b / gs + 1e-6) * gs;
      if (s >= L) return;
      const p = snapPitch(127 - Math.floor((y - RULER + scrollerTop) / S.rowH));
      const dur = Math.min(S.lastDur || gs, L - s);
      const n = { id: uid(), s, d: dur, p, v: 100 };
      r.notes.push(n); S.sel = new Set([n.id]);
      if (CHORDS[S.chord]) for (const iv of CHORDS[S.chord].slice(1)) { const q = { id: uid(), s, d: dur, p: clamp(p + iv, 0, 127), v: 92 }; r.notes.push(q); S.sel.add(q.id); }
      audition(p);
      startDrag(e, 'resize', n, r, true);
      draw(); return;
    }
    // marquee
    if (!(e.shiftKey || e.ctrlKey)) S.sel = new Set();
    const base = new Set(S.sel);
    dragTracker(e, (dx, dy, m) => {
      const [mx, my] = evXY(m);
      const x0 = Math.min(x, mx), y0 = Math.min(y, my);
      marquee = { x: x0, y: y0, w: Math.abs(mx - x), h: Math.abs(my - y) };
      const bA = (x0 + scrollerLeft) / S.ppb, bB = (x0 + marquee.w + scrollerLeft) / S.ppb;
      const pTop = 127 - Math.floor((y0 - RULER + scrollerTop) / S.rowH), pBot = 127 - Math.floor((y0 + marquee.h - RULER + scrollerTop) / S.rowH);
      S.sel = new Set(base);
      for (const n of r.notes) if (n.s + n.d > bA && n.s < bB && n.p <= pTop && n.p >= pBot) S.sel.add(n.id);
      draw();
    }, () => { marquee = null; draw(); });
  });

  function startDrag(e, zone, anchor, r, justCreated) {
    const L = loopLen(r), gs = grid();
    let notes = r.notes.filter((n) => S.sel.has(n.id));
    if (zone === 'move' && e.altKey) {
      const copies = notes.map((n) => ({ ...n, id: uid() }));
      r.notes.push(...copies); S.sel = new Set(copies.map((c) => c.id)); notes = copies; anchor = copies[notes.findIndex((n) => n === anchor)] || copies[0];
    }
    const orig = notes.map((n) => ({ n, s: n.s, d: n.d, p: n.p }));
    const a0 = { s: anchor.s, d: anchor.d, p: anchor.p };
    let moved = !!justCreated, lastP = anchor.p;
    dragTracker(e, (dx, dy) => {
      if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      moved = true;
      const db = dx / S.ppb;
      if (zone === 'move') {
        const ns = Math.max(0, Math.min(L - 0.01, app.snapBeats() ? Math.round((a0.s + db) / gs) * gs : a0.s + db));
        const dS = ns - a0.s;
        const dP = -Math.round(dy / S.rowH);
        let shiftP = dP;
        if (app.view.scaleSnap) { shiftP = snapScale(a0.p + dP) - a0.p; }
        for (const o of orig) { o.n.s = clamp(o.s + dS, 0, L - 0.02); o.n.p = clamp(o.p + shiftP, 0, 127); }
        if (anchor.p !== lastP) { lastP = anchor.p; audition(anchor.p, anchor.v); }
      } else {
        const nd = Math.max(gs > 0.0001 ? Math.min(gs, 0.125) : 0.0625, app.snapBeats() ? Math.round((a0.s + a0.d + db) / gs) * gs - a0.s : a0.d + db);
        const dD = nd - a0.d;
        for (const o of orig) o.n.d = clamp(Math.max(0.0625, o.d + dD), 0.0625, L - o.n.s);
        S.lastDur = anchor.d;
      }
      draw();
    }, () => { if (moved) { S.lastDur = anchor.d; done(); } else draw(); });
  }

  // ---- velocity lane
  velCv.addEventListener('pointerdown', (e) => {
    const i = info(); if (!i) return;
    const rect = velCv.getBoundingClientRect(), hgt = rect.height;
    const pick = (cx) => { const b = (cx - rect.left - KEYW + scrollerLeft) / S.ppb; let best = null, bd = 9 / S.ppb; for (const n of i.region.notes) { const d = Math.abs(n.s - b + 2.5 / S.ppb); if (d < bd) { bd = d; best = n; } } return best; };
    const n0 = pick(e.clientX);
    if (!n0) return;
    if (!S.sel.has(n0.id)) S.sel = new Set([n0.id]);
    const targets = i.region.notes.filter((n) => S.sel.has(n.id));
    const set = (cy) => { const v = clamp(Math.round(((rect.bottom - 4 - cy) / (hgt - 8)) * 127), 1, 127); const dv = v - n0.v; for (const n of targets) n.v = clamp(n.v + dv, 1, 127); draw(); };
    set(e.clientY);
    dragTracker(e, (dx, dy, m) => set(m.clientY), () => done());
  });

  // ---- actions
  function done() { app.commit('structure'); }
  function selNotes() { const r = info().region; const s = r.notes.filter((n) => S.sel.has(n.id)); return s.length ? s : r.notes; }
  function quantize() {
    const gs = grid();
    for (const n of selNotes()) { n.s = Math.max(0, Math.round(n.s / gs) * gs); n.d = Math.max(gs, Math.round(n.d / gs) * gs); }
    done();
  }
  function transpose(d) {
    const ns = selNotes();
    for (const n of ns) n.p = clamp(n.p + d, 0, 127);
    audition(ns[0] && ns[0].p);
    done();
  }
  function humanize() {
    for (const n of selNotes()) { n.s = Math.max(0, n.s + (Math.random() - 0.5) * 0.04); n.v = clamp(Math.round(n.v + (Math.random() - 0.5) * 18), 20, 127); }
    done();
  }
  const groups = (notes) => { const g = []; for (const n of notes.slice().sort((a, b) => a.s - b.s || a.p - b.p)) { const l = g[g.length - 1]; if (l && Math.abs(n.s - l[0].s) < 0.04) l.push(n); else g.push([n]); } return g; };
  function strum() {
    for (const g of groups(selNotes())) if (g.length > 1) g.forEach((n, i) => { n.s += i * 0.045; n.d = Math.max(0.1, n.d - i * 0.045); });
    done();
  }
  function arpeggiate() {
    const i = info(); if (!i) return;
    const r = i.region, src = selNotes(), gs = groups(src).filter((g) => g.length > 1);
    if (!gs.length) { app.toast('Select a chord (two or more notes at the same time) first', 'warn'); return; }
    const kill = new Set();
    const add = [];
    for (const g of gs) {
      const d = Math.max(...g.map((n) => n.d)), step = 0.25, pitches = g.map((n) => n.p).sort((a, b) => a - b);
      g.forEach((n) => kill.add(n));
      for (let k = 0; k * step < d - 1e-6; k++) add.push({ id: uid(), s: g[0].s + k * step, d: step * 0.9, p: pitches[k % pitches.length], v: g[0].v - (k % 4 ? 12 : 0) });
    }
    r.notes = r.notes.filter((n) => !kill.has(n)).concat(add); S.sel = new Set(add.map((n) => n.id));
    done();
  }
  function legato() {
    const ns = selNotes().slice().sort((a, b) => a.s - b.s);
    const starts = [...new Set(ns.map((n) => +n.s.toFixed(3)))];
    for (const n of ns) { const nx = starts.find((x) => x > n.s + 0.02); if (nx != null) n.d = Math.max(0.0625, nx - n.s); }
    done();
  }
  function flip() {
    const i = info(); if (!i) return;
    const L2 = loopLen(i.region), ns = selNotes();
    const lo = Math.min(...ns.map((n) => n.s)), hi = Math.max(...ns.map((n) => n.s + n.d));
    for (const n of ns) n.s = clamp(lo + hi - (n.s + n.d), 0, L2 - 0.02);
    done();
  }
  function setBars(b) {
    const i = info(); if (!i || !(b > 0)) { refresh(); return; }
    const r = i.region, bpb = app.bpb, oldL = loopLen(r), newL = Math.max(0.25, Math.round(b * 4) / 4 * bpb);
    r.loopLen = newL;
    if (Math.abs(r.len - oldL) < 1e-6 || r.len < newL) r.len = newL;
    r.notes = r.notes.filter((n) => n.s < newL);
    for (const n of r.notes) n.d = Math.min(n.d, newL - n.s);
    done();
  }
  gridCv.addEventListener('keydown', (e) => {
    const i = info(); if (!i) return;
    const r = i.region, k = e.key;
    let handled = true;
    if (k === 'Delete' || k === 'Backspace') { r.notes = r.notes.filter((n) => !S.sel.has(n.id)); S.sel.clear(); done(); }
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'a') { S.sel = new Set(r.notes.map((n) => n.id)); draw(); }
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'c') { S.clip = r.notes.filter((n) => S.sel.has(n.id)).map((n) => ({ ...n })); }
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'x') { S.clip = r.notes.filter((n) => S.sel.has(n.id)).map((n) => ({ ...n })); r.notes = r.notes.filter((n) => !S.sel.has(n.id)); S.sel.clear(); done(); }
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'v') {
      if (S.clip && S.clip.length) { const t0 = Math.min(...S.clip.map((n) => n.s)); const at = app.snap(clamp(((app.pos - r.start) % loopLen(r) + loopLen(r)) % loopLen(r), 0, loopLen(r))); const add = S.clip.map((n) => ({ ...n, id: uid(), s: n.s - t0 + at })).filter((n) => n.s < loopLen(r)); r.notes.push(...add); S.sel = new Set(add.map((n) => n.id)); done(); }
    }
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'd') {
      const ns = r.notes.filter((n) => S.sel.has(n.id));
      if (ns.length) { const a = Math.min(...ns.map((n) => n.s)), z = Math.max(...ns.map((n) => n.s + n.d)); const add = ns.map((n) => ({ ...n, id: uid(), s: n.s + (z - a) })).filter((n) => n.s < loopLen(r)); r.notes.push(...add); S.sel = new Set(add.map((n) => n.id)); done(); }
    }
    else if (k === 'ArrowUp') transpose(e.shiftKey ? 12 : 1);
    else if (k === 'ArrowDown') transpose(e.shiftKey ? -12 : -1);
    else if (k === 'ArrowLeft' || k === 'ArrowRight') { const d = (k === 'ArrowLeft' ? -1 : 1) * grid(); for (const n of selNotes()) n.s = clamp(n.s + d, 0, loopLen(r) - 0.02); done(); }
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  });

  // keyboard column: click to play notes
  keysCv.addEventListener('pointerdown', (e) => {
    const r = keysCv.getBoundingClientRect();
    const play = (cy) => { const p = 127 - Math.floor((cy - r.top - RULER + scrollerTop) / S.rowH); if (p !== heldKey && p >= 0 && p <= 127) { const i = info(); if (heldKey >= 0 && i) app.engine.liveOff(i.track, heldKey); heldKey = p; const t = info().track; app.ctx.resume(); if (t.type !== 'drum') app.engine.liveOn(t, p, 100); drawKeys(); } };
    play(e.clientY);
    dragTracker(e, (dx, dy, m) => play(m.clientY), () => { const i = info(); if (i && heldKey >= 0) app.engine.liveOff(i.track, heldKey); heldKey = -1; drawKeys(); });
  });

  scroller.addEventListener('scroll', () => { scrollerLeft = scroller.scrollLeft; scrollerTop = scroller.scrollTop; requestAnimationFrame(draw); });   // keep click maths in step with the scroll even before the redraw
  scroller.addEventListener('wheel', (e) => {
    if (e.ctrlKey) { e.preventDefault(); const old = S.ppb; S.ppb = clamp(S.ppb * (e.deltaY < 0 ? 1.15 : 0.87), 14, 400); const r = gridCv.getBoundingClientRect(); const b = (e.clientX - r.left + scroller.scrollLeft) / old; layout(); scroller.scrollLeft = b * S.ppb - (e.clientX - r.left); draw(); }
    else if (e.altKey) { e.preventDefault(); const old = S.rowH; S.rowH = clamp(S.rowH + (e.deltaY < 0 ? 2 : -2), 8, 32); layout(); scroller.scrollTop *= S.rowH / old; draw(); }
  }, { passive: false });
  new ResizeObserver(() => { layout(); draw(); }).observe(wrap);
  new ResizeObserver(() => { layout(); drawVel(); }).observe(velLane);

  function refresh() {
    const i = info();
    if (!i) return;
    scaleBtn.classList.toggle('on', !!app.view.scaleSnap);
    if (document.activeElement !== lenInput) lenInput.value = +(loopLen(i.region) / app.bpb).toFixed(2);
    const ids = new Set(i.region.notes.map((n) => n.id));
    for (const id of [...S.sel]) if (!ids.has(id)) S.sel.delete(id);
    layout(); draw();
  }

  function setRegion(id, centre) {
    regionId = id;
    S.sel = new Set();
    const i = info();
    if (!i) return;
    layout();
    // scroll vertically to the notes (or middle C)
    const ps = i.region.notes.map((n) => n.p);
    const mid = ps.length ? (Math.min(...ps) + Math.max(...ps)) / 2 : 62;
    scroller.scrollTop = Math.max(0, (127 - mid) * S.rowH - scroller.clientHeight / 2 + RULER);
    scroller.scrollLeft = 0;
    refresh();
  }

  function frame() {
    const i = info();
    if (!i) return;
    const r = i.region, L = loopLen(r);
    let b = app.pos - r.start;
    const show = app.engine.playing && b >= 0 && b < r.len;
    if (show) {
      b = ((b % L) + L) % L;
      const x = KEYW * 0 + xOf(b);
      playhead.style.display = x >= 0 && x < wrap.clientWidth ? 'block' : 'none';
      playhead.style.transform = `translateX(${x}px)`;
    } else playhead.style.display = 'none';
  }

  return { el: root, setRegion, refresh, frame, resize: () => { layout(); draw(); }, get regionId() { return regionId; } };
}
