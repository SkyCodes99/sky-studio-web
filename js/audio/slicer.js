// Slicing audio into pieces: detect the hits (transients) or cut into equal parts.
import { clamp } from '../util.js';

/** Start times (seconds) of up to `max` slices. Always starts at 0. sensitivity 0..1 (higher = more slices). */
export function detectSlices(buffer, { max = 16, sensitivity = 0.5, minGap = 0.07 } = {}) {
  const sr = buffer.sampleRate, hop = 256, win = 512, n = Math.floor((buffer.length - win) / hop);
  if (n < 8) return [0];
  const ch = []; for (let c = 0; c < buffer.numberOfChannels; c++) ch.push(buffer.getChannelData(c));
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let e = 0; const o = i * hop;
    for (let j = 0; j < win; j += 2) { let v = 0; for (const d of ch) v += d[o + j]; v /= ch.length; e += v * v; }
    env[i] = Math.log(e / (win / 2) + 1e-9);
  }
  // onset strength: how fast the loudness rises (smoothed look-ahead vs look-behind)
  const flux = new Float32Array(n);
  for (let i = 3; i < n - 3; i++) {
    const after = (env[i + 1] + env[i + 2] + env[i + 3]) / 3, before = (env[i - 1] + env[i - 2] + env[i - 3]) / 3;
    flux[i] = Math.max(0, after - before);
  }
  let mean = 0; for (const f of flux) mean += f; mean /= n;
  let varr = 0; for (const f of flux) varr += (f - mean) ** 2; const sd = Math.sqrt(varr / n);
  const thr = mean + sd * (2.4 - sensitivity * 1.8);
  const peaks = [];
  const gap = Math.round((minGap * sr) / hop);
  for (let i = 3; i < n - 3; i++) {
    if (flux[i] > thr && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1]) {
      const last = peaks[peaks.length - 1];
      if (last && i - last.i < gap) { if (flux[i] > last.f) { last.i = i; last.f = flux[i]; } } else peaks.push({ i, f: flux[i] });
    }
  }
  let sel = peaks;
  if (sel.length > max - 1) sel = peaks.slice().sort((a, b) => b.f - a.f).slice(0, max - 1);
  const times = sel.map((p) => Math.max(0, (p.i * hop - 64) / sr)).sort((a, b) => a - b);
  const out = [0];
  for (const t of times) if (t - out[out.length - 1] > minGap * 0.8) out.push(t);
  return out;
}

export function equalSlices(buffer, count) {
  count = clamp(Math.round(count), 1, 64);
  return Array.from({ length: count }, (_, i) => (i * buffer.duration) / count);
}

/** Turn slice start times into [{start,end}] pieces covering the buffer. */
export function sliceRanges(buffer, starts) {
  return starts.map((s, i) => ({ start: s, end: i + 1 < starts.length ? starts[i + 1] : buffer.duration }));
}
