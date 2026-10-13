// The audio engine: mixer strips, send effects, live note playing, the look-ahead transport scheduler,
// loop previews and offline (export) scheduling. One Engine works on either an AudioContext or an
// OfflineAudioContext, so what you hear is exactly what gets exported.
import { Emitter, clamp, dbToGain, rng } from '../util.js';
import { INST_BY_ID, DEFAULT_PARAMS, Voice, prewarm, warmNotes } from './instruments.js';
import './instrument-bank.js';
import { PAD_BASE, PAD_CHOKE, ensureKit, kitReady } from './drums.js';
import { collectEvents, faderGain, beatsPerBar } from './events.js';
import { createFx, loadFxModule } from './fx.js';
import './plugins.js';
import { valueAt, autoKeys, parseFxKey } from './automation.js';

const HEADROOM = 0.42;
export const REVERBS = {
  room: { name: 'Room', sec: 0.9, damp: 0.55, early: true },
  hall: { name: 'Hall', sec: 2.4, damp: 0.5, early: true },
  plate: { name: 'Plate', sec: 1.6, damp: 0.25, early: false },
  space: { name: 'Space', sec: 5.2, damp: 0.6, early: false },
};

function makeIR(ctx, o) {
  const sr = ctx.sampleRate, N = Math.floor(sr * (o.sec + 0.05));
  const ir = ctx.createBuffer(2, N, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch), r = rng(1234 + ch * 77);
    let y = 0;
    const pre = Math.floor(sr * 0.012);
    for (let i = pre; i < N; i++) {
      const t = (i - pre) / sr, p = t / o.sec;
      const env = Math.exp(-6.9 * p);
      const alpha = 0.95 - (0.95 - 0.07) * Math.min(1, p * (1 + o.damp * 2.5)) ** 0.6;
      y += alpha * ((r() * 2 - 1) - y);
      d[i] = y * env;
    }
    if (o.early) {
      for (let k = 0; k < 14; k++) {
        const pos = pre + Math.floor((0.004 + r() * 0.07) * sr);
        d[pos] += (r() * 2 - 1) * 0.5 * Math.exp(-k * 0.12);
      }
    }
  }
  return ir;
}

function driveCurve(a) {
  const n = 1024, k = 1 + a * 14, c = new Float32Array(n), norm = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = (Math.tanh(k * x) / norm) / (1 + 3.8 * a); }
  return c;
}

class OneShot {
  constructor(src, gain, group) { this.src = src; this.g = gain; this.group = group; this.released = false; this.onend = null; src.onended = () => this.onend && this.onend(this); }
  release() { /* one-shots ring out */ }
  kill(t) { try { this.g.gain.setTargetAtTime(0, t, 0.005); this.src.stop(t + 0.06); } catch { /* */ } this.released = true; }
}

const reverseCache = new WeakMap();
/** A reversed copy of a drum hit (cached), for reverse cymbals and swells. */
function reversedBuffer(buf) {
  let r = reverseCache.get(buf);
  if (!r) {
    r = new AudioBuffer({ length: buf.length, sampleRate: buf.sampleRate, numberOfChannels: buf.numberOfChannels });
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c).slice().reverse(); r.copyToChannel(d, c); }
    reverseCache.set(buf, r);
  }
  return r;
}

export class Engine extends Emitter {
  /** Load the effect processors into an audio context (call once before building effects). */
  static loadFx(ctx) { return loadFxModule(ctx); }

  constructor(ctx, getProject, opts = {}) {
    super();
    this.ctx = ctx; this.getProject = getProject; this.offline = !!opts.offline; this.onlyTrack = opts.onlyTrack || null;
    this.strips = new Map(); this.voices = new Set();
    this.playing = false; this.pos = 0; this.segs = []; this.timer = null; this.from = 0; this.next = 0; this.underway = false;
    this.live = new Map(); this.pv = null; this.lastChoke = new Map(); this.autoReset = true; this.autoMap = new Map();
    this.irKey = '';
    const c = ctx;
    this.master = c.createGain();
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -4; this.limiter.knee.value = 3; this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002; this.limiter.release.value = 0.12;
    // final safety: smooth clip so nothing ever exceeds full scale
    this.clip = c.createWaveShaper();
    const cv = new Float32Array(4096);
    for (let i = 0; i < cv.length; i++) {
      const x = (i / (cv.length - 1)) * 2 - 1, a = Math.abs(x);
      cv[i] = a <= 0.85 ? x : Math.sign(x) * (0.85 + 0.15 * Math.tanh((a - 0.85) / 0.15));
    }
    this.clip.curve = cv; this.clip.oversample = '2x';
    this.master.connect(this.limiter); this.limiter.connect(this.clip); this.clip.connect(c.destination);
    if (!this.offline) {
      const sp = c.createChannelSplitter(2);
      this.anL = c.createAnalyser(); this.anR = c.createAnalyser();
      this.anL.fftSize = this.anR.fftSize = 1024;
      this.clip.connect(sp); sp.connect(this.anL, 0); sp.connect(this.anR, 1);
      this.bufL = new Float32Array(1024); this.bufR = new Float32Array(1024);
    }
    // reverb bus
    this.revIn = c.createGain();
    this.conv = c.createConvolver();
    const revHP = c.createBiquadFilter(); revHP.type = 'highpass'; revHP.frequency.value = 180;
    this.revOut = c.createGain(); this.revOut.gain.value = 0.9;
    this.revIn.connect(revHP); revHP.connect(this.conv); this.conv.connect(this.revOut);   // revOut joins the master only while something sends to it
    this.revActive = false; this.delActive = false;
    // ping-pong delay bus
    this.delIn = c.createGain();
    this.dL = c.createDelay(4); this.dR = c.createDelay(4);
    this.fbL = c.createGain(); this.fbR = c.createGain();
    const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 4200;
    this.delIn.connect(this.dL);
    this.dL.connect(fl); fl.connect(this.fbL); this.fbL.connect(this.dR); this.dR.connect(this.fbR); this.fbR.connect(this.dL);
    const pL = c.createStereoPanner(); pL.pan.value = -0.7; const pR = c.createStereoPanner(); pR.pan.value = 0.7;
    const delOut = this.delOut = c.createGain(); delOut.gain.value = 0.8;
    this.dL.connect(pL); this.dR.connect(pR); pL.connect(delOut); pR.connect(delOut);
    // metronome bus
    this.clickBus = c.createGain(); this.clickBus.gain.value = 0.5; this.clickBus.connect(this.master);
    this.applyMaster();
  }

