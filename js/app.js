// The application controller: owns the project, the engine, selection, undo history, recording and file operations.
// UI modules only call methods here and listen for events ('change', 'transport', 'selection', 'toast', ...).
import { Emitter, uid, clamp, deep } from './util.js';
import { Engine } from './audio/engine.js';
import { renderProject } from './audio/render.js';
import { encodeWav, audioBufferToWav } from './audio/wav.js';
import { exportMidi } from './audio/midi.js';
import { MicRecorder } from './audio/recorder.js';
import { beatsPerBar, projectEndBeat } from './audio/events.js';
import { INST_BY_ID, DEFAULT_PARAMS, prewarm, isBassInst } from './audio/instruments.js';
import { DEFAULT_PATCH, SYNTH_PRESET_BY_ID, mergePatch } from './audio/synthpatch.js';
import { KIT_BY_ID, ensureKit, PAD_BASE } from './audio/drums.js';
import { newProject, newTrack, newRegion, History, plain, serialize, deserialize, sanitize } from './state.js';
import { buildLoop, LOOP_BY_ID, applyStarter } from './library/loops.js';
import { DURATION_CHOICES, snapToScale } from './theory.js';
import { fxDefaults } from './audio/fx.js';
import { installPlugin, removePlugin, loadStoredPlugins, serializePlugins, parsePlugin, PLUGINS } from './audio/plugins.js';
import { targetInfo, valueAt, sortPts } from './audio/automation.js';
import { host } from './host.js';

export const SNAPS = DURATION_CHOICES;
/** Can this loop be dropped onto this track? Drums↔drum tracks; bass loops↔bass instruments; other pitched loops↔non-bass instruments. */
export function loopCompatible(track, loop) {
  if (loop.kind === 'drum') return track.type === 'drum';
  if (track.type !== 'inst') return false;
  const isBass = isBassInst(INST_BY_ID[track.inst]);
  return isBass === (loop.cat === 'Bass');
}
const ID_RE = /(\d{2,3})\s*bpm|[_\- ](\d{2,3})[_\- .]/i;

export class App extends Emitter {
  constructor() {
    super();
    this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.project = newProject();
    this.history = new History();
    this.engine = new Engine(this.ctx, () => this.project);
    this.sel = { track: null, regions: new Set(), edit: null };
    this.view = { ppb: 28, snap: '1/16', bottom: 'editor', left: true, right: true, leftTab: 'track', rightTab: 'loops', bottomOpen: true, bottomH: 330, trackH: 78, followPlayhead: true, scaleSnap: false };
    this.settings = { recQuant: '1/16', latencyMs: 0, autoPreview: true, recent: [], sampleFolders: [], sinkId: '', keysOctave: 3, welcome: true, micDevice: '' };
    this.filePath = ''; this.dirty = false;
    this.clipboard = null; this.rec = null; this.mic = new MicRecorder(); this.autoWrite = false;
    this.held = new Map();      // midi -> track for live notes
    this.audioCache = new Map();
    this._autosaveT = null;
    this.engine.on('wrap', () => this.onWrap());
    this.engine.on('kitloaded', () => this.emit('change', 'kits'));
  }

  async init() {
    const s = await host.getSettings();
    Object.assign(this.settings, s || {});
    const bad = await loadStoredPlugins(this.settings.plugins, this.ctx);
    if (bad.length) setTimeout(() => this.toast('Some plugins could not be loaded: ' + bad[0], 'warn'), 1500);
    window.addEventListener('skyplugin-error', (e) => this.toast(`Plugin “${e.detail.name}” had a problem: ${e.detail.message}`, 'error'));
    this.history.reset(this.project);
    this.emit('change', 'load');
    Engine.loadFx(this.ctx).then((ok) => { if (ok) this.engine.applyAll(); });
    this.applyOutputDevice();
    host.on('filesDropped', (d) => this.importPaths(d.paths, d));
  }

  // ------------------------------------------------------------ lookups
  track(id) { return this.project.tracks.find((t) => t.id === id) || null; }
  regionInfo(id) {
    for (const t of this.project.tracks) { const r = t.regions.find((x) => x.id === id); if (r) return { track: t, region: r }; }
    return null;
  }
  get selTrack() { return this.track(this.sel.track); }
  get editInfo() { return this.sel.edit ? this.regionInfo(this.sel.edit) : null; }
  get bpb() { return beatsPerBar(this.project.ts); }
  get spb() { return 60 / this.project.bpm; }
  snapBeats() { const c = SNAPS.find((s) => s.id === this.view.snap); return c ? c.beats : 0.25; }
  snap(beat, force) { const q = this.snapBeats(); return q > 0 || force ? Math.round(beat / (q || 0.25)) * (q || 0.25) : beat; }
  projectLength() { return Math.max(32 * 4, Math.ceil((projectEndBeat(this.project) + 16 * 4) / 16) * 16); }
  toast(msg, kind = 'info') { this.emit('toast', msg, kind); }

  // ------------------------------------------------------------ change plumbing
  /** After any edit to the project data. history=true records an undo step. */
  commit(kind = 'structure', history = true) {
    this.engine.applyAll();
    if (history) this.history.push(this.project);
    this.markDirty();
    this.emit('change', kind);
  }
  /** Live (continuous) edit: update audio + UI but don't create an undo step yet. */
  touch(kind = 'params') {
    this.engine.applyAll();
    this.markDirty();
    this.emit('change', kind);
  }
  markDirty() {
    this.dirty = true;
    clearTimeout(this._autosaveT);
    this._autosaveT = setTimeout(() => this.autosave(), 3500);
    this.updateTitle();
  }
  updateTitle() { host.setTitle(`${this.project.name}${this.dirty ? ' •' : ''} — Sky Studio`); }
  async autosave() {
    if (!this.project.tracks.length) return;
    try { await host.autosave(serialize(this.project)); } catch (e) { console.warn('autosave failed', e); }
  }
  undo() { const s = this.history.stepBack(); if (s) this.restore(s); else this.toast('Nothing to undo'); }
  redo() { const s = this.history.stepForward(); if (s) this.restore(s); else this.toast('Nothing to redo'); }
  restore(snapshot) {
    const assets = this.project.assets;
    this.project = sanitize({ ...JSON.parse(snapshot), assets });
    const ids = new Set(); this.project.tracks.forEach((t) => t.regions.forEach((r) => ids.add(r.id)));
    for (const id of [...this.sel.regions]) if (!ids.has(id)) this.sel.regions.delete(id);
    if (this.sel.edit && !ids.has(this.sel.edit)) this.sel.edit = null;
    if (this.sel.track && !this.track(this.sel.track)) this.sel.track = null;
    this.engine.applyAll(); this.engine.tempoChanged();
    this.markDirty(); this.emit('change', 'structure'); this.emit('selection');
  }

