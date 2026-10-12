// Plugin manager: see what's installed, add plugins from a file or from the bundled library, start your own from a template.
import { h } from '../util.js';
import { host } from '../host.js';
import { icon } from './icons.js';
import { modal, button, toast } from './widgets.js';
import { listPlugins, onPluginsChanged } from '../audio/plugins.js';

const KIND = { effect: ['Effect', '#4aa3ff'], instrument: ['Instrument', '#ffb02e'], patches: ['Sound pack', '#5ed16a'] };
const FILTER = 'Sky Studio plugin (*.skyplugin *.json)';
const LIB_INDEX = new URL('../../plugins/index.json', import.meta.url).href;

const TEMPLATES = {
  effect: () => ({
    skyplugin: 1, id: 'my.warm-drive', kind: 'effect', name: 'Warm Drive', version: '1.0', author: 'You', color: '#ff9f43',
    desc: 'A tiny distortion with a tone knob. Edit the code in "dsp" to make your own effect.',
    params: [
      { id: 'drive', label: 'Drive', min: 0, max: 1, def: 0.4, unit: '%' },
      { id: 'tone', label: 'Tone', min: 500, max: 16000, def: 6000, unit: 'Hz', log: true },
      { id: 'mix', label: 'Mix', min: 0, max: 1, def: 1, unit: '%' },
    ],
    dsp: [
      '// Runs on the audio thread. Define create(sampleRate) and return an object with process().',
      '// L, R = input channels; oL, oR = output channels; n = samples in this block; p = knob values by id.',
      'function create(sr) {',
      '  let lpL = 0, lpR = 0;',
      '  return {',
      '    process(L, R, oL, oR, n, p) {',
      '      const g = 1 + p.drive * 12, norm = Math.tanh(g);',
      '      const k = 1 - Math.exp(-TWO_PI * p.tone / sr), mix = p.mix;',
      '      for (let i = 0; i < n; i++) {',
      '        lpL += k * (Math.tanh(L[i] * g) / norm - lpL);',
      '        lpR += k * (Math.tanh(R[i] * g) / norm - lpR);',
      '        oL[i] = L[i] * (1 - mix) + lpL * mix;',
      '        oR[i] = R[i] * (1 - mix) + lpR * mix;',
      '      }',
      '    },',
      '  };',
      '}',
    ].join('\n'),
  }),
  instrument: () => ({
    skyplugin: 1, id: 'my.glass-bell', kind: 'instrument', name: 'Glass Bell', version: '1.0', author: 'You',
    desc: 'A bright bell made from two sine waves. Edit "render" to make your own sound.',
    spec: { level: 0.9, lp: 12000, a: 0.002, r: 0.4 },
    render: [
      '// Runs in a background worker. Return a Float32Array holding ONE note (any length up to 12 seconds).',
      '// api gives you: api.mtof(midi), api.TWO_PI, api.clamp(v, lo, hi), api.rng(seed). sr = sample rate.',
      'function render(midi, sr) {',
      '  const f = api.mtof(midi), len = Math.floor(sr * 2), out = new Float32Array(len);',
      '  for (let i = 0; i < len; i++) {',
      '    const t = i / sr;',
      '    out[i] = (Math.sin(api.TWO_PI * f * t) * Math.exp(-t * 3) + 0.5 * Math.sin(api.TWO_PI * f * 2.76 * t) * Math.exp(-t * 7)) * Math.min(1, t * 400);',
      '  }',
      '  return out;',
      '}',
    ].join('\n'),
  }),
  patches: () => ({
    skyplugin: 1, id: 'my.sound-pack', kind: 'patches', name: 'My Sound Pack', version: '1.0', author: 'You',
    desc: 'A pack of Sky Synth sounds. Copy the "patch" settings from the Synth tab ideas below.',
    patches: [
      { id: 'buzzlead', name: 'Buzz Lead', cat: 'Lead', desc: 'Two detuned squares', patch: { osc1: { wave: 'square' }, osc2: { on: true, wave: 'square', detune: 9 }, filter: { cutoff: 2800, res: 2 } } },
      { id: 'airpad', name: 'Air Pad', cat: 'Pad', desc: 'Slow, wide and soft', patch: { osc1: { wave: 'sawtooth' }, unison: { voices: 3, spread: 30 }, filter: { cutoff: 1400 }, aenv: { a: 0.8, d: 0.5, s: 0.9, r: 1.2 } } },
    ],
  }),
};

const GUIDE = `A Sky Studio plugin is a single text file (JSON) that ends in .skyplugin.

EFFECT plugins add a new effect to the Effects tab.
  • "params" lists your knobs (id, label, min, max, def, optional unit: % ms s Hz dB x st, log: true).
  • "dsp" is JavaScript that defines  function create(sampleRate)  and returns  { process(L, R, oL, oR, n, p) }.
    It runs on the audio thread, so it must be fast and can't touch the page, your files or the internet.

INSTRUMENT plugins add a new sound to the Sounds list.
  • "render" is JavaScript that defines  function render(midi, sr)  and returns a Float32Array with one note.
    It runs in a background worker. Sky Studio renders every key once, caches it, and plays it back (so it uses very little CPU).
  • "spec" shapes playback: level, lp (brightness in Hz), a (attack s), r (release s).

SOUND PACK plugins are only data: a list of Sky Synth patches ("patches"). They contain no code at all.

Use "Plugin template" to download a working example, change it, then install it. A song that uses a plugin carries it inside the .skystudio file.`;

