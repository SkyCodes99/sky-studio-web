// Arrange view: track headers, timeline ruler, regions (move / resize / loop / split), loop range, playhead, drag & drop.
import { h, clamp, uid, deep } from '../util.js';
import { icon } from './icons.js';
import { iconBtn, showMenu, dragTracker, segmented, button } from './widgets.js';
import { SNAPS, loopCompatible } from '../app.js';
import { INST_BY_ID } from '../audio/instruments.js';
import { PAD_BASE } from '../audio/drums.js';
import { showNewTrack, showStarters, promptText } from './dialogs.js';
import { TRACK_COLORS } from '../state.js';

const HEAD_W = 232;
const shade = (c, p) => `color-mix(in srgb, ${c} ${p}%, #000)`;

export function trackIcon(t) {
  if (t.type === 'drum') return 'drum';
  if (t.type === 'audio') return 'wave';
  if (t.inst === 'sampler') return 'wave';
  const i = INST_BY_ID[t.inst];
  return i ? i.icon : 'piano';
}

export function mountArrange(app, root) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  // ------------------------------------------------------------ toolbar
  const snapSel = h('select', { class: 'sel', title: 'Grid snap', onChange: (e) => { app.view.snap = e.target.value; app.emit('layout'); } }, SNAPS.map((s) => h('option', { value: s.id }, s.label)));
  const zoom = h('input', { type: 'range', min: 6, max: 140, step: 1, value: app.view.ppb, title: 'Zoom', onInput: (e) => setZoom(+e.target.value) });
  const heightBtn = iconBtn('list', 'Track height', () => { app.view.trackH = app.view.trackH > 60 ? 48 : 78; build(); }, '', 17);
  const followBtn = iconBtn('chevronR', 'Follow playhead', () => { app.view.followPlayhead = !app.view.followPlayhead; followBtn.classList.toggle('on', app.view.followPlayhead); }, 'on', 17);
  const tools = h('div', { class: 'arr-tools' },
    button('Track', () => showNewTrack(app), { icon: 'plus', class: 'primary', title: 'Add a new track' }),
    h('span', { class: 'lbl hint' }, 'Snap'), snapSel,
    iconBtn('scissors', 'Split at playhead (S)', () => app.splitAt(), '', 17),
    iconBtn('copy', 'Duplicate selected regions (Ctrl+D)', () => app.duplicateRegions(), '', 17),
    iconBtn('trash', 'Delete selected regions (Delete)', () => app.deleteRegions(), '', 17),
    h('div', { class: 'sp' }),
    followBtn, heightBtn,
    h('span', { class: 'hint' }, icon('search', 14)), zoom,
  );
  followBtn.classList.toggle('on', app.view.followPlayhead);

  const scroll = h('div', { class: 'arr-scroll' });
  const inner = h('div', { class: 'arr-inner' });
  scroll.append(inner);
  const dropHint = h('div', { class: 'drop-hint' }, 'Drop to add');
  root.append(tools, scroll, dropHint);

  const playhead = h('div', { class: 'playhead' });
  let rulerCanvas, rulerTrack, rows, loopBar, loopBand;
  let headEls = new Map(), laneEls = new Map(), regionEls = new Map(), meterEls = new Map();

  const laneW = () => Math.ceil(app.projectLength() * app.view.ppb);
  const trackH = () => app.view.trackH;
  const beatAt = (clientX) => {
    const r = scroll.getBoundingClientRect();
    return (clientX - r.left + scroll.scrollLeft - HEAD_W) / app.view.ppb;
  };

  function setZoom(v, anchorClientX) {
    const old = app.view.ppb;
    const ax = anchorClientX != null ? anchorClientX : scroll.getBoundingClientRect().left + HEAD_W + (scroll.clientWidth - HEAD_W) / 2;
    const beat = beatAt(ax);
    app.view.ppb = clamp(v, 6, 140);
    zoom.value = app.view.ppb;
    build();
    const r = scroll.getBoundingClientRect();
    scroll.scrollLeft = beat * app.view.ppb + HEAD_W - (ax - r.left);
    drawRuler();
  }

  // ------------------------------------------------------------ build
  function build() {
    const P = app.project, ppb = app.view.ppb, W = laneW(), H = trackH();
    inner.style.width = HEAD_W + W + 'px';
    inner.replaceChildren();
    headEls.clear(); laneEls.clear(); regionEls.clear(); meterEls.clear();

    // ruler
    rulerCanvas = h('canvas');
    loopBar = h('div', { class: 'loop-bar' }, h('i', { class: 'l' }), h('i', { class: 'r' }));
    rulerTrack = h('div', { class: 'ruler-track', style: { width: W + 'px' } }, rulerCanvas, loopBar);
    const ruler = h('div', { class: 'ruler' }, h('div', { class: 'corner' }, h('span', { class: 'hint' }, 'Tracks')), rulerTrack);
    inner.append(ruler);
    rulerTrack.addEventListener('pointerdown', rulerDown);
    loopBar.addEventListener('pointerdown', loopDown);

    rows = h('div', { class: 'rows' });
    const bar = 4 * ppb * (P.ts[0] / 4 * 4 / 4);
    const barPx = app.bpb * ppb, beatPx = ppb;
    const grid = `repeating-linear-gradient(90deg, #ffffff17 0 1px, transparent 1px ${barPx}px), repeating-linear-gradient(90deg, #ffffff0a 0 1px, transparent 1px ${beatPx}px)`;
    for (const t of P.tracks) {
      const lane = h('div', { class: 'lane', style: { width: W + 'px', height: H + 'px', backgroundImage: grid, backgroundColor: 'transparent' } });
      const head = buildHead(t);
      const row = h('div', { class: 't-row' + (app.sel.track === t.id ? ' sel' : ''), dataset: { track: t.id }, style: { height: H + 'px' } }, head, lane);
      rows.append(row);
      headEls.set(t.id, head); laneEls.set(t.id, lane);
      for (const r of t.regions) { const el = buildRegion(t, r); lane.append(el); regionEls.set(r.id, el); }
      lane.addEventListener('pointerdown', (e) => laneDown(e, t));
      lane.addEventListener('dblclick', (e) => { if (e.target === lane) { const b = beatAt(e.clientX); app.newEmptyRegion(t.id, b, 2); app.view.bottom = 'editor'; app.view.bottomOpen = true; app.emit('layout'); } });
      lane.addEventListener('contextmenu', (e) => { e.preventDefault(); if (e.target === lane) laneMenu(e, t); });
      row.addEventListener('dragover', (e) => { if (dndOk(e)) { e.preventDefault(); row.classList.add('drop'); } });
      row.addEventListener('dragleave', () => row.classList.remove('drop'));
      row.addEventListener('drop', (e) => { row.classList.remove('drop'); onDrop(e, t); });
    }
    inner.append(rows);
    const addRow = h('div', { class: 'add-row' }, h('div', { class: 'add-head' }, button('Add track', () => showNewTrack(app), { icon: 'plus' })), h('div', { class: 'add-lane', style: { width: W + 'px' } }));
    addRow.addEventListener('dragover', (e) => { if (dndOk(e)) e.preventDefault(); });
    addRow.addEventListener('drop', (e) => onDrop(e, null));
    inner.append(addRow);

    loopBand = h('div', { class: 'loopband' });
    inner.append(loopBand, playhead);
    positionLoop();
    if (!P.tracks.length) inner.append(emptyState());
    drawRuler();
    positionPlayhead();
  }

  function emptyState() {
    return h('div', { class: 'big-empty' }, h('div', {},
      h('h2', {}, 'Make some music'),
      h('p', {}, 'Start from a ready-made song, or add a drum track and an instrument track and build your own from the loop library on the right.'),
      h('div', { class: 'row wrap', style: { justifyContent: 'center' } },
        button('Song starters', () => showStarters(app), { class: 'primary', icon: 'magic' }),
        button('Drum track', () => app.addTrack('drum'), { icon: 'drum' }),
        button('Instrument track', () => app.addTrack('inst', { inst: 'piano' }), { icon: 'piano' }),
        button('Open project', () => app.openProject(), { icon: 'folder' }))));
  }

  // ------------------------------------------------------------ track header
  function buildHead(t) {
    const nameEl = h('div', { class: 'th-name', title: 'Double-click to rename' }, t.name);
    nameEl.addEventListener('dblclick', async (e) => { e.stopPropagation(); const n = await promptText('Rename track', t.name); if (n != null && n.trim()) app.setTrackProp(t.id, 'name', n.trim()); });
    const mBtn = h('button', { class: 'mini m' + (t.mute ? ' on' : ''), title: 'Mute', onClick: (e) => { e.stopPropagation(); app.toggleMute(t.id); } }, 'M');
    const sBtn = h('button', { class: 'mini s' + (t.solo ? ' on' : ''), title: 'Solo', onClick: (e) => { e.stopPropagation(); app.toggleSolo(t.id); } }, 'S');
    const btns = [mBtn, sBtn];
    if (t.type === 'audio') btns.push(h('button', { class: 'mini r' + (t.arm ? ' on' : ''), title: 'Arm for microphone recording', onClick: (e) => { e.stopPropagation(); app.toggleArm(t.id); } }, 'R'));
    const vol = h('input', { type: 'range', class: 'th-vol', min: 0, max: 1, step: 0.005, value: t.vol, title: 'Volume',
      onPointerDown: (e) => e.stopPropagation(), onInput: (e) => app.setTrackProp(t.id, 'vol', +e.target.value, false), onChange: (e) => app.setTrackProp(t.id, 'vol', +e.target.value, true) });
    const meter = h('div', { class: 'th-meter' }, h('div'));
    meterEls.set(t.id, meter.firstChild);
    const head = h('div', { class: 't-head' + (app.sel.track === t.id ? ' sel' : ''), dataset: { track: t.id } },
      h('div', { class: 'colorbar', style: { background: t.color } }),
      h('div', { class: 'th-main' },
        h('div', { class: 'th-top' }, h('div', { class: 't-ico', style: { background: t.color } }, icon(trackIcon(t), 15)), nameEl,
          iconBtn('dots', 'Track menu', (e) => { e.stopPropagation(); trackMenu(e, t); }, 'sm', 16)),
        h('div', { class: 'th-btns' }, btns, vol)),
      meter);
    head.addEventListener('pointerdown', (e) => { if (e.button === 0) app.selectTrack(t.id); });
    head.addEventListener('contextmenu', (e) => { e.preventDefault(); app.selectTrack(t.id); trackMenu(e, t); });
    head.addEventListener('dblclick', () => { app.view.left = true; app.view.leftTab = 'track'; app.emit('layout'); });
    return head;
  }

  function trackMenu(e, t) {
    const r = (e.currentTarget || e.target).getBoundingClientRect ? (e.currentTarget || e.target).getBoundingClientRect() : { left: e.clientX, bottom: e.clientY };
    const x = e.clientX || r.left, y = e.clientY || r.bottom;
    showMenu([
      { label: 'Rename…', onClick: async () => { const n = await promptText('Rename track', t.name); if (n != null && n.trim()) app.setTrackProp(t.id, 'name', n.trim()); } },
      { label: 'Duplicate track', icon: 'copy', onClick: () => app.duplicateTrack(t.id) },
      { label: 'Move up', icon: 'up', onClick: () => app.moveTrack(t.id, -1) },
      { label: 'Move down', icon: 'down', onClick: () => app.moveTrack(t.id, 1) },
      { sep: true },
      ...TRACK_COLORS.slice(0, 8).map((c, i) => ({ label: 'Colour ' + (i + 1), checked: t.color === c, onClick: () => app.setTrackProp(t.id, 'color', c) })).slice(0, 0),
      { label: 'Add empty region', icon: 'plus', onClick: () => { app.newEmptyRegion(t.id, app.pos, 2); app.view.bottom = 'editor'; app.view.bottomOpen = true; app.emit('layout'); }, disabled: t.type === 'audio' },
      { label: 'Delete track', icon: 'trash', onClick: () => app.deleteTrack(t.id) },
    ], x, y);
  }
  function laneMenu(e, t) {
    const b = beatAt(e.clientX);
    showMenu([
      { label: 'New empty region here', icon: 'plus', disabled: t.type === 'audio', onClick: () => { app.newEmptyRegion(t.id, b, 2); app.view.bottom = 'editor'; app.view.bottomOpen = true; app.emit('layout'); } },
      { label: 'Paste', icon: 'copy', disabled: !app.clipboard, onClick: () => app.pasteRegions(b) },
      { label: 'Set playhead here', onClick: () => app.seek(app.snap(b, true)) },
    ], e.clientX, e.clientY);
  }

  // ------------------------------------------------------------ regions
  function buildRegion(t, r) {
    const ppb = app.view.ppb;
    const el = h('div', { class: 'region' + (app.sel.regions.has(r.id) ? ' sel' : '') + (app.rec && app.rec.region === r ? ' rec' : ''), dataset: { id: r.id },
      style: { left: r.start * ppb + 'px', width: Math.max(4, r.len * ppb) + 'px', background: `linear-gradient(180deg, ${t.color}, ${shade(t.color, 72)})` } });
    const cv = h('canvas');
    el.append(cv, h('div', { class: 'r-name' }, r.name || (t.type === 'audio' ? '' : t.name)), h('div', { class: 'r-edge l' }), h('div', { class: 'r-edge r' }));
    drawRegion(cv, t, r);
    el.addEventListener('pointerdown', (e) => regionDown(e, t, r, el));
    el.addEventListener('dblclick', (e) => { e.stopPropagation(); app.selectRegions([r.id], r.id); app.view.bottom = 'editor'; app.view.bottomOpen = true; app.emit('layout'); });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); if (!app.sel.regions.has(r.id)) app.selectRegions([r.id], r.id); regionMenu(e, t, r); });
    return el;
  }

  function drawRegion(cv, t, r) {
    const ppb = app.view.ppb, H = trackH() - 8, W = Math.max(4, Math.min(3000, r.len * ppb));
    const k = (r.len * ppb) / W;
    cv.width = Math.ceil(W * dpr); cv.height = Math.ceil(H * dpr);
    cv.style.width = '100%'; cv.style.height = '100%';
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    const top = 17, h2 = H - top - 3;
    if (t.type === 'audio') {
      const a = app.project.assets[r.asset];
      if (!a || !a.peaks) return;
      g.fillStyle = 'rgba(255,255,255,.78)';
      const rate = r.rate || 1, binsPerBeat = 200 * app.spb * rate;
      const mid = top + h2 / 2, amp = h2 / 2;
      const loopLen = r.loop ? ((r.srcLen || a.duration - (r.offset || 0)) / app.spb / rate) : Infinity;
      for (let x = 0; x < W; x++) {
        let beat = (x * k) / ppb;
        if (r.loop) beat %= loopLen;
        const b0 = ((r.offset || 0) * 200) + (beat * binsPerBeat), b1 = b0 + (k / ppb) * binsPerBeat;
        let mn = 1, mx = -1;
        for (let b = Math.floor(b0); b <= Math.max(Math.floor(b0), Math.floor(b1)); b++) {
          if (b < 0 || b * 2 + 1 >= a.peaks.length) continue;
          if (a.peaks[b * 2] < mn) mn = a.peaks[b * 2]; if (a.peaks[b * 2 + 1] > mx) mx = a.peaks[b * 2 + 1];
        }
        if (mn > mx) continue;
        const gain = r.gain ?? 1;
        g.fillRect(x, mid - mx * amp * gain, 1, Math.max(1, (mx - mn) * amp * gain));
      }
      return;
    }
    const L = r.loopLen || r.len;
    if (!r.notes.length) return;
    let lo, hi;
    if (t.type === 'drum') { lo = PAD_BASE; hi = PAD_BASE + 15; }
    else { lo = Math.min(...r.notes.map((n) => n.p)); hi = Math.max(...r.notes.map((n) => n.p)); if (hi - lo < 11) { const mid = (hi + lo) / 2; lo = mid - 5.5; hi = mid + 5.5; } }
    const rowH = h2 / (hi - lo + 1);
    for (let kk = 0; kk * L < r.len; kk++) {
      g.fillStyle = kk === 0 ? 'rgba(255,255,255,.88)' : 'rgba(255,255,255,.55)';
      for (const n of r.notes) {
        const s = kk * L + n.s;
        if (n.s >= L || s >= r.len) continue;
        const x = (s * ppb) / k, w = Math.max(1.5, (Math.min(n.d, L - n.s, r.len - s) * ppb) / k - 0.5);
        const y = top + (hi - n.p) * rowH;
        g.fillRect(x, y, w, Math.max(1.5, rowH - 0.6));
      }
      if (kk > 0) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect((kk * L * ppb) / k, top, 1, h2); }
    }
  }

  function regionMenu(e, t, r) {
    const n = app.sel.regions.size;
    showMenu([
      { label: 'Edit', icon: 'note', onClick: () => { app.selectRegions([r.id], r.id); app.view.bottom = 'editor'; app.view.bottomOpen = true; app.emit('layout'); } },
      { label: 'Split at playhead', icon: 'scissors', hint: 'S', onClick: () => app.splitAt() },
      { label: 'Duplicate', icon: 'copy', hint: 'Ctrl+D', onClick: () => app.duplicateRegions() },
      { label: 'Copy', hint: 'Ctrl+C', onClick: () => app.copyRegions() },
      { label: 'Cut', hint: 'Ctrl+X', onClick: () => app.cutRegions() },
      { label: 'Join selected', disabled: n < 2 || t.type === 'audio', onClick: () => app.joinRegions() },
      { label: 'Turn repeats into real notes', disabled: t.type === 'audio', onClick: () => app.bakeRegion(r.id) },
      { label: 'Rename…', onClick: async () => { const nm = await promptText('Rename region', r.name || ''); if (nm != null) app.renameRegion(r.id, nm); } },
      { sep: true },
      { label: 'Delete', icon: 'trash', hint: 'Del', onClick: () => app.deleteRegions() },
    ], e.clientX, e.clientY);
  }

  function regionDown(e, t, r, el) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const zone = e.target.classList.contains('r-edge') ? (e.target.classList.contains('l') ? 'l' : 'r') : 'move';
    const multi = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!app.sel.regions.has(r.id)) {
      if (multi) app.selectRegions([...app.sel.regions, r.id], r.id);
      else app.selectRegions([r.id], r.id);
    } else if (multi && zone === 'move' && e.shiftKey) { const s = new Set(app.sel.regions); s.delete(r.id); app.selectRegions([...s]); return; }
    else app.sel.edit = r.id;
    app.sel.track = t.id;
    refreshSelection();

    let ids = [...app.sel.regions];
    let dup = false;
    if (zone === 'move' && e.altKey) {
      // Alt-drag duplicates
      const copies = [];
      for (const id of ids) { const info = app.regionInfo(id); const c = deep(info.region); c.id = uid(); (c.notes || []).forEach((n) => (n.id = uid())); info.track.regions.push(c); copies.push(c.id); }
      ids = copies; dup = true;
      app.sel.regions = new Set(ids); app.sel.edit = ids[ids.length - 1];
      build();
    }
    const infos = ids.map((id) => ({ ...app.regionInfo(id) })).filter((i) => i.region);
    const orig = infos.map((i) => ({ start: i.region.start, len: i.region.len, notes: i.region.notes ? i.region.notes.map((n) => ({ ...n })) : null, offset: i.region.offset, loopLen: i.region.loopLen }));
    const tracks = app.project.tracks;
    const baseIdx = tracks.indexOf(t);
    let moved = false, trackDelta = 0;
    const H = trackH();
    const minLen = Math.max(app.snapBeats(), 0.25);

    dragTracker(e, (dx, dy, m) => {
      if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      moved = true;
      const db = dx / app.view.ppb;
      infos.forEach((info, i) => {
        const r0 = orig[i], rr = info.region, elx = regionEls.get(rr.id);
        if (zone === 'move') {
          let ns = Math.max(0, app.snap(r0.start + db, false) );
          if (app.snapBeats() === 0) ns = Math.max(0, r0.start + db);
          rr.start = ns;
          if (elx) { elx.style.left = ns * app.view.ppb + 'px'; }
        } else if (zone === 'r') {
          let nl = app.snapBeats() ? app.snap(r0.start + r0.len + db) - r0.start : r0.len + db;
          rr.len = Math.max(minLen, nl);
          if (elx) { elx.style.width = rr.len * app.view.ppb + 'px'; }
        } else {
          let ns = app.snapBeats() ? app.snap(r0.start + db) : r0.start + db;
          ns = clamp(ns, 0, r0.start + r0.len - minLen);
          const d = ns - r0.start;
          if (info.track.type === 'audio') {
            const off = (r0.offset || 0) + d * app.spb * (rr.rate || 1);
            if (off < 0) return;
            rr.offset = off;
          } else {
            const L = r0.loopLen || r0.len;
            rr.notes = r0.notes.map((n) => ({ ...n, s: ((n.s - d) % L + L) % L }));
          }
          rr.start = ns; rr.len = r0.start + r0.len - ns;
          if (elx) { elx.style.left = ns * app.view.ppb + 'px'; elx.style.width = rr.len * app.view.ppb + 'px'; }
        }
      });
      if (zone === 'move') {
        const idx = clamp(baseIdx + Math.round(dy / H), 0, tracks.length - 1);
        trackDelta = idx - baseIdx;
        infos.forEach((info) => { const elx = regionEls.get(info.region.id); if (elx) elx.style.transform = `translateY(${trackDelta * H}px)`; });
      }
      app.emit('regiondrag');
    }, () => {
      if (!moved) { if (dup) app.commit('structure'); return; }
      if (zone === 'move' && trackDelta !== 0) {
        for (const info of infos) {
          const idx = clamp(tracks.indexOf(info.track) + trackDelta, 0, tracks.length - 1);
          const dest = tracks[idx];
          if (dest && dest !== info.track && dest.type === info.track.type) {
            info.track.regions = info.track.regions.filter((x) => x !== info.region);
            dest.regions.push(info.region);
          }
        }
      }
      app.commit('structure');
    });
  }

  function refreshSelection() {
    for (const [id, el] of regionEls) el.classList.toggle('sel', app.sel.regions.has(id));
    for (const [id, hd] of headEls) hd.classList.toggle('sel', app.sel.track === id);
    for (const row of rows.children) row.classList.toggle('sel', row.dataset.track === app.sel.track);
  }

  function laneDown(e, t) {
    if (e.target !== e.currentTarget || e.button !== 0) return;
    app.selectTrack(t.id);
    if (!e.shiftKey) app.selectRegions([], null);
    // click on empty lane space in a stopped project also moves the playhead there (hold nothing special)
    if (e.detail === 1 && !e.ctrlKey) {
      // rubber-band select
      const x0 = e.clientX, b0 = beatAt(e.clientX);
      const ri = app.project.tracks.indexOf(t);
      let band = null;
      dragTracker(e, (dx, dy, m) => {
        if (Math.abs(dx) < 4) return;
        if (!band) { band = h('div', { style: { position: 'absolute', top: '2px', bottom: '2px', background: '#4aa3ff33', border: '1px solid #4aa3ff', borderRadius: '4px', pointerEvents: 'none', zIndex: 8 } }); e.currentTarget.append(band); }
        const a = Math.min(b0, beatAt(m.clientX)), z = Math.max(b0, beatAt(m.clientX));
        band.style.left = a * app.view.ppb + 'px'; band.style.width = (z - a) * app.view.ppb + 'px';
        const sel = t.regions.filter((r) => r.start < z && r.start + r.len > a).map((r) => r.id);
        app.selectRegions(sel, sel[sel.length - 1] || null);
        refreshSelection();
      }, () => { if (band) band.remove(); });
    }
  }

  // ------------------------------------------------------------ ruler & loop range
  function drawRuler() {
    if (!rulerCanvas) return;
    const ppb = app.view.ppb, bpb = app.bpb, vw = Math.max(200, scroll.clientWidth - HEAD_W + 40);
    const sl = Math.max(0, scroll.scrollLeft);
    rulerCanvas.style.left = sl + 'px';
    rulerCanvas.width = vw * dpr; rulerCanvas.height = 36 * dpr;
    rulerCanvas.style.width = vw + 'px'; rulerCanvas.style.height = '36px';
    const g = rulerCanvas.getContext('2d');
    g.scale(dpr, dpr);
    g.fillStyle = '#181b22'; g.fillRect(0, 0, vw, 36);
    const b0 = sl / ppb, b1 = (sl + vw) / ppb;
    g.font = '11px "Segoe UI", sans-serif'; g.textBaseline = 'top';
    // beat ticks
    const unit = ppb >= 14 ? 1 : bpb;
    for (let b = Math.floor(b0 / unit) * unit; b < b1; b += unit) {
      const x = b * ppb - sl;
      const isBar = Math.abs(b % bpb) < 1e-6;
      g.fillStyle = isBar ? '#8a93a8' : '#4b5266';
      g.fillRect(x, isBar ? 18 : 27, 1, isBar ? 18 : 9);
      if (isBar) { g.fillStyle = '#c3cadb'; g.fillText(String(Math.round(b / bpb) + 1), x + 4, 19); }
    }
    if (ppb >= 60) { // 16th ticks
      for (let b = Math.floor(b0 * 4) / 4; b < b1; b += 0.25) { if (Math.abs(b % 1) < 1e-6) continue; g.fillStyle = '#383e4e'; g.fillRect(b * ppb - sl, 31, 1, 5); }
    }
    g.fillStyle = '#0b0c10'; g.fillRect(0, 35, vw, 1);
  }
  function positionLoop() {
    if (!loopBar) return;
    const L = app.project.loop, ppb = app.view.ppb;
    loopBar.style.left = L.start * ppb + 'px'; loopBar.style.width = Math.max(10, (L.end - L.start) * ppb) + 'px';
    loopBar.classList.toggle('on', L.on);
    loopBand.style.left = HEAD_W + L.start * ppb + 'px'; loopBand.style.width = (L.end - L.start) * ppb + 'px';
    loopBand.style.display = L.on ? 'block' : 'none';
  }
  function rulerDown(e) {
    if (e.target !== rulerCanvas && e.target !== rulerTrack) return;
    const r = rulerTrack.getBoundingClientRect();
    const yy = e.clientY - r.top;
    const fromX = (cx) => (cx - r.left) / app.view.ppb;
    if (yy < 15) { // drag out a new loop range
      const b0 = app.snap(fromX(e.clientX), true);
      let moved = false;
      dragTracker(e, (dx, dy, m) => {
        if (Math.abs(dx) < 4) return;
        moved = true;
        const b1 = app.snap(fromX(m.clientX), true);
        const L = app.project.loop;
        L.start = Math.max(0, Math.min(b0, b1)); L.end = Math.max(L.start + 0.25, Math.max(b0, b1)); L.on = true;
        positionLoop(); app.engine.applyMaster();
      }, () => { if (moved) app.commit('meta'); else { app.toggleLoop(); } });
      return;
    }
    const go = (cx) => app.seek(Math.max(0, e.altKey ? fromX(cx) : app.snap(fromX(cx), true)));
    go(e.clientX);
    dragTracker(e, (dx, dy, m) => go(m.clientX));
  }
  function loopDown(e) {
    e.stopPropagation();
    const L = app.project.loop, s0 = L.start, e0 = L.end;
    const zone = e.target.tagName === 'I' ? (e.target.classList.contains('l') ? 'l' : 'r') : 'move';
    let moved = false;
    dragTracker(e, (dx) => {
      moved = true;
      const db = dx / app.view.ppb;
      if (zone === 'move') { const ns = Math.max(0, app.snap(s0 + db, true)); L.end = e0 + (ns - s0); L.start = ns; }
      else if (zone === 'l') L.start = clamp(app.snap(s0 + db, true), 0, e0 - 0.25);
      else L.end = Math.max(s0 + 0.25, app.snap(e0 + db, true));
      positionLoop();
    }, () => { if (moved) app.commit('meta'); else app.toggleLoop(); });
  }

  // ------------------------------------------------------------ playhead / meters (per frame)
  function positionPlayhead() {
    playhead.style.transform = `translateX(${HEAD_W + app.pos * app.view.ppb}px)`;
  }
  let lastScroll = -1;
  function frame() {
    positionPlayhead();
    if (scroll.scrollLeft !== lastScroll) { lastScroll = scroll.scrollLeft; drawRuler(); }
    if (app.engine.playing && app.view.followPlayhead) {
      const x = HEAD_W + app.pos * app.view.ppb, vw = scroll.clientWidth;
      if (x > scroll.scrollLeft + vw - 40 || x < scroll.scrollLeft + HEAD_W) scroll.scrollLeft = Math.max(0, x - HEAD_W - (vw - HEAD_W) * 0.15);
    }
    for (const [id, el] of meterEls) {
      const p = app.engine.trackLevel(id);
      el.style.height = clamp((20 * Math.log10(Math.max(p, 1e-4)) + 54) / 54, 0, 1) * 100 + '%';
    }
  }
  scroll.addEventListener('scroll', () => { if (scroll.scrollLeft !== lastScroll) { lastScroll = scroll.scrollLeft; drawRuler(); } });
  scroll.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(app.view.ppb * (e.deltaY < 0 ? 1.12 : 0.89), e.clientX); } }, { passive: false });
  new ResizeObserver(() => drawRuler()).observe(scroll);

  // ------------------------------------------------------------ drag & drop (loops from the library, audio files)
  function dndOk(e) { const t = e.dataTransfer && e.dataTransfer.types; return t && (t.includes('application/x-sky-loop') || t.includes('Files') || t.includes('application/x-sky-sample')); }
  async function onDrop(e, t) {
    e.preventDefault();
    const beat = Math.max(0, app.snap(beatAt(e.clientX), true));
    const dt = e.dataTransfer;
    const loopId = dt.getData('application/x-sky-loop');
    if (loopId) {
      const loop = (await import('../library/loops.js')).LOOP_BY_ID[loopId];
      const ok = t && loopCompatible(t, loop);
      app.addLoop(loop, { trackId: ok ? t.id : undefined, newTrack: !ok, start: beat });
      return;
    }
    const smp = dt.getData('application/x-sky-sample');
    if (smp) { app.sel.track = t && t.type === 'audio' ? t.id : null; app.importAudio([JSON.parse(smp)], beat); return; }
    if (dt.files && dt.files.length) { app.sel.track = t && t.type === 'audio' ? t.id : null; app.importAudio([...dt.files], beat); }
  }
  app.on('dropitem', async ({ payload, x, y, target }) => {
    const r = scroll.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;       // dropped outside the timeline
    const rowEl = target && target.closest ? target.closest('.t-row') : null;
    const t = rowEl ? app.track(rowEl.dataset.track) : null;
    const beat = x < r.left + HEAD_W ? Math.max(0, app.snapToBar(app.pos)) : Math.max(0, app.snap(beatAt(x), true));
    if (payload.type === 'loop') {
      const { LOOP_BY_ID } = await import('../library/loops.js');
      const loop = LOOP_BY_ID[payload.id], ok = t && loopCompatible(t, loop);
      app.engine.previewStopAll();
      app.addLoop(loop, { trackId: ok ? t.id : undefined, newTrack: !ok, start: beat });
    } else if (payload.type === 'sample') {
      app.engine.previewStopAll();
      app.sel.track = t && t.type === 'audio' ? t.id : null;
      app.importAudio([payload.item], beat);
    }
  });
  root.addEventListener('dragover', (e) => { if (dndOk(e)) { e.preventDefault(); root.classList.add('drop-on'); } });
  root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) root.classList.remove('drop-on'); });
  root.addEventListener('drop', () => root.classList.remove('drop-on'));

  // ------------------------------------------------------------ wiring
  let pending = false;
  function onChange(kind) {
    if (kind === 'params') { updateHeads(); return; }
    if (kind === 'recording') { updateRecording(); return; }
    if (pending) return;
    pending = true;
    queueMicrotask(() => { pending = false; build(); });
  }
  function updateHeads() {
    for (const t of app.project.tracks) {
      const hd = headEls.get(t.id);
      if (!hd) continue;
      hd.querySelector('.mini.m').classList.toggle('on', t.mute);
      hd.querySelector('.mini.s').classList.toggle('on', t.solo);
      const rr = hd.querySelector('.mini.r'); if (rr) rr.classList.toggle('on', !!t.arm);
      const v = hd.querySelector('.th-vol'); if (document.activeElement !== v) v.value = t.vol;
      hd.querySelector('.th-name').textContent = t.name;
    }
  }
  function updateRecording() {
    const rec = app.rec;
    if (!rec || !rec.region) return;
    const el = regionEls.get(rec.region.id);
    if (el) el.style.width = rec.region.len * app.view.ppb + 'px';
    else build();
    const W = laneW();
    if (parseFloat(inner.style.width) < HEAD_W + (rec.region.start + rec.region.len + 8) * app.view.ppb) build();
  }
  app.on('change', onChange);
  app.on('selection', refreshSelection);
  app.on('layout', () => { snapSel.value = app.view.snap; });
  app.on('regiondrag', () => {});
  snapSel.value = app.view.snap;
  build();
  return { frame, build, scroll };
}
