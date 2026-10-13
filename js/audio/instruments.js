// Instrument library: every sound is synthesized from scratch (oscillators, FM, additive, Karplus-Strong, formants).
// An instrument's start(ctx, out, t, midi, vel, P) builds a voice at audio-time t and returns a Voice handle.
// P = { tone, attack, release } smart-control values 0..1 (0.5 = the instrument's own default).
import { clamp, mtof, rng } from '../util.js';

const tm = (base, x) => base * Math.pow(10, ((x ?? 0.5) - 0.5) * 2);           // time:   x/10 .. x*10
const fc = (base, x) => base * Math.pow(2, ((x ?? 0.5) - 0.5) * 5);              // cutoff: +-2.5 octaves
const velAmp = (v, floor = 0.22) => floor + (1 - floor) * Math.pow(v, 1.25);

// ---------------------------------------------------------------- voice handle
export class Voice {
  constructor(ctx, rel, sources, relTime, maxEnd) {
    this.ctx = ctx; this.rel = rel; this.sources = sources; this.relTime = relTime; this.maxEnd = maxEnd ?? Infinity;
    this.released = false; this.endTime = Infinity; this.onend = null;
    if (sources[0]) sources[0].onended = () => { this.finished = true; this.onend && this.onend(this); };
  }
  release(t, rt = this.relTime) {
    if (this.released) return;
    this.released = true;
    rt = Math.max(rt, 0.015);
    const g = this.rel.gain;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
    g.setTargetAtTime(0, t, rt / 4);
    const end = Math.min(t + rt * 1.9 + 0.05, this.maxEnd);
    this.endTime = end;
    for (const s of this.sources) { try { s.stop(end); } catch { /* already stopped */ } }
  }
  kill(t) {
    this.released = true;
    const g = this.rel.gain;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
    g.setTargetAtTime(0, t, 0.01);
    this.endTime = t + 0.1;
    for (const s of this.sources) { try { s.stop(t + 0.1); } catch { /* */ } }
  }
}

// ---------------------------------------------------------------- shared waves / noise
const waveCache = new WeakMap();
function pulseWave(ctx, w) {
  let m = waveCache.get(ctx);
  if (!m) { m = new Map(); waveCache.set(ctx, m); }
  if (!m.has(w)) {
    const N = 64, re = new Float32Array(N), im = new Float32Array(N);
    for (let n = 1; n < N; n++) {
      re[n] = (2 * Math.sin(2 * Math.PI * n * w)) / (Math.PI * n);
      im[n] = (2 * (1 - Math.cos(2 * Math.PI * n * w))) / (Math.PI * n);
    }
    m.set(w, ctx.createPeriodicWave(re, im));
  }
  return m.get(w);
}
const noiseCache = new WeakMap();
function noiseBuf(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0), r = rng(99);
    for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}
function satCurve(k) {
  const n = 1024, c = new Float32Array(n), nm = Math.tanh(k);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(k * ((i / (n - 1)) * 2 - 1)) / nm;
  return c;
}
function mkPan(ctx, out, pan) {
  if (!pan) return out;
  const p = ctx.createStereoPanner();
  p.pan.value = clamp(pan, -1, 1);
  p.connect(out);
  return p;
}

// ---------------------------------------------------------------- generic subtractive synth
function synth(spec) {
  return function start(ctx, out, t, midi, vel, P) {
    const f = mtof(midi + (spec.shift || 0)), v = vel / 127;
    const A = tm(spec.amp.a, P.attack), R = tm(spec.amp.r, P.release), D = spec.amp.d ?? 0.3, S = spec.amp.s ?? 1;
    const peak = spec.level * velAmp(v);
    const amp = ctx.createGain(), rel = amp;
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + A);
    if (S < 1) amp.gain.setTargetAtTime(peak * S, t + A, D);
    const F = spec.filter;
    const flt = ctx.createBiquadFilter();
    flt.type = F.type || 'lowpass';
    flt.Q.value = F.q ?? 0.7;
    let fb = fc(F.f, P.tone) * Math.pow(f / 261.63, F.keytrack ?? 0) * (1 + (F.velAmt ?? 0) * (v - 0.5) * 2);
    fb = clamp(fb, 40, 18000);
    if (F.env && F.env !== 1) {
      const top = clamp(fb * F.env, 40, 19000);
      if (F.fa) { flt.frequency.setValueAtTime(clamp(fb * 0.25, 40, 18000), t); flt.frequency.linearRampToValueAtTime(top, t + F.fa); flt.frequency.setTargetAtTime(fb, t + F.fa, F.envT ?? 0.2); }
      else { flt.frequency.setValueAtTime(top, t); flt.frequency.setTargetAtTime(fb, t, F.envT ?? 0.2); }
    } else flt.frequency.value = fb;

    const sources = [];
    const mix = flt;
    const detuneTargets = [];
    // every oscillator at the same level (e.g. the three string saws at 0.7): scale the voice once instead of adding a gain node per oscillator
    const gl = spec.oscs.map((o) => o.gain ?? 1), sameGain = gl.every((g) => Math.abs(g - gl[0]) < 0.001 && Math.abs(g - 1) > 0.26);
    if (sameGain) amp.gain.cancelScheduledValues(0), amp.gain.setValueAtTime(0, t), amp.gain.linearRampToValueAtTime(peak * gl[0], t + A), S < 1 && amp.gain.setTargetAtTime(peak * gl[0] * S, t + A, D);
    for (const o of spec.oscs) {
      const osc = ctx.createOscillator();
      if (o.pulse) osc.setPeriodicWave(pulseWave(ctx, o.pulse)); else osc.type = o.type || 'sawtooth';
      osc.frequency.value = f * (o.ratio ?? 1);
      osc.detune.value = o.detune || 0;
      const og = o.gain ?? 1;
      if (!sameGain && Math.abs(og - 1) > 0.26) { const g = ctx.createGain(); g.gain.value = og; osc.connect(g); g.connect(mix); } else osc.connect(mix);
      osc.start(t); sources.push(osc); detuneTargets.push(osc.detune);
    }
    if (spec.vib) {
      const lfo = ctx.createOscillator(); lfo.frequency.value = spec.vib.rate;
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(spec.vib.depth, t + (spec.vib.delay ?? 0.2) + 0.35);
      lfo.connect(lg); for (const d of detuneTargets) lg.connect(d);
      lfo.start(t); sources.push(lfo);
    }
    if (spec.lfoFilter) {
      const lfo = ctx.createOscillator(); lfo.frequency.value = spec.lfoFilter.rate;
      const lg = ctx.createGain(); lg.gain.value = spec.lfoFilter.depth * 1200;
      lfo.connect(lg); lg.connect(flt.detune); lfo.start(t); sources.push(lfo);
    }
    if (spec.noise) {
      const n = ctx.createBufferSource(); n.buffer = noiseBuf(ctx); n.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = clamp(f * (spec.noise.ratio ?? 1), 100, 12000); bp.Q.value = spec.noise.q ?? 2;
      const ng = ctx.createGain(); ng.gain.value = spec.noise.level;
      n.connect(bp); bp.connect(ng); ng.connect(mix); n.start(t); sources.push(n);
    }
    if (spec.click) {
      const n = ctx.createBufferSource(); n.buffer = noiseBuf(ctx);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
      const cg = ctx.createGain(); cg.gain.setValueAtTime(spec.click * peak, t); cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
      n.connect(hp); hp.connect(cg); cg.connect(amp); n.start(t); n.stop(t + 0.03);
    }
    if (spec.drive) { const ws = ctx.createWaveShaper(); ws.curve = satCurve(spec.drive); flt.connect(ws); ws.connect(amp); } else flt.connect(amp);
    amp.connect(out);
    const maxEnd = spec.pluck ? t + A + D * 8 + 0.1 : undefined;
    if (spec.pluck) for (const s of sources) { try { s.stop(maxEnd); } catch { /* */ } }
    return new Voice(ctx, rel, sources, R, maxEnd);
  };
}

