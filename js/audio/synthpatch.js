// Sky Synth: a fully editable subtractive synth. A "patch" is plain JSON stored on the track, so projects carry their sounds.
// patchVoice(getPatch) returns an instrument start() function (same contract as the built-in instruments).
import { clamp, mtof } from '../util.js';
import { Voice } from './instruments.js';

export const DEFAULT_PATCH = {
  osc1: { on: true, wave: 'sawtooth', oct: 0, semi: 0, detune: 0, level: 1, pw: 0.5 },
  osc2: { on: false, wave: 'sawtooth', oct: 0, semi: 0, detune: 7, level: 0.8, pw: 0.5 },
  sub: { on: false, level: 0.6 },
  noise: { level: 0 },
  unison: { voices: 1, spread: 20 },
  filter: { type: 'lowpass', cutoff: 3000, res: 1, keytrack: 0.3, env: 0, vel: 0 },
  fenv: { a: 0.005, d: 0.3, s: 0.4, r: 0.3 },
  aenv: { a: 0.005, d: 0.3, s: 0.8, r: 0.25 },
  lfo: { target: 'pitch', wave: 'sine', rate: 5, depth: 0, delay: 0.2 },
  drive: 0,
  level: 0.6,
};

export const WAVES = [['Saw', 'sawtooth'], ['Square', 'square'], ['Pulse', 'pulse'], ['Triangle', 'triangle'], ['Sine', 'sine']];
export const FILTER_TYPES = [['Low-pass', 'lowpass'], ['High-pass', 'highpass'], ['Band-pass', 'bandpass'], ['Notch', 'notch']];
export const LFO_TARGETS = [['Pitch (vibrato)', 'pitch'], ['Filter (wobble)', 'filter'], ['Volume (tremolo)', 'amp']];
export const LFO_WAVES = [['Sine', 'sine'], ['Triangle', 'triangle'], ['Square', 'square'], ['Saw', 'sawtooth']];

export function mergePatch(base, over) {
  const out = JSON.parse(JSON.stringify(base));
  for (const k of Object.keys(over || {})) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k])) out[k] = { ...(out[k] || {}), ...over[k] };
    else out[k] = over[k];
  }
  return out;
}
export const makePatch = (over) => mergePatch(DEFAULT_PATCH, over);

const waveCache = new WeakMap();
function pulseWave(ctx, w) {
  let m = waveCache.get(ctx);
  if (!m) { m = new Map(); waveCache.set(ctx, m); }
  const key = Math.round(w * 100);
  if (!m.has(key)) {
    const N = 64, re = new Float32Array(N), im = new Float32Array(N);
    for (let n = 1; n < N; n++) { re[n] = (2 * Math.sin(2 * Math.PI * n * w)) / (Math.PI * n); im[n] = (2 * (1 - Math.cos(2 * Math.PI * n * w))) / (Math.PI * n); }
    m.set(key, ctx.createPeriodicWave(re, im));
  }
  return m.get(key);
}
const noiseCache = new WeakMap();
function noiseBuf(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0); let s = 77;
    for (let i = 0; i < d.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; d[i] = s / 2147483648 - 1; }
    noiseCache.set(ctx, b);
  }
  return b;
}
const satCurve = (k) => { const n = 1024, c = new Float32Array(n), nm = Math.tanh(k); for (let i = 0; i < n; i++) c[i] = Math.tanh(k * ((i / (n - 1)) * 2 - 1)) / nm; return c; };
const tm = (base, x) => base * Math.pow(10, ((x ?? 0.5) - 0.5) * 2);
const fcx = (base, x) => base * Math.pow(2, ((x ?? 0.5) - 0.5) * 5);
const velAmp = (v, floor = 0.22) => floor + (1 - floor) * Math.pow(v, 1.25);