  // ------------------------------------------------------------ selection
  selectTrack(id) { if (this.sel.track !== id) { this.sel.track = id; this.emit('selection'); } }
  selectRegions(ids, edit) {
    this.sel.regions = new Set(ids);
    if (edit !== undefined) this.sel.edit = edit;
    else if (ids.length && !ids.includes(this.sel.edit)) this.sel.edit = ids[ids.length - 1];
    if (this.sel.edit) { const i = this.regionInfo(this.sel.edit); if (i) this.sel.track = i.track.id; }
    this.emit('selection');
  }
  clearSelection() { this.sel.regions = new Set(); this.emit('selection'); }

  // ------------------------------------------------------------ transport
  async prepare() {
    await this.ctx.resume();
    await this.engine.loadAssets(this.project);
  }
  get playing() { return this.engine.playing; }
  async togglePlay() {
    if (this.engine.playing) { this.stopRecording(); this.engine.stop(); this.engine.liveAllOff(); this.emit('transport'); return; }
    await this.prepare();
    this.engine.play(this.engine.pos);
    this.emit('transport');
  }
  async play() { if (!this.engine.playing) await this.togglePlay(); }
  pause() { if (this.engine.playing) this.togglePlay(); }
  stop() { this.pause(); }
  rewind() {
    const was = this.engine.playing;
    this.engine.seek(0);
    if (!was) this.emit('transport');
  }
  seek(beat) { this.engine.seek(Math.max(0, beat)); this.emit('transport'); }
  get pos() { return this.engine.beat(); }
  toggleLoop() { this.project.loop.on = !this.project.loop.on; this.commit('meta', false); this.history.push(this.project); this.emit('transport'); }
  setLoop(start, end) {
    start = Math.max(0, start); end = Math.max(start + this.snapBeats() || 0.25, end);
    this.project.loop.start = start; this.project.loop.end = end;
    this.commit('meta');
  }
  toggleMetronome() { this.project.metronome = !this.project.metronome; this.commit('meta'); this.emit('transport'); }
  toggleCountIn() { this.project.countIn = !this.project.countIn; this.commit('meta'); this.emit('transport'); }
  onWrap() { if (this.rec) this.recWrap(); this.emit('wrap'); }

  // ------------------------------------------------------------ project settings
  setBpm(v) {
    v = clamp(Math.round(v * 10) / 10, 30, 300);
    if (v === this.project.bpm) return;
    this.project.bpm = v;
    // tempo-synced audio clips follow the project tempo
    for (const t of this.project.tracks) if (t.type === 'audio') for (const r of t.regions) if (r.sync) this.syncRegion(r);
    this.commit('meta'); this.engine.tempoChanged();
  }
  setKey(k) { this.project.key = ((k % 12) + 12) % 12; this.commit('meta'); }
  setScale(s) { this.project.scale = s; this.commit('meta'); }
  setTimeSig(n, d) { this.project.ts = [n, d]; this.commit('meta'); }
  setSwing(v) { this.project.swing = clamp(v, 0, 1); this.commit('meta'); }
  setName(n) { this.project.name = n || 'Untitled Song'; this.commit('meta'); }
  setMasterVol(v, final) { this.project.masterVol = clamp(v, 0, 1); this.maybeWriteAuto('master', 'masterVol', this.project.masterVol, final); final ? this.commit('params') : this.touch('params'); }
  setFx(key, val) { this.project.fx[key] = val; this.commit('params'); }

  // ------------------------------------------------------------ slicing
  /** Make a drum track whose pads are slices of an audio asset; optionally add a region that replays the loop as it was. */
  chopToPads(assetId, ranges, { name, replay = true } = {}) {
    const a = this.project.assets[assetId];
    if (!a || !ranges.length) return null;
    const t = newTrack(this.project, 'drum', { kit: '808', name: name || (a.name + ' slices') });
    t.padSamples = {};
    ranges.slice(0, 16).forEach((r, i) => { t.padSamples[i] = { asset: assetId, start: r.start, end: r.end }; });
    this.project.tracks.push(t);
    this.engine.strip(t);
    if (replay) {
      const spb = this.spb, len = Math.max(this.bpb, Math.ceil(a.duration / spb / this.bpb - 1e-6) * this.bpb);
      const r = newRegion(0, len, { loopLen: len, name: 'Slices' });
      ranges.slice(0, 16).forEach((rg, i) => r.notes.push({ id: uid(), s: rg.start / spb, d: Math.min(0.5, (rg.end - rg.start) / spb), p: 36 + i, v: 108 }));
      t.regions.push(r);
      this.sel.regions = new Set([r.id]); this.sel.edit = r.id;
    }
    this.sel.track = t.id;
    this.commit('structure'); this.emit('selection');
    return t;
  }