  // ------------------------------------------------------------ master / strips
  applyMaster() {
    const P = this.getProject();
    if (!P) return;
    const set = (prm, v) => (this.offline ? (prm.value = v) : prm.setTargetAtTime(v, this.ctx.currentTime, 0.02));
    if (!autoKeys(P, 'master').has('masterVol')) set(this.master.gain, faderGain(P.masterVol ?? 0.8) * HEADROOM);
    this.applyMasterFx();
    const fx = P.fx || {};
    const type = fx.reverb || 'hall';
    if (this.irKey !== type) { this.irKey = type; this.conv.buffer = makeIR(this.ctx, REVERBS[type] || REVERBS.hall); }
    const spb = 60 / P.bpm, dt = clamp((fx.delayDiv ?? 0.75) * spb, 0.02, 3.9);
    set(this.dL.delayTime, dt); set(this.dR.delayTime, dt);
    set(this.fbL.gain, fx.delayFb ?? 0.38); set(this.fbR.gain, fx.delayFb ?? 0.38);
  }

  // Every audio node costs CPU in the desktop app's audio engine (~0.3% of real time each), so a channel strip only contains the
  // nodes it actually needs: EQ, drive, filter, compressor, pan and the send gains are patched in only while they are in use.
  strip(track) {
    let s = this.strips.get(track.id);
    if (s) return s;
    const c = this.ctx;
    s = { input: c.createGain(), vol: c.createGain(), lo: c.createBiquadFilter(), mid: c.createBiquadFilter(), hi: c.createBiquadFilter(), comp: c.createDynamicsCompressor(),
      makeup: c.createGain(), pan: c.createStereoPanner(), sendR: c.createGain(), sendD: c.createGain(), routeSig: null, chainSig: '', driveAmt: -1, revOn: false, delOn: false };
    s.lo.type = 'lowshelf'; s.lo.frequency.value = 140;
    s.mid.type = 'peaking'; s.mid.frequency.value = 1100; s.mid.Q.value = 0.8;
    s.hi.type = 'highshelf'; s.hi.frequency.value = 6500;
    s.drive = c.createWaveShaper(); s.drive.oversample = '2x';
    s.lp = c.createBiquadFilter(); s.lp.type = 'lowpass'; s.lp.Q.value = 0.8;
    s.hp = c.createBiquadFilter(); s.hp.type = 'highpass'; s.hp.Q.value = 0.8;
    s.comp.connect(s.makeup);
    s.sendR.connect(this.revIn); s.sendD.connect(this.delIn);
    s.vol.connect(this.master);
    if (!this.offline) { s.an = c.createAnalyser(); s.an.fftSize = 512; s.buf = new Float32Array(512); s.vol.connect(s.an); }
    this.strips.set(track.id, s);
    this.applyStrip(track);
    return s;
  }

  /** Create / remove the audio nodes of rack effects so they match `list` (array of {id,type,...}); returns the effect objects in order. */
  syncFx(holder, list) {
    holder.fxs = holder.fxs || new Map();
    const want = new Map(list.map((e) => [e.id, e.type]));
    for (const [id, fx] of [...holder.fxs]) if (want.get(id) !== fx.type) { try { fx.dispose(); } catch { /* */ } holder.fxs.delete(id); }
    return list.map((e) => {
      let fx = holder.fxs.get(e.id);
      if (!fx) { fx = createFx(this.ctx, e.type); if (fx) holder.fxs.set(e.id, fx); }
      return fx || null;
    });
  }
  /** Feed a sidechain effect's key input from another track (tapped before that track's own effects and mute). */
  wireKey(fx, e, ownerStrip) {
    const src = e.p.source ? this.strips.get(e.p.source) : null;
    const want = src && src !== ownerStrip ? src : null;
    if (fx.keySrc === want) return;
    if (fx.keySrc) { try { fx.keySrc.input.disconnect(fx.node, 0, 1); } catch { /* */ } }
    if (want) want.input.connect(fx.node, 0, 1);
    fx.keySrc = want;
  }

