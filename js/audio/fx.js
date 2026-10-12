// Mixer effects rack: definitions (used to draw the UI) and the factory that builds the audio nodes for each effect.
// Most effects are a single AudioWorkletNode (see fx-processors.js); reverb / filter / EQ / compressor / limiter use native nodes.
import { clamp, dbToGain } from '../util.js';

const pct = (v) => Math.round(v * 100) + '%';
const hz = (v) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : Math.round(v) + '');
const ms = (v) => Math.round(v) + ' ms';
const db = (v) => (v > 0 ? '+' : '') + v.toFixed(1) + ' dB';
const SYNC = [['Free', 0], ['1/2', 2], ['1/4', 1], ['Dotted 1/8', 0.75], ['1/8', 0.5], ['1/8 triplet', 1 / 3], ['1/16', 0.25]];

export const FX = {
  reverb: { name: 'Reverb', color: '#4aa3ff', desc: 'Adds space — from a small room to a huge hall', params: [
    { id: 'size', label: 'Size', min: 0, max: 1, def: 0.5, fmt: pct }, { id: 'damp', label: 'Damping', min: 0, max: 1, def: 0.5, fmt: pct },
    { id: 'mix', label: 'Mix', min: 0, max: 1, def: 0.3, fmt: pct }] },
  delay: { name: 'Echo', color: '#2ed3b7', desc: 'Repeating echoes, free or in time with the song', params: [
    { id: 'sync', label: 'Sync', type: 'select', options: SYNC, def: 0.75 }, { id: 'time', label: 'Time', min: 20, max: 1500, def: 300, fmt: ms, log: true, showIf: (p) => !p.sync },
    { id: 'feedback', label: 'Repeats', min: 0, max: 0.9, def: 0.4, fmt: pct }, { id: 'tone', label: 'Tone', min: 500, max: 16000, def: 6000, fmt: hz, log: true },
    { id: 'pingpong', label: 'Ping-pong', type: 'select', options: [['Off', 0], ['On', 1]], def: 0 }, { id: 'mix', label: 'Mix', min: 0, max: 1, def: 0.35, fmt: pct }] },
  chorus: { name: 'Chorus', color: '#8f7bff', desc: 'Thickens and widens a sound', params: [
    { id: 'rate', label: 'Rate', min: 0.1, max: 6, def: 0.8, fmt: (v) => v.toFixed(2) + ' Hz', log: true }, { id: 'depth', label: 'Depth', min: 0, max: 1, def: 0.5, fmt: pct },
    { id: 'mix', label: 'Mix', min: 0, max: 1, def: 0.5, fmt: pct }] },
  flanger: { name: 'Flanger', color: '#b46bff', desc: 'Swooshing jet-plane sweep', params: [
    { id: 'rate', label: 'Rate', min: 0.05, max: 5, def: 0.25, fmt: (v) => v.toFixed(2) + ' Hz', log: true }, { id: 'depth', label: 'Depth', min: 0, max: 1, def: 0.7, fmt: pct },
    { id: 'feedback', label: 'Feedback', min: -0.9, max: 0.9, def: 0.5, fmt: pct }, { id: 'mix', label: 'Mix', min: 0, max: 1, def: 0.5, fmt: pct }] },
  phaser: { name: 'Phaser', color: '#ff6fb5', desc: 'Liquid, moving notches', params: [
    { id: 'rate', label: 'Rate', min: 0.05, max: 6, def: 0.4, fmt: (v) => v.toFixed(2) + ' Hz', log: true }, { id: 'depth', label: 'Depth', min: 0, max: 1, def: 0.8, fmt: pct },
    { id: 'feedback', label: 'Feedback', min: 0, max: 0.9, def: 0.4, fmt: pct }, { id: 'center', label: 'Center', min: 150, max: 3000, def: 800, fmt: hz, log: true },
    { id: 'mix', label: 'Mix', min: 0, max: 1, def: 0.8, fmt: pct }] },
  drive: { name: 'Distortion', color: '#ff5f57', desc: 'Warmth, crunch and fuzz', params: [
    { id: 'drive', label: 'Drive', min: 0, max: 1, def: 0.5, fmt: pct }, { id: 'type', label: 'Type', type: 'select', options: [['Soft', 0], ['Hard', 1], ['Fold', 2], ['Tube', 3]], def: 0 },
    { id: 'tone', label: 'Tone', min: 1000, max: 16000, def: 9000, fmt: hz, log: true }, { id: 'mix', label: 'Mix', min: 0, max: 1, def: 1, fmt: pct }] },
  bitcrush: { name: 'Bit Crusher', color: '#ff9f43', desc: 'Lo-fi digital grit', params: [
    { id: 'bits', label: 'Bits', min: 1, max: 16, def: 8, step: 1, fmt: (v) => Math.round(v) + ' bit' }, { id: 'rate', label: 'Downsample', min: 1, max: 40, def: 4, step: 1, fmt: (v) => '÷' + Math.round(v) },
    { id: 'mix', label: 'Mix', min: 0, max: 1, def: 1, fmt: pct }] },
  filter: { name: 'Filter', color: '#5ed16a', desc: 'Low-pass, high-pass, band-pass or notch with resonance', params: [
    { id: 'type', label: 'Type', type: 'select', options: [['Low-pass', 0], ['High-pass', 1], ['Band-pass', 2], ['Notch', 3]], def: 0 },
    { id: 'cutoff', label: 'Cutoff', min: 40, max: 18000, def: 1200, fmt: hz, log: true }, { id: 'res', label: 'Resonance', min: 0.2, max: 16, def: 1, fmt: (v) => v.toFixed(1), log: true }] },
  eq: { name: 'EQ', color: '#ffd23f', desc: 'Boost or cut bass, mids and treble', params: [
    { id: 'low', label: 'Bass', min: -15, max: 15, def: 0, fmt: db }, { id: 'mid', label: 'Mid', min: -15, max: 15, def: 0, fmt: db },
    { id: 'midfreq', label: 'Mid freq', min: 200, max: 6000, def: 1000, fmt: hz, log: true }, { id: 'midq', label: 'Mid width', min: 0.3, max: 5, def: 1, fmt: (v) => v.toFixed(1), log: true },
    { id: 'high', label: 'Treble', min: -15, max: 15, def: 0, fmt: db }] },
  comp: { name: 'Compressor', color: '#ff7b5c', desc: 'Evens out loudness and adds punch', params: [
    { id: 'threshold', label: 'Threshold', min: -60, max: 0, def: -18, fmt: (v) => Math.round(v) + ' dB' }, { id: 'ratio', label: 'Ratio', min: 1, max: 20, def: 4, fmt: (v) => v.toFixed(1) + ':1', log: true },
    { id: 'attack', label: 'Attack', min: 1, max: 100, def: 10, fmt: ms, log: true }, { id: 'release', label: 'Release', min: 20, max: 800, def: 150, fmt: ms, log: true },
    { id: 'makeup', label: 'Makeup', min: 0, max: 18, def: 3, fmt: db }] },
  limiter: { name: 'Limiter', color: '#ff4d4f', desc: 'Stops peaks going over a ceiling', params: [
    { id: 'ceiling', label: 'Ceiling', min: -12, max: 0, def: -1, fmt: (v) => v.toFixed(1) + ' dB' }, { id: 'release', label: 'Release', min: 10, max: 500, def: 100, fmt: ms, log: true }] },
  tremolo: { name: 'Tremolo / Pan', color: '#19c3e6', desc: 'Pulsing volume or auto-panning', params: [
    { id: 'mode', label: 'Mode', type: 'select', options: [['Tremolo', 0], ['Auto-pan', 1]], def: 0 }, { id: 'rate', label: 'Rate', min: 0.2, max: 20, def: 5, fmt: (v) => v.toFixed(1) + ' Hz', log: true },
    { id: 'depth', label: 'Depth', min: 0, max: 1, def: 0.6, fmt: pct }, { id: 'shape', label: 'Shape', min: 0, max: 1, def: 0, fmt: (v) => (v < 0.5 ? 'smooth' : 'chop') }] },
  width: { name: 'Stereo Width', color: '#9aa7ff', desc: 'Make it narrower or wider', params: [
    { id: 'width', label: 'Width', min: 0, max: 2, def: 1, fmt: pct }, { id: 'gain', label: 'Level', min: -12, max: 12, def: 0, fmt: db }] },
  sidechain: { name: 'Sidechain Duck', color: '#ffb02e', desc: 'Ducks this track every time another track (like the kick) plays', params: [
    { id: 'source', label: 'Ducked by', type: 'track', def: '' }, { id: 'threshold', label: 'Threshold', min: -50, max: -5, def: -28, fmt: (v) => Math.round(v) + ' dB' },
    { id: 'amount', label: 'Amount', min: 0, max: 1, def: 0.8, fmt: pct }, { id: 'attack', label: 'Attack', min: 1, max: 80, def: 5, fmt: ms, log: true },
    { id: 'release', label: 'Release', min: 30, max: 800, def: 180, fmt: ms, log: true }] },
};
export const FX_ORDER = ['reverb', 'delay', 'chorus', 'flanger', 'phaser', 'drive', 'bitcrush', 'filter', 'eq', 'comp', 'limiter', 'tremolo', 'width', 'sidechain'];

