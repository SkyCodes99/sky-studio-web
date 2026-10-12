// Sky Studio plugins: small files that add effects, instruments and Sky Synth patch packs.
//
// A plugin is a JSON file (.skyplugin). Three kinds:
//   effect      "dsp" is JavaScript that defines  function create(sampleRate)  returning { process(L, R, outL, outR, n, p) }.
//               It runs inside an AudioWorklet (the audio thread, no access to the page, files or network).
//   instrument  "render" is JavaScript that defines  function render(midi, sr)  returning a Float32Array with one note.
//               It runs in a Web Worker (no access to the page) and the notes are cached, so it costs little while playing.
//   patches     a pack of Sky Synth patches (plain data, no code at all).
// See PLUGINS.md for the full format.
import { FX, fxHooks } from './fx.js';
import { INSTRUMENTS, INST_BY_ID, INST_CATS, bufferInstrument, cachedBuffer, hasBuffer, normalize, pianoKeyRange, silentVoice } from './instruments.js';
import { makePatch, patchVoice } from './synthpatch.js';
import { clamp } from '../util.js';

export const PLUGINS = new Map();                 // id -> plugin
export const MAX_PLUGIN_BYTES = 400 * 1024;
const FX_PREFIX = 'p:', INST_PREFIX = 'x:';
export const fxType = (id) => FX_PREFIX + id;
export const instId = (id, sub) => INST_PREFIX + id + (sub ? ':' + sub : '');
export const pluginIdOfFx = (type) => (type.startsWith(FX_PREFIX) ? type.slice(2) : null);
export const pluginIdOfInst = (id) => (typeof id === 'string' && id.startsWith(INST_PREFIX) ? id.slice(2).split(':')[0] : null);

const listeners = new Set();
export const onPluginsChanged = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => listeners.forEach((f) => { try { f(); } catch { /* */ } });
const reportError = (plugin, message) => { try { window.dispatchEvent(new CustomEvent('skyplugin-error', { detail: { id: plugin.id, name: plugin.name, message } })); } catch { /* */ } };

// ---------------------------------------------------------------- parsing + validation
const pct = (v) => Math.round(v * 100) + '%';
const UNITS = {
  '': (v) => (Math.abs(v) >= 100 ? Math.round(v) + '' : v.toFixed(2)),
  '%': pct,
  ms: (v) => Math.round(v) + ' ms',
  s: (v) => v.toFixed(2) + ' s',
  Hz: (v) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + ' kHz' : Math.round(v) + ' Hz'),
  dB: (v) => (v > 0 ? '+' : '') + v.toFixed(1) + ' dB',
  x: (v) => v.toFixed(2) + '×',
  st: (v) => (v > 0 ? '+' : '') + Math.round(v) + ' st',
  int: (v) => Math.round(v) + '',
};
const ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const PID_RE = /^[A-Za-z][A-Za-z0-9]{0,15}$/;
const str = (v, max, what) => { if (typeof v !== 'string' || !v.trim()) throw new Error(`"${what}" is missing`); return v.trim().slice(0, max); };
const num = (v, what) => { if (typeof v !== 'number' || !isFinite(v)) throw new Error(`"${what}" must be a number`); return v; };