// ---------------------------------------------------------------- FM voices (electric piano, bells)
function fm(spec) {
  return function start(ctx, out, t, midi, vel, P) {
    const f = mtof(midi + (spec.shift || 0)), v = vel / 127;
    const car = ctx.createOscillator(); car.type = 'sine'; car.frequency.value = f * (spec.carRatio ?? 1);
    const mod = ctx.createOscillator(); mod.type = 'sine'; mod.frequency.value = f * spec.modRatio;
    const mg = ctx.createGain();
    const idx = spec.index * (0.35 + 0.9 * v) * (0.45 + 1.1 * (P.tone ?? 0.5)) * f * (spec.carRatio ?? 1);
    mg.gain.setValueAtTime(idx, t); mg.gain.setTargetAtTime(idx * spec.idxEnd, t, spec.idxT);
    mod.connect(mg); mg.connect(car.frequency);
    const sources = [car, mod];
    if (spec.tine) {
      const t2 = ctx.createOscillator(); t2.type = 'sine'; t2.frequency.value = f * spec.tine.ratio;
      const tg = ctx.createGain(); const ti = spec.tine.idx * v * f;
      tg.gain.setValueAtTime(ti, t); tg.gain.setTargetAtTime(0, t, spec.tine.t);
      t2.connect(tg); tg.connect(car.frequency); sources.push(t2); t2.start(t);
    }
    const A = tm(spec.amp.a, P.attack), R = tm(spec.amp.r, P.release);
    const amp = ctx.createGain(), rel = amp;
    const peak = spec.level * velAmp(v, 0.3);
    const tau = spec.amp.tau * Math.pow(261.63 / f, spec.amp.tilt ?? 0.4);
    amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(peak, t + A);
    amp.gain.setTargetAtTime(peak * (spec.amp.s ?? 0), t + A, tau);
    car.connect(amp); amp.connect(out);
    car.start(t); mod.start(t);
    const maxEnd = spec.pluck ? t + A + tau * 8 : undefined;
    if (maxEnd) for (const s of sources) { try { s.stop(maxEnd); } catch { /* */ } }
    return new Voice(ctx, rel, sources, R, maxEnd);
  };
}

// ---------------------------------------------------------------- pre-rendered note buffers (piano, plucks, mallets)
const bufCache = new Map();
let bufBytes = 0;
const BUF_LIMIT = 110 * 1024 * 1024;     // cached note samples are dropped oldest-first beyond this
export function cachedBuffer(key, sr, render) {
  const k = key + '@' + sr;
  let b = bufCache.get(k);
  if (!b) {
    const data = render();
    if (!data) return null;                      // plugin instruments render asynchronously: not ready yet
    b = new AudioBuffer({ length: data.length, sampleRate: sr, numberOfChannels: 1 });
    b.copyToChannel(data, 0);
    bufCache.set(k, b);
    bufBytes += data.length * 4;
    for (const [ok, ob] of bufCache) {
      if (bufBytes <= BUF_LIMIT || ok === k) break;
      bufCache.delete(ok); bufBytes -= ob.length * 4;
    }
  }
  return b;
}
export const hasBuffer = (key, sr) => bufCache.has(key + '@' + sr);
export function normalize(d, peak = 0.7) {
  let m = 0;
  for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > m) m = a; }
  if (m > 0) { const g = peak / m; for (let i = 0; i < d.length; i++) d[i] *= g; }
  const fade = Math.min(d.length, 480);
  for (let i = 0; i < fade; i++) d[d.length - 1 - i] *= i / fade;
  return d;
}

function renderPiano(midi, sr) {
  const f0 = mtof(midi);
  const T0 = clamp(5.2 * Math.pow(2, -(midi - 48) / 17), 0.8, 7);
  const dur = Math.min(5.5, T0 * 3.6);
  const N = Math.floor(dur * sr), out = new Float32Array(N);
  const B = 0.00006 * Math.pow(2, (midi - 36) / 16);
  const strings = midi < 40 ? [0] : midi < 62 ? [0, 0.0010] : [0, 0.0012, -0.0009];
  const r = rng(midi * 31 + 7);
  const strike = 0.118;
  const maxPart = 26;
  for (let n = 1; n <= maxPart; n++) {
    const fn = n * f0 * Math.sqrt(1 + B * n * n);
    if (fn > sr * 0.42 || fn > 15000) break;
    const hammer = Math.abs(Math.sin(Math.PI * n * strike));
    const a0 = (1 / Math.pow(n, 0.85)) * (0.25 + hammer) * Math.exp(-n * 0.045);
    if (a0 < 0.004) continue;
    const tau = T0 / (1 + (n - 1) * 0.5);
    const d1 = Math.exp(-1 / (sr * tau * 0.28)), d2 = Math.exp(-1 / (sr * tau * 1.5));
    for (const det of strings) {
      const w = (2 * Math.PI * fn * (1 + det)) / sr;
      const ph = r() * 6.2832;
      let c = Math.cos(ph), s = Math.sin(ph);
      const cw = Math.cos(w), sw = Math.sin(w);
      let e1 = 0.62 * a0 / strings.length, e2 = 0.38 * a0 / strings.length;
      for (let i = 0; i < N; i++) {
        out[i] += s * (e1 + e2);
        e1 *= d1; e2 *= d2;
        const nc = c * cw - s * sw; s = s * cw + c * sw; c = nc;
      }
    }
  }
  // hammer thump + felt noise
  let lp = 0;
  const thumpLen = Math.min(N, Math.floor(sr * 0.05)), amt = 0.22 * (1 - (midi - 21) / 110);
  const k = clamp(0.1 + (midi - 21) / 100, 0.1, 0.6);
  for (let i = 0; i < thumpLen; i++) {
    lp += k * ((r() * 2 - 1) - lp);
    out[i] += lp * amt * Math.exp(-i / (sr * 0.006));
  }
  for (let i = 0; i < Math.min(N, 96); i++) out[i] *= i / 96;   // 2ms soft attack
  return normalize(out, 0.75);
}

function renderPluck(midi, sr, o) {
  const f = mtof(midi);
  const N = Math.floor(sr * o.dur), out = new Float32Array(N);
  const Lt = sr / f - 0.5;
  const D = Math.floor(Lt) - 1;
  if (D < 4) return out;
  const frac = Lt - D;
  const a = (1 - frac) / (1 + frac);
  const buf = new Float32Array(D);
  const r = rng(midi * 17 + 3);
  let lpS = 0;
  for (let i = 0; i < D; i++) { lpS += o.bright * ((r() * 2 - 1) - lpS); buf[i] = lpS; }
  const pk = Math.max(1, Math.round(o.pos * D));
  const tmp = buf.slice();
  for (let i = 0; i < D; i++) buf[i] = tmp[i] - tmp[(i + pk) % D];
  let rms = 0; for (let i = 0; i < D; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / D) || 1; for (let i = 0; i < D; i++) buf[i] /= rms * 2.2;
  const g = Math.pow(10, -3 / (Math.max(0.05, o.t60) * f));
  const wA = o.damp ?? 0.5;
  let idx = 0, apx = 0, apy = 0;
  for (let n = 0; n < N; n++) {
    const s = buf[idx], nx = buf[(idx + 1) % D];
    const lp = (1 - wA) * s + wA * nx;
    const y = a * lp + apx - a * apy;
    apx = lp; apy = y;
    buf[idx] = y * g;
    out[n] = s;
    idx = (idx + 1) % D;
  }
  // loudness-match: plucks are spiky, so level them by RMS of the first 250 ms, then cap the peak
  let e = 0; const m = Math.min(N, Math.floor(sr * 0.25));
  for (let i = 0; i < m; i++) e += out[i] * out[i];
  const g2 = 0.1 / (Math.sqrt(e / m) || 1);
  for (let i = 0; i < N; i++) out[i] *= g2;
  return normalize(softCap(out), 0.9);
}
function softCap(d) { let pk = 0; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i])); if (pk > 0.9) for (let i = 0; i < d.length; i++) d[i] *= 0.9 / pk; return d; }