  applyStrip(track) {
    const s = this.strips.get(track.id);
    if (!s) return;
    const P = this.getProject();
    const now = this.ctx.currentTime;
    const set = (prm, v) => (this.offline ? (prm.value = v) : prm.setTargetAtTime(v, now, 0.015));
    const anySolo = P.tracks.some((t) => t.solo);
    let muted = track.mute || (anySolo && !track.solo);
    if (this.onlyTrack) muted = track.id !== this.onlyTrack;
    if (track.id === '__pv') muted = false;
    const ak = autoKeys(P, track.id);
    set(s.vol.gain, muted ? 0 : 1);
    if (!ak.has('vol')) set(s.input.gain, faderGain(track.vol));
    const eq = track.eq || {}, sd = track.send || {};
    const eqOn = Math.abs(eq.lo || 0) > 0.05 || Math.abs(eq.mid || 0) > 0.05 || Math.abs(eq.hi || 0) > 0.05;
    const a = track.comp || 0, dr = track.drive || 0, fl = track.filter || 0, pn = clamp(track.pan || 0, -1, 1);
    const panOn = Math.abs(pn) > 0.004 || ak.has('pan'), revOn = (sd.rev || 0) > 0.002 || ak.has('send.rev'), delOn = (sd.del || 0) > 0.002 || ak.has('send.del');
    const fxList = (track.fx || []).filter((e) => e.on !== false);
    const fxs = this.syncFx(s, fxList);
    const chainSig = [dr > 0 ? 'd' : '', fl < 0 ? 'l' : '', fl > 0 ? 'h' : '', a > 0 ? 'c' : ''].join('');
    const sig = [eqOn ? 'e' : '', chainSig, panOn ? 'p' : '', revOn ? 'R' : '', delOn ? 'D' : '', '|', fxList.map((e, i) => e.id + (fxs[i] ? '' : '!')).join(',')].join('');
    if (sig !== s.routeSig) {
      s.routeSig = sig; s.chainSig = chainSig;
      for (const n of [s.input, s.lo, s.mid, s.hi, s.drive, s.lp, s.hp, s.makeup, s.pan]) { try { n.disconnect(); } catch { /* not connected */ } }
      for (const fx of s.fxs.values()) { try { fx.output.disconnect(); } catch { /* */ } }
      try { s.vol.disconnect(s.sendR); } catch { /* */ }
      try { s.vol.disconnect(s.sendD); } catch { /* */ }
      s.comp.connect(s.makeup);
      const segs = [];
      if (eqOn) segs.push([s.lo, s.lo], [s.mid, s.mid], [s.hi, s.hi]);
      if (dr > 0) segs.push([s.drive, s.drive]);
      if (fl < 0) segs.push([s.lp, s.lp]);
      if (fl > 0) segs.push([s.hp, s.hp]);
      if (a > 0) segs.push([s.comp, s.makeup]);
      for (const fx of fxs) if (fx) segs.push([fx.input, fx.output]);
      if (panOn) segs.push([s.pan, s.pan]);
      let prev = s.input;
      for (const [i, o] of segs) { prev.connect(i); prev = o; }
      prev.connect(s.vol);
      if (revOn) s.vol.connect(s.sendR);
      if (delOn) s.vol.connect(s.sendD);
      s.revOn = revOn; s.delOn = delOn;
      this.updateBuses();
    }
    fxList.forEach((e, i) => {
      const fx = fxs[i]; if (!fx) return;
      const skip = new Set(); for (const k of ak) { const f = parseFxKey(k); if (f && f.id === e.id) skip.add(f.pid); }
      fx.apply(e.p, P.bpm, now, this.offline, skip);
      if (fx.keyIn) this.wireKey(fx, e, s);
    });
    if (eqOn) { set(s.lo.gain, eq.lo || 0); set(s.mid.gain, eq.mid || 0); set(s.hi.gain, eq.hi || 0); }
    if (dr > 0 && Math.abs(dr - s.driveAmt) > 0.004) { s.driveAmt = dr; s.drive.curve = driveCurve(dr); }
    if (fl < 0) set(s.lp.frequency, 20000 * Math.pow(0.012, -fl));
    if (fl > 0) set(s.hp.frequency, 20 * Math.pow(250, fl));
    if (a > 0) {
      s.comp.threshold.value = -4 - a * 26; s.comp.ratio.value = 1 + a * 7; s.comp.knee.value = 12; s.comp.attack.value = 0.008; s.comp.release.value = 0.18;
      set(s.makeup.gain, dbToGain(a * 2.5));
    }
    if (panOn && !ak.has('pan')) set(s.pan.pan, pn);
    if (revOn && !ak.has('send.rev')) set(s.sendR.gain, Math.pow(sd.rev || 0, 1.4));
    if (delOn && !ak.has('send.del')) set(s.sendD.gain, Math.pow(sd.del || 0, 1.4));
  }