function parseParams(list) {
  if (!Array.isArray(list)) return [];
  if (list.length > 16) throw new Error('A plugin can have at most 16 knobs');
  const seen = new Set();
  return list.map((p, i) => {
    if (!p || typeof p !== 'object') throw new Error(`Knob ${i + 1} is not valid`);
    const id = str(p.id, 16, `params[${i}].id`);
    if (!PID_RE.test(id)) throw new Error(`Knob id "${id}" must be letters and digits only (starting with a letter)`);
    if (seen.has(id)) throw new Error(`Two knobs share the id "${id}"`);
    seen.add(id);
    const label = str(p.label || id, 24, 'label');
    if (p.type === 'select') {
      if (!Array.isArray(p.options) || p.options.length < 2 || p.options.length > 16) throw new Error(`Knob "${id}": options must be a list of 2-16 [label, value] pairs`);
      const options = p.options.map((o) => [String(o[0]).slice(0, 24), num(o[1], `options of ${id}`)]);
      const vals = options.map((o) => o[1]);
      return { id, label, type: 'select', options, min: Math.min(...vals), max: Math.max(...vals), def: num(p.def ?? vals[0], `${id}.def`) };
    }
    const min = num(p.min, `${id}.min`), max = num(p.max, `${id}.max`), def = num(p.def ?? min, `${id}.def`);
    if (!(max > min)) throw new Error(`Knob "${id}": max must be bigger than min`);
    const unit = p.unit && UNITS[p.unit] ? p.unit : '';
    const log = !!p.log && min > 0;
    return { id, label, min, max, def: clamp(def, min, max), log, step: p.step ? num(p.step, `${id}.step`) : undefined, unit, fmt: UNITS[unit] };
  });
}

