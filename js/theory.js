// Music theory helpers: scales, key-aware degree mapping, chord building and naming.
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export const SCALES = {
  'Major': [0, 2, 4, 5, 7, 9, 11],
  'Minor': [0, 2, 3, 5, 7, 8, 10],
  'Dorian': [0, 2, 3, 5, 7, 9, 10],
  'Phrygian': [0, 1, 3, 5, 7, 8, 10],
  'Lydian': [0, 2, 4, 6, 7, 9, 11],
  'Mixolydian': [0, 2, 4, 5, 7, 9, 10],
  'Harmonic Minor': [0, 2, 3, 5, 7, 8, 11],
  'Major Pentatonic': [0, 2, 4, 7, 9],
  'Minor Pentatonic': [0, 3, 5, 7, 10],
  'Blues': [0, 3, 5, 6, 7, 10],
  'Chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
export const SCALE_NAMES = Object.keys(SCALES);

/** Loops are written in scale degrees; non-7-note scales borrow the matching 7-note parent. */
export function parentScale(name) {
  const s = SCALES[name];
  if (s && s.length === 7) return name;
  if (name === 'Minor Pentatonic' || name === 'Blues') return 'Minor';
  return 'Major';
}

export const noteName = (m, flats = false) => (flats ? FLAT_NAMES : NOTE_NAMES)[((m % 12) + 12) % 12];
export const noteLabel = (m) => noteName(m) + (Math.floor(m / 12) - 1);
export const isBlack = (m) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
export const keyName = (k) => FLAT_NAMES[k] === NOTE_NAMES[k] ? NOTE_NAMES[k] : NOTE_NAMES[k];

/** Is this pitch class part of the key/scale? */
export function inScale(midi, key, scaleName) {
  const iv = SCALES[scaleName] || SCALES.Major;
  const pc = (((midi - key) % 12) + 12) % 12;
  return iv.includes(pc);
}
export const isRoot = (midi, key) => (((midi - key) % 12) + 12) % 12 === 0;

/** Snap a pitch to the nearest scale note (ties go up). */
export function snapToScale(midi, key, scaleName) {
  for (let d = 0; d < 7; d++) {
    if (inScale(midi + d, key, scaleName)) return midi + d;
    if (inScale(midi - d, key, scaleName)) return midi - d;
  }
  return midi;
}

/** Scale degree (can be negative / above the octave) -> MIDI note. octave 4 puts degree 0 at C4 + key. */
export function degToMidi(deg, key, scaleName, octave = 4) {
  const iv = SCALES[scaleName] || SCALES.Major;
  const n = iv.length;
  const oct = Math.floor(deg / n);
  const idx = ((deg % n) + n) % n;
  return 12 * (octave + 1) + key + iv[idx] + 12 * oct;
}

/** Diatonic chord on a scale degree: stack thirds inside the scale. size 3=triad, 4=seventh, 5=ninth. */
export function chordDegrees(root, size = 3) {
  const out = [];
  for (let i = 0; i < size; i++) out.push(root + i * 2);
  return out;
}

const CHORD_TYPES = [
  ['maj', [0, 4, 7]], ['m', [0, 3, 7]], ['dim', [0, 3, 6]], ['aug', [0, 4, 8]], ['sus2', [0, 2, 7]], ['sus4', [0, 5, 7]],
  ['maj7', [0, 4, 7, 11]], ['7', [0, 4, 7, 10]], ['m7', [0, 3, 7, 10]], ['m7b5', [0, 3, 6, 10]], ['dim7', [0, 3, 6, 9]],
  ['6', [0, 4, 7, 9]], ['m6', [0, 3, 7, 9]], ['maj9', [0, 4, 7, 11, 14]], ['9', [0, 4, 7, 10, 14]], ['m9', [0, 3, 7, 10, 14]],
  ['add9', [0, 4, 7, 14]], ['madd9', [0, 3, 7, 14]], ['5', [0, 7]],
];

/** Name a set of MIDI notes ("Cmaj7", "Am", ...) or '' when it isn't a recognisable chord. */
export function chordName(midis) {
  if (!midis || midis.length < 2) return '';
  const pcs = [...new Set(midis.map((m) => ((m % 12) + 12) % 12))].sort((a, b) => a - b);
  if (pcs.length < 2) return '';
  const bass = ((Math.min(...midis) % 12) + 12) % 12;
  let best = null;
  for (const root of pcs) {
    const rel = pcs.map((p) => (p - root + 12) % 12).sort((a, b) => a - b);
    for (const [name, iv] of CHORD_TYPES) {
      const ivp = [...new Set(iv.map((x) => x % 12))].sort((a, b) => a - b);
      if (ivp.length === rel.length && ivp.every((x, i) => x === rel[i])) {
        const score = (root === bass ? 0 : 1) + (iv.length > 4 ? 0.5 : 0);
        if (!best || score < best.score) best = { root, name, score };
      }
    }
  }
  if (!best) return '';
  const label = noteName(best.root) + (best.name === 'maj' ? '' : best.name);
  return best.root === bass ? label : label + '/' + noteName(bass);
}

/** Roman-numeral-ish label for chord strip buttons. */
export function degreeLabel(i, scaleName) {
  const minorish = ['Minor', 'Dorian', 'Phrygian', 'Harmonic Minor'].includes(scaleName);
  const maj = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  return maj[i] || String(i + 1);
}

/** Build the 7 diatonic chords of the key as arrays of MIDI notes (close voiced around octave 3-4). */
export function diatonicChords(key, scaleName, size = 3, octave = 3) {
  const sc = parentScale(scaleName);
  const out = [];
  for (let d = 0; d < 7; d++) {
    const midis = chordDegrees(d, size).map((x) => degToMidi(x, key, sc, octave));
    out.push({ degree: d, midis, name: chordName(midis) });
  }
  return out;
}

/** Choose a voicing of `midis` nearest to the previous voicing (smooth voice leading). */
export function voiceLead(midis, prev, center = 62) {
  const base = midis.slice().sort((a, b) => a - b);
  let best = base;
  let bestCost = Infinity;
  const cands = [];
  for (let inv = 0; inv < base.length; inv++) {
    const v = base.slice();
    for (let i = 0; i < inv; i++) v.push(v.shift() + 12);
    cands.push(v);
  }
  for (const v of cands) {
    for (let sh = -36; sh <= 36; sh += 12) {
      const w = v.map((x) => x + sh);
      const avg = w.reduce((a, b) => a + b, 0) / w.length;
      let cost = Math.abs(avg - center);
      if (prev && prev.length) {
        const pa = prev.reduce((a, b) => a + b, 0) / prev.length;
        cost = Math.abs(avg - pa) * 2 + Math.abs(avg - center) * 0.5;
      }
      if (cost < bestCost) { bestCost = cost; best = w; }
    }
  }
  return best;
}

export const DURATION_CHOICES = [
  { id: '1/4', label: '1/4', beats: 1 },
  { id: '1/8', label: '1/8', beats: 0.5 },
  { id: '1/16', label: '1/16', beats: 0.25 },
  { id: '1/32', label: '1/32', beats: 0.125 },
  { id: '1/8T', label: '1/8 triplet', beats: 1 / 3 },
  { id: '1/16T', label: '1/16 triplet', beats: 1 / 6 },
  { id: '1/2', label: '1/2', beats: 2 },
  { id: '1bar', label: '1 bar', beats: 4 },
  { id: 'off', label: 'Off', beats: 0 },
];