export function showPlugins(app) {
  const body = h('div', { class: 'plug-body' });
  let lib = null, libErr = '';
  let off = null;

  const chip = (kind) => h('span', { class: 'plug-chip', style: { '--c': (KIND[kind] || KIND.effect)[1] } }, (KIND[kind] || KIND.effect)[0]);

  async function fromFile() {
    const f = await host.openDialog({ title: 'Install a plugin', filter: FILTER, multiple: true });
    for (const it of f || []) {
      try {
        const text = typeof it === 'string' ? await host.readText(it) : await it.text();
        await app.installPluginText(text);
      } catch (e) { toast((it.name || String(it).split(/[\\/]/).pop()) + ': ' + (e.message || e), 'error', 6000); }
    }
  }
  async function fromLibrary(entry) {
    try {
      const r = await fetch(new URL('../../plugins/' + entry.file, import.meta.url).href, { cache: 'no-store' });
      if (!r.ok) throw new Error('not found');
      await app.installPluginText(await r.text());
    } catch (e) { toast(`Could not install “${entry.name}”: ${e.message || e}`, 'error', 6000); }
  }
  async function template(kind) {
    const t = TEMPLATES[kind]();
    const path = await host.saveDialog({ title: 'Save plugin template', filter: FILTER, name: t.id.replace(/^my\./, 'my-') + '.skyplugin' });
    if (!path) return;
    if (await host.writeText(path, JSON.stringify(t, null, 2))) toast('Saved the template — edit it in any text editor, then use “Install from file”.', 'info', 5000);
  }
  function guide() { modal('How to make a plugin', h('pre', { class: 'plug-guide' }, GUIDE), [{ label: 'Close', primary: true }], { width: 640 }); }

  function draw() {
    body.replaceChildren();
    const have = new Map(listPlugins().map((p) => [p.id, p]));
    body.append(h('p', { class: 'hint', style: { marginTop: '4px' } }, 'Plugins add new effects, instruments and sound packs. Effects run in a sandbox on the audio thread, instruments in a background worker, and sound packs are plain data. They can’t read your files or use the internet — but only install plugin files you trust.'));
    body.append(h('div', { class: 'row wrap', style: { gap: '8px', margin: '10px 0 4px' } },
      button('Install from file…', fromFile, { class: 'primary', icon: 'upload' }),
      button('Effect template', () => template('effect'), { class: 'sm', icon: 'download' }),
      button('Instrument template', () => template('instrument'), { class: 'sm', icon: 'download' }),
      button('Sound pack template', () => template('patches'), { class: 'sm', icon: 'download' }),
      button('How to make one', guide, { class: 'sm ghost', icon: 'info' })));

    body.append(h('div', { class: 'sect-t', style: { margin: '14px 0 6px' } }, 'Installed (' + have.size + ')'));
    if (!have.size) body.append(h('div', { class: 'hint' }, 'Nothing installed yet. Pick something from the library below or install a file.'));
    for (const p of have.values()) {
      body.append(h('div', { class: 'plug-row' },
        h('div', { class: 'plug-main' }, h('div', { class: 'plug-n' }, p.name, chip(p.kind), h('span', { class: 'hint' }, ` v${p.version}${p.author ? ' · ' + p.author : ''}`)),
          h('div', { class: 'hint' }, p.desc || (p.kind === 'patches' ? p.patches.length + ' Sky Synth sounds' : ''))),
        button('Remove', () => app.removePluginById(p.id), { class: 'sm ghost' })));
    }

    body.append(h('div', { class: 'sect-t', style: { margin: '16px 0 6px' } }, 'Library (included with Sky Studio)'));
    if (libErr) body.append(h('div', { class: 'hint' }, libErr));
    else if (!lib) body.append(h('div', { class: 'hint' }, 'Loading…'));
    else for (const e of lib) {
      const cur = have.get(e.id), newer = cur && cur.version !== e.version;
      body.append(h('div', { class: 'plug-row' },
        h('div', { class: 'plug-main' }, h('div', { class: 'plug-n' }, e.name, chip(e.kind), h('span', { class: 'hint' }, ` v${e.version}`)), h('div', { class: 'hint' }, e.desc)),
        cur && !newer ? h('span', { class: 'hint', style: { padding: '0 8px' } }, icon('check', 14), ' Installed') : button(newer ? 'Update' : 'Install', () => fromLibrary(e), { class: 'sm primary' })));
    }
  }

  modal('Plugins', body, [{ label: 'Done', primary: true, onClick: () => { if (off) off(); } }], { width: 680, onClose: () => { if (off) off(); } });
  off = onPluginsChanged(draw);
  draw();
  fetch(LIB_INDEX, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error('no library')))).then((j) => { lib = j.plugins || []; draw(); })
    .catch(() => { libErr = 'The plugin library could not be loaded.'; draw(); });
}
