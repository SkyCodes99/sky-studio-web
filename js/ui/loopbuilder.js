// Loop Builder: make your own drum, chord, bass, arpeggio or melody loop from a few choices, hear it, and add it to the song or keep it.
import { h } from '../util.js';
import { modal, button, toast, segmented } from './widgets.js';
import { INSTRUMENTS, INST_CATS, INST_BY_ID } from '../audio/instruments.js';
import { KITS, KIT_BY_ID } from '../audio/drums.js';
import { ALL_PROGS, DRUM_BASES, buildLoop } from '../library/loops.js';
import { CHORD_TPL, BASS_TPL, ARP_TPL, MELODY_TPL } from '../library/generated.js';
import { MELODY_RHYTHMS, CONTOUR_NAMES, GROOVES, GROOVE_NAMES, grooveRows, transformRows, parseProgression, hashSeed } from '../library/generator.js';
import { auditionLoop } from './preview.js';
import { loopCompatible } from '../app.js';
import { NOTE_NAMES } from '../theory.js';

const TYPES = [{ id: 'drums', label: 'Drums' }, { id: 'chords', label: 'Chords' }, { id: 'bass', label: 'Bass' }, { id: 'arp', label: 'Arpeggio' }, { id: 'melody', label: 'Melody' }];
const XFS = [['', 'As written'], ['halftime', 'Half-time'], ['ghost', 'Ghost notes'], ['busyhats', 'Busy hats'], ['sparse', 'Sparse'], ['kicks', 'Extra kicks'], ['fill', 'With a fill'], ['openhat', 'Open hats']];
const RATES = [[1, 'Quarter notes'], [0.5, 'Eighth notes'], [1 / 3, 'Eighth triplets'], [0.25, 'Sixteenth notes'], [1 / 6, 'Sixteenth triplets']];
const nice = (s) => s.replace(/^./, (c) => c.toUpperCase());

