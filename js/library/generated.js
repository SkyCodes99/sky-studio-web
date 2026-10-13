// Lists the generated loop library: every sensible pairing of chord progression x rhythm / bass line / arpeggio / melody style,
// plus drum-groove variations. Only small descriptions are stored; notes are made when a loop is used (buildGen).
import { PROGS3, CHORD_RHYTHMS, BASS_RHYTHMS, ARP_PATTERNS, MELODY_STYLES, fits, moodsOf } from './catalog.js';
import { genChords, genBass, genArp, genMelody, transformRows, grooveRows, GROOVES, hashSeed, rngOf } from './generator.js';

export const CHORD_TPL = Object.fromEntries(CHORD_RHYTHMS.map(([id, name, genre, inst, alt, fit, hits, extra = {}]) => [id, { id, name, genre, inst, alt, fit, hits, ...extra }]));
export const BASS_TPL = Object.fromEntries(BASS_RHYTHMS.map(([id, name, genre, inst, alt, fit, hits]) => [id, { id, name, genre, inst, alt, fit, hits }]));
export const ARP_TPL = Object.fromEntries(ARP_PATTERNS.map(([id, name, genre, inst, alt, fit, o]) => [id, { id, name, genre, inst, alt, fit, ...o }]));
export const MELODY_TPL = Object.fromEntries(MELODY_STYLES.map(([id, name, genre, inst, alt, fit, o]) => [id, { id, name, genre, inst, alt, fit, opts: o }]));
export { PROGS3 };

/** Notes for a generator description (g.t: 'c' chords, 'b' bass, 'a' arpeggio, 'm' melody). */
export function buildGen(g, proj) {
  if (g.t === 'c') return genChords(g, proj, g.custom || CHORD_TPL[g.rhythm] || CHORD_TPL.whole);
  if (g.t === 'b') return genBass(g, proj, BASS_TPL[g.rhythm] || BASS_TPL.whole);
  if (g.t === 'a') return genArp(g, proj, ARP_TPL[g.pattern] || ARP_TPL.up8);
  if (g.t === 'm') return genMelody({ ...(MELODY_TPL[g.style] ? MELODY_TPL[g.style].opts : {}), ...g }, proj);
  return null;
}

const nice = (id) => id.replace(/^sp_/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
const allGenres = (tpl, prog) => [...new Set([tpl.genre, prog.genre, ...(prog.also || [])])];

/** progs: every progression ({id,name,deg,size,genre,also?}); returns loop descriptors. */
export function generatedLoops(progs) {
  const out = [];
  const push = (l) => { l.mood = moodsOf(l.tags); out.push(l); };
  for (const p of progs) {
    for (const t of Object.values(CHORD_TPL)) {
      if (!fits(t.fit, p)) continue;
      for (const [k, inst] of [['', t.inst], ['alt', t.alt]]) {
        if (!inst) continue;
        push({ id: `g:c:${p.id}:${t.id}${k ? ':' + k : ''}`, name: `${p.name} · ${t.name}${k ? ' · ' + nice(inst) : ''}`, cat: 'Chords', genre: t.genre, prog: p.id, kind: 'inst', inst, bars: p.deg.length, tags: allGenres(t, p), pack: 'gen',
          gen: { t: 'c', prog: p.deg, size: p.size, rhythm: t.id } });
      }
    }
    for (const t of Object.values(BASS_TPL)) {
      if (!fits(t.fit, p)) continue;
      for (const [k, inst] of [['', t.inst], ['alt', t.alt]]) {
        if (!inst) continue;
        push({ id: `g:b:${p.id}:${t.id}${k ? ':' + k : ''}`, name: `${p.name} · ${t.name}${k ? ' · ' + nice(inst) : ''}`, cat: 'Bass', genre: t.genre, prog: p.id, kind: 'inst', inst, bars: p.deg.length, tags: allGenres(t, p), pack: 'gen',
          gen: { t: 'b', prog: p.deg, rhythm: t.id } });
      }
    }
    for (const t of Object.values(ARP_TPL)) {
      if (!fits(t.fit, p)) continue;
      for (const [k, inst] of [['', t.inst], ['alt', t.alt]]) {
        if (!inst) continue;
        push({ id: `g:a:${p.id}:${t.id}${k ? ':' + k : ''}`, name: `${p.name} · ${t.name}${k ? ' · ' + nice(inst) : ''}`, cat: 'Arp', genre: t.genre, prog: p.id, kind: 'inst', inst, bars: p.deg.length, tags: allGenres(t, p), pack: 'gen',
          gen: { t: 'a', prog: p.deg, size: p.size, pattern: t.id } });
      }
    }
    for (const t of Object.values(MELODY_TPL)) {
      if (!fits(t.fit, p)) continue;
      [[1, t.inst, ''], [2, t.alt, 'alt']].forEach(([seed, inst, k]) => {
        if (!inst) return;
        push({ id: `g:m:${p.id}:${t.id}:${seed}`, name: `${p.name} · ${t.name}${seed > 1 ? ' · variation ' + seed + ' · ' + nice(inst) : ''}`, cat: 'Melody', genre: t.genre, prog: p.id, kind: 'inst', inst, bars: p.deg.length, tags: allGenres(t, p), pack: 'gen',
          gen: { t: 'm', prog: p.deg, size: p.size, style: t.id, seed: hashSeed(p.id + t.id) % 9973 + seed } });
      });
    }
  }
  return out;
}

const XF = [['halftime', 'Half-Time'], ['ghost', 'Ghost Notes'], ['busyhats', 'Busy Hats'], ['sparse', 'Sparse'], ['kicks', 'Extra Kicks'], ['fill', 'With Fill'], ['openhat', 'Open Hats']];
const drumMood = (genre) => moodsOf([genre]);

/** Variations of the hand-written drum patterns + seeded genre grooves, as ready-made rows (same shape as the classic drum loops). */
export function generatedDrums(defs) {
  const out = [];
  for (const d of defs) {
    if (d.kind !== 'drum') continue;
    const len = Math.max(...Object.values(d.rows).map((s) => s.length));
    if (len / d.bars !== 16) continue;                       // only straight 16th grids are varied
    XF.forEach(([type, label]) => {
      const { rows, bars } = transformRows(d.rows, d.bars, { type, seed: 1 }, hashSeed(d.id));
      const same = Object.keys(rows).every((k) => rows[k] === d.rows[k]) && Object.keys(d.rows).every((k) => rows[k] === d.rows[k]) && bars === d.bars;
      if (same) return;
      out.push({ ...d, id: `${d.id}:${type}`, name: `${d.name} · ${label}`, rows, bars, pack: 'gen', tags: [d.genre], mood: drumMood(d.genre) });
    });
  }
  for (const [genre, G] of Object.entries(GROOVES)) {
    for (let seed = 1; seed <= 14; seed++) {
      const r = rngOf(hashSeed(genre) + seed * 31);
      const bpm = Math.round(G.bpm[0] + r() * (G.bpm[1] - G.bpm[0]));
      const density = 0.35 + (seed % 5) * 0.12;
      const rows = grooveRows(genre, seed, density);
      if (!Object.keys(rows).length) continue;
      out.push({ id: `d:g:${genre.toLowerCase().replace(/[^a-z]/g, '')}:${seed}`, name: `${genre} Groove ${String(seed).padStart(2, '0')}`, cat: 'Drums', genre, bpm, bars: 1, kind: 'drum', rows, swing: G.swing || 0, pack: 'gen', tags: [genre], mood: drumMood(genre) });
    }
  }
  return out;
}
