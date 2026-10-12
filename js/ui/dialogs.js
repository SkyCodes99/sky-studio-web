// Dialogs: new track, song starters, export, settings, about, shortcuts, prompts.
import { h } from '../util.js';
import { icon } from './icons.js';
import { modal, button, segmented, toast } from './widgets.js';
import { INSTRUMENTS, INST_CATS } from '../audio/instruments.js';
import { KITS } from '../audio/drums.js';
import { STARTERS } from '../library/loops.js';
import { auditionInstrument, auditionKit } from './preview.js';
import { host } from '../host.js';
import { NOTE_NAMES } from '../theory.js';

export const APP_VERSION = '1.4.0';

export function promptText(title, value = '', label = '') {
  return new Promise((resolve) => {
    let done = false;
    const inp = h('input', { class: 'txt', value, style: { width: '100%', height: '34px' }, onKeyDown: (e) => { e.stopPropagation(); if (e.key === 'Enter') { done = true; box.close(); resolve(inp.value); } } });
    const box = modal(title, h('div', {}, label ? h('div', { class: 'hint', style: { marginBottom: '8px' } }, label) : null, inp),
      [{ label: 'Cancel' }, { label: 'OK', primary: true, onClick: () => { done = true; resolve(inp.value); } }],
      { width: 380, onClose: () => { if (!done) resolve(null); } });
    setTimeout(() => { inp.focus(); inp.select(); }, 40);
  });
}

export function confirmBox({ title, body, ok = 'OK', cancel = 'Cancel', resolve }) {
  let answered = false;
  modal(title, h('div', { class: 'hint', style: { fontSize: '13.5px' } }, body),
    [{ label: cancel, onClick: () => { answered = true; resolve(false); } }, { label: ok, primary: true, onClick: () => { answered = true; resolve(true); } }],
    { width: 420, onClose: () => { if (!answered) resolve(false); } });
}

// ---------------------------------------------------------------- new track
export function showNewTrack(app, preset) {
  let mode = preset || 'inst', pickInst = 'piano', pickKit = '808';
  const body = h('div');
  const tabs = segmented([{ id: 'inst', label: 'Instrument', icon: 'piano' }, { id: 'drum', label: 'Drums', icon: 'drum' }, { id: 'audio', label: 'Audio', icon: 'mic' }, { id: 'sampler', label: 'Sampler', icon: 'wave' }], mode, (m) => { mode = m; draw(); });
  const create = () => {
    if (mode === 'inst') app.addTrack('inst', { inst: pickInst });
    else if (mode === 'drum') app.addTrack('drum', { kit: pickKit });
    else if (mode === 'audio') app.addTrack('audio');
    else { box.close(); trackFromSample(app); return; }
    box.close();
  };
  function card(name, desc, on, onClick, onDbl, ic) {
    return h('button', { class: 'starter' + (on ? ' on' : ''), style: on ? { borderColor: 'var(--accent)', background: '#4aa3ff22' } : null, onClick, onDblclick: onDbl }, h('div', { class: 'row', style: { gap: '8px' } }, icon(ic || 'note', 16), h('b', {}, name)), h('span', {}, desc));
  }
  function draw() {
    tabs.set(mode);
    body.replaceChildren();
    if (mode === 'inst') {
      for (const cat of INST_CATS) {
        body.append(h('div', { class: 'sect-t', style: { margin: '12px 0 6px' } }, cat));
        body.append(h('div', { class: 'starter-grid' }, INSTRUMENTS.filter((i) => i.cat === cat).map((i) => card(i.name, i.desc, pickInst === i.id, () => { pickInst = i.id; auditionInstrument(app, i.id); draw(); }, create, i.icon))));
      }
    } else if (mode === 'drum') {
      body.append(h('div', { class: 'starter-grid', style: { marginTop: '10px' } }, KITS.map((k) => card(k.name, k.desc, pickKit === k.id, () => { pickKit = k.id; auditionKit(app, k.id); draw(); }, create, 'drum'))));
    } else if (mode === 'audio') {
      body.append(h('div', { class: 'hint', style: { padding: '24px 4px', fontSize: '13.5px' } }, 'An audio track holds recordings and imported audio files (WAV, MP3, OGG, FLAC, M4A…). You can also just drag a file onto the timeline.'));
    } else {
      body.append(h('div', { class: 'hint', style: { padding: '24px 4px', fontSize: '13.5px' } }, 'A sampler track turns one of your own audio files into a playable instrument — the sample is pitched up and down across the keyboard. Choose a file to continue.'));
    }
  }
  draw();
  const box = modal('New track', h('div', {}, tabs, h('div', { style: { maxHeight: '52vh', overflowY: 'auto', marginTop: '4px' } }, body)),
    [{ label: 'Cancel', onClick: () => app.engine.previewStopAll() }, { label: mode === 'sampler' ? 'Choose file…' : 'Create', primary: true, onClick: () => { create(); return false; } }], { width: 700, onClose: () => app.engine.previewStopAll(), focus: false });
}