  /** Master-bus effects (between the master fader and the final limiter). */
  applyMasterFx() {
    const P = this.getProject();
    const list = (P.masterFx || []).filter((e) => e.on !== false);
    const h = this.mfx = this.mfx || { fxs: new Map(), sig: null };
    const fxs = this.syncFx(h, list);
    const sig = list.map((e, i) => e.id + (fxs[i] ? '' : '!')).join(',');
    const now = this.ctx.currentTime;
    if (sig !== h.sig) {
      h.sig = sig;
      try { this.master.disconnect(); } catch { /* */ }
      for (const fx of h.fxs.values()) { try { fx.output.disconnect(); } catch { /* */ } }
      let prev = this.master;
      for (const fx of fxs) if (fx) { prev.connect(fx.input); prev = fx.output; }
      prev.connect(this.limiter);
    }
    const mk = autoKeys(P, 'master');
    list.forEach((e, i) => {
      const fx = fxs[i]; if (!fx) return;
      const skip = new Set(); for (const k of mk) { const f = parseFxKey(k); if (f && f.id === e.id) skip.add(f.pid); }
      fx.apply(e.p, P.bpm, now, this.offline, skip);
      if (fx.keyIn) this.wireKey(fx, e, null);
    });
  }

  /** The reverb and echo buses only sit in the graph while at least one track sends to them. */
  updateBuses() {
    let r = false, d = false;
    for (const s of this.strips.values()) { if (s.revOn) r = true; if (s.delOn) d = true; }
    if (r !== this.revActive) { this.revActive = r; if (r) this.revOut.connect(this.master); else this.revOut.disconnect(); }
    if (d !== this.delActive) { this.delActive = d; if (d) this.delOut.connect(this.master); else this.delOut.disconnect(); }
  }

  applyAll() {
    const P = this.getProject();
    for (const id of [...this.strips.keys()]) if (id !== '__pv' && !P.tracks.some((t) => t.id === id)) this.dropStrip(id);
    for (const t of P.tracks) this.strip(t);
    for (const t of P.tracks) this.applyStrip(t);        // second pass so sidechain effects can find tracks created after them
    this.applyMaster();
    this.autoMap = new Map();
    for (const l of P.auto || []) if (l.on !== false && l.pts.length) this.autoMap.set(l.track + '|' + l.param, l);
    if (this.playing) this.autoReset = true; else if (!this.offline) this.applyAutoStatic(this.pos);
  }
  dropStrip(id) {
    const s = this.strips.get(id);
    if (!s) return;
    for (const n of [s.vol, s.input, s.sendR, s.sendD, s.pan, s.makeup, s.comp, s.lo, s.mid, s.hi, s.drive, s.lp, s.hp]) { try { n.disconnect(); } catch { /* */ } }
    if (s.fxs) for (const fx of s.fxs.values()) { try { fx.dispose(); } catch { /* */ } }
    this.strips.delete(id);
    this.updateBuses();
  }

  // ------------------------------------------------------------ assets
  /** Make sure kits for drum tracks are rendered and instrument buffers warmed. */
  async loadAssets(project) {
    const sr = this.ctx.sampleRate;
    const jobs = [];
    for (const t of project.tracks) {
      if (t.type === 'drum') jobs.push(ensureKit(t.kit || '808', sr));
      else if (t.type === 'inst') {
        const inst = INST_BY_ID[t.inst];
        if (inst && inst.start.prepare) jobs.push(prewarm(t.inst, sr, 21, 108));     // plugin instruments render in a worker: wait for them
        else prewarm(t.inst, sr);
      }
    }
    await Promise.all(jobs);
  }
  /** What a pad plays: { buf, off, dur } (a kit sound, a whole sample, or a slice of a sample) or null while the kit is still loading. */
  padBuffer(track, pad) {
    const P = this.getProject();
    const ps = track.padSamples && track.padSamples[pad];
    if (ps) {
      const aid = typeof ps === 'object' ? ps.asset : ps;
      const a = P.assets && P.assets[aid];
      if (a && a.buffer) {
        if (typeof ps === 'object') { const off = clamp(ps.start || 0, 0, a.buffer.duration - 0.001), end = clamp(ps.end ?? a.buffer.duration, off + 0.005, a.buffer.duration); return { buf: a.buffer, off, dur: end - off, slice: true }; }
        return { buf: a.buffer, off: 0, dur: a.buffer.duration };
      }
    }
    const kit = kitReady(track.kit || '808', this.ctx.sampleRate);
    if (!kit) { ensureKit(track.kit || '808', this.ctx.sampleRate).then(() => this.emit('kitloaded')); return null; }
    const b = kit[pad];
    return b ? { buf: b, off: 0, dur: b.duration } : null;
  }

