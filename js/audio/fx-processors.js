// Effect processors for the mixer rack. Each effect is ONE AudioWorkletNode (the desktop audio engine charges a lot per node,
// so single-node effects keep songs smooth). Loaded with audioWorklet.addModule(); runs on the audio thread.
// Inner loops are written for speed: power-of-two ring buffers, no per-sample function calls, coefficients updated per block.
const TWO_PI = Math.PI * 2;
const pow2 = (n) => { let p = 1; while (p < n) p <<= 1; return p; };

class Delay extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'time', defaultValue: 0.3, minValue: 0.001, maxValue: 1.9, automationRate: 'k-rate' },
      { name: 'feedback', defaultValue: 0.4, minValue: 0, maxValue: 0.95, automationRate: 'k-rate' },
      { name: 'mix', defaultValue: 0.35, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'tone', defaultValue: 6000, minValue: 200, maxValue: 20000, automationRate: 'k-rate' },
      { name: 'pingpong', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() { super(); this.n = pow2(Math.ceil(sampleRate * 2) + 8); this.m = this.n - 1; this.bl = new Float32Array(this.n); this.br = new Float32Array(this.n); this.w = 0; this.lpl = 0; this.lpr = 0; this.d = -1; }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0];
    const L = inp[0], R = inp[1] || inp[0];
    if (!L) return true;
    const oL = out[0], oR = out[1] || out[0];
    let peak = 0;
    for (let i = 0; i < L.length; i++) { const a = L[i] < 0 ? -L[i] : L[i], b = R[i] < 0 ? -R[i] : R[i]; if (a > peak) peak = a; if (b > peak) peak = b; }
    this.idle = peak < 1e-5 ? (this.idle || 0) + 1 : 0;
    if (this.idle > (10 * sampleRate) / 128) { for (let i = 0; i < L.length; i++) { oL[i] = L[i]; oR[i] = R[i]; } return true; }
    const target = Math.min(this.n - 4, p.time[0] * sampleRate);
    if (this.d < 0) this.d = target;
    const fb = p.feedback[0], mix = p.mix[0], dry = 1 - mix, pp = p.pingpong[0] > 0.5;
    const k = 1 - Math.exp(-TWO_PI * p.tone[0] / sampleRate);
    const bl = this.bl, br = this.br, m = this.m, len = L.length;
    let w = this.w, lpl = this.lpl, lpr = this.lpr, d = this.d;
    const step = (target - d) / len;                       // glide the delay time across the block (no clicks when it changes)
    for (let i = 0; i < len; i++) {
      d += step;
      const r = w - d, ri = Math.floor(r), f = r - ri;
      const a0 = ri & m, a1 = (ri + 1) & m;
      const dl = bl[a0] + (bl[a1] - bl[a0]) * f, dr = br[a0] + (br[a1] - br[a0]) * f;
      lpl += k * (dl - lpl); lpr += k * (dr - lpr);
      if (pp) { bl[w] = (L[i] + R[i]) * 0.5 + fb * lpr; br[w] = fb * lpl; }
      else { bl[w] = L[i] + fb * lpl; br[w] = R[i] + fb * lpr; }
      w = (w + 1) & m;
      oL[i] = L[i] * dry + dl * mix; oR[i] = R[i] * dry + dr * mix;
    }
    this.w = w; this.lpl = lpl; this.lpr = lpr; this.d = target;
    return true;
  }
}

class Chorus extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rate', defaultValue: 0.8, minValue: 0.05, maxValue: 10, automationRate: 'k-rate' },
      { name: 'depth', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mix', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() { super(); this.n = pow2(Math.ceil(sampleRate * 0.06)); this.m = this.n - 1; this.bl = new Float32Array(this.n); this.br = new Float32Array(this.n); this.w = 0; this.ph = 0; }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0], L = inp[0], R = inp[1] || inp[0];
    if (!L) return true;
    const oL = out[0], oR = out[1] || out[0];
    const mix = p.mix[0], dry = 1 - mix, inc = (TWO_PI * p.rate[0]) / sampleRate;
    const base = 0.014 * sampleRate, dev = 0.0065 * p.depth[0] * sampleRate;
    const bl = this.bl, br = this.br, m = this.m, len = L.length;
    let w = this.w, ph = this.ph;
    for (let i = 0; i < len; i++) {
      bl[w] = L[i]; br[w] = R[i];
      const rl = w - (base + dev * Math.sin(ph)), rr = w - (base + dev * Math.sin(ph + 1.7));
      const il = Math.floor(rl), ir = Math.floor(rr), fl = rl - il, fr = rr - ir;
      const dl = bl[il & m] * (1 - fl) + bl[(il + 1) & m] * fl, dr = br[ir & m] * (1 - fr) + br[(ir + 1) & m] * fr;
      w = (w + 1) & m; ph += inc;
      oL[i] = L[i] * dry + dl * mix; oR[i] = R[i] * dry + dr * mix;
    }
    this.w = w; this.ph = ph > TWO_PI ? ph - TWO_PI * Math.floor(ph / TWO_PI) : ph;
    return true;
  }
}

