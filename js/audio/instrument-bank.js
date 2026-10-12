// Registers the Sky Synth instruments (the editable synth + its factory presets) with the instrument library.
// Imported for its side effect by the engine, so every part of the app sees the full list.
import { INSTRUMENTS, INST_BY_ID, INST_CATS } from './instruments.js';
import { patchVoice, SYNTH_PRESETS, DEFAULT_PATCH } from './synthpatch.js';

if (!INST_BY_ID.synth) {
  const add = (inst) => { INSTRUMENTS.push(inst); INST_BY_ID[inst.id] = inst; };
  add({ id: 'synth', name: 'Sky Synth (editable)', cat: 'Sky Synth', sub: 'Editable', icon: 'wave', desc: 'Design your own sound — open the Synth tab', editable: true, start: patchVoice((P) => P.patch || DEFAULT_PATCH) });
  for (const p of SYNTH_PRESETS) {
    add({ id: p.id, name: p.name, cat: 'Sky Synth', sub: p.cat, icon: p.cat === 'Bass' ? 'bass' : p.cat === 'Pad' ? 'pad' : p.cat === 'Keys' ? 'piano' : 'wave', desc: p.desc,
      role: p.cat === 'Bass' ? 'bass' : undefined, sustain: p.cat === 'Pad' || undefined, patch: p.patch, start: patchVoice(p.patch) });
  }
  if (!INST_CATS.includes('Sky Synth')) INST_CATS.push('Sky Synth');
}
