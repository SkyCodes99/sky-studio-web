// Reusable UI controls: knobs, faders, segmented buttons, menus, modals, toasts.
import { h, clamp } from '../util.js';
import { icon } from './icons.js';

/** Rotary knob. opts: label,value,min,max,def,step,fmt(v),onInput(v),onChange(v),size,color */
export function knob(opts) {
  const o = { min: 0, max: 1, def: 0, step: 0, size: 38, color: '', fmt: (v) => v.toFixed(2), ...opts };
  let value = o.value ?? o.def;
  const S = o.size, R = S / 2 - 4, C = S / 2;
  const arc = h('svg:path', { fill: 'none', 'stroke-width': 3.2, 'stroke-linecap': 'round', class: 'k-arc' });
  const track = h('svg:path', { fill: 'none', 'stroke-width': 3.2, 'stroke-linecap': 'round', class: 'k-track' });
  const dot = h('svg:line', { class: 'k-dot', 'stroke-width': 2.4, 'stroke-linecap': 'round' });
  const svg = h('svg:svg', { width: S, height: S, viewBox: `0 0 ${S} ${S}` }, track, arc, dot);
  const val = h('div', { class: 'k-val' });
  const el = h('div', { class: 'knob', title: 'Drag up/down • double-click to reset • Shift = fine', style: o.color ? { '--kc': o.color } : null }, svg, h('div', { class: 'k-label' }, o.label || ''), val);
  const pt = (a) => [C + R * Math.cos(a), C + R * Math.sin(a)];
  const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25;
  const pathFor = (a, b) => { const [x0, y0] = pt(a), [x1, y1] = pt(b); return `M${x0} ${y0} A${R} ${R} 0 ${b - a > Math.PI ? 1 : 0} 1 ${x1} ${y1}`; };
  track.setAttribute('d', pathFor(A0, A1));
  function draw() {
    const f = (value - o.min) / (o.max - o.min);
    const a = A0 + (A1 - A0) * clamp(f, 0, 1);
    const bipolar = o.min < 0 && o.max > 0;
    const zero = A0 + (A1 - A0) * ((0 - o.min) / (o.max - o.min));
    arc.setAttribute('d', bipolar ? (a >= zero ? pathFor(zero, Math.max(a, zero + 0.001)) : pathFor(a, zero)) : pathFor(A0, Math.max(a, A0 + 0.001)));
    const [x0, y0] = [C + (R - 9) * Math.cos(a), C + (R - 9) * Math.sin(a)];
    const [x1, y1] = [C + (R - 2) * Math.cos(a), C + (R - 2) * Math.sin(a)];
    dot.setAttribute('x1', x0); dot.setAttribute('y1', y0); dot.setAttribute('x2', x1); dot.setAttribute('y2', y1);
    val.textContent = o.fmt(value);
  }
  function set(v, fire) {
    if (o.step) v = Math.round(v / o.step) * o.step;
    v = clamp(v, o.min, o.max);
    if (v === value && !fire) return;
    value = v; draw();
    if (fire) o.onInput && o.onInput(v);
  }
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    const y0 = e.clientY, v0 = value;
    el.classList.add('active');
    const move = (m) => {
      const k = (m.shiftKey ? 600 : 160);
      set(v0 + ((y0 - m.clientY) / k) * (o.max - o.min), true);
    };
    const up = () => { el.classList.remove('active'); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); o.onChange && o.onChange(value); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  });
  el.addEventListener('dblclick', () => { set(o.def, true); o.onChange && o.onChange(value); });
  el.addEventListener('wheel', (e) => { e.preventDefault(); set(value - Math.sign(e.deltaY) * (o.max - o.min) * (e.shiftKey ? 0.005 : 0.03), true); clearTimeout(el._wt); el._wt = setTimeout(() => o.onChange && o.onChange(value), 250); }, { passive: false });
  draw();
  el.set = (v) => set(v, false);
  el.get = () => value;
  return el;
}

/** Segmented control. items: [{id,label,icon?,title?}] */
export function segmented(items, current, onPick, cls = '') {
  const el = h('div', { class: 'seg ' + cls });
  const btns = new Map();
  for (const it of items) {
    const b = h('button', { class: 'seg-b', title: it.title || '', onClick: () => { el.set(it.id); onPick(it.id); } }, it.icon ? icon(it.icon, 15) : null, it.label != null ? h('span', {}, it.label) : null);
    btns.set(it.id, b); el.append(b);
  }
  el.set = (id) => { for (const [k, b] of btns) b.classList.toggle('on', k === id); };
  el.set(current);
  return el;
}

