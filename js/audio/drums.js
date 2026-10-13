// Drum kit synthesis. Every pad is built from oscillators + noise inside an OfflineAudioContext and
// rendered once into an AudioBuffer, so playing a drum hit is just a cheap buffer source.
import { rng } from '../util.js';

export const PAD_BASE = 36;
export const PAD_NAMES = ['Kick', 'Kick 2', 'Snare', 'Rim', 'Clap', 'Hat', 'Hat 2', 'Open Hat', 'Tom Lo', 'Tom Mid', 'Tom Hi', 'Crash', 'Ride', 'Cowbell', 'Shaker', 'Snap'];
/** Pad label for a kit (percussion kits rename the 16 pads). */
export const padName = (kitId, i) => { const k = KIT_BY_ID[kitId]; return (k && k.names && k.names[i]) || PAD_NAMES[i]; };
// short names used by the loop library
export const PAD = { kick: 0, kick2: 1, snare: 2, rim: 3, clap: 4, hat: 5, hat2: 6, ohat: 7, tomL: 8, tomM: 9, tomH: 10, crash: 11, ride: 12, bell: 13, shaker: 14, snap: 15 };
// General-MIDI note numbers for MIDI export
export const PAD_GM = [36, 35, 38, 37, 39, 42, 44, 46, 41, 45, 48, 49, 51, 56, 70, 54];
// choke groups: closed hat cuts open hat and vice-versa
export const PAD_CHOKE = { 5: 'hat', 6: 'hat', 7: 'hat' };

const LEVEL = [0.95, 0.9, 0.85, 0.6, 0.8, 0.5, 0.5, 0.5, 0.85, 0.85, 0.85, 0.55, 0.5, 0.6, 0.45, 0.6];

let noiseCache = new Map();
function noise(c, dur, seed = 7) {
  const n = Math.ceil(c.sampleRate * dur);
  const b = c.createBuffer(1, n, c.sampleRate);
  const d = b.getChannelData(0);
  const r = rng(seed);
  for (let i = 0; i < n; i++) d[i] = r() * 2 - 1;
  return b;
}
function noiseSrc(c, dur, seed) {
  const s = c.createBufferSource();
  s.buffer = noise(c, dur, seed);
  return s;
}
function satCurve(amount) {
  const n = 2048;
  const k = 1 + amount * 2.2;
  const cv = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; cv[i] = Math.tanh(k * x) / norm; }
  return cv;
}
function filt(c, type, f, q = 0.707) {
  const b = c.createBiquadFilter();
  b.type = type; b.frequency.value = f; b.Q.value = q;
  return b;
}
function gainEnv(c, peak, attack, tau) {
  const g = c.createGain();
  g.gain.setValueAtTime(0, 0);
  g.gain.linearRampToValueAtTime(peak, Math.max(attack, 0.0005));
  g.gain.setTargetAtTime(0, Math.max(attack, 0.0005), tau);
  return g;
}

