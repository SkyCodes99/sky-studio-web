// Sound library 2: world instruments, orchestral sections, extra keys / plucked / bass, cinematic textures.
// Registers itself with the instrument list (imported for its side effect by instrument-bank.js).
// Sustained instruments use synth2() = the classic synth voice plus body resonances, bow/breath noise, pitch scoops and per-note
// humanising; struck / plucked instruments are rendered once per key into note buffers (cheap while playing).
import { clamp, mtof, rng } from '../util.js';
import { INSTRUMENTS, INST_BY_ID, INST_CATS, Voice, bufferInstrument, noiseBuf, satCurve, pulseWave, tm, fc, velAmp, renderPluck, renderMallet, renderPiano, normalize } from './instruments.js';

const SAW = (o = {}) => ({ type: 'sawtooth', ...o });
const SQ = (o = {}) => ({ type: 'square', ...o });
const SIN = (o = {}) => ({ type: 'sine', ...o });
const TRI = (o = {}) => ({ type: 'triangle', ...o });

// ---------------------------------------------------------------- synth2: subtractive voice with body resonances
function synth2(spec) {
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

    const r = rng(Math.floor(t * 997) + midi * 13 + 1), H = spec.humanize ?? 4;
    const sources = [], detuneTargets = [];
    const gl = spec.oscs.map((o) => o.gain ?? 1), sameGain = gl.every((g) => Math.abs(g - gl[0]) < 0.001 && Math.abs(g - 1) > 0.26);
    if (sameGain) { amp.gain.cancelScheduledValues(0); amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(peak * gl[0], t + A); if (S < 1) amp.gain.setTargetAtTime(peak * gl[0] * S, t + A, D); }
    for (const o of spec.oscs) {
      const osc = ctx.createOscillator();
      if (o.pulse) osc.setPeriodicWave(pulseWave(ctx, o.pulse)); else osc.type = o.type || 'sawtooth';
      osc.frequency.value = f * (o.ratio ?? 1);
      osc.detune.value = (o.detune || 0) + (r() - 0.5) * 2 * H;
      if (spec.scoop) { osc.detune.setValueAtTime(osc.detune.value + spec.scoop.cents, t); osc.detune.setTargetAtTime(osc.detune.value, t, spec.scoop.t ?? 0.06); }
      const og = o.gain ?? 1;
      if (!sameGain && Math.abs(og - 1) > 0.26) { const g = ctx.createGain(); g.gain.value = og; osc.connect(g); g.connect(flt); } else osc.connect(flt);
      osc.start(t); sources.push(osc); detuneTargets.push(osc.detune);
    }
    if (spec.vib) {
      const lfo = ctx.createOscillator(); lfo.frequency.value = spec.vib.rate * (0.94 + r() * 0.12);
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
    if (spec.noise) {                                          // bow / breath noise that follows the note
      const n = ctx.createBufferSource(); n.buffer = noiseBuf(ctx); n.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = clamp(f * (spec.noise.ratio ?? 1), 100, 12000); bp.Q.value = spec.noise.q ?? 2;
      const ng = ctx.createGain(); ng.gain.value = spec.noise.level;
      n.connect(bp); bp.connect(ng); ng.connect(flt); n.start(t, r() * 1.5); sources.push(n);
    }
    if (spec.chiff) {                                          // short breath burst at the start of a note
      const n = ctx.createBufferSource(); n.buffer = noiseBuf(ctx);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = clamp(f * 3, 400, 9000); bp.Q.value = 1.2;
      const cg = ctx.createGain(); cg.gain.setValueAtTime(spec.chiff * peak, t); cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      n.connect(bp); bp.connect(cg); cg.connect(amp); n.start(t, r()); n.stop(t + 0.12);
    }
    if (spec.click) {
      const n = ctx.createBufferSource(); n.buffer = noiseBuf(ctx);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
      const cg = ctx.createGain(); cg.gain.setValueAtTime(spec.click * peak, t); cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
      n.connect(hp); hp.connect(cg); cg.connect(amp); n.start(t); n.stop(t + 0.03);
    }
    let node = flt;
    for (const [bf, gdb, bq] of spec.body || []) {              // fixed body resonances give each instrument its character
      const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = bf; pk.gain.value = gdb; pk.Q.value = bq ?? 1.2;
      node.connect(pk); node = pk;
    }
    if (spec.drive) { const ws = ctx.createWaveShaper(); ws.curve = satCurve(spec.drive); node.connect(ws); node = ws; }
    if (spec.tremolo) {
      const lfo = ctx.createOscillator(); lfo.frequency.value = spec.tremolo.rate;
      const lg = ctx.createGain(); lg.gain.value = spec.tremolo.depth * peak * 0.5;
      lfo.connect(lg); lg.connect(amp.gain); lfo.start(t); sources.push(lfo);
    }
    node.connect(amp);
    amp.connect(out);
    const maxEnd = spec.pluck ? t + A + D * 8 + 0.1 : undefined;
    if (spec.pluck) for (const s of sources) { try { s.stop(maxEnd); } catch { /* */ } }
    return new Voice(ctx, rel, sources, R, maxEnd);
  };
}

// ---------------------------------------------------------------- choirs (formant voices; spec says which vowel + register)
function choir(spec) {
  return function start(ctx, out, t, midi, vel, P) {
    const f = mtof(midi + (spec.shift || 0)), v = vel / 127, vow = P.tone ?? 0.5, fs = spec.formant ?? 1;
    const r = rng(Math.floor(t * 991) + midi * 7);
    const sources = [];
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = (spec.tape ?? 3600) * fs; lp.Q.value = 0.5;
    for (const d of spec.detunes || [-10, 10]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d + (r() - 0.5) * 6;
      o.connect(lp); o.start(t); sources.push(o);
    }
    const lfo = ctx.createOscillator(); lfo.frequency.value = (spec.vibRate ?? 5.1) * (0.95 + r() * 0.1);
    const lg = ctx.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(spec.vib ?? 10, t + 0.8);
    lfo.connect(lg); sources.forEach((s) => lg.connect(s.detune)); lfo.start(t); sources.push(lfo);
    // vowel = three resonances in series (each one a peaking filter lifts a formant out of the saw spectrum)
    let node = lp;
    const qb = spec.q ?? 5;
    for (const [fr, db] of [[(350 + 500 * vow) * fs, 15], [(700 + 520 * vow) * fs, 10], [(2500 + 400 * vow) * fs, 6]]) {
      const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = clamp(fr, 200, 8000); pk.gain.value = db; pk.Q.value = clamp(qb * Math.pow(220 / f, 0.5), 1.6, qb);
      node.connect(pk); node = pk;
    }
    const amp = ctx.createGain(), rel = amp;
    const A = tm(spec.a ?? 0.3, P.attack), R = tm(spec.r ?? 0.55, P.release);
    amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime((spec.level ?? 0.5) * velAmp(v, 0.4), t + A);
    node.connect(amp); amp.connect(out);
    return new Voice(ctx, rel, sources, R);
  };
}