/** Vertical fader with a built-in meter. opts: value(0..1), onInput, onChange, height */
export function fader(opts) {
  let value = opts.value ?? 0.78;
  const meter = h('div', { class: 'f-meter' }, h('div', { class: 'f-meter-fill' }));
  const thumb = h('div', { class: 'f-thumb' });
  const rail = h('div', { class: 'f-rail' }, meter, h('div', { class: 'f-zero' }), thumb);
  const el = h('div', { class: 'fader', title: 'Drag • double-click = 0 dB', style: opts.height ? { height: opts.height + 'px' } : null }, rail);
  const draw = () => { thumb.style.bottom = `calc(${value * 100}% - 7px)`; };
  const fromEvent = (e) => { const r = rail.getBoundingClientRect(); return clamp(1 - (e.clientY - r.top) / r.height, 0, 1); };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    const apply = (m) => { value = fromEvent(m); draw(); opts.onInput && opts.onInput(value); };
    apply(e);
    const up = () => { el.removeEventListener('pointermove', apply); el.removeEventListener('pointerup', up); opts.onChange && opts.onChange(value); };
    el.addEventListener('pointermove', apply); el.addEventListener('pointerup', up);
  });
  el.addEventListener('dblclick', () => { value = 0.8; draw(); opts.onInput && opts.onInput(value); opts.onChange && opts.onChange(value); });
  el.set = (v) => { value = v; draw(); };
  el.level = (p) => { const db = 20 * Math.log10(Math.max(p, 1e-4)); const f = clamp((db + 54) / 60, 0, 1); meter.firstChild.style.height = f * 100 + '%'; meter.classList.toggle('hot', p > 0.97); };
  draw();
  return el;
}

export function button(label, onClick, opts = {}) {
  return h('button', { class: 'btn ' + (opts.class || ''), title: opts.title || '', onClick }, opts.icon ? icon(opts.icon, opts.iconSize || 16) : null, label != null && label !== '' ? h('span', {}, label) : null);
}
export function iconBtn(name, title, onClick, cls = '', size = 18) {
  return h('button', { class: 'ibtn ' + cls, title, onClick }, icon(name, size));
}

// ---------------------------------------------------------------- context menu
let openMenu = null;
export function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }
document.addEventListener('pointerdown', (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
/** items: [{label, onClick, icon?, disabled?, checked?, sep?, hint?}] */
export function showMenu(items, x, y) {
  closeMenu();
  const m = h('div', { class: 'menu' });
  for (const it of items) {
    if (it.sep) { m.append(h('div', { class: 'menu-sep' })); continue; }
    const row = h('div', { class: 'menu-item' + (it.disabled ? ' off' : ''), onClick: () => { if (it.disabled) return; closeMenu(); it.onClick && it.onClick(); } },
      h('span', { class: 'mi-ic' }, it.checked ? icon('check', 14) : it.icon ? icon(it.icon, 14) : null), h('span', { class: 'mi-l' }, it.label), it.hint ? h('span', { class: 'mi-h' }, it.hint) : null);
    m.append(row);
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  openMenu = m;
  return m;
}

// ---------------------------------------------------------------- modal
export function modal(title, body, buttons = [], opts = {}) {
  const back = h('div', { class: 'modal-back', onPointerDown: (e) => { if (e.target === back && !opts.sticky) close(); } });
  const box = h('div', { class: 'modal ' + (opts.class || ''), style: opts.width ? { width: opts.width + 'px' } : null },
    h('div', { class: 'modal-h' }, h('div', { class: 'modal-t' }, title), opts.noClose ? null : iconBtn('close', 'Close', () => close())),
    h('div', { class: 'modal-b' }, body),
    buttons.length ? h('div', { class: 'modal-f' }, buttons.map((b) => h('button', { class: 'btn ' + (b.primary ? 'primary' : '') + (b.danger ? ' danger' : ''), onClick: () => { const r = b.onClick ? b.onClick() : undefined; if (r !== false) close(); } }, b.label))) : null);
  back.append(box);
  document.body.append(back);
  function close() { back.remove(); opts.onClose && opts.onClose(); }
  const first = box.querySelector('input,select,textarea'); if (first && opts.focus !== false) setTimeout(() => first.focus(), 30);
  box.close = close;
  return box;
}

// ---------------------------------------------------------------- toast
let toastHost;
export function toast(msg, kind = 'info', ms = 2600) {
  if (!toastHost) { toastHost = h('div', { class: 'toasts' }); document.body.append(toastHost); }
  const t = h('div', { class: 'toast ' + kind }, msg);
  toastHost.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

/** Drag helper: calls move(dx,dy,ev) while the pointer is down; end(ev) on release. */
export function dragTracker(e, move, end) {
  const x0 = e.clientX, y0 = e.clientY;
  const mv = (m) => move(m.clientX - x0, m.clientY - y0, m);
  const up = (m) => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); end && end(m); };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
}

export function numberField(value, { min, max, step = 1, onChange, width = 56, fmt }) {
  const inp = h('input', { class: 'num', type: 'text', value: fmt ? fmt(value) : value, style: { width: width + 'px' } });
  const commit = () => { let v = parseFloat(inp.value); if (Number.isNaN(v)) v = value; v = clamp(v, min, max); value = v; inp.value = fmt ? fmt(v) : v; onChange(v); };
  inp.addEventListener('change', commit);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); e.stopPropagation(); });
  inp.addEventListener('wheel', (e) => { e.preventDefault(); value = clamp(value - Math.sign(e.deltaY) * step, min, max); inp.value = fmt ? fmt(value) : value; onChange(value); }, { passive: false });
  inp.set = (v) => { value = v; inp.value = fmt ? fmt(v) : v; };
  return inp;
}
