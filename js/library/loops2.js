// Loop library 2: jazz, bossa, Latin, world, cinematic, orchestral, techno, dub, funk, glitch, ambient, neo-soul, afrobeat…
// Same building blocks as loops.js; loops.js merges everything exported here into the main library.
// Drum rows are step strings (x normal, X accent, o ghost, s soft); 12-step rows are triplet grids for swing / 6-8 feels.

// [id, name, genre, bpm, bars, rows, extra]  (extra.kit = the kit that suits the loop)
export const DRUMS2 = [
  // ---- jazz (jazz kit)
  ['jazzswing1', 'Swing Ride', 'Jazz', 130, 1, { ride: 'x..x.xx..x.x', hat2: '...x.....x..', kick: 'o..o..o..o..', snare: '.....o....o.' }, { kit: 'jazz' }],
  ['jazzswing2', 'Swing Comping Fast', 'Jazz', 160, 1, { ride: 'x..x.xx..x.x', hat2: '...x.....x..', snare: 'o.....o..o..', kick: 'x.....o.....' }, { kit: 'jazz' }],
  ['jazzbrush', 'Brush Ballad', 'Jazz', 72, 1, { bell: 'x...........', snare: '...x.....x..', kick: 'o...........', hat2: '...s.....s..' }, { kit: 'jazz' }],
  ['jazzlatin', 'Latin Jazz Swing', 'Jazz', 150, 1, { rim: 'x..x..x...x.x...', ride: 'x.x.x.x.x.x.x.x.', kick: 'x.....x.x.....x.', hat2: '....x.......x...' }, { kit: 'jazz' }],
  // ---- bossa / latin (latin kit)
  ['bossa1', 'Bossa Nova', 'Latin', 120, 1, { kick: 'x.....x.x.....x.', rim: 'x..x..x...x..x..', hat: 'x.x.x.x.x.x.x.x.' }, { kit: 'latin' }],
  ['bossa2', 'Bossa Brushes', 'Latin', 108, 1, { kick: 'x.....x.x.....x.', rim: 'x..x..x...x..x..', hat: 'xsxsxsxsxsxsxsxs', ohat: '..............s.' }, { kit: 'latin' }],
  ['sonclave', 'Son Clave 3-2', 'Latin', 100, 1, { rim: 'x..x..x...x.x...', bell: 'x...x...x...x...', tomL: '..x...x...x...x.', tomM: '.o.o.o.o.o.o.o.o', kick: 'x.......x.......' }, { kit: 'latin' }],
  ['rumbaclave', 'Rumba Clave', 'Latin', 96, 1, { rim: 'x..x...x..x.x...', tomL: 'x.....x.x.....x.', tomH: '..x.o.x...x.o.x.', hat: 'x.x.x.x.x.x.x.x.' }, { kit: 'latin' }],
  ['tumbao', 'Conga Tumbao', 'Latin', 105, 1, { tomH: '..xo..xo..xo..xo', tomL: 'x...x...x...x...', tomM: '....x.......x...', rim: 'x..x..x...x.x...', hat2: 'x.x.x.x.x.x.x.x.' }, { kit: 'latin' }],
  ['batucada', 'Samba Batucada', 'Latin', 98, 1, { kick: 'x..x..x.x..x..x.', kick2: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx', hat2: '.x.x.x.x.x.x.x.x', rim: 'x..x..x.x..x..x.', ohat: 'x...x...x...x...' }, { kit: 'latin' }],
  ['cumbia', 'Cumbia', 'Latin', 92, 1, { kick: 'x...x...x...x...', ohat: 'x.xx.xx.x.xx.xx.', hat: '..x...x...x...x.', tomL: 'x.......x.......', tomH: '....x.......x...' }, { kit: 'latin' }],
  ['bolero', 'Bolero Pulse', 'Latin', 84, 1, { kick: 'x.......x.......', rim: 'x..x..x...x..x..', tomL: '..x...x...x...x.', hat: 'xsxsxsxsxsxsxsxs' }, { kit: 'latin' }],
  // ---- world (world kit)
  ['maqsum', 'Maqsum (Doumbek)', 'World', 100, 1, { kick: 'x.......x.......', snare: '..x...x.....x...', hat: 'x.x.x.x.x.x.x.x.', rim: '......s.......s.' }, { kit: 'world' }],
  ['baladi', 'Baladi', 'World', 96, 1, { kick: 'x.x.....x.......', snare: '......x.....x...', hat: '..x...x...x...x.', rim: '..............s.' }, { kit: 'world' }],
  ['westafrica', 'West African Ensemble', 'World', 110, 1, { bell: 'x.x.xx.x.x.x', tomL: 'x.....x.....', kick: 'x.....x.x...', hat: '..x...x...x.', shaker: 'x.x.x.x.x.x.' }, { kit: 'world' }],
  ['djembe', 'Djembe Call', 'World', 104, 1, { kick: 'x.....x...x.....', hat: '..x...x...x.x...', hat2: '...o..o...o..o..', tomL: 'x.......x.......', shaker: 'xxxxxxxxxxxxxxxx' }, { kit: 'world' }],
  ['framedrum', 'Frame Drum Trance', 'World', 88, 1, { crash: 'x...x.x.x...x.x.', ride: '.o..o.o.o..o.o..'.slice(0, 16), kick: 'x.......x.......', shaker: 'sxsxsxsxsxsxsxsx' }, { kit: 'world' }],
  ['tala', 'Tala Cycle', 'World', 110, 1, { kick: 'x..xx..xx......x', snare: '.xx..xx..xx..xx.', hat: 'x.x.x.x.x.x.x.x.', bell: 'x...............' }, { kit: 'world' }],
  // ---- cinematic (cinema kit)
  ['epicmarch', 'Epic Taiko March', 'Cinematic', 100, 1, { kick: 'x...x...x...x...', kick2: '..x...x...x...x.', tomL: 'x.x.....x.x.....', snare: '....x.......x...', crash: 'x...............' }, { kit: 'cinema' }],
  ['trailerpulse', 'Trailer Pulse', 'Cinematic', 140, 1, { hat: 'x.x.x.x.x.x.x.x.', kick: 'x.......x.......', kick2: '..x...x...x...x.', crash: 'x...............', bell: '............x...' }, { kit: 'cinema' }],
  ['tomsbuild', 'Rolling Toms Build', 'Cinematic', 120, 1, { tomL: 'xxxx............', tomM: '....xxxx........', tomH: '........xxxx....', kick: '............x...', crash: '............X...' }, { kit: 'cinema' }],
  ['heartbeat', 'Heartbeat Tension', 'Cinematic', 60, 1, { kick: 'x.x.............', kick2: '................', hat2: '..............s.', snare: '................' }, { kit: 'cinema' }],
  ['wardrums', 'War Drums Slow', 'Cinematic', 70, 2, { kick: 'x.......x.......x.......x.......', kick2: '....x.......x.......x.......x...', tomL: '..x...x...x...x...x...x...x...x.', snare: '................x...............' }, { kit: 'cinema' }],
  ['forge', 'Anvil Forge', 'Cinematic', 90, 1, { bell: 'x...x...x...x...', kick: 'x.......x.......', hat: '..x...x...x...x.', crash: 'x...............' }, { kit: 'cinema' }],
  // ---- orchestral (orch kit)
  ['timpgallop', 'Timpani Gallop', 'Cinematic', 120, 1, { tomL: 'x.xxx.xxx.xxx.xx', tomM: '................', kick: 'x...............', crash: 'x...............' }, { kit: 'orch' }],
  ['timproll', 'Timpani Roll Build', 'Cinematic', 100, 1, { tomL: 'xxxxxxxx........', tomM: '........xxxxxxxx', tomH: '................', crash: '................' }, { kit: 'orch' }],
  ['snmarch', 'Snare Drum March', 'Classical', 112, 1, { snare: 'x.xoxoxox.xoxoxo', kick: 'x.......x.......', crash: 'x...............' }, { kit: 'orch' }],
  ['orchwaltzy', 'Concert Hits', 'Classical', 96, 1, { kick: 'x.......x.......', tomH: '..o...o...o...o.', hat2: 'x...x...x...x...', ride: '................' }, { kit: 'orch' }],
  // ---- techno / industrial (hardtechno kit)
  ['hardtechno1', 'Hard Techno Driver', 'Techno', 150, 1, { kick: 'x...x...x...x...', hat2: '.x.x.x.x.x.x.x.x', clap: '....x.......x...', ohat: '..x...x...x...x.' }, { kit: 'hardtechno' }],
  ['rumbletechno', 'Rumble Techno', 'Techno', 140, 1, { kick: 'x...x...x...x...', kick2: '.xxx.xxx.xxx.xxx', hat: '..x...x...x...x.', clap: '....x.......x...' }, { kit: 'hardtechno' }],
  ['industrialstomp', 'Industrial Stomp', 'Techno', 130, 1, { kick: 'X..x..X..x..X.x.', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx', crash: 'x...............' }, { kit: 'hardtechno' }],
  // ---- dub / reggae (dub kit)
  ['dubonedrop', 'Dub One Drop', 'Reggae', 72, 1, { kick: '........x.......', rim: '........x.......', hat: '..x...x...x...x.', ohat: '...............x' }, { kit: 'dub' }],
  ['dubrockers', 'Rockers', 'Reggae', 80, 1, { kick: 'x...x...x...x...', rim: '........x.......', hat: 'x.x.x.x.x.x.x.x.', ohat: '..x...x...x...x.' }, { kit: 'dub' }],
  ['dubsteppers2', 'Dub Steppers Roll', 'Reggae', 76, 2, { kick: 'x...x...x...x...x...x...x...x...', rim: '........x...............x...x...', hat: 'x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.xx', ohat: '..x...x...x...x...x...x...x...x.' }, { kit: 'dub' }],
  // ---- funk / soul (funk kit)
  ['jbbreak', 'JB Break', 'Funk', 100, 2, { kick: 'x.x.......x.x...x.x...x...x.....', snare: '....x..o.o..x..o....x..o.o..x...', hat: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', ohat: '..............x.......x.........' }, { kit: 'funk', swing: 0.08 }],
  ['motown', 'Motown Stomp', 'Soul', 112, 1, { kick: 'x...x.x.x...x.x.', snare: '....x.......x...', clap: '....x.......x...', shaker: 'xxxxxxxxxxxxxxxx' }, { kit: 'funk' }],
  ['neosoul', 'Neo-Soul Drag', 'R&B', 84, 1, { kick: 'x..x.....x.x....', snare: '....x.......x..o', hat: 'x.x.x.x.x.x.x.x.', rim: '.o.....o....o...', shaker: '.s.s.s.s.s.s.s.s' }, { kit: 'funk', swing: 0.14 }],
  // ---- electronic textures
  ['glitch1', 'Glitch Stutter', 'Glitch', 110, 1, { kick: 'x..x....x...x..x', snare: '....x..x....x.xx', hat: 'xx.x.xx.x.xx.x.x', hat2: '...x..x...x.....', tomH: '.........x.x....' }, { kit: 'glitch' }],
  ['glitch2', 'Glitch Skitter', 'Glitch', 130, 2, { kick: 'x.....x..x..x...x.x.....x..x...x', snare: '....x.......x..x....x......x.x...', hat: 'x.xx.x.xx.x.xx.xx.x.xx.xx.x.x.xx', tomM: '..............x.........x.......' }, { kit: 'glitch' }],
  ['ambtick', 'Ticking Texture', 'Ambient', 80, 2, { hat: 'x.x...x...x.x...x...x.x...x..x..', hat2: '..x.....x.....x...x.....x.......', kick: 'x...............x...............', ohat: '..............x...............x.' }, { kit: 'ambient' }],
  ['ambrain', 'Glass Rain', 'Ambient', 70, 1, { ride: 'x..x...x.x....x.', bell: '..x....x....x...', hat: '.s..s..s.s..s...', kick: 'x...............' }, { kit: 'ambient' }],
  // ---- afro / pop / others on existing kits
  ['afrobeat', 'Afrobeat Groove', 'Afro', 105, 1, { kick: 'x..x..x...x.....', rim: '..x..x..x..x...x', shaker: 'xxxxxxxxxxxxxxxx', tomH: '....x.......x...', tomL: 'x.....x.........', bell: 'x.x.x..x.x.x..x.' }, { kit: 'afro' }],
  ['highlife', 'Highlife Bounce', 'Afro', 118, 1, { kick: 'x...x...x...x...', rim: '..x...x...x...x.', shaker: 'x.xxx.xxx.xxx.xx', bell: 'x..x..x.x..x..x.' }, { kit: 'afro' }],
  ['bhangra', 'Bhangra Dhol', 'World', 108, 1, { kick: 'x..x..x.x..x..x.', snare: '....x.......x...', tomH: '..x...x...x...x.', hat: 'x.x.x.x.x.x.x.x.', bell: '.o.o.o.o.o.o.o.o' }, { kit: 'world' }],
  ['jpop', 'J-Pop Bounce', 'Pop', 138, 1, { kick: 'x...x..x..x.x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', clap: '....x.......x..x', ohat: '..x...x...x...x.' }, { kit: 'studio' }],
  ['gospelshuffle', 'Gospel Shuffle', 'Soul', 90, 1, { kick: 'x..x..x..x..', snare: '...x.....x..', hat: 'x.xx.xx.xx.x', clap: '...x.....x..' }, { kit: 'studio' }],
  ['bluesshuffle', 'Blues Shuffle', 'Blues', 100, 1, { kick: 'x.....x.....', snare: '...x.....x..', hat: 'x.xx.xx.xx.x' }, { kit: 'studio' }],
];

// ---------------------------------------------------------------- chord progressions (scale degrees, 0 = tonic)
export const PROGS2 = [
  { id: 'jazz251', name: 'Jazz ii–V–I', deg: [1, 4, 0, 0], size: 4, mode: 'major', genre: 'Jazz' },
  { id: 'jazzmin', name: 'Minor ii–V–i', deg: [1, 4, 0, 0], size: 4, mode: 'minor', genre: 'Jazz' },
  { id: 'jazzcircle', name: 'Circle (iii vi ii V)', deg: [2, 5, 1, 4], size: 4, mode: 'major', genre: 'Jazz' },
  { id: 'bossa', name: 'Bossa (I ii V I)', deg: [0, 1, 4, 0], size: 4, mode: 'major', genre: 'Latin' },
  { id: 'blues', name: 'Blues (I IV I V)', deg: [0, 3, 0, 4], size: 4, mode: 'major', genre: 'Blues' },
  { id: 'modal', name: 'Modal Vamp (i VII)', deg: [0, 6, 0, 6], size: 3, mode: 'minor', genre: 'Chill' },
  { id: 'cinema2', name: 'Heroic (i VI iv v)', deg: [0, 5, 3, 4], size: 3, mode: 'minor', genre: 'Cinematic' },
  { id: 'canon', name: 'Canon (I V vi iii IV I IV V)', deg: [0, 4, 5, 2, 3, 0, 3, 4], size: 3, mode: 'major', genre: 'Classical' },
  { id: 'jpop', name: 'Royal Road (IV V iii vi)', deg: [3, 4, 2, 5], size: 4, mode: 'major', genre: 'Pop' },
  { id: 'neosoul', name: 'Neo-Soul (IV iii vi ii)', deg: [3, 2, 5, 1], size: 4, mode: 'major', genre: 'R&B' },
  { id: 'afro', name: 'Afro (I IV V IV)', deg: [0, 3, 4, 3], size: 3, mode: 'major', genre: 'Afro' },
];

// ---------------------------------------------------------------- styles. `progs` limits which progressions a style is paired with.
const chord = (v, pts, len = 0.45) => pts.flatMap(([s, d, vel], k) => v.map((p, i) => ({ s: s + i * 0.015, d: d ?? len, p, v: vel - i * 2 })));

export const CHORD2 = [
  { id: 'swing', name: 'Swing Comping', genre: 'Jazz', inst: 'piano', progs: ['jazz251', 'jazzmin', 'jazzcircle', 'blues', 'bossa'], bar: (v) => chord(v, [[0, 1.2, 86], [1.5, 0.7, 72], [3.5, 0.4, 56]]) },
  { id: 'jazzfelt', name: 'Soft Jazz Chords', genre: 'Jazz', inst: 'feltpiano', progs: ['jazz251', 'jazzmin', 'jazzcircle', 'bossa', 'neosoul', 'jpop'], bar: (v) => chord(v, [[0, 1.8, 76], [2.5, 1.2, 64]]) },
  { id: 'bossacomp', name: 'Bossa Guitar', genre: 'Latin', inst: 'nylon', progs: ['bossa', 'jazz251', 'jazzcircle', 'neosoul'], bar: (v) => chord(v, [[0, 0.95, 84], [1.5, 0.45, 70], [2, 0.45, 66], [3.5, 0.45, 72]]) },
  { id: 'orchhold', name: 'Orchestral Strings', genre: 'Cinematic', inst: 'strings', progs: ['cinema2', 'canon', 'epic', 'sad', 'jazzmin'], bar: (v) => [...v.map((p) => ({ s: 0, d: 3.95, p, v: 76 })), { s: 0, d: 3.95, p: v[0] - 12, v: 70 }] },
  { id: 'brasshits', name: 'Brass Hits', genre: 'Cinematic', inst: 'brasshit', progs: ['cinema2', 'epic', 'afro'], bar: (v) => chord(v, [[0, 0.9, 100], [1.5, 0.45, 88], [3, 0.9, 96]]) },
  { id: 'staccato', name: 'Driving Staccato Strings', genre: 'Cinematic', inst: 'stacstrings', progs: ['cinema2', 'epic', 'trapmin'], bar: (v) => Array.from({ length: 8 }, (_, i) => v.map((p) => ({ s: i * 0.5, d: 0.3, p, v: i % 2 ? 70 : 92 }))).flat() },
  { id: 'rhodesslow', name: 'Neo-Soul Keys', genre: 'R&B', inst: 'dynorhodes', progs: ['neosoul', 'jazz251', 'jazzcircle', 'soul', 'lofi'], bar: (v) => chord(v, [[0, 1.9, 82], [2.25, 0.5, 62], [3, 0.9, 72]]) },
  { id: 'organvamp', name: 'Gospel Organ', genre: 'Blues', inst: 'rockorgan', progs: ['blues', 'gospel', 'afro'], bar: (v) => chord(v.slice(0, 3), [[0, 1.9, 80], [2, 1.9, 74]]) },
  { id: 'skank', name: 'Reggae Skank', genre: 'Reggae', inst: 'muteguitar', progs: ['modal', 'afro', 'blues'], bar: (v) => chord(v, [[0.5, 0.3, 90], [1.5, 0.3, 90], [2.5, 0.3, 90], [3.5, 0.3, 90]]) },
  { id: 'harmoniumdrone', name: 'Harmonium Drone', genre: 'World', inst: 'harmonium', progs: ['modal', 'cinema2', 'afro'], bar: (v) => [...v.map((p) => ({ s: 0, d: 3.9, p, v: 70 })), { s: 0, d: 3.9, p: v[0] - 12, v: 66 }] },
  { id: 'cathedral', name: 'Cathedral Voices', genre: 'Cinematic', inst: 'malechoir', progs: ['cinema2', 'canon', 'modal'], bar: (v) => v.map((p) => ({ s: 0, d: 3.95, p: p - 12, v: 70 })) },
  { id: 'harmonicapad', name: 'Glass Harmonica Pad', genre: 'Chill', inst: 'glassharm', progs: ['canon', 'jpop', 'neosoul'], bar: (v) => v.map((p) => ({ s: 0, d: 3.95, p, v: 70 })) },
];

export const ARP2 = [
  { id: 'handpan', name: 'Handpan Pattern', genre: 'World', inst: 'handpan', progs: ['modal', 'cinema2', 'afro', 'canon'], bar: (v) => Array.from({ length: 16 }, (_, i) => ({ s: i * 0.25, d: 0.3, p: v[[0, 1, 2, 1, 0, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1][i] % v.length] + (i % 8 === 6 ? 12 : 0), v: i % 4 === 0 ? 96 : 72 })) },
  { id: 'koto', name: 'Koto Run', genre: 'World', inst: 'koto', progs: ['jpop', 'cinema2', 'modal'], bar: (v) => { const s = [v[0], v[1], v[2], v[1] + 12, v[2] + 12, v[1] + 12, v[2], v[1]]; return s.map((p, i) => ({ s: i * 0.5, d: 0.42, p, v: i === 0 ? 92 : 76 })); } },
  { id: 'musicbox', name: 'Celesta Sparkle', genre: 'Chill', inst: 'celesta', progs: ['jpop', 'canon', 'neosoul'], bar: (v) => Array.from({ length: 16 }, (_, i) => ({ s: i * 0.25, d: 0.22, p: v[i % v.length] + 12 + (Math.floor(i / v.length) % 2) * 12, v: i % 4 === 0 ? 86 : 62 })) },
  { id: 'korarun', name: 'Kora Rolling', genre: 'Afro', inst: 'kora', progs: ['afro', 'modal', 'jpop'], bar: (v) => Array.from({ length: 12 }, (_, i) => ({ s: i * (4 / 12), d: 0.6, p: [v[0], v[1], v[2], v[1], v[2], v[1] + 12][i % 6] + (i >= 6 ? 12 : 0), v: i % 3 === 0 ? 90 : 68 })) },
  { id: 'pizzarp', name: 'Pizzicato Stabs', genre: 'Classical', inst: 'pizz', progs: ['canon', 'jazz251', 'jazzcircle'], bar: (v) => { const seq = [v[0], v[2], v[1], v[2], v[0] + 12, v[2], v[1], v[2]]; return seq.map((p, i) => ({ s: i * 0.5, d: 0.25, p, v: i % 2 === 0 ? 90 : 68 })); } },
  { id: 'marimbaost', name: 'Balafon Ostinato', genre: 'Afro', inst: 'balafon', progs: ['afro', 'modal'], bar: (v) => [0, 0.75, 1.5, 2, 2.75, 3.5].map((s, i) => ({ s, d: 0.35, p: v[i % v.length] + 12, v: i % 3 === 0 ? 94 : 76 })) },
  { id: 'harpglide', name: 'Harp Glissando Rolls', genre: 'Cinematic', inst: 'harp', progs: ['canon', 'cinema2', 'jpop'], bar: (v) => { const seq = []; for (let o = 0; o < 2; o++) for (const p of v) seq.push(p - 12 + o * 12); for (const p of v) seq.push(p + 12); return seq.map((p, i) => ({ s: i * (3.4 / seq.length), d: 0.7, p, v: 74 + (i % 3) * 4 })); } },
];

export const BASS2 = [
  { id: 'walk2', name: 'Walking Bass', genre: 'Jazz', inst: 'upright', progs: ['jazz251', 'jazzmin', 'jazzcircle', 'blues', 'bossa'], bar: (r, c) => { const t3 = r + (c.minor ? 3 : 4); const appr = c.next > r ? c.next - 1 : c.next + 1; return [r, t3, r + 7, appr].map((p, i) => ({ s: i, d: 0.92, p, v: i === 0 ? 98 : 86 - (i % 2) * 6 })); } },
  { id: 'bossabass', name: 'Bossa Bass', genre: 'Latin', inst: 'upright', progs: ['bossa', 'jazz251', 'jazzcircle', 'neosoul'], bar: (r) => [[0, 1.4, 0, 96], [1.5, 0.45, 7, 82], [2, 1.4, 0, 90], [3.5, 0.45, 7, 80]].map(([s, d, o, v]) => ({ s, d, p: r + o, v })) },
  { id: 'fretless', name: 'Fretless Flow', genre: 'R&B', inst: 'fretless', progs: ['neosoul', 'jpop', 'soul', 'jazz251', 'lofi'], bar: (r) => [[0, 0.9, 0, 96], [1, 0.4, 0, 80], [1.5, 0.45, 7, 84], [2.5, 0.9, 5, 88], [3.5, 0.45, 7, 80]].map(([s, d, o, v]) => ({ s, d, p: r + o, v })) },
  { id: 'dubbass', name: 'Dub Bass', genre: 'Reggae', inst: 'sub', progs: ['modal', 'afro', 'blues', 'minjazz'], bar: (r) => [[0, 1.2, 0, 104], [1.75, 0.5, 0, 90], [2.5, 1.2, 7, 98]].map(([s, d, o, v]) => ({ s, d, p: r + o, v })) },
  { id: 'afrobass', name: 'Afro Groove Bass', genre: 'Afro', inst: 'ebass', progs: ['afro', 'modal', 'jpop'], bar: (r) => [[0, 0.4, 0], [0.75, 0.4, 12], [1.5, 0.4, 0], [2, 0.4, 7], [2.75, 0.4, 5], [3.5, 0.4, 0]].map(([s, d, o], i) => ({ s, d, p: r + o, v: i % 2 ? 84 : 98 })) },
  { id: 'synthwave', name: 'Synthwave Pulse', genre: 'Electro', inst: 'moogbass', progs: ['cinema2', 'modal', 'epic', 'minpop'], bar: (r) => Array.from({ length: 16 }, (_, i) => ({ s: i * 0.25, d: 0.2, p: r + ([0, 0, 12, 0][i % 4] || 0), v: i % 4 === 0 ? 100 : 82 })) },
  { id: 'orchbass', name: 'Orchestral Bass', genre: 'Cinematic', inst: 'doublebass', progs: ['cinema2', 'canon', 'jazzmin'], bar: (r) => [{ s: 0, d: 3.9, p: r, v: 92 }] },
  { id: 'bluesbass', name: 'Blues Shuffle Bass', genre: 'Blues', inst: 'ebass', progs: ['blues', 'gospel'], bar: (r) => [0, 4, 7, 9, 10, 9, 7, 4].map((o, i) => ({ s: i * 0.5, d: 0.45, p: r + o, v: i % 2 ? 80 : 96 })) },
  { id: 'moogpulse', name: 'Moog Octave Pulse', genre: 'Electro', inst: 'moogbass', progs: ['jpop', 'neosoul', 'afro'], bar: (r) => Array.from({ length: 8 }, (_, i) => ({ s: i * 0.5, d: 0.4, p: r + (i % 2) * 12, v: i % 2 ? 80 : 98 })) },
];

// [id, name, genre, inst, beats, 'beat:dur:degree ...']
export const MELODIES2 = [
  ['sax1', 'Smoky Sax Line', 'Jazz', 'sax', 16, '0:.5:4 .5:.5:6 1:1:7 2.5:.5:6 3:.5:4 3.5:.5:2 4:1.5:3 5.5:.5:4 6:2:2 8:.5:2 8.5:.5:4 9:1:6 10.5:.5:5 11:1:4 12:.5:3 12.5:.5:2 13:3:0'],
  ['trumpet1', 'Muted Trumpet Call', 'Jazz', 'trumpet', 8, '0:.5:4 .5:.5:4 1:1:7 2.5:.5:6 3:1:4 4:.5:4 4.5:.5:5 5:1:7 6.5:.5:6 7:1:4'],
  ['bossaflute', 'Bossa Flute', 'Latin', 'flute', 8, '0:1.5:4 1.5:.5:5 2:1:4 3:1:2 4:1.5:3 5.5:.5:4 6:2:2'],
  ['duduk1', 'Duduk Lament', 'World', 'duduk', 16, '0:3:4 3:1:3 4:2:2 6:1:3 7:1:2 8:3:1 11:1:2 12:4:0'],
  ['erhu1', 'Erhu Phrase', 'World', 'erhu', 8, '0:.5:0 .5:.5:2 1:1:4 2:.5:5 2.5:.5:4 3:1:2 4:2:4 6:1:2 7:1:0'],
  ['koto1', 'Koto Melody', 'World', 'koto', 8, '0:.5:4 .5:.5:2 1:.5:0 1.5:.5:2 2:1:4 3:.5:2 3.5:.5:0 4:1:2 5:.5:4 5.5:.5:2 6:2:0'],
  ['sitar1', 'Sitar Line', 'World', 'sitar', 8, '0:.5:0 .5:.5:1 1:.5:2 1.5:.5:1 2:1:0 3:.5:1 3.5:.5:2 4:1:4 5:.5:3 5.5:.5:2 6:2:0'],
  ['oud1', 'Oud Taqsim', 'World', 'oud', 8, '0:.5:4 .5:.5:3 1:.5:2 1.5:.5:1 2:1:0 3:.5:1 3.5:.5:2 4:1:3 5:.5:2 5.5:.5:1 6:2:0'],
  ['handpan1', 'Handpan Tune', 'World', 'handpan', 8, '0:.75:0 .75:.75:2 1.5:.5:4 2:1:5 3:.5:4 3.5:.5:2 4:.75:0 4.75:.75:2 5.5:.5:4 6:2:2'],
  ['shaku1', 'Shakuhachi Breath', 'World', 'shakuhachi', 8, '0:3:4 3:1:5 4:2:4 6:2:2'],
  ['panflute1', 'Pan Flute Valley', 'World', 'panflute', 8, '0:1:2 1:1:4 2:1:5 3:1:4 4:2:2 6:1:0 7:1:2'],
  ['ocarina1', 'Ocarina Quest', 'Game', 'ocarina', 8, '0:.5:0 .5:.5:2 1:1:4 2:.5:7 2.5:.5:5 3:1:4 4:.5:2 4.5:.5:4 5:1:2 6:2:0'],
  ['violin1', 'Violin Waltz-ish', 'Classical', 'violin', 8, '0:1.5:4 1.5:.5:5 2:1:7 3:1:5 4:1.5:4 5.5:.5:2 6:1:3 7:1:1'],
  ['cello1', 'Cello Theme', 'Cinematic', 'cello', 16, '0:2:0 2:2:4 4:1.5:5 5.5:.5:4 6:2:3 8:2:2 10:2:4 12:3:7 15:1:6'],
  ['horn1', 'Horn Call', 'Cinematic', 'horn', 8, '0:1:0 1:1:4 2:2:7 4:1:7 5:1:5 6:2:4'],
  ['oboe1', 'Oboe Pastoral', 'Classical', 'oboe', 8, '0:1:4 1:.5:5 1.5:.5:4 2:1:2 3:1:4 4:1.5:5 5.5:.5:7 6:2:4'],
  ['harmonica1', 'Harmonica Blues', 'Blues', 'harmonica', 8, '0:.5:4 .5:.5:5 1:.5:4 1.5:.5:2 2:1:0 3:1:2 4:.5:4 4.5:.5:5 5:1:7 6:2:5'],
  ['tubular1', 'Tubular Bells Motif', 'Cinematic', 'tubular', 8, '0:2:4 2:2:2 4:2:3 6:2:0'],
  ['glass1', 'Glass Harmonica Lullaby', 'Chill', 'glassharm', 8, '0:1.5:4 1.5:.5:2 2:2:0 4:1.5:2 5.5:.5:0 6:2:4'],
  ['accordion1', 'Accordion Waltz-ish', 'World', 'accordion', 8, '0:1:4 1:.5:2 1.5:.5:4 2:1:5 3:1:4 4:1:2 5:.5:0 5.5:.5:2 6:2:4'],
  ['balafon1', 'Balafon Dance', 'Afro', 'balafon', 8, '0:.5:0 .5:.5:2 1:.5:4 1.5:.5:2 2:.5:0 2.5:.5:2 3:.5:4 3.5:.5:5 4:.5:4 4.5:.5:2 5:.5:0 5.5:.5:2 6:1:4 7:1:2'],
  ['kalimba1', 'Kalimba Lullaby', 'Chill', 'kalimba', 8, '0:1:4 1:1:2 2:1:0 3:1:2 4:1:4 5:1:5 6:2:4'],
  ['jpophook', 'J-Pop Piano Hook', 'Pop', 'feltpiano', 8, '0:.5:4 .5:.5:5 1:1:7 2:.5:5 2.5:.5:4 3:1:5 4:.5:4 4.5:.5:5 5:.5:7 5.5:.5:9 6:2:8'],
  ['melodica1', 'Dub Melodica', 'Reggae', 'melodica', 8, '0:.5:4 .5:.5:4 1:1:2 2:1:0 3:.5:2 3.5:.5:4 4:1:5 5:.5:4 5.5:.5:2 6:2:0'],
  ['vapor1', 'Vapor Lead Line', 'Electro', 'sp_vapor', 8, '0:1:4 1:.5:5 1.5:.5:4 2:1:2 3:1:0 4:1:2 5:1:4 6:2:5'],
  ['moog1', 'Moog Solo Phrase', 'Electro', 'sp_moogsolo', 8, '0:.5:0 .5:.5:0 1:.5:4 1.5:.5:2 2:1:5 3:.5:4 3.5:.5:2 4:.5:0 4.5:.5:2 5:.5:4 5.5:.5:7 6:2:5'],
];

// ---------------------------------------------------------------- song starters
const S = (id, name, desc, bpm, key, scale, tracks, extra = {}) => ({ id, name, desc, bpm, key, scale, tracks, bars: 16, ...extra });
export const STARTERS2 = [
  S('jazzlounge', 'Jazz Lounge', 'Brushed swing, walking upright bass, soft piano and a smoky sax', 128, 5, 'Major', [
    { type: 'drum', kit: 'jazz', loop: 'd:jazzswing1', name: 'Jazz Drums', send: { rev: 0.2, del: 0 } },
    { type: 'inst', inst: 'upright', loop: 'b:jazz251:walk2', name: 'Upright Bass' },
    { type: 'inst', inst: 'piano', loop: 'c:jazz251:swing', name: 'Piano', vol: 0.65, send: { rev: 0.25, del: 0 } },
    { type: 'inst', inst: 'sax', loop: 'm:sax1', name: 'Sax', start: 4, vol: 0.55, send: { rev: 0.3, del: 0.1 } },
  ], { swing: 0.5, fx: { reverb: 'room' } }),
  S('bossacafe', 'Bossa Nova Café', 'Nylon guitar comping, upright bass and a breezy flute', 116, 0, 'Major', [
    { type: 'drum', kit: 'latin', loop: 'd:bossa1', name: 'Bossa Drums' },
    { type: 'inst', inst: 'nylon', loop: 'c:bossa:bossacomp', name: 'Guitar', send: { rev: 0.25, del: 0 } },
    { type: 'inst', inst: 'upright', loop: 'b:bossa:bossabass', name: 'Bass' },
    { type: 'inst', inst: 'flute', loop: 'm:bossaflute', name: 'Flute', start: 4, vol: 0.5, send: { rev: 0.35, del: 0.15 } },
  ], { fx: { reverb: 'room' } }),
  S('epictrailer', 'Epic Trailer', 'Taiko march, soaring strings, brass hits and a cello theme', 100, 2, 'Minor', [
    { type: 'drum', kit: 'cinema', loop: 'd:epicmarch', name: 'Taiko', send: { rev: 0.3, del: 0 } },
    { type: 'inst', inst: 'strings', loop: 'c:cinema2:orchhold', name: 'Strings', vol: 0.6, send: { rev: 0.4, del: 0 } },
    { type: 'inst', inst: 'brasshit', loop: 'c:cinema2:brasshits', name: 'Brass Hits', vol: 0.55, start: 4, send: { rev: 0.35, del: 0 } },
    { type: 'inst', inst: 'doublebass', loop: 'b:cinema2:orchbass', name: 'Low Strings' },
    { type: 'inst', inst: 'cello', loop: 'm:cello1', name: 'Cello Theme', start: 4, vol: 0.6, send: { rev: 0.4, del: 0.1 } },
  ], { fx: { reverb: 'space' } }),
  S('ambientdrift', 'Ambient Drift', 'Slow evolving pads, handpan patterns and glass harmonica', 76, 9, 'Minor', [
    { type: 'drum', kit: 'ambient', loop: 'd:ambtick', name: 'Textures', vol: 0.85, send: { rev: 0.5, del: 0.2 } },
    { type: 'inst', inst: 'sp_spacedrift', loop: 'c:modal:harmoniumdrone', name: 'Drift Pad', vol: 0.95, send: { rev: 0.5, del: 0 } },
    { type: 'inst', inst: 'handpan', loop: 'a:modal:handpan', name: 'Handpan', start: 4, vol: 0.85, send: { rev: 0.45, del: 0.25 } },
    { type: 'inst', inst: 'glassharm', loop: 'm:glass1', name: 'Glass Harmonica', start: 8, vol: 0.8, send: { rev: 0.6, del: 0.2 } },
  ], { fx: { reverb: 'space' } }),
  S('worldfusion', 'World Fusion', 'Doumbek rhythm, oud and duduk over a deep drone', 104, 2, 'Minor', [
    { type: 'drum', kit: 'world', loop: 'd:maqsum', name: 'Hand Drums', send: { rev: 0.2, del: 0 } },
    { type: 'inst', inst: 'harmonium', loop: 'c:modal:harmoniumdrone', name: 'Drone', vol: 0.5, send: { rev: 0.35, del: 0 } },
    { type: 'inst', inst: 'oud', loop: 'm:oud1', name: 'Oud', start: 4, vol: 0.65, send: { rev: 0.3, del: 0.1 } },
    { type: 'inst', inst: 'duduk', loop: 'm:duduk1', name: 'Duduk', start: 8, vol: 0.55, send: { rev: 0.45, del: 0.1 } },
    { type: 'inst', inst: 'sub', loop: 'b:modal:dubbass', name: 'Bass' },
  ], { fx: { reverb: 'hall' } }),
  S('afrobeatgroove', 'Afrobeat Groove', 'Polyrhythmic percussion, funky bass, brass stabs and kora', 108, 7, 'Major', [
    { type: 'drum', kit: 'afro', loop: 'd:afrobeat', name: 'Percussion' },
    { type: 'inst', inst: 'ebass', loop: 'b:afro:afrobass', name: 'Bass' },
    { type: 'inst', inst: 'clav', loop: 'c:afro:skank', name: 'Skank', vol: 0.5 },
    { type: 'inst', inst: 'brasshit', loop: 'c:afro:brasshits', name: 'Horns', start: 8, vol: 0.5, send: { rev: 0.2, del: 0 } },
    { type: 'inst', inst: 'kora', loop: 'a:afro:korarun', name: 'Kora', start: 4, vol: 0.5, send: { rev: 0.25, del: 0.15 } },
  ]),
  S('neosoulnights', 'Neo-Soul Nights', 'Dragging drums, warm Rhodes, fretless bass and a sax hook', 84, 3, 'Major', [
    { type: 'drum', kit: 'funk', loop: 'd:neosoul', name: 'Drums' },
    { type: 'inst', inst: 'dynorhodes', loop: 'c:neosoul:rhodesslow', name: 'Rhodes', send: { rev: 0.3, del: 0.12 } },
    { type: 'inst', inst: 'fretless', loop: 'b:neosoul:fretless', name: 'Fretless Bass' },
    { type: 'inst', inst: 'sax', loop: 'm:sax1', name: 'Sax', start: 8, vol: 0.5, send: { rev: 0.35, del: 0.15 } },
  ], { swing: 0.14, fx: { reverb: 'plate' } }),
  S('jpopsparkle', 'J-Pop Sparkle', 'Bright royal-road chords, celesta sparkle and a koto hook', 138, 0, 'Major', [
    { type: 'drum', kit: 'studio', loop: 'd:jpop', name: 'Drums' },
    { type: 'inst', inst: 'feltpiano', loop: 'c:jpop:jazzfelt', name: 'Piano', vol: 0.65 },
    { type: 'inst', inst: 'moogbass', loop: 'b:jpop:moogpulse', name: 'Bass' },
    { type: 'inst', inst: 'celesta', loop: 'a:jpop:musicbox', name: 'Celesta', vol: 0.45, send: { rev: 0.35, del: 0.2 } },
    { type: 'inst', inst: 'koto', loop: 'm:koto1', name: 'Koto', start: 8, vol: 0.55, send: { rev: 0.3, del: 0.15 } },
  ]),
  S('dubroots', 'Dub Roots', 'One-drop drums, rolling sub bass, skank guitar and melodica', 74, 4, 'Minor', [
    { type: 'drum', kit: 'dub', loop: 'd:dubonedrop', name: 'Drums', send: { rev: 0.3, del: 0.3 } },
    { type: 'inst', inst: 'sub', loop: 'b:modal:dubbass', name: 'Bass' },
    { type: 'inst', inst: 'muteguitar', loop: 'c:modal:skank', name: 'Skank', vol: 0.6, send: { rev: 0.3, del: 0.35 } },
    { type: 'inst', inst: 'melodica', loop: 'm:melodica1', name: 'Melodica', start: 8, vol: 0.5, send: { rev: 0.35, del: 0.4 } },
  ], { fx: { reverb: 'room' } }),
  S('chamberstrings', 'Chamber Strings', 'A pizzicato canon with violin, viola and cello — no drums', 92, 7, 'Major', [
    { type: 'inst', inst: 'viola', loop: 'c:canon:orchhold', name: 'Strings Bed', vol: 0.85, send: { rev: 0.35, del: 0 } },
    { type: 'inst', inst: 'pizz', loop: 'a:canon:pizzarp', name: 'Pizzicato', start: 4, vol: 0.9, send: { rev: 0.3, del: 0 } },
    { type: 'inst', inst: 'cello', loop: 'b:canon:orchbass', name: 'Cello', vol: 0.95 },
    { type: 'inst', inst: 'violin', loop: 'm:violin1', name: 'Violin', start: 8, vol: 0.95, send: { rev: 0.4, del: 0.1 } },
  ], { bars: 16, fx: { reverb: 'hall' } }),
  S('warehouse', 'Warehouse Techno', 'Hard kick, rolling Detroit bass and a raw stab', 138, 9, 'Minor', [
    { type: 'drum', kit: 'hardtechno', loop: 'd:hardtechno1', name: 'Drums' },
    { type: 'inst', inst: 'sp_detroitbass', loop: 'b:minpop:offbeat', name: 'Bass' },
    { type: 'inst', inst: 'sp_detroit', loop: 'c:minpop:offbeat', name: 'Stab', vol: 0.5, start: 4, send: { rev: 0.2, del: 0.35 } },
    { type: 'inst', inst: 'sp_blip', loop: 'a:minpop:up16', name: 'Blips', vol: 0.45, start: 8, send: { rev: 0.2, del: 0.4 } },
  ]),
  S('bluesstroll', 'Blues Stroll', 'Shuffle beat, bluesy organ and bass, harmonica lead', 96, 4, 'Major', [
    { type: 'drum', kit: 'studio', loop: 'd:bluesshuffle', name: 'Shuffle' },
    { type: 'inst', inst: 'ebass', loop: 'b:blues:bluesbass', name: 'Bass' },
    { type: 'inst', inst: 'rockorgan', loop: 'c:blues:organvamp', name: 'Organ', vol: 0.5 },
    { type: 'inst', inst: 'resonator', loop: 'c:blues:swing', name: 'Comping', vol: 0.5 },
    { type: 'inst', inst: 'harmonica', loop: 'm:harmonica1', name: 'Harmonica', start: 8, vol: 0.55, send: { rev: 0.25, del: 0.15 } },
  ], { swing: 0.5 }),
];