export function patchVoice(getPatch) {
  return function start(ctx, out, t, midi, vel, P) {
    const pt = (typeof getPatch === 'function' ? getPatch(P) : getPatch) || DEFAULT_PATCH;
    const f = mtof(midi), v = vel / 127;
    const F = pt.filter, AE = pt.aenv, FE = pt.fenv;
    const A = tm(AE.a, P.attack), D = AE.d, S = clamp(AE.s, 0, 1), R = tm(AE.r, P.release);

    // ---- filter
    const flt = ctx.createBiquadFilter();
    flt.type = F.type || 'lowpass'; flt.Q.value = clamp(F.res ?? 1, 0.1, 24);
    let fb = fcx(F.cutoff, P.tone) * Math.pow(f / 261.63, F.keytrack ?? 0) * Math.pow(2, (F.vel ?? 0) * (v - 0.5) * 3);
    fb = clamp(fb, 30, 18000);
    const envOct = F.env || 0;
    if (envOct) {
      const peak = clamp(fb * Math.pow(2, envOct), 30, 19000), sus = clamp(fb * Math.pow(2, envOct * clamp(FE.s, 0, 1)), 30, 19000);
      flt.frequency.setValueAtTime(fb, t);
      flt.frequency.linearRampToValueAtTime(peak, t + Math.max(0.002, FE.a));
      flt.frequency.setTargetAtTime(sus, t + Math.max(0.002, FE.a), Math.max(0.01, FE.d) / 3);
    } else flt.frequency.value = fb;

    // ---- oscillators (osc1 / osc2, each optionally unison-stacked) + sub + noise
    const sources = [], pitchTargets = [];
    const groups = [];
    for (const key of ['osc1', 'osc2']) {
      const o = pt[key];
      if (!o || !o.on) continue;
      const nUni = clamp(Math.round(pt.unison.voices || 1), 1, 7);
      const base = f * Math.pow(2, (o.oct || 0) + (o.semi || 0) / 12);
      let g = null;
      const needGain = Math.abs((o.level ?? 1) - 1) > 0.02 || nUni > 1;
      if (needGain) { g = ctx.createGain(); g.gain.value = (o.level ?? 1) / Math.sqrt(nUni); g.connect(flt); }
      for (let u = 0; u < nUni; u++) {
        const osc = ctx.createOscillator();
        if (o.wave === 'pulse') osc.setPeriodicWave(pulseWave(ctx, clamp(o.pw ?? 0.5, 0.05, 0.95))); else osc.type = o.wave || 'sawtooth';
        osc.frequency.value = base;
        const spread = nUni > 1 ? ((u / (nUni - 1)) * 2 - 1) * (pt.unison.spread || 0) : 0;
        osc.detune.value = (o.detune || 0) + spread;
        osc.connect(g || flt); osc.start(t);
        sources.push(osc); pitchTargets.push(osc.detune);
      }
      groups.push(g);
    }
    if (pt.sub && pt.sub.on) {
      const s = ctx.createOscillator(); s.type = 'sine'; s.frequency.value = f / 2;
      const g = ctx.createGain(); g.gain.value = pt.sub.level ?? 0.6; s.connect(g); g.connect(flt); s.start(t); sources.push(s);
    }
    if (pt.noise && pt.noise.level > 0.001) {
      const n = ctx.createBufferSource(); n.buffer = noiseBuf(ctx); n.loop = true;
      const g = ctx.createGain(); g.gain.value = pt.noise.level * 0.5; n.connect(g); g.connect(flt); n.start(t); sources.push(n);
    }
    const nOsc = Math.max(1, groups.length + (pt.sub && pt.sub.on ? 1 : 0));

    // ---- amp (one gain node does envelope + release) and optional drive / tremolo
    const amp = ctx.createGain();
    const peak = (pt.level ?? 0.6) * 0.5 * velAmp(v) / Math.sqrt(nOsc);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + Math.max(0.002, A));
    if (S < 1) amp.gain.setTargetAtTime(peak * S, t + Math.max(0.002, A), Math.max(0.01, D) / 3);
    let tail = flt;
    if (pt.drive > 0.01) { const ws = ctx.createWaveShaper(); ws.curve = satCurve(1 + pt.drive * 10); ws.oversample = 'none'; flt.connect(ws); tail = ws; }
    let lfoNode = null;
    const L = pt.lfo;
    if (L && L.depth > 0.001) {
      lfoNode = ctx.createOscillator(); lfoNode.type = L.wave || 'sine'; lfoNode.frequency.value = clamp(L.rate || 5, 0.05, 30);
      const lg = ctx.createGain(); lfoNode.connect(lg);
      if (L.target === 'pitch') { lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(L.depth * 200, t + (L.delay || 0) + 0.05); for (const d of pitchTargets) lg.connect(d); }
      else if (L.target === 'filter') { lg.gain.value = L.depth * 2400; lg.connect(flt.detune); }
      else { const tr = ctx.createGain(); tr.gain.value = 1 - L.depth / 2; lg.gain.value = L.depth / 2; lg.connect(tr.gain); tail.connect(tr); tail = tr; }
      lfoNode.start(t); sources.push(lfoNode);
    }
    tail.connect(amp); amp.connect(out);

    const voice = new Voice(ctx, amp, sources, R);
    const baseRelease = voice.release.bind(voice);
    voice.release = (tt, rt) => {
      if (voice.released) return;
      if (envOct) { flt.frequency.cancelAndHoldAtTime && flt.frequency.cancelAndHoldAtTime(tt); flt.frequency.setTargetAtTime(fb, tt, Math.max(0.01, tm(FE.r, P.release)) / 3); }
      baseRelease(tt, rt);
    };
    return voice;
  };
}