function renderMallet(midi, sr, o) {
  const f0 = mtof(midi + (o.shift || 0));
  const dur = o.dur;
  const N = Math.floor(sr * dur), out = new Float32Array(N);
  const pitchScale = clamp(Math.pow(2, -(midi - 60) / 22), 0.4, 2.2);
  o.ratios.forEach((ratio, k) => {
    const fn = f0 * ratio;
    if (fn > sr * 0.42) return;
    const tau = o.decays[k] * pitchScale;
    const dc = Math.exp(-1 / (sr * tau));
    const w = (2 * Math.PI * fn) / sr, cw = Math.cos(w), sw = Math.sin(w);
    let c = 1, s = 0, e = o.amps[k];
    for (let i = 0; i < N; i++) { out[i] += s * e; e *= dc; const nc = c * cw - s * sw; s = s * cw + c * sw; c = nc; }
  });
  const m = Math.min(N, 40);
  for (let i = 0; i < m; i++) out[i] *= i / m;
  return normalize(out, 0.7);
}

export const pianoKeyRange = [21, 108];
/** A voice that makes no sound (used while a plugin instrument is still rendering this note). */
export function silentVoice(ctx, t) {
  const c = ctx.createConstantSource(); c.start(t); c.stop(t + 0.02);
  return new Voice(ctx, ctx.createGain(), [c], 0.02, t + 0.05);
}
export function bufferInstrument(id, render, spec) {
  const fn = function start(ctx, out, t, midi, vel, P) {
    const sr = ctx.sampleRate, v = vel / 127;
    const note = clamp(midi, pianoKeyRange[0], pianoKeyRange[1]);
    const buf = cachedBuffer(id + ':' + note, sr, () => render(note, sr));
    if (!buf) return silentVoice(ctx, t);
    const src = ctx.createBufferSource(); src.buffer = buf;
    if (midi !== note) src.playbackRate.value = Math.pow(2, (midi - note) / 12);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5;
    lp.frequency.value = clamp(fc(spec.lp, P.tone) * (0.3 + 0.9 * Math.pow(v, 1.3)), 300, 19000);
    const amp = ctx.createGain(), rel = amp;
    const peak = spec.level * velAmp(v, 0.18) * (midi > 72 ? 1 + (midi - 72) / 20 : 1);   // high plucks are naturally quiet
    const A = tm(spec.a ?? 0.002, P.attack), R = tm(spec.r, P.release);
    amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(peak, t + Math.max(0.0015, A));
    src.connect(lp);
    if (spec.drive) { const ws = ctx.createWaveShaper(); ws.curve = satCurve(spec.drive); lp.connect(ws); ws.connect(amp); } else lp.connect(amp);
    amp.connect(out);
    src.start(t);
    return new Voice(ctx, rel, [src], R, t + buf.duration / (src.playbackRate.value) + 0.05);
  };
  fn.render = render; fn.id = id;
  return fn;
}

// ---------------------------------------------------------------- special voices
function bass808(ctx, out, t, midi, vel, P) {
  const f = mtof(midi), v = vel / 127;
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(f * 2.1, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.045);
  const ws = ctx.createWaveShaper(); ws.curve = satCurve(0.6 + 1.6 * (P.tone ?? 0.5));
  const amp = ctx.createGain(), rel = amp;
  const peak = 0.5 * velAmp(v, 0.3);
  const A = tm(0.003, P.attack);
  amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(peak, t + A);
  amp.gain.setTargetAtTime(peak * 0.35, t + A, tm(0.9, P.release) / 3);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = clamp(fc(520, P.tone), 120, 8000);
  o.connect(ws); ws.connect(lp); lp.connect(amp); amp.connect(out);
  o.start(t);
  return new Voice(ctx, rel, [o], 0.14);
}

function formantVoice(ctx, out, t, midi, vel, P) {
  const f = mtof(midi), v = vel / 127, vow = P.tone ?? 0.5;
  const mix = ctx.createGain();
  const sources = [];
  for (const d of [-9, 0, 9]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d;
    o.connect(mix); o.start(t); sources.push(o);
  }
  const lfo = ctx.createOscillator(); lfo.frequency.value = 5.1;
  const lg = ctx.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(10, t + 0.8);
  lfo.connect(lg); sources.forEach((s) => lg.connect(s.detune)); lfo.start(t); sources.push(lfo);
  const F = [[350 + 500 * vow, 1], [700 + 520 * vow, 0.5], [2500 + 400 * vow, 0.22], [3500, 0.1]];
  const sum = ctx.createGain(); sum.gain.value = 1.6;
  for (const [fr, g] of F) {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fr; bp.Q.value = 7;
    const gg = ctx.createGain(); gg.gain.value = g;
    mix.connect(bp); bp.connect(gg); gg.connect(sum);
  }
  const n = ctx.createBufferSource(); n.buffer = noiseBuf(ctx); n.loop = true;
  const nb = ctx.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = 1800; nb.Q.value = 1.2;
  const ng = ctx.createGain(); ng.gain.value = 0.04; n.connect(nb); nb.connect(ng); ng.connect(sum); n.start(t); sources.push(n);
  const amp = ctx.createGain(), rel = amp;
  const A = tm(0.3, P.attack), R = tm(0.55, P.release);
  amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(0.55 * velAmp(v, 0.4), t + A);
  sum.connect(amp); amp.connect(out);
  return new Voice(ctx, rel, sources, R);
}