  // ------------------------------------------------------------ voices
  register(v) {
    this.voices.add(v);
    v.onend = (x) => this.voices.delete(x);
    // voice limit only applies to live playback (an offline render schedules the whole song up front)
    if (!this.offline && this.voices.size > 220) {
      let n = 0;
      for (const o of this.voices) { o.kill(this.ctx.currentTime); this.voices.delete(o); if (++n > 20) break; }
    }
    return v;
  }
  /** Start one note/hit on a track at audio-time t. dur (seconds) schedules the release; omit for live (held) notes. */
  startNote(track, midi, vel, t, dur, beat) {
    const strip = this.strip(track);
    const ctx = this.ctx;
    const prm = { ...(track.type === 'drum' ? { tone: 0.5, attack: 0.5, release: 1 } : DEFAULT_PARAMS), ...(track.params || {}) };
    if (beat != null) for (const k of ['tone', 'attack', 'release']) { const v = this.autoValueAt(track.id, 'params.' + k, beat); if (v != null) prm[k] = v; }
    if (track.type === 'drum') {
      const pad = midi - PAD_BASE;
      const info = this.padBuffer(track, pad);
      if (!info) return null;
      const pm = (track.padMix && track.padMix[pad]) || {};
      const src = ctx.createBufferSource(); src.buffer = pm.reverse && !info.slice ? reversedBuffer(info.buf) : info.buf;
      src.playbackRate.value = Math.pow(2, ((prm.tone ?? 0.5) - 0.5) * 0.5 + (pm.tune || 0) / 12);
      const g = ctx.createGain();
      const v = vel / 127;
      g.gain.value = Math.pow(v, 1.4) * 1.15 * (pm.gain ?? 1);
      // optional per-hit shaping from the Sound Lab (each adds one node, and only when used): filter, pan
      let tailNode = g;
      if (pm.filter) { const f = ctx.createBiquadFilter(); f.type = pm.filter < 0 ? 'lowpass' : 'highpass'; f.frequency.value = pm.filter < 0 ? clamp(20000 * Math.pow(0.012, -pm.filter), 80, 20000) : clamp(20 * Math.pow(250, pm.filter), 20, 9000); f.Q.value = 0.8; tailNode.connect(f); tailNode = f; }
      if (pm.pan) { const pn = ctx.createStereoPanner(); pn.pan.value = clamp(pm.pan, -1, 1); tailNode.connect(pn); tailNode = pn; }
      src.connect(g); tailNode.connect(strip.input);
      if (info.slice) { src.start(t, info.off, info.dur); } else src.start(t);
      if (pm.decay != null && pm.decay < 0.999) {                       // shorten this hit (Sound Lab "Length")
        const cut = Math.max(0.02, info.dur * (0.04 + 0.96 * clamp(pm.decay, 0, 1)) / src.playbackRate.value);
        g.gain.setValueAtTime(g.gain.value, t + cut * 0.5); g.gain.setTargetAtTime(0, t + cut * 0.5, cut * 0.1); src.stop(t + cut * 1.2);
      }
      if (prm.release < 0.999) {
        const cut = info.dur * (0.12 + 0.88 * clamp(prm.release / 0.5, 0, 1)) / src.playbackRate.value;
        if (prm.release < 0.5) { g.gain.setValueAtTime(g.gain.value, t + cut * 0.6); g.gain.setTargetAtTime(0, t + cut * 0.6, cut * 0.12); src.stop(t + cut * 1.4); }
      }
      const group = PAD_CHOKE[pad];
      const voice = new OneShot(src, g, group ? track.id + ':' + group : null);
      if (group) {
        const prev = this.lastChoke.get(voice.group);
        if (prev && !prev.released) prev.kill(t);
        this.lastChoke.set(voice.group, voice);
      }
      return this.register(voice);
    }
    if (track.inst === 'sampler') return this.sampleNote(track, strip, midi, vel, t, dur, prm);
    const inst = INST_BY_ID[track.inst] || INST_BY_ID.piano;
    if (track.patch) prm.patch = track.patch;
    if (track.transpose) midi = clamp(midi + track.transpose, 0, 127);
    const v = inst.start(ctx, strip.input, t, midi, vel, prm);
    if (dur != null) v.release(t + dur);
    return this.register(v);
  }

  sampleNote(track, strip, midi, vel, t, dur, prm) {
    const P = this.getProject();
    const smp = track.sample;
    const asset = smp && P.assets && P.assets[smp.asset];
    if (!asset || !asset.buffer) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = asset.buffer;
    src.playbackRate.value = Math.pow(2, (midi - (smp.root ?? 60)) / 12);
    if (smp.loop) { src.loop = true; src.loopStart = smp.loopStart || 0; src.loopEnd = smp.loopEnd || asset.buffer.duration; }
    const g = ctx.createGain(), rel = ctx.createGain();
    const A = 0.002 * Math.pow(10, ((prm.attack ?? 0.5) - 0.5) * 3);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(Math.pow(vel / 127, 1.2), t + A);
    src.connect(g); g.connect(rel); rel.connect(strip.input);
    src.start(t, smp.start || 0);
    const R = 0.12 * Math.pow(10, ((prm.release ?? 0.5) - 0.5) * 2);
    const v = new Voice(ctx, rel, [src], R);
    if (dur != null && (smp.loop || smp.hold)) v.release(t + dur);
    return this.register(v);
  }

  playAudio(ev, t, spb) {
    const P = this.getProject();
    const r = ev.region, asset = P.assets[r.asset];
    if (!asset || !asset.buffer) return;
    const strip = this.strip(ev.track), ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = asset.buffer;
    const rate = r.rate || 1;
    src.playbackRate.value = rate;
    const g = ctx.createGain(), dur = ev.durBeats * spb;
    const gain = r.gain ?? 1;
    const fi = (r.fadeIn || 0) * spb, fo = (r.fadeOut || 0) * spb;
    g.gain.setValueAtTime(fi > 0 && ev.beat <= r.start + 1e-6 ? 0 : gain, t);
    if (fi > 0 && ev.beat <= r.start + 1e-6) g.gain.linearRampToValueAtTime(gain, t + fi);
    if (fo > 0) { g.gain.setValueAtTime(gain, t + Math.max(0, dur - fo)); g.gain.linearRampToValueAtTime(0, t + dur); }
    src.connect(g); g.connect(strip.input);
    let off = ev.offset;
    if (r.loop) {
      const ls = r.offset || 0, ll = Math.max(0.02, r.srcLen || asset.buffer.duration - ls);
      src.loop = true; src.loopStart = ls; src.loopEnd = ls + ll;
      off = ls + ((off - ls) % ll);
    }
    src.start(t, clamp(off, 0, asset.buffer.duration));
    src.stop(t + dur + 0.02);
    this.register(new OneShot(src, g, null));
  }