// ---------------------------------------------------------------- modal synthesis (bars, bells, bowls, drums) rendered to buffers
function renderModal(midi, sr, o) {
  const f0 = mtof(midi + (o.shift || 0)), N = Math.floor(sr * o.dur), out = new Float32Array(N);
  const ps = o.flat ? 1 : clamp(Math.pow(2, -(midi - 60) / (o.tilt ?? 22)), 0.45, 2.2);
  const r = rng(midi * 53 + 5);
  o.ratios.forEach((ratio, k) => {
    const fn = f0 * ratio;
    if (fn > sr * 0.42) return;
    const dc = Math.exp(-1 / (sr * o.decays[k] * ps)), a0 = o.amps[k];
    const comps = o.beat ? [[-(o.beat / 2) * (1 + k * 0.12), 0.5], [(o.beat / 2) * (1 + k * 0.12), 0.5]] : [[0, 1]];
    for (const [df, w] of comps) {
      const ph0 = r() * 6.2832, step = (2 * Math.PI * (fn + df)) / sr;
      let e = a0 * w;
      if (o.glide) {
        let ph = ph0;
        for (let i = 0; i < N; i++) { out[i] += Math.sin(ph) * e; e *= dc; ph += step * (1 + o.glide * Math.exp(-i / (sr * (o.glideT ?? 0.05)))); }
      } else {
        let c = Math.cos(ph0), s = Math.sin(ph0);
        const cw = Math.cos(step), sw = Math.sin(step);
        for (let i = 0; i < N; i++) { out[i] += s * e; e *= dc; const nc = c * cw - s * sw; s = s * cw + c * sw; c = nc; }
      }
    }
  });
  if (o.click) {                                    // mallet / skin impact noise
    let lp = 0; const k = o.clickK ?? 0.3, n = Math.min(N, Math.floor(sr * 0.04));
    for (let i = 0; i < n; i++) { lp += k * ((r() * 2 - 1) - lp); out[i] += lp * o.click * Math.exp(-i / (sr * 0.004)); }
  }
  if (o.sat) for (let i = 0; i < N; i++) out[i] = Math.tanh(out[i] * o.sat) / Math.tanh(o.sat);
  const m = Math.min(N, o.attack ?? 24);
  for (let i = 0; i < m; i++) out[i] *= i / m;
  return normalize(out, 0.7);
}
const modal = (id, o, spec) => bufferInstrument(id, (m, sr) => renderModal(m, sr, o), spec);

// ---------------------------------------------------------------- plucked strings, world flavours
const pluck = (id, o, spec, post) => bufferInstrument(id, (m, sr) => {
  let d = renderPluck(m, sr, o);
  if (o.double) { const b = renderPluck(m + o.double, sr, o); for (let i = 0; i < d.length; i++) d[i] = d[i] * 0.6 + b[i] * 0.55; }
  if (o.octave) { const b = renderPluck(m + 12.06, sr, { ...o, t60: o.t60 * 0.7 }); for (let i = 0; i < d.length; i++) d[i] = d[i] * 0.75 + b[i] * 0.4; }
  if (post) post(d, m, sr);
  return normalize(d, 0.8);
}, spec);

const sitarPost = (d, m, sr) => {                  // jawari buzz: the string rests on a curved bridge, so the tone is edgy and rich
  const k = 3.2;
  for (let i = 0; i < d.length; i++) { const t = i / sr, g = 1 + 2.5 * Math.exp(-t * 1.2); d[i] = Math.tanh(d[i] * k * g) / Math.tanh(k * g); }
  // sympathetic strings shimmer underneath
  const f = mtof(m) * 1.5, w = (2 * Math.PI * f) / sr;
  for (let i = 0; i < d.length; i++) d[i] += 0.05 * Math.sin(w * i) * Math.exp(-i / (sr * 1.6)) * Math.min(1, i / 4000);
};
const shamisenPost = (d, m, sr) => {                // bachi strike: a snappy click against the skin
  const r = rng(m * 3 + 11); let lp = 0;
  for (let i = 0; i < Math.min(d.length, 900); i++) { lp += 0.45 * ((r() * 2 - 1) - lp); d[i] += lp * 0.35 * Math.exp(-i / 120); }
};
const kotoPost = (d, m, sr) => {                    // koto: the pitch is pushed up a little just after the pluck
  const N = d.length, out = new Float32Array(N);
  const bend = (i) => 1 + 0.012 * Math.exp(-i / (sr * 0.08));
  let pos = 0;
  for (let i = 0; i < N; i++) { const j = Math.floor(pos), fr = pos - j; out[i] = (d[j] || 0) * (1 - fr) + (d[j + 1] || 0) * fr; pos += bend(i); if (pos >= N - 2) break; }
  d.set(out);
};
const softPiano = (d, sr, k) => { let lp = 0; for (let i = 0; i < d.length; i++) { lp += k * (d[i] - lp); d[i] = lp; } };