/** Turn plugin text / an object into a checked plugin record. Throws Error with a friendly message. */
export function parsePlugin(input) {
  let raw = input;
  if (typeof input === 'string') {
    if (input.length > MAX_PLUGIN_BYTES) throw new Error('That plugin file is too big');
    try { raw = JSON.parse(input); } catch { throw new Error('That file is not a valid Sky Studio plugin (it should be JSON)'); }
  }
  if (!raw || typeof raw !== 'object' || raw.skyplugin !== 1) throw new Error('That file is not a Sky Studio plugin (missing "skyplugin": 1)');
  const id = str(raw.id, 64, 'id').toLowerCase();
  if (!ID_RE.test(id)) throw new Error('The plugin id "' + id + '" may only use lowercase letters, digits, dots, dashes and underscores');
  const kind = raw.kind;
  if (!['effect', 'instrument', 'patches'].includes(kind)) throw new Error('"kind" must be effect, instrument or patches');
  const p = {
    id, kind, name: str(raw.name, 40, 'name'), version: String(raw.version || '1.0').slice(0, 16), author: String(raw.author || '').slice(0, 60),
    desc: String(raw.desc || '').slice(0, 200), color: /^#[0-9a-f]{6}$/i.test(raw.color || '') ? raw.color : '#c084fc', source: raw,
  };
  if (kind === 'effect') {
    p.params = parseParams(raw.params);
    p.dsp = str(raw.dsp, MAX_PLUGIN_BYTES, 'dsp');
  } else if (kind === 'instrument') {
    p.render = str(raw.render, MAX_PLUGIN_BYTES, 'render');
    const s = raw.spec || {};
    p.spec = { level: clamp(s.level ?? 0.9, 0.05, 2), lp: clamp(s.lp ?? 9000, 300, 19000), a: clamp(s.a ?? 0.002, 0.0005, 2), r: clamp(s.r ?? 0.3, 0.02, 4), drive: clamp(s.drive ?? 0, 0, 2) };
    const rg = Array.isArray(raw.range) ? raw.range : pianoKeyRange;
    p.range = [clamp(Math.round(rg[0]), 12, 108), clamp(Math.round(rg[1]), 12, 120)];
    if (!(p.range[1] > p.range[0])) p.range = [...pianoKeyRange];
    p.cat = String(raw.category || 'Plugins').slice(0, 20);
  } else {
    if (!Array.isArray(raw.patches) || !raw.patches.length || raw.patches.length > 64) throw new Error('"patches" must be a list of 1-64 patches');
    const seen = new Set();
    p.patches = raw.patches.map((q, i) => {
      const pid = str(q.id || `p${i + 1}`, 32, 'patch id').toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (!pid || seen.has(pid)) throw new Error('Each patch needs its own id');
      seen.add(pid);
      if (!q.patch || typeof q.patch !== 'object') throw new Error(`Patch "${pid}" has no "patch" settings`);
      const patch = makePatch(q.patch);
      for (const k of ['osc1', 'osc2', 'filter', 'fenv', 'aenv', 'lfo', 'unison', 'sub', 'noise']) if (typeof patch[k] !== 'object') throw new Error(`Patch "${pid}": "${k}" must be an object`);
      return { id: pid, name: str(q.name || pid, 40, 'patch name'), cat: ['Lead', 'Bass', 'Pad', 'Keys', 'Pluck', 'FX'].includes(q.cat) ? q.cat : 'Lead', desc: String(q.desc || '').slice(0, 120), patch };
    });
  }
  p.hash = hashString(JSON.stringify(raw));
  return p;
}
function hashString(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

// ---------------------------------------------------------------- effect plugins (AudioWorklet)
function workletSource(plugin, name) {
  const params = JSON.stringify(plugin.params.map((p) => ({ id: p.id, def: p.def, min: p.min, max: p.max })));
  return `'use strict';
(function () {
const PARAMS = ${params}, PN = PARAMS.map((p) => p.id);
const TWO_PI = Math.PI * 2;
const factory = (function () {
${plugin.dsp}
;return typeof create === 'function' ? create : null;
})();
class SkyPlugin extends AudioWorkletProcessor {
  static get parameterDescriptors() { return PARAMS.map((p) => ({ name: p.id, defaultValue: p.def, minValue: p.min, maxValue: p.max, automationRate: 'k-rate' })); }
  constructor() {
    super(); this.pv = {}; this.bad = !factory; this.dsp = null;
    if (factory) { try { this.dsp = factory(sampleRate); if (!this.dsp || typeof this.dsp.process !== 'function') this.bad = true; } catch (e) { this.bad = true; } }
  }
  process(inputs, outputs, parameters) {
    const out = outputs[0], oL = out[0];
    if (this.bad && !this.told) { this.told = true; this.port.postMessage('bad'); }
    if (!oL) return true;
    const oR = out[1] || oL, inp = inputs[0], L = inp[0];
    if (!L) { oL.fill(0); if (oR !== oL) oR.fill(0); return true; }
    const R = inp[1] || L;
    if (this.bad) { oL.set(L); if (oR !== oL) oR.set(R); return true; }
    for (let i = 0; i < PN.length; i++) this.pv[PN[i]] = parameters[PN[i]][0];
    try { this.dsp.process(L, R, oL, oR, L.length, this.pv); } catch (e) { this.bad = true; }
    let s = 0;
    for (let i = 0; i < oL.length; i++) s += oL[i] + oR[i];
    if (this.bad || !(s === s) || s > 1e6 || s < -1e6) { this.bad = true; oL.set(L); if (oR !== oL) oR.set(R); }
    if (this.bad && !this.told) { this.told = true; this.port.postMessage('bad'); }
    return true;
  }
}
registerProcessor(${JSON.stringify(name)}, SkyPlugin);
})();`;
}
const wname = (plugin) => 'skyp-' + plugin.id.replace(/[^a-z0-9]/g, '') + '-' + plugin.hash;

function loadPluginWorklets(ctx) {
  if (!ctx.audioWorklet) return Promise.resolve();
  ctx.__plugOk ||= new Set(); ctx.__plugP ||= new Map();
  const jobs = [];
  for (const p of PLUGINS.values()) {
    if (p.kind !== 'effect') continue;
    const name = wname(p);
    if (ctx.__plugP.has(name)) { jobs.push(ctx.__plugP.get(name)); continue; }
    const url = (p.workletUrl ||= URL.createObjectURL(new Blob([workletSource(p, name)], { type: 'text/javascript' })));
    const job = ctx.audioWorklet.addModule(url).then(() => { ctx.__plugOk.add(name); }).catch((e) => { console.warn('plugin worklet failed', p.id, e); });
    ctx.__plugP.set(name, job); jobs.push(job);
  }
  return Promise.all(jobs);
}
fxHooks.load.push(loadPluginWorklets);

function registerEffect(plugin) {
  FX[fxType(plugin.id)] = { name: plugin.name, color: plugin.color, desc: plugin.desc || 'Plugin effect', params: plugin.params, plugin: true, workletName: wname(plugin), missing: false, author: plugin.author };
}

// ---------------------------------------------------------------- instrument plugins (Web Worker)
function workerSource(plugin) {
  return `'use strict';
(function () {
const TWO_PI = Math.PI * 2;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rng = (seed) => { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
const api = { TWO_PI, mtof, clamp, rng };
const renderFn = (function () {
${plugin.render}
;return typeof render === 'function' ? render : null;
})();
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'render') {
    try {
      if (!renderFn) throw new Error('The plugin does not define function render(midi, sr)');
      const d = renderFn(m.midi, m.sr, api);
      if (!d || typeof d.length !== 'number') throw new Error('render() must return a Float32Array');
      const out = d instanceof Float32Array ? d : Float32Array.from(d);
      self.postMessage({ type: 'done', rid: m.rid, data: out }, [out.buffer]);
    } catch (err) { self.postMessage({ type: 'fail', rid: m.rid, error: String(err && err.message || err) }); }
  }
};
self.postMessage({ type: 'ready', ok: !!renderFn });
})();`;
}

class NoteWorker {
  constructor(plugin) {
    this.plugin = plugin; this.pending = new Map(); this.rid = 0; this.dead = false; this.error = '';
    const url = URL.createObjectURL(new Blob([workerSource(plugin)], { type: 'text/javascript' }));
    this.url = url;
    this.w = new Worker(url);
    this.ready = new Promise((resolve) => { this._ready = resolve; });
    this.w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') { if (!m.ok) this.kill('The plugin does not define function render(midi, sr)'); this._ready(m.ok); return; }
      const q = this.pending.get(m.rid);
      if (!q) return;
      clearTimeout(q.timer); this.pending.delete(m.rid);
      if (m.type === 'done') q.resolve(m.data); else { q.resolve(null); this.fail(m.error); }
    };
    this.w.onerror = (e) => { e.preventDefault && e.preventDefault(); this.kill(e.message || 'script error'); this._ready(false); };
  }
  fail(msg) { if (!this.error) { this.error = msg; reportError(this.plugin, msg); } }
  kill(msg) {
    if (msg) this.fail(msg);
    this.dead = true;
    try { this.w.terminate(); } catch { /* */ }
    for (const q of this.pending.values()) { clearTimeout(q.timer); q.resolve(null); }
    this.pending.clear();
  }
  dispose() { this.kill(''); try { URL.revokeObjectURL(this.url); } catch { /* */ } }
  render(midi, sr) {
    if (this.dead) return Promise.resolve(null);
    return this.ready.then((ok) => {
      if (!ok || this.dead) return null;
      return new Promise((resolve) => {
        const rid = ++this.rid;
        const timer = setTimeout(() => { this.kill('The plugin took too long to render a note (over 10 seconds) and was stopped'); }, 10000);
        this.pending.set(rid, { resolve, timer });
        this.w.postMessage({ type: 'render', rid, midi, sr });
      });
    });
  }
}

