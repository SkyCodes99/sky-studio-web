// Auditioning: short previews of instruments, drum kits, loops and samples (never touches the project).
import { INST_BY_ID, DEFAULT_PARAMS, isBassInst } from '../audio/instruments.js';
import '../audio/instrument-bank.js';
import { KIT_BY_ID, ensureKit, PAD } from '../audio/drums.js';
import { degToMidi, parentScale } from '../theory.js';
import { buildLoop, LOOP_BY_ID } from '../library/loops.js';
import { loopCompatible } from '../app.js';

const note = (s, d, p, v = 100) => ({ s, d, p, v });
let token = 0;   // only the most recent audition may start (clicking quickly never leaves an old one playing)

export async function auditionInstrument(app, instId) {
  const my = ++token, ep = app.engine.stopEpoch || 0;
  const inst = INST_BY_ID[instId];
  if (!inst) return;
  const P = app.project, sc = parentScale(P.scale);
  const bass = isBassInst(inst);
  const oct = bass ? 2 : instId === 'glock' || instId === 'musicbox' || instId === 'arp' ? 4 : 3;
  const m = (d, o = oct) => degToMidi(d, P.key, sc, o);
  let notes;
  if (bass) notes = [note(0, 0.9, m(0), 110), note(1, 0.45, m(0), 90), note(1.5, 0.45, m(4), 100), note(2, 0.9, m(3), 105), note(3, 0.9, m(4), 105)];
  else if (inst.cat === 'FX') notes = [note(0, 2.4, m(0, 3), 105)];
  else if (inst.cat === 'Pads' || inst.sustain) notes = [m(0), m(2), m(4), m(7)].map((p, i) => note(0 + i * 0.02, 3.2, p, 90));
  else notes = [note(0, 0.5, m(0, oct + 1)), note(0.5, 0.5, m(2, oct + 1)), note(1, 0.5, m(4, oct + 1)), note(1.5, 0.5, m(7, oct + 1)), ...[0, 2, 4, 7].map((d, i) => note(2.5 + i * 0.02, 2.2, m(d, oct), 96))];
  await app.ctx.resume();
  if (my !== token || (app.engine.stopEpoch || 0) !== ep) return;
  const params = { ...DEFAULT_PARAMS, ...(inst.defaults || {}) };
  app.engine.previewLoop({ type: 'inst', inst: instId, params, patch: inst.patch || (app.selTrack && app.selTrack.inst === instId ? app.selTrack.patch : undefined) }, notes, 5, 112, true);
}

export async function auditionKit(app, kitId) {
  const my = ++token, ep = app.engine.stopEpoch || 0;
  await app.ctx.resume();
  await ensureKit(kitId, app.ctx.sampleRate);
  if (my !== token || (app.engine.stopEpoch || 0) !== ep) return;
  const p = (pad, s, v = 100) => note(s, 0.2, 36 + PAD[pad], v);
  const notes = [p('kick', 0, 115), p('hat', 0), p('hat', 0.5, 70), p('snare', 1, 112), p('hat', 1), p('hat', 1.5, 70), p('kick', 1.75, 100), p('kick', 2, 115), p('hat', 2), p('ohat', 2.5, 80), p('snare', 3, 112), p('clap', 3, 90), p('hat', 3), p('hat', 3.5, 70), p('tomL', 3.75, 90), p('crash', 4, 100), p('kick', 4, 115)];
  app.engine.previewLoop({ type: 'drum', kit: kitId, params: { tone: 0.5, attack: 0.5, release: 1 }, padSamples: {} }, notes, 6, 100, true);
}

export async function auditionLoop(app, loopId) {
  const loop = typeof loopId === 'string' ? LOOP_BY_ID[loopId] : loopId;
  if (!loop) return;
  const my = ++token, ep = app.engine.stopEpoch || 0;
  await app.ctx.resume();
  const b = buildLoop(loop, app.project);
  const bpm = app.project.tracks.length ? app.project.bpm : loop.bpm || app.project.bpm;
  let tl;
  if (loop.kind === 'drum') {
    const st = app.selTrack && app.selTrack.type === 'drum' ? app.selTrack : app.project.tracks.find((t) => t.type === 'drum');
    const kit = loop.kit || (st ? st.kit : '808');
    await ensureKit(kit, app.ctx.sampleRate);
    if (my !== token || (app.engine.stopEpoch || 0) !== ep) return;
    tl = { type: 'drum', kit, params: st ? { ...st.params } : { tone: 0.5, attack: 0.5, release: 1 }, padSamples: st && st.kit === kit ? st.padSamples : {} };
  } else {
    const st = app.selTrack && loopCompatible(app.selTrack, loop) ? app.selTrack : null;
    const instId = st ? st.inst : loop.inst;
    tl = { type: 'inst', inst: instId, params: st ? { ...st.params } : { ...DEFAULT_PARAMS, ...(INST_BY_ID[instId].defaults || {}) }, sample: st && st.sample };
  }
  if (my !== token || (app.engine.stopEpoch || 0) !== ep) return;
  app.engine.previewLoop(tl, b.notes, b.len, bpm, true, 2);
}

export async function auditionSample(app, item) {
  const my = ++token, ep = app.engine.stopEpoch || 0;
  await app.ctx.resume();
  app.engine.previewStop();
  const buf = await app.decodeFile(item);
  if (my !== token || (app.engine.stopEpoch || 0) !== ep) return;
  app.engine.previewBuffer(buf);
}