class Flanger extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rate', defaultValue: 0.25, minValue: 0.02, maxValue: 8, automationRate: 'k-rate' },
      { name: 'depth', defaultValue: 0.7, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'feedback', defaultValue: 0.5, minValue: -0.95, maxValue: 0.95, automationRate: 'k-rate' },
      { name: 'mix', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() { super(); this.n = pow2(Math.ceil(sampleRate * 0.02)); this.m = this.n - 1; this.bl = new Float32Array(this.n); this.br = new Float32Array(this.n); this.w = 0; this.ph = 0; this.fl = 0; this.fr = 0; }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0], L = inp[0], R = inp[1] || inp[0];
    if (!L) return true;
    const oL = out[0], oR = out[1] || out[0];
    const depth = p.depth[0], fb = p.feedback[0], mix = p.mix[0], dry = 1 - mix, inc = (TWO_PI * p.rate[0]) / sampleRate;
    const bl = this.bl, br = this.br, m = this.m, len = L.length;
    let w = this.w, ph = this.ph, fl = this.fl, fr = this.fr;
    for (let i = 0; i < len; i++) {
      const d = (0.0005 + (0.5 + 0.5 * Math.sin(ph)) * depth * 0.0055) * sampleRate;
      bl[w] = L[i] + fb * fl; br[w] = R[i] + fb * fr;
      const r = w - d, ri = Math.floor(r), f = r - ri, a0 = ri & m, a1 = (ri + 1) & m;
      fl = bl[a0] + (bl[a1] - bl[a0]) * f; fr = br[a0] + (br[a1] - br[a0]) * f;
      w = (w + 1) & m; ph += inc;
      oL[i] = L[i] * dry + fl * mix; oR[i] = R[i] * dry + fr * mix;
    }
    this.w = w; this.fl = fl; this.fr = fr; this.ph = ph > TWO_PI ? ph - TWO_PI * Math.floor(ph / TWO_PI) : ph;
    return true;
  }
}

class Phaser extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rate', defaultValue: 0.4, minValue: 0.02, maxValue: 8, automationRate: 'k-rate' },
      { name: 'depth', defaultValue: 0.8, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'feedback', defaultValue: 0.4, minValue: 0, maxValue: 0.95, automationRate: 'k-rate' },
      { name: 'center', defaultValue: 800, minValue: 100, maxValue: 4000, automationRate: 'k-rate' },
      { name: 'mix', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() { super(); this.zl = new Float32Array(6); this.zr = new Float32Array(6); this.ph = 0; this.fl = 0; this.fr = 0; }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0], L = inp[0], R = inp[1] || inp[0];
    if (!L) return true;
    const oL = out[0], oR = out[1] || out[0];
    const depth = p.depth[0], fb = p.feedback[0], wet = p.mix[0] * 0.5, dry = 1 - wet;
    const len = L.length, zl = this.zl, zr = this.zr;
    // the sweep only moves a few Hz per block, so one coefficient per block is plenty
    const f = Math.min(sampleRate * 0.45, p.center[0] * Math.pow(2, depth * 2 * Math.sin(this.ph)));
    const t = Math.tan((Math.PI * f) / sampleRate), a = (t - 1) / (t + 1);
    let fl = this.fl, fr = this.fr;
    for (let i = 0; i < len; i++) {
      let xl = L[i] + fb * fl, xr = R[i] + fb * fr;
      for (let s = 0; s < 6; s++) {
        const yl = a * xl + zl[s]; zl[s] = xl - a * yl; xl = yl;
        const yr = a * xr + zr[s]; zr[s] = xr - a * yr; xr = yr;
      }
      fl = xl; fr = xr;
      oL[i] = L[i] * dry + xl * wet; oR[i] = R[i] * dry + xr * wet;
    }
    this.fl = fl; this.fr = fr;
    this.ph += (TWO_PI * p.rate[0] * len) / sampleRate; if (this.ph > TWO_PI) this.ph -= TWO_PI;
    return true;
  }
}

class BitCrush extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bits', defaultValue: 8, minValue: 1, maxValue: 16, automationRate: 'k-rate' },
      { name: 'rate', defaultValue: 4, minValue: 1, maxValue: 64, automationRate: 'k-rate' },
      { name: 'mix', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() { super(); this.c = 0; this.hl = 0; this.hr = 0; }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0], L = inp[0], R = inp[1] || inp[0];
    if (!L) return true;
    const oL = out[0], oR = out[1] || out[0];
    const q = Math.pow(2, Math.round(p.bits[0]) - 1), rate = Math.max(1, Math.round(p.rate[0])), mix = p.mix[0], dry = 1 - mix;
    let c = this.c, hl = this.hl, hr = this.hr;
    for (let i = 0; i < L.length; i++) {
      if (c <= 0) { hl = Math.round(L[i] * q) / q; hr = Math.round(R[i] * q) / q; c = rate; }
      c--;
      oL[i] = L[i] * dry + hl * mix; oR[i] = R[i] * dry + hr * mix;
    }
    this.c = c; this.hl = hl; this.hr = hr;
    return true;
  }
}