// ---------------------------------------------------------------- cinematic / effect voices (no pitch tracking needed)
function braamFx(ctx, out, t, midi, vel, P) {            // giant brass blast with a slow bloom (the "Inception" sound)
  const f = mtof(midi), v = vel / 127;
  const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.Q.value = 3;
  flt.frequency.setValueAtTime(260, t); flt.frequency.exponentialRampToValueAtTime(clamp(f * 14, 1500, 7000), t + 0.7); flt.frequency.setTargetAtTime(clamp(f * 5, 600, 3000), t + 0.7, 1.2);
  const sources = [];
  for (const [ratio, det, g] of [[1, -14, 0.8], [1, 0, 0.8], [1, 14, 0.8], [0.5, 0, 0.9], [2, 7, 0.35]]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * ratio; o.detune.value = det;
    const gg = ctx.createGain(); gg.gain.value = g; o.connect(gg); gg.connect(flt); o.start(t); sources.push(o);
  }
  const ws = ctx.createWaveShaper(); ws.curve = satCurve(2.2);
  const amp = ctx.createGain(), rel = amp;
  amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(0.5 * velAmp(v, 0.5), t + tm(0.06, P.attack)); amp.gain.setTargetAtTime(0.28 * velAmp(v, 0.5), t + 0.2, 1.4);
  flt.connect(ws); ws.connect(amp); amp.connect(out);
  return new Voice(ctx, rel, sources, tm(1.6, P.release));
}
function impactFx(ctx, out, t, midi, vel, P) {            // a big cinematic hit: sub boom + noise crash + falling tone
  const f = mtof(midi), v = vel / 127, D = tm(2.4, P.release);
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(clamp(f * 1.2, 40, 160), t); o.frequency.exponentialRampToValueAtTime(clamp(f * 0.3, 22, 50), t + D);
  const og = ctx.createGain(); og.gain.setValueAtTime(0.8 * velAmp(v, 0.5), t); og.gain.setTargetAtTime(0, t + 0.02, D / 4);
  const n = ctx.createBufferSource(); n.buffer = noiseBuf(ctx);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(7000, t); lp.frequency.exponentialRampToValueAtTime(300, t + D);
  const ng = ctx.createGain(); ng.gain.setValueAtTime(0.5 * velAmp(v, 0.5), t); ng.gain.setTargetAtTime(0, t + 0.01, D / 5);
  const amp = ctx.createGain(), rel = amp;
  o.connect(og); og.connect(amp); n.connect(lp); lp.connect(ng); ng.connect(amp); amp.connect(out);
  o.start(t); n.start(t); n.stop(t + 2);
  return new Voice(ctx, rel, [o], 0.15, t + D * 1.6 + 0.2);
}
function revCymbalFx(ctx, out, t, midi, vel, P) {         // swelling reverse-cymbal wash that builds to the end of the note
  const v = vel / 127, D = tm(2.0, P.attack);
  const n = ctx.createBufferSource(); n.buffer = noiseBuf(ctx); n.loop = true;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.setValueAtTime(1500, t); hp.frequency.exponentialRampToValueAtTime(6500, t + D);
  const sh = ctx.createBiquadFilter(); sh.type = 'peaking'; sh.frequency.value = 7500; sh.gain.value = 8; sh.Q.value = 0.8;
  const amp = ctx.createGain(), rel = amp;
  amp.gain.setValueAtTime(0.02, t); amp.gain.exponentialRampToValueAtTime(0.75 * velAmp(v, 0.5), t + D);
  n.connect(hp); hp.connect(sh); sh.connect(amp); amp.connect(out); n.start(t);
  return new Voice(ctx, rel, [n], 0.04);
}
function heartbeatFx(ctx, out, t, midi, vel, P) {         // slow double thump: "lub-dub"
  const f = clamp(mtof(midi) * 0.5, 38, 80), v = vel / 127, sources = [];
  const amp = ctx.createGain(), rel = amp; amp.connect(out);
  for (const [dt, g] of [[0, 1], [0.21, 0.7], [1.05, 1], [1.26, 0.7]]) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f * 2.2, t + dt); o.frequency.exponentialRampToValueAtTime(f, t + dt + 0.07);
    const gg = ctx.createGain(); gg.gain.setValueAtTime(0, t + dt); gg.gain.linearRampToValueAtTime(0.7 * g * velAmp(v, 0.5), t + dt + 0.008); gg.gain.setTargetAtTime(0, t + dt + 0.01, 0.07);
    o.connect(gg); gg.connect(amp); o.start(t + dt); o.stop(t + dt + 0.6); sources.push(o);
  }
  return new Voice(ctx, rel, [sources[0]], 0.1, t + 1.9);
}
function whooshFx(ctx, out, t, midi, vel, P) {            // quick filtered-air sweep
  const f = mtof(midi), v = vel / 127, D = tm(0.9, P.attack);
  const n = ctx.createBufferSource(); n.buffer = noiseBuf(ctx); n.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.2;
  bp.frequency.setValueAtTime(clamp(f * 2, 200, 1500), t); bp.frequency.exponentialRampToValueAtTime(clamp(f * 20, 2500, 9000), t + D * 0.45); bp.frequency.exponentialRampToValueAtTime(clamp(f * 3, 300, 2000), t + D);
  const amp = ctx.createGain(), rel = amp;
  amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(0.9 * velAmp(v, 0.5), t + D * 0.4); amp.gain.linearRampToValueAtTime(0, t + D);
  n.connect(bp); bp.connect(amp); amp.connect(out); n.start(t); n.stop(t + D + 0.05);
  return new Voice(ctx, rel, [n], 0.05, t + D + 0.1);
}

// ---------------------------------------------------------------- instrument definitions
const strBody = [[300, 4, 1.8], [1500, 2, 1.2]];
const defs = [];
const add = (cat, sub, id, name, desc, start, extra = {}) => defs.push({ id, name, cat, sub, icon: 'wave', desc, start, ...extra });

// ---- Keys
add('Keys', 'Pianos', 'honkytonk', 'Honky-Tonk Piano', 'Saloon piano — strings tuned slightly apart', bufferInstrument('honkytonk', (m, sr) => { const a = renderPiano(m, sr), b = renderPiano(m + 0.22, sr); const d = new Float32Array(Math.min(a.length, b.length)); for (let i = 0; i < d.length; i++) d[i] = a[i] * 0.6 + b[i] * 0.6; return normalize(d, 0.75); }, { lp: 11000, level: 0.85, r: 0.2 }), { icon: 'piano' });
add('Keys', 'Pianos', 'feltpiano', 'Felt Piano', 'Soft, muted, intimate piano', bufferInstrument('feltpiano', (m, sr) => { const d = renderPiano(m, sr); softPiano(d, sr, clamp(0.12 + (m - 36) / 140, 0.1, 0.5)); const f = 700; for (let i = 0; i < Math.min(d.length, f); i++) d[i] *= i / f; return normalize(d, 0.75); }, { lp: 4200, level: 0.7, r: 0.25 }), { icon: 'piano' });
add('Keys', 'Pianos', 'dynorhodes', 'Bright Rhodes', 'Barky, bell-like electric piano',
  synth2Fm({ modRatio: 1, index: 3.1, idxEnd: 0.12, idxT: 0.35, tine: { ratio: 14, idx: 1.5, t: 0.03 }, amp: { a: 0.003, tau: 2.2, s: 0.04, r: 0.3 }, level: 0.3 }), { icon: 'piano' });