export const FX_PRESETS = {
  reverb: [['Small room', { size: 0.15, damp: 0.6, mix: 0.2 }], ['Big hall', { size: 0.65, damp: 0.5, mix: 0.3 }], ['Cathedral', { size: 1, damp: 0.4, mix: 0.4 }], ['Dark plate', { size: 0.4, damp: 0.9, mix: 0.3 }]],
  delay: [['Slapback', { sync: 0, time: 110, feedback: 0.15, tone: 5000, mix: 0.3, pingpong: 0 }], ['Dotted 1/8', { sync: 0.75, feedback: 0.4, mix: 0.35, pingpong: 0 }], ['Ping-pong', { sync: 0.5, feedback: 0.5, mix: 0.4, pingpong: 1 }], ['Tape-ish', { sync: 0, time: 380, feedback: 0.5, tone: 2500, mix: 0.3, pingpong: 0 }]],
  chorus: [['Light', { rate: 0.5, depth: 0.3, mix: 0.35 }], ['Lush', { rate: 0.8, depth: 0.7, mix: 0.55 }]],
  flanger: [['Slow jet', { rate: 0.12, depth: 0.9, feedback: 0.7, mix: 0.5 }], ['Metallic', { rate: 0.4, depth: 0.5, feedback: -0.7, mix: 0.5 }]],
  phaser: [['Classic', { rate: 0.4, depth: 0.8, feedback: 0.4, center: 800, mix: 0.8 }], ['Deep swirl', { rate: 0.15, depth: 1, feedback: 0.75, center: 500, mix: 1 }]],
  drive: [['Warm', { drive: 0.25, type: 0, tone: 7000, mix: 1 }], ['Crunch', { drive: 0.6, type: 1, tone: 9000, mix: 1 }], ['Fuzz', { drive: 0.95, type: 2, tone: 6000, mix: 1 }]],
  bitcrush: [['Lo-fi', { bits: 10, rate: 3, mix: 1 }], ['8-bit', { bits: 6, rate: 6, mix: 1 }], ['Destroyed', { bits: 3, rate: 14, mix: 1 }]],
  filter: [['Telephone', { type: 2, cutoff: 1500, res: 1.5 }], ['Muffled', { type: 0, cutoff: 600, res: 0.8 }], ['Thin', { type: 1, cutoff: 700, res: 0.8 }]],
  eq: [['Bass boost', { low: 6, mid: 0, high: 0, midfreq: 1000, midq: 1 }], ['Bright', { low: 0, mid: 0, high: 6, midfreq: 1000, midq: 1 }], ['Scoop', { low: 4, mid: -6, high: 4, midfreq: 800, midq: 0.8 }]],
  comp: [['Gentle glue', { threshold: -16, ratio: 2.5, attack: 25, release: 200, makeup: 2 }], ['Punchy', { threshold: -22, ratio: 5, attack: 8, release: 120, makeup: 5 }], ['Squash', { threshold: -30, ratio: 12, attack: 3, release: 90, makeup: 9 }]],
  limiter: [['Safe', { ceiling: -1, release: 100 }], ['Loud', { ceiling: -0.3, release: 40 }]],
  tremolo: [['Pulse', { mode: 0, rate: 6, depth: 0.7, shape: 0.6 }], ['Auto-pan', { mode: 1, rate: 1.5, depth: 0.8, shape: 0 }]],
  width: [['Mono-ish', { width: 0.2, gain: 0 }], ['Wide', { width: 1.6, gain: -1 }]],
  sidechain: [['Pump', { threshold: -28, amount: 0.85, attack: 4, release: 220 }], ['Subtle', { threshold: -24, amount: 0.45, attack: 8, release: 140 }]],
};