// ---------------------------------------------------------------- pad generators
const GEN = {
  kick(c, out, p) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(p.fStart, 0);
    o.frequency.exponentialRampToValueAtTime(p.f0, p.pitchT);
    const g = gainEnv(c, 1, 0.002, p.decay / 5);
    o.connect(g);
    let node = g;
    if (p.drive > 0) { const ws = c.createWaveShaper(); ws.curve = satCurve(p.drive); g.connect(ws); node = ws; }
    node.connect(out);
    o.start(0); o.stop(p.len);
    if (p.click > 0) {
      const n = noiseSrc(c, 0.03, 3);
      const hp = filt(c, 'highpass', 2200);
      const cg = c.createGain();
      cg.gain.setValueAtTime(p.click * 0.45, 0);
      cg.gain.exponentialRampToValueAtTime(0.0001, 0.011);
      n.connect(hp); hp.connect(cg); cg.connect(out); n.start(0);
      // beater thump
      const t = c.createOscillator(); t.type = 'triangle';
      t.frequency.setValueAtTime(p.fStart * 1.6, 0); t.frequency.exponentialRampToValueAtTime(p.f0 * 1.4, 0.02);
      const tg = c.createGain(); tg.gain.setValueAtTime(p.click * 0.5, 0); tg.gain.exponentialRampToValueAtTime(0.0001, 0.035);
      t.connect(tg); tg.connect(out); t.start(0); t.stop(0.05);
    }
  },
  snare(c, out, p) {
    for (const [ratio, level] of [[1, 0.85], [1.62, 0.3]]) {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(p.tone * ratio * 1.45, 0);
      o.frequency.exponentialRampToValueAtTime(p.tone * ratio, 0.025);
      const g = gainEnv(c, level * (p.body ?? 1), 0.001, p.toneDecay / 4);
      o.connect(g); g.connect(out); o.start(0); o.stop(p.len);
    }
    const n = noiseSrc(c, p.len + 0.05, 11);
    const hp = filt(c, 'highpass', p.hp);
    const bp = filt(c, 'peaking', p.peak ?? 4500, 0.8); bp.gain.value = 5;
    const g = gainEnv(c, p.noise, 0.001, p.noiseDecay / 4.2);
    n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(out); n.start(0);
  },
  rim(c, out, p) {
    for (const [f, lv] of [[1750, 0.55], [480, 0.7]]) {
      const o = c.createOscillator(); o.type = 'sine';
      o.frequency.value = f * (p.pitch ?? 1);
      const g = gainEnv(c, lv, 0.0005, 0.011);
      o.connect(g); g.connect(out); o.start(0); o.stop(0.2);
    }
    const n = noiseSrc(c, 0.1, 5);
    const bp = filt(c, 'bandpass', 3200, 1.4);
    const g = gainEnv(c, 0.7, 0.0005, 0.009);
    n.connect(bp); bp.connect(g); g.connect(out); n.start(0);
  },
  clap(c, out, p) {
    const n = noiseSrc(c, p.len + 0.1, 17);
    const bp = filt(c, 'bandpass', p.freq, p.q);
    const hp = filt(c, 'highpass', 450);
    const g = c.createGain();
    const T = [0, 0.011, 0.023, 0.036];
    g.gain.setValueAtTime(0.0001, 0);
    T.forEach((t, i) => {
      g.gain.linearRampToValueAtTime(1, t + 0.0012);
      if (i < T.length - 1) g.gain.exponentialRampToValueAtTime(0.25, T[i + 1] - 0.0005);
    });
    g.gain.exponentialRampToValueAtTime(0.0001, T[T.length - 1] + p.decay);
    n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(out); n.start(0);
  },
  hat(c, out, p) {
    const freqs = [205.3, 304.4, 369.6, 522.7, 540, 800];
    const sum = c.createGain();
    sum.gain.value = (p.metal ?? 1) * 0.5;
    for (const f of freqs) {
      const o = c.createOscillator(); o.type = 'square';
      o.frequency.value = f * (p.pitch ?? 1);
      o.connect(sum); o.start(0); o.stop(p.len);
    }
    const hp = filt(c, 'highpass', p.hp, 0.9);
    const bp = filt(c, 'bandpass', p.bp, 0.7);
    // open hats: quick drop then a longer shimmering tail
    const g = c.createGain();
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(1, 0.001);
    if (p.tail) {
      g.gain.setTargetAtTime(0.35, 0.001, 0.02);
      g.gain.setTargetAtTime(0, 0.06, p.decay / 4.6);
    } else g.gain.setTargetAtTime(0, 0.001, p.decay / 4.6);
    sum.connect(hp); hp.connect(bp); bp.connect(g);
    if (p.noise > 0) {
      const n = noiseSrc(c, p.len + 0.05, 23);
      const nh = filt(c, 'highpass', p.hp * 0.9);
      const ng = c.createGain(); ng.gain.value = p.noise;
      n.connect(nh); nh.connect(ng); ng.connect(g); n.start(0);
    }
    g.connect(out);
  },
  tom(c, out, p) {
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(p.f * (p.sweep ?? 2.2), 0);
    o.frequency.exponentialRampToValueAtTime(p.f, p.sweepT ?? 0.07);
    const g = gainEnv(c, 1, 0.001, p.decay / 4.6);
    const ws = c.createWaveShaper(); ws.curve = satCurve(p.drive ?? 0.5);
    o.connect(g); g.connect(ws); ws.connect(out); o.start(0); o.stop(p.len);
    const n = noiseSrc(c, 0.05, 9);
    const bp = filt(c, 'bandpass', 1800, 0.9);
    const ng = gainEnv(c, 0.35, 0.0005, 0.008);
    n.connect(bp); bp.connect(ng); ng.connect(out); n.start(0);
  },
  crash(c, out, p) {
    const n = noiseSrc(c, p.len + 0.1, 31);
    const hp = filt(c, 'highpass', 3500);
    const g = c.createGain();
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(1, 0.003);
    g.gain.setTargetAtTime(0.4, 0.003, 0.05);
    g.gain.setTargetAtTime(0, 0.12, p.decay / 4.6);
    n.connect(hp); hp.connect(g);
    const sum = c.createGain(); sum.gain.value = 0.25;
    for (const f of [296, 417, 566, 783, 905, 1313]) {
      const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f * 1.9; o.connect(sum); o.start(0); o.stop(p.len);
    }
    const sh = filt(c, 'highpass', 4500);
    sum.connect(sh); sh.connect(g); g.connect(out); n.start(0);
  },
  ride(c, out, p) {
    const sum = c.createGain(); sum.gain.value = 0.18;
    for (const f of [296, 417, 566, 783, 905, 1313]) {
      const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f * 2.1; o.connect(sum); o.start(0); o.stop(p.len);
    }
    const bp = filt(c, 'bandpass', 8200, 0.8);
    const g = c.createGain();
    g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(1, 0.001);
    g.gain.setTargetAtTime(0.25, 0.001, 0.03); g.gain.setTargetAtTime(0, 0.1, p.decay / 4.6);
    sum.connect(bp); bp.connect(g); g.connect(out);
    const b = c.createOscillator(); b.type = 'sine'; b.frequency.value = 3700;
    const bg = gainEnv(c, 0.35, 0.0005, 0.07);
    b.connect(bg); bg.connect(out); b.start(0); b.stop(0.5);
  },
  cowbell(c, out, p) {
    const bp = filt(c, 'bandpass', 2640 * (p.pitch ?? 1), 0.9);
    const g = c.createGain();
    g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(1, 0.001);
    g.gain.setTargetAtTime(0.35, 0.001, 0.012); g.gain.setTargetAtTime(0, 0.04, 0.09);
    for (const f of [540, 800.3]) {
      const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f * (p.pitch ?? 1);
      o.connect(bp); o.start(0); o.stop(p.len);
    }
    bp.connect(g); g.connect(out);
  },
  shaker(c, out, p) {
    const n = noiseSrc(c, p.len + 0.05, 41);
    const bp = filt(c, 'bandpass', p.freq ?? 6800, 0.6);
    const g = c.createGain();
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(1, p.attack ?? 0.016);
    g.gain.setTargetAtTime(0, (p.attack ?? 0.016) + 0.002, p.decay / 4.2);
    n.connect(bp); bp.connect(g); g.connect(out); n.start(0);
  },
  snap(c, out, p) {
    const n = noiseSrc(c, 0.2, 53);
    const bp = filt(c, 'bandpass', 1900, 3);
    const g = c.createGain();
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(1, 0.0008);
    g.gain.setTargetAtTime(0.2, 0.0008, 0.003);
    g.gain.setTargetAtTime(0, 0.012, 0.022);
    n.connect(bp); bp.connect(g); g.connect(out); n.start(0);
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(2400, 0); o.frequency.exponentialRampToValueAtTime(900, 0.02);
    const og = gainEnv(c, 0.35, 0.0005, 0.008);
    o.connect(og); og.connect(out); o.start(0); o.stop(0.1);
  },
  // ---- hand drums / struck metal / brushes (used by the percussion kits)
  skin(c, out, p) {                                   // a drum skin: pitched thump + overtone ring + hand/stick slap
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(p.f * (p.sweep ?? 1.25), 0);
    o.frequency.exponentialRampToValueAtTime(p.f, p.sweepT ?? 0.03);
    const g = gainEnv(c, 1, 0.0008, p.decay / 4.6);
    let tail = g;
    if (p.drive) { const ws = c.createWaveShaper(); ws.curve = satCurve(p.drive); g.connect(ws); tail = ws; }
    const lp = filt(c, 'lowpass', p.lp ?? 7000, 0.7);
    o.connect(g); tail.connect(lp); lp.connect(out); o.start(0); o.stop(p.len);
    if (p.ring) {
      const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.setValueAtTime(p.f * 1.59 * (p.sweep ?? 1.25), 0); o2.frequency.exponentialRampToValueAtTime(p.f * 1.59, p.sweepT ?? 0.03);
      const g2 = gainEnv(c, p.ring, 0.001, p.decay / 7); o2.connect(g2); g2.connect(lp); o2.start(0); o2.stop(p.len);
    }
    if (p.slap) {
      const n = noiseSrc(c, 0.12, 61);
      const bp = filt(c, 'bandpass', p.slapF ?? 2400, 1.1);
      const ng = gainEnv(c, p.slap, 0.0005, 0.012);
      n.connect(bp); bp.connect(ng); ng.connect(out); n.start(0);
    }
  },
  ping(c, out, p) {                                   // struck metal / wood: a handful of decaying partials
    for (const [ratio, level, dec] of p.partials) {
      const f = p.f * ratio; if (f > 18000) continue;
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = gainEnv(c, level, 0.0004, dec / 4.6);
      o.connect(g); g.connect(out); o.start(0); o.stop(p.len);
    }
    if (p.click) {
      const n = noiseSrc(c, 0.05, 71);
      const bp = filt(c, 'bandpass', Math.min(9000, p.f * 2.5), 0.9);
      const ng = gainEnv(c, p.click, 0.0003, 0.004);
      n.connect(bp); bp.connect(ng); ng.connect(out); n.start(0);
    }
  },
  scrape(c, out, p) {                                 // güiro: a stick dragged over ridges
    const n = noiseSrc(c, p.len + 0.05, 83);
    const bp = filt(c, 'bandpass', p.freq ?? 4200, 1.6);
    const g = c.createGain();
    g.gain.setValueAtTime(0, 0);
    const pulses = p.n ?? 10, span = p.span ?? 0.3;
    for (let i = 0; i < pulses; i++) {
      const t = (i / pulses) * span, w = span / pulses, lv = 1 - 0.35 * (i / pulses);
      g.gain.setValueAtTime(0.02, t); g.gain.linearRampToValueAtTime(lv, t + w * 0.25); g.gain.linearRampToValueAtTime(0.04, t + w * 0.9);
    }
    g.gain.linearRampToValueAtTime(0, span + 0.03);
    n.connect(bp); bp.connect(g); g.connect(out); n.start(0);
  },
  brush(c, out, p) {                                  // wire brush on a skin: soft swish with a tiny thump
    const n = noiseSrc(c, p.len + 0.1, 97);
    const hp = filt(c, 'highpass', p.hp ?? 1200, 0.7);
    const bp = filt(c, 'bandpass', p.freq ?? 4000, 0.5);
    const g = c.createGain();
    const a = p.attack ?? 0.01;
    g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(1, a); g.gain.setTargetAtTime(0, a, (p.decay ?? 0.2) / 4.5);
    n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(out); n.start(0);
    if (p.thump) {
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(220, 0); o.frequency.exponentialRampToValueAtTime(150, 0.05);
      const og = gainEnv(c, p.thump * 0.4, 0.002, 0.03); o.connect(og); og.connect(out); o.start(0); o.stop(0.3);
    }
  },
};

