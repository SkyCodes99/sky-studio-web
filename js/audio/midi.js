// Standard MIDI File (format 1) export of the project's instrument and drum tracks.
import { PAD_BASE, PAD_GM } from './drums.js';
import { trackNotes } from './events.js';

const PPQ = 480;
function vlq(n) {
  const out = [n & 0x7f];
  while ((n >>= 7) > 0) out.unshift((n & 0x7f) | 0x80);
  return out;
}
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >> 8) & 255, n & 255];
const str = (s) => [...s].map((c) => c.charCodeAt(0));
function chunk(id, data) { return [...str(id), ...u32(data.length), ...data]; }

export function exportMidi(project) {
  const tracks = [];
  const tempo = [];
  const mpqn = Math.round(60000000 / project.bpm);
  tempo.push(0, 0xff, 0x51, 3, (mpqn >> 16) & 255, (mpqn >> 8) & 255, mpqn & 255);
  tempo.push(0, 0xff, 0x58, 4, project.ts[0], Math.log2(project.ts[1]), 24, 8);
  const nm = str(project.name || 'Sky Studio');
  tempo.push(0, 0xff, 0x03, nm.length, ...nm);
  tempo.push(0, 0xff, 0x2f, 0);
  tracks.push(chunk('MTrk', tempo));
  let nextCh = 0;
  for (const t of project.tracks) {
    if (t.type === 'audio') continue;
    const notes = trackNotes(project, t);
    if (!notes.length) continue;
    let channel = 9;
    if (t.type !== 'drum') { if (nextCh === 9) nextCh++; channel = nextCh++ % 16; }
    const evs = [];
    for (const n of notes) {
      const pitch = t.type === 'drum' ? PAD_GM[n.p - PAD_BASE] ?? n.p : n.p;
      const on = Math.round(n.beat * PPQ), off = Math.max(on + 1, Math.round((n.beat + n.dur) * PPQ));
      evs.push({ t: on, d: [0x90 | channel, pitch & 127, Math.max(1, Math.min(127, n.v))], o: 1 });
      evs.push({ t: off, d: [0x80 | channel, pitch & 127, 0], o: 0 });
    }
    evs.sort((a, b) => a.t - b.t || a.o - b.o);
    const data = [];
    const nameBytes = str(t.name || 'Track');
    data.push(0, 0xff, 0x03, nameBytes.length, ...nameBytes);
    let last = 0;
    for (const e of evs) { data.push(...vlq(e.t - last), ...e.d); last = e.t; }
    data.push(0, 0xff, 0x2f, 0);
    tracks.push(chunk('MTrk', data));
  }
  const header = chunk('MThd', [...u16(1), ...u16(tracks.length), ...u16(PPQ)]);
  return new Uint8Array([...header, ...tracks.flat()]).buffer;
}