// ---------------------------------------------------------------- extra custom voices (effects / risers)
function riser(ctx, out, t, midi, vel, P) {
  const f = mtof(midi), v = vel / 127, D = tm(2.0, P.attack);
  const n = ctx.createBufferSource(); n.buffer = noiseBuf(ctx); n.loop = true;
  const ng = ctx.createGain(); ng.gain.value = 4;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(f * 0.6, t); bp.frequency.exponentialRampToValueAtTime(clamp(f * 28, 2000, 14000), t + D);
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(f * 0.5, t); o.frequency.exponentialRampToValueAtTime(clamp(f * 6, 200, 6000), t + D);
  const og = ctx.createGain(); og.gain.value = 0.08;
  const amp = ctx.createGain(), rel = amp;
  amp.gain.setValueAtTime(0.12, t); amp.gain.exponentialRampToValueAtTime(0.7 * velAmp(v, 0.5), t + D);
  n.connect(ng); ng.connect(bp); bp.connect(amp); o.connect(og); og.connect(amp); amp.connect(out);
  n.start(t); o.start(t);
  return new Voice(ctx, rel, [n, o], tm(0.25, P.release));
}
function subDrop(ctx, out, t, midi, vel, P) {
  const f = mtof(midi), v = vel / 127, D = tm(1.3, P.release);
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(clamp(f * 3, 60, 800), t); o.frequency.exponentialRampToValueAtTime(clamp(f * 0.25, 18, 80), t + D);
  const amp = ctx.createGain(), rel = amp;
  amp.gain.setValueAtTime(0.7 * velAmp(v, 0.5), t); amp.gain.setTargetAtTime(0, t + 0.05, D / 3);
  const n = ctx.createBufferSource(); n.buffer = noiseBuf(ctx);
  const nl = ctx.createBiquadFilter(); nl.type = 'lowpass'; nl.frequency.value = 900;
  const ng = ctx.createGain(); ng.gain.setValueAtTime(0.25, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  o.connect(amp); n.connect(nl); nl.connect(ng); ng.connect(amp); amp.connect(out);
  o.start(t); n.start(t); n.stop(t + 0.5);
  return new Voice(ctx, rel, [o], 0.1, t + D * 2 + 0.2);
}
function zap(ctx, out, t, midi, vel, P) {
  const f = mtof(midi), v = vel / 127, D = tm(0.22, P.release);
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(clamp(f * 10, 300, 9000), t); o.frequency.exponentialRampToValueAtTime(clamp(f * 0.6, 60, 900), t + D);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 6; lp.frequency.setValueAtTime(7000, t); lp.frequency.exponentialRampToValueAtTime(400, t + D);
  const amp = ctx.createGain(), rel = amp;
  amp.gain.setValueAtTime(0.35 * velAmp(v, 0.5), t); amp.gain.setTargetAtTime(0, t + D * 0.5, D / 3);
  o.connect(lp); lp.connect(amp); amp.connect(out); o.start(t);
  return new Voice(ctx, rel, [o], 0.05, t + D * 3 + 0.1);
}
function wind(ctx, out, t, midi, vel, P) {
  const f = mtof(midi), v = vel / 127;
  const n = ctx.createBufferSource(); n.buffer = noiseBuf(ctx); n.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4; bp.frequency.value = clamp(f * 2, 200, 5000);
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.22;
  const lg = ctx.createGain(); lg.gain.value = 900; lfo.connect(lg); lg.connect(bp.detune);
  const amp = ctx.createGain(), rel = amp;
  const A = tm(1.1, P.attack);
  amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(0.9 * velAmp(v, 0.4), t + A);
  n.connect(bp); bp.connect(amp); amp.connect(out);
  n.start(t); lfo.start(t);
  return new Voice(ctx, rel, [n, lfo], tm(1.2, P.release));
}
const crackleCache = new WeakMap();
function crackle(ctx, out, t, midi, vel, P) {
  let b = crackleCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = b.getChannelData(0), r = rng(4242);
    let lp = 0;
    for (let i = 0; i < d.length; i++) { lp += 0.25 * ((r() * 2 - 1) - lp); d[i] = lp * 0.02; }
    for (let k = 0; k < 60; k++) {
      const pos = Math.floor(r() * (d.length - 400)), amp = (0.15 + r() * 0.8) * (r() > 0.5 ? 1 : -1), tau = 20 + r() * 120;
      for (let j = 0; j < 400; j++) d[pos + j] += amp * Math.exp(-j / tau) * (r() * 0.6 + 0.4);
    }
    crackleCache.set(ctx, b);
  }
  const src = ctx.createBufferSource(); src.buffer = b; src.loop = true;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = clamp(fc(500, P.tone), 100, 6000);
  const amp = ctx.createGain(), rel = amp;
  amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(0.6 * velAmp(vel / 127, 0.4), t + 0.06);
  src.connect(hp); hp.connect(amp); amp.connect(out); src.start(t);
  return new Voice(ctx, rel, [src], tm(0.3, P.release));
}

// ---------------------------------------------------------------- the catalogue
const SAW = (o = {}) => ({ type: 'sawtooth', ...o });
const SQ = (o = {}) => ({ type: 'square', ...o });
const SIN = (o = {}) => ({ type: 'sine', ...o });
const TRI = (o = {}) => ({ type: 'triangle', ...o });

const piano = bufferInstrument('piano', renderPiano, { lp: 9500, level: 0.9, r: 0.22, spread: 0.5 });
const guitar = bufferInstrument('guitar', (m, sr) => renderPluck(m, sr, { dur: 3.6, t60: 3.2, bright: 0.55, damp: 0.5, pos: 0.14 }), { lp: 5200, level: 0.9, r: 0.35, spread: 0.3 });
const nylon = bufferInstrument('nylon', (m, sr) => renderPluck(m, sr, { dur: 3, t60: 2.4, bright: 0.28, damp: 0.52, pos: 0.18 }), { lp: 3800, level: 1.0, r: 0.3, spread: 0.3 });
const harp = bufferInstrument('harp', (m, sr) => renderPluck(m, sr, { dur: 4, t60: 3.6, bright: 0.85, damp: 0.5, pos: 0.27 }), { lp: 8000, level: 0.85, r: 0.5, spread: 0.7 });
const pizz = bufferInstrument('pizz', (m, sr) => renderPluck(m, sr, { dur: 1.2, t60: 0.55, bright: 0.7, damp: 0.5, pos: 0.2 }), { lp: 6000, level: 1.0, r: 0.12, spread: 0.3 });
const marimba = bufferInstrument('marimba', (m, sr) => renderMallet(m, sr, { dur: 1.6, ratios: [1, 3.93, 9.2], amps: [1, 0.38, 0.1], decays: [0.7, 0.12, 0.05] }), { lp: 9000, level: 1.0, r: 0.15, spread: 0.5 });
const vibes = bufferInstrument('vibes', (m, sr) => renderMallet(m, sr, { dur: 3.4, ratios: [1, 4, 10.1], amps: [1, 0.22, 0.07], decays: [2.2, 0.6, 0.2] }), { lp: 9000, level: 0.95, r: 0.5, spread: 0.5 });
const glock = bufferInstrument('glock', (m, sr) => renderMallet(m, sr, { dur: 2.4, shift: 12, ratios: [1, 2.76, 5.4, 8.93], amps: [1, 0.5, 0.3, 0.18], decays: [1.5, 0.7, 0.35, 0.18] }), { lp: 12000, level: 0.8, r: 0.4, spread: 0.6 });
const musicbox = bufferInstrument('musicbox', (m, sr) => renderMallet(m, sr, { dur: 1.8, shift: 12, ratios: [1, 2.0, 3.01, 4.2, 5.4], amps: [1, 0.35, 0.22, 0.12, 0.08], decays: [0.9, 0.4, 0.25, 0.12, 0.07] }), { lp: 11000, level: 0.8, r: 0.3, spread: 0.6 });
const toypiano = bufferInstrument('toypiano', (m, sr) => renderMallet(m, sr, { dur: 1.2, shift: 12, ratios: [1, 3.1, 5.9, 8.4], amps: [1, 0.6, 0.4, 0.25], decays: [0.5, 0.25, 0.12, 0.08] }), { lp: 9000, level: 0.85, r: 0.15, spread: 0.5 });
const celesta = bufferInstrument('celesta', (m, sr) => renderMallet(m, sr, { dur: 2.2, shift: 12, ratios: [1, 4, 9.2], amps: [1, 0.35, 0.1], decays: [1.4, 0.4, 0.1] }), { lp: 11000, level: 0.9, r: 0.3, spread: 0.6 });
const kalimba = bufferInstrument('kalimba', (m, sr) => renderMallet(m, sr, { dur: 2.0, ratios: [1, 5.4, 11], amps: [1, 0.3, 0.08], decays: [1.6, 0.2, 0.06] }), { lp: 7000, level: 0.95, r: 0.3, spread: 0.4 });
const steeldrum = bufferInstrument('steeldrum', (m, sr) => renderMallet(m, sr, { dur: 1.8, ratios: [1, 2, 3.01, 4.02], amps: [1, 0.7, 0.45, 0.25], decays: [1.0, 0.7, 0.4, 0.25] }), { lp: 8500, level: 0.9, r: 0.25, spread: 0.5 });
const harpsichord = bufferInstrument('harpsichord', (m, sr) => renderPluck(m, sr, { dur: 2, t60: 1.2, bright: 1.0, damp: 0.5, pos: 0.08 }), { lp: 9500, level: 0.9, r: 0.06, spread: 0.4 });
const banjo = bufferInstrument('banjo', (m, sr) => renderPluck(m, sr, { dur: 1.6, t60: 0.7, bright: 0.97, damp: 0.5, pos: 0.08 }), { lp: 8000, level: 1.0, r: 0.1, spread: 0.3 });
const mandolin = bufferInstrument('mandolin', (m, sr) => renderPluck(m, sr, { dur: 1.8, t60: 1.0, bright: 0.85, damp: 0.5, pos: 0.12 }), { lp: 7500, level: 1.0, r: 0.12, spread: 0.4 });
const muteguitar = bufferInstrument('muteguitar', (m, sr) => renderPluck(m, sr, { dur: 0.8, t60: 0.3, bright: 0.3, damp: 0.5, pos: 0.15 }), { lp: 3000, level: 1.3, r: 0.06, spread: 0.3 });
const eguitar = bufferInstrument('eguitar', (m, sr) => renderPluck(m, sr, { dur: 3.2, t60: 2.5, bright: 0.6, damp: 0.5, pos: 0.2 }), { lp: 6500, level: 0.95, r: 0.25, spread: 0.3 });
const distguitar = bufferInstrument('distguitar', (m, sr) => renderPluck(m, sr, { dur: 3.2, t60: 2.5, bright: 0.6, damp: 0.5, pos: 0.2 }), { lp: 4500, level: 0.55, r: 0.15, spread: 0.3, drive: 6 });
const upright = bufferInstrument('upright', (m, sr) => renderPluck(m, sr, { dur: 2.2, t60: 1.1, bright: 0.22, damp: 0.5, pos: 0.35 }), { lp: 1400, level: 1.1, r: 0.12 });
const ebass = bufferInstrument('ebass', (m, sr) => renderPluck(m, sr, { dur: 2.6, t60: 2.2, bright: 0.5, damp: 0.5, pos: 0.3 }), { lp: 3500, level: 1.0, r: 0.1 });
const slapbass = bufferInstrument('slapbass', (m, sr) => renderPluck(m, sr, { dur: 1.2, t60: 0.6, bright: 0.95, damp: 0.5, pos: 0.12 }), { lp: 5500, level: 1.1, r: 0.08 });

