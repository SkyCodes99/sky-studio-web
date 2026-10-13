// Loop generator: turns a small description ("these chords, this rhythm, this seed") into notes. Everything is deterministic
// (same description + same key = same loop), so thousands of loops can be listed without storing any notes, and the Loop Builder
// can save a loop as just its description. All pitches follow the song's key and scale.
import { parentScale, degToMidi, chordDegrees, voiceLead } from '../theory.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/** Small fast seeded random number generator (mulberry32). */
export function rngOf(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const hashSeed = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

// ---------------------------------------------------------------- harmony
export function chordsOf(degs, size, proj, o = {}) {
  const sc = parentScale(proj.scale), out = [];
  let prev = null;
  for (const root of degs) {
    const midis = chordDegrees(root, size).map((d) => degToMidi(d, proj.key, sc, 4));
    let v = voiceLead(midis, prev, (o.center ?? 61));
    if (o.open && v.length >= 3) { v = [v[0], v[2], v[1] + 12, ...v.slice(3)].sort((a, b) => a - b); }
    out.push(v); prev = v;
  }
  return out;
}
export function bassRoot(deg, proj, oct = 2) {
  const sc = parentScale(proj.scale);
  let m = degToMidi(deg, proj.key, sc, oct);
  while (m > 47) m -= 12;
  while (m < 28) m += 12;
  return m;
}
const isMinorScale = (proj) => ['Minor', 'Dorian', 'Phrygian', 'Harmonic Minor', 'Minor Pentatonic', 'Blues'].includes(proj.scale);

/** Parse a hand-typed progression: "1 5 6 4", "I V vi IV", "ii V I" -> scale degrees (0-based). */
export function parseProgression(text) {
  const ROMAN = { i: 0, ii: 1, iii: 2, iv: 3, v: 4, vi: 5, vii: 6 };
  const out = [];
  for (const raw of String(text || '').trim().split(/[\s,\-–>]+/)) {
    if (!raw) continue;
    const t = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (/^[1-7]$/.test(t)) out.push(+t - 1);
    else if (ROMAN[t.replace(/(maj7|m7|7|9|dim|sus4|sus2)$/, '')] != null) out.push(ROMAN[t.replace(/(maj7|m7|7|9|dim|sus4|sus2)$/, '')]);
  }
  return out.slice(0, 16);
}

// ---------------------------------------------------------------- finishing touches shared by every generator
function finish(notes, g, len) {
  const r = rngOf((g.seed ?? 1) * 7 + 3), h = g.humanize || 0, sw = g.swing || 0;
  for (const n of notes) {
    if (sw > 0) { const beatPos = n.s % 1; if (Math.abs(beatPos - 0.5) < 0.01) n.s += sw * 0.33; }
    if (h > 0) { n.s = Math.max(0, n.s + (r() - 0.5) * 0.05 * h); n.v = clamp(Math.round(n.v + (r() - 0.5) * 22 * h), 20, 127); }
    n.s = Math.max(0, +n.s.toFixed(4)); n.d = Math.max(0.04, +n.d.toFixed(4)); n.v = clamp(Math.round(n.v), 1, 127);
  }
  return { len, notes: notes.filter((n) => n.s < len - 1e-6) };
}

const parseHits = (str) => str.trim().split(/\s+/).map((e) => { const [s, d, v, x] = e.split(':'); return [parseFloat(s), parseFloat(d), parseFloat(v), x]; });

// ---------------------------------------------------------------- chords
/** g: { prog: [degrees], size, rhythm: template, bars (repeat count), open, center, strum, bassDouble, humanize, swing, seed } */
export function genChords(g, proj, tpl) {
  const size = g.size || 3;
  const vs = chordsOf(g.prog, size, proj, { open: g.open, center: g.center });
  const bars = g.bars || g.prog.length, notes = [];
  const hitsFor = (bar) => (tpl.variants ? tpl.variants[bar % tpl.variants.length] : tpl.hits);
  const parsed = new Map();
  for (let bar = 0; bar < bars; bar++) {
    const v = vs[bar % vs.length];
    const str = hitsFor(bar);
    if (!parsed.has(str)) parsed.set(str, parseHits(str));
    const dirDown = {};
    parsed.get(str).forEach(([s, d, vel, mode], hi) => {
      const order = mode === 'd' ? v.slice().reverse() : v;
      order.forEach((p, k) => notes.push({ s: bar * 4 + s + k * (g.strum ?? tpl.strum ?? 0), d: Math.max(0.05, d - k * (g.strum ?? tpl.strum ?? 0) * 0.5), p, v: vel - k * 2 }));
      if (g.bassDouble) notes.push({ s: bar * 4 + s, d, p: v[0] - 12, v: vel - 6 });
    });
  }
  return finish(notes, g, bars * 4);
}

// ---------------------------------------------------------------- bass
const BASS_TOK = (tok, root, iv, next) => {          // iv(k) = the chord's own interval to its k-th scale step above (so thirds/fifths/sevenths match the real chord)
  switch (tok) {
    case 'r': return root;
    case '3': return root + iv(2);
    case '5': return root + iv(4);
    case '7': return root + iv(6);
    case '2': return root + iv(1);
    case '4': return root + iv(3);
    case '6': return root + iv(5);
    case 'o': return root + 12;
    case 'oo': return root + 24;
    case 'b7': return root + 10;
    case '5d': return root + iv(4) - 12;
    case 'a': return next > root ? next - 1 : next + 1;           // chromatic approach to the next chord
    case 'n': return next;                                       // jump to the next root early
    default: return root;
  }
};
/** g: { prog, rhythm, oct, bars, humanize, swing, seed }  (tpl.hits = 'start:dur:token:vel ...') */
export function genBass(g, proj, tpl) {
  const bars = g.bars || g.prog.length, notes = [], sc = parentScale(proj.scale);
  const hits = tpl.parsed || (tpl.parsed = tpl.hits.trim().split(/\s+/).map((e) => { const [s, d, t, v] = e.split(':'); return [parseFloat(s), parseFloat(d), t, parseFloat(v)]; }));
  for (let bar = 0; bar < bars; bar++) {
    const root = bassRoot(g.prog[bar % g.prog.length], proj, g.oct || 2), next = bassRoot(g.prog[(bar + 1) % g.prog.length], proj, g.oct || 2);
    const rd = g.prog[bar % g.prog.length], iv = (k) => degToMidi(rd + k, proj.key, sc, 4) - degToMidi(rd, proj.key, sc, 4);
    for (const [s, d, tok, v] of hits) notes.push({ s: bar * 4 + s, d, p: clamp(BASS_TOK(tok, root, iv, next), 12, 72), v });
  }
  return finish(notes, g, bars * 4);
}

// ---------------------------------------------------------------- arpeggios
/** g: { prog, size, pattern: tpl with seq/rate/mask, octaves, gate, bars, ... } */
export function genArp(g, proj, tpl) {
  const size = g.size || 3;
  const vs = chordsOf(g.prog, size, proj, { center: g.center ?? 64 });
  const bars = g.bars || g.prog.length, notes = [], rate = g.rate || tpl.rate, gate = g.gate ?? tpl.gate ?? 0.8;
  const steps = Math.round(4 / rate), L = size, seq = tpl.seq, mask = tpl.mask || 'x';
  const octs = g.octaves || tpl.oct || 1;
  for (let bar = 0; bar < bars; bar++) {
    const v = vs[bar % vs.length];
    for (let i = 0; i < steps; i++) {
      if (mask[i % mask.length] === '.') continue;
      let tk = seq[i % seq.length];
      if (octs > 1 && tpl.climb) tk += L * (Math.floor(i / seq.length) % octs);
      const p = v[((tk % L) + L) % L] + 12 * Math.floor(tk / L);
      notes.push({ s: bar * 4 + i * rate, d: rate * gate, p, v: i % 4 === 0 ? 96 : (i % 2 === 0 ? 80 : 66) });
    }
  }
  return finish(notes, g, bars * 4);
}

// ---------------------------------------------------------------- melodies
export const MELODY_RHYTHMS = {
  long: ['0:2', '2:2'],
  halves: ['0:1', '1:1', '2:2'],
  walk: ['0:1', '1:1', '2:1', '3:1'],
  stream8: ['0:.5', '.5:.5', '1:.5', '1.5:.5', '2:.5', '2.5:.5', '3:.5', '3.5:.5'],
  hook: ['0:.75', '.75:.75', '1.5:.5', '2:1', '3:.5', '3.5:.5'],
  sync: ['0:.5', '.5:1', '1.5:.5', '2:.5', '2.5:.5', '3:1'],
  triplet: ['0:.333', '.333:.333', '.667:.333', '1:1', '2:.333', '2.333:.333', '2.667:.333', '3:1'],
  riff16: ['0:.25', '.25:.25', '.5:.5', '1:.25', '1.25:.25', '1.5:.5', '2:.5', '2.5:.25', '2.75:.25', '3:1'],
  callresp: ['0:.5', '.5:.5', '1:1', '2.5:.5', '3:.5', '3.5:.5'],
  sparse: ['0:1.5', '2.5:1.5'],
  dotted: ['0:1.5', '1.5:.5', '2:1.5', '3.5:.5'],
  pickup: ['0:.5', '.5:.5', '1:2', '3.5:.5'],
};
const parseRhythm = (arr) => arr.map((e) => { const [s, d] = e.split(':'); return [parseFloat(s), parseFloat(d)]; });
const CONTOURS = {
  arch: (t) => Math.sin(Math.PI * t), rise: (t) => t, fall: (t) => 1 - t, wave: (t) => 0.5 + 0.5 * Math.sin(2 * Math.PI * t), flat: () => 0.5, valley: (t) => 1 - Math.sin(Math.PI * t), zigzag: (t) => (t * 4) % 1,
};
export const CONTOUR_NAMES = Object.keys(CONTOURS);

/** g: { prog, size, rhythm: key of MELODY_RHYTHMS, contour, seed, bars, range (degrees above the tonic octave), steps (max leap), repeat (0-1), oct, rest (0-1) } */
export function genMelody(g, proj) {
  const sc = parentScale(proj.scale);
  const vs = chordsOf(g.prog, g.size || 3, proj);
  const bars = g.bars || g.prog.length, notes = [];
  const r = rngOf(g.seed ?? 1);
  const rhy = parseRhythm(MELODY_RHYTHMS[g.rhythm] || MELODY_RHYTHMS.hook);
  const contour = CONTOURS[g.contour] || CONTOURS.arch;
  const range = g.range || 9, maxStep = g.steps || 2, base = g.base ?? 2;          // degrees: base .. base+range around the 5th octave
  const chordTones = (bar) => { const v = vs[bar % vs.length]; return v.map((m) => m); };
  const toDegPool = (bar) => {                                                        // chord tones as scale degrees (across octaves) for strong beats
    const root = g.prog[bar % g.prog.length], set = [];
    for (let o = -1; o <= 2; o++) for (let k = 0; k < (g.size || 3); k++) set.push(root + 2 * k + o * 7);
    return set;
  };
  let deg = base + Math.floor(range / 2), prevBar = null;
  const motifBars = [];
  for (let bar = 0; bar < bars; bar++) {
    const reuse = bar > 0 && r() < (g.repeat ?? 0.35) && motifBars.length;
    if (reuse) {                                                                         // repeat an earlier bar, shifted to the new chord
      const src = motifBars[Math.floor(r() * motifBars.length)];
      const shift = g.prog[bar % g.prog.length] - g.prog[src.bar % g.prog.length];
      for (const n of src.notes) notes.push({ s: bar * 4 + n.s, d: n.d, deg: n.deg + shift, v: n.v });
      continue;
    }
    const t = bars > 1 ? bar / (bars - 1) : 0.5;
    const target = base + contour(t) * range;
    const pool = toDegPool(bar);
    const bn = [];
    rhy.forEach(([s, d], i) => {
      if (r() < (g.rest ?? 0.08) && i > 0 && i < rhy.length - 1) return;                // rests
      const strong = s % 2 === 0 && d >= 0.5;
      let next = deg + Math.round((r() * 2 - 1) * maxStep) + Math.sign(target - deg) * (r() < 0.55 ? 1 : 0);
      next = clamp(next, base, base + range);
      if (strong) next = pool.reduce((b, c) => (Math.abs(c - next) < Math.abs(b - next) && c >= base - 1 && c <= base + range + 1 ? c : b), pool[0]);
      if (bar === bars - 1 && i === rhy.length - 1) next = pool.find((x) => x === g.prog[bar % g.prog.length] + 7 || x === g.prog[bar % g.prog.length]) ?? next;   // end on the chord root
      deg = next;
      bn.push({ s, d: Math.min(d * 0.94, 4 - s), deg: next, v: strong ? 98 : 84 });
    });
    for (const n of bn) notes.push({ s: bar * 4 + n.s, d: n.d, deg: n.deg, v: n.v });
    motifBars.push({ bar, notes: bn });
  }
  const oct = g.oct ?? 4;
  return finish(notes.map((n) => ({ s: n.s, d: n.d, p: clamp(degToMidi(n.deg, proj.key, sc, oct), 24, 108), v: n.v })), g, bars * 4);
}

// ---------------------------------------------------------------- drums
const GRID = 16;
/** Variation transforms for a drum pattern ({ lane: 'x..x....' }). Works on bars of 16 steps (the common case); other grids are left alone. */
export function transformRows(rows, bars, xf, seedBase = 1) {
  const r = rngOf(hashSeed(String(xf.type)) + (xf.seed ?? 0) * 977 + seedBase);
  const out = {};
  const len = Math.max(...Object.values(rows).map((s) => s.length));
  const per = len / bars;
  if (per !== GRID) return { rows, bars };
  for (const [k, s] of Object.entries(rows)) out[k] = s.split('');
  const set = (lane, i, c) => { out[lane] = out[lane] || '.'.repeat(len).split(''); out[lane][i] = c; };
  const at = (lane, i) => (out[lane] ? out[lane][i] : '.');
  let newBars = bars;
  const barStart = (b) => b * GRID;
  switch (xf.type) {
    case 'halftime': {                                    // backbeat moves to beat 3, hats slow down
      for (let b = 0; b < bars; b++) {
        const o0 = barStart(b);
        for (const lane of ['snare', 'clap', 'rim']) {
          if (!out[lane] || !out[lane].slice(o0, o0 + GRID).some((c) => c !== '.')) continue;
          out[lane][o0 + 4] = '.'; out[lane][o0 + 12] = '.';
          if (out[lane][o0 + 8] === '.') out[lane][o0 + 8] = 'X';
        }
        if (out.hat) for (let i = 1; i < GRID; i += 2) out.hat[o0 + i] = '.';
      }
      break;
    }
    case 'ghost': {                                       // quiet extra snare notes between the backbeats
      const lane = out.snare ? 'snare' : out.clap ? 'clap' : null;
      if (lane) for (let b = 0; b < bars; b++) for (let i = 0; i < GRID; i++) if (at(lane, barStart(b) + i) === '.' && i % 4 !== 0 && i % 4 !== 2 && r() < 0.16) set(lane, barStart(b) + i, 'o');
      break;
    }
    case 'busyhats': {                                    // every 16th on the hats, accents kept
      for (let b = 0; b < bars; b++) for (let i = 0; i < GRID; i++) { const idx = barStart(b) + i; if (at('hat', idx) === '.') set('hat', idx, i % 4 === 0 ? 'x' : (i % 2 ? 's' : 'o')); }
      break;
    }
    case 'sparse': {                                      // drop the in-between hits
      for (const lane of ['hat', 'hat2', 'shaker', 'ohat', 'rim']) if (out[lane]) for (let i = 0; i < len; i++) if (i % 4 !== 0 && r() < 0.6) out[lane][i] = '.';
      break;
    }
    case 'kicks': {                                       // syncopated extra kicks
      const lane = out.kick ? 'kick' : null;
      if (lane) for (let b = 0; b < bars; b++) for (const i of [3, 6, 10, 11, 14]) if (at(lane, barStart(b) + i) === '.' && at('snare', barStart(b) + i) === '.' && r() < 0.35) set(lane, barStart(b) + i, 'x');
      break;
    }
    case 'fill': {                                        // two bars: groove, then the same groove with a fill on the last beat
      newBars = bars * 2;
      for (const [k, s] of Object.entries(out)) out[k] = s.concat(s);
      const last = (newBars - 1) * GRID + 12;
      for (const lane of ['snare', 'clap', 'hat', 'ohat']) if (out[lane]) for (let i = 12; i < 16; i++) out[lane][(newBars - 1) * GRID + i] = '.';
      const fillLane = out.snare ? 'snare' : 'clap';
      const toms = ['tomH', 'tomM', 'tomL'];
      for (let i = 0; i < 4; i++) { set(fillLane, last + i, i % 2 ? 'x' : 'X'); }
      if (r() < 0.6) for (let i = 0; i < 4; i++) { set(toms[i % 3], last + i, 'x'); set(fillLane, last + i, '.'); }
      set('crash', (newBars - 1) * GRID, '.'); set('crash', 0, out.crash ? out.crash[0] : 'x');
      break;
    }
    case 'openhat': {                                     // open hat on the off-beats
      for (let b = 0; b < bars; b++) for (const i of [2, 6, 10, 14]) if (r() < 0.5) { set('ohat', barStart(b) + i, 'x'); if (out.hat) out.hat[barStart(b) + i] = '.'; }
      break;
    }
    default: break;
  }
  const rowsOut = {};
  for (const [k, a] of Object.entries(out)) rowsOut[k] = a.join('');
  return { rows: rowsOut, bars: newBars };
}

/** Genre grooves described by how likely each 16th step is to be hit (kick / snare / hats / extras); a seed picks one groove. */
export const GROOVES = {
  'Hip-Hop': { bpm: [80, 96], kick: '9..4.3.2.6.4.2..', snare: '....9.......9...', hat: '8.7.8.7.8.7.8.7.', extra: { ohat: '..........2....4', clap: '....3.......3...' } },
  'Trap': { bpm: [130, 150], kick: '9..3.2.2.7.4.3..', snare: '........9.......', hat: '9.8.9.8.9.8.9.8.', extra: { ohat: '..2...2...2...3.', clap: '........6.......' }, roll: true },
  'Lo-Fi': { bpm: [68, 84], kick: '9..2..3..6.4....', snare: '....8.......8..2', hat: '7.6.7.6.7.6.7.6.', extra: { rim: '..2....3....2...', shaker: '.4.4.4.4.4.4.4.4' }, swing: 0.22 },
  'House': { bpm: [120, 128], kick: '9...9...9...9...', snare: '....5.......5...', hat: '..9...9...9...9.', extra: { clap: '....9.......9...', ohat: '..8...8...8...8.', shaker: '4.4.4.4.4.4.4.4.' } },
  'Techno': { bpm: [126, 140], kick: '9...9...9...9...', snare: '................', hat: '..8...8...8...8.', extra: { clap: '....7.......7...', hat2: '.4.4.4.4.4.4.4.4', ride: '5.5.5.5.5.5.5.5.' } },
  'DnB': { bpm: [170, 176], kick: '9.........6.....', snare: '....9.......9...', hat: '8.8.8.8.8.8.8.8.', extra: { ride: '..3...3...3...3.' } },
  'Dubstep': { bpm: [138, 142], kick: '9.........4.....', snare: '........9.......', hat: '7.6.7.6.7.6.7.6.', extra: { clap: '........7.......' } },
  'Pop': { bpm: [100, 128], kick: '9...7...8...6...', snare: '....9.......9...', hat: '8.7.8.7.8.7.8.7.', extra: { clap: '....6.......6...', ohat: '..4...4...4...4.' } },
  'Rock': { bpm: [100, 140], kick: '9...3...8..4....', snare: '....9.......9...', hat: '9.8.9.8.9.8.9.8.', extra: { crash: '5...............' } },
  'Funk': { bpm: [95, 115], kick: '9..4.3..5.4.2.3.', snare: '....9..3.3..9..2', hat: '9.9.9.9.9.9.9.9.', extra: { ohat: '..........4..3..' }, swing: 0.1 },
  'R&B': { bpm: [62, 78], kick: '9....4..6.4.....', snare: '....9.......9..2', hat: '7.6.7.6.7.6.7.6.', extra: { rim: '..2....3....2...', shaker: '.3.3.3.3.3.3.3.3' }, swing: 0.15 },
  'Reggae': { bpm: [70, 85], kick: '........9.......', snare: '........8.......', hat: '..8...8...8...8.', extra: { rim: '........7.......', ohat: '..4...4...4...4.' } },
  'Latin': { bpm: [90, 110], kick: '9..3..4.7..3..4.', snare: '..3...4...3...4.', hat: '8.8.8.8.8.8.8.8.', extra: { rim: '9..7..8...7.8...', bell: '4.4.4.4.4.4.4.4.' } },
  'Afro': { bpm: [100, 118], kick: '9..4..6...5.....', snare: '..4..5..4..5...3', hat: '8.8.8.8.8.8.8.8.', extra: { shaker: '7.7.7.7.7.7.7.7.', bell: '6.4.6..4.6.4..6.' } },
  'Garage': { bpm: [128, 136], kick: '9.......8.4.....', snare: '....9.......9..4', hat: '8.7.8.7.8.7.8.7.', extra: { clap: '....6.......6...' }, swing: 0.25 },
  'Trance': { bpm: [136, 142], kick: '9...9...9...9...', snare: '................', hat: '..9...9...9...9.', extra: { clap: '....8.......8...', ohat: '..9...9...9...9.', ride: '4.4.4.4.4.4.4.4.' } },
  'Drill': { bpm: [138, 146], kick: '9.....5..4.3....', snare: '........9.......', hat: '8.7.8.8.7.8.8.7.', extra: { ohat: '..............3.', snap: '....3.......3...' } },
  'Disco': { bpm: [112, 124], kick: '9...9...9...9...', snare: '....8.......8...', hat: '..8...8...8...8.', extra: { ohat: '..9...9...9...9.', clap: '....6.......6...' } },
  'Breaks': { bpm: [130, 140], kick: '9.5.....4.9.3...', snare: '....9..3.3..9...', hat: '8.8.8.8.8.8.8.8.', extra: { ohat: '......2.....3...' } },
  'Electro': { bpm: [120, 130], kick: '9..4..5...6.4...', snare: '....8.......8...', hat: '8.7.8.7.8.7.8.7.', extra: { tomH: '.............3.3', clap: '....7.......7...' } },
  'Soul': { bpm: [84, 104], kick: '9..5...3.6.4....', snare: '....9.......9...', hat: '7.7.7.7.7.7.7.7.', extra: { clap: '....6.......6...', shaker: '8.8.8.8.8.8.8.8.' } },
  'Ambient': { bpm: [60, 90], kick: '6...............', snare: '................', hat: '4...3...4...3...', extra: { rim: '..2.....2.....3.', shaker: '.3...3...3...3..', ride: '3..3...3..3.....' } },
  'Jazz': { bpm: [110, 160], kick: '3...2...3...2...', snare: '..2...3...2...3.', hat: '....7.......7...', extra: { ride: '9.4.9.4.9.4.9.4.', rim: '..2....2....2...' }, swing: 0.5 },
  'Cinematic': { bpm: [70, 110], kick: '9.......6.......', snare: '........8.......', hat: '5.5.5.5.5.5.5.5.', extra: { tomL: '2...3...2...3...', crash: '5...............' } },
  'World': { bpm: [95, 115], kick: '9.....5...5.....', snare: '..6...5.....6...', hat: '7.6.7.6.7.6.7.6.', extra: { rim: '.3...3...3...3..', shaker: '8.8.8.8.8.8.8.8.' } },
  'Blues': { bpm: [80, 110], kick: '9...5...9...5...', snare: '....9.......9...', hat: '8.8.8.8.8.8.8.8.', extra: { ohat: '..4...4...4...4.' }, swing: 0.45 },
  'Gospel': { bpm: [84, 104], kick: '9..5..4.7..4....', snare: '....9..3....9..4', hat: '8.7.8.7.8.7.8.7.', extra: { clap: '....7.......7...' }, swing: 0.2 },
};
export const GROOVE_NAMES = Object.keys(GROOVES);

export function grooveRows(genre, seed, density = 0.55) {
  const G = GROOVES[genre] || GROOVES.Pop, r = rngOf(hashSeed(genre) + seed * 7919);
  const pick = (spec, must) => {
    let s = '';
    for (let i = 0; i < 16; i++) {
      const w = spec[i] === '.' ? 0 : (+spec[i]) / 9;
      s += r() < w * (0.4 + density * 1.1) ? (w > 0.85 ? 'X' : i % 2 ? 'o' : 'x') : '.';
    }
    if (must && s[0] === '.') s = (must) + s.slice(1);
    return s;
  };
  const rows = { kick: pick(G.kick, 'x'), snare: pick(G.snare, null), hat: pick(G.hat, null) };
  for (const [lane, spec] of Object.entries(G.extra || {})) rows[lane] = pick(spec, null);
  // keep the backbone: backbeat snare/clap for genres that have one
  if (rows.snare.replace(/\./g, '') === '' && G.snare.replace(/[.0]/g, '') !== '') rows.snare = G.snare.replace(/[1-9]/g, (c) => (+c >= 8 ? 'x' : '.'));
  for (const k of Object.keys(rows)) if (rows[k].replace(/\./g, '') === '') delete rows[k];
  return rows;
}

export function drumNotes(rows, bars, PAD, g = {}) {
  const VELS = { X: 122, x: 100, s: 76, o: 52 }, beats = bars * 4, notes = [];
  for (const [row, str] of Object.entries(rows)) {
    const pad = PAD[row]; if (pad == null) continue;
    const step = beats / str.length;
    for (let i = 0; i < str.length; i++) { const v = VELS[str[i]]; if (v) notes.push({ s: i * step, d: Math.min(step, 0.25), p: 36 + pad, v }); }
  }
  return finish(notes, g, beats);
}