  // ------------------------------------------------------------ Sky Synth patches
  /** Turn a track into an editable Sky Synth, starting from a patch (or its current preset / defaults). */
  makeSynthTrack(trackId, patch) {
    const t = this.track(trackId);
    if (!t || t.type !== 'inst') return null;
    const cur = INST_BY_ID[t.inst];
    const start = patch || (cur && cur.patch) || t.patch || DEFAULT_PATCH;
    t.inst = 'synth'; t.patch = JSON.parse(JSON.stringify(start)); delete t.sample;
    t.params = { tone: 0.5, attack: 0.5, release: 0.5 };
    this.commit('structure');
    return t;
  }
  loadPatch(trackId, patch, name) {
    const t = this.makeSynthTrack(trackId, patch);
    if (t && name && /^(Synth|Sky Synth|Instrument)/.test(t.name)) { t.name = name; }
    return t;
  }
  setPatchParam(trackId, path, value, final) {
    const t = this.track(trackId);
    if (!t || !t.patch) return;
    const keys = path.split('.');
    let o = t.patch;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] = o[keys[i]] || {};
    o[keys[keys.length - 1]] = value;
    final ? this.commit('params') : this.touch('params');
  }
  saveUserPatch(trackId, name) {
    const t = this.track(trackId);
    if (!t || !t.patch) return false;
    const list = (this.settings.patches = this.settings.patches || []).filter((p) => p.name !== name);
    list.push({ name, patch: JSON.parse(JSON.stringify(t.patch)) });
    this.settings.patches = list.slice(-60);
    this.saveSettings(); this.emit('patches');
    return true;
  }
  deleteUserPatch(name) { this.settings.patches = (this.settings.patches || []).filter((p) => p.name !== name); this.saveSettings(); this.emit('patches'); }

  // ------------------------------------------------------------ effects rack
  fxList(target, create = true) {
    if (target === 'master') { if (create && !this.project.masterFx) this.project.masterFx = []; return this.project.masterFx || null; }
    const t = this.track(target);
    if (!t) return null;
    if (create && !t.fx) t.fx = [];
    return t.fx || null;
  }
  fxChanged() { this.commit('params'); this.emit('fxchanged'); }
  addFx(target, type) {
    const l = this.fxList(target); if (!l) return;
    if (l.length >= 10) { this.toast('That is plenty of effects on one channel', 'warn'); return; }
    const e = { id: uid(), type, on: true, p: fxDefaults(type) };
    if (type === 'sidechain') { const kick = this.project.tracks.find((t) => t.type === 'drum' && t.id !== target); if (kick) e.p.source = kick.id; }
    l.push(e);
    if (!this.ctx.__skyFx) this.toast('The effects engine is still starting — try again in a second', 'warn');
    this.fxChanged();
  }
  removeFx(target, id) { const l = this.fxList(target); if (!l) return; const i = l.findIndex((e) => e.id === id); if (i >= 0) { l.splice(i, 1); this.project.auto = (this.project.auto || []).filter((a) => !a.param.startsWith('fx:' + id + ':')); this.fxChanged(); } }
  clearFx(target) { const l = this.fxList(target); if (l && l.length) { l.length = 0; this.fxChanged(); } }
  moveFx(target, id, dir) { const l = this.fxList(target); if (!l) return; const i = l.findIndex((e) => e.id === id), j = i + dir; if (i < 0 || j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; this.fxChanged(); }
  toggleFx(target, id) { const l = this.fxList(target); const e = l && l.find((x) => x.id === id); if (e) { e.on = e.on === false; this.fxChanged(); } }
  setFxParam(target, id, key, value, final) {
    const l = this.fxList(target); const e = l && l.find((x) => x.id === id); if (!e) return;
    e.p[key] = value;
    this.maybeWriteAuto(target, `fx:${id}:${key}`, value, final);
    if (key === 'sync') { final ? this.fxChanged() : this.touch('params'); return; }
    final ? this.commit('params') : this.touch('params');
    if (final && (key === 'sync' || key === 'source')) this.emit('fxchanged');
  }
  applyFxPreset(target, id, values) { const l = this.fxList(target); const e = l && l.find((x) => x.id === id); if (!e) return; Object.assign(e.p, values); this.fxChanged(); }

  // ------------------------------------------------------------ automation
  autoLanes() { return this.project.auto || (this.project.auto = []); }
  findLane(trackId, param) { return (this.project.auto || []).find((l) => l.track === trackId && l.param === param) || null; }
  /** Current static value of an automatable parameter (what a new lane starts at). */
  staticValue(trackId, param) {
    const P = this.project;
    if (trackId === 'master') {
      if (param === 'masterVol') return P.masterVol;
      const m = /^fx:([^:]+):(.+)$/.exec(param); const e = m && (P.masterFx || []).find((x) => x.id === m[1]); return e ? e.p[m[2]] : 0;
    }
    const t = this.track(trackId); if (!t) return 0;
    const m = /^fx:([^:]+):(.+)$/.exec(param);
    if (m) { const e = (t.fx || []).find((x) => x.id === m[1]); return e ? e.p[m[2]] : 0; }
    return param.split('.').reduce((a, k) => (a == null ? a : a[k]), t) ?? 0;
  }
  addLane(trackId, param) {
    let l = this.findLane(trackId, param);
    if (l) return l;
    const v = this.staticValue(trackId, param), end = Math.max(this.projectLength(), 16);
    l = { id: uid(), track: trackId, param, on: true, mode: 'linear', pts: [{ b: 0, v }, { b: end, v }] };
    this.autoLanes().push(l);
    this.autoChanged();
    return l;
  }
  removeLane(id) { const a = this.autoLanes(), i = a.findIndex((l) => l.id === id); if (i >= 0) { a.splice(i, 1); this.autoChanged(); } }
  autoChanged() { this.commit('params'); this.emit('autochanged'); }
  /** Live-edit helper for the automation editor (it mutates lane.pts directly, then calls this). */
  autoTouch() { this.touch('params'); }
  /** While recording automation ("Write"), knob moves become points on the playhead. */
  maybeWriteAuto(trackId, param, value, final) {
    if (final) { this._wr = null; return; }
    if (!this.autoWrite || !this.engine.playing || !targetInfo(this.project, { track: trackId, param })) return;
    const lane = this.findLane(trackId, param) || (() => { const l = { id: uid(), track: trackId, param, on: true, mode: 'linear', pts: [] }; this.autoLanes().push(l); this.emit('autochanged'); return l; })();
    const b = this.engine.beatsHeard();
    const wr = this._wr && this._wr.lane === lane ? this._wr : (this._wr = { lane, last: b });
    lane.pts = lane.pts.filter((p) => !(p.b > wr.last + 1e-6 && p.b <= b + 1e-6));     // overwrite the old points we pass over (not our own)
    lane.pts.push({ b: Math.max(0, b), v: value });
    sortPts(lane); wr.last = b;
  }

  // ------------------------------------------------------------ tracks
  addTrack(type, opts = {}) {
    const t = newTrack(this.project, type, opts);
    if (opts.afterId) {
      const i = this.project.tracks.findIndex((x) => x.id === opts.afterId);
      this.project.tracks.splice(i + 1, 0, t);
    } else this.project.tracks.push(t);
    this.engine.strip(t);
    if (type === 'drum') ensureKit(t.kit, this.ctx.sampleRate).then(() => this.emit('change', 'kits'));
    else if (type === 'inst' && t.inst !== 'sampler') prewarm(t.inst, this.ctx.sampleRate);
    this.sel.track = t.id;
    this.commit('structure');
    this.emit('selection');
    return t;
  }
  deleteTrack(id) {
    const i = this.project.tracks.findIndex((t) => t.id === id);
    if (i < 0) return;
    const t = this.project.tracks[i];
    this.project.tracks.splice(i, 1);
    this.project.auto = (this.project.auto || []).filter((l) => l.track !== id);
    this.engine.dropStrip(id);
    for (const r of t.regions) { this.sel.regions.delete(r.id); if (this.sel.edit === r.id) this.sel.edit = null; }
    if (this.sel.track === id) this.sel.track = (this.project.tracks[i] || this.project.tracks[i - 1] || {}).id || null;
    this.commit('structure'); this.emit('selection');
  }
  duplicateTrack(id) {
    const t = this.track(id);
    if (!t) return;
    const c = deep(t);
    c.id = uid(); c.name = t.name + ' copy';
    c.regions.forEach((r) => { r.id = uid(); (r.notes || []).forEach((n) => (n.id = uid())); });
    this.project.tracks.splice(this.project.tracks.indexOf(t) + 1, 0, c);
    this.sel.track = c.id;
    this.commit('structure'); this.emit('selection');
  }
  moveTrack(id, dir) {
    const a = this.project.tracks, i = a.findIndex((t) => t.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    this.commit('structure');
  }
  /** Set a (possibly nested: 'send.rev') property on a track. final=true records an undo step. */
  setTrackProp(id, path, value, final = true) {
    const t = this.track(id);
    if (!t) return;
    const keys = path.split('.');
    let o = t;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] = o[keys[i]] || {};
    o[keys[keys.length - 1]] = value;
    this.maybeWriteAuto(id, path, value, final);
    final ? this.commit('params') : this.touch('params');
  }
  setInstrument(id, instId) {
    const t = this.track(id);
    if (!t || t.type !== 'inst') return;
    const wasDefault = !t.name || INST_BY_ID[t.inst] && t.name === INST_BY_ID[t.inst].name;
    t.inst = instId; delete t.sample;
    if (instId === 'synth' && !t.patch) t.patch = JSON.parse(JSON.stringify(DEFAULT_PATCH)); else if (instId !== 'synth') delete t.patch;
    const def = INST_BY_ID[instId];
    t.params = { ...DEFAULT_PARAMS, ...(def && def.defaults) };
    if (wasDefault && def) t.name = def.name;
    prewarm(instId, this.ctx.sampleRate);
    this.commit('structure');
  }
  setKit(id, kitId) {
    const t = this.track(id);
    if (!t || t.type !== 'drum') return;
    const wasDefault = !t.name || (KIT_BY_ID[t.kit] && t.name === KIT_BY_ID[t.kit].name);
    t.kit = kitId;
    if (wasDefault) t.name = KIT_BY_ID[kitId].name;
    ensureKit(kitId, this.ctx.sampleRate).then(() => this.emit('change', 'kits'));
    this.commit('structure');
  }
  toggleMute(id) { const t = this.track(id); if (t) this.setTrackProp(id, 'mute', !t.mute); }
  toggleSolo(id) { const t = this.track(id); if (t) this.setTrackProp(id, 'solo', !t.solo); }
  toggleArm(id) {
    const t = this.track(id);
    if (!t) return;
    for (const o of this.project.tracks) if (o.type === 'audio') o.arm = o.id === id ? !o.arm : false;
    this.touch('params');
  }

  // ------------------------------------------------------------ regions
  addRegion(trackId, start, len, extra = {}) {
    const t = this.track(trackId);
    if (!t) return null;
    const r = newRegion(start, len, extra);
    t.regions.push(r);
    this.commit('structure');
    return r;
  }
  /** Create an empty note region of N bars on a track (double-click in an empty lane). */
  newEmptyRegion(trackId, startBeat, bars = 2) {
    const t = this.track(trackId);
    if (!t || t.type === 'audio') return null;
    const bpb = this.bpb;
    const start = Math.floor(startBeat / bpb) * bpb;
    const r = this.addRegion(trackId, start, bars * bpb, { name: '' });
    this.selectRegions([r.id], r.id);
    return r;
  }
  deleteRegions(ids = [...this.sel.regions]) {
    if (!ids.length) return;
    const set = new Set(ids);
    for (const t of this.project.tracks) t.regions = t.regions.filter((r) => !set.has(r.id));
    for (const id of ids) this.sel.regions.delete(id);
    if (set.has(this.sel.edit)) this.sel.edit = null;
    this.commit('structure'); this.emit('selection');
  }
  duplicateRegions(ids = [...this.sel.regions]) {
    const out = [];
    for (const id of ids) {
      const info = this.regionInfo(id);
      if (!info) continue;
      const c = deep(info.region);
      c.id = uid(); c.start = info.region.start + info.region.len;
      (c.notes || []).forEach((n) => (n.id = uid()));
      info.track.regions.push(c); out.push(c.id);
    }
    if (out.length) { this.sel.regions = new Set(out); this.sel.edit = out[out.length - 1]; this.commit('structure'); this.emit('selection'); }
  }
  copyRegions() {
    const infos = [...this.sel.regions].map((id) => this.regionInfo(id)).filter(Boolean);
    if (!infos.length) return;
    const t0 = Math.min(...infos.map((i) => i.region.start));
    this.clipboard = { items: infos.map((i) => ({ track: i.track.id, region: deep(i.region), off: i.region.start - t0 })) };
    this.toast(`Copied ${infos.length} region${infos.length > 1 ? 's' : ''}`);
  }
  cutRegions() { this.copyRegions(); this.deleteRegions(); }
  pasteRegions(at = this.pos) {
    if (!this.clipboard) return;
    const out = [];
    const tgt = this.selTrack;
    for (const it of this.clipboard.items) {
      let t = this.track(it.track);
      if (tgt && tgt.type === (t ? t.type : it.region.asset ? 'audio' : tgt.type) && this.clipboard.items.length === 1) t = tgt;
      if (!t) continue;
      const c = deep(it.region);
      c.id = uid(); c.start = this.snap(at) + it.off;
      (c.notes || []).forEach((n) => (n.id = uid()));
      t.regions.push(c); out.push(c.id);
    }
    if (out.length) { this.sel.regions = new Set(out); this.sel.edit = out[out.length - 1]; this.commit('structure'); this.emit('selection'); }
  }
  /** Split regions at a beat. Defaults to the selection, or whatever is under the playhead on the selected track. */
  splitAt(beat = this.pos) {
    let targets = [...this.sel.regions].map((id) => this.regionInfo(id)).filter(Boolean);
    if (!targets.length) {
      const t = this.selTrack;
      if (t) targets = t.regions.map((r) => ({ track: t, region: r }));
    }
    let n = 0; const fresh = [];
    for (const { track, region: r } of targets) {
      if (!(beat > r.start + 0.01 && beat < r.start + r.len - 0.01)) continue;
      const d = beat - r.start, right = deep(r);
      right.id = uid(); right.start = beat; right.len = r.len - d;
      if (track.type === 'audio') right.offset = (r.offset || 0) + d * this.spb * (r.rate || 1);
      else {
        const L = r.loopLen || r.len, sh = d % L;
        right.notes = r.notes.map((nn) => ({ ...nn, id: uid(), s: ((nn.s - sh) % L + L) % L }));
      }
      r.len = d;
      if (track.type === 'audio') r.fadeOut = 0;
      track.regions.push(right); fresh.push(right.id); n++;
    }
    if (n) { this.sel.regions = new Set(fresh); this.commit('structure'); this.emit('selection'); } else this.toast('Put the playhead inside a region to split it');
  }
  /** Merge note regions (same track) selected into one. */
  joinRegions() {
    const infos = [...this.sel.regions].map((id) => this.regionInfo(id)).filter(Boolean);
    if (infos.length < 2 || infos.some((i) => i.track !== infos[0].track) || infos[0].track.type === 'audio') { this.toast('Select two or more note regions on the same track to join'); return; }
    const t = infos[0].track;
    infos.sort((a, b) => a.region.start - b.region.start);
    const s = infos[0].region.start, e = Math.max(...infos.map((i) => i.region.start + i.region.len));
    const merged = newRegion(s, e - s, { loopLen: e - s, name: infos[0].region.name });
    for (const { region: r } of infos) {
      const L = r.loopLen || r.len;
      for (let k = 0; k * L < r.len; k++) for (const n of r.notes) {
        const abs = r.start - s + k * L + n.s;
        if (n.s < L && abs < r.start - s + r.len) merged.notes.push({ id: uid(), s: abs, d: Math.min(n.d, L - n.s), p: n.p, v: n.v });
      }
    }
    t.regions = t.regions.filter((r) => !infos.some((i) => i.region === r));
    t.regions.push(merged);
    this.sel.regions = new Set([merged.id]); this.sel.edit = merged.id;
    this.commit('structure'); this.emit('selection');
  }
  /** Turn a region's repeats into real notes (makes the looped content editable end-to-end). */
  bakeRegion(id) {
    const info = this.regionInfo(id);
    if (!info || info.track.type === 'audio') return;
    const r = info.region, L = r.loopLen || r.len, out = [];
    for (let k = 0; k * L < r.len; k++) for (const n of r.notes) {
      const s = k * L + n.s;
      if (n.s < L && s < r.len) out.push({ id: uid(), s, d: Math.min(n.d, L - n.s, r.len - s), p: n.p, v: n.v });
    }
    r.notes = out; r.loopLen = r.len;
    this.commit('structure');
  }
  renameRegion(id, name) { const i = this.regionInfo(id); if (i) { i.region.name = name; this.commit('structure'); } }
  /** Set region length keeping content (used by the editor's length control). */
  setRegionLen(id, len) {
    const i = this.regionInfo(id);
    if (!i) return;
    i.region.len = Math.max(0.25, len);
    this.commit('structure');
  }

  // ------------------------------------------------------------ loops & starters
  /** Add a library loop. Uses the selected track when it is compatible, otherwise creates a track. */
  addLoop(loop, opts = {}) {
    if (typeof loop === 'string') loop = LOOP_BY_ID[loop];
    if (!loop) return null;
    const b = buildLoop(loop, this.project);
    const type = loop.kind === 'drum' ? 'drum' : 'inst';
    let t = opts.trackId ? this.track(opts.trackId) : null;
    if (!t) { const st = this.selTrack; if (st && !opts.newTrack && loopCompatible(st, loop) && (!loop.kit || st.kit === loop.kit)) t = st; }   // kit-specific loops get their own drum track
    const empty = !this.project.tracks.length;
    if (!t || !loopCompatible(t, loop)) {
      t = type === 'drum' ? newTrack(this.project, 'drum', { kit: loop.kit || '808', name: loop.genre + ' Drums' }) : newTrack(this.project, 'inst', { inst: loop.inst, name: loop.cat });
      this.project.tracks.push(t); this.engine.strip(t);
      if (type === 'drum') ensureKit(t.kit, this.ctx.sampleRate).then(() => this.emit('change', 'kits'));
      else prewarm(t.inst, this.ctx.sampleRate);
    }
    if (empty && opts.matchTempo !== false && loop.bpm) this.project.bpm = loop.bpm;
    let start = opts.start != null ? opts.start : this.snapToBar(this.pos);
    const r = newRegion(start, b.len, { loopLen: b.len, name: loop.name });
    r.notes = b.notes.map((n) => ({ id: uid(), ...n }));
    t.regions.push(r);
    this.sel.track = t.id; this.sel.regions = new Set([r.id]); this.sel.edit = r.id;
    this.commit('structure'); this.emit('selection');
    return r;
  }
  snapToBar(beat) { return Math.round(beat / this.bpb) * this.bpb; }
  loadStarter(st) {
    const P = newProject();
    applyStarter(P, st);
    this.engine.stop(); this.engine.liveAllOff();
    for (const id of [...this.engine.strips.keys()]) this.engine.dropStrip(id);
    this.project = P; this.filePath = ''; this.dirty = false;
    const lead = P.tracks.find((x) => x.type === 'inst' && x.regions.length) || P.tracks[0];
    const first = lead && lead.regions[0];
    this.sel = { track: lead ? lead.id : null, regions: new Set(first ? [first.id] : []), edit: first ? first.id : null };
    this.history.reset(P);
    this.engine.pos = 0;
    this.engine.applyAll();
    this.engine.loadAssets(P).then(() => this.emit('change', 'kits'));
    this.emit('change', 'load'); this.emit('selection'); this.emit('transport'); this.updateTitle();
  }

  // ------------------------------------------------------------ live playing + recording
  recTrack() {
    const t = this.selTrack;
    return t && t.type !== 'audio' ? t : null;
  }
  noteOn(midi, vel = 100) {
    const t = this.recTrack();
    if (!t) { this.emit('keydown', midi, null); return; }
    if (t.type === 'inst' && this.view.scaleSnap) midi = snapToScale(midi, this.project.key, this.project.scale);
    this.held.set(midi, t);
    this.engine.liveOn(t, midi, vel);
    this.emit('keydown', midi, t);
    if (this.rec && this.rec.track === t.id && this.engine.playing && !this.engine.inCountIn()) {
      this.rec.open.set(midi, { beat: this.engine.beatsHeard(), vel });
    }
  }
  noteOff(midi) {
    const t = this.held.get(midi);
    this.emit('keyup', midi);
    if (!t) return;
    this.held.delete(midi);
    this.engine.liveOff(t, midi);
    const o = this.rec && this.rec.open.get(midi);
    if (o) { this.rec.open.delete(midi); this.recFinishNote(midi, o, this.engine.beatsHeard()); }
  }
  quantBeats() { const c = SNAPS.find((s) => s.id === this.settings.recQuant); return c ? c.beats : 0; }
  recFinishNote(midi, o, endBeat) {
    const r = this.rec.region, loopMode = this.rec.loopMode;
    const base = loopMode ? this.project.loop.start : r.start;
    let s = o.beat - base, d = Math.max(0.06, endBeat - o.beat);
    const q = this.quantBeats();
    if (q > 0) { s = Math.round(s / q) * q; d = Math.max(q * 0.9, Math.round(d / q) * q); }
    if (s < 0) s = 0;
    const L = r.loopLen || r.len;
    if (s >= L) s -= L;
    r.notes.push({ id: uid(), s, d: Math.min(d, L - s), p: midi, v: o.vel });
  }
  recWrap() {
    const rec = this.rec;
    if (!rec || !rec.loopMode) return;
    const L = this.project.loop;
    for (const [midi, o] of rec.open) { this.recFinishNote(midi, o, L.end); rec.open.set(midi, { beat: L.start, vel: o.vel }); }
  }

  async toggleRecord() {
    if (this.rec) { this.stopRecording(); return; }
    const t = this.selTrack;
    const audioTrack = this.project.tracks.find((x) => x.type === 'audio' && x.arm);
    if (!audioTrack && (!t || t.type === 'audio')) { this.toast('Select an instrument or drum track (or arm an audio track) to record', 'warn'); return; }
    await this.prepare();
    const L = this.project.loop, loopMode = L.on && L.end > L.start;
    let from = this.engine.playing ? this.engine.beatsHeard() : this.engine.pos;
    if (loopMode && !this.engine.playing && (from < L.start || from >= L.end)) from = L.start;
    const target = audioTrack || t;
    const bpb = this.bpb;
    const rec = { track: target.id, type: target.type, open: new Map(), loopMode, startBeat: from, t0: this.ctx.currentTime };
    if (target.type !== 'audio') {
      const start = loopMode ? L.start : Math.floor(from / bpb) * bpb;
      const len = loopMode ? L.end - L.start : bpb;
      rec.region = newRegion(start, len, { name: 'Recording', loopLen: len });
      target.regions.push(rec.region);
    } else {
      try { await this.mic.start(this.ctx, this.settings.micDevice || undefined); }
      catch (e) { this.toast('Could not open the microphone: ' + (e.message || e), 'error'); return; }
      rec.region = null;
    }
    this.rec = rec;
    if (!this.engine.playing) {
      const count = this.project.countIn ? bpb : 0;
      if (loopMode) this.engine.pos = from;
      this.engine.play(from, { countBeats: count });
      rec.countSec = count * this.spb;
    } else rec.countSec = 0;
    rec.playStart = this.ctx.currentTime;
    this.emit('transport'); this.emit('change', 'structure');
  }

  /** called every animation frame by the UI */
  tick() {
    const rec = this.rec;
    if (rec && rec.region && !rec.loopMode && this.engine.playing) {
      const need = Math.ceil((this.engine.beatsHeard() + 0.05) / this.bpb) * this.bpb - rec.region.start;
      if (need > rec.region.len) { rec.region.len = need; rec.region.loopLen = need; this.emit('change', 'recording'); }
    }
  }

  async stopRecording() {
    const rec = this.rec;
    if (!rec) return;
    this.rec = null;
    const end = this.engine.playing ? this.engine.beatsHeard() : this.engine.pos;
    for (const [midi, o] of rec.open) { this.rec = rec; this.recFinishNote(midi, o, end); this.rec = null; }
    const t = this.track(rec.track);
    if (rec.type !== 'audio') {
      const r = rec.region;
      if (!r.notes.length) { if (t) t.regions = t.regions.filter((x) => x !== r); }
      else {
        r.name = 'Take';
        if (!rec.loopMode) {
          const lastEnd = Math.max(...r.notes.map((n) => n.s + n.d));
          const len = Math.max(this.bpb, Math.ceil((lastEnd - 1e-6) / this.bpb) * this.bpb);
          r.len = Math.max(len, Math.ceil((end - r.start) / this.bpb) * this.bpb, this.bpb);
          r.len = len; r.loopLen = len;
        }
        this.sel.regions = new Set([r.id]); this.sel.edit = r.id;
      }
    } else {
      const res = this.mic.stop();
      if (res && res.data.length > this.ctx.sampleRate * 0.1) {
        const skip = Math.max(0, Math.round((rec.playStart + 0.1 + rec.countSec - res.t0 - this.settings.latencyMs / 1000) * res.sampleRate));
        const data = res.data.subarray(Math.min(skip, res.data.length - 1));
        const buf = this.ctx.createBuffer(1, data.length, res.sampleRate);
        buf.copyToChannel(data, 0);
        const asset = this.makeAsset('Recording ' + new Date().toLocaleTimeString().replace(/:/g, '.'), buf);
        const len = (buf.duration / this.spb);
        const r = newRegion(rec.startBeat, len, { asset: asset.id, offset: 0, gain: 1, name: asset.name });
        t.regions.push(r);
        this.sel.regions = new Set([r.id]); this.sel.edit = r.id;
      } else this.toast('Nothing was recorded');
    }
    this.commit('structure'); this.emit('selection'); this.emit('transport');
  }

  // ------------------------------------------------------------ audio assets
  makeAsset(name, buffer) {
    const id = uid();
    const m = ID_RE.exec(name);
    const bpm = m ? +(m[1] || m[2]) : 0;
    const a = { id, name, buffer, duration: buffer.duration, bpm: bpm >= 50 && bpm <= 240 ? bpm : 0, peaks: computePeaks(buffer) };
    this.project.assets[id] = a;
    return a;
  }
  async importAudio(items, at) {
    // items: File objects (browser) or {name, path} (native)
    let target = this.selTrack && this.selTrack.type === 'audio' ? this.selTrack : null;
    let start = at != null ? at : this.pos;
    let last = null;
    for (const it of items) {
      try {
        const name = (it.name || String(it.path || it)).split(/[\\/]/).pop();
        const buf = await this.decodeFile(it);
        const asset = this.makeAsset(name.replace(/\.[^.]+$/, ''), buf);
        if (!target) { target = newTrack(this.project, 'audio', { name: asset.name }); this.project.tracks.push(target); this.engine.strip(target); }
        const len = buf.duration / this.spb;
        const r = newRegion(Math.max(0, this.snapToBar(start)), len, { asset: asset.id, offset: 0, gain: 1, name: asset.name });
        target.regions.push(r);
        start = r.start + len;
        last = r;
      } catch (e) { console.error(e); this.toast('Could not read ' + (it.name || it.path || it) + ' (unsupported or damaged)', 'error'); }
    }
    if (last) {
      this.sel.track = target.id; this.sel.regions = new Set([last.id]); this.sel.edit = last.id;
      this.commit('structure'); this.emit('selection');
    }
    return last;
  }
  async decodeFile(it) {
    const key = it.path || it.name;
    if (this.audioCache.has(key)) return this.audioCache.get(key);
    const ab = it.path ? await host.readBinary(it.path) : await it.arrayBuffer();
    const buf = await this.ctx.decodeAudioData(ab);
    this.audioCache.set(key, buf);
    if (this.audioCache.size > 24) this.audioCache.delete(this.audioCache.keys().next().value);
    return buf;
  }
  async importPaths(paths, drop) {
    const exts = /\.(wav|mp3|ogg|flac|m4a|aac|aif|aiff|opus|wma)$/i;
    const audio = paths.filter((p) => exts.test(p)).map((p) => ({ path: p, name: p.split(/[\\/]/).pop() }));
    const proj = paths.find((p) => /\.skystudio$/i.test(p));
    if (proj) return this.openProject(proj);
    if (audio.length) await this.importAudio(audio);
  }
  syncRegion(r) {
    const a = this.project.assets[r.asset];
    if (!a || !a.bpm) return;
    r.rate = this.project.bpm / a.bpm;
    r.len = (a.buffer ? (a.buffer.duration - (r.offset || 0)) : a.duration) / r.rate / this.spb;
  }

  // ------------------------------------------------------------ project files
  async newProject(starter) {
    if (!(await this.confirmDiscard())) return;
    if (starter) { this.loadStarter(starter); return; }
    const P = newProject();
    this.engine.stop();
    for (const id of [...this.engine.strips.keys()]) this.engine.dropStrip(id);
    this.project = P; this.filePath = ''; this.dirty = false;
    this.sel = { track: null, regions: new Set(), edit: null };
    this.history.reset(P); this.engine.pos = 0; this.engine.applyAll();
    this.emit('change', 'load'); this.emit('selection'); this.emit('transport'); this.updateTitle();
  }
  async confirmDiscard() {
    if (!this.dirty || !this.project.tracks.length) return true;
    return new Promise((resolve) => this.emit('confirm', { title: 'Discard unsaved changes?', body: `"${this.project.name}" has changes that haven't been saved.`, ok: 'Discard', cancel: 'Keep editing', resolve }));
  }
  async saveProject(forceDialog) {
    let path = this.filePath;
    if (!path || forceDialog) {
      path = await host.saveDialog({ title: 'Save project', filter: 'Sky Studio project (*.skystudio)', name: this.project.name + '.skystudio' });
      if (!path) return false;
      if (!/\.skystudio$/i.test(path)) path += '.skystudio';
    }
    this.toast('Saving…');
    const ok = await host.writeText(path, serialize(this.project));
    if (!ok) { this.toast('Could not save to ' + path, 'error'); return false; }
    this.filePath = path; this.dirty = false;
    this.project.name = path.split(/[\\/]/).pop().replace(/\.skystudio$/i, '');
    this.rememberRecent(path);
    host.clearAutosave();
    this.emit('change', 'meta'); this.updateTitle(); this.toast('Saved');
    return true;
  }
  rememberRecent(path) {
    this.settings.recent = [path, ...(this.settings.recent || []).filter((p) => p !== path)].slice(0, 8);
    this.saveSettings();
  }
  saveSettings() { host.setSettings(this.settings); }
  async openProject(pathOrFile) {
    if (!(await this.confirmDiscard())) return;
    let path = pathOrFile;
    if (!path) {
      const r = await host.openDialog({ title: 'Open project', filter: 'Sky Studio project (*.skystudio)' });
      path = r[0];
      if (!path) return;
    }
    try {
      const text = await host.readText(path);
      await this.loadProjectText(text, typeof path === 'string' ? path : '');
      if (typeof path === 'string') this.rememberRecent(path);
    } catch (e) { console.error(e); this.toast('That project file could not be opened', 'error'); }
  }
  /** Files dropped on the page (web version): songs open, plugins install, audio imports. */
  async importDropped(files) {
    const audio = [];
    for (const f of files) {
      if (/\.skystudio$/i.test(f.name)) { await this.openProject(f); return; }
      if (/\.(skyplugin|json)$/i.test(f.name)) {
        try { await this.installPluginText(await f.text()); } catch (e) { this.toast(`${f.name}: ${e.message}`, 'error'); }
      } else if (/\.(wav|mp3|ogg|flac|m4a|aif|aiff|opus|webm)$/i.test(f.name)) audio.push(f);
    }
    if (audio.length) this.importAudio(audio);
  }
  /** Install / remove plugins (a plugin file is JSON text). */
  async installPluginText(text, { quiet } = {}) {
    const p = await installPlugin(text, { ctx: this.ctx });
    this.settings.plugins = serializePlugins(); this.saveSettings();
    this.engine.applyAll();
    this.emit('change', 'plugins');
    if (!quiet) this.toast(`Installed “${p.name}”`);
    return p;
  }
  removePluginById(id) {
    if (!removePlugin(id)) return;
    this.settings.plugins = serializePlugins(); this.saveSettings();
    this.emit('change', 'plugins');
  }
  /** A song file can carry the plugins it uses. Offer to install the ones you don't have. */
  async adoptProjectPlugins(P) {
    const bundle = Array.isArray(P.plugins) ? P.plugins : [];
    delete P.plugins;
    const need = [];
    for (const src of bundle) { try { const q = parsePlugin(src); if (!PLUGINS.has(q.id)) need.push(q); } catch { /* skip bad entries */ } }
    if (!need.length) return;
    const list = need.map((q) => `• ${q.name}${q.author ? ' by ' + q.author : ''} (${q.kind})`).join('\n');
    const yes = await new Promise((resolve) => this.emit('confirm', {
      title: 'This song uses plugins', ok: 'Install', cancel: 'Skip',
      body: `This song needs plugins you don't have:\n${list}\n\nPlugins are small programs stored in the song file. Only install them if you trust where the song came from.`, resolve }));
    if (!yes) { this.toast('Skipped the plugins — those effects/instruments will stay silent', 'warn'); return; }
    for (const q of need) { try { await this.installPluginText(q.source, { quiet: true }); } catch (e) { this.toast(`Could not install “${q.name}”: ${e.message}`, 'error'); } }
  }
  async loadProjectText(text, path = '') {
    const P = await deserialize(text, this.ctx);
    await this.adoptProjectPlugins(P);
    for (const a of Object.values(P.assets)) if (a.buffer) a.peaks = computePeaks(a.buffer);
    this.engine.stop();
    for (const id of [...this.engine.strips.keys()]) this.engine.dropStrip(id);
    this.project = P; this.filePath = path; this.dirty = false;
    this.sel = { track: P.tracks[0] ? P.tracks[0].id : null, regions: new Set(), edit: null };
    this.history.reset(P); this.engine.pos = 0; this.engine.applyAll();
    this.engine.loadAssets(P).then(() => this.emit('change', 'kits'));
    this.emit('change', 'load'); this.emit('selection'); this.emit('transport'); this.updateTitle();
  }

  // ------------------------------------------------------------ export
  async exportAudio(opts = {}) {
    const P = this.project;
    if (!projectEndBeat(P)) { this.toast('There is nothing to export yet — add some regions first', 'warn'); return false; }
    const bits = opts.bits || 16;
    const range = this.exportRange(opts.range);
    const name = (opts.name || P.name) + (opts.suffix || '') + '.wav';
    const path = opts.path || await host.saveDialog({ title: 'Export audio', filter: 'WAV audio (*.wav)', name });
    if (!path) return false;
    this.toast('Rendering…');
    this.emit('busy', 'Rendering your song…');
    try {
      const buf = await renderProject(P, { sr: opts.sr || 44100, normalize: opts.normalize !== false, startBeat: range[0], endBeat: range[1], onlyTrack: opts.onlyTrack, tail: opts.tail });
      const ok = await host.writeBinary(path, audioBufferToWav(buf, bits));
      this.toast(ok ? 'Exported ' + path.split(/[\\/]/).pop() : 'Export failed', ok ? 'info' : 'error');
      return ok ? path : false;
    } finally { this.emit('busy', null); }
  }
  exportRange(kind) {
    const P = this.project;
    if (kind === 'loop' && P.loop.end > P.loop.start) return [P.loop.start, P.loop.end];
    return [0, projectEndBeat(P)];
  }
  async exportStems(opts = {}) {
    const dir = await host.saveDialog({ title: 'Choose a name prefix for the stems (one WAV per track will be saved next to it)', filter: 'WAV audio (*.wav)', name: this.project.name + ' - stems.wav' });
    if (!dir) return;
    const base = dir.replace(/\.wav$/i, '');
    let n = 0;
    this.emit('busy', 'Rendering stems…');
    try {
      for (const t of this.project.tracks) {
        if (!t.regions.length) continue;
        const safe = t.name.replace(/[^\w\- ]+/g, '_');
        const range = this.exportRange(opts.range);
        const buf = await renderProject(this.project, { sr: opts.sr || 44100, normalize: false, onlyTrack: t.id, startBeat: range[0], endBeat: range[1] });
        await host.writeBinary(`${base} - ${++n} ${safe}.wav`, audioBufferToWav(buf, opts.bits || 16));
      }
      this.toast(`Exported ${n} stem${n === 1 ? '' : 's'}`);
    } finally { this.emit('busy', null); }
  }
  async exportMidi() {
    const path = await host.saveDialog({ title: 'Export MIDI', filter: 'MIDI file (*.mid)', name: this.project.name + '.mid' });
    if (!path) return;
    const ok = await host.writeBinary(path, exportMidi(this.project));
    this.toast(ok ? 'MIDI exported' : 'Export failed', ok ? 'info' : 'error');
  }

  // ------------------------------------------------------------ audio output device
  async applyOutputDevice() {
    try { if (this.settings.sinkId && this.ctx.setSinkId) await this.ctx.setSinkId(this.settings.sinkId); } catch (e) { console.warn('setSinkId', e); }
  }
}

/** Min/max waveform envelope, 200 bins per second, interleaved [min,max,...]. */
export function computePeaks(buffer) {
  const per = Math.max(1, Math.floor(buffer.sampleRate / 200));
  const n = Math.ceil(buffer.length / per);
  const peaks = new Float32Array(n * 2);
  const chans = []; for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
  for (let i = 0; i < n; i++) {
    let mn = 1, mx = -1;
    const end = Math.min(buffer.length, (i + 1) * per);
    for (let j = i * per; j < end; j++) {
      let v = 0; for (const c of chans) v += c[j];
      v /= chans.length;
      if (v < mn) mn = v; if (v > mx) mx = v;
    }
    peaks[i * 2] = mn; peaks[i * 2 + 1] = mx;
  }
  return peaks;
}
