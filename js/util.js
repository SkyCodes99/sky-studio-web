// Small shared helpers: math, DOM builder, event emitter, base64.
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const uid = () => Math.random().toString(36).slice(2, 9) + Math.random().toString(36).slice(2, 4);
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = (d) => Math.pow(10, d / 20);
export const gainToDb = (g) => 20 * Math.log10(Math.max(g, 1e-6));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const deep = (o) => JSON.parse(JSON.stringify(o));

/** Tiny DOM builder: h('div', {class:'x', onClick: fn}, child, ...). 'svg:path' makes SVG elements. */
export function h(tag, props, ...kids) {
  const svg = tag.startsWith('svg:');
  const el = svg ? document.createElementNS('http://www.w3.org/2000/svg', tag.slice(4)) : document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sv == null) continue; if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
      else if (k.length > 2 && k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (!svg && k in el && k !== 'list') {
        try { el[k] = v; } catch { el.setAttribute(k, v); }
      } else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export class Emitter {
  constructor() { this._l = {}; }
  on(e, f) { (this._l[e] ||= []).push(f); return () => this.off(e, f); }
  off(e, f) { const a = this._l[e]; if (a) { const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); } }
  emit(e, ...args) {
    for (const f of [...(this._l[e] || [])]) {
      try { f(...args); } catch (err) { console.error('[emit ' + e + ']', err); }
    }
  }
}

export function bufToB64(buf) {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToBuf(b64) {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u.buffer;
}

/** Deterministic PRNG so synthesized sounds are identical every run. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

export function fmtTime(sec) {
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m + ':' + s.toFixed(1).padStart(4, '0');
}