// ---------------------------------------------------------------- kits
const base = () => [
  { k: 'kick', fStart: 180, f0: 46, pitchT: 0.09, decay: 1.0, drive: 2.5, click: 0.15, len: 1.4 },
  { k: 'kick', fStart: 150, f0: 56, pitchT: 0.04, decay: 0.34, drive: 1.5, click: 0.4, len: 0.7 },
  { k: 'snare', tone: 185, toneDecay: 0.1, noise: 0.8, noiseDecay: 0.22, hp: 1200, len: 0.5 },
  { k: 'rim', len: 0.2 },
  { k: 'clap', freq: 1100, q: 1.1, decay: 0.22, len: 0.55 },
  { k: 'hat', decay: 0.05, hp: 7000, bp: 10000, pitch: 1, noise: 0.25, len: 0.2 },
  { k: 'hat', decay: 0.09, hp: 6500, bp: 9500, pitch: 1.12, noise: 0.25, len: 0.3 },
  { k: 'hat', decay: 0.42, hp: 7000, bp: 9500, pitch: 1, noise: 0.3, len: 1.0, tail: true },
  { k: 'tom', f: 92, decay: 0.45, len: 0.8 },
  { k: 'tom', f: 128, decay: 0.4, len: 0.7 },
  { k: 'tom', f: 175, decay: 0.34, len: 0.6 },
  { k: 'crash', decay: 1.7, len: 2.2 },
  { k: 'ride', decay: 0.9, len: 1.3 },
  { k: 'cowbell', len: 0.5 },
  { k: 'shaker', decay: 0.07, len: 0.2 },
  { k: 'snap', len: 0.25 },
];
function kit(id, name, desc, tweak, post = {}, names = null) {
  const pads = base();
  tweak(pads);
  return { id, name, desc, pads, post, names };
}
const A = Object.assign;