add('Keys', 'Bells & mallets', 'tubular', 'Tubular Bells', 'Big orchestral chimes with a long ring', modal('tubular', { dur: 5, ratios: [1, 2.0, 3.0, 4.1, 5.4, 7.2], amps: [1, 0.55, 0.6, 0.3, 0.22, 0.1], decays: [3.6, 2.9, 3.2, 1.8, 1.2, 0.7], click: 0.35, beat: 0.9 }, { lp: 11000, level: 0.8, r: 0.9 }), { icon: 'mallet' });
add('Keys', 'Bells & mallets', 'crotales', 'Crotales', 'Tiny, bright, glassy cymbal bells', modal('crotales', { dur: 4.2, shift: 24, ratios: [1, 2.76, 5.4, 8.9], amps: [1, 0.5, 0.28, 0.14], decays: [3.2, 1.6, 0.8, 0.4], click: 0.3 }, { lp: 16000, level: 0.6, r: 0.8 }), { icon: 'mallet' });
add('Keys', 'Organs & reeds', 'voxorgan', 'Vox Organ', 'Garage-rock combo organ with a reedy edge', synth2({ oscs: [SQ({ gain: 1 }), SQ({ ratio: 2, gain: 0.45 }), SIN({ ratio: 0.5, gain: 0.5 }), SQ({ ratio: 4, gain: 0.15 })], level: 0.17, filter: { f: 4800, q: 0.7 }, amp: { a: 0.01, s: 1, r: 0.07 }, vib: { rate: 6, depth: 5, delay: 0 }, click: 0.12, humanize: 1 }), { icon: 'organ' });
add('Keys', 'Organs & reeds', 'harmonium', 'Harmonium', 'Warm hand-pumped reed organ', synth2({ oscs: [SAW({ detune: -5, gain: 0.7 }), SAW({ detune: 5, gain: 0.7 }), SQ({ ratio: 2, gain: 0.2 })], level: 0.3, filter: { f: 1900, q: 0.8, keytrack: 0.3 }, amp: { a: 0.07, s: 1, r: 0.13 }, body: [[600, 3, 1.5]], tremolo: { rate: 3.2, depth: 0.06 } }), { icon: 'organ', sustain: true });
add('Keys', 'Organs & reeds', 'melodica', 'Melodica', 'Breathy blown keyboard', synth2({ oscs: [SAW({ gain: 0.8 }), SQ({ gain: 0.5, detune: 5 })], level: 0.2, filter: { f: 3000, q: 1, keytrack: 0.4 }, amp: { a: 0.035, s: 1, r: 0.09 }, vib: { rate: 5.2, depth: 4, delay: 0.4 }, noise: { level: 0.035, q: 2, ratio: 2 }, chiff: 0.25, body: [[1400, 3, 1.5]] }), { icon: 'organ', sustain: true });
add('Keys', 'Organs & reeds', 'glassharm', 'Glass Harmonica', 'Ethereal rubbed-glass tones', synth2({ oscs: [SIN({ gain: 1 }), SIN({ ratio: 2.01, gain: 0.3, detune: 4 }), SIN({ detune: 8, gain: 0.5 }), SIN({ ratio: 3.02, gain: 0.08 })], level: 0.28, filter: { f: 5200, q: 0.6 }, amp: { a: 0.35, s: 1, r: 0.9 }, vib: { rate: 4.4, depth: 4, delay: 0.5 }, tremolo: { rate: 5.5, depth: 0.1 } }), { icon: 'pad', sustain: true });

// ---- Plucked
add('Plucked', 'Strummed', 'ukulele', 'Ukulele', 'Sunny, bright little four-string', pluck('ukulele', { dur: 1.6, t60: 0.8, bright: 0.55, damp: 0.5, pos: 0.16 }, { lp: 5200, level: 1.8, r: 0.15 }), { icon: 'guitar' });
add('Plucked', 'Strummed', 'twelve', '12-String Guitar', 'Shimmering doubled strings', pluck('twelve', { dur: 3.4, t60: 2.8, bright: 0.65, damp: 0.5, pos: 0.14, octave: true }, { lp: 7000, level: 1.4, r: 0.3 }), { icon: 'guitar' });
add('Plucked', 'Strummed', 'resonator', 'Resonator Guitar', 'Metallic, twangy slide-blues tone', pluck('resonator', { dur: 2.8, t60: 1.6, bright: 0.85, damp: 0.5, pos: 0.1 }, { lp: 5000, level: 1.6, r: 0.2, drive: 1.2 }), { icon: 'guitar' });
add('Plucked', 'Strummed', 'lute', 'Lute', 'Soft, old-world gut strings', pluck('lute', { dur: 2.6, t60: 1.3, bright: 0.3, damp: 0.55, pos: 0.2, double: 0.1 }, { lp: 3400, level: 1.3, r: 0.2 }), { icon: 'guitar' });
add('Plucked', 'Strummed', 'dulcimer', 'Hammered Dulcimer', 'Shimmering struck strings', pluck('dulcimer', { dur: 3.2, t60: 2.0, bright: 1.0, damp: 0.5, pos: 0.3, double: 0.13 }, { lp: 8500, level: 2.0, r: 0.35 }), { icon: 'guitar' });
add('Plucked', 'Strummed', 'bouzouki', 'Bouzouki', 'Bright Greek doubled courses', pluck('bouzouki', { dur: 1.9, t60: 1.1, bright: 0.9, damp: 0.5, pos: 0.1, double: 0.08 }, { lp: 7200, level: 2.2, r: 0.14 }), { icon: 'guitar' });