export async function trackFromSample(app) {
  const f = await host.openDialog({ title: 'Choose a sample for the sampler', filter: 'Audio files (*.wav *.mp3 *.ogg *.flac *.m4a *.aif *.aiff)' });
  if (!f.length) return;
  const it = typeof f[0] === 'string' ? { path: f[0], name: f[0].split(/[\\/]/).pop() } : f[0];
  try {
    const buf = await app.decodeFile(it);
    const asset = app.makeAsset(it.name.replace(/\.[^.]+$/, ''), buf);
    app.addTrack('inst', { sampler: { asset: asset.id, root: 60, start: 0 }, name: asset.name });
  } catch (e) { toast('Could not read that audio file', 'error'); }
}

// ---------------------------------------------------------------- starters
export function showStarters(app, welcome) {
  const colors = ['#ff9f43', '#ff5f57', '#ffd23f', '#5ed16a', '#2ed3b7', '#4aa3ff', '#8f7bff', '#ff6fb5'];
  const grid = h('div', { class: 'starter-grid' }, STARTERS.map((s, i) => h('button', { class: 'starter', onClick: async () => { box.close(); await app.newProject(s); app.view.bottom = 'editor'; app.emit('layout'); } },
    h('div', { class: 'bar', style: { background: colors[i % colors.length] } }), h('div', { class: 'bpm' }, s.empty ? '' : s.bpm + ' BPM'), h('b', {}, s.name), h('span', {}, s.desc))));
  const body = h('div', {}, h('p', { class: 'hint', style: { margin: '0 0 12px' } }, 'Pick a starting point — every part is made of library loops you can swap, edit or delete.'), grid);
  const box = modal(welcome ? 'Welcome to Sky Studio' : 'Song starters', body, welcome ? [
    { label: 'Open a project…', onClick: () => { app.openProject(); } },
    { label: 'Start with a blank project', primary: true },
  ] : [{ label: 'Close' }], { width: 760 });
  if (welcome) {
    box.querySelector('.modal-f').prepend(h('label', { class: 'row', style: { marginRight: 'auto', gap: '8px' } }, h('input', { type: 'checkbox', class: 'switch', checked: app.settings.welcome !== false, onChange: (e) => { app.settings.welcome = e.target.checked; app.saveSettings(); } }), h('span', { class: 'hint' }, 'Show this when Sky Studio starts')));
    const rec = (app.settings.recent || []).slice(0, 3);
    if (rec.length) body.append(h('div', { class: 'sect-t', style: { margin: '16px 0 6px' } }, 'Recent'), h('div', { class: 'row wrap' }, rec.map((p) => button(p.split(/[\\/]/).pop().replace(/\.skystudio$/i, ''), () => { box.close(); app.openProject(p); }, { icon: 'folder' }))));
  }
}

