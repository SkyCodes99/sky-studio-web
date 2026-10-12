// The built-in loop library. Everything is generated from compact patterns, so it adapts to the project's key and scale.
// Drum loops are step strings; pitched loops are written in scale degrees and resolved against the project key/scale.
import { PAD } from '../audio/drums.js';
import { parentScale, degToMidi, chordDegrees, voiceLead } from '../theory.js';
import { newTrack, newRegion } from '../state.js';

// ---------------------------------------------------------------- drum patterns
// Each row string spans the whole loop; step size = loop length / string length (so rows may use different grids).
// x=normal  X=accent  o=ghost  s=soft  .=rest
const D = (id, name, genre, bpm, bars, rows, extra = {}) => ({ id: 'd:' + id, name, cat: 'Drums', genre, bpm, bars, kind: 'drum', rows, ...extra });
const DRUM_DEFS = [
  // Hip-Hop
  D('boombap1', 'Boom Bap Classic', 'Hip-Hop', 90, 1, { kick: 'x.....x..xx.....', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.' }, { swing: 0.12 }),
  D('boombap2', 'Boom Bap Swing', 'Hip-Hop', 88, 1, { kick: 'X..x......x.x...', snare: '....X..o....X..o', hat: 'x.x.x.x.x.x.x.xo' }, { swing: 0.2 }),
  D('dusty', 'Dusty Break', 'Hip-Hop', 85, 2, { kick: 'x.....x...x.....x.....x..x......', snare: '....x.......x.......x.......x...', hat: 'x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.xx', rim: '..............o.................' }, { swing: 0.15 }),
  D('oldschool', 'Old School', 'Hip-Hop', 95, 1, { kick: 'x.....x.x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', ohat: '.............x..' }),
  D('lofi1', 'Lo-Fi Chill', 'Lo-Fi', 75, 1, { kick: 'x.......x..x....', snare: '....x.......x...', hat: 'x.x.xsx.x.x.xsx.', rim: '...........o...o' }, { swing: 0.25 }),
  D('lofi2', 'Lo-Fi Laid Back', 'Lo-Fi', 70, 2, { kick: 'x.......x.x.....x.......x.x..x..', snare: '....x.......x.......x.......x...', hat: 'x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.', shaker: '.s.s.s.s.s.s.s.s.s.s.s.s.s.s.s.s' }, { swing: 0.3 }),
  D('lofi3', 'Lo-Fi Skip', 'Lo-Fi', 80, 1, { kick: 'x.....x...x.....', snare: '....x..o....x...', hat: 'xsxsxsxsxsxsxsxs', clap: '...............s' }, { swing: 0.22 }),
  // Trap
  D('trap1', 'Trap Basic', 'Trap', 140, 1, { kick: 'x.......x.x.....', snare: '........X.......', hat: 'x.x.x.x.x.x.x.x.' }),
  D('trap2', 'Trap Rolls', 'Trap', 140, 1, { kick: 'x.......x.x.....', clap: '........X.......', hat: 'x.x.x.x.x.x.x.x.x.x.x.x.xxxxxxxx', ohat: '..............x.' }),
  D('trap3', 'Trap Bounce', 'Trap', 150, 1, { kick: 'x..x......x..x..', snare: '........X.......', hat: 'x.x.xxx.x.x.xxx.', snap: '............o...' }),
  D('trap4', 'Trap Soul', 'Trap', 70, 2, { kick: 'x.........x.....x.....x.........', snare: '........x...............x.......', hat: 'x.x.x.x.x.x.x.x.x.x.x.x.x.x.xxxx', shaker: '..s...s...s...s...s...s...s...s.' }),
  D('drill', 'UK Drill', 'Drill', 144, 1, { kick: 'x.....x....x....', snare: '........X.......', hat: 'x.xxx.xxx.xxx.xx', ohat: '..............x.' }, { }),
  D('phonk', 'Phonk Cowbell', 'Trap', 130, 1, { kick: 'x..x..x...x.x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.xx', bell: '..x...x...x...x.' }),
  // R&B / Pop
  D('rnb1', 'R&B Slow Jam', 'R&B', 68, 1, { kick: 'x.....x...x.....', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.', rim: '..o......o....o.' }, { swing: 0.15 }),
  D('pop1', 'Pop Four', 'Pop', 120, 1, { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.', clap: '....x.......x...' }),
  D('pop2', 'Pop Bounce', 'Pop', 110, 1, { kick: 'x.....x...x.x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', clap: '....s.......s...' }),
  D('pop3', 'Dance Pop', 'Pop', 124, 1, { kick: 'x...x...x...x...', clap: '....X.......X...', hat: 'x.xxx.xxx.xxx.xx', ohat: '..x...x...x...x.' }),
  D('synthpop', 'Synth Pop', 'Pop', 118, 1, { kick: 'x.....x.x.......', snare: '....x.......x...', clap: '....x.......x...', hat: 'xsxsxsxsxsxsxsxs' }),
  // House / EDM
  D('house1', 'House Classic', 'House', 124, 1, { kick: 'x...x...x...x...', clap: '....x.......x...', ohat: '..x...x...x...x.', hat: 'x.x.x.x.x.x.x.x.' }),
  D('house2', 'Deep House', 'House', 122, 1, { kick: 'x...x...x...x...', rim: '....x.......x...', ohat: '..x...x...x...x.', shaker: 'sxsxsxsxsxsxsxsx' }),
  D('house3', 'Tech House', 'House', 126, 1, { kick: 'x...x...x...x...', clap: '....x.......x...', hat: '.x..x..x.x..x..x', ohat: '..x...x...x...x.', bell: '...o..o....o..o.' }),
  D('techno', 'Techno', 'Techno', 130, 1, { kick: 'X...X...X...X...', clap: '....x.......x...', hat: '..x...x...x...x.', ride: 'x.x.x.x.x.x.x.x.', shaker: '.s.s.s.s.s.s.s.s' }),
  D('prog', 'Progressive House', 'House', 128, 1, { kick: 'x...x...x...x...', clap: '....x.......x...', ohat: '..x...x...x...x.', hat: 'xsxsxsxsxsxsxsxs' }),
  D('futurebass', 'Future Bass', 'EDM', 150, 1, { kick: 'x.......x.x.....', snare: '........X.......', clap: '........X.......', hat: 'x.x.x.x.x.x.x.xx' }),
  D('electro', 'Electro', 'Electro', 128, 1, { kick: 'x..x..x...x.x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', tomH: '.............o.o' }),
  D('garage', 'UK Garage 2-Step', 'Garage', 130, 1, { kick: 'x.........x.....', snare: '....X.......X...', hat: 'x.xxx.xxx.xxx.xx', shaker: '..s...s...s...s.' }, { swing: 0.3 }),
  D('trance', 'Trance', 'Trance', 138, 1, { kick: 'x...x...x...x...', clap: '....x.......x...', ohat: '..x...x...x...x.', hat: 'x.x.x.x.x.x.x.x.' }),
  D('disco', 'Disco', 'Disco', 118, 1, { kick: 'x...x...x...x...', snare: '....x.......x...', ohat: '..x...x...x...x.', hat: 'x.x.x.x.x.x.x.x.' }),
  // DnB / Breaks
  D('dnb1', 'DnB Two-Step', 'DnB', 174, 1, { kick: 'x.........x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' }),
  D('dnb2', 'DnB Roller', 'DnB', 174, 1, { kick: 'x.........x.x...', snare: '....x.......x..o', hat: 'xsxsxsxsxsxsxsxs', ride: '..x...x...x...x.' }),
  D('break1', 'Breakbeat', 'Breaks', 135, 2, { kick: 'x.x.......x...x.x.......x.......', snare: '....x..o.o..x...o...x..o....x..x', hat: 'x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.' }),
  D('jungle', 'Jungle', 'Breaks', 160, 2, { kick: 'x.........x.....x.x.....x.......', snare: '....x..o.o..x....o..x..o.o..x...', hat: 'x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.' }),
  // Rock / Funk / Live
  D('rock1', 'Rock Basic', 'Rock', 110, 1, { kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', crash: 'x...............' }),
  D('rock2', 'Rock Driving', 'Rock', 140, 1, { kick: 'x.x.x.x.x.x.x.x.', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' }),
  D('rock3', 'Half-Time Rock', 'Rock', 90, 1, { kick: 'x.......x..x....', snare: '........x.......', hat: 'x.x.x.x.x.x.x.x.', }),
  D('punk', 'Punk', 'Rock', 170, 1, { kick: 'x...x...x...x...', snare: '..x...x...x...x.', hat: 'x.x.x.x.x.x.x.x.' }),
  D('funk1', 'Funk Groove', 'Funk', 100, 1, { kick: 'x..x..x....x.x..', snare: '..o.x..o.o.x..o.', hat: 'xsxsxsxsxsxsxsxs' }, { swing: 0.1 }),
  D('funk2', 'Funky Break', 'Funk', 98, 2, { kick: 'x.x.......x.x...x..x..x.....x...', snare: '....x..o.o..x..o..o.x..o.o..x..o', hat: 'x.xxx.xxx.xxx.xxx.xxx.xxx.xxx.xx' }, { swing: 0.1 }),
  D('shuffle', 'Blues Shuffle', 'Blues', 90, 1, { kick: 'x.....x.....', snare: '...x.....x..', hat: 'x.xx.xx.xx.x' }),
  D('ballad', 'Ballad', 'Pop', 70, 1, { kick: 'x.......x.......', rim: '....x.......x...', hat: 's.s.s.s.s.s.s.s.' }),
  // World
  D('reggaeton', 'Reggaeton Dembow', 'Latin', 95, 1, { kick: 'x...x...x...x...', snare: '...x..x....x..x.', hat: 'x.x.x.x.x.x.x.x.', rim: '...o..o....o..o.' }),
  D('afro', 'Afrobeats', 'Afro', 105, 1, { kick: 'x..x..x...x..x..', snare: '....x.......x...', hat: 'x.xxx.xxx.xxx.xx', shaker: 'sxsxsxsxsxsxsxsx', rim: '..o..o....o..o..' }),
  D('bossa', 'Bossa Nova', 'Latin', 120, 2, { kick: 'x..x....x..x....x..x....x..x....', rim: 'x..x..x...x..x..x..x..x...x..x..', hat: 'x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.' }),
  D('reggae', 'Reggae One Drop', 'Reggae', 75, 1, { kick: '........x.......', snare: '........x.......', rim: '........x.......', hat: '..x...x...x...x.' }),
  D('percgroove', 'Percussion Groove', 'Percussion', 100, 1, { shaker: 'xsxsxsxsxsxsxsxs', bell: 'x..x..x...x.x...', rim: '..x..x....x..x..', tomL: '.......x.......x', tomH: '....x.......x...' }),
  // Starters
  D('kickhat', 'Kick & Hat', 'Simple', 100, 1, { kick: 'x...x...x...x...', hat: '..x...x...x...x.' }),
  D('four', 'Four on the Floor', 'Simple', 120, 1, { kick: 'x...x...x...x...' }),
  D('claps', 'Claps & Snaps', 'Simple', 100, 1, { clap: '....x.......x...', snap: '..o...o...o...o.' }),
  D('hats16', '16th Hats', 'Simple', 120, 1, { hat: 'xsxsxsxsxsxsxsxs' }),
  D('hatroll', 'Hat Roll Fill', 'Fill', 140, 1, { hat: '................xxxxxxxxxxxxxxxx' }),
  D('fill1', 'Tom Fill', 'Fill', 110, 1, { snare: '..........x.x.x.', tomH: '............x...', tomM: '..............x.', tomL: '...............x', }),
  // ---- more grooves
  D('dancehall', 'Dancehall Riddim', 'Dancehall', 100, 1, { kick: 'x..x..x...x...x.', snare: '...x..x...x..x..', hat: 'x.x.x.x.x.x.x.x.', rim: '..o...o...o...o.' }),
  D('moombah', 'Moombahton', 'Latin', 108, 1, { kick: 'x...x...x...x...', snare: '...x..x....x..x.', hat: '..x...x...x...x.', clap: '...x..x....x..x.', shaker: 'sxsxsxsxsxsxsxsx' }),
  D('amapiano', 'Amapiano Log', 'Afro', 112, 1, { kick: 'x..x....x..x....', clap: '....x.......x...', hat: 'xsxsxsxsxsxsxsxs', shaker: '.s.s.s.s.s.s.s.s', tomL: '..........o..o..', rim: '..o....o..o....o' }),
  D('afrohouse', 'Afro House', 'House', 122, 1, { kick: 'x...x...x...x...', clap: '....x.......x...', hat: '..x...x...x...x.', bell: 'x..x..x...x..x..', shaker: 'sxsxsxsxsxsxsxsx', tomM: '.......o.......o' }),
  D('jersey', 'Jersey Club', 'Club', 140, 1, { kick: 'x..x..x.x..x..x.', clap: '....x.......x...', snare: '..o...o...o...o.', hat: 'x.x.x.x.x.x.x.x.' }),
  D('hyperpop', 'Hyperpop Bounce', 'Pop', 160, 1, { kick: 'x...x..x..x.x...', snare: '....x.......x..o', clap: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx', ohat: '..............x.' }),
  D('trapfast', 'Trap Fast Hats', 'Trap', 145, 1, { kick: 'x.......x.x.....', clap: '........x.......', snare: '........x.......', hat: 'x.x.x.x.x.x.x.x.x.x.x.xxxxxxxxxx'.slice(0, 32), ohat: '............x...' }),
  D('trapslow', 'Trap Half-Time', 'Trap', 70, 2, { kick: 'x.....x...x.....x.....x.x.......', snare: '........x...............x.......', hat: 'x.x.x.x.x.x.x.x.x.x.x.x.x.x.xxxx', clap: '........x...............x.......' }),
  D('triplet', 'Triplet Flow', 'Trap', 140, 1, { kick: 'x..........x', snare: '......x.....', hat: 'xxxxxxxxxxxx', clap: '......x.....' }),
  D('nydrill', 'NY Drill', 'Drill', 140, 1, { kick: 'x..x....x.x.....', snare: '........x.......', hat: 'x.xxx.xx.xxx.x.x', ohat: '..............x.', snap: '....o.......o...' }),
  D('ukdrill2', 'UK Drill Slide', 'Drill', 142, 1, { kick: 'x.....x.x.......', snare: '........x......o', hat: 'x.x.xx.xx.x.xx.x', bell: '..o.......o.....' }),
  D('chillhop', 'Chillhop', 'Lo-Fi', 85, 1, { kick: 'x.....x...x.....', snare: '....x.......x..o', hat: 'x.x.xsx.x.x.xsx.', rim: '..o.......o.....' }, { swing: 0.28 }),
  D('lofi4', 'Lo-Fi Brushes', 'Lo-Fi', 72, 2, { kick: 'x.......x.......x.x.....x.......', snare: '....x.......x.......x.......x...', hat: 'xsxsxsxsxsxsxsxsxsxsxsxsxsxsxsxs', shaker: '.s...s...s...s...s...s...s...s..' }, { swing: 0.32 }),
  D('boombap3', 'Boom Bap Heavy', 'Hip-Hop', 92, 1, { kick: 'x..x..x...xx....', snare: '....X.......X..o', hat: 'x.x.x.x.x.x.x.xx', ohat: '.............x..' }, { swing: 0.1 }),
  D('boombap4', 'Golden Era', 'Hip-Hop', 94, 2, { kick: 'x.....x..x......x.x...x..x......', snare: '....x.......x.......x..o....x...', hat: 'x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.', rim: '..............o...............' }, { swing: 0.14 }),
  D('trip', 'Trip-Hop Slow', 'Hip-Hop', 78, 2, { kick: 'x.........x.....x..........x....', snare: '........x...............x.......', hat: 'x...x...x...x...x...x...x...x...', shaker: '..s...s...s...s...s...s...s...s.' }, { swing: 0.18 }),
  D('houseacid', 'Acid House', 'House', 125, 1, { kick: 'x...x...x...x...', clap: '....x.......x...', hat: '..x...x...x...x.', ohat: 'x...x...x...x...'.replace(/x/g, '.'), ride: 'x.x.x.x.x.x.x.x.'.replace(/x/g, 's') }),
  D('frenchhouse', 'French Touch', 'House', 123, 1, { kick: 'x...x...x...x...', clap: '....x.......x...', hat: '.x.x.x.x.x.x.x.x', ohat: '..x...x...x...x.', shaker: 'sxsxsxsxsxsxsxsx' }),
  D('jackin', 'Jackin House', 'House', 126, 1, { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '.x.x.x.x.x.x.x.x', clap: '....x.......x..o', tomH: '.......o.......o' }),
  D('dubtechno', 'Dub Techno', 'Techno', 120, 1, { kick: 'x...x...x...x...', hat: '..s...s...s...s.', rim: '.......x.......x', shaker: 's.s.s.s.s.s.s.s.' }),
  D('techno2', 'Peak Time Techno', 'Techno', 134, 1, { kick: 'X...X...X...X...', clap: '....x.......x...', hat: '.x.x.x.x.x.x.x.x', ride: 'x.x.x.x.x.x.x.x.', tomM: '..............xx' }),
  D('industrial', 'Industrial', 'Techno', 140, 1, { kick: 'X..X..X.X..X..X.', snare: '....X.......X...', hat: 'xxxxxxxxxxxxxxxx', crash: 'x...............' }),
  D('liquid', 'Liquid DnB', 'DnB', 172, 1, { kick: 'x.........x.....', snare: '....x.......x..o', hat: 'x.x.x.x.x.x.x.x.', ride: '..x...x...x...x.' }),
  D('neuro', 'Neurofunk', 'DnB', 174, 1, { kick: 'x..x......x.....', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx', ohat: '.......x.......x' }),
  D('amen', 'Amen-ish Break', 'Breaks', 136, 2, { kick: 'x.x.......xx....x.x.......xx....', snare: '....x..o.o..x...o...x..o.o..x...', hat: 'x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.' }),
  D('funkydrummer', 'Funky Shuffle', 'Funk', 99, 2, { kick: 'x.x.......x.x...x.x.......x.....', snare: '....x..o.o..x..o....x..o.o..x...', hat: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' }, { swing: 0.1 }),
  D('rocksh', 'Rock Shuffle', 'Rock', 120, 1, { kick: 'x.....x.....', snare: '...x.....x..', hat: 'x.xx.xx.xx.x' }),
  D('metal', 'Double Kick Metal', 'Rock', 180, 1, { kick: 'xxxxxxxxxxxxxxxx', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', crash: 'x...............' }),
  D('poppunk', 'Pop-Punk Beat', 'Rock', 168, 1, { kick: 'x...x...x..x.x..', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', crash: 'x...............' }),
  D('ska', 'Ska Upstroke', 'Reggae', 160, 1, { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.', rim: '..x...x...x...x.' }),
  D('steppers', 'Reggae Steppers', 'Reggae', 78, 1, { kick: 'x...x...x...x...', rim: '........x.......', hat: '..x...x...x...x.', shaker: 'sxsxsxsxsxsxsxsx' }),
  D('salsa', 'Salsa Clave', 'Latin', 180, 2, { bell: 'x..x..x...x.x...x...x.x...x..x..', rim: 'x..x..x...x.x...x...x.x...x..x..', tomH: '..........x...x...........x...x.', shaker: 'xsxsxsxsxsxsxsxsxsxsxsxsxsxsxsxs' }),
  D('samba', 'Samba', 'Latin', 100, 1, { kick: 'x..x..x.x..x..x.', snare: '..o.o.o.o.o.o.o.', shaker: 'xxxxxxxxxxxxxxxx', bell: 'x.x.x...x.x.x...' }),
  D('jazzswing', 'Jazz Swing Ride', 'Jazz', 130, 1, { ride: 'x..xx..xx..xx..x'.replace(/x/g, 'x'), kick: 'x.......x.......', rim: '..............o.', hat: '....x.......x...' }, { swing: 0.5 }),
  D('gospel', 'Gospel Chops', 'Pop', 98, 1, { kick: 'x..x..x.x..x....', snare: '....x..o....x..x', hat: 'x.x.x.x.x.x.x.x.', clap: '....x.......x...' }),
  D('synthwave', 'Synthwave Gate', 'Electro', 104, 1, { kick: 'x..x....x..x....', snare: '....x.......x...', clap: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', tomH: '...........o.o.o', crash: 'x...............' }),
  D('ambient', 'Ambient Pulse', 'Simple', 80, 2, { kick: 'x...............x...............', shaker: '..s...s...s...s...s...s...s...s.', rim: '............o...............o...' }),
  D('hiphop6', 'R&B Trap Soul 6/8', 'R&B', 66, 1, { kick: 'x.....x.....', snare: '......x.....', hat: 'x.x.x.x.x.x.', rim: '...x.....x..' }),
  D('garage2', 'Speed Garage', 'Garage', 134, 1, { kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.xxx.xxx.xxx.xx', clap: '....x.......x..o' }, { swing: 0.28 }),
  D('bassline', 'Bassline House', 'Garage', 134, 1, { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '.x.x.x.x.x.x.x.x', clap: '..x...x...x...x.' }, { swing: 0.2 }),
  D('trance2', 'Uplifting Trance', 'Trance', 140, 1, { kick: 'x...x...x...x...', clap: '....x.......x...', ohat: '..x...x...x...x.', hat: 'x.x.x.x.x.x.x.x.', ride: '.x.x.x.x.x.x.x.x'.replace(/x/g, 's') }),
  D('dubstep', 'Dubstep Half-Time', 'EDM', 140, 2, { kick: 'x.........x.............x.......', snare: '................x...............', hat: 'x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.', clap: '................x...............' }),
  D('moombahcut', 'Reggaeton Perreo', 'Latin', 92, 1, { kick: 'x...x...x...x...', snare: '...x..x....x..x.', hat: 'x.xxx.xxx.xxx.xx', rim: '..o...o...o...o.' }),
  D('kpop', 'K-Pop Pulse', 'Pop', 128, 1, { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx', clap: '....x.......x..x', snap: '.o...o...o...o..' }),
  D('fills3', 'Snare Roll Fill', 'Fill', 120, 1, { snare: '..x.x.xxxxxxxxxx', kick: 'x...............', crash: '................' }),
  D('fills4', 'Tom Cascade Fill', 'Fill', 110, 1, { tomH: 'xx..............', tomM: '..xx............', tomL: '....xx..........', kick: 'x.......x.......', snare: '......x.x.x.xxxx' }),
];
const VELS = { X: 122, x: 100, s: 76, o: 52 };

function buildDrum(def) {
  const beats = def.bars * 4, notes = [];
  for (const [row, str] of Object.entries(def.rows)) {
    const pad = PAD[row];
    if (pad == null) continue;
    const step = beats / str.length;
    for (let i = 0; i < str.length; i++) {
      const v = VELS[str[i]];
      if (!v) continue;
      notes.push({ s: i * step, d: Math.min(step, 0.25), p: 36 + pad, v });
    }
  }
  return { len: beats, notes };
}

// ---------------------------------------------------------------- progressions & pitched styles
const PROGS = [
  { id: 'pop', name: 'Pop (I V vi IV)', deg: [0, 4, 5, 3], size: 3, mode: 'major', genre: 'Pop' },
  { id: 'sad', name: 'Emotional (vi IV I V)', deg: [5, 3, 0, 4], size: 3, mode: 'major', genre: 'Pop' },
  { id: 'soul', name: 'Soul (I vi ii V)', deg: [0, 5, 1, 4], size: 4, mode: 'major', genre: 'R&B' },
  { id: 'fifties', name: '50s (I vi IV V)', deg: [0, 5, 3, 4], size: 3, mode: 'major', genre: 'Pop' },
  { id: 'lofi', name: 'Lo-Fi (ii V I vi)', deg: [1, 4, 0, 5], size: 4, mode: 'major', genre: 'Lo-Fi' },
  { id: 'dream', name: 'Dreamy (I iii IV V)', deg: [0, 2, 3, 4], size: 4, mode: 'major', genre: 'Chill' },
  { id: 'gospel', name: 'Uplift (I IV vi V)', deg: [0, 3, 5, 4], size: 3, mode: 'major', genre: 'Pop' },
  { id: 'epic', name: 'Epic (i VI III VII)', deg: [0, 5, 2, 6], size: 3, mode: 'minor', genre: 'Cinematic' },
  { id: 'minpop', name: 'Dark Pop (i VII VI VII)', deg: [0, 6, 5, 6], size: 3, mode: 'minor', genre: 'Pop' },
  { id: 'andal', name: 'Andalusian (i VII VI V)', deg: [0, 6, 5, 4], size: 3, mode: 'minor', genre: 'World' },
  { id: 'trapmin', name: 'Trap Minor (i VI VII v)', deg: [0, 5, 6, 4], size: 3, mode: 'minor', genre: 'Trap' },
  { id: 'minjazz', name: 'Moody (i iv VII III)', deg: [0, 3, 6, 2], size: 4, mode: 'minor', genre: 'Chill' },
];
const PROG_BY_ID = Object.fromEntries(PROGS.map((p) => [p.id, p]));

function voicings(prog, proj) {
  const sc = parentScale(proj.scale);
  const out = [];
  let prev = null;
  for (const root of prog.deg) {
    const midis = chordDegrees(root, prog.size).map((d) => degToMidi(d, proj.key, sc, 4));
    const v = voiceLead(midis, prev, 61);
    out.push(v); prev = v;
  }
  return out;
}
function bassRoot(root, proj, oct = 2) {
  const sc = parentScale(proj.scale);
  let m = degToMidi(root, proj.key, sc, oct);
  while (m > 47) m -= 12;
  while (m < 28) m += 12;
  return m;
}

// each style gets (bar index, voiced chord, ctx) and returns notes within that bar (0..4 beats)
const CHORD_STYLES = [
  { id: 'pad', name: 'Sustained', genre: 'Pad', inst: 'warmpad', bar: (v) => v.map((p) => ({ s: 0, d: 3.9, p, v: 78 })) },
  { id: 'pulse', name: 'Pop Pulse', genre: 'Pop', inst: 'epiano', bar: (v) => [0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) => v.map((p) => ({ s: i * 0.5, d: 0.42, p, v: i % 2 === 0 ? 88 : 66 }))) },
  { id: 'stab', name: 'Syncopated Stabs', genre: 'Pop', inst: 'pluck', bar: (v) => [0, 0.75, 1.5, 2.5, 3].flatMap((s, i) => v.map((p) => ({ s, d: 0.4, p, v: i === 0 ? 100 : 82 }))) },
  { id: 'offbeat', name: 'Offbeat Stabs', genre: 'House', inst: 'supersaw', bar: (v) => [0.5, 1.5, 2.5, 3.5].flatMap((s) => v.map((p) => ({ s, d: 0.28, p, v: 92 }))) },
  { id: 'ballad', name: 'Piano Ballad', genre: 'Ballad', inst: 'piano', bar: (v) => [{ s: 0, d: 3.9, p: v[0] - 12, v: 82 }, ...[0, 2].flatMap((s) => v.map((p) => ({ s, d: 1.85, p, v: s === 0 ? 80 : 66 })))] },
  { id: 'strum', name: 'Guitar Strum', genre: 'Acoustic', inst: 'guitar', bar: (v) => [[0, 1], [1, 1], [1.5, -1], [2.5, -1], [3, 1], [3.5, -1]].flatMap(([s, dir], k) => (dir > 0 ? v : v.slice().reverse()).map((p, i) => ({ s: s + i * 0.025, d: 0.55, p, v: (k === 0 ? 96 : 78) - i * 2 }))) },
  { id: 'rhodes', name: 'Lo-Fi Comping', genre: 'Lo-Fi', inst: 'epiano', bar: (v) => [[0, 1.4, 82], [1.75, 0.6, 62], [2.5, 0.9, 72], [3.5, 0.45, 58]].flatMap(([s, d, vel], k) => v.map((p, i) => ({ s: s + i * 0.012 + (k % 2) * 0.01, d, p, v: vel - i * 2 }))) },
  { id: 'hold2', name: 'Half-Note Chords', genre: 'Pop', inst: 'strings', bar: (v) => [0, 2].flatMap((s) => v.map((p) => ({ s, d: 1.9, p, v: 76 }))) },
];

const ARP_STYLES = [
  { id: 'up16', name: '16th Arpeggio', genre: 'Synth', inst: 'arp', bar: (v) => Array.from({ length: 16 }, (_, i) => ({ s: i * 0.25, d: 0.22, p: v[i % v.length] + (Math.floor(i / v.length) % 2) * 12, v: i % 4 === 0 ? 96 : 76 })) },
  { id: 'updown', name: 'Up & Down 8ths', genre: 'Pop', inst: 'pluck', bar: (v) => { const seq = [...v, v[0] + 12, ...v.slice().reverse().slice(0, -1)]; return Array.from({ length: 8 }, (_, i) => ({ s: i * 0.5, d: 0.45, p: seq[i % seq.length], v: i % 2 === 0 ? 92 : 72 })); } },
  { id: 'trance', name: 'Trance Gate', genre: 'Trance', inst: 'supersaw', bar: (v) => Array.from({ length: 16 }, (_, i) => ({ s: i * 0.25, d: 0.2, p: [v[0], v[1] ?? v[0], v[2] ?? v[0], (v[1] ?? v[0]) + 12][i % 4] + (i % 8 >= 4 ? 12 : 0), v: i % 2 === 0 ? 96 : 70 })) },
  { id: 'alberti', name: 'Alberti (Low-High-Mid-High)', genre: 'Classical', inst: 'piano', bar: (v) => Array.from({ length: 8 }, (_, i) => ({ s: i * 0.5, d: 0.45, p: [v[0] - 12, v[2] ?? v[1], v[1], v[2] ?? v[1]][i % 4], v: i % 4 === 0 ? 88 : 68 })) },
  { id: 'harp', name: 'Rolling Harp', genre: 'Cinematic', inst: 'harp', bar: (v) => Array.from({ length: 12 }, (_, i) => ({ s: i * (4 / 12), d: 0.6, p: [v[0] - 12, v[0], v[1], v[2] ?? v[1], v[1], v[0]][i % 6] + (i >= 6 ? 12 : 0), v: 70 + (i % 3) * 6 })) },
];

const BASS_STYLES = [
  { id: 'root', name: 'Whole Notes', genre: 'Pop', inst: 'sub', bar: (r) => [{ s: 0, d: 3.85, p: r, v: 96 }] },
  { id: 'eighth', name: 'Driving 8ths', genre: 'Rock', inst: 'synbass', bar: (r) => Array.from({ length: 8 }, (_, i) => ({ s: i * 0.5, d: 0.42, p: r, v: i % 2 === 0 ? 100 : 82 })) },
  { id: 'octave', name: 'Disco Octaves', genre: 'Disco', inst: 'pluckbass', bar: (r) => Array.from({ length: 8 }, (_, i) => ({ s: i * 0.5, d: 0.4, p: r + (i % 2) * 12, v: i % 2 === 0 ? 100 : 84 })) },
  { id: 'sync', name: 'Syncopated', genre: 'Hip-Hop', inst: 'sub', bar: (r) => [[0, 0.7, 104], [0.75, 0.7, 88], [1.5, 0.9, 92], [2.5, 0.7, 96], [3.25, 0.7, 84]].map(([s, d, v]) => ({ s, d, p: r, v })) },
  { id: 'offbeat', name: 'House Offbeat', genre: 'House', inst: 'synbass', bar: (r) => [0.5, 1.5, 2.5, 3.5].map((s) => ({ s, d: 0.4, p: r, v: 100 })) },
  { id: 'sub808', name: '808 Slides', genre: 'Trap', inst: 'bass808', bar: (r) => [{ s: 0, d: 1.45, p: r, v: 112 }, { s: 2.5, d: 0.7, p: r, v: 100 }, { s: 3.25, d: 0.6, p: r + 5, v: 96 }] },
  { id: 'acid', name: 'Acid 16ths', genre: 'Techno', inst: 'acid', bar: (r) => [...'x.xx.xx.x.xxx.x.'].map((c, i) => (c === 'x' ? { s: i * 0.25, d: 0.2, p: r + ([0, 0, 12, 0, 7, 0, 12, 0, 3, 0, 12, 0, 7, 0, 0, 12][i]), v: i % 4 === 0 ? 108 : 88 } : null)).filter(Boolean) },
  { id: 'funk', name: 'Funk 16ths', genre: 'Funk', inst: 'pluckbass', bar: (r) => [[0, 0.3], [0.75, 0.2], [1, 0.3], [1.75, 0.2], [2.5, 0.3], [3, 0.3], [3.5, 0.3]].map(([s, d], i) => ({ s, d, p: r + (i === 4 ? 12 : i === 6 ? 7 : 0), v: i % 2 ? 84 : 104 })) },
  { id: 'reese', name: 'Reese Drone', genre: 'DnB', inst: 'reese', bar: (r) => [{ s: 0, d: 2.9, p: r, v: 100 }, { s: 3, d: 0.95, p: r + 7, v: 90 }] },
  { id: 'walk', name: 'Walking', genre: 'Jazz', inst: 'sub', bar: null },
];

function buildChords(prog, style, proj) {
  const vs = voicings(prog, proj), notes = [];
  vs.forEach((v, bar) => { for (const n of style.bar(v)) notes.push({ ...n, s: n.s + bar * 4 }); });
  return { len: vs.length * 4, notes };
}
function buildBass(prog, style, proj) {
  const notes = [];
  prog.deg.forEach((root, bar) => {
    const r = bassRoot(root, proj);
    let ns;
    if (style.id === 'walk') {
      const next = prog.deg[(bar + 1) % prog.deg.length];
      const sc = parentScale(proj.scale);
      const pick = (d) => { let m = degToMidi(d, proj.key, sc, 2); while (m > 47) m -= 12; while (m < 28) m += 12; return m; };
      ns = [pick(root), pick(root + 2), pick(root + 4), pick(next - 1)].map((p, i) => ({ s: i, d: 0.9, p, v: 94 - (i % 2) * 8 }));
    } else ns = style.bar(r);
    for (const n of ns) notes.push({ ...n, s: n.s + bar * 4 });
  });
  return { len: prog.deg.length * 4, notes };
}

// ---------------------------------------------------------------- melodies (scale degrees: 0 = tonic, 7 = tonic an octave up)
const parseMel = (s) => s.trim().split(/\s+/).map((e) => { const [a, b, c] = e.split(':').map(Number); return { s: a, d: b, deg: c }; });
const MELODIES = [
  ['sunny', 'Sunny Hook', 'Pop', 'pluck', 8, '0:.5:4 .5:.5:4 1:1:5 2:1:4 3:.5:2 3.5:.5:2 4:1:4 5:.5:5 5.5:.5:4 6:1.5:2 7.5:.5:1'],
  ['step', 'Simple Steps', 'Pop', 'sawlead', 8, '0:1:0 1:1:2 2:1:4 3:1:2 4:1.5:5 5.5:.5:4 6:2:2'],
  ['sigh', 'Sad Sigh', 'Cinematic', 'piano', 8, '0:2:4 2:1:3 3:1:2 4:1.5:2 5.5:.5:1 6:2:0'],
  ['bounce', 'Bouncy Riff', 'Pop', 'sqlead', 8, '0:.5:0 .5:.5:2 1:.5:4 1.5:.5:2 2:.5:5 2.5:.5:4 3:1:2 4:.5:0 4.5:.5:2 5:.5:4 5.5:.5:7 6:1:6 7:1:4'],
  ['float', 'Slow Float', 'Chill', 'flute', 16, '0:3:4 3:1:2 4:3:3 7:1:2 8:2:1 10:2:2 12:4:0'],
  ['stacc', 'Staccato Riff', 'Funk', 'clav', 8, '0:.25:0 .5:.25:0 1:.25:3 1.5:.25:0 2:.25:4 2.5:.25:3 3:.5:0 4:.25:0 4.5:.25:0 5:.25:5 5.5:.25:3 6:.5:2 7:.5:0'],
  ['rise', 'Rising Line', 'Cinematic', 'strings', 8, '0:1:0 1:1:1 2:1:2 3:1:4 4:2:5 6:2:7'],
  ['fall', 'Falling Line', 'Cinematic', 'strings', 8, '0:2:7 2:1:6 3:1:4 4:2:5 6:1:3 7:1:2'],
  ['penta', 'Pentatonic Lick', 'Rock', 'sawlead', 4, '0:.5:0 .5:.5:2 1:.5:4 1.5:1:5 2.5:.5:4 3:1:2'],
  ['bells', 'Bell Tune', 'Lo-Fi', 'glock', 8, '0:.5:7 .5:.5:4 1:.5:2 1.5:.5:4 2:1:7 3:1:6 4:.5:5 4.5:.5:2 5:.5:0 5.5:.5:2 6:2:4'],
  ['music', 'Music Box Waltz', 'Chill', 'musicbox', 8, '0:.5:4 .5:.5:2 1:.5:0 1.5:.5:2 2:.5:4 2.5:.5:7 3:1:6 4:.5:5 4.5:.5:3 5:.5:1 5.5:.5:3 6:1:5 7:1:4'],
  ['hook2', 'Catchy Chorus', 'Pop', 'sawlead', 16, '0:1:4 1:.5:4 1.5:.5:5 2:1:7 3:1:5 4:1:4 5:.5:2 5.5:.5:4 6:2:2 8:1:4 9:.5:4 9.5:.5:5 10:1:7 11:1:9 12:2:8 14:2:7'],
  ['trapbell', 'Trap Bells', 'Trap', 'bell', 8, '0:.5:7 .5:.5:7 1:.5:6 1.5:.5:4 2:1:3 3:.5:4 3.5:.5:6 4:.5:7 4.5:.5:7 5:.5:9 5.5:.5:8 6:2:7'],
  ['marim', 'Marimba Dance', 'Latin', 'marimba', 8, '0:.5:0 .5:.5:2 1:.5:4 1.5:.5:7 2:.5:4 2.5:.5:2 3:.5:0 3.5:.5:2 4:.5:1 4.5:.5:3 5:.5:5 5.5:.5:8 6:.5:5 6.5:.5:3 7:1:1'],
  ['reggae', 'Skank Stabs', 'Reggae', 'organ', 8, '0.5:.4:7 1.5:.4:7 2.5:.4:7 3.5:.4:7 4.5:.4:5 5.5:.4:5 6.5:.4:6 7.5:.4:6'],
  ['jazzy', 'Jazzy Phrase', 'Jazz', 'vibes', 16, '0:.75:4 .75:.75:6 1.5:.5:5 2:1:4 3:1:2 4:.75:3 4.75:.75:5 5.5:.5:4 6:2:2 8:.75:4 8.75:.75:7 9.5:.5:6 10:1:5 11:.5:4 11.5:.5:2 12:3:0'],
].map(([id, name, genre, inst, len, str]) => ({ id: 'm:' + id, name, cat: 'Melody', genre, inst, bars: len / 4, kind: 'inst', mel: parseMel(str), len }));

function buildMelody(def, proj) {
  const sc = parentScale(proj.scale);
  return { len: def.len, notes: def.mel.map((n) => ({ s: n.s, d: n.d * 0.92, p: degToMidi(n.deg, proj.key, sc, 5), v: 94 })) };
}

// ---------------------------------------------------------------- assemble the library
export const LOOPS = [];
for (const d of DRUM_DEFS) LOOPS.push({ ...d, tags: [d.genre] });
for (const p of PROGS) {
  for (const s of CHORD_STYLES) LOOPS.push({ id: `c:${p.id}:${s.id}`, name: `${p.name} · ${s.name}`, cat: 'Chords', genre: s.genre, prog: p.id, style: s.id, bars: p.deg.length, kind: 'inst', inst: s.inst, mode: p.mode, tags: [s.genre, p.genre] });
  for (const s of BASS_STYLES) LOOPS.push({ id: `b:${p.id}:${s.id}`, name: `${p.name} · ${s.name}`, cat: 'Bass', genre: s.genre, prog: p.id, style: s.id, bars: p.deg.length, kind: 'inst', inst: s.inst, mode: p.mode, tags: [s.genre, p.genre] });
  for (const s of ARP_STYLES) LOOPS.push({ id: `a:${p.id}:${s.id}`, name: `${p.name} · ${s.name}`, cat: 'Arp', genre: s.genre, prog: p.id, style: s.id, bars: p.deg.length, kind: 'inst', inst: s.inst, mode: p.mode, tags: [s.genre, p.genre] });
}
for (const m of MELODIES) LOOPS.push({ ...m, tags: [m.genre] });

export const LOOP_BY_ID = Object.fromEntries(LOOPS.map((l) => [l.id, l]));
export const LOOP_CATS = ['Drums', 'Chords', 'Bass', 'Arp', 'Melody'];
export const LOOP_GENRES = [...new Set(LOOPS.map((l) => l.genre))].sort();

/** Resolve a loop against the project's key/scale -> { len (beats), notes [{s,d,p,v}] } */
export function buildLoop(loop, proj) {
  if (typeof loop === 'string') loop = LOOP_BY_ID[loop];
  if (!loop) return null;
  if (loop.kind === 'drum') return buildDrum(loop);
  if (loop.cat === 'Melody') return buildMelody(loop, proj);
  const prog = PROG_BY_ID[loop.prog];
  if (loop.cat === 'Chords') return buildChords(prog, CHORD_STYLES.find((s) => s.id === loop.style), proj);
  if (loop.cat === 'Arp') return buildChords(prog, ARP_STYLES.find((s) => s.id === loop.style), proj);
  if (loop.cat === 'Bass') return buildBass(prog, BASS_STYLES.find((s) => s.id === loop.style), proj);
  return null;
}

// ---------------------------------------------------------------- song starters
const S = (id, name, desc, bpm, key, scale, tracks, extra = {}) => ({ id, name, desc, bpm, key, scale, tracks, bars: 16, ...extra });
export const STARTERS = [
  S('lofi', 'Lo-Fi Chill', 'Dusty drums, mellow keys and a warm sub bass', 76, 9, 'Minor', [
    { type: 'drum', kit: 'lofi', loop: 'd:lofi1', name: 'Lo-Fi Drums' },
    { type: 'inst', inst: 'epiano', loop: 'c:lofi:rhodes', name: 'Keys', send: { rev: 0.3, del: 0.12 }, params: { tone: 0.42 } },
    { type: 'inst', inst: 'sub', loop: 'b:lofi:sync', name: 'Bass' },
    { type: 'inst', inst: 'vibes', loop: 'm:bells', name: 'Vibes', start: 8, send: { rev: 0.4, del: 0.2 }, vol: 0.55 },
  ], { swing: 0.2, fx: { reverb: 'room' } }),
  S('trap', 'Trap Banger', 'Heavy 808s, snappy snare, rolling hats and bell melody', 140, 1, 'Minor', [
    { type: 'drum', kit: 'trap', loop: 'd:trap2', name: 'Trap Drums' },
    { type: 'inst', inst: 'bass808', loop: 'b:trapmin:sub808', name: '808' },
    { type: 'inst', inst: 'bell', loop: 'm:trapbell', name: 'Bells', send: { rev: 0.3, del: 0.25 }, vol: 0.6 },
    { type: 'inst', inst: 'warmpad', loop: 'c:trapmin:pad', name: 'Pad', vol: 0.5, send: { rev: 0.4, del: 0 } },
  ]),
  S('boombap', 'Boom Bap Classic', 'Punchy 90s hip-hop with piano chords', 90, 5, 'Minor', [
    { type: 'drum', kit: 'boombap', loop: 'd:boombap1', name: 'Boom Bap Drums' },
    { type: 'inst', inst: 'piano', loop: 'c:minjazz:ballad', name: 'Piano' },
    { type: 'inst', inst: 'sub', loop: 'b:minjazz:sync', name: 'Bass' },
  ], { swing: 0.15 }),
  S('house', 'House Groove', 'Four-on-the-floor with offbeat stabs and a rolling bass', 124, 5, 'Minor', [
    { type: 'drum', kit: 'house', loop: 'd:house1', name: 'House Drums' },
    { type: 'inst', inst: 'synbass', loop: 'b:minpop:offbeat', name: 'Bass' },
    { type: 'inst', inst: 'supersaw', loop: 'c:minpop:offbeat', name: 'Stabs', vol: 0.55, send: { rev: 0.25, del: 0.25 } },
    { type: 'inst', inst: 'arp', loop: 'a:minpop:up16', name: 'Arp', start: 8, vol: 0.5, send: { rev: 0.2, del: 0.3 } },
  ]),
  S('pop', 'Pop Bounce', 'Bright major-key pop with strummed guitar and synth bass', 112, 0, 'Major', [
    { type: 'drum', kit: 'studio', loop: 'd:pop2', name: 'Pop Drums' },
    { type: 'inst', inst: 'guitar', loop: 'c:pop:strum', name: 'Guitar', send: { rev: 0.2, del: 0 } },
    { type: 'inst', inst: 'synbass', loop: 'b:pop:eighth', name: 'Bass' },
    { type: 'inst', inst: 'sawlead', loop: 'm:hook2', name: 'Lead', start: 8, vol: 0.55, send: { rev: 0.25, del: 0.2 } },
  ]),
  S('synthwave', 'Synthwave Night', 'Retro 80s drums, saw bass and shimmering pads', 100, 2, 'Minor', [
    { type: 'drum', kit: 'electro', loop: 'd:synthpop', name: '80s Drums', send: { rev: 0.25, del: 0 } },
    { type: 'inst', inst: 'synbass', loop: 'b:epic:eighth', name: 'Bass' },
    { type: 'inst', inst: 'supersaw', loop: 'c:epic:pad', name: 'Pad', vol: 0.5, send: { rev: 0.35, del: 0.15 } },
    { type: 'inst', inst: 'arp', loop: 'a:epic:up16', name: 'Arp', vol: 0.5, send: { rev: 0.2, del: 0.35 } },
  ], { fx: { reverb: 'plate' } }),
  S('rnb', 'Chill R&B', 'Slow jam with soulful electric piano', 68, 3, 'Major', [
    { type: 'drum', kit: '808', loop: 'd:rnb1', name: 'R&B Drums' },
    { type: 'inst', inst: 'epiano', loop: 'c:soul:ballad', name: 'Keys', send: { rev: 0.3, del: 0.1 } },
    { type: 'inst', inst: 'sub', loop: 'b:soul:sync', name: 'Bass' },
    { type: 'inst', inst: 'choir', loop: 'c:soul:pad', name: 'Choir', start: 8, vol: 0.4, send: { rev: 0.45, del: 0 } },
  ], { swing: 0.15 }),
  S('rock', 'Rock Anthem', 'Driving drums, guitar strums and a pounding bass', 124, 4, 'Major', [
    { type: 'drum', kit: 'studio', loop: 'd:rock1', name: 'Rock Drums' },
    { type: 'inst', inst: 'guitar', loop: 'c:gospel:strum', name: 'Guitar', vol: 0.7 },
    { type: 'inst', inst: 'synbass', loop: 'b:gospel:eighth', name: 'Bass' },
    { type: 'inst', inst: 'organ', loop: 'c:gospel:pad', name: 'Organ', vol: 0.4, start: 8 },
  ]),
  S('futurebass', 'Future Bass', 'Huge detuned chords over half-time drums', 150, 7, 'Minor', [
    { type: 'drum', kit: 'trap', loop: 'd:futurebass', name: 'Drums' },
    { type: 'inst', inst: 'supersaw', loop: 'c:epic:stab', name: 'Chords', vol: 0.55, send: { rev: 0.25, del: 0.15 } },
    { type: 'inst', inst: 'sub', loop: 'b:epic:sync', name: 'Sub' },
    { type: 'inst', inst: 'pluck', loop: 'm:hook2', name: 'Pluck Lead', start: 8, vol: 0.5, send: { rev: 0.3, del: 0.3 } },
  ]),
  S('funk', 'Funk Groove', 'Clavinet, slap-style bass and tight breaks', 100, 7, 'Dorian', [
    { type: 'drum', kit: 'studio', loop: 'd:funk1', name: 'Funk Drums' },
    { type: 'inst', inst: 'pluckbass', loop: 'b:minjazz:funk', name: 'Bass' },
    { type: 'inst', inst: 'clav', loop: 'c:minjazz:stab', name: 'Clav', vol: 0.6 },
    { type: 'inst', inst: 'brass', loop: 'm:stacc', name: 'Brass Hits', start: 8, vol: 0.5 },
  ], { swing: 0.1 }),
  S('cinema', 'Cinematic Pad', 'Slow evolving strings, harp and piano — no drums', 78, 2, 'Minor', [
    { type: 'inst', inst: 'strings', loop: 'c:epic:hold2', name: 'Strings', send: { rev: 0.45, del: 0 } },
    { type: 'inst', inst: 'harp', loop: 'a:epic:harp', name: 'Harp', start: 4, send: { rev: 0.4, del: 0.2 }, vol: 0.55 },
    { type: 'inst', inst: 'piano', loop: 'm:sigh', name: 'Piano Melody', start: 8, send: { rev: 0.4, del: 0.1 }, vol: 0.6 },
  ], { fx: { reverb: 'space' } }),
  S('dnb', 'Drum & Bass', 'Fast breaks, rolling Reese bass and pads', 174, 4, 'Minor', [
    { type: 'drum', kit: 'electro', loop: 'd:dnb1', name: 'DnB Drums' },
    { type: 'inst', inst: 'reese', loop: 'b:minjazz:reese', name: 'Reese' },
    { type: 'inst', inst: 'warmpad', loop: 'c:minjazz:pad', name: 'Pad', vol: 0.45, send: { rev: 0.4, del: 0.1 } },
  ]),
  S('blank_beat', 'Beat From Scratch', 'A drum track and a keys track, ready to fill in', 100, 0, 'Major', [
    { type: 'drum', kit: '808', name: 'Drums' },
    { type: 'inst', inst: 'piano', name: 'Keys' },
  ], { bars: 8, empty: true }),
];

/** Replace the project's contents with a starter. */
export function applyStarter(P, st) {
  P.name = st.name;
  P.bpm = st.bpm; P.key = st.key; P.scale = st.scale; P.swing = st.swing || 0;
  P.fx = { reverb: 'hall', delayDiv: 0.75, delayFb: 0.38, ...(st.fx || {}) };
  P.tracks = []; P.assets = {};
  const total = st.bars * 4;
  P.loop = { on: !st.empty, start: 0, end: total };
  for (const td of st.tracks) {
    const t = newTrack(P, td.type, { kit: td.kit, inst: td.inst, name: td.name });
    if (td.params) t.params = { ...t.params, ...td.params };
    if (td.send) t.send = { ...t.send, ...td.send };
    if (td.vol != null) t.vol = td.vol;
    if (td.pan != null) t.pan = td.pan;
    if (td.loop) {
      const b = buildLoop(td.loop, P);
      const start = (td.start || 0) * 4;
      const r = newRegion(start, total - start, { loopLen: b.len, name: LOOP_BY_ID[td.loop].name });
      r.notes = b.notes.map((n, i) => ({ id: 'n' + t.id + i, ...n }));
      t.regions.push(r);
    }
    P.tracks.push(t);
  }
  return P;
}