export const KITS = [
  kit('808', '808 Classic', 'Booming sub kick, snappy clap, metallic hats', () => {}),
  kit('trap', 'Trap', 'Deep gliding 808, tight snare, rapid-fire hats', (p) => {
    A(p[0], { fStart: 230, f0: 38, pitchT: 0.14, decay: 1.4, drive: 3.2, click: 0.1, len: 2.4 });
    A(p[1], { fStart: 170, f0: 50, decay: 0.3, click: 0.5 });
    A(p[2], { tone: 215, toneDecay: 0.07, noise: 1.0, noiseDecay: 0.17, hp: 2200, peak: 6200 });
    A(p[4], { freq: 1500, q: 1.3, decay: 0.2 });
    A(p[5], { decay: 0.032, hp: 9000, bp: 12000, noise: 0.18 });
    A(p[6], { decay: 0.06, hp: 8500, bp: 11000, pitch: 1.2 });
    A(p[7], { decay: 0.3 });
  }),
  kit('boombap', 'Boom Bap', 'Punchy dusty drums for classic hip-hop', (p) => {
    A(p[0], { fStart: 130, f0: 52, pitchT: 0.03, decay: 0.42, drive: 1.1, click: 0.55, len: 0.8 });
    A(p[1], { fStart: 110, f0: 60, decay: 0.28, click: 0.6 });
    A(p[2], { tone: 200, toneDecay: 0.09, noise: 0.85, noiseDecay: 0.19, hp: 800, peak: 3200 });
    A(p[4], { freq: 1000, decay: 0.26 });
    A(p[5], { decay: 0.055, hp: 6000, bp: 8000, pitch: 0.9, noise: 0.45 });
    A(p[6], { decay: 0.1, hp: 5600, bp: 7600, pitch: 1.0, noise: 0.45 });
    A(p[7], { decay: 0.36, hp: 6000, bp: 8000, noise: 0.5 });
  }, { lp: 9500, bits: 13 }),
  kit('lofi', 'Lo-Fi', 'Warm, crunchy, bit-crushed drums for chill beats', (p) => {
    A(p[0], { fStart: 120, f0: 50, pitchT: 0.04, decay: 0.45, drive: 0.8, click: 0.3, len: 0.8 });
    A(p[1], { fStart: 100, f0: 58, decay: 0.3, click: 0.4 });
    A(p[2], { tone: 190, toneDecay: 0.11, noise: 0.7, noiseDecay: 0.2, hp: 700, peak: 2800 });
    A(p[4], { freq: 900, q: 0.9, decay: 0.25 });
    A(p[5], { decay: 0.05, hp: 5000, bp: 7000, pitch: 0.85, noise: 0.55 });
    A(p[6], { decay: 0.09, hp: 4800, bp: 6600, pitch: 0.95, noise: 0.55 });
    A(p[7], { decay: 0.32, hp: 5000, bp: 7000, noise: 0.6 });
    A(p[14], { decay: 0.09 });
  }, { lp: 5600, bits: 10, decim: 3 }),
  kit('house', 'House 909', 'Four-on-the-floor kick, crisp hats, big clap', (p) => {
    A(p[0], { fStart: 270, f0: 52, pitchT: 0.035, decay: 0.46, drive: 1.3, click: 0.6, len: 0.8 });
    A(p[1], { fStart: 200, f0: 58, decay: 0.26, click: 0.5 });
    A(p[2], { tone: 205, toneDecay: 0.08, noise: 0.95, noiseDecay: 0.25, hp: 1600, peak: 5200 });
    A(p[4], { freq: 1250, q: 1.5, decay: 0.32 });
    A(p[5], { decay: 0.045, hp: 7500, bp: 11000, noise: 0.4 });
    A(p[6], { decay: 0.08, hp: 7000, bp: 10500, pitch: 1.1, noise: 0.4 });
    A(p[7], { decay: 0.34, hp: 7500, bp: 10500, noise: 0.5 });
  }),
  kit('studio', 'Studio Kit', 'Natural-feeling kit: beater kick, rattly snare, airy hats', (p) => {
    A(p[0], { fStart: 115, f0: 62, pitchT: 0.05, decay: 0.3, drive: 0.35, click: 0.85, len: 0.6 });
    A(p[1], { fStart: 105, f0: 70, decay: 0.22, click: 0.9 });
    A(p[2], { tone: 235, toneDecay: 0.075, noise: 0.9, noiseDecay: 0.2, hp: 2600, peak: 5000, body: 0.8 });
    A(p[5], { decay: 0.06, hp: 6500, bp: 9000, noise: 0.9, metal: 0.45 });
    A(p[6], { decay: 0.1, hp: 6200, bp: 8800, noise: 0.9, metal: 0.45 });
    A(p[7], { decay: 0.5, hp: 6500, bp: 9000, noise: 0.95, metal: 0.5 });
    A(p[8], { f: 100, decay: 0.55, sweep: 1.6, drive: 0.1 });
    A(p[9], { f: 140, decay: 0.5, sweep: 1.6, drive: 0.1 });
    A(p[10], { f: 190, decay: 0.42, sweep: 1.6, drive: 0.1 });
  }),
  kit('electro', 'Electro 80s', 'Big gated snare, synth toms, punchy kick', (p) => {
    A(p[0], { fStart: 200, f0: 54, pitchT: 0.05, decay: 0.38, drive: 1.8, click: 0.5, len: 0.7 });
    A(p[2], { tone: 180, toneDecay: 0.14, noise: 1.0, noiseDecay: 0.34, hp: 900, peak: 3600, body: 1.2 });
    A(p[4], { freq: 1000, decay: 0.38 });
    A(p[8], { f: 85, decay: 0.55, sweep: 4, sweepT: 0.12, drive: 1.5 });
    A(p[9], { f: 118, decay: 0.5, sweep: 4, sweepT: 0.12, drive: 1.5 });
    A(p[10], { f: 165, decay: 0.45, sweep: 4, sweepT: 0.12, drive: 1.5 });
    A(p[5], { decay: 0.04, hp: 8000, bp: 11000 });
  }),
  kit('dnb', 'Drum & Bass', 'Tight punchy kick, crisp cracking snare, fast hats', (p) => {
    A(p[0], { fStart: 190, f0: 58, pitchT: 0.035, decay: 0.3, drive: 1.6, click: 0.6, len: 0.6 });
    A(p[1], { fStart: 160, f0: 64, decay: 0.2, click: 0.7 });
    A(p[2], { tone: 215, toneDecay: 0.07, noise: 1.0, noiseDecay: 0.15, hp: 2400, peak: 6500 });
    A(p[4], { freq: 1300, q: 1.4, decay: 0.18 });
    A(p[5], { decay: 0.035, hp: 9000, bp: 12000, noise: 0.35 });
    A(p[6], { decay: 0.06, hp: 8500, bp: 11500, pitch: 1.15, noise: 0.35 });
    A(p[7], { decay: 0.22, hp: 8500, bp: 11000, noise: 0.4 });
  }),
  kit('dirty', 'Dirty South', 'Distorted, crunchy hip-hop drums with grit', (p) => {
    A(p[0], { fStart: 150, f0: 50, pitchT: 0.06, decay: 0.7, drive: 3.6, click: 0.35, len: 1.0 });
    A(p[1], { fStart: 120, f0: 56, decay: 0.4, drive: 2.4, click: 0.5 });
    A(p[2], { tone: 195, toneDecay: 0.1, noise: 0.9, noiseDecay: 0.2, hp: 900, peak: 3000 });
    A(p[4], { freq: 1050, q: 1.0, decay: 0.28 });
    A(p[5], { decay: 0.05, hp: 6500, bp: 8800, noise: 0.5 });
    A(p[7], { decay: 0.34, hp: 6500, bp: 8800, noise: 0.5 });
  }, { lp: 10500, bits: 11 }),
  kit('rock', 'Heavy Rock', 'Big natural-sounding toms, huge crash, fat snare', (p) => {
    A(p[0], { fStart: 125, f0: 58, pitchT: 0.05, decay: 0.35, drive: 0.6, click: 0.9, len: 0.7 });
    A(p[1], { fStart: 110, f0: 64, decay: 0.25, click: 0.9 });
    A(p[2], { tone: 190, toneDecay: 0.12, noise: 0.95, noiseDecay: 0.28, hp: 1800, peak: 4800, body: 1.1 });
    A(p[5], { decay: 0.07, hp: 6200, bp: 8800, noise: 0.9, metal: 0.4 });
    A(p[6], { decay: 0.12, hp: 6000, bp: 8600, noise: 0.9, metal: 0.4 });
    A(p[7], { decay: 0.55, hp: 6200, bp: 8800, noise: 0.95, metal: 0.45 });
    A(p[8], { f: 80, decay: 0.65, sweep: 1.5, drive: 0.2 });
    A(p[9], { f: 110, decay: 0.6, sweep: 1.5, drive: 0.2 });
    A(p[10], { f: 150, decay: 0.5, sweep: 1.5, drive: 0.2 });
    A(p[11], { decay: 2.8, len: 3.2 });
    A(p[12], { decay: 1.4, len: 1.8 });
  }),
  kit('minimal', 'Minimal Click', 'Short clicky hits for modern minimal / tech grooves', (p) => {
    A(p[0], { fStart: 120, f0: 55, pitchT: 0.03, decay: 0.22, drive: 1.0, click: 1.0, len: 0.4 });
    A(p[1], { fStart: 100, f0: 60, decay: 0.15, click: 1.0 });
    A(p[2], { tone: 300, toneDecay: 0.04, noise: 0.6, noiseDecay: 0.08, hp: 3000, peak: 7000, len: 0.25 });
    A(p[4], { freq: 1500, q: 1.6, decay: 0.14 });
    A(p[5], { decay: 0.02, hp: 10000, bp: 13000, noise: 0.2 });
    A(p[6], { decay: 0.035, hp: 9500, bp: 12000, pitch: 1.2 });
    A(p[7], { decay: 0.15, hp: 9500, bp: 12000 });
  }),
  kit('afro', 'Afro Percussion', 'Congas, shakers, rim clicks and cowbell', (p) => {
    A(p[0], { fStart: 110, f0: 60, pitchT: 0.05, decay: 0.3, drive: 0.5, click: 0.4, len: 0.6 });
    A(p[2], { tone: 260, toneDecay: 0.06, noise: 0.4, noiseDecay: 0.12, hp: 3500, peak: 5500, body: 0.8 });
    A(p[5], { decay: 0.045, hp: 7500, bp: 10000, noise: 0.5 });
    A(p[8], { f: 190, decay: 0.28, sweep: 1.35, sweepT: 0.04, drive: 0.1 });
    A(p[9], { f: 250, decay: 0.24, sweep: 1.35, sweepT: 0.04, drive: 0.1 });
    A(p[10], { f: 330, decay: 0.2, sweep: 1.35, sweepT: 0.04, drive: 0.1 });
    A(p[13], { pitch: 0.9 });
    A(p[14], { decay: 0.11 });
  }),
  kit('jazz', 'Jazz Brushes', 'Felt kick, brushed snare, stick ride and a pedal hat', (p) => {
    p[0] = { k: 'kick', fStart: 105, f0: 62, pitchT: 0.05, decay: 0.34, drive: 0.15, click: 0.25, len: 0.7 };
    p[1] = { k: 'kick', fStart: 95, f0: 72, pitchT: 0.04, decay: 0.22, drive: 0.1, click: 0.2, len: 0.5 };
    p[2] = { k: 'brush', freq: 3800, hp: 1200, attack: 0.006, decay: 0.24, thump: 0.6, len: 0.5, level: 0.6 };
    p[3] = { k: 'rim', pitch: 0.92, len: 0.2 };
    p[4] = { k: 'brush', freq: 5200, hp: 2500, attack: 0.003, decay: 0.07, len: 0.2, level: 0.45 };
    p[5] = { k: 'hat', decay: 0.04, hp: 7500, bp: 9500, noise: 0.9, metal: 0.3, len: 0.2 };
    p[6] = { k: 'hat', decay: 0.07, hp: 5500, bp: 6500, pitch: 0.7, noise: 1, metal: 0.2, len: 0.25 };
    p[7] = { k: 'hat', decay: 0.5, hp: 7000, bp: 9000, noise: 0.95, metal: 0.45, tail: true, len: 1.0 };
    p[8] = { k: 'tom', f: 112, decay: 0.55, sweep: 1.5, drive: 0.1, len: 0.9 };
    p[9] = { k: 'tom', f: 152, decay: 0.5, sweep: 1.5, drive: 0.1, len: 0.8 };
    p[10] = { k: 'tom', f: 205, decay: 0.42, sweep: 1.5, drive: 0.1, len: 0.7 };
    p[11] = { k: 'crash', decay: 1.5, len: 2.0 };
    p[12] = { k: 'ride', decay: 2.0, len: 2.4 };
    p[13] = { k: 'brush', freq: 2500, hp: 600, attack: 0.3, decay: 1.2, len: 1.7, level: 0.5 };
    p[14] = { k: 'shaker', decay: 0.09, len: 0.2 };
  }, { lp: 12500 }, ['Felt Kick', 'Soft Kick', 'Brush Snare', 'Cross-Stick', 'Brush Tap', 'Hat', 'Pedal Hat', 'Open Hat', 'Tom Lo', 'Tom Mid', 'Tom Hi', 'Crash', 'Ride', 'Brush Swirl', 'Shaker', 'Snap']),
  kit('latin', 'Latin Percussion', 'Congas, bongos, timbale, claves, güiro, maracas and agogo', (p) => {
    p[0] = { k: 'kick', fStart: 100, f0: 62, pitchT: 0.05, decay: 0.26, drive: 0.3, click: 0.3, len: 0.5 };
    p[1] = { k: 'skin', f: 72, decay: 0.75, sweep: 1.5, slap: 0.12, lp: 1900, len: 1.1, level: 0.9 };
    p[2] = { k: 'snare', tone: 430, toneDecay: 0.05, noise: 0.9, noiseDecay: 0.17, hp: 3200, peak: 6200, len: 0.35 };
    p[3] = { k: 'ping', f: 2500, partials: [[1, 1, 0.05], [2.6, 0.3, 0.025]], click: 0.25, len: 0.2, level: 0.55 };
    p[4] = { k: 'skin', f: 420, decay: 0.17, sweep: 1.15, sweepT: 0.02, slap: 0.55, slapF: 3200, lp: 8000, len: 0.35 };
    p[5] = { k: 'shaker', decay: 0.05, len: 0.15, freq: 8800, attack: 0.008 };
    p[6] = { k: 'shaker', decay: 0.1, len: 0.25, freq: 7200, attack: 0.012 };
    p[7] = { k: 'scrape', freq: 4300, n: 11, span: 0.34, len: 0.45, level: 0.5 };
    p[8] = { k: 'skin', f: 165, decay: 0.34, sweep: 1.18, sweepT: 0.025, slap: 0.3, lp: 5000, len: 0.6 };
    p[9] = { k: 'skin', f: 220, decay: 0.3, sweep: 1.15, sweepT: 0.022, slap: 0.35, lp: 5500, len: 0.55 };
    p[10] = { k: 'skin', f: 300, decay: 0.26, sweep: 1.12, sweepT: 0.02, slap: 0.45, slapF: 2800, lp: 6000, len: 0.5 };
    p[11] = { k: 'crash', decay: 0.9, len: 1.3 };
    p[12] = { k: 'ping', f: 880, partials: [[1, 1, 0.28], [2.7, 0.5, 0.14], [4.4, 0.22, 0.07]], click: 0.3, len: 0.5, level: 0.5 };
    p[13] = { k: 'cowbell', pitch: 1, len: 0.5 };
    p[14] = { k: 'shaker', decay: 0.07, len: 0.2 };
    p[15] = { k: 'skin', f: 330, decay: 0.19, sweep: 1.15, sweepT: 0.02, slap: 0.5, slapF: 3400, lp: 7000, len: 0.35 };
  }, {}, ['Bombo', 'Surdo', 'Timbale', 'Claves', 'Bongo Hi', 'Maracas', 'Cabasa', 'Güiro', 'Conga Lo', 'Conga Mid', 'Conga Hi', 'Splash', 'Agogo', 'Cowbell', 'Shaker', 'Bongo Lo']),
  kit('orch', 'Orchestral Percussion', 'Timpani, concert bass drum, cymbals, triangle, tam-tam and anvil', (p) => {
    p[0] = { k: 'skin', f: 56, decay: 1.7, sweep: 1.3, sweepT: 0.07, slap: 0.15, lp: 1500, len: 2.3, level: 0.9 };
    p[1] = { k: 'skin', f: 64, decay: 0.8, sweep: 1.3, sweepT: 0.05, slap: 0.2, lp: 1800, len: 1.2, level: 0.85 };
    p[2] = { k: 'snare', tone: 195, toneDecay: 0.1, noise: 0.85, noiseDecay: 0.28, hp: 1600, peak: 4600, body: 0.8, len: 0.5 };
    p[3] = { k: 'ping', f: 1700, partials: [[1, 1, 0.07], [2.4, 0.45, 0.035]], click: 0.4, len: 0.25, level: 0.6 };
    p[4] = { k: 'hat', pitch: 2.2, decay: 0.32, hp: 5500, bp: 8200, noise: 0.8, metal: 1.2, len: 0.55, tail: true };
    p[5] = { k: 'ping', f: 3600, partials: [[1, 1, 1.6], [2.7, 0.5, 0.9], [4.1, 0.3, 0.55], [6.6, 0.15, 0.3]], len: 2.2, level: 0.45 };
    p[6] = { k: 'ping', f: 3600, partials: [[1, 1, 0.28], [2.7, 0.5, 0.16], [4.1, 0.3, 0.1]], len: 0.5, level: 0.4 };
    p[7] = { k: 'crash', decay: 4.0, len: 4.6 };
    p[8] = { k: 'skin', f: 78, decay: 1.5, sweep: 1.22, sweepT: 0.09, slap: 0.1, ring: 0.25, lp: 2600, len: 2.1, level: 0.9 };
    p[9] = { k: 'skin', f: 104, decay: 1.3, sweep: 1.22, sweepT: 0.08, slap: 0.1, ring: 0.25, lp: 2800, len: 1.9, level: 0.9 };
    p[10] = { k: 'skin', f: 138, decay: 1.1, sweep: 1.22, sweepT: 0.07, slap: 0.1, ring: 0.25, lp: 3000, len: 1.7, level: 0.9 };
    p[11] = { k: 'crash', decay: 2.6, len: 3.0 };
    p[12] = { k: 'ping', f: 110, partials: [[1, 1, 3.4], [1.47, 0.8, 3.0], [2.09, 0.7, 2.6], [2.85, 0.6, 2.2], [3.71, 0.5, 2.0], [4.9, 0.4, 1.5], [6.2, 0.3, 1.2]], click: 0.3, len: 5.0, level: 0.6 };
    p[13] = { k: 'ping', f: 700, partials: [[1, 1, 0.9], [2.93, 0.7, 0.55], [5.4, 0.4, 0.3]], click: 0.55, len: 1.2, level: 0.55 };
    p[14] = { k: 'shaker', decay: 0.1, len: 0.25 };
  }, {}, ['Concert Bass Drum', 'Bass Drum Soft', 'Snare', 'Woodblock', 'Tambourine', 'Triangle', 'Triangle Muted', 'Suspended Cymbal', 'Timpani Lo', 'Timpani Mid', 'Timpani Hi', 'Crash Cymbals', 'Tam-Tam', 'Anvil', 'Cabasa', 'Finger Snap']),
  kit('world', 'World Hand Drums', 'Djembe, doumbek, dun-dun, frame drum, agogo and shekere', (p) => {
    p[0] = { k: 'skin', f: 86, decay: 0.75, sweep: 1.8, sweepT: 0.06, slap: 0.2, lp: 2300, len: 1.1, level: 0.95 };
    p[1] = { k: 'skin', f: 122, decay: 0.36, sweep: 1.5, sweepT: 0.04, slap: 0.25, lp: 3500, len: 0.6 };
    p[2] = { k: 'skin', f: 540, decay: 0.1, sweep: 1.05, sweepT: 0.01, slap: 0.75, slapF: 4600, lp: 9000, len: 0.25 };
    p[3] = { k: 'rim', pitch: 1.1, len: 0.2 };
    p[4] = { k: 'clap', freq: 1500, q: 1.2, decay: 0.2, len: 0.45 };
    p[5] = { k: 'skin', f: 390, decay: 0.15, sweep: 1.1, sweepT: 0.015, slap: 0.95, slapF: 3600, lp: 9000, len: 0.3 };
    p[6] = { k: 'skin', f: 225, decay: 0.32, sweep: 1.25, sweepT: 0.03, slap: 0.4, lp: 6000, len: 0.55 };
    p[7] = { k: 'skin', f: 192, decay: 0.48, sweep: 1.3, sweepT: 0.04, slap: 0.2, lp: 5000, len: 0.8 };
    p[8] = { k: 'skin', f: 72, decay: 0.58, sweep: 1.35, slap: 0.2, lp: 1700, drive: 0.8, len: 0.9 };
    p[9] = { k: 'skin', f: 98, decay: 0.55, sweep: 1.35, slap: 0.2, lp: 1900, drive: 0.8, len: 0.9 };
    p[10] = { k: 'skin', f: 134, decay: 0.5, sweep: 1.35, slap: 0.25, lp: 2300, drive: 0.8, len: 0.8 };
    p[11] = { k: 'skin', f: 152, decay: 0.65, sweep: 1.3, ring: 0.4, slap: 0.3, lp: 5000, len: 1.0 };
    p[12] = { k: 'skin', f: 165, decay: 0.3, sweep: 1.25, slap: 0.4, lp: 5000, len: 0.5 };
    p[13] = { k: 'ping', f: 820, partials: [[1, 1, 0.3], [2.7, 0.5, 0.15], [4.4, 0.25, 0.08]], click: 0.3, len: 0.5, level: 0.5 };
    p[14] = { k: 'shaker', decay: 0.14, len: 0.3, freq: 5400, attack: 0.02 };
  }, {}, ['Djembe Bass', 'Doumbek Dum', 'Doumbek Tek', 'Rim Click', 'Hand Clap', 'Djembe Slap', 'Djembe Tone', 'Djembe Open', 'Dun-Dun Lo', 'Dun-Dun Mid', 'Dun-Dun Hi', 'Frame Drum', 'Frame Soft', 'Agogo', 'Shekere', 'Finger Snap']),
  kit('cinema', 'Cinematic Drums', 'Huge taiko hits, war drums, metal impacts and stomps', (p) => {
    p[0] = { k: 'skin', f: 48, decay: 1.5, sweep: 2.0, sweepT: 0.09, slap: 0.3, lp: 1400, drive: 1.5, len: 2.2, level: 0.95 };
    p[1] = { k: 'skin', f: 72, decay: 0.75, sweep: 1.8, sweepT: 0.06, slap: 0.55, lp: 2400, drive: 1.0, len: 1.2 };
    p[2] = { k: 'snare', tone: 150, toneDecay: 0.16, noise: 1.0, noiseDecay: 0.38, hp: 800, peak: 2500, body: 1.3, len: 0.7 };
    p[3] = { k: 'ping', f: 520, partials: [[1, 1, 0.6], [2.4, 0.6, 0.38], [3.9, 0.4, 0.26], [5.7, 0.3, 0.18]], click: 0.6, len: 0.9, level: 0.55 };
    p[4] = { k: 'kick', fStart: 130, f0: 52, pitchT: 0.06, decay: 0.35, drive: 3.5, click: 0.6, len: 0.7 };
    p[5] = { k: 'ping', f: 3000, partials: [[1, 1, 0.025]], click: 0.8, len: 0.1, level: 0.5 };
    p[6] = { k: 'ping', f: 2100, partials: [[1, 1, 0.03]], click: 0.8, len: 0.12, level: 0.5 };
    p[7] = { k: 'skin', f: 42, decay: 2.2, sweep: 1.25, sweepT: 0.12, drive: 2, lp: 900, len: 3.6, level: 0.85 };
    p[8] = { k: 'tom', f: 62, decay: 1.1, sweep: 2.5, drive: 1.2, len: 1.5 };
    p[9] = { k: 'tom', f: 86, decay: 1.0, sweep: 2.5, drive: 1.2, len: 1.4 };
    p[10] = { k: 'tom', f: 118, decay: 0.9, sweep: 2.5, drive: 1.2, len: 1.3 };
    p[11] = { k: 'crash', decay: 3.5, len: 4.0 };
    p[12] = { k: 'ping', f: 95, partials: [[1, 1, 3.8], [1.5, 0.8, 3.2], [2.1, 0.7, 2.8], [2.9, 0.6, 2.4], [3.8, 0.5, 2.0], [5.1, 0.4, 1.6]], click: 0.3, len: 5.0, level: 0.6 };
    p[13] = { k: 'ping', f: 640, partials: [[1, 1, 1.0], [2.93, 0.7, 0.6], [5.4, 0.45, 0.35]], click: 0.6, len: 1.4, level: 0.55 };
    p[14] = { k: 'shaker', decay: 0.13, len: 0.3, freq: 3200 };
    p[15] = { k: 'clap', freq: 800, q: 0.9, decay: 0.5, len: 0.8 };
  }, {}, ['Taiko Deep', 'Taiko Hit', 'War Snare', 'Metal Hit', 'Stomp', 'Tick', 'Tick 2', 'Rumble', 'Huge Tom Lo', 'Huge Tom Mid', 'Huge Tom Hi', 'Cinematic Crash', 'Gong', 'Anvil', 'Dark Shaker', 'Stomp Clap']),
  kit('dub', 'Dub Roots', 'Warm round kick, woody one-drop snare, tape-soft hats', (p) => {
    A(p[0], { fStart: 100, f0: 48, pitchT: 0.07, decay: 0.65, drive: 1.0, click: 0.15, len: 1.0 });
    A(p[1], { fStart: 90, f0: 54, decay: 0.4, click: 0.2 });
    A(p[2], { tone: 175, toneDecay: 0.12, noise: 0.55, noiseDecay: 0.16, hp: 700, peak: 2200, body: 1.1 });
    A(p[4], { freq: 900, q: 0.9, decay: 0.25 });
    A(p[5], { decay: 0.06, hp: 5500, bp: 7500, noise: 0.7, metal: 0.5 });
    A(p[6], { decay: 0.1, hp: 5200, bp: 7200, noise: 0.7, metal: 0.5 });
    A(p[7], { decay: 0.5, hp: 5200, bp: 7200, noise: 0.8, metal: 0.55 });
    A(p[8], { f: 88, decay: 0.55, sweep: 1.8 }); A(p[9], { f: 120, decay: 0.5, sweep: 1.8 }); A(p[10], { f: 165, decay: 0.45, sweep: 1.8 });
  }, { lp: 7200, bits: 14 }),
  kit('hardtechno', 'Hard Techno', 'Distorted punching kick, long rumble, tight metallic hats', (p) => {
    A(p[0], { fStart: 330, f0: 47, pitchT: 0.05, decay: 0.55, drive: 3.2, click: 0.7, len: 0.9 });
    A(p[1], { fStart: 90, f0: 42, pitchT: 0.12, decay: 1.2, drive: 2.2, click: 0.1, len: 1.6 });
    A(p[2], { tone: 215, toneDecay: 0.06, noise: 1.0, noiseDecay: 0.2, hp: 1800, peak: 5600 });
    A(p[4], { freq: 1150, q: 1.4, decay: 0.3 });
    A(p[5], { decay: 0.028, hp: 9500, bp: 12500, noise: 0.3 });
    A(p[6], { decay: 0.05, hp: 9000, bp: 12000, pitch: 1.25 });
    A(p[7], { decay: 0.22, hp: 9000, bp: 12000 });
    A(p[12], { decay: 0.5, len: 0.9 });
  }),
  kit('ambient', 'Ambient Textures', 'Soft thuds, wooden and glassy ticks, shimmering swells', (p) => {
    p[0] = { k: 'skin', f: 60, decay: 0.5, sweep: 1.3, lp: 850, len: 0.8, level: 0.8 };
    p[1] = { k: 'skin', f: 44, decay: 1.3, sweep: 1.2, lp: 520, len: 1.6, level: 0.8 };
    p[2] = { k: 'brush', freq: 2000, hp: 600, attack: 0.03, decay: 0.5, len: 0.8, level: 0.5 };
    p[3] = { k: 'ping', f: 1400, partials: [[1, 1, 0.06], [2.2, 0.5, 0.035]], click: 0.25, len: 0.2, level: 0.5 };
    p[4] = { k: 'ping', f: 4200, partials: [[1, 1, 0.25], [2.76, 0.4, 0.12]], len: 0.5, level: 0.4 };
    p[5] = { k: 'ping', f: 6500, partials: [[1, 1, 0.035]], click: 0.4, len: 0.1, level: 0.35 };
    p[6] = { k: 'ping', f: 3000, partials: [[1, 1, 0.04]], click: 0.4, len: 0.12, level: 0.35 };
    p[7] = { k: 'brush', freq: 8000, hp: 5000, attack: 0.25, decay: 1.2, len: 1.6, level: 0.4 };
    p[8] = { k: 'ping', f: 220, partials: [[1, 1, 0.8], [2, 0.4, 0.4], [3, 0.2, 0.2]], click: 0.15, len: 1.2, level: 0.6 };
    p[9] = { k: 'ping', f: 330, partials: [[1, 1, 0.7], [2, 0.4, 0.35], [3, 0.2, 0.18]], click: 0.15, len: 1.1, level: 0.6 };
    p[10] = { k: 'ping', f: 440, partials: [[1, 1, 0.6], [2, 0.4, 0.3], [3, 0.2, 0.15]], click: 0.15, len: 1.0, level: 0.55 };
    p[11] = { k: 'brush', freq: 4000, hp: 1500, attack: 0.6, decay: 1.5, len: 2.2, level: 0.45 };
    p[12] = { k: 'ping', f: 1800, partials: [[1, 1, 1.6], [2.76, 0.5, 0.9], [5.4, 0.25, 0.5]], len: 2.2, level: 0.35 };
    p[13] = { k: 'ping', f: 2600, partials: [[1, 1, 0.5], [2.4, 0.4, 0.25]], click: 0.2, len: 0.7, level: 0.35 };
    p[14] = { k: 'shaker', decay: 0.2, len: 0.35, freq: 9200 };
    p[15] = { k: 'ping', f: 800, partials: [[1, 1, 0.08]], click: 0.5, len: 0.2, level: 0.45 };
  }, { lp: 14000 }, ['Soft Thud', 'Deep Pulse', 'Brush Hit', 'Wood Tick', 'Glass Tick', 'Tick Hi', 'Tick Lo', 'Shimmer', 'Mallet Lo', 'Mallet Mid', 'Mallet Hi', 'Swell', 'Chime', 'Bell Tick', 'Dust', 'Pop']),
  kit('glitch', 'IDM Glitch', 'Tiny digital clicks, bit-crushed snaps and metallic blips', (p) => {
    A(p[0], { fStart: 220, f0: 56, pitchT: 0.025, decay: 0.12, drive: 1.2, click: 1.0, len: 0.2 });
    A(p[1], { fStart: 120, f0: 42, pitchT: 0.05, decay: 0.28, drive: 0.8, click: 0.4, len: 0.4 });
    A(p[2], { tone: 340, toneDecay: 0.04, noise: 1.0, noiseDecay: 0.07, hp: 2600, peak: 7500, len: 0.16 });
    p[3] = { k: 'ping', f: 2200, partials: [[1, 1, 0.02], [3.1, 0.5, 0.012]], click: 0.8, len: 0.1, level: 0.6 };
    A(p[4], { freq: 2600, q: 1.8, decay: 0.07, len: 0.2 });
    A(p[5], { decay: 0.012, hp: 11000, bp: 14000, noise: 0.2, len: 0.06 });
    A(p[6], { decay: 0.022, hp: 10000, bp: 13000, pitch: 1.6, noise: 0.2, len: 0.08 });
    A(p[7], { decay: 0.16, hp: 9000, bp: 12000, noise: 1, metal: 0, len: 0.3, tail: false });
    p[8] = { k: 'skin', f: 150, decay: 0.09, sweep: 1.9, sweepT: 0.02, slap: 0.2, len: 0.2 };
    p[9] = { k: 'skin', f: 260, decay: 0.08, sweep: 1.9, sweepT: 0.02, slap: 0.25, len: 0.2 };
    p[10] = { k: 'skin', f: 460, decay: 0.07, sweep: 1.9, sweepT: 0.02, slap: 0.3, len: 0.2 };
    A(p[11], { decay: 0.5, len: 0.8 });
    p[12] = { k: 'ping', f: 1200, partials: [[1, 1, 0.3], [3.1, 0.6, 0.2], [5.6, 0.4, 0.12]], click: 0.4, len: 0.5, level: 0.45 };
    A(p[13], { pitch: 1.7, len: 0.3 });
    p[14] = { k: 'shaker', decay: 0.03, len: 0.1, freq: 10500, attack: 0.005 };
    p[15] = { k: 'ping', f: 500, partials: [[1, 1, 0.05]], click: 0.9, len: 0.15, level: 0.5 };
  }, { bits: 8, decim: 2 }, ['Click Kick', 'Sub Click', 'Snap Snare', 'Bit Rim', 'Burst Clap', 'Tick', 'Tick 2', 'Hiss', 'Blip Lo', 'Blip Mid', 'Blip Hi', 'Static Crash', 'Metal Ping', 'Zap Bell', 'Dust', 'Pop']),
  kit('funk', 'Funk & Soul', 'Dry tight kick, cracking snare, crisp hats — Motown to JB', (p) => {
    A(p[0], { fStart: 140, f0: 58, pitchT: 0.04, decay: 0.3, drive: 0.6, click: 0.6, len: 0.6 });
    A(p[1], { fStart: 125, f0: 64, decay: 0.2, click: 0.7 });
    A(p[2], { tone: 215, toneDecay: 0.07, noise: 0.9, noiseDecay: 0.15, hp: 1900, peak: 5000, body: 0.9, len: 0.35 });
    A(p[4], { freq: 1250, q: 1.3, decay: 0.2 });
    A(p[5], { decay: 0.035, hp: 7500, bp: 10000, noise: 0.5, metal: 0.6 });
    A(p[6], { decay: 0.07, hp: 7000, bp: 9500, noise: 0.5, metal: 0.6 });
    A(p[7], { decay: 0.3, hp: 7000, bp: 9500, noise: 0.55, metal: 0.65 });
    A(p[8], { f: 105, decay: 0.38, sweep: 1.5, drive: 0.1 }); A(p[9], { f: 142, decay: 0.34, sweep: 1.5, drive: 0.1 }); A(p[10], { f: 192, decay: 0.3, sweep: 1.5, drive: 0.1 });
    A(p[14], { decay: 0.06, len: 0.18 });
  }),
  kit('8bit', '8-Bit Arcade', 'Crunchy video-game console drums', (p) => {
    A(p[0], { fStart: 160, f0: 70, pitchT: 0.04, decay: 0.16, drive: 0.4, click: 0.2, len: 0.35 });
    A(p[1], { fStart: 140, f0: 90, decay: 0.12 });
    A(p[2], { tone: 240, toneDecay: 0.05, noise: 0.9, noiseDecay: 0.1, hp: 1500, peak: 4000, len: 0.25 });
    A(p[4], { freq: 1400, decay: 0.12 });
    A(p[5], { decay: 0.04, hp: 6000, bp: 9000, noise: 1, metal: 0 });
    A(p[6], { decay: 0.07, hp: 5500, bp: 8500, noise: 1, metal: 0 });
    A(p[7], { decay: 0.25, hp: 5500, bp: 8500, noise: 1, metal: 0 });
  }, { bits: 5, decim: 4 }),
];
export const KIT_BY_ID = Object.fromEntries(KITS.map((k) => [k.id, k]));