export function fxDefaults(type) {
  const o = {};
  for (const p of FX[type].params) o[p.id] = p.def;
  return o;
}

// ---------------------------------------------------------------- audio nodes
const WORKLET_NAME = { reverb: 'sky-reverb', delay: 'sky-delay', chorus: 'sky-chorus', flanger: 'sky-flanger', phaser: 'sky-phaser', drive: 'sky-drive', bitcrush: 'sky-bitcrush', tremolo: 'sky-tremolo', width: 'sky-width', sidechain: 'sky-sidechain' };

/** Load the worklet module into a context (once). Resolves false if audio worklets are unavailable. */
export function loadFxModule(ctx) {
  if (ctx.__fxP) return ctx.__fxP;
  ctx.__fxP = (ctx.audioWorklet ? ctx.audioWorklet.addModule(new URL('./fx-processors.js', import.meta.url).href).then(() => { ctx.__skyFx = true; return true; }) : Promise.resolve(false))
    .then(async (ok) => { if (ok) await Promise.all(fxHooks.load.map((f) => f(ctx))); return ok; })
    .catch((e) => { console.warn('fx module failed', e); return false; });
  return ctx.__fxP;
}
/** Plugins (audio/plugins.js) add their own worklet modules to every audio context through this list. */
export const fxHooks = { load: [] };