const inflight = new Map();                   // key -> promise
function requestNote(plugin, id, midi, sr) {
  const key = id + ':' + midi;
  if (hasBuffer(key, sr)) return Promise.resolve();
  const fk = key + '@' + sr;
  if (inflight.has(fk)) return inflight.get(fk);
  const w = (plugin.worker ||= new NoteWorker(plugin));
  const job = w.render(midi, sr).then((data) => {
    inflight.delete(fk);
    if (!data) return;
    let ok = data.length >= 32 && data.length <= sr * 12;
    for (let i = 0; ok && i < data.length; i += 7) if (!isFinite(data[i])) ok = false;
    if (!ok) { w.fail('The plugin returned an invalid sound for note ' + midi + ' (must be 32 samples to 12 seconds of numbers)'); return; }
    const out = normalize(data, 0.7);
    cachedBuffer(key, sr, () => out);
  });
  inflight.set(fk, job);
  return job;
}

function registerInstrument(plugin) {
  const id = instId(plugin.id);
  const start = bufferInstrument(id, (note, sr) => { requestNote(plugin, id, note, sr); return null; }, plugin.spec);
  start.prepare = async (sr, lo = plugin.range[0], hi = plugin.range[1]) => {
    lo = Math.max(lo, plugin.range[0]); hi = Math.min(hi, plugin.range[1]);
    const jobs = [];
    for (let m = lo; m <= hi; m++) jobs.push(requestNote(plugin, id, m, sr));
    await Promise.all(jobs);
  };
  setInstrument({ id, name: plugin.name, cat: 'Plugins', sub: plugin.name, icon: 'wave', desc: plugin.desc || 'Instrument plugin by ' + (plugin.author || 'unknown'), start, plugin: plugin.id });
}

