// Bottom dock: Editor (piano roll / beat sequencer / audio) | Mixer | Play (keys + pads).
import { h, clamp } from '../util.js';
import { icon } from './icons.js';
import { iconBtn, button } from './widgets.js';
import { createPianoRoll } from './pianoroll.js';
import { createStepSeq } from './stepseq.js';
import { createAudioEditor } from './audioedit.js';
import { createMixer } from './mixer.js';
import { createKeys } from './keys.js';
import { createFxRack } from './fxrack.js';
import { createAutoEditor } from './autoedit.js';
import { createSynthEd } from './synthed.js';
import { createSoundLab } from './soundlab.js';

export function mountDock(app, root) {
  root.replaceChildren();
  const split = h('div', { class: 'dock-split' });
  const tabs = h('div', { class: 'dock-tabs' });
  const body = h('div', { class: 'dock-body' });
  root.append(split, tabs, body);

  const roll = createPianoRoll(app), steps = createStepSeq(app), audio = createAudioEditor(app), mixer = createMixer(app), keys = createKeys(app), fxrack = createFxRack(app), autoed = createAutoEditor(app), lab = createSoundLab(app), synthed = createSynthEd(app);
  const empty = h('div', { class: 'empty', style: { margin: 'auto' } });
  const edPane = h('div', { style: { display: 'flex', flex: 1, minHeight: 0 } }, empty, roll.el, steps.el, audio.el);
  const mixPane = h('div', { style: { display: 'flex', flex: 1, minHeight: 0 } }, mixer.el);
  const keyPane = h('div', { style: { display: 'flex', flex: 1, minHeight: 0 } }, keys.el);
  const fxPane = h('div', { style: { display: 'flex', flex: 1, minHeight: 0 } }, fxrack.el);
  const autoPane = h('div', { style: { display: 'flex', flex: 1, minHeight: 0 } }, autoed.el);
  const synthPane = h('div', { style: { display: 'flex', flex: 1, minHeight: 0 } }, synthed.el);
  const labPane = h('div', { style: { display: 'flex', flex: 1, minHeight: 0 } }, lab.el);
  body.append(edPane, mixPane, keyPane, fxPane, autoPane, synthPane, labPane);

  let shown = null;    // 'empty' | 'roll' | 'steps' | 'audio'
  function showEditor() {
    const info = app.editInfo;
    let mode = 'empty';
    if (info) mode = info.track.type === 'audio' ? 'audio' : info.track.type === 'drum' ? 'steps' : 'roll';
    const view = { empty, roll: roll.el, steps: steps.el, audio: audio.el };
    for (const [k, el] of Object.entries(view)) el.style.display = k === mode ? (k === 'empty' ? 'block' : 'flex') : 'none';
    if (mode === 'empty') {
      const t = app.selTrack;
      empty.replaceChildren(h('b', {}, 'Nothing to edit yet'),
        t && t.type !== 'audio' ? h('div', {}, 'Double-click a region to edit its notes, or ', h('div', { style: { marginTop: '10px' } }, button('New region on “' + t.name + '”', () => app.newEmptyRegion(t.id, app.pos, 2), { class: 'primary', icon: 'plus' })))
          : 'Select a region in the timeline (or drop a loop from the library) to edit it here.');
    } else {
      const ed = mode === 'roll' ? roll : mode === 'steps' ? steps : audio;
      if (ed.regionId !== app.sel.edit || shown !== mode) ed.setRegion(app.sel.edit); else ed.refresh();
    }
    shown = mode;
  }

  function render() {
    const v = app.view;
    document.getElementById('app').classList.toggle('no-bottom', !v.bottomOpen);
    document.getElementById('app').style.setProperty('--bottom-h', v.bottomH + 'px');
    const mk = (id, label, ic) => h('button', { class: 'tab' + (v.bottomOpen && v.bottom === id ? ' on' : ''), onClick: () => { v.bottom = id; v.bottomOpen = true; app.emit('layout'); } }, icon(ic, 15), label);
    tabs.replaceChildren(mk('editor', 'Editor', 'note'), mk('mixer', 'Mixer', 'mixer'), mk('fx', 'Effects', 'magic'), mk('auto', 'Automation', 'arpeggio'), mk('synth', 'Synth', 'wave'), mk('lab', 'Sound Lab', 'star'), mk('keys', 'Play', 'piano'),
      h('div', { style: { flex: 1 } }),
      h('span', { class: 'hint', style: { marginRight: '10px' } }, v.bottom === 'keys' && v.bottomOpen ? 'Keys A–; play notes · Z/X octave' : ''),
      iconBtn(v.bottomOpen ? 'chevron' : 'up', v.bottomOpen ? 'Collapse' : 'Expand', () => { v.bottomOpen = !v.bottomOpen; app.emit('layout'); }, '', 18));
    edPane.style.display = v.bottom === 'editor' ? 'flex' : 'none';
    mixPane.style.display = v.bottom === 'mixer' ? 'flex' : 'none';
    keyPane.style.display = v.bottom === 'keys' ? 'flex' : 'none';
    fxPane.style.display = v.bottom === 'fx' ? 'flex' : 'none';
    autoPane.style.display = v.bottom === 'auto' ? 'flex' : 'none';
    synthPane.style.display = v.bottom === 'synth' ? 'flex' : 'none';
    labPane.style.display = v.bottom === 'lab' ? 'flex' : 'none';
    if (v.bottom === 'lab' && v.bottomOpen) lab.refresh();
    if (v.bottom === 'synth' && v.bottomOpen) synthed.refresh();
    if (v.bottom === 'auto' && v.bottomOpen) requestAnimationFrame(() => autoed.refresh());
    if (v.bottomOpen && v.bottom === 'editor') { showEditor(); requestAnimationFrame(() => { roll.resize(); steps.resize(); audio.resize(); }); }
    if (v.bottom !== 'keys' && v.bottom !== 'lab') keys.releaseAll();
  }

  split.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const y0 = e.clientY, h0 = app.view.bottomH;
    const mv = (m) => { app.view.bottomH = clamp(h0 + (y0 - m.clientY), 180, window.innerHeight * 0.75); document.getElementById('app').style.setProperty('--bottom-h', app.view.bottomH + 'px'); };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); roll.resize(); steps.resize(); audio.resize(); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  });

  app.on('labpad', (pad) => { lab.setPad(pad); app.view.bottom = 'lab'; app.view.bottomOpen = true; app.emit('layout'); });
  app.on('layout', render);
  app.on('selection', () => { if (app.view.bottom === 'editor' && app.view.bottomOpen) showEditor(); });
  app.on('change', (k) => {
    if (k === 'params' || k === 'recording') return;
    if (app.view.bottom === 'editor' && app.view.bottomOpen) showEditor();
  });
  render();
  return {
    keys, lab,
    frame() {
      if (!app.view.bottomOpen) return;
      if (app.view.bottom === 'editor') { roll.frame(); steps.frame(); audio.frame(); }
      else if (app.view.bottom === 'mixer') mixer.frame();
      else if (app.view.bottom === 'auto') autoed.frame();
    },
  };
}