class Tremolo extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rate', defaultValue: 5, minValue: 0.1, maxValue: 30, automationRate: 'k-rate' },
      { name: 'depth', defaultValue: 0.6, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'shape', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },   // 0 smooth, 1 square-ish
      { name: 'pan', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },     // 1 = auto-pan
    ];
  }
  constructor() { super(); this.ph = 0; }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0], L = inp[0], R = inp[1] || inp[0];
    if (!L) return true;
    const oL = out[0], oR = out[1] || out[0];
    const depth = p.depth[0], sh = p.shape[0], autopan = p.pan[0] > 0.5, inc = (TWO_PI * p.rate[0]) / sampleRate;
    let ph = this.ph;
    for (let i = 0; i < L.length; i++) {
      let l = Math.sin(ph);
      if (sh > 0) l = l * (1 - sh) + Math.tanh(l * 8) * sh;
      ph += inc;
      if (autopan) { const a = (l * depth + 1) * (Math.PI / 4); oL[i] = L[i] * Math.cos(a) * 1.414; oR[i] = R[i] * Math.sin(a) * 1.414; }
      else { const g = 1 - depth * (0.5 - 0.5 * l); oL[i] = L[i] * g; oR[i] = R[i] * g; }
    }
    this.ph = ph > TWO_PI ? ph - TWO_PI * Math.floor(ph / TWO_PI) : ph;
    return true;
  }
}

class Width extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'width', defaultValue: 1, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'gain', defaultValue: 1, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
    ];
  }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0], L = inp[0], R = inp[1] || inp[0];
    if (!L) return true;
    const oL = out[0], oR = out[1] || out[0];
    const w = p.width[0] * 0.5, g = p.gain[0];
    for (let i = 0; i < L.length; i++) {
      const m = (L[i] + R[i]) * 0.5, s = (L[i] - R[i]) * w;
      oL[i] = (m + s) * g; oR[i] = (m - s) * g;
    }
    return true;
  }
}

class Drive extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'drive', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'type', defaultValue: 0, minValue: 0, maxValue: 3, automationRate: 'k-rate' },
      { name: 'tone', defaultValue: 9000, minValue: 500, maxValue: 20000, automationRate: 'k-rate' },
      { name: 'mix', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() { super(); this.l = 0; this.r = 0; }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0], L = inp[0], R = inp[1] || inp[0];
    if (!L) return true;
    const oL = out[0], oR = out[1] || out[0];
    const dr = p.drive[0], k = 1 + dr * 28, comp = 1 / (1 + dr * 2.2), t = p.type[0], mix = p.mix[0], dry = 1 - mix;
    const a = 1 - Math.exp(-TWO_PI * p.tone[0] / sampleRate);
    const ty = t < 0.5 ? 0 : t < 1.5 ? 1 : t < 2.5 ? 2 : 3;
    let l = this.l, r = this.r;
    for (let i = 0; i < L.length; i++) {
      let xl = L[i] * k, xr = R[i] * k, yl, yr;
      if (ty === 0) { xl = xl > 3 ? 3 : xl < -3 ? -3 : xl; xr = xr > 3 ? 3 : xr < -3 ? -3 : xr; yl = (xl * (27 + xl * xl)) / (27 + 9 * xl * xl); yr = (xr * (27 + xr * xr)) / (27 + 9 * xr * xr); }
      else if (ty === 1) { yl = xl > 1 ? 1 : xl < -1 ? -1 : xl; yr = xr > 1 ? 1 : xr < -1 ? -1 : xr; }
      else if (ty === 2) { yl = Math.sin(Math.max(-6, Math.min(6, xl)) * 0.6); yr = Math.sin(Math.max(-6, Math.min(6, xr)) * 0.6); }
      else { yl = xl >= 0 ? Math.tanh(xl * 1.4) : Math.tanh(xl * 0.7) * 1.2; yr = xr >= 0 ? Math.tanh(xr * 1.4) : Math.tanh(xr * 0.7) * 1.2; }
      l += a * (yl * comp - l); r += a * (yr * comp - r);
      oL[i] = L[i] * dry + l * mix; oR[i] = R[i] * dry + r * mix;
    }
    this.l = l; this.r = r;
    return true;
  }
}