function registerPatches(plugin) {
  for (const q of plugin.patches) {
    const id = instId(plugin.id, q.id);
    setInstrument({ id, name: q.name, cat: 'Plugins', sub: plugin.name, icon: q.cat === 'Bass' ? 'bass' : q.cat === 'Pad' ? 'pad' : q.cat === 'Keys' ? 'piano' : 'wave', desc: q.desc || plugin.name,
      role: q.cat === 'Bass' ? 'bass' : undefined, sustain: q.cat === 'Pad' || undefined, patch: q.patch, start: patchVoice(q.patch), plugin: plugin.id });
  }
}

function setInstrument(inst) {
  if (!INST_CATS.includes('Plugins')) INST_CATS.push('Plugins');
  const at = INSTRUMENTS.findIndex((x) => x.id === inst.id);
  if (at >= 0) INSTRUMENTS[at] = inst; else INSTRUMENTS.push(inst);
  INST_BY_ID[inst.id] = inst;
}
function dropInstruments(pluginId) {
  for (let i = INSTRUMENTS.length - 1; i >= 0; i--) if (INSTRUMENTS[i].plugin === pluginId) { delete INST_BY_ID[INSTRUMENTS[i].id]; INSTRUMENTS.splice(i, 1); }
}

// ---------------------------------------------------------------- install / remove
/** Test that a plugin really works before it is added (compiles, makes sound) so a broken file never reaches a song. */
async function selfTest(plugin, ctx) {
  if (plugin.kind === 'effect') {
    if (!ctx || !ctx.audioWorklet) throw new Error('Effect plugins need audio worklets, which this browser does not have');
    const name = wname(plugin);
    const url = URL.createObjectURL(new Blob([workletSource(plugin, name + '-t')], { type: 'text/javascript' }));
    const probe = new OfflineAudioContext(2, 4096, 44100);
    try { await probe.audioWorklet.addModule(url); } catch (e) { throw new Error('The effect code has an error: ' + (e && e.message || e)); }
    const node = new AudioWorkletNode(probe, name + '-t', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
    let crashed = false; node.port.onmessage = () => { crashed = true; };
    const src = probe.createOscillator(); src.frequency.value = 220; src.connect(node); node.connect(probe.destination); src.start();
    const buf = await Promise.race([probe.startRendering(), new Promise((_, rej) => setTimeout(() => rej(new Error('The effect code is stuck or far too slow')), 6000))]);
    URL.revokeObjectURL(url);
    await new Promise((r) => setTimeout(r, 60));
    if (crashed) throw new Error('The effect crashed or produced invalid numbers (NaN) while processing sound');
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) if (!isFinite(d[i])) throw new Error('The effect produced invalid numbers (NaN)');
  } else if (plugin.kind === 'instrument') {
    const w = new NoteWorker(plugin);
    try {
      if (!(await w.ready)) throw new Error(w.error || 'The instrument code could not be loaded');
      const data = await w.render(60, 44100);
      if (!data) throw new Error(w.error || 'The instrument did not make a sound');
      let pk = 0; for (let i = 0; i < data.length; i++) { if (!isFinite(data[i])) throw new Error('The instrument produced invalid numbers (NaN)'); pk = Math.max(pk, Math.abs(data[i])); }
      if (pk < 1e-5) throw new Error('The instrument made silence for middle C');
    } finally { w.dispose(); }
  }
}