// ---------------------------------------------------------------- factory presets
const P = makePatch;
const saw = 'sawtooth', sq = 'square', tri = 'triangle', sin = 'sine', pulse = 'pulse';
export const SYNTH_PRESETS = [
  // ---- leads
  { id: 'sp_classic', name: 'Classic Saw Lead', cat: 'Lead', desc: 'Two detuned saws with a filter pluck', patch: P({ osc2: { on: true, detune: 8, level: 0.9 }, filter: { cutoff: 2400, res: 2.5, env: 2, keytrack: 0.5 }, fenv: { a: 0.003, d: 0.35, s: 0.45, r: 0.25 }, aenv: { a: 0.004, d: 0.2, s: 0.85, r: 0.18 }, lfo: { target: 'pitch', rate: 5.2, depth: 0.04, delay: 0.35 } }) },
  { id: 'sp_fatsq', name: 'Fat Square Lead', cat: 'Lead', desc: 'Hollow, wide square lead', patch: P({ osc1: { wave: sq }, osc2: { on: true, wave: sq, oct: -1, detune: 5 }, filter: { cutoff: 2600, res: 1.5, env: 1, keytrack: 0.4 }, aenv: { a: 0.006, d: 0.2, s: 0.9, r: 0.15 } }) },
  { id: 'sp_super', name: 'Super Lead', cat: 'Lead', desc: 'Five detuned saws — huge and bright', patch: P({ unison: { voices: 5, spread: 34 }, filter: { cutoff: 6000, res: 0.9, keytrack: 0.6 }, aenv: { a: 0.01, d: 0.3, s: 0.9, r: 0.3 } }) },
  { id: 'sp_screamer', name: 'Screamer', cat: 'Lead', desc: 'Resonant sweep with a bite', patch: P({ osc2: { on: true, semi: 7, detune: 4, level: 0.6 }, filter: { cutoff: 1800, res: 6, env: 3, keytrack: 0.6, vel: 0.6 }, fenv: { a: 0.002, d: 0.5, s: 0.3, r: 0.3 }, drive: 0.3 }) },
  { id: 'sp_softsine', name: 'Soft Sine Lead', cat: 'Lead', desc: 'Smooth and mellow', patch: P({ osc1: { wave: sin }, osc2: { on: true, wave: tri, oct: 1, level: 0.25 }, filter: { cutoff: 5000, res: 0.7 }, aenv: { a: 0.04, d: 0.3, s: 0.9, r: 0.3 }, lfo: { target: 'pitch', rate: 5, depth: 0.05, delay: 0.4 } }) },
  { id: 'sp_hoover', name: 'Hoover', cat: 'Lead', desc: 'Rave stab that dives down', patch: P({ osc2: { on: true, oct: -1, detune: -12 }, unison: { voices: 5, spread: 70 }, filter: { cutoff: 4200, res: 2, env: -1.5, keytrack: 0.3 }, fenv: { a: 0.002, d: 0.6, s: 0, r: 0.3 }, aenv: { a: 0.005, d: 0.4, s: 0.7, r: 0.25 }, drive: 0.25 }) },
  { id: 'sp_chip', name: 'Chip Pluck', cat: 'Lead', desc: '8-bit pulse pluck', patch: P({ osc1: { wave: pulse, pw: 0.25 }, filter: { cutoff: 12000, res: 0.6 }, aenv: { a: 0.001, d: 0.14, s: 0, r: 0.08 } }) },
  { id: 'sp_brass', name: 'Brass Stab', cat: 'Lead', desc: 'Punchy synth brass', patch: P({ osc2: { on: true, detune: -9 }, filter: { cutoff: 900, res: 1.2, env: 2.6, keytrack: 0.5, vel: 0.5 }, fenv: { a: 0.07, d: 0.25, s: 0.55, r: 0.2 }, aenv: { a: 0.03, d: 0.2, s: 0.85, r: 0.15 } }) },
  { id: 'sp_wobblelead', name: 'Wobble Lead', cat: 'Lead', desc: 'Filter wobbling at a steady rate', patch: P({ osc2: { on: true, detune: 6 }, filter: { cutoff: 1400, res: 5 }, lfo: { target: 'filter', wave: 'sine', rate: 3.2, depth: 0.7, delay: 0 } }) },
  { id: 'sp_whistle', name: 'Airy Whistle', cat: 'Lead', desc: 'Breathy sine lead', patch: P({ osc1: { wave: sin }, noise: { level: 0.06 }, filter: { cutoff: 6000, res: 1 }, aenv: { a: 0.06, d: 0.2, s: 1, r: 0.2 }, lfo: { target: 'pitch', rate: 5.6, depth: 0.08, delay: 0.2 } }) },
  // ---- bass
  { id: 'sp_subsine', name: 'Sub Sine', cat: 'Bass', desc: 'Pure low-end weight', patch: P({ osc1: { wave: sin }, filter: { cutoff: 900, res: 0.7, keytrack: 0 }, aenv: { a: 0.004, d: 0.1, s: 1, r: 0.1 }, level: 0.8 }) },
  { id: 'sp_fatbass', name: 'Fat Saw Bass', cat: 'Bass', desc: 'Saw plus sub for body', patch: P({ osc2: { on: true, wave: sq, oct: -1, level: 0.7 }, sub: { on: true, level: 0.5 }, filter: { cutoff: 700, res: 2.5, env: 2.2, keytrack: 0.3 }, fenv: { a: 0.002, d: 0.25, s: 0.3, r: 0.15 }, aenv: { a: 0.003, d: 0.2, s: 0.9, r: 0.1 } }) },
  { id: 'sp_reese', name: 'Reese', cat: 'Bass', desc: 'Detuned, slowly moving drum & bass bass', patch: P({ osc2: { on: true, detune: -22, level: 1 }, sub: { on: true, level: 0.5 }, filter: { cutoff: 600, res: 2, keytrack: 0.2 }, lfo: { target: 'filter', rate: 0.3, depth: 0.5, delay: 0 }, aenv: { a: 0.01, d: 0.3, s: 1, r: 0.2 } }) },
  { id: 'sp_acid', name: 'Acid 303', cat: 'Bass', desc: 'Squelchy resonant acid line', patch: P({ filter: { cutoff: 420, res: 14, env: 3.2, keytrack: 0.3, vel: 0.6 }, fenv: { a: 0.002, d: 0.18, s: 0.15, r: 0.1 }, aenv: { a: 0.002, d: 0.2, s: 0.8, r: 0.08 } }) },
  { id: 'sp_growl', name: 'Growl Bass', cat: 'Bass', desc: 'Gritty, aggressive mid-bass', patch: P({ osc1: { wave: sq }, osc2: { on: true, semi: 12, detune: 8, level: 0.6 }, filter: { cutoff: 1100, res: 4, env: 2, keytrack: 0.3 }, lfo: { target: 'filter', rate: 6, depth: 0.35, delay: 0 }, drive: 0.55, aenv: { a: 0.003, d: 0.2, s: 0.9, r: 0.1 } }) },
  { id: 'sp_pluckbass', name: 'Pluck Bass', cat: 'Bass', desc: 'Short, tight and funky', patch: P({ osc2: { on: true, wave: sq, oct: -1, level: 0.6 }, filter: { cutoff: 500, res: 3, env: 3, keytrack: 0.4 }, fenv: { a: 0.002, d: 0.14, s: 0, r: 0.1 }, aenv: { a: 0.002, d: 0.26, s: 0.05, r: 0.1 } }) },
  { id: 'sp_wobblebass', name: 'Wobble Bass', cat: 'Bass', desc: 'Dubstep wobble', patch: P({ osc2: { on: true, oct: -1, detune: 6 }, filter: { cutoff: 520, res: 7 }, lfo: { target: 'filter', wave: 'sine', rate: 2.6, depth: 0.9, delay: 0 }, aenv: { a: 0.005, d: 0.2, s: 1, r: 0.12 } }) },
  { id: 'sp_moog', name: 'Moog-ish Bass', cat: 'Bass', desc: 'Warm, rounded analog bass', patch: P({ osc1: { wave: saw }, osc2: { on: true, wave: tri, oct: -1, level: 0.9 }, filter: { cutoff: 650, res: 3, env: 2, keytrack: 0.5 }, fenv: { a: 0.004, d: 0.3, s: 0.35, r: 0.2 }, aenv: { a: 0.004, d: 0.3, s: 0.85, r: 0.12 } }) },
  { id: 'sp_distbass', name: 'Dirty Bass', cat: 'Bass', desc: 'Overdriven low-end grit', patch: P({ osc2: { on: true, wave: sq, detune: -6, level: 0.7 }, filter: { cutoff: 1000, res: 2, keytrack: 0.3 }, drive: 0.8, aenv: { a: 0.003, d: 0.2, s: 0.95, r: 0.1 } }) },
  { id: 'sp_808', name: '808 Style Sub', cat: 'Bass', desc: 'Long decaying sub tone', patch: P({ osc1: { wave: sin }, filter: { cutoff: 700, res: 0.7, keytrack: 0 }, drive: 0.35, aenv: { a: 0.003, d: 1.1, s: 0.15, r: 0.2 }, level: 0.85 }) },
  // ---- pads
  { id: 'sp_warm', name: 'Warm Pad', cat: 'Pad', desc: 'Soft, slow analog pad', patch: P({ osc1: { wave: tri }, osc2: { on: true, detune: 8, level: 0.4 }, unison: { voices: 3, spread: 14 }, filter: { cutoff: 1300, res: 0.8, keytrack: 0.4 }, aenv: { a: 0.7, d: 0.5, s: 1, r: 1.3 } }) },
  { id: 'sp_glass', name: 'Glass Pad', cat: 'Pad', desc: 'Shimmering sine stack', patch: P({ osc1: { wave: sin }, osc2: { on: true, wave: sin, oct: 1, detune: 5, level: 0.5 }, unison: { voices: 3, spread: 10 }, filter: { cutoff: 6000, res: 0.7 }, lfo: { target: 'filter', rate: 0.15, depth: 0.25, delay: 0 }, aenv: { a: 0.9, d: 0.5, s: 1, r: 1.5 } }) },
  { id: 'sp_dark', name: 'Dark Drone', cat: 'Pad', desc: 'Low, brooding, cinematic', patch: P({ osc2: { on: true, wave: sq, oct: -1, detune: -9, level: 0.5 }, unison: { voices: 3, spread: 18 }, filter: { cutoff: 600, res: 1.2, keytrack: 0.3 }, lfo: { target: 'filter', rate: 0.12, depth: 0.55, delay: 0 }, aenv: { a: 1.2, d: 0.5, s: 1, r: 1.8 } }) },
  { id: 'sp_evolve', name: 'Evolving Pad', cat: 'Pad', desc: 'Slowly breathing filter', patch: P({ osc2: { on: true, detune: -11 }, unison: { voices: 3, spread: 16 }, filter: { cutoff: 1000, res: 3, keytrack: 0.4 }, lfo: { target: 'filter', rate: 0.2, depth: 0.7, delay: 0 }, aenv: { a: 1, d: 0.5, s: 1, r: 1.6 } }) },
  { id: 'sp_stringpad', name: 'String Pad', cat: 'Pad', desc: 'Lush synth strings', patch: P({ unison: { voices: 4, spread: 18 }, filter: { cutoff: 3000, res: 0.8, keytrack: 0.5 }, aenv: { a: 0.3, d: 0.4, s: 1, r: 0.6 }, lfo: { target: 'pitch', rate: 5.5, depth: 0.04, delay: 0.5 } }) },
  { id: 'sp_sweep', name: 'Soft Sweep', cat: 'Pad', desc: 'Pad that opens up as you hold', patch: P({ osc2: { on: true, detune: 7 }, unison: { voices: 3, spread: 15 }, filter: { cutoff: 500, res: 1.5, env: 2.5, keytrack: 0.3 }, fenv: { a: 1.5, d: 1, s: 0.7, r: 1.2 }, aenv: { a: 0.8, d: 0.5, s: 1, r: 1.4 } }) },
  { id: 'sp_choir', name: 'Airy Choir Pad', cat: 'Pad', desc: 'Breathy vocal-ish texture', patch: P({ osc1: { wave: tri }, osc2: { on: true, wave: saw, level: 0.35, detune: 6 }, noise: { level: 0.05 }, filter: { type: 'bandpass', cutoff: 1100, res: 1.4, keytrack: 0.5 }, unison: { voices: 3, spread: 12 }, aenv: { a: 0.5, d: 0.4, s: 1, r: 1 }, level: 1.1 }) },
  { id: 'sp_sunrise', name: 'Sunrise', cat: 'Pad', desc: 'Bright, hopeful and wide', patch: P({ osc2: { on: true, oct: 1, level: 0.35, detune: 5 }, unison: { voices: 5, spread: 22 }, filter: { cutoff: 4500, res: 0.9, keytrack: 0.5 }, aenv: { a: 0.6, d: 0.5, s: 1, r: 1.2 } }) },
  // ---- plucks & keys
  { id: 'sp_pluck', name: 'Synth Pluck', cat: 'Pluck', desc: 'Classic poly-synth pluck', patch: P({ osc2: { on: true, wave: sq, detune: 7, level: 0.6 }, filter: { cutoff: 1500, res: 3, env: 3, keytrack: 0.5 }, fenv: { a: 0.002, d: 0.16, s: 0, r: 0.1 }, aenv: { a: 0.002, d: 0.3, s: 0, r: 0.12 } }) },
  { id: 'sp_bellpluck', name: 'Bell Pluck', cat: 'Pluck', desc: 'Glassy tuned bell', patch: P({ osc1: { wave: sin }, osc2: { on: true, wave: sin, semi: 19, level: 0.5 }, filter: { cutoff: 9000, res: 0.7 }, aenv: { a: 0.002, d: 1.2, s: 0, r: 0.4 } }) },
  { id: 'sp_marimba', name: 'Marimba Synth', cat: 'Pluck', desc: 'Woody mallet tone', patch: P({ osc1: { wave: tri }, osc2: { on: true, wave: sin, oct: 2, level: 0.3 }, filter: { cutoff: 3500, res: 1, env: 1.5, keytrack: 0.5 }, fenv: { a: 0.001, d: 0.1, s: 0, r: 0.1 }, aenv: { a: 0.001, d: 0.55, s: 0, r: 0.15 } }) },
  { id: 'sp_epiano', name: 'E-Piano Synth', cat: 'Keys', desc: 'Soft electric piano', patch: P({ osc1: { wave: tri }, osc2: { on: true, wave: sin, oct: 1, level: 0.3, detune: 2 }, filter: { cutoff: 3200, res: 0.8, env: 1.2, keytrack: 0.5 }, fenv: { a: 0.002, d: 0.4, s: 0.3, r: 0.3 }, aenv: { a: 0.003, d: 1.1, s: 0.15, r: 0.3 }, lfo: { target: 'amp', rate: 4.5, depth: 0.2, delay: 0.3 } }) },
  { id: 'sp_organ', name: 'Organ Synth', cat: 'Keys', desc: 'Buzzy square organ', patch: P({ osc1: { wave: sq }, osc2: { on: true, wave: sq, oct: 1, level: 0.35 }, sub: { on: true, level: 0.4 }, filter: { cutoff: 4000, res: 0.7, keytrack: 0.6 }, aenv: { a: 0.01, d: 0.1, s: 1, r: 0.08 }, lfo: { target: 'pitch', rate: 6.5, depth: 0.05, delay: 0 } }) },
  { id: 'sp_clav', name: 'Clav Synth', cat: 'Keys', desc: 'Funky short clav', patch: P({ osc1: { wave: pulse, pw: 0.2 }, filter: { type: 'bandpass', cutoff: 2200, res: 3, env: 1.5, keytrack: 0.6 }, fenv: { a: 0.001, d: 0.08, s: 0, r: 0.08 }, aenv: { a: 0.001, d: 0.22, s: 0, r: 0.07 }, level: 1.3 }) },
  { id: 'sp_stab', name: 'House Stab', cat: 'Keys', desc: 'Chord stab for house & garage', patch: P({ osc2: { on: true, detune: 10, level: 0.9 }, unison: { voices: 3, spread: 16 }, filter: { cutoff: 1800, res: 2, env: 2, keytrack: 0.5 }, fenv: { a: 0.002, d: 0.22, s: 0.1, r: 0.15 }, aenv: { a: 0.002, d: 0.22, s: 0.15, r: 0.15 } }) },
  // ---- fx-ish
  { id: 'sp_laser', name: 'Laser Lead', cat: 'FX', desc: 'Falling sci-fi zap', patch: P({ filter: { cutoff: 7000, res: 8, env: -3, keytrack: 0.3 }, fenv: { a: 0.001, d: 0.2, s: 0, r: 0.1 }, osc2: { on: true, semi: 12 }, aenv: { a: 0.001, d: 0.25, s: 0.2, r: 0.1 } }) },
  { id: 'sp_swell', name: 'Noise Swell', cat: 'FX', desc: 'Whooshing rise', patch: P({ osc1: { on: false }, noise: { level: 1 }, filter: { type: 'bandpass', cutoff: 500, res: 3, env: 3, keytrack: 0 }, fenv: { a: 1.5, d: 1, s: 1, r: 0.8 }, aenv: { a: 0.3, d: 0.5, s: 1, r: 0.6 }, level: 2.2 }) },
];
export const SYNTH_PRESET_BY_ID = Object.fromEntries(SYNTH_PRESETS.map((p) => [p.id, p]));
