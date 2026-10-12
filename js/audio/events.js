// Pure project -> timed events. Shared by the live scheduler, the offline exporter and the MIDI exporter.
import { PAD_BASE } from './drums.js';

export const beatsPerBar = (ts) => (ts[0] * 4) / ts[1];
export const faderGain = (p) => (p <= 0.001 ? 0 : Math.pow(p / 0.8, 2.4));

/** Delay the off-beat 16ths for a swing feel (only notes sitting exactly on the grid are moved). */
export function swingBeat(beat, swing) {
  if (!swing) return beat;
  const u = 0.25;
  const cell = Math.round(beat / u);
  if (cell % 2 === 1 && Math.abs(beat - cell * u) < 0.002) return beat + (swing * u) / 3;
  return beat;
}

/** Turn a chord region's notes into an arpeggio according to the track's arp settings. */
export function arpExpand(notes, arp) {
  const rate = arp.rate || 0.25;
  const sorted = notes.slice().sort((a, b) => a.s - b.s || a.p - b.p);
  const groups = [];
  for (const n of sorted) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(n.s - g.s) < 0.04) { g.notes.push(n); g.d = Math.max(g.d, n.d); }
    else groups.push({ s: n.s, d: n.d, notes: [n] });
  }
  const out = [];
  for (const g of groups) {
    const pitches = [...new Set(g.notes.map((n) => n.p))].sort((a, b) => a - b);
    let seq = [];
    for (let o = 0; o < (arp.oct || 1); o++) for (const p of pitches) seq.push(p + 12 * o);
    if (arp.mode === 'down') seq.reverse();
    else if (arp.mode === 'updown') seq = seq.concat(seq.slice(1, -1).reverse());
    else if (arp.mode === 'random') {
      let s = Math.round(g.s * 100) + 17;
      const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
      seq = seq.map(() => seq[Math.floor(r() * seq.length)]);
    } else if (arp.mode === 'played') seq = g.notes.map((n) => n.p);
    const vel = Math.max(...g.notes.map((n) => n.v));
    const steps = Math.max(1, Math.round((g.d + 1e-6) / rate));
    for (let i = 0; i < steps; i++) out.push({ s: g.s + i * rate, d: rate * (arp.gate ?? 0.8), p: seq[i % seq.length], v: Math.round(vel * (i % 4 === 0 ? 1 : 0.82)) });
  }
  return out;
}

/** Call cb(beat, dur, pitch, vel) for every note of a region that starts inside [b0, b1) (region looping + swing + arp applied). */
export function forEachNote(project, track, region, b0, b1, cb) {
  const L = region.loopLen || region.len;
  const rs = region.start, re = region.start + region.len;
  if (re <= b0) return;
  const notes = track.arp && track.arp.on && track.type === 'inst' ? arpExpand(region.notes, track.arp) : region.notes;
  const k0 = Math.max(0, Math.floor((b0 - rs) / L) - 0);
  for (let k = k0; rs + k * L < re && rs + k * L < b1 + 0.2; k++) {
    const base = rs + k * L;
    for (const n of notes) {
      if (n.s >= L) continue;
      const beat = swingBeat(base + n.s, project.swing);
      if (beat < b0 || beat >= b1 || beat >= re) continue;
      cb(beat, Math.max(0.02, Math.min(n.d, re - beat, base + L - (base + n.s))), n.p, n.v);
    }
  }
}

/** Events within [b0, b1). `underway` also returns audio clips that started before b0 but are still sounding. */
export function collectEvents(project, b0, b1, underway = false) {
  const ev = [];
  for (const tr of project.tracks) {
    for (const r of tr.regions) {
      const rs = r.start, re = r.start + r.len;
      if (re <= b0 || rs >= b1 + 0.5) continue;
      if (tr.type === 'audio') {
        const asset = project.assets && project.assets[r.asset];
        if (!asset) continue;
        let beat = rs, off = r.offset || 0;
        const rate = r.rate || 1;
        if (rs < b0) {
          if (!underway) continue;
          beat = b0;
          off += ((b0 - rs) * 60) / project.bpm * rate;
        } else if (rs >= b1) continue;
        ev.push({ beat, type: 'audio', track: tr, region: r, offset: off, durBeats: re - beat });
      } else {
        forEachNote(project, tr, r, b0, b1, (beat, dur, p, v) => ev.push({ beat, type: 'note', track: tr, midi: p, vel: v, dur }));
      }
    }
  }
  ev.sort((a, b) => a.beat - b.beat);
  return ev;
}

export function regionEnd(r) { return r.start + r.len; }
export function projectEndBeat(project) {
  let e = 0;
  for (const t of project.tracks) for (const r of t.regions) e = Math.max(e, r.start + r.len);
  return e;
}
export const padOf = (midi) => midi - PAD_BASE;

/** Flatten a track into absolute-position notes (for MIDI export). */
export function trackNotes(project, track) {
  const out = [];
  const end = projectEndBeat(project);
  for (const r of track.regions) {
    if (track.type === 'audio') continue;
    forEachNote({ ...project, swing: 0 }, track, r, 0, end + 1, (beat, dur, p, v) => out.push({ beat, dur, p, v }));
  }
  return out.sort((a, b) => a.beat - b.beat);
}