// ---- Bass
add('Bass', 'Acoustic & electric', 'fretless', 'Fretless Bass', 'Smooth, singing fretless', bufferInstrument('fretless', (m, sr) => renderPluck(m, sr, { dur: 2.8, t60: 2.4, bright: 0.28, damp: 0.5, pos: 0.32 }), { lp: 2000, level: 1.4, r: 0.14 }), { icon: 'bass' });
add('Bass', 'Synth', 'moogbass', 'Moog Bass', 'Round, punchy analog bass', synth2({ oscs: [SAW({ gain: 0.9 }), SQ({ gain: 0.6, detune: -4 }), SIN({ ratio: 0.5, gain: 0.7 })], level: 0.3, filter: { f: 480, q: 4.5, env: 4, envT: 0.18, keytrack: 0.4 }, amp: { a: 0.004, s: 0.8, d: 0.4, r: 0.1 }, humanize: 1 }), { icon: 'bass' });

// ---- Orchestral strings
add('Orchestral', 'Strings', 'viola', 'Viola', 'Dark, woody solo viola', synth2({ oscs: [SAW({ detune: -3, gain: 0.7 }), SAW({ detune: 3, gain: 0.7 }), TRI({ gain: 0.3 })], level: 0.17, filter: { f: 3000, q: 0.8, keytrack: 0.5 }, amp: { a: 0.15, s: 1, r: 0.25 }, vib: { rate: 5.6, depth: 9, delay: 0.3 }, body: [[260, 4, 2], [900, 2, 1.5]] }), { icon: 'violin', sustain: true });
add('Orchestral', 'Strings', 'doublebass', 'Double Bass (Arco)', 'Bowed, deep orchestral bass', synth2({ oscs: [SAW({ gain: 0.8 }), SAW({ detune: 5, gain: 0.5 }), SQ({ ratio: 0.5, gain: 0.3 })], level: 0.22, filter: { f: 900, q: 0.8, keytrack: 0.3 }, amp: { a: 0.2, s: 1, r: 0.3 }, vib: { rate: 4.6, depth: 5, delay: 0.4 }, body: [[85, 4, 1.5], [190, 2, 1]] }), { icon: 'bass', sustain: true });
add('Orchestral', 'Strings', 'stacstrings', 'Staccato Strings', 'Short, precise string section stabs', synth2({ oscs: [-9, 0, 9].map((d) => SAW({ detune: d, gain: 0.8 })), level: 0.5, filter: { f: 2800, q: 1, env: 2.2, envT: 0.08, keytrack: 0.5 }, amp: { a: 0.012, d: 0.1, s: 0.05, r: 0.08 }, pluck: true, body: strBody }), { icon: 'violin' });
add('Orchestral', 'Strings', 'tremstrings', 'Tremolo Strings', 'Shivering, suspenseful bowed tremolo', synth2({ oscs: [-9, 0, 9].map((d) => SAW({ detune: d, gain: 0.8 })), level: 0.2, filter: { f: 2600, q: 0.8, keytrack: 0.5 }, amp: { a: 0.12, s: 1, r: 0.35 }, tremolo: { rate: 9.5, depth: 0.7 }, body: strBody }), { icon: 'violin', sustain: true });
add('Orchestral', 'Strings', 'mellostrings', 'Tape Strings', 'Vintage tape-string keyboard, a bit wobbly', synth2({ oscs: [SAW({ detune: -6, gain: 0.7 }), SAW({ detune: 6, gain: 0.7 }), SAW({ ratio: 2, gain: 0.12 })], level: 0.3, filter: { f: 2300, q: 0.7, keytrack: 0.3 }, amp: { a: 0.03, s: 1, r: 0.35 }, vib: { rate: 0.7, depth: 10, delay: 0 }, drive: 1.2, body: [[1000, 2, 1]], humanize: 8 }), { icon: 'violin', sustain: true });
// ---- Orchestral brass
add('Orchestral', 'Brass', 'trombone', 'Trombone', 'Big, smooth slide brass', synth2({ oscs: [SAW({ gain: 0.9 }), SAW({ detune: -3, gain: 0.5 }), SQ({ ratio: 0.5, gain: 0.15 })], level: 0.2, filter: { f: 900, q: 1, env: 3.5, fa: 0.06, envT: 0.25, keytrack: 0.5, velAmt: 0.5 }, amp: { a: 0.05, s: 1, r: 0.12 }, scoop: { cents: -60, t: 0.07 }, vib: { rate: 5, depth: 4, delay: 0.5 }, body: [[500, 3, 2], [1500, 2, 1.5]] }), { icon: 'horn', sustain: true });
add('Orchestral', 'Brass', 'tuba', 'Tuba', 'Low, round and powerful', synth2({ oscs: [SAW({ gain: 0.8 }), SQ({ ratio: 0.5, gain: 0.5 })], level: 0.24, filter: { f: 480, q: 0.9, env: 2.5, fa: 0.07, envT: 0.2, keytrack: 0.4 }, amp: { a: 0.06, s: 1, r: 0.14 }, vib: { rate: 4.8, depth: 3, delay: 0.5 }, body: [[170, 4, 1.5], [420, 2, 1.5]] }), { icon: 'horn', sustain: true });
add('Orchestral', 'Brass', 'brasshit', 'Brass Stabs', 'Short, punchy horn section hits', synth2({ oscs: [SAW({ detune: -6, gain: 0.9 }), SAW({ detune: 6, gain: 0.9 }), SAW({ ratio: 2, gain: 0.25 })], level: 0.5, filter: { f: 1500, q: 1.2, env: 4, fa: 0.025, envT: 0.1, keytrack: 0.5, velAmt: 0.6 }, amp: { a: 0.012, d: 0.16, s: 0.12, r: 0.1 }, pluck: true, scoop: { cents: -45, t: 0.03 }, body: [[1200, 3, 1.5]] }), { icon: 'horn' });
add('Orchestral', 'Brass', 'orchhit', 'Orchestra Hit', 'The famous 80s sample-style orchestra stab', synth2({ oscs: [SAW({ gain: 0.8 }), SAW({ ratio: 2, gain: 0.7 }), SAW({ ratio: 1.5, gain: 0.7, detune: 6 }), SAW({ ratio: 3, gain: 0.35 }), SQ({ ratio: 0.5, gain: 0.5 })], level: 0.28, filter: { f: 3200, q: 1.2, env: 2.2, envT: 0.22, keytrack: 0.3 }, amp: { a: 0.004, d: 0.28, s: 0.02, r: 0.22 }, pluck: true, humanize: 12, body: [[900, 3, 1.2], [2800, 2, 1]] }), { icon: 'horn' });
// ---- Orchestral winds
add('Orchestral', 'Woodwinds', 'piccolo', 'Piccolo', 'Tiny, piercing flute an octave up', synth2({ shift: 12, oscs: [SIN({ gain: 1 }), TRI({ ratio: 2, gain: 0.15 })], level: 0.3, filter: { f: 7000, q: 0.6 }, amp: { a: 0.03, s: 1, r: 0.1 }, vib: { rate: 5.6, depth: 7, delay: 0.3 }, noise: { level: 0.045, q: 3, ratio: 2 }, chiff: 0.3 }), { icon: 'horn', sustain: true });
add('Orchestral', 'Woodwinds', 'bassoon', 'Bassoon', 'Woody, buzzing low reed', synth2({ oscs: [SQ({ gain: 0.8 }), SAW({ gain: 0.5 })], level: 0.18, filter: { f: 1000, q: 1.2, keytrack: 0.5 }, amp: { a: 0.05, s: 1, r: 0.1 }, vib: { rate: 5, depth: 4, delay: 0.5 }, noise: { level: 0.02, q: 2, ratio: 3 }, body: [[480, 5, 2], [1300, 3, 2]] }), { icon: 'horn', sustain: true });
add('Orchestral', 'Woodwinds', 'englishhorn', 'English Horn', 'Mournful, mellow double reed', synth2({ oscs: [SAW({ gain: 1 }), TRI({ ratio: 0.5, gain: 0.3 })], level: 0.45, filter: { type: 'bandpass', f: 950, q: 0.8, keytrack: 0.7 }, amp: { a: 0.07, s: 1, r: 0.14 }, vib: { rate: 5, depth: 7, delay: 0.35 }, noise: { level: 0.018, q: 2, ratio: 3 }, body: [[650, 4, 2]] }), { icon: 'horn', sustain: true });
add('Orchestral', 'Woodwinds', 'sopsax', 'Soprano Sax', 'Sweet, reedy and bright', synth2({ oscs: [SAW({ gain: 0.8 }), SQ({ gain: 0.4, detune: 5 })], level: 0.2, filter: { f: 3200, q: 1.8, env: 2, envT: 0.1, keytrack: 0.5 }, amp: { a: 0.04, s: 1, r: 0.1 }, vib: { rate: 5.8, depth: 7, delay: 0.3 }, noise: { level: 0.03, q: 1.5, ratio: 2 }, body: [[1500, 3, 2]] }), { icon: 'horn', sustain: true });
add('Orchestral', 'Woodwinds', 'harmonica', 'Harmonica', 'Bluesy hand-held reed', synth2({ oscs: [SQ({ gain: 0.8 }), SAW({ gain: 0.4, detune: 9 })], level: 0.18, filter: { f: 2700, q: 1.3, keytrack: 0.4 }, amp: { a: 0.03, s: 1, r: 0.08 }, vib: { rate: 5.2, depth: 6, delay: 0.25 }, noise: { level: 0.025, q: 2, ratio: 2 }, tremolo: { rate: 6, depth: 0.12 }, body: [[1800, 4, 1.8]] }), { icon: 'organ', sustain: true });
add('Orchestral', 'Woodwinds', 'recorder', 'Recorder', 'Pure, simple school-days flute', synth2({ shift: 12, oscs: [SIN({ gain: 1 }), SIN({ ratio: 3, gain: 0.04 })], level: 0.3, filter: { f: 5000, q: 0.6 }, amp: { a: 0.045, s: 1, r: 0.1 }, vib: { rate: 5, depth: 3, delay: 0.5 }, noise: { level: 0.025, q: 3, ratio: 2 }, chiff: 0.35 }), { icon: 'horn', sustain: true });
// ---- Orchestral percussion
add('Orchestral', 'Percussion', 'timpani', 'Timpani', 'Tuned orchestral kettle drum', modal('timpani', { dur: 2.6, shift: -12, ratios: [1, 1.5, 1.99, 2.44, 2.9], amps: [1, 0.55, 0.38, 0.2, 0.12], decays: [1.7, 0.9, 0.6, 0.4, 0.3], glide: 0.28, glideT: 0.06, click: 0.5, clickK: 0.2 }, { lp: 5000, level: 1.0, r: 0.25 }), { icon: 'drum' });
add('Orchestral', 'Percussion', 'taiko', 'Taiko', 'Huge Japanese war drum', modal('taiko', { dur: 1.8, shift: -17, ratios: [1, 1.59, 2.14, 2.65], amps: [1, 0.5, 0.3, 0.15], decays: [0.9, 0.4, 0.25, 0.15], glide: 0.45, glideT: 0.045, click: 0.9, clickK: 0.35, sat: 1.4 }, { lp: 4500, level: 0.6, r: 0.15 }), { icon: 'drum' });