// ---------------------------------------------------------------- export
export function showExport(app) {
  const o = { range: 'all', bits: 16, sr: 44100, normalize: true };
  const sel = (opts, key, cast = (x) => x) => { const s = h('select', { class: 'sel', onChange: (e) => (o[key] = cast(e.target.value)) }, opts.map(([v, l]) => h('option', { value: v, selected: String(o[key]) === String(v) }, l))); return s; };
  const loopOk = app.project.loop.end > app.project.loop.start;
  const body = h('div', {},
    h('div', { class: 'form-row' }, h('label', {}, 'What to export'), sel([['all', 'Whole song'], ...(loopOk ? [['loop', `Loop range (bars ${Math.round(app.project.loop.start / app.bpb) + 1}–${Math.round(app.project.loop.end / app.bpb)})`]] : [])], 'range')),
    h('div', { class: 'form-row' }, h('label', {}, 'Quality'), sel([[16, '16-bit WAV (CD quality)'], [24, '24-bit WAV (studio)'], [32, '32-bit float WAV']], 'bits', Number)),
    h('div', { class: 'form-row' }, h('label', {}, 'Sample rate'), sel([[44100, '44,100 Hz'], [48000, '48,000 Hz']], 'sr', Number)),
    h('div', { class: 'form-row' }, h('label', {}, 'Loudness'), h('label', { class: 'row' }, h('input', { type: 'checkbox', class: 'switch', checked: true, onChange: (e) => (o.normalize = e.target.checked) }), h('span', {}, 'Make it as loud as possible without clipping'))),
    h('p', { class: 'hint' }, 'The song is rendered offline, so it sounds exactly like playback. Your reverb and delay tails are included.'));
  modal('Export audio', body, [
    { label: 'Cancel' },
    { label: 'Export each track (stems)…', onClick: () => { app.exportStems(o); } },
    { label: 'Export WAV…', primary: true, onClick: () => { app.exportAudio(o); } },
  ], { width: 560 });
}

// ---------------------------------------------------------------- settings
export async function showSettings(app) {
  const S = app.settings;
  const save = () => { app.saveSettings(); };
  let outs = [], ins = [];
  try {
    const devs = await Promise.race([navigator.mediaDevices.enumerateDevices(), new Promise((r) => setTimeout(() => r([]), 700))]);
    outs = devs.filter((x) => x.kind === 'audiooutput'); ins = devs.filter((x) => x.kind === 'audioinput');
  } catch { /* */ }
  const folders = h('div');
  const drawFolders = () => {
    folders.replaceChildren(...(S.sampleFolders || []).map((f, i) => h('div', { class: 'row sp', style: { margin: '3px 0' } }, h('span', { class: 'hint', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 } }, f),
      h('button', { class: 'btn sm', onClick: () => { S.sampleFolders.splice(i, 1); save(); drawFolders(); app.emit('samples'); } }, 'Remove'))));
    if (!(S.sampleFolders || []).length) folders.append(h('div', { class: 'hint' }, 'No folders yet.'));
  };
  drawFolders();
  const body = h('div', {},
    h('div', { class: 'sect-t', style: { margin: '4px 0 8px' } }, 'Audio'),
    outs.length ? h('div', { class: 'form-row' }, h('label', {}, 'Output device'), h('select', { class: 'sel', style: { flex: 1 }, onChange: (e) => { S.sinkId = e.target.value; save(); app.applyOutputDevice(); } },
      [h('option', { value: '' }, 'System default'), ...outs.filter((d) => d.deviceId && d.deviceId !== 'default').map((d) => h('option', { value: d.deviceId, selected: S.sinkId === d.deviceId }, d.label || 'Output'))])) : null,
    ins.length ? h('div', { class: 'form-row' }, h('label', {}, 'Microphone'), h('select', { class: 'sel', style: { flex: 1 }, onChange: (e) => { S.micDevice = e.target.value; save(); } },
      [h('option', { value: '' }, 'System default'), ...ins.filter((d) => d.deviceId && d.deviceId !== 'default').map((d) => h('option', { value: d.deviceId, selected: S.micDevice === d.deviceId }, d.label || 'Input'))])) : null,
    h('div', { class: 'form-row' }, h('label', {}, 'Recording delay'), h('input', { class: 'num', type: 'text', value: S.latencyMs, style: { width: '70px' }, onChange: (e) => { S.latencyMs = Math.max(-200, Math.min(500, parseFloat(e.target.value) || 0)); save(); } }), h('span', { class: 'hint' }, 'ms — shift microphone takes earlier if they land late')),
    h('div', { class: 'sect-t', style: { margin: '18px 0 8px' } }, 'Recording notes'),
    h('div', { class: 'form-row' }, h('label', {}, 'Auto-tighten timing'), h('select', { class: 'sel', onChange: (e) => { S.recQuant = e.target.value; save(); } }, [['off', 'Off (keep my exact timing)'], ['1/32', '1/32 note'], ['1/16', '1/16 note (recommended)'], ['1/8', '1/8 note']].map(([v, l]) => h('option', { value: v, selected: S.recQuant === v }, l)))),
    h('div', { class: 'form-row' }, h('label', {}, 'Loop previews'), h('label', { class: 'row' }, h('input', { type: 'checkbox', class: 'switch', checked: S.autoPreview, onChange: (e) => { S.autoPreview = e.target.checked; save(); } }), h('span', {}, 'Play a loop when I click it in the library'))),
    h('div', { class: 'sect-t', style: { margin: '18px 0 8px' } }, 'Your sample folders'),
    folders,
    h('div', { style: { marginTop: '6px' } }, button('Add a folder…', async () => { const f = await host.pickFolder('Choose a folder of samples'); if (f) { S.sampleFolders = [...new Set([...(S.sampleFolders || []), f])]; save(); drawFolders(); app.emit('samples'); } }, { icon: 'plus' })),
    h('div', { class: 'sect-t', style: { margin: '18px 0 8px' } }, 'Privacy'),
    h('p', { class: 'hint' }, 'Sky Studio works completely offline. It has no network code, no accounts and no analytics. Your music, samples and recordings stay on this computer. The microphone is only opened while you are recording an armed audio track.'));
  modal('Settings', body, [{ label: 'Done', primary: true }], { width: 600 });
}

