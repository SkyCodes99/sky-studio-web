// "Slice to pads": chop an audio file at its hits (or into equal parts) onto the 16 pads of a new drum track.
import { h, clamp } from '../util.js';
import { modal, button, toast } from './widgets.js';
import { detectSlices, equalSlices, sliceRanges } from '../audio/slicer.js';

export function showSlice(app, assetId) {
  const a = app.project.assets[assetId];
  if (!a || !a.buffer) { toast('That audio is not available to slice', 'warn'); return; }
  const S = { mode: 'hits', count: 8, sens: 0.55, replay: true, starts: [] };
  const recompute = () => { S.starts = S.mode === 'hits' ? detectSlices(a.buffer, { max: 16, sensitivity: S.sens }) : equalSlices(a.buffer, S.count); draw(); label(); };

  const W = 660, H = 150, dpr = Math.min(2, window.devicePixelRatio || 1);
  const cv = h('canvas', { style: { width: W + 'px', height: H + 'px', borderRadius: '8px', background: '#101319', cursor: 'pointer', display: 'block' } });
  cv.width = W * dpr; cv.height = H * dpr;
  const info = h('div', { class: 'hint', style: { margin: '8px 0' } });
  const xOf = (t) => (t / a.duration) * W;
  const tOf = (x) => (x / W) * a.duration;

  function draw() {
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#101319'; g.fillRect(0, 0, W, H);
    const pk = a.peaks, bins = pk.length / 2;
    g.fillStyle = '#4aa3ff';
    for (let x = 0; x < W; x++) {
      const b0 = Math.floor((x / W) * bins), b1 = Math.max(b0, Math.floor(((x + 1) / W) * bins) - 1);
      let mn = 1, mx = -1; for (let b = b0; b <= b1; b++) { if (pk[b * 2] < mn) mn = pk[b * 2]; if (pk[b * 2 + 1] > mx) mx = pk[b * 2 + 1]; }
      if (mn > mx) continue;
      g.fillRect(x, H / 2 - mx * (H / 2 - 6), 1, Math.max(1, (mx - mn) * (H / 2 - 6)));
    }
    S.starts.forEach((t, i) => {
      const x = Math.round(xOf(t)) + 0.5;
      g.fillStyle = i < 16 ? '#ffd23f' : '#ff5f57'; g.fillRect(x, 0, 1.5, H);
      g.fillStyle = '#0b0c10'; g.fillRect(x + 2, 3, 20, 14); g.fillStyle = i < 16 ? '#ffd23f' : '#ff5f57'; g.font = '10px "Segoe UI"'; g.textBaseline = 'middle'; g.fillText(String(i + 1), x + 6, 10);
    });
  }
  function label() { info.textContent = `${Math.min(16, S.starts.length)} slice${S.starts.length === 1 ? '' : 's'} → pads 1–${Math.min(16, S.starts.length)}${S.starts.length > 16 ? ` (${S.starts.length - 16} extra will be ignored)` : ''}. Click a piece to hear it • Alt-click adds a cut • right-click a cut to remove it.`; }

  const near = (x) => { let best = -1, bd = 7; S.starts.forEach((t, i) => { const d = Math.abs(xOf(t) - x); if (d < bd) { bd = d; best = i; } }); return best; };
  cv.addEventListener('contextmenu', (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(), i = near(e.clientX - r.left); if (i > 0) { S.starts.splice(i, 1); draw(); label(); } });
  cv.addEventListener('click', (e) => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, t = tOf(x);
    if (e.altKey) { S.starts.push(t); S.starts.sort((p, q) => p - q); draw(); label(); return; }
    let i = S.starts.length - 1; while (i > 0 && S.starts[i] > t) i--;
    const rg = sliceRanges(a.buffer, S.starts)[i];
    const sr = a.buffer.sampleRate, from = Math.floor(rg.start * sr), to = Math.min(a.buffer.length, Math.floor(rg.end * sr));
    const piece = app.ctx.createBuffer(a.buffer.numberOfChannels, Math.max(1, to - from), sr);
    for (let c = 0; c < piece.numberOfChannels; c++) piece.copyToChannel(a.buffer.getChannelData(c).subarray(from, to), c);
    app.ctx.resume(); app.engine.previewBuffer(piece);
  });

  const modeSel = h('select', { class: 'sel', onChange: (e) => { S.mode = e.target.value; recompute(); sl.hidden = S.mode !== 'hits'; cnt.hidden = S.mode !== 'equal'; } }, [h('option', { value: 'hits' }, 'Find the hits'), h('option', { value: 'equal' }, 'Equal parts')]);
  const sl = h('label', { class: 'row', style: { gap: '8px' } }, h('span', { class: 'hint' }, 'Sensitivity'), h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: S.sens, onInput: (e) => { S.sens = +e.target.value; recompute(); } }));
  const cnt = h('label', { class: 'row', style: { gap: '8px' }, hidden: true }, h('span', { class: 'hint' }, 'Parts'), h('input', { type: 'range', min: 2, max: 16, step: 1, value: S.count, onInput: (e) => { S.count = +e.target.value; recompute(); } }));
  const body = h('div', {}, cv, info,
    h('div', { class: 'row wrap', style: { gap: '16px' } }, modeSel, sl, cnt,
      h('label', { class: 'row', style: { gap: '8px' } }, h('input', { type: 'checkbox', class: 'switch', checked: true, onChange: (e) => (S.replay = e.target.checked) }), h('span', {}, 'Also add a loop that plays them in the original order'))));
  modal(`Slice “${a.name}”`, body, [{ label: 'Cancel', onClick: () => app.engine.previewStopAll() }, {
    label: 'Create drum track', primary: true,
    onClick: () => { app.engine.previewStopAll(); const t = app.chopToPads(assetId, sliceRanges(a.buffer, S.starts), { replay: S.replay }); if (t) { app.view.bottom = 'editor'; app.emit('layout'); toast('Made a drum track from ' + Math.min(16, S.starts.length) + ' slices'); } },
  }], { width: 720 });
  recompute();
}