export function showLoopBuilder(app) {
  const P = app.project;
  const sel = app.selTrack;
  const S = {
    type: sel && sel.type === 'drum' ? 'drums' : 'chords', progId: 'pop', customProg: '1 5 6 4', size: 3, bars: 0,
    chordTpl: 'eighths', bassTpl: 'half5', arpTpl: 'up8', style: 'pophook', register: 61, open: false, strum: 0, bassDouble: false,
    oct: 2, rate: 0, octaves: 1, gate: 0, melRhythm: '', contour: '', range: 0, steps: 0, repeat: -1, rest: -1, melOct: 4, seed: 1,
    inst: sel && sel.type === 'inst' ? sel.inst : 'piano', kit: sel && sel.type === 'drum' ? sel.kit : '808',
    genre: 'Hip-Hop', density: 0.55, base: '', xf: '', swing: 0, humanize: 0, name: '',
  };
  let loop = null, playing = false;
  const body = h('div', { class: 'lb' });
  const preview = h('canvas', { class: 'lb-canvas', width: 640, height: 150 });
  const info = h('div', { class: 'hint', style: { margin: '4px 0 0' } });
  let box = null;

  const prog = () => (S.progId === 'custom' ? { id: 'custom', name: 'Custom', deg: parseProgression(S.customProg).length ? parseProgression(S.customProg) : [0], size: S.size, genre: 'Pop' } : ALL_PROGS.find((p) => p.id === S.progId) || ALL_PROGS[0]);
  const instOptions = () => INST_CATS.flatMap((cat) => { const l = INSTRUMENTS.filter((i) => i.cat === cat); return l.length ? [h('optgroup', { label: cat }, l.map((i) => h('option', { value: i.id, selected: S.inst === i.id }, i.name)))] : []; });
  const field = (label, el, hint) => h('label', { class: 'lb-f' }, h('span', { class: 'lb-l' }, label), el, hint ? h('span', { class: 'hint' }, hint) : null);
  const select = (opts, value, onChange) => h('select', { class: 'sel', onChange: (e) => onChange(e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: String(value) === String(v) }, l)));
  const slider = (min, max, step, value, onInput, fmt) => { const out = h('span', { class: 'hint', style: { minWidth: '34px' } }, fmt(value)); const inp = h('input', { type: 'range', min, max, step, value, onInput: (e) => { const v = +e.target.value; out.textContent = fmt(v); onInput(v); } }); return h('div', { class: 'row', style: { gap: '8px' } }, inp, out); };
  const check = (label, value, onChange) => h('label', { class: 'row', style: { gap: '8px' } }, h('input', { type: 'checkbox', class: 'switch', checked: value, onChange: (e) => onChange(e.target.checked) }), h('span', {}, label));

  // ---- assemble the loop description from the choices
  function make() {
    const type = S.type, pg = prog();
    const common = { humanize: S.humanize, swing: S.swing };
    if (type === 'drums') {
      let rows, bars = S.bars || 1, genre = S.genre, bpm = 100, kit = S.kit;
      const base = S.base ? DRUM_BASES.find((d) => d.id === S.base) : null;
      if (base) {
        ({ rows, bars } = S.xf ? transformRows(base.rows, base.bars, { type: S.xf, seed: S.seed }, hashSeed(base.id)) : { rows: base.rows, bars: base.bars });
        genre = base.genre; bpm = base.bpm || 100;
      } else {
        const G = GROOVES[S.genre] || GROOVES.Pop, a = grooveRows(S.genre, S.seed, S.density), b = bars > 1 ? grooveRows(S.genre, S.seed + 1, S.density) : null;
        bpm = Math.round((G.bpm[0] + G.bpm[1]) / 2);
        rows = {};
        const lanes = new Set([...Object.keys(a), ...(b ? Object.keys(b) : [])]);
        for (const k of lanes) { const x = a[k] || '.'.repeat(16), y = b ? (b[k] || '.'.repeat(16)) : ''; rows[k] = bars === 1 ? x : bars === 2 ? x + y : x + y + x + y; }
        if (!S.swing) common.swing = G.swing || 0;
      }
      return { id: 'u:' + Date.now(), name: S.name || `${genre} drums`, cat: 'Drums', genre, bpm, bars, kind: 'drum', rows, kit, tags: [genre], mood: [], mine: true, swing: common.swing || 0, humanize: common.humanize };
    }
    const gen = { ...common, seed: S.seed, prog: pg.deg, size: S.size || pg.size, bars: S.bars || pg.deg.length };
    let name, genre, cat;
    if (type === 'chords') {
      const t = CHORD_TPL[S.chordTpl]; Object.assign(gen, { t: 'c', rhythm: S.chordTpl, open: S.open, center: S.register, strum: S.strum || undefined, bassDouble: S.bassDouble });
      name = `${pg.name} · ${t.name}`; genre = t.genre; cat = 'Chords';
    } else if (type === 'bass') {
      const t = BASS_TPL[S.bassTpl]; Object.assign(gen, { t: 'b', rhythm: S.bassTpl, oct: S.oct });
      name = `${pg.name} · ${t.name}`; genre = t.genre; cat = 'Bass';
    } else if (type === 'arp') {
      const t = ARP_TPL[S.arpTpl]; Object.assign(gen, { t: 'a', pattern: S.arpTpl, rate: S.rate || undefined, octaves: S.octaves, gate: S.gate || undefined, center: S.register - 4 });
      name = `${pg.name} · ${t.name}`; genre = t.genre; cat = 'Arp';
    } else {
      const t = MELODY_TPL[S.style]; Object.assign(gen, { t: 'm', style: S.style, rhythm: S.melRhythm || undefined, contour: S.contour || undefined, range: S.range || undefined, steps: S.steps || undefined, repeat: S.repeat >= 0 ? S.repeat : undefined, rest: S.rest >= 0 ? S.rest : undefined, oct: S.melOct });
      name = `${pg.name} · ${t.name}`; genre = t.genre; cat = 'Melody';
    }
    for (const k of Object.keys(gen)) if (gen[k] === undefined) delete gen[k];
    return { id: 'u:' + Date.now(), name: S.name || name, cat, genre, kind: 'inst', inst: S.inst, bars: gen.bars, tags: [genre], mood: [], mine: true, gen };
  }

  function refresh(restart) {
    loop = make();
    const b = buildLoop(loop, P);
    if (b) loop.bars = Math.max(1, Math.round(b.len / 4));
    draw(b);
    if (restart && playing) play();
  }

  // ---- mini piano-roll / drum-grid picture of the result
  function draw(b) {
    const cv = preview, g = cv.getContext('2d'), W = cv.width, H = cv.height;
    g.fillStyle = '#12141a'; g.fillRect(0, 0, W, H);
    if (!b || !b.notes.length) { info.textContent = 'Nothing to show yet.'; return; }
    const drum = S.type === 'drums';
    const ps = b.notes.map((n) => (drum ? n.p - 36 : n.p));
    const lo = drum ? 0 : Math.min(...ps) - 1, hi = drum ? 15 : Math.max(...ps) + 1, rows = hi - lo + 1;
    for (let beat = 0; beat <= b.len; beat++) { g.fillStyle = beat % 4 === 0 ? '#3a4050' : '#232731'; g.fillRect((beat / b.len) * W, 0, 1, H); }
    const rh = H / rows;
    g.fillStyle = '#4aa3ff';
    for (const n of b.notes) {
      const y = H - ((drum ? n.p - 36 : n.p) - lo + 1) * rh;
      g.globalAlpha = 0.4 + 0.6 * (n.v / 127);
      g.fillRect((n.s / b.len) * W, y + 0.5, Math.max(3, (n.d / b.len) * W - 1), Math.max(2, rh - 1));
    }
    g.globalAlpha = 1;
    info.textContent = `${b.notes.length} notes · ${Math.round(b.len / 4)} bar${b.len > 4 ? 's' : ''} · follows your key (${NOTE_NAMES[P.key]} ${P.scale})`;
  }

  async function play() { playing = true; await auditionLoop(app, loop, { own: true }); }
  function stop() { playing = false; app.engine.previewStopAll(); }

  // ---- the controls for each type
  function controls() {
    const c = [];
    const progField = () => [
      field('Chords', select([...ALL_PROGS.map((p) => [p.id, p.name]), ['custom', 'Type my own…']], S.progId, (v) => { S.progId = v; S.size = 0; build(); })),
      S.progId === 'custom' ? field('Progression', h('input', { class: 'txt', value: S.customProg, placeholder: 'e.g. 1 5 6 4  or  ii V I', onInput: (e) => { S.customProg = e.target.value; refresh(true); }, onKeyDown: (e) => e.stopPropagation() }), 'Numbers 1-7 or roman numerals, separated by spaces') : null,
      field('Chord size', select([[0, 'Automatic'], [3, 'Triads'], [4, 'Sevenths'], [5, 'Ninths']], S.size, (v) => { S.size = +v; refresh(true); })),
      field('Bars', select([[0, 'One pass'], [1, '1 bar'], [2, '2 bars'], [4, '4 bars'], [8, '8 bars'], [16, '16 bars']], S.bars, (v) => { S.bars = +v; refresh(true); }), 'The progression repeats to fill them'),
    ];
    const instField = () => field('Sound', h('select', { class: 'sel', onChange: (e) => { S.inst = e.target.value; refresh(true); } }, instOptions()));
    if (S.type === 'drums') {
      c.push(field('Start from', select([['', 'A genre groove (new each time)'], ...DRUM_BASES.map((d) => [d.id, d.name + ' — ' + d.genre])], S.base, (v) => { S.base = v; build(); })));
      if (!S.base) { c.push(field('Style', select(GROOVE_NAMES.map((g) => [g, g]), S.genre, (v) => { S.genre = v; refresh(true); })), field('Busyness', slider(0, 1, 0.01, S.density, (v) => { S.density = v; refresh(true); }, (v) => Math.round(v * 100) + '%'))); }
      else c.push(field('Variation', select(XFS, S.xf, (v) => { S.xf = v; refresh(true); })));
      c.push(field('Drum kit', select(KITS.map((k) => [k.id, k.name]), S.kit, (v) => { S.kit = v; refresh(true); })),
        field('Bars', select([[1, '1 bar'], [2, '2 bars'], [4, '4 bars']], S.bars || 1, (v) => { S.bars = +v; refresh(true); })));
    } else if (S.type === 'chords') {
      c.push(...progField(), field('Rhythm', select(Object.values(CHORD_TPL).map((t) => [t.id, `${t.name}  ·  ${t.genre}`]), S.chordTpl, (v) => { S.chordTpl = v; S.inst = CHORD_TPL[v].inst; build(); })), instField(),
        field('Register', select([[52, 'Low'], [61, 'Middle'], [70, 'High']], S.register, (v) => { S.register = +v; refresh(true); })),
        field('Strum', slider(0, 0.12, 0.005, S.strum, (v) => { S.strum = v; refresh(true); }, (v) => (v ? Math.round(v * 1000) + ' ms' : 'off'))),
        check('Open (spread) voicing', S.open, (v) => { S.open = v; refresh(true); }), check('Add the low root underneath', S.bassDouble, (v) => { S.bassDouble = v; refresh(true); }));
    } else if (S.type === 'bass') {
      c.push(...progField(), field('Bass line', select(Object.values(BASS_TPL).map((t) => [t.id, `${t.name}  ·  ${t.genre}`]), S.bassTpl, (v) => { S.bassTpl = v; S.inst = BASS_TPL[v].inst; build(); })), instField(),
        field('Octave', select([[1, 'Very low'], [2, 'Low'], [3, 'Higher']], S.oct, (v) => { S.oct = +v; refresh(true); })));
    } else if (S.type === 'arp') {
      c.push(...progField(), field('Pattern', select(Object.values(ARP_TPL).map((t) => [t.id, `${t.name}  ·  ${t.genre}`]), S.arpTpl, (v) => { S.arpTpl = v; S.inst = ARP_TPL[v].inst; build(); })), instField(),
        field('Speed', select([[0, 'Pattern default'], ...RATES], S.rate, (v) => { S.rate = +v; refresh(true); })),
        field('Octaves', select([[1, '1'], [2, '2'], [3, '3']], S.octaves, (v) => { S.octaves = +v; refresh(true); })),
        field('Note length', slider(0.3, 2.5, 0.05, S.gate || ARP_TPL[S.arpTpl].gate || 0.8, (v) => { S.gate = v; refresh(true); }, (v) => v.toFixed(2) + '×')),
        field('Register', select([[52, 'Low'], [61, 'Middle'], [70, 'High']], S.register, (v) => { S.register = +v; refresh(true); })));
    } else {
      const st = MELODY_TPL[S.style].opts;
      c.push(...progField(), field('Style', select(Object.values(MELODY_TPL).map((t) => [t.id, `${t.name}  ·  ${t.genre}`]), S.style, (v) => { S.style = v; S.inst = MELODY_TPL[v].inst; build(); })), instField(),
        field('Rhythm', select([['', 'Style default'], ...Object.keys(MELODY_RHYTHMS).map((k) => [k, nice(k)])], S.melRhythm, (v) => { S.melRhythm = v; refresh(true); })),
        field('Shape', select([['', 'Style default'], ...CONTOUR_NAMES.map((k) => [k, nice(k)])], S.contour, (v) => { S.contour = v; refresh(true); })),
        field('Range', slider(3, 14, 1, S.range || st.range, (v) => { S.range = v; refresh(true); }, (v) => v + ' notes')),
        field('Biggest jump', slider(1, 4, 1, S.steps || st.steps, (v) => { S.steps = v; refresh(true); }, (v) => v + ' steps')),
        field('Repeats a phrase', slider(0, 1, 0.05, S.repeat >= 0 ? S.repeat : st.repeat, (v) => { S.repeat = v; refresh(true); }, (v) => Math.round(v * 100) + '%')),
        field('Rests', slider(0, 0.4, 0.02, S.rest >= 0 ? S.rest : st.rest, (v) => { S.rest = v; refresh(true); }, (v) => Math.round(v * 100) + '%')),
        field('Octave', select([[3, 'Low'], [4, 'Middle'], [5, 'High']], S.melOct, (v) => { S.melOct = +v; refresh(true); })));
    }
    c.push(field('Timing feel', slider(0, 0.6, 0.02, S.swing, (v) => { S.swing = v; refresh(true); }, (v) => (v ? 'swing ' + Math.round(v * 100) + '%' : 'straight'))),
      field('Human touch', slider(0, 1, 0.05, S.humanize, (v) => { S.humanize = v; refresh(true); }, (v) => (v ? Math.round(v * 100) + '%' : 'robotic'))));
    return c;
  }

  function surprise() {                                   // pick a fresh random combination for the current tab
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    S.seed = 1 + Math.floor(Math.random() * 9000);
    if (S.type === 'drums') { if (S.base) S.xf = pick(XFS)[0]; else S.genre = pick(GROOVE_NAMES); S.density = 0.3 + Math.random() * 0.6; }
    else {
      S.progId = pick(ALL_PROGS).id; S.size = 0;
      if (S.type === 'chords') { S.chordTpl = pick(Object.keys(CHORD_TPL)); S.inst = CHORD_TPL[S.chordTpl].inst; }
      if (S.type === 'bass') { S.bassTpl = pick(Object.keys(BASS_TPL)); S.inst = BASS_TPL[S.bassTpl].inst; }
      if (S.type === 'arp') { S.arpTpl = pick(Object.keys(ARP_TPL)); S.inst = ARP_TPL[S.arpTpl].inst; }
      if (S.type === 'melody') { S.style = pick(Object.keys(MELODY_TPL)); S.inst = MELODY_TPL[S.style].inst; S.contour = pick(CONTOUR_NAMES); S.melRhythm = pick(Object.keys(MELODY_RHYTHMS)); }
    }
    build(true);
  }

  const tabs = segmented(TYPES, S.type, (t) => { S.type = t; if (t !== 'drums') { const d = t === 'chords' ? CHORD_TPL[S.chordTpl] : t === 'bass' ? BASS_TPL[S.bassTpl] : t === 'arp' ? ARP_TPL[S.arpTpl] : MELODY_TPL[S.style]; if (!(sel && sel.type === 'inst')) S.inst = d.inst; } S.bars = 0; S.name = ''; build(true); });
  function build(restart) {
    tabs.set(S.type);
    body.replaceChildren(h('div', { class: 'lb-grid' }, controls()));
    refresh(restart);
  }

  function add() {
    refresh(false);
    const l = { ...loop };
    const cur = app.selTrack;
    const same = cur && (l.kind === 'drum' ? cur.type === 'drum' && cur.kit === l.kit : cur.type === 'inst' && cur.inst === l.inst && loopCompatible(cur, l));
    app.addLoop(l, same ? { trackId: cur.id } : { newTrack: true });
    toast('Added “' + l.name + '” to your song');
  }
  function save() {
    refresh(false);
    const l = { ...loop, id: 'u:' + Date.now().toString(36), name: (S.name || loop.name) };
    app.settings.userLoops = [l, ...(app.settings.userLoops || [])].slice(0, 300);
    app.saveSettings(); app.emit('loopsChanged');
    toast(`Saved “${l.name}” — find it under Loops › Mine`);
  }

  const nameInp = h('input', { class: 'txt', placeholder: 'Name (optional)', style: { width: '190px' }, onInput: (e) => { S.name = e.target.value; }, onKeyDown: (e) => e.stopPropagation() });
  box = modal('Loop Builder', h('div', {}, h('div', { class: 'row wrap', style: { justifyContent: 'space-between', gap: '10px', margin: '2px 0 10px' } }, tabs,
    h('div', { class: 'row', style: { gap: '8px' } }, button('Surprise me', surprise, { icon: 'magic', class: 'sm' }), button('New variation', () => { S.seed = 1 + Math.floor(Math.random() * 9000); refresh(true); }, { class: 'sm' }))),
    body, preview, info,
    h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '10px' } }, button('▶ Play / stop', () => (playing ? stop() : play()), { class: 'sm' }), nameInp, h('span', { style: { flex: 1 } }),
      button('Save to My loops', save, { class: 'sm' }), button('Add to song', add, { class: 'sm primary' }))),
    [{ label: 'Close', onClick: () => stop() }], { width: 760, onClose: () => stop() });
  build(false);
}