// ---- Pads / voices
add('Pads', 'Choirs', 'boyschoir', 'Boys Choir', 'High, pure, cathedral voices', choir({ shift: 12, formant: 1.18, detunes: [-8, 0, 8], vib: 7, vibRate: 5.4, a: 0.22, r: 0.6, level: 0.1 }), { icon: 'voice', defaults: { tone: 0.25, attack: 0.5, release: 0.5 } });
add('Pads', 'Choirs', 'malechoir', 'Male Choir', 'Deep, powerful low voices', choir({ shift: -12, formant: 0.82, detunes: [-12, 0, 12], vib: 8, vibRate: 4.8, a: 0.3, r: 0.6, level: 0.12 }), { icon: 'voice', defaults: { tone: 0.55, attack: 0.5, release: 0.5 } });
add('Pads', 'Choirs', 'soprano', 'Soprano Solo', 'A single operatic voice with vibrato', choir({ formant: 1.12, detunes: [0, 5], vib: 18, vibRate: 5.7, a: 0.18, r: 0.45, level: 0.14, q: 7 }), { icon: 'voice', defaults: { tone: 0.7, attack: 0.5, release: 0.5 } });
add('Pads', 'Choirs', 'mellochoir', 'Tape Choir', 'Gritty vintage tape-choir keyboard', choir({ detunes: [-14, 0, 14], vib: 6, vibRate: 0.8, a: 0.04, r: 0.4, level: 0.11, tape: 2800 }), { icon: 'voice', defaults: { tone: 0.35, attack: 0.5, release: 0.5 } });
add('Pads', 'Tape', 'melloflute', 'Tape Flute', 'Breathy, wobbly vintage flute keyboard', synth2({ oscs: [SIN({ gain: 1 }), TRI({ ratio: 2, gain: 0.25 })], level: 0.34, filter: { f: 3200, q: 0.6 }, amp: { a: 0.025, s: 1, r: 0.3 }, vib: { rate: 0.8, depth: 14, delay: 0 }, noise: { level: 0.05, q: 1.5, ratio: 1.5 }, drive: 0.9, humanize: 8 }), { icon: 'pad', sustain: true });