const ID = (v) => v;
const MS = (v) => v / 1000;
// per-effect conversions from the knob value to the AudioParam value (worklet effects use the same names as the knobs)
const CONV = { delay: { time: MS }, sidechain: { attack: MS, release: MS }, width: { gain: dbToGain } };
const DISCRETE = new Set(['delay.pingpong', 'tremolo.mode', 'drive.type', 'filter.type', 'delay.sync']);
const ALIAS = { 'tremolo.mode': 'pan' };

/**
 * Build an effect. Returns { input, output, keyIn?, apply(params, bpm, now, immediate, skipSet), autoParam(id), dispose() } or null.
 * autoParam(id) -> { p: AudioParam, f: (knobValue) => audioParamValue } so automation can drive the parameter directly.
 */
export function createFx(ctx, type) {
  const def = FX[type];
  if (!def) return null;
  const set = (prm, v, now, imm) => { if (imm) prm.value = v; else prm.setTargetAtTime(v, now, 0.02); };
  const map = {};
  let input, output, nodes = [], extra = {};

  if (def.plugin) {
    if (!ctx.__plugOk || !ctx.__plugOk.has(def.workletName)) return null;
    const node = new AudioWorkletNode(ctx, def.workletName, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
    input = output = node; nodes = [node];
    for (const pd of def.params) { const prm = node.parameters.get(pd.id); if (prm) map[pd.id] = { p: prm, f: ID, discrete: pd.type === 'select' }; }
  } else if (WORKLET_NAME[type]) {
    if (!ctx.__skyFx) return null;
    const node = new AudioWorkletNode(ctx, WORKLET_NAME[type], { numberOfInputs: type === 'sidechain' ? 2 : 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
    input = output = node; nodes = [node];
    for (const pd of def.params) {
      const key = type + '.' + pd.id;
      const prm = node.parameters.get(ALIAS[key] || pd.id);
      if (prm) map[pd.id] = { p: prm, f: (CONV[type] && CONV[type][pd.id]) || ID, discrete: DISCRETE.has(key) };
    }
    if (type === 'sidechain') extra = { keyIn: node, node, keySrc: null };
  } else if (type === 'filter') {
    const f = ctx.createBiquadFilter(); input = output = f; nodes = [f];
    map.cutoff = { p: f.frequency, f: (v) => clamp(v, 20, ctx.sampleRate * 0.45) }; map.res = { p: f.Q, f: ID };
    extra = { f };
  } else if (type === 'eq') {
    const lo = ctx.createBiquadFilter(), mid = ctx.createBiquadFilter(), hi = ctx.createBiquadFilter();
    lo.type = 'lowshelf'; lo.frequency.value = 150; mid.type = 'peaking'; hi.type = 'highshelf'; hi.frequency.value = 5500;
    lo.connect(mid); mid.connect(hi); input = lo; output = hi; nodes = [lo, mid, hi];
    map.low = { p: lo.gain, f: ID }; map.mid = { p: mid.gain, f: ID }; map.midfreq = { p: mid.frequency, f: ID }; map.midq = { p: mid.Q, f: ID }; map.high = { p: hi.gain, f: ID };
  } else if (type === 'comp') {
    const c = ctx.createDynamicsCompressor(), mk = ctx.createGain();
    c.connect(mk); c.knee.value = 8; input = c; output = mk; nodes = [c, mk];
    map.threshold = { p: c.threshold, f: ID, discrete: true }; map.ratio = { p: c.ratio, f: ID, discrete: true };
    map.attack = { p: c.attack, f: MS, discrete: true }; map.release = { p: c.release, f: MS, discrete: true }; map.makeup = { p: mk.gain, f: dbToGain };
  } else if (type === 'limiter') {
    const c = ctx.createDynamicsCompressor();
    c.knee.value = 0; c.ratio.value = 20; c.attack.value = 0.001; input = output = c; nodes = [c];
    map.ceiling = { p: c.threshold, f: ID, discrete: true }; map.release = { p: c.release, f: MS, discrete: true };
  } else return null;

  return {
    type, input, output, ...extra,
    apply(p, bpm, now, imm, skip) {
      for (const pd of def.params) {
        const m = map[pd.id];
        if (!m || (skip && skip.has(pd.id))) continue;
        let v = p[pd.id] ?? pd.def;
        if (type === 'delay' && pd.id === 'time') v = p.sync > 0 ? (p.sync * 60) / bpm : MS(v);
        else v = m.f(v);
        if (type === 'delay' && pd.id === 'time') v = clamp(v, 0.001, 1.9);
        set(m.p, v, now, imm || m.discrete);
      }
      if (type === 'filter') extra.f.type = ['lowpass', 'highpass', 'bandpass', 'notch'][Math.round(p.type)] || 'lowpass';
    },
    autoParam(id) { const m = map[id]; return m && !m.discrete ? { p: m.p, f: m.f } : null; },
    dispose() { for (const n of nodes) { try { n.disconnect(); } catch { /* */ } } },
  };
}
