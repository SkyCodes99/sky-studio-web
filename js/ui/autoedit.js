// Automation editor: draw how a parameter (volume, pan, a filter, any effect knob...) changes over the song.
import { h, clamp } from '../util.js';
import { icon } from './icons.js';
import { button, segmented, iconBtn, dragTracker } from './widgets.js';
import { listTargets, targetInfo, normOf, valOf, valueAt } from '../audio/automation.js';

const RULER = 22, PAD_T = 10, PAD_B = 10, LEFT = 46;

export function createAutoEditor(app) {
  let mode = 'track', laneId = null, ppb = 28, hover = null, dragPt = null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const bar = h('div', { class: 'ed-bar' });
  const cv = h('canvas', { style: { position: 'sticky', left: 0, top: 0, display: 'block' } });
  const content = h('div', { style: { position: 'relative' } }, cv);
  const scroller = h('div', { class: 'pr-scroll' }, content);
  const playhead = h('div', { style: { position: 'absolute', top: 0, bottom: 0, width: '2px', background: '#fff', boxShadow: '0 0 6px #fff9', pointerEvents: 'none', display: 'none', zIndex: 3 } });
  const wrap = h('div', { class: 'ed-canvas-wrap' }, scroller, playhead);
  const root = h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } }, bar, h('div', { class: 'ed-body' }, wrap));

  const targetId = () => (mode === 'master' ? 'master' : app.sel.track);
  const lane = () => (app.project.auto || []).find((l) => l.id === laneId) || null;
  const info = () => { const l = lane(); return l ? targetInfo(app.project, l) : null; };
  const len = () => Math.max(app.projectLength(), 32);

  function buildBar() {
    bar.replaceChildren();
    const id = targetId(), t = id && id !== 'master' ? app.track(id) : null;
    const tabs = segmented([{ id: 'track', label: t ? t.name : 'Track' }, { id: 'master', label: 'Master' }], mode, (m) => { mode = m; laneId = null; autoPick(); render(); }, 'fx-seg');
    const targets = id ? listTargets(app.project, id) : [];
    const have = new Set((app.project.auto || []).filter((l) => l.track === id).map((l) => l.param));
    const groups = [...new Set(targets.map((x) => x.group))];
    const sel = h('select', { class: 'sel', style: { maxWidth: '260px' }, onChange: (e) => { if (!e.target.value) return; const l = app.addLane(id, e.target.value); laneId = l.id; render(); } },
      [h('option', { value: '' }, targets.length ? 'Automate a parameter…' : 'Nothing to automate'),
        ...groups.map((g) => h('optgroup', { label: g }, targets.filter((x) => x.group === g).map((x) => h('option', { value: x.param, selected: lane() && lane().param === x.param }, (have.has(x.param) ? '● ' : '') + x.label))))]);
    const l = lane();
    bar.append(tabs, sel);
    // existing lanes of this target as quick chips
    for (const ln of (app.project.auto || []).filter((x) => x.track === id)) {
      const inf = targetInfo(app.project, ln); if (!inf) continue;
      bar.append(h('button', { class: 'chip' + (ln.id === laneId ? ' on' : ''), onClick: () => { laneId = ln.id; render(); } }, inf.label));
    }
    if (l) {
      bar.append(segmented([{ id: 'linear', label: 'Smooth' }, { id: 'step', label: 'Steps' }], l.mode || 'linear', (m) => { l.mode = m; app.autoChanged(); }),
        h('label', { class: 'row', style: { gap: '6px' } }, h('input', { type: 'checkbox', class: 'switch', checked: l.on !== false, onChange: (e) => { l.on = e.target.checked; app.autoChanged(); } }), h('span', { class: 'hint' }, 'On')),
        iconBtn('trash', 'Delete this lane', () => { app.removeLane(l.id); laneId = null; autoPick(); render(); }, 'sm', 15));
    }
    bar.append(h('button', { class: 'btn sm' + (app.autoWrite ? ' on' : ''), title: 'While the song plays, moving any knob records automation', onClick: () => { app.autoWrite = !app.autoWrite; render(); } }, icon('rec', 12), h('span', {}, app.autoWrite ? 'Writing…' : 'Write')),
      h('span', { style: { flex: 1 } }), h('span', { class: 'hint' }, 'Click to add points • drag to move • right-click to delete'));
  }
  function autoPick() { const id = targetId(); const ls = (app.project.auto || []).filter((l) => l.track === id); if (!lane() || lane().track !== id) laneId = ls[0] ? ls[0].id : null; }

  function layout() {
    content.style.width = Math.max(scroller.clientWidth, LEFT + len() * ppb + 40) + 'px';
    content.style.height = '100%';
    const w = Math.max(10, scroller.clientWidth), hh = Math.max(10, scroller.clientHeight);
    if (cv.width !== Math.floor(w * dpr) || cv.height !== Math.floor(hh * dpr)) { cv.width = Math.floor(w * dpr); cv.height = Math.floor(hh * dpr); cv.style.width = w + 'px'; cv.style.height = hh + 'px'; }
  }
  const plot = () => ({ top: RULER + PAD_T, bot: cv.height / dpr - PAD_B });
  const xOf = (b) => LEFT + b * ppb - scroller.scrollLeft;
  const bOf = (x) => (x - LEFT + scroller.scrollLeft) / ppb;
  const yOf = (n) => { const p = plot(); return p.bot - n * (p.bot - p.top); };
  const nOf = (y) => { const p = plot(); return clamp((p.bot - y) / (p.bot - p.top), 0, 1); };

  function draw() {
    const w = cv.width / dpr, hh = cv.height / dpr, g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#14161c'; g.fillRect(0, 0, w, hh);
    const l = lane(), inf = info(), p = plot();
    // grid
    const bpb = app.bpb, b0 = Math.floor(bOf(LEFT)), b1 = bOf(w);
    g.font = '10.5px "Segoe UI"'; g.textBaseline = 'middle';
    for (let b = Math.max(0, b0); b < b1; b++) {
      const x = Math.round(xOf(b)) + 0.5, bar1 = b % bpb === 0;
      g.fillStyle = bar1 ? 'rgba(255,255,255,.2)' : 'rgba(255,255,255,.06)'; g.fillRect(x, RULER, 1, hh);
      if (bar1) { g.fillStyle = '#c3cadb'; g.fillText(String(b / bpb + 1), x + 4, 11); }
    }
    for (const q of [0, 0.25, 0.5, 0.75, 1]) { const y = Math.round(yOf(q)) + 0.5; g.fillStyle = q === 0.5 ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.05)'; g.fillRect(LEFT, y, w, 1); }
    g.fillStyle = '#181b22'; g.fillRect(0, 0, w, RULER); g.fillStyle = '#0b0c10'; g.fillRect(0, RULER - 1, w, 1);
    for (let b = Math.max(0, b0); b < b1; b++) if (b % bpb === 0) { g.fillStyle = '#aeb6c8'; g.fillRect(xOf(b), 12, 1, RULER - 12); g.fillStyle = '#c3cadb'; g.fillText(String(b / bpb + 1), xOf(b) + 4, 10); }
    if (!l || !inf) {
      g.fillStyle = '#626a7c'; g.font = '14px "Segoe UI"'; g.textAlign = 'center';
      g.fillText(targetId() ? 'Pick a parameter above to automate it' : 'Select a track first', w / 2, hh / 2); g.textAlign = 'left';
      return;
    }
    const color = (app.track(l.track) || { color: '#4aa3ff' }).color;
    // curve
    const pts = l.pts;
    g.beginPath();
    pts.forEach((pt, i) => {
      const x = xOf(pt.b), y = yOf(normOf(inf, pt.v));
      if (i === 0) g.moveTo(Math.min(LEFT, x), y); if (i === 0) g.lineTo(x, y);
      else if (l.mode === 'step') { g.lineTo(x, yOf(normOf(inf, pts[i - 1].v))); g.lineTo(x, y); } else g.lineTo(x, y);
    });
    const last = pts[pts.length - 1];
    g.lineTo(w, yOf(normOf(inf, last.v)));
    g.strokeStyle = color; g.lineWidth = 2.2; g.stroke();
    g.lineTo(w, p.bot); g.lineTo(LEFT, p.bot); g.closePath(); g.fillStyle = color + '2a'; g.fill();
    // points
    for (const pt of pts) {
      const x = xOf(pt.b), y = yOf(normOf(inf, pt.v));
      if (x < LEFT - 8 || x > w + 8) continue;
      g.beginPath(); g.arc(x, y, pt === dragPt ? 7 : 5, 0, 7); g.fillStyle = pt === dragPt ? '#fff' : color; g.fill(); g.strokeStyle = '#0b0c10'; g.lineWidth = 1.5; g.stroke();
    }
    // axis labels
    g.fillStyle = '#181b22'; g.fillRect(0, RULER, LEFT - 2, hh);
    g.fillStyle = '#8e96a8'; g.font = '10.5px "Segoe UI"';
    g.fillText(inf.fmt(inf.max), 4, yOf(1) + 1); g.fillText(inf.fmt(valOf(inf, 0.5)), 4, yOf(0.5)); g.fillText(inf.fmt(inf.min), 4, yOf(0) - 1);
    if (hover) {
      const v = valOf(inf, nOf(hover.y)), txt = `${inf.fmt(v)}  ·  beat ${(bOf(hover.x) + 1).toFixed(2)}`;
      g.fillStyle = '#232733dd'; const tw = g.measureText(txt).width + 14; g.fillRect(Math.min(hover.x + 12, w - tw - 4), Math.max(RULER + 2, hover.y - 28), tw, 20);
      g.fillStyle = '#e9ecf3'; g.fillText(txt, Math.min(hover.x + 19, w - tw + 3), Math.max(RULER + 12, hover.y - 18));
    }
    g.fillStyle = '#0b0c10'; g.fillRect(LEFT - 1, RULER, 1, hh);
  }

  const evXY = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const hitPoint = (x, y) => {
    const l = lane(), inf = info(); if (!l || !inf) return null;
    for (const pt of l.pts) if (Math.hypot(xOf(pt.b) - x, yOf(normOf(inf, pt.v)) - y) <= 9) return pt;
    return null;
  };
  cv.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const [x, y] = evXY(e), pt = hitPoint(x, y), l = lane();
    if (pt && l && l.pts.length > 1) { l.pts.splice(l.pts.indexOf(pt), 1); app.autoChanged(); draw(); }
  });
  cv.addEventListener('pointermove', (e) => { const [x, y] = evXY(e); hover = x > LEFT && y > RULER ? { x, y } : null; if (!dragPt) draw(); });
  cv.addEventListener('pointerleave', () => { hover = null; if (!dragPt) draw(); });
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const [x, y] = evXY(e);
    if (y < RULER) { app.seek(Math.max(0, bOf(x))); dragTracker(e, (dx, dy, m) => app.seek(Math.max(0, bOf(evXY(m)[0])))); return; }
    const l = lane(), inf = info();
    if (!l || !inf || x < LEFT) return;
    let pt = hitPoint(x, y);
    if (!pt) {
      const b = Math.max(0, app.snapBeats() ? app.snap(bOf(x), true) : bOf(x));
      pt = { b, v: valOf(inf, nOf(y)) };
      l.pts.push(pt); l.pts.sort((a, c) => a.b - c.b);
    }
    dragPt = pt;
    app.autoTouch(); draw();
    dragTracker(e, (dx, dy, m) => {
      const [mx, my] = evXY(m);
      pt.b = Math.max(0, app.snapBeats() && !m.altKey ? app.snap(bOf(mx), true) : bOf(mx));
      pt.v = valOf(inf, nOf(my));
      if (inf.fmt && l.param === undefined) pt.v = pt.v;
      hover = { x: mx, y: my };
      app.autoTouch(); draw();
    }, () => { l.pts.sort((a, c) => a.b - c.b); dragPt = null; app.autoChanged(); draw(); });
  });
  scroller.addEventListener('scroll', () => requestAnimationFrame(draw));
  scroller.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); ppb = clamp(ppb * (e.deltaY < 0 ? 1.15 : 0.87), 8, 200); layout(); draw(); } }, { passive: false });
  new ResizeObserver(() => { layout(); draw(); }).observe(wrap);

  function render() { autoPick(); buildBar(); layout(); draw(); }
  let pending = false;
  const re = () => { if (pending) return; pending = true; queueMicrotask(() => { pending = false; render(); }); };
  app.on('autochanged', re);
  app.on('selection', () => { if (mode === 'track') re(); });
  app.on('layout', () => { if (app.view.bottom === 'auto') re(); });
  app.on('change', (k) => { if (k !== 'params' && k !== 'recording') re(); });
  render();
  return {
    el: root, refresh: render,
    frame() {
      const x = LEFT + app.pos * ppb - scroller.scrollLeft;
      playhead.style.display = x >= LEFT && x < wrap.clientWidth ? 'block' : 'none';
      playhead.style.transform = `translateX(${x}px)`;
      if (app.engine.playing && lane()) draw();                  // value readout follows the live curve
    },
  };
}