// ---- World
add('World', 'Plucked & bowed', 'sitar', 'Sitar', 'Buzzing Indian sitar with sympathetic strings', pluck('sitar', { dur: 3.4, t60: 2.6, bright: 0.9, damp: 0.45, pos: 0.07 }, { lp: 9000, level: 0.75, r: 0.3 }, sitarPost), { icon: 'guitar' });
add('World', 'Plucked & bowed', 'oud', 'Oud', 'Warm Middle-Eastern lute', pluck('oud', { dur: 2.2, t60: 1.2, bright: 0.5, damp: 0.5, pos: 0.25, double: 0.09 }, { lp: 4300, level: 1.7, r: 0.18 }), { icon: 'guitar' });
add('World', 'Plucked & bowed', 'koto', 'Koto', 'Japanese zither with a pitch bend', pluck('koto', { dur: 2.6, t60: 1.5, bright: 0.8, damp: 0.5, pos: 0.1 }, { lp: 6800, level: 1.8, r: 0.25 }, kotoPost), { icon: 'guitar' });
add('World', 'Plucked & bowed', 'shamisen', 'Shamisen', 'Snappy three-string lute', pluck('shamisen', { dur: 1.5, t60: 0.7, bright: 1.0, damp: 0.5, pos: 0.06 }, { lp: 7800, level: 2.5, r: 0.1 }, shamisenPost), { icon: 'guitar' });
add('World', 'Plucked & bowed', 'kora', 'Kora', 'West-African harp-lute, rippling and clear', pluck('kora', { dur: 3.2, t60: 2.3, bright: 0.65, damp: 0.5, pos: 0.22 }, { lp: 5600, level: 1.4, r: 0.3 }), { icon: 'guitar' });
add('World', 'Plucked & bowed', 'balalaika', 'Balalaika', 'Bright Russian triangle-bodied lute', pluck('balalaika', { dur: 1.6, t60: 0.85, bright: 0.95, damp: 0.5, pos: 0.09, double: 0.06 }, { lp: 7400, level: 2.5, r: 0.12 }), { icon: 'guitar' });
add('World', 'Plucked & bowed', 'erhu', 'Erhu', 'Two-string Chinese fiddle, crying and expressive', synth2({ oscs: [SAW({ gain: 0.9 }), SQ({ gain: 0.3, detune: 4 })], level: 0.2, filter: { type: 'lowpass', f: 2600, q: 2.2, keytrack: 0.6 }, amp: { a: 0.1, s: 1, r: 0.22 }, vib: { rate: 5.8, depth: 16, delay: 0.2 }, scoop: { cents: -90, t: 0.1 }, noise: { level: 0.02, q: 2, ratio: 3 }, body: [[1150, 5, 2.5], [2500, 3, 2]] }), { icon: 'violin', sustain: true });
add('World', 'Winds', 'shakuhachi', 'Shakuhachi', 'Breathy Japanese bamboo flute', synth2({ oscs: [SIN({ gain: 1 }), TRI({ ratio: 2, gain: 0.08 })], level: 0.28, filter: { f: 3400, q: 0.7 }, amp: { a: 0.09, s: 1, r: 0.2 }, vib: { rate: 4.6, depth: 11, delay: 0.3 }, scoop: { cents: -120, t: 0.12 }, noise: { level: 0.2, q: 1.1, ratio: 1 }, chiff: 0.4 }), { icon: 'horn', sustain: true });
add('World', 'Winds', 'panflute', 'Pan Flute', 'Airy Andean pipes', synth2({ oscs: [SIN({ gain: 1 }), SIN({ ratio: 2, gain: 0.06 })], level: 0.3, filter: { f: 4500, q: 0.6 }, amp: { a: 0.05, s: 1, r: 0.13 }, vib: { rate: 5, depth: 5, delay: 0.5 }, noise: { level: 0.12, q: 2.5, ratio: 1.5 }, chiff: 0.35 }), { icon: 'horn', sustain: true });
add('World', 'Winds', 'ocarina', 'Ocarina', 'Pure, hollow clay whistle', synth2({ oscs: [SIN({ gain: 1 }), TRI({ ratio: 2, gain: 0.04 })], level: 0.32, filter: { f: 3200, q: 0.6 }, amp: { a: 0.06, s: 1, r: 0.12 }, vib: { rate: 5.2, depth: 6, delay: 0.4 }, noise: { level: 0.015, q: 3, ratio: 2 } }), { icon: 'horn', sustain: true });
add('World', 'Winds', 'duduk', 'Duduk', 'Armenian double reed — hauntingly warm', synth2({ oscs: [SAW({ gain: 0.9 }), SQ({ gain: 0.35, detune: 3 }), SIN({ ratio: 0.5, gain: 0.3 })], level: 0.26, filter: { f: 1500, q: 2.4, keytrack: 0.5 }, amp: { a: 0.09, s: 1, r: 0.2 }, vib: { rate: 5, depth: 9, delay: 0.4 }, noise: { level: 0.015, q: 2, ratio: 2 }, body: [[550, 5, 2.5], [1250, 3, 2]] }), { icon: 'horn', sustain: true });
add('World', 'Winds', 'bansuri', 'Bansuri', 'Warm Indian bamboo flute', synth2({ oscs: [SIN({ gain: 1 }), TRI({ ratio: 2, gain: 0.18 })], level: 0.3, filter: { f: 3800, q: 0.6 }, amp: { a: 0.08, s: 1, r: 0.18 }, vib: { rate: 5.4, depth: 12, delay: 0.3 }, scoop: { cents: -80, t: 0.1 }, noise: { level: 0.1, q: 1.4, ratio: 1.2 }, chiff: 0.25 }), { icon: 'horn', sustain: true });
add('World', 'Winds', 'didgeridoo', 'Didgeridoo', 'Droning Australian wooden horn', synth2({ shift: -12, oscs: [SQ({ gain: 0.9 }), SAW({ gain: 0.4 })], level: 0.26, filter: { f: 420, q: 4.5, keytrack: 0.2 }, lfoFilter: { rate: 2.1, depth: 1.1 }, amp: { a: 0.08, s: 1, r: 0.2 }, vib: { rate: 0.5, depth: 6, delay: 0 }, noise: { level: 0.02, q: 1.2, ratio: 3 }, body: [[300, 4, 2]] }), { icon: 'bass', sustain: true });
add('World', 'Struck & bowed percussion', 'handpan', 'Handpan', 'Hypnotic steel tongue drum', modal('handpan', { dur: 3.2, ratios: [1, 2.0, 3.01, 4.03], amps: [1, 0.6, 0.3, 0.14], decays: [2.4, 1.5, 0.8, 0.4], beat: 1.3, click: 0.25 }, { lp: 6500, level: 0.95, r: 0.4 }), { icon: 'mallet' });
add('World', 'Struck & bowed percussion', 'gender', 'Gamelan Gender', 'Balinese metal-bar instrument with shimmering pairs', modal('gender', { dur: 3.6, ratios: [1, 2.35, 4.6, 7.2], amps: [1, 0.4, 0.15, 0.07], decays: [2.6, 0.7, 0.2, 0.1], beat: 6, click: 0.3 }, { lp: 9000, level: 0.9, r: 0.45 }), { icon: 'mallet' });
add('World', 'Struck & bowed percussion', 'balafon', 'Balafon', 'West-African wooden xylophone with a buzz', modal('balafon', { dur: 1.5, ratios: [1, 2.9, 6.5], amps: [1, 0.5, 0.22], decays: [0.9, 0.2, 0.1], click: 0.5, sat: 2.2 }, { lp: 8000, level: 0.8, r: 0.12 }), { icon: 'mallet' });
add('World', 'Struck & bowed percussion', 'singingbowl', 'Singing Bowl', 'Long meditative bowl ring', modal('singingbowl', { dur: 7, shift: -12, flat: true, ratios: [1, 2.71, 5.15, 8.4], amps: [1, 0.55, 0.28, 0.12], decays: [6, 4, 2.6, 1.4], beat: 1.8, click: 0.15, attack: 120 }, { lp: 9500, level: 0.75, r: 1.2 }), { icon: 'mallet' });