  killAll(t = this.ctx.currentTime) {
    for (const v of this.voices) v.kill(t);
    this.voices.clear();
  }

  // ------------------------------------------------------------ live (played by the user)
  liveOn(track, midi, vel = 100) {
    this.ctx.resume();
    this.liveOff(track, midi);
    const v = this.startNote(track, midi, vel, this.ctx.currentTime + 0.005);
    if (v) this.live.set(track.id + ':' + midi, v);
    return v;
  }
  liveOff(track, midi) {
    const k = track.id + ':' + midi, v = this.live.get(k);
    if (v) { v.release(this.ctx.currentTime); this.live.delete(k); }
  }
  liveAllOff() {
    for (const v of this.live.values()) v.release(this.ctx.currentTime);
    this.live.clear();
  }

  // ------------------------------------------------------------ transport
  beatsHeard() {
    if (!this.playing) return this.pos;
    const now = this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0);
    let seg = this.segs[0];
    for (const s of this.segs) { if (s.t <= now) seg = s; else break; }
    return seg.b + ((now - seg.t) * seg.bpm) / 60;
  }
  /** Where the playhead is (never negative, stays at the record-start point during a count-in). */
  beat() {
    if (!this.playing) return this.pos;
    const b = this.beatsHeard();
    return this.countIn ? Math.max(b, this.from) : Math.max(b, 0);
  }
  inCountIn() { return this.playing && this.countIn && this.beatsHeard() < this.from; }

  play(from, opts = {}) {
    if (this.playing) return;
    const P = this.getProject();
    this.ctx.resume();
    const count = opts.countBeats || 0;
    this.countIn = count > 0;
    this.from = from;
    const startBeat = from - count;
    this.segs = [{ t: this.ctx.currentTime + 0.1, b: startBeat, bpm: P.bpm }];
    this.next = startBeat; this.underway = true; this.autoReset = true; this.playing = true; this.pos = from;
    this.timer = setInterval(() => this.tick(), 20);
    this.tick();
    this.emit('state');
  }
  stop() {
    if (!this.playing) return this.pos;
    this.pos = this.inCountIn() ? this.from : Math.max(0, this.beatsHeard());
    this.playing = false; this.countIn = false;
    clearInterval(this.timer); this.timer = null;
    this.killAll(); this.segs = [];
    this.applyAutoStatic(this.pos);
    this.emit('state');
    return this.pos;
  }
  seek(beat) {
    beat = Math.max(0, beat);
    if (this.playing) {
      const P = this.getProject();
      this.killAll();
      this.from = beat; this.countIn = false;
      this.segs = [{ t: this.ctx.currentTime + 0.05, b: beat, bpm: P.bpm }];
      this.next = beat; this.underway = true; this.autoReset = true;
    } else { this.pos = beat; this.applyAutoStatic(beat); }
    this.emit('seek', beat);
  }
  /** Project tempo changed while playing: re-anchor so the position stays continuous. */
  tempoChanged() {
    if (!this.playing) return;
    const P = this.getProject();
    const now = this.ctx.currentTime, last = this.segs[this.segs.length - 1];
    if (last.bpm === P.bpm) return;
    let seg = this.segs[0];
    for (const s of this.segs) { if (s.t <= now) seg = s; else break; }
    const b = seg.b + ((now - seg.t) * seg.bpm) / 60;
    this.segs = [{ t: now, b, bpm: P.bpm }];
  }

  tick() {
    if (!this.playing) return;
    const P = this.getProject(), ctx = this.ctx, now = ctx.currentTime;
    if (ctx.state === 'suspended') ctx.resume();
    const horizon = now + 0.16;
    for (let guard = 0; guard < 6; guard++) {
      const seg = this.segs[this.segs.length - 1];
      let to = seg.b + ((horizon - seg.t) * seg.bpm) / 60;
      if (to <= this.next) break;
      const L = P.loop;
      const looping = L && L.on && L.end > L.start + 0.1 && this.next < L.end && this.from <= L.end;
      let wrap = false;
      if (looping && to >= L.end) { to = L.end; wrap = true; }
      this.scheduleRange(this.next, to, seg, looping ? L.end : Infinity);
      this.next = to;
      if (wrap) {
        const tWrap = seg.t + ((L.end - seg.b) * 60) / seg.bpm;
        this.segs.push({ t: tWrap, b: L.start, bpm: seg.bpm });
        this.next = L.start; this.underway = true; this.autoReset = true;
        this.emit('wrap', tWrap);
      } else break;
    }
    // forget segments that are fully in the past
    let keep = 0;
    for (let i = 0; i < this.segs.length; i++) if (this.segs[i].t <= now - 0.5) keep = i;
    if (keep > 0) this.segs.splice(0, keep);
  }

  scheduleRange(b0, b1, seg, loopEnd) {
    const P = this.getProject(), spb = 60 / seg.bpm;
    const timeOf = (b) => seg.t + (b - seg.b) * spb;
    const now = this.ctx.currentTime;
    this.scheduleClicks(P, b0, b1, timeOf);
    this.scheduleAuto(P, Math.max(b0, this.from), b1, timeOf, this.autoReset);
    this.autoReset = false;
    const lo = Math.max(b0, this.from);
    if (b1 <= lo) return;
    const evs = collectEvents(P, lo, b1, this.underway);
    this.underway = false;
    for (const ev of evs) {
      const t = Math.max(timeOf(ev.beat), now);
      if (ev.type === 'note') {
        let dur = ev.dur;
        if (ev.beat + dur > loopEnd) dur = loopEnd - ev.beat;
        this.startNote(ev.track, ev.midi, ev.vel, t, dur * spb, ev.beat);
      } else {
        if (ev.beat + ev.durBeats > loopEnd) ev.durBeats = loopEnd - ev.beat;
        this.playAudio(ev, t, spb);
      }
    }
  }

  scheduleClicks(P, b0, b1, timeOf) {
    const unit = 4 / P.ts[1], bpb = beatsPerBar(P.ts);
    for (let k = Math.ceil(b0 / unit - 1e-9); k * unit < b1 - 1e-9; k++) {
      const beat = k * unit;
      if (!(P.metronome || beat < this.from)) continue;
      const accent = Math.abs(((beat % bpb) + bpb) % bpb) < 1e-6 || Math.abs((((beat % bpb) + bpb) % bpb) - bpb) < 1e-6;
      this.click(Math.max(timeOf(beat), this.ctx.currentTime), accent);
    }
  }
  click(t, accent) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = accent ? 1760 : 1180;
    g.gain.setValueAtTime(accent ? 0.9 : 0.55, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    o.connect(g); g.connect(this.clickBus); o.start(t); o.stop(t + 0.06);
  }

  // ------------------------------------------------------------ automation
  /** The AudioParam (and value converter) a lane drives, or null if it can't be resolved right now. */
  resolveAuto(lane) {
    const idf = (v) => v;
    if (lane.track === 'master') {
      if (lane.param === 'masterVol') return { p: this.master.gain, f: (v) => faderGain(v) * HEADROOM };
      const fk = parseFxKey(lane.param); const fx = fk && this.mfx && this.mfx.fxs.get(fk.id);
      return fx ? fx.autoParam(fk.pid) : null;
    }
    const s = this.strips.get(lane.track);
    if (!s) return null;
    switch (lane.param) {
      case 'vol': return { p: s.input.gain, f: faderGain };
      case 'pan': return { p: s.pan.pan, f: idf };
      case 'send.rev': return { p: s.sendR.gain, f: (v) => Math.pow(v, 1.4) };
      case 'send.del': return { p: s.sendD.gain, f: (v) => Math.pow(v, 1.4) };
      default: { const fk = parseFxKey(lane.param); const fx = fk && s.fxs && s.fxs.get(fk.id); return fx ? fx.autoParam(fk.pid) : null; }
    }
  }
  /** Schedule the automation points of [b0,b1). reset = (re)start from the playhead: cancel old events and jump to the value at b0. */
  scheduleAuto(P, b0, b1, timeOf, reset) {
    for (const lane of P.auto || []) {
      if (lane.on === false || !lane.pts.length) continue;
      const t = this.resolveAuto(lane);
      if (!t) continue;
      if (reset) { const t0 = Math.max(timeOf(b0), this.ctx.currentTime); t.p.cancelScheduledValues(t0); t.p.setValueAtTime(t.f(valueAt(lane, b0)), t0); }
      for (const pt of lane.pts) {
        if (pt.b < b0 || pt.b >= b1) continue;
        const tt = Math.max(timeOf(pt.b), this.ctx.currentTime);
        if (lane.mode === 'step') t.p.setValueAtTime(t.f(pt.v), tt); else t.p.linearRampToValueAtTime(t.f(pt.v), tt);
      }
    }
  }
  /** While stopped, park every automated parameter at the value for the playhead position. */
  applyAutoStatic(beat) {
    const P = this.getProject(), now = this.ctx.currentTime;
    for (const lane of P.auto || []) {
      if (lane.on === false || !lane.pts.length) continue;
      const t = this.resolveAuto(lane);
      if (!t) continue;
      t.p.cancelScheduledValues(now);
      t.p.setValueAtTime(t.f(valueAt(lane, beat)), now);
    }
  }
  scheduleAutoOffline(P, b0, b1) {
    const spb = 60 / P.bpm;
    for (const lane of P.auto || []) {
      if (lane.on === false || !lane.pts.length) continue;
      const t = this.resolveAuto(lane);
      if (!t) continue;
      t.p.setValueAtTime(t.f(valueAt(lane, b0)), 0);
      for (const pt of lane.pts) {
        if (pt.b <= b0 || pt.b > b1) continue;
        const tt = (pt.b - b0) * spb;
        if (lane.mode === 'step') t.p.setValueAtTime(t.f(pt.v), tt); else t.p.linearRampToValueAtTime(t.f(pt.v), tt);
      }
    }
  }
  /** Value of an automated instrument setting (tone/attack/release) at a beat, or null. */
  autoValueAt(trackId, param, beat) {
    const lane = this.autoMap && this.autoMap.get(trackId + '|' + param);
    return lane ? valueAt(lane, beat) : null;
  }

  // ------------------------------------------------------------ previews (loop browser / sound browser)
  /** Loop a set of notes on a throw-away track until previewStop(). notes: [{s,d,p,v}] in beats. */
  previewLoop(trackLike, notes, lenBeats, bpm, once = false, passes = 1) {
    this.previewStop();
    this.ctx.resume();
    const st = { track: { ...trackLike, id: '__pv', vol: 0.8, pan: 0, mute: false, solo: false, send: trackLike.send || { rev: 0.12, del: 0 }, eq: {}, comp: 0 }, notes, len: lenBeats, bpm, iter: 0, t0: this.ctx.currentTime + 0.06, voices: [], once, passes };
    this.pv = st;
    this.strip(st.track); this.applyStrip(st.track);      // one reusable preview strip (never create a new one per click)
    const spb = 60 / bpm;
    const pump = () => {
      const now = this.ctx.currentTime;
      while (st.t0 + st.iter * st.len * spb - now < 0.3) {
        if (st.once && st.iter >= st.passes) { clearInterval(st.timer); st.timer = setTimeout(() => this.previewStop(), Math.max(0.5, st.t0 + st.iter * st.len * spb - this.ctx.currentTime + 1.5) * 1000); return; }
        const base = st.t0 + st.iter * st.len * spb;
        for (const n of st.notes) {
          const v = this.startNote(st.track, n.p, n.v, base + n.s * spb, n.d * spb);
          if (v) st.voices.push(v);
        }
        st.iter++;
      }
    };
    pump();
    st.timer = setInterval(pump, 25);
    this.emit('preview', true);
  }
  previewStop() {
    const st = this.pv;
    if (!st) return;
    clearInterval(st.timer); clearTimeout(st.timer);
    const now = this.ctx.currentTime;
    for (const v of st.voices) { try { v.kill(now); } catch { /* */ } this.voices.delete(v); }
    this.pv = null;
    this.emit('preview', false);
  }

  /** Play an AudioBuffer straight to the master (sample browser). */
  previewBuffer(buf) {
    this.previewStop();
    if (this.pvBuf) { try { this.pvBuf.stop(); } catch { /* */ } }
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const g = this.ctx.createGain(); g.gain.value = 0.9;
    src.connect(g); g.connect(this.master); src.start();
    src.onended = () => { if (this.pvBuf === src) { this.pvBuf = null; this.emit('preview', false); } };
    this.pvBuf = src;
    this.emit('preview', true);
  }
  previewStopAll() { this.stopEpoch = (this.stopEpoch || 0) + 1; this.previewStop(); if (this.pvBuf) { try { this.pvBuf.stop(); } catch { /* */ } this.pvBuf = null; this.emit('preview', false); } }

  // ------------------------------------------------------------ offline
  scheduleOffline(project, b0, b1) {
    const spb = 60 / project.bpm;
    for (const ev of this.offlineEvents(project, b0, b1)) this.fireOffline(ev, b0, spb);
  }
  /** All events of an export, sorted by time (the strips are created first). */
  offlineEvents(project, b0, b1) {
    this.applyAll();
    this.scheduleAutoOffline(project, b0, b1);
    return collectEvents(project, b0, b1, true);
  }
  fireOffline(ev, b0, spb) {
    const t = (ev.beat - b0) * spb;
    if (ev.type === 'note') this.startNote(ev.track, ev.midi, ev.vel, t, ev.dur * spb, ev.beat);
    else this.playAudio(ev, t, spb);
  }
  /** Pre-render every buffer-based instrument note the project uses (sync) so an offline render has them. */
  prepareOffline(project) {
    const sr = this.ctx.sampleRate;
    const evs = collectEvents(project, 0, 1e9, true);
    const per = new Map();
    for (const ev of evs) if (ev.type === 'note' && ev.track.type === 'inst') {
      if (!per.has(ev.track.inst)) per.set(ev.track.inst, new Set());
      per.get(ev.track.inst).add(ev.midi);
    }
    for (const [inst, set] of per) warmNotes(inst, sr, set);
  }

  // ------------------------------------------------------------ metering
  trackLevel(id) {
    const s = this.strips.get(id);
    if (!s || !s.an) return 0;
    s.an.getFloatTimeDomainData(s.buf);
    let p = 0;
    for (let i = 0; i < s.buf.length; i++) { const a = Math.abs(s.buf[i]); if (a > p) p = a; }
    return p;
  }
  masterLevels() {
    if (!this.anL) return [0, 0];
    this.anL.getFloatTimeDomainData(this.bufL); this.anR.getFloatTimeDomainData(this.bufR);
    let l = 0, r = 0;
    for (let i = 0; i < 1024; i++) { const a = Math.abs(this.bufL[i]); if (a > l) l = a; const b = Math.abs(this.bufR[i]); if (b > r) r = b; }
    return [l, r];
  }
}