export async function installPlugin(input, { ctx = null, skipTest = false } = {}) {
  const plugin = parsePlugin(input);
  if (!skipTest) await selfTest(plugin, ctx);
  removePlugin(plugin.id, true);
  PLUGINS.set(plugin.id, plugin);
  if (plugin.kind === 'effect') registerEffect(plugin);
  else if (plugin.kind === 'instrument') registerInstrument(plugin);
  else registerPatches(plugin);
  if (ctx) await loadPluginWorklets(ctx);
  changed();
  return plugin;
}

export function removePlugin(id, quiet) {
  const p = PLUGINS.get(id);
  if (!p) return false;
  PLUGINS.delete(id);
  if (p.worker) { p.worker.dispose(); p.worker = null; }
  if (p.kind === 'effect') delete FX[fxType(id)];
  else dropInstruments(id);
  if (!quiet) changed();
  return true;
}

export const listPlugins = () => [...PLUGINS.values()];
export const listFxPlugins = () => listPlugins().filter((p) => p.kind === 'effect');
export const serializePlugins = () => listPlugins().map((p) => p.source);

/** Install saved plugins at start-up (no self-test: they passed it when installed). */
export async function loadStoredPlugins(list, ctx) {
  const bad = [];
  for (const src of list || []) {
    try { await installPlugin(src, { ctx: null, skipTest: true }); } catch (e) { bad.push(e.message); }
  }
  if (ctx) await loadPluginWorklets(ctx);
  return bad;
}

// ---------------------------------------------------------------- projects
const used = (project) => {
  const ids = new Set();
  for (const t of project.tracks || []) {
    const pi = t.type === 'inst' && pluginIdOfInst(t.inst); if (pi) ids.add(pi);
    for (const e of t.fx || []) { const f = pluginIdOfFx(e.type); if (f) ids.add(f); }
  }
  for (const e of project.masterFx || []) { const f = pluginIdOfFx(e.type); if (f) ids.add(f); }
  return ids;
};
export const pluginsUsedBy = used;
/** The plugin files a song needs, to be saved inside the .skystudio file. */
export function bundleFor(project) {
  return [...used(project)].map((id) => PLUGINS.get(id)).filter(Boolean).map((p) => p.source);
}
/** Placeholders so a song that uses a plugin you don't have still opens (the effect passes sound through, the instrument is silent). */
export function stubMissing(project) {
  for (const id of used(project)) {
    if (PLUGINS.has(id)) continue;
    const type = fxType(id);
    if (!FX[type]) FX[type] = { name: 'Missing plugin', color: '#8a8f98', desc: 'This song uses the plugin "' + id + '" which is not installed.', params: [], plugin: true, missing: true, workletName: '' };
    const iid = instId(id);
    if (!INST_BY_ID[iid]) {
      INST_BY_ID[iid] = { id: iid, name: 'Missing plugin (' + id + ')', cat: 'Plugins', icon: 'wave', desc: 'Install the plugin "' + id + '" to hear this track.', start: (ctx, out, t) => silentVoice(ctx, t), stub: true };
    }
  }
  // patch pack instrument ids look like x:<pack>:<patch>; give them a stub too
  for (const t of project.tracks || []) if (t.type === 'inst' && pluginIdOfInst(t.inst) && !INST_BY_ID[t.inst]) {
    INST_BY_ID[t.inst] = { id: t.inst, name: 'Missing plugin sound', cat: 'Plugins', icon: 'wave', desc: 'Install the plugin to hear this track.', start: (ctx, out, t) => silentVoice(ctx, t), stub: true };
  }
}
export const missingFor = (project) => [...used(project)].filter((id) => !PLUGINS.has(id));