function postProcess(data, post, sr) {
  if (post.decim && post.decim > 1) {
    for (let i = 0; i < data.length; i += post.decim) {
      const v = data[i];
      for (let j = 1; j < post.decim && i + j < data.length; j++) data[i + j] = v;
    }
  }
  if (post.bits) {
    const q = Math.pow(2, post.bits - 1);
    for (let i = 0; i < data.length; i++) data[i] = Math.round(data[i] * q) / q;
  }
}

async function renderPad(spec, post, sr, index) {
  const len = (spec.len ?? 0.6) + 0.02;
  const c = new OfflineAudioContext(1, Math.ceil(len * sr), sr);
  const out = c.createGain();
  let tail = out;
  if (post.lp) {
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = post.lp; lp.Q.value = 0.6;
    out.connect(lp); tail = lp;
  }
  tail.connect(c.destination);
  GEN[spec.k](c, out, spec);
  const buf = await c.startRendering();
  const d = buf.getChannelData(0);
  postProcess(d, post, sr);
  // normalise + fade the very end so no clicks
  let peak = 0;
  for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  const g = peak > 1e-6 ? (spec.level ?? LEVEL[index]) / peak : 0;
  const fade = Math.min(d.length, Math.floor(sr * 0.012));
  for (let i = 0; i < d.length; i++) {
    let v = d[i] * g;
    const r = d.length - 1 - i;
    if (r < fade) v *= r / fade;
    d[i] = v;
  }
  return buf;
}

const kitCache = new Map();
/** Render (or fetch cached) the 16 pad buffers of a kit. */
export function loadKit(kitId, sr = 44100) {
  const key = kitId + '@' + sr;
  if (!kitCache.has(key)) {
    const k = KIT_BY_ID[kitId] || KITS[0];
    kitCache.set(key, Promise.all(k.pads.map((p, i) => renderPad(p, k.post, sr, i))));
  }
  return kitCache.get(key);
}
export function kitReady(kitId, sr = 44100) {
  const e = kitReadyMap.get(kitId + '@' + sr);
  return e || null;
}
const kitReadyMap = new Map();
export function ensureKit(kitId, sr = 44100) {
  const key = kitId + '@' + sr;
  return loadKit(kitId, sr).then((bufs) => { kitReadyMap.set(key, bufs); return bufs; });
}