// ---- Cinematic
add('Cinematic', 'Hits & textures', 'braam', 'Braam', 'Huge, blooming brass blast', braamFx, { icon: 'horn', sustain: true });
add('Cinematic', 'Hits & textures', 'impact', 'Impact', 'Giant trailer-style boom with a debris tail', impactFx, { icon: 'wave', sustain: true });
add('Cinematic', 'Hits & textures', 'heartbeat', 'Heartbeat', 'Slow, tense "lub-dub" pulse', heartbeatFx, { icon: 'drum', sustain: true });
add('Cinematic', 'Hits & textures', 'darkdrone', 'Dark Drone', 'Ominous, slowly breathing low drone', synth2({ oscs: [SAW({ detune: -10, gain: 0.7 }), SAW({ detune: 10, gain: 0.7 }), SAW({ ratio: 0.5, gain: 0.6 }), SQ({ ratio: 0.25, gain: 0.5 })], level: 0.5, filter: { f: 420, q: 1.5, keytrack: 0.3 }, lfoFilter: { rate: 0.09, depth: 1.3 }, amp: { a: 2.4, s: 1, r: 3 }, humanize: 12, noise: { level: 0.015, q: 0.7, ratio: 1.5 } }), { icon: 'pad', sustain: true });
add('Cinematic', 'Transitions', 'revcymbal', 'Reverse Cymbal', 'Swelling wash that builds to the downbeat', revCymbalFx, { icon: 'wave', sustain: true });
add('Cinematic', 'Transitions', 'whoosh', 'Whoosh', 'Quick air sweep for transitions', whooshFx, { icon: 'wave', sustain: true });

// FM e-piano helper (the classic fm() lives in instruments.js; this tiny wrapper keeps this file self-contained)
function synth2Fm(spec) {
  return function start(ctx, out, t, midi, vel, P) {
    const f = mtof(midi), v = vel / 127;
    const car = ctx.createOscillator(); car.type = 'sine'; car.frequency.value = f;
    const mod = ctx.createOscillator(); mod.type = 'sine'; mod.frequency.value = f * spec.modRatio;
    const mg = ctx.createGain();
    const idx = spec.index * (0.35 + 0.9 * v) * (0.45 + 1.1 * (P.tone ?? 0.5)) * f;
    mg.gain.setValueAtTime(idx, t); mg.gain.setTargetAtTime(idx * spec.idxEnd, t, spec.idxT);
    mod.connect(mg); mg.connect(car.frequency);
    const sources = [car, mod];
    const t2 = ctx.createOscillator(); t2.type = 'sine'; t2.frequency.value = f * spec.tine.ratio;
    const tg = ctx.createGain(); tg.gain.setValueAtTime(spec.tine.idx * v * f, t); tg.gain.setTargetAtTime(0, t, spec.tine.t);
    t2.connect(tg); tg.connect(car.frequency); t2.start(t); sources.push(t2);
    const A = tm(spec.amp.a, P.attack), R = tm(spec.amp.r, P.release);
    const amp = ctx.createGain(), rel = amp;
    const peak = spec.level * velAmp(v, 0.3), tau = spec.amp.tau * Math.pow(261.63 / f, 0.4);
    amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(peak, t + A); amp.gain.setTargetAtTime(peak * spec.amp.s, t + A, tau);
    car.connect(amp); amp.connect(out); car.start(t); mod.start(t);
    return new Voice(ctx, rel, sources, R);
  };
}

// ---------------------------------------------------------------- register
const CATS_AFTER = { World: 'Orchestral', Cinematic: 'World' };
for (const [cat, after] of Object.entries(CATS_AFTER)) if (!INST_CATS.includes(cat)) INST_CATS.splice(INST_CATS.indexOf(after) + 1, 0, cat);
for (const d of defs) {
  if (INST_BY_ID[d.id]) continue;
  INSTRUMENTS.push(d); INST_BY_ID[d.id] = d;
}
export const EXTRA_INSTRUMENT_IDS = defs.map((d) => d.id);