export const INSTRUMENTS = [
  // Keys
  { id: 'piano', name: 'Grand Piano', cat: 'Keys', icon: 'piano', desc: 'Additive-synth piano with hammer thump and string beating', start: piano },
  { id: 'epiano', name: 'Electric Piano', cat: 'Keys', icon: 'piano', desc: 'Soft FM tine piano — warm and bell-like',
    start: fm({ modRatio: 1, index: 2.1, idxEnd: 0.16, idxT: 0.4, tine: { ratio: 14, idx: 0.9, t: 0.02 }, amp: { a: 0.004, tau: 1.6, s: 0.03, r: 0.3 }, level: 0.5, pluck: false }) },
  { id: 'organ', name: 'Drawbar Organ', cat: 'Keys', icon: 'organ', desc: 'Classic tonewheel-style organ with a swirl',
    start: synth({ oscs: [SIN({ ratio: 0.5, gain: 0.8 }), SIN({ ratio: 1.5, gain: 0.7 }), SIN({ ratio: 1, gain: 0.9 }), SIN({ ratio: 2, gain: 0.7 }), SIN({ ratio: 3, gain: 0.45 }), SIN({ ratio: 4, gain: 0.3 }), SIN({ ratio: 5, gain: 0.2 }), SIN({ ratio: 8, gain: 0.12 })],
      level: 0.15, filter: { f: 9000, q: 0.5 }, amp: { a: 0.01, s: 1, r: 0.07 }, vib: { rate: 6.6, depth: 9, delay: 0 }, click: 0.25 }) },
  { id: 'clav', name: 'Clavinet', cat: 'Keys', icon: 'piano', desc: 'Funky plucked clav',
    start: synth({ oscs: [{ pulse: 0.25, gain: 1 }, SAW({ gain: 0.35, detune: 3 })], level: 0.6, filter: { f: 2600, q: 2.4, env: 4, envT: 0.07, keytrack: 0.6 }, amp: { a: 0.002, d: 0.22, s: 0.02, r: 0.07 }, pluck: true }) },
  { id: 'vibes', name: 'Vibraphone', cat: 'Keys', icon: 'mallet', desc: 'Shimmering metal bars', start: vibes },
  { id: 'marimba', name: 'Marimba', cat: 'Keys', icon: 'mallet', desc: 'Woody mallet percussion', start: marimba },
  { id: 'glock', name: 'Glockenspiel', cat: 'Keys', icon: 'mallet', desc: 'Bright bell chimes', start: glock },
  { id: 'musicbox', name: 'Music Box', cat: 'Keys', icon: 'mallet', desc: 'Tinkling music box', start: musicbox },
  { id: 'bell', name: 'FM Bell', cat: 'Keys', icon: 'mallet', desc: 'Glassy FM bell',
    start: fm({ modRatio: 3.5, index: 3.2, idxEnd: 0.1, idxT: 0.5, amp: { a: 0.002, tau: 0.9, s: 0, r: 0.5 }, level: 0.4, pluck: true }) },
  // Plucked
  { id: 'guitar', name: 'Acoustic Guitar', cat: 'Plucked', icon: 'guitar', desc: 'Karplus-Strong steel string', start: guitar },
  { id: 'nylon', name: 'Nylon Guitar', cat: 'Plucked', icon: 'guitar', desc: 'Soft classical guitar', start: nylon },
  { id: 'harp', name: 'Harp', cat: 'Plucked', icon: 'guitar', desc: 'Long, shimmering plucked strings', start: harp },
  { id: 'pizz', name: 'Pizzicato Strings', cat: 'Orchestral', icon: 'guitar', desc: 'Short plucked orchestral strings', start: pizz },
  // Bass
  { id: 'sub', name: 'Sub Bass', cat: 'Bass', icon: 'bass', desc: 'Pure low sine weight',
    start: synth({ oscs: [SIN({ gain: 1 }), TRI({ gain: 0.2 })], level: 0.55, filter: { f: 900, q: 0.5, keytrack: 0 }, amp: { a: 0.005, s: 1, r: 0.09 } }) },
  { id: 'bass808', name: '808 Bass', cat: 'Bass', icon: 'bass', desc: 'Trap/hip-hop booming 808 with glide and drive', start: bass808, defaults: { tone: 0.45, attack: 0.5, release: 0.55 } },
  { id: 'synbass', name: 'Synth Bass', cat: 'Bass', icon: 'bass', desc: 'Fat analog-style bass',
    start: synth({ oscs: [SAW({ gain: 0.8 }), SQ({ gain: 0.5, detune: -7 }), SIN({ ratio: 0.5, gain: 0.7 })], level: 0.28, filter: { f: 750, q: 3.5, env: 3.2, envT: 0.2, keytrack: 0.35 }, amp: { a: 0.004, s: 0.85, d: 0.4, r: 0.1 } }) },
  { id: 'acid', name: 'Acid Bass', cat: 'Bass', icon: 'bass', desc: 'Squelchy resonant 303-style line',
    start: synth({ oscs: [SAW({ gain: 1 })], level: 0.32, filter: { f: 420, q: 13, env: 7, envT: 0.17, keytrack: 0.3, velAmt: 0.6 }, amp: { a: 0.003, s: 0.8, d: 0.3, r: 0.07 } }) },
  { id: 'reese', name: 'Reese Bass', cat: 'Bass', icon: 'bass', desc: 'Detuned, moving drum & bass bass',
    start: synth({ oscs: [SAW({ detune: -16, gain: 0.7 }), SAW({ detune: 16, gain: 0.7 }), SAW({ gain: 0.5 }), SIN({ ratio: 0.5, gain: 0.8 })], level: 0.25, filter: { f: 640, q: 2.5, keytrack: 0.2 }, lfoFilter: { rate: 0.3, depth: 0.7 }, amp: { a: 0.01, s: 1, r: 0.18 } }) },
  { id: 'pluckbass', name: 'Pluck Bass', cat: 'Bass', icon: 'bass', desc: 'Short, tight, funky',
    start: synth({ oscs: [SAW({ gain: 0.8 }), SQ({ gain: 0.4, ratio: 0.5 })], level: 0.62, filter: { f: 650, q: 3, env: 5, envT: 0.1, keytrack: 0.3 }, amp: { a: 0.002, d: 0.28, s: 0.05, r: 0.08 }, pluck: true }) },
  // Synth leads
  { id: 'sawlead', name: 'Saw Lead', cat: 'Synth', icon: 'wave', desc: 'Classic cutting lead with vibrato',
    start: synth({ oscs: [SAW({ gain: 0.8 }), SAW({ detune: 9, gain: 0.8 }), SQ({ ratio: 0.5, gain: 0.3 })], level: 0.36, filter: { f: 3200, q: 1.5, env: 2.4, envT: 0.25, keytrack: 0.5 }, amp: { a: 0.005, s: 0.85, d: 0.3, r: 0.15 }, vib: { rate: 5.2, depth: 9, delay: 0.25 } }) },
  { id: 'sqlead', name: 'Square Lead', cat: 'Synth', icon: 'wave', desc: 'Hollow retro lead',
    start: synth({ oscs: [SQ({ gain: 0.8 }), SQ({ detune: 6, gain: 0.6 })], level: 0.2, filter: { f: 2800, q: 1.2, env: 2, envT: 0.2, keytrack: 0.5 }, amp: { a: 0.006, s: 0.85, r: 0.14 }, vib: { rate: 5.5, depth: 7, delay: 0.3 } }) },
  { id: 'supersaw', name: 'Supersaw', cat: 'Synth', icon: 'wave', desc: 'Seven detuned saws — big trance/EDM chords',
    start: synth({ oscs: [-22, -9, 0, 9, 22].map((d) => SAW({ detune: d, gain: 1 })), level: 0.4, filter: { f: 7000, q: 0.6, keytrack: 0.4 }, amp: { a: 0.012, s: 0.9, r: 0.3 }, spread: 0.3 }) },
  { id: 'chip', name: '8-Bit Lead', cat: 'Synth', icon: 'wave', desc: 'Chiptune pulse wave',
    start: synth({ oscs: [{ pulse: 0.25, gain: 1 }], level: 0.2, filter: { f: 12000, q: 0.5 }, amp: { a: 0.002, s: 0.9, r: 0.05 }, vib: { rate: 6, depth: 8, delay: 0.3 } }) },
  { id: 'pluck', name: 'Synth Pluck', cat: 'Synth', icon: 'wave', desc: 'Plucky poly-synth stab',
    start: synth({ oscs: [SAW({ gain: 0.8 }), SQ({ detune: 7, gain: 0.5 })], level: 0.85, filter: { f: 3200, q: 3, env: 3, envT: 0.12, keytrack: 0.5 }, amp: { a: 0.001, d: 0.32, s: 0.0, r: 0.15 }, pluck: true, spread: 0.3 }) },
  { id: 'arp', name: 'Arp Pluck', cat: 'Synth', icon: 'wave', desc: 'Bright, short — made for arpeggios',
    start: synth({ oscs: [TRI({ gain: 0.8 }), SAW({ gain: 0.4, detune: 4 })], level: 1.1, filter: { f: 5500, q: 2, env: 3, envT: 0.06, keytrack: 0.6 }, amp: { a: 0.001, d: 0.16, s: 0, r: 0.08 }, pluck: true, spread: 0.4 }) },
  // Pads / strings
  { id: 'pad', name: 'Dream Pad', cat: 'Pads', icon: 'pad', desc: 'Slow, wide, evolving pad',
    start: synth({ oscs: [SAW({ detune: -11, gain: 0.7 }), SAW({ detune: 11, gain: 0.7 }), SAW({ detune: 0, gain: 0.5 }), TRI({ ratio: 0.5, gain: 0.5 })], level: 0.5, filter: { f: 1700, q: 0.8, keytrack: 0.3 }, lfoFilter: { rate: 0.22, depth: 0.5 }, amp: { a: 0.55, s: 1, r: 1.1 }, spread: 0.5 }) },
  { id: 'warmpad', name: 'Warm Pad', cat: 'Pads', icon: 'pad', desc: 'Soft analog pad',
    start: synth({ oscs: [TRI({ gain: 1 }), SAW({ detune: 6, gain: 0.35 }), SAW({ detune: -6, gain: 0.35 })], level: 0.58, filter: { f: 1200, q: 0.7, keytrack: 0.4 }, amp: { a: 0.7, s: 1, r: 1.3 }, spread: 0.4 }) },
  { id: 'strings', sustain: true, name: 'String Ensemble', cat: 'Orchestral', icon: 'violin', desc: 'Lush string section',
    start: synth({ oscs: [SAW({ detune: -8, gain: 0.7 }), SAW({ detune: 0, gain: 0.7 }), SAW({ detune: 8, gain: 0.7 })], level: 0.45, filter: { f: 3000, q: 0.6, keytrack: 0.4 }, amp: { a: 0.22, s: 1, r: 0.5 }, vib: { rate: 5.6, depth: 7, delay: 0.4 }, spread: 0.5 }) },
  { id: 'brass', sustain: true, name: 'Brass Section', cat: 'Orchestral', icon: 'horn', desc: 'Warm synth brass swell',
    start: synth({ oscs: [SAW({ detune: -5, gain: 0.9 }), SAW({ detune: 5, gain: 0.9 })], level: 0.4, filter: { f: 1100, q: 1, env: 4.5, fa: 0.09, envT: 0.2, keytrack: 0.5, velAmt: 0.5 }, amp: { a: 0.035, s: 0.9, r: 0.12 }, spread: 0.2 }) },
  { id: 'choir', name: 'Choir Ooh/Ahh', cat: 'Pads', icon: 'voice', desc: 'Formant choir — Tone morphs Ooh → Ahh', start: formantVoice },
  { id: 'flute', sustain: true, name: 'Flute', cat: 'Orchestral', icon: 'horn', desc: 'Breathy flute',
    start: synth({ oscs: [SIN({ gain: 1 }), TRI({ ratio: 2, gain: 0.12 })], level: 0.34, filter: { f: 4500, q: 0.6 }, amp: { a: 0.06, s: 1, r: 0.15 }, vib: { rate: 5, depth: 8, delay: 0.35 }, noise: { level: 0.05, q: 2.5, ratio: 2 } }) },
  // ---- more keys
  { id: 'wurli', name: 'Wurlitzer', cat: 'Keys', icon: 'piano', desc: 'Barky vintage electric piano',
    start: fm({ modRatio: 1, index: 1.5, idxEnd: 0.3, idxT: 0.25, tine: { ratio: 7, idx: 0.7, t: 0.03 }, amp: { a: 0.004, tau: 1.1, s: 0.05, r: 0.25 }, level: 0.5 }) },
  { id: 'toypiano', name: 'Toy Piano', cat: 'Keys', icon: 'mallet', desc: 'Plinky little toy keys', start: toypiano },
  { id: 'harpsichord', name: 'Harpsichord', cat: 'Keys', icon: 'piano', desc: 'Bright baroque plucked keys', start: harpsichord },
  { id: 'celesta', name: 'Celesta', cat: 'Keys', icon: 'mallet', desc: 'Soft, magical bell keys', start: celesta },
  { id: 'kalimba', name: 'Kalimba', cat: 'Keys', icon: 'mallet', desc: 'Thumb piano with a warm pluck', start: kalimba },
  { id: 'steeldrum', name: 'Steel Drum', cat: 'Keys', icon: 'mallet', desc: 'Island steel pan', start: steeldrum },
  { id: 'churchorgan', name: 'Church Organ', cat: 'Keys', icon: 'organ', desc: 'Big, slow pipe organ',
    start: synth({ oscs: [SIN({ ratio: 0.5, gain: 0.8 }), SIN({ gain: 1 }), SIN({ ratio: 2, gain: 0.8 }), SIN({ ratio: 3, gain: 0.6 }), SIN({ ratio: 4, gain: 0.5 }), SIN({ ratio: 6, gain: 0.3 }), SIN({ ratio: 8, gain: 0.2 })], level: 0.13, filter: { f: 7000, q: 0.5 }, amp: { a: 0.07, s: 1, r: 0.35 }, vib: { rate: 4.8, depth: 5, delay: 0.1 }, spread: 0.2 }) },
  { id: 'rockorgan', name: 'Rock Organ', cat: 'Keys', icon: 'organ', desc: 'Growling overdriven organ',
    start: synth({ oscs: [SIN({ ratio: 0.5, gain: 0.7 }), SIN({ gain: 1 }), SIN({ ratio: 2, gain: 0.8 }), SQ({ ratio: 3, gain: 0.15 }), SIN({ ratio: 4, gain: 0.4 })], level: 0.12, filter: { f: 6000, q: 0.7 }, drive: 4, amp: { a: 0.008, s: 1, r: 0.06 }, vib: { rate: 6.8, depth: 8, delay: 0 }, click: 0.2 }) },
  { id: 'accordion', name: 'Accordion', cat: 'Keys', icon: 'organ', desc: 'Reedy squeezebox',
    start: synth({ oscs: [SAW({ detune: -6, gain: 0.6 }), SAW({ detune: 6, gain: 0.6 }), SQ({ gain: 0.25 })], level: 0.14, filter: { f: 2600, q: 1.1, keytrack: 0.4 }, amp: { a: 0.05, s: 1, r: 0.09 }, vib: { rate: 5.6, depth: 5, delay: 0.2 } }) },
  // ---- more plucked
  { id: 'banjo', name: 'Banjo', cat: 'Plucked', icon: 'guitar', desc: 'Twangy bluegrass banjo', start: banjo },
  { id: 'mandolin', name: 'Mandolin', cat: 'Plucked', icon: 'guitar', desc: 'Sparkly folk mandolin', start: mandolin },
  { id: 'muteguitar', name: 'Muted Guitar', cat: 'Plucked', icon: 'guitar', desc: 'Short, palm-muted chug', start: muteguitar },
  { id: 'eguitar', name: 'Electric Guitar', cat: 'Plucked', icon: 'guitar', desc: 'Clean electric guitar', start: eguitar },
  { id: 'distguitar', name: 'Distorted Guitar', cat: 'Plucked', icon: 'guitar', desc: 'Crunchy rock rhythm guitar', start: distguitar },
  // ---- more bass
  { id: 'upright', name: 'Upright Bass', cat: 'Bass', icon: 'bass', desc: 'Warm acoustic jazz bass', start: upright },
  { id: 'ebass', name: 'Electric Bass', cat: 'Bass', icon: 'bass', desc: 'Round fingered bass guitar', start: ebass },
  { id: 'slapbass', name: 'Slap Bass', cat: 'Bass', icon: 'bass', desc: 'Snappy funk bass', start: slapbass },
  { id: 'wobble', name: 'Wobble Bass', cat: 'Bass', icon: 'bass', desc: 'Dubstep-style wobbling bass',
    start: synth({ oscs: [SAW({ gain: 0.8 }), SAW({ detune: 12, gain: 0.7 }), SQ({ ratio: 0.5, gain: 0.6 })], level: 0.26, filter: { f: 520, q: 7, keytrack: 0.2 }, lfoFilter: { rate: 2.6, depth: 1.5 }, amp: { a: 0.005, s: 1, r: 0.1 } }) },
  { id: 'fmbass', name: 'FM Bass', cat: 'Bass', icon: 'bass', desc: 'Clangy 80s digital bass',
    start: fm({ modRatio: 1, index: 2.4, idxEnd: 0.35, idxT: 0.12, amp: { a: 0.003, tau: 0.6, s: 0.55, r: 0.1, tilt: 0 }, level: 0.5 }) },
  { id: 'sqsub', name: 'Square Bass', cat: 'Bass', icon: 'bass', desc: 'Hollow retro-game bass',
    start: synth({ oscs: [SQ({ gain: 1 })], level: 0.3, filter: { f: 550, q: 0.7 }, amp: { a: 0.004, s: 1, r: 0.08 } }) },
  { id: 'distbass', name: 'Dirty Bass', cat: 'Bass', icon: 'bass', desc: 'Gritty overdriven bass',
    start: synth({ oscs: [SAW({ gain: 0.8 }), SQ({ gain: 0.5, detune: -5 })], level: 0.2, filter: { f: 1100, q: 2, keytrack: 0.3 }, drive: 5, amp: { a: 0.003, s: 0.9, r: 0.08 } }) },
  // ---- more synths
  { id: 'trance', name: 'Trance Lead', cat: 'Synth', icon: 'wave', desc: 'Huge detuned trance lead',
    start: synth({ oscs: [-16, 0, 16].map((d) => SAW({ detune: d, gain: 1 })).concat([SAW({ ratio: 2, gain: 0.35 })]), level: 0.12, filter: { f: 6500, q: 0.7, keytrack: 0.4 }, amp: { a: 0.005, s: 0.9, r: 0.2 }, vib: { rate: 5.4, depth: 6, delay: 0.3 }, spread: 0.25 }) },
  { id: 'pulselead', name: 'Pulse Lead', cat: 'Synth', icon: 'wave', desc: 'Thin, nasal pulse-wave lead',
    start: synth({ oscs: [{ pulse: 0.3, gain: 1 }, { pulse: 0.3, detune: 8, gain: 0.8 }], level: 0.22, filter: { f: 4000, q: 1, env: 2, envT: 0.2, keytrack: 0.4 }, amp: { a: 0.004, s: 0.85, r: 0.12 }, vib: { rate: 5, depth: 6, delay: 0.3 } }) },
  { id: 'whistle', name: 'Whistle', cat: 'Synth', icon: 'wave', desc: 'Breathy human whistle',
    start: synth({ oscs: [SIN({ gain: 1 }), SIN({ ratio: 2, gain: 0.06 })], level: 0.34, filter: { f: 6000, q: 0.6 }, amp: { a: 0.07, s: 1, r: 0.12 }, vib: { rate: 5.5, depth: 14, delay: 0.15 }, noise: { level: 0.02, q: 4, ratio: 2 } }) },
  { id: 'theremin', name: 'Theremin', cat: 'Synth', icon: 'wave', desc: 'Spooky wobbling sci-fi tone',
    start: synth({ oscs: [SIN({ gain: 1 }), SIN({ ratio: 2, gain: 0.1 })], level: 0.34, filter: { f: 5000, q: 0.5 }, amp: { a: 0.12, s: 1, r: 0.25 }, vib: { rate: 5.3, depth: 28, delay: 0 } }) },
  // ---- more pads
  { id: 'glasspad', name: 'Glass Pad', cat: 'Pads', icon: 'pad', desc: 'Shimmering, airy glass',
    start: synth({ oscs: [SIN({ gain: 1 }), SIN({ ratio: 2, gain: 0.5 }), SIN({ ratio: 3, gain: 0.3 }), TRI({ ratio: 4, gain: 0.15, detune: 6 }), SIN({ detune: 5, gain: 0.6 })], level: 0.17, filter: { f: 5000, q: 0.6, keytrack: 0.3 }, lfoFilter: { rate: 0.15, depth: 0.3 }, amp: { a: 0.9, s: 1, r: 1.4 }, spread: 0.5 }) },
  { id: 'darkpad', name: 'Dark Pad', cat: 'Pads', icon: 'pad', desc: 'Moody, cinematic low pad',
    start: synth({ oscs: [SAW({ detune: -9, gain: 0.7 }), SAW({ detune: 9, gain: 0.7 }), SQ({ ratio: 0.5, gain: 0.4 })], level: 0.22, filter: { f: 650, q: 0.9, keytrack: 0.3 }, lfoFilter: { rate: 0.12, depth: 0.6 }, amp: { a: 1.1, s: 1, r: 1.8 }, spread: 0.4 }) },
  { id: 'choiroo', name: 'Choir Ooh', cat: 'Pads', icon: 'voice', desc: 'Soft, round "ooh" voices', start: formantVoice, defaults: { tone: 0.08, attack: 0.5, release: 0.5 } },
  // ---- orchestral
  { id: 'violin', name: 'Violin', cat: 'Orchestral', icon: 'violin', desc: 'Singing solo violin', sustain: true,
    start: synth({ oscs: [SAW({ detune: -3, gain: 0.7 }), SAW({ detune: 3, gain: 0.7 }), TRI({ gain: 0.3 })], level: 0.16, filter: { f: 4200, q: 0.8, keytrack: 0.5 }, amp: { a: 0.14, s: 1, r: 0.22 }, vib: { rate: 5.8, depth: 10, delay: 0.25 }, noise: { level: 0.012, q: 1.5, ratio: 3 } }) },
  { id: 'cello', name: 'Cello', cat: 'Orchestral', icon: 'violin', desc: 'Deep, expressive cello', sustain: true,
    start: synth({ oscs: [SAW({ gain: 0.8 }), SAW({ detune: 5, gain: 0.6 }), SQ({ ratio: 0.5, gain: 0.2 })], level: 0.15, filter: { f: 1800, q: 0.8, keytrack: 0.4 }, amp: { a: 0.18, s: 1, r: 0.3 }, vib: { rate: 5, depth: 7, delay: 0.35 }, spread: 0.15 }) },
  { id: 'trumpet', name: 'Trumpet', cat: 'Orchestral', icon: 'horn', desc: 'Bright, bold trumpet', sustain: true,
    start: synth({ oscs: [SAW({ gain: 0.9 }), SAW({ detune: 4, gain: 0.6 })], level: 0.17, filter: { f: 1400, q: 1.2, env: 4, fa: 0.04, envT: 0.15, keytrack: 0.6, velAmt: 0.6 }, amp: { a: 0.03, s: 1, r: 0.1 }, vib: { rate: 5.2, depth: 5, delay: 0.4 } }) },
  { id: 'horn', name: 'French Horn', cat: 'Orchestral', icon: 'horn', desc: 'Warm, round horn', sustain: true,
    start: synth({ oscs: [TRI({ gain: 1 }), SAW({ gain: 0.35, detune: 3 })], level: 0.2, filter: { f: 800, q: 0.8, env: 2, fa: 0.08, envT: 0.2, keytrack: 0.4 }, amp: { a: 0.1, s: 1, r: 0.2 }, vib: { rate: 5, depth: 4, delay: 0.4 } }) },
  { id: 'oboe', name: 'Oboe', cat: 'Orchestral', icon: 'horn', desc: 'Nasal, expressive reed', sustain: true,
    start: synth({ oscs: [SAW({ gain: 1 })], level: 0.3, filter: { type: 'bandpass', f: 1300, q: 0.9, keytrack: 0.7 }, amp: { a: 0.05, s: 1, r: 0.12 }, vib: { rate: 5.3, depth: 6, delay: 0.3 }, noise: { level: 0.02, q: 2, ratio: 3 } }) },
  { id: 'clarinet', name: 'Clarinet', cat: 'Orchestral', icon: 'horn', desc: 'Woody, hollow clarinet', sustain: true,
    start: synth({ oscs: [SQ({ gain: 1 })], level: 0.2, filter: { f: 1400, q: 0.8, keytrack: 0.6 }, amp: { a: 0.05, s: 1, r: 0.1 }, vib: { rate: 5, depth: 5, delay: 0.5 }, noise: { level: 0.015, q: 2, ratio: 2 } }) },
  { id: 'sax', name: 'Saxophone', cat: 'Orchestral', icon: 'horn', desc: 'Smoky, breathy sax', sustain: true,
    start: synth({ oscs: [SAW({ gain: 0.8 }), SQ({ gain: 0.4, detune: 6 })], level: 0.2, filter: { f: 2400, q: 1.5, env: 2, envT: 0.1, keytrack: 0.5 }, amp: { a: 0.04, s: 1, r: 0.1 }, vib: { rate: 5.5, depth: 6, delay: 0.3 }, noise: { level: 0.035, q: 1.5, ratio: 2 } }) },
  // ---- effects
  { id: 'riser', name: 'Noise Riser', cat: 'FX', icon: 'wave', desc: 'Rising tension sweep — Attack sets the length', start: riser, sustain: true },
  { id: 'subdrop', name: 'Sub Drop', cat: 'FX', icon: 'wave', desc: 'Falling bass drop for transitions', start: subDrop, sustain: true },
  { id: 'zap', name: 'Laser Zap', cat: 'FX', icon: 'wave', desc: 'Sci-fi laser blast', start: zap, sustain: true },
  { id: 'wind', name: 'Wind', cat: 'FX', icon: 'wave', desc: 'Moving wind atmosphere', start: wind, sustain: true },
  { id: 'crackle', name: 'Vinyl Crackle', cat: 'FX', icon: 'wave', desc: 'Dusty record crackle — hold a note', start: crackle, sustain: true },
];
export const INST_BY_ID = Object.fromEntries(INSTRUMENTS.map((i) => [i.id, i]));
// building blocks for the extra instrument libraries (instruments2.js)
export { noiseBuf, satCurve, pulseWave, tm, fc, velAmp, renderPluck, renderMallet, renderPiano, softCap, synth, fm, formantVoice };
export const isBassInst = (i) => !!i && (i.cat === 'Bass' || i.role === 'bass');
export const INST_CATS = ['Keys', 'Plucked', 'Bass', 'Synth', 'Pads', 'Orchestral', 'FX'];
export const DEFAULT_PARAMS = { tone: 0.5, attack: 0.5, release: 0.5 };

/** Gradually render the note buffers of a buffer-based instrument so the first keypress doesn't hiccup. */
const warmed = new Set();
export function prewarm(instId, sr, lo = 36, hi = 96) {
  const inst = INST_BY_ID[instId];
  if (inst && inst.start.prepare) return inst.start.prepare(sr, lo, hi);
  if (!inst || !inst.start.render || warmed.has(instId + sr)) return Promise.resolve();
  warmed.add(instId + sr);
  return new Promise((resolve) => {
    let m = lo;
    const step = () => {
      const t0 = performance.now();
      while (m <= hi && performance.now() - t0 < 10) {
        cachedBuffer(instId + ':' + m, sr, () => inst.start.render(m, sr));
        m++;
      }
      if (m <= hi) setTimeout(step, 0); else resolve();
    };
    setTimeout(step, 0);
  });
}
/** Synchronously render the notes a render job needs (used before offline export). */
export function warmNotes(instId, sr, midis) {
  const inst = INST_BY_ID[instId];
  if (!inst || !inst.start.render) return;
  for (const m of midis) {
    const note = clamp(m, pianoKeyRange[0], pianoKeyRange[1]);
    cachedBuffer(instId + ':' + note, sr, () => inst.start.render(note, sr));
  }
}