export function showShortcuts() {
  const rows = [
    ['Space', 'Play / pause'], ['Enter', 'Go to start'], ['R', 'Record'], ['C', 'Cycle (loop) on/off'], ['K', 'Metronome'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
    ['S', 'Split region at playhead'], ['Ctrl+D', 'Duplicate region'], ['Ctrl+C / X / V', 'Copy / cut / paste regions'], ['Delete', 'Delete region(s)'], ['Ctrl+A', 'Select all regions on the track'],
    ['Ctrl+S', 'Save'], ['Ctrl+O', 'Open'], ['Ctrl+N', 'New'], ['Ctrl+E', 'Export'], ['Ctrl + scroll', 'Zoom the timeline'], ['Alt + drag a region', 'Copy it'],
    ['Home / End', 'Playhead to start / last region'], ['Z X', 'Keyboard octave down / up'], ['A S D F G H J K', 'Play notes (when the Keys panel is open)'], ['B / M / D', 'Mixer / Editor / Keys panels'],
  ];
  modal('Keyboard shortcuts', h('dl', { class: 'kv' }, rows.flatMap(([k, d]) => [h('dt', {}, h('span', { class: 'kbd' }, k)), h('dd', {}, d)])), [{ label: 'Close', primary: true }], { width: 520 });
}

export async function showAbout(app) {
  const v = (await host.call('version')) || { version: APP_VERSION + ' (dev)', notes: [] };
  modal('About Sky Studio', h('div', {}, h('p', { style: { fontSize: '14px' } }, `Sky Studio ${v.version} — a beat and music maker.`),
    h('p', { class: 'hint' }, `Every drum, instrument and loop is generated by the app itself (${INSTRUMENTS.length} instruments, ${KITS.length} drum kits). Nothing is downloaded and nothing leaves your computer${host.native ? '' : ' (this web version runs entirely in your browser — your songs are only saved to files you choose)'}.`),
    v.notes && v.notes.length ? h('div', {}, h('div', { class: 'sect-t', style: { margin: '14px 0 6px' } }, 'In this version'), h('ul', { class: 'upd-notes' }, v.notes.map((n) => h('li', {}, n)))) : null),
    [{ label: 'Close', primary: true }], { width: 500 });
}