// Ducking: the second input (a "key" track such as the kick) pushes this track's volume down.
class Sidechain extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -30, minValue: -60, maxValue: 0, automationRate: 'k-rate' },
      { name: 'amount', defaultValue: 0.8, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 0.005, minValue: 0.001, maxValue: 0.2, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 0.18, minValue: 0.02, maxValue: 1.5, automationRate: 'k-rate' },
    ];
  }
  constructor() { super(); this.env = 0; this.g = 1; }
  process(inputs, outputs, p) {
    const inp = inputs[0], key = inputs[1], out = outputs[0], L = inp[0], R = inp[1] || inp[0];
    if (!L) return true;
    const oL = out[0], oR = out[1] || out[0];
    const kl = key && key[0], kr = key && (key[1] || key[0]);
    const thr = Math.pow(10, p.threshold[0] / 20), amt = p.amount[0];
    const ac = Math.exp(-1 / (p.attack[0] * sampleRate)), rc = Math.exp(-1 / (p.release[0] * sampleRate));
    const envFall = Math.exp(-1 / (0.02 * sampleRate));
    let env = this.env, g = this.g;
    for (let i = 0; i < L.length; i++) {
      const lv = kl ? Math.max(Math.abs(kl[i]), Math.abs(kr[i])) : 0;
      env = lv > env ? lv : env * envFall + lv * (1 - envFall);
      const target = env > thr ? 1 - amt : 1;
      g = target + (g - target) * (target < g ? ac : rc);
      oL[i] = L[i] * g; oR[i] = R[i] * g;
    }
    this.env = env; this.g = g;
    return true;
  }
}

// Algorithmic reverb (Freeverb-style: 8 comb filters + 4 all-pass filters per side). Far lighter than convolution.
const COMB = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], APASS = [556, 441, 341, 225], SPREAD = 23;
class Reverb extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'size', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'damp', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mix', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    const sc = sampleRate / 44100;
    const mk = (extra) => ({
      cb: COMB.map((l) => new Float32Array(Math.round((l + extra) * sc))), ci: new Int32Array(8), cf: new Float32Array(8),
      ab: APASS.map((l) => new Float32Array(Math.round((l + extra) * sc))), ai: new Int32Array(4),
    });
    this.c = [mk(0), mk(SPREAD)];
  }
  side(s, x, fb, damp) {
    let sum = 0;
    for (let k = 0; k < 8; k++) {
      const buf = s.cb[k], i = s.ci[k], y = buf[i];
      s.cf[k] = y * (1 - damp) + s.cf[k] * damp;
      buf[i] = x + s.cf[k] * fb;
      s.ci[k] = i + 1 >= buf.length ? 0 : i + 1;
      sum += y;
    }
    for (let k = 0; k < 4; k++) {
      const buf = s.ab[k], i = s.ai[k], bo = buf[i];
      buf[i] = sum + bo * 0.5;
      s.ai[k] = i + 1 >= buf.length ? 0 : i + 1;
      sum = bo - sum;
    }
    return sum;
  }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0], L = inp[0], R = inp[1] || inp[0];
    if (!L) return true;
    const oL = out[0], oR = out[1] || out[0];
    const size = p.size[0], fb = 0.7 + size * 0.285, damp = 0.1 + p.damp[0] * 0.8, mix = p.mix[0], dry = 1 - mix * 0.5, wet = mix * 1.6;
    // nothing coming in for longer than the tail can ring: skip the work (saves CPU while a track is silent)
    let peak = 0;
    for (let i = 0; i < L.length; i++) { const a = L[i] < 0 ? -L[i] : L[i], b = R[i] < 0 ? -R[i] : R[i]; if (a > peak) peak = a; if (b > peak) peak = b; }
    this.idle = peak < 1e-5 ? (this.idle || 0) + 1 : 0;
    if (this.idle > ((2 + size * 9) * sampleRate) / 128) { for (let i = 0; i < L.length; i++) { oL[i] = L[i]; oR[i] = R[i]; } return true; }
    const c0 = this.c[0], c1 = this.c[1];
    for (let i = 0; i < L.length; i++) {
      const x = (L[i] + R[i]) * 0.02;
      oL[i] = L[i] * dry + this.side(c0, x, fb, damp) * wet;
      oR[i] = R[i] * dry + this.side(c1, x, fb, damp) * wet;
    }
    return true;
  }
}

registerProcessor('sky-delay', Delay);
registerProcessor('sky-chorus', Chorus);
registerProcessor('sky-flanger', Flanger);
registerProcessor('sky-phaser', Phaser);
registerProcessor('sky-bitcrush', BitCrush);
registerProcessor('sky-tremolo', Tremolo);
registerProcessor('sky-width', Width);
registerProcessor('sky-drive', Drive);
registerProcessor('sky-sidechain', Sidechain);
registerProcessor('sky-reverb', Reverb);
