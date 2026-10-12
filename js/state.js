// Project data model + (de)serialisation. A project is plain JSON, except audio assets which carry a runtime AudioBuffer.
import { uid, deep, bufToB64, b64ToBuf } from './util.js';
import { audioBufferToWav } from './audio/wav.js';
import { DEFAULT_PARAMS, INST_BY_ID } from './audio/instruments.js';
import { KIT_BY_ID } from './audio/drums.js';
import { DEFAULT_PATCH } from './audio/synthpatch.js';
import { bundleFor, stubMissing } from './audio/plugins.js';

export const TRACK_COLORS = ['#ff5f57', '#ff9f43', '#ffd23f', '#5ed16a', '#2ed3b7', '#4aa3ff', '#8f7bff', '#ff6fb5'];
export const SAVE_VERSION = 1;

export function newProject() {
  return {
    v: SAVE_VERSION, name: 'Untitled Song', bpm: 100, ts: [4, 4], key: 0, scale: 'Major', swing: 0,
    loop: { on: false, start: 0, end: 16 }, metronome: false, countIn: true, masterVol: 0.8,
    fx: { reverb: 'hall', delayDiv: 0.75, delayFb: 0.38 }, masterFx: [], auto: [],
    tracks: [], assets: {},
  };
}

export function newTrack(project, type, o = {}) {
  const idx = project.tracks.length;
  const t = {
    id: uid(), type, name: o.name || '', color: o.color || TRACK_COLORS[idx % TRACK_COLORS.length],
    vol: 0.78, pan: 0, mute: false, solo: false, send: { rev: 0.12, del: 0 }, eq: { lo: 0, mid: 0, hi: 0 }, comp: 0,
    params: {}, regions: [], fx: [], arp: { on: false, rate: 0.25, mode: 'up', oct: 1, gate: 0.8 },
  };
  if (type === 'drum') {
    t.kit = o.kit || '808';
    t.padSamples = {};
    t.params = { tone: 0.5, attack: 0.5, release: 1 };
    t.name = t.name || KIT_BY_ID[t.kit].name;
  } else if (type === 'inst') {
    t.inst = o.inst || 'piano';
    const def = INST_BY_ID[t.inst];
    t.params = { ...DEFAULT_PARAMS, ...(def && def.defaults) };
    t.name = t.name || (def ? def.name : 'Instrument');
  } else {
    t.name = t.name || 'Audio';
  }
  if (type === 'inst' && t.inst === 'synth') t.patch = JSON.parse(JSON.stringify(o.patch || DEFAULT_PATCH));
  if (type === 'inst' && o.sampler) { t.inst = 'sampler'; t.sample = o.sampler; t.name = o.name || 'Sampler'; }
  return t;
}

export function newRegion(start, len, extra = {}) {
  return { id: uid(), start, len, loopLen: len, name: '', notes: [], ...extra };
}
export function newNote(s, d, p, v = 100) { return { id: uid(), s, d, p, v }; }

export function sanitize(project) {
  // make sure notes have ids, regions have loopLen etc. (older / hand-edited projects)
  for (const t of project.tracks) {
    for (const r of t.regions) {
      if (t.type !== 'audio') {
        r.loopLen = r.loopLen || r.len;
        r.notes = r.notes || [];
        for (const n of r.notes) n.id = n.id || uid();
      }
    }
  }
  return project;
}

/** Strip runtime-only fields (AudioBuffers) so the project can be JSON-ed / snapshotted. */
export function plain(project) {
  const p = { ...project, assets: {} };
  for (const [id, a] of Object.entries(project.assets || {})) {
    p.assets[id] = { id: a.id, name: a.name, duration: a.duration, bpm: a.bpm || 0 };
  }
  return deep(p);
}

export function serialize(project) {
  const p = plain(project);
  for (const [id, a] of Object.entries(project.assets || {})) {
    if (!a.buffer) continue;
    p.assets[id].sr = a.buffer.sampleRate;
    p.assets[id].wav = bufToB64(audioBufferToWav(a.buffer, 16));
  }
  const bundle = bundleFor(project);              // plugins the song uses travel inside the file so it opens anywhere
  if (bundle.length) p.plugins = bundle;
  return JSON.stringify(p);
}

export async function deserialize(json, ctx) {
  const p = typeof json === 'string' ? JSON.parse(json) : json;
  const base = newProject();
  const proj = { ...base, ...p, loop: { ...base.loop, ...(p.loop || {}) }, fx: { ...base.fx, ...(p.fx || {}) } };
  const assets = {};
  for (const [id, a] of Object.entries(p.assets || {})) {
    let buffer = null;
    if (a.wav) {
      try { buffer = await ctx.decodeAudioData(b64ToBuf(a.wav)); } catch (e) { console.error('asset decode failed', e); }
    }
    assets[id] = { id, name: a.name, duration: a.duration || (buffer ? buffer.duration : 0), bpm: a.bpm || 0, buffer };
  }
  proj.assets = assets;
  for (const t of proj.tracks) {
    t.send = { rev: 0.12, del: 0, ...(t.send || {}) };
    t.eq = { lo: 0, mid: 0, hi: 0, ...(t.eq || {}) };
    t.arp = { on: false, rate: 0.25, mode: 'up', oct: 1, gate: 0.8, ...(t.arp || {}) };
    t.params = t.params || {};
    t.fx = t.fx || [];
    if (t.type === 'inst' && t.inst === 'synth' && !t.patch) t.patch = JSON.parse(JSON.stringify(DEFAULT_PATCH));
  }
  proj.masterFx = proj.masterFx || [];
  proj.auto = proj.auto || [];
  stubMissing(proj);
  return sanitize(proj);
}

export class History {
  constructor(limit = 120) { this.undo = []; this.redo = []; this.limit = limit; }
  reset(project) { this.undo = [JSON.stringify(plain(project))]; this.redo = []; }
  push(project) {
    const s = JSON.stringify(plain(project));
    if (this.undo[this.undo.length - 1] === s) return false;
    this.undo.push(s); this.redo = [];
    if (this.undo.length > this.limit) this.undo.shift();
    return true;
  }
  canUndo() { return this.undo.length > 1; }
  canRedo() { return this.redo.length > 0; }
  stepBack() { if (!this.canUndo()) return null; this.redo.push(this.undo.pop()); return this.undo[this.undo.length - 1]; }
  stepForward() { if (!this.canRedo()) return null; const s = this.redo.pop(); this.undo.push(s); return s; }
}
