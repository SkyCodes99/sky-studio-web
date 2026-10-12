// Sky Studio entry point: builds the app, wires the panels together, handles keyboard shortcuts and the frame loop.
import { App } from './app.js';
import { host } from './host.js';
import { mountTopbar } from './ui/topbar.js';
import { mountArrange } from './ui/arrange.js';
import { mountLeft } from './ui/inspector.js';
import { mountLibrary } from './ui/library.js';
import { mountDock } from './ui/dock.js';
import { initMidi } from './ui/keys.js';
import { mountUpdater } from './ui/updater.js';
import { toast, modal, closeMenu } from './ui/widgets.js';
import { confirmBox, showStarters, showExport } from './ui/dialogs.js';
import { deserialize, serialize } from './state.js';
import { h } from './util.js';

const $ = (id) => document.getElementById(id);

async function boot() {
  await host.ready;
  const app = new App();
  window.app = app;                      // handy for the self-test scripts
  await app.init();

  const topbar = mountTopbar(app, $('topbar'));
  const arrange = mountArrange(app, $('center'));
  mountLeft(app, $('left'));
  mountLibrary(app, $('right'));
  const dock = mountDock(app, $('bottom'));

  // ---- layout toggles
  const layout = () => {
    const a = $('app');
    a.classList.toggle('no-left', !app.view.left);
    a.classList.toggle('no-right', !app.view.right);
    setTimeout(() => window.dispatchEvent(new Event('resize')), 30);
  };
  app.on('layout', layout);
  layout();

  // ---- app events -> UI
  app.on('toast', (m, kind) => toast(m, kind));
  app.on('confirm', (o) => confirmBox(o));
  app.on('busy', (msg) => { $('busy').hidden = !msg; if (msg) $('busy-msg').textContent = msg; });

  // ---- frame loop
  const frame = () => {
    try { app.tick(); topbar.frame(); arrange.frame(); dock.frame(); } catch (e) { console.error(e); }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // ---- keyboard
  const playMode = () => app.view.bottomOpen && app.view.bottom === 'keys';
  window.addEventListener('keydown', (e) => {
    const t = e.target, tag = (t.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable) {
      if (e.key === 'Escape') t.blur();
      return;
    }
    if (playMode() && dock.keys.onKeyDown(e)) { e.preventDefault(); return; }
    const k = e.key, ctrl = e.ctrlKey || e.metaKey, kl = k.toLowerCase();
    let handled = true;
    if (ctrl) {
      if (kl === 'z' && !e.shiftKey) app.undo();
      else if (kl === 'y' || (kl === 'z' && e.shiftKey)) app.redo();
      else if (kl === 's') app.saveProject(e.shiftKey);
      else if (kl === 'o') app.openProject();
      else if (kl === 'n') app.newProject();
      else if (kl === 'e') showExport(app);
      else if (kl === 'd') app.duplicateRegions();
      else if (kl === 'c') app.copyRegions();
      else if (kl === 'x') app.cutRegions();
      else if (kl === 'v') app.pasteRegions();
      else if (kl === 'a') { const tr = app.selTrack; if (tr) app.selectRegions(tr.regions.map((r) => r.id)); }
      else if (kl === 'j') app.joinRegions();
      else handled = false;
    } else if (k === ' ') app.togglePlay();
    else if (k === 'Enter') app.rewind();
    else if (k === 'Home') app.seek(0);
    else if (k === 'End') { const end = Math.max(0, ...app.project.tracks.flatMap((x) => x.regions.map((r) => r.start + r.len))); app.seek(end); }
    else if (k === 'Delete' || k === 'Backspace') app.deleteRegions();
    else if (k === 'Escape') { app.engine.previewStopAll(); closeMenu(); app.clearSelection(); }
    else if (k === 'ArrowLeft') app.seek(app.pos - (e.shiftKey ? app.bpb : 1));
    else if (k === 'ArrowRight') app.seek(app.pos + (e.shiftKey ? app.bpb : 1));
    else if (k === 'ArrowUp' || k === 'ArrowDown') {
      const tr = app.project.tracks, i = tr.findIndex((x) => x.id === app.sel.track), j = Math.max(0, Math.min(tr.length - 1, (i < 0 ? 0 : i) + (k === 'ArrowUp' ? -1 : 1)));
      if (tr[j]) app.selectTrack(tr[j].id);
    }
    else if (!playMode()) {
      if (kl === 'r') app.toggleRecord();
      else if (kl === 'c') app.toggleLoop();
      else if (kl === 'k') app.toggleMetronome();
      else if (kl === 's') app.splitAt();
      else if (kl === 'i') { app.view.left = !app.view.left; app.emit('layout'); }
      else if (kl === 'l') { app.view.right = !app.view.right; app.emit('layout'); }
      else if (k >= '1' && k <= '6') { app.view.bottom = ['editor', 'mixer', 'fx', 'auto', 'synth', 'keys'][+k - 1]; app.view.bottomOpen = true; app.emit('layout'); }
      else handled = false;
    } else handled = false;
    if (handled) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { if (dock.keys.onKeyUp(e)) e.preventDefault(); });
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  // buttons shouldn't keep keyboard focus (Space must always mean play/pause)
  window.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button'); if (b) b.blur(); });
  // stop the browser doing its own zoom / page things
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
  // dropping files anywhere but a drop target must not navigate away
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (host.native || !e.dataTransfer || !e.dataTransfer.files.length) return;        // the desktop app handles dropped files itself
    app.importDropped([...e.dataTransfer.files]);
  });

  // ---- closing
  window.__requestClose = () => {
    if (!app.dirty || !app.project.tracks.length) { host.clearAutosave(); host.quit(); return; }
    app.autosave();
    const box = modal('Save your song before closing?', h('p', { class: 'hint', style: { fontSize: '13.5px' } }, `"${app.project.name}" has changes that haven't been saved.`), [
      { label: 'Cancel' },
      { label: "Don't save", danger: true, onClick: () => { host.clearAutosave(); host.quit(); } },
      { label: 'Save', primary: true, onClick: async () => { if (await app.saveProject()) host.quit(); } },
    ], { width: 440, sticky: true });
  };
  window.addEventListener('beforeunload', (e) => {
    if (!app.dirty || !app.project.tracks.length) return;
    app.autosave();
    if (!host.native) { e.preventDefault(); e.returnValue = ''; }                       // browsers ask "leave site?"
  });

  initMidi(app);
  mountUpdater(app);
  if (!host.native && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('./sw.js').catch(() => {});
  app.engine.applyAll();

  // ---- first screen: restore a crashed/unsaved session, otherwise offer starters
  const saved = await host.loadAutosave();
  if (saved && saved.text) {
    let has = false;
    try { const p = JSON.parse(saved.text); has = p.tracks && p.tracks.length; } catch { /* */ }
    if (has) {
      modal('Restore your last session?', h('p', { class: 'hint', style: { fontSize: '13.5px' } }, 'Sky Studio found a song that was open but never saved. Would you like to pick up where you left off?'), [
        { label: 'Start fresh', onClick: () => { host.clearAutosave(); showStarters(app, true); } },
        { label: 'Restore', primary: true, onClick: async () => { try { await app.loadProjectText(saved.text); app.dirty = true; app.updateTitle(); } catch { toast('Could not restore that session', 'error'); } } },
      ], { width: 440, sticky: true });
      return;
    }
  }
  if (app.settings.welcome !== false) showStarters(app, true);
}

boot().catch((e) => {
  console.error(e);
  document.body.append(h('pre', { style: { position: 'fixed', inset: 0, background: '#200', color: '#fcc', padding: '20px', zIndex: 9999, whiteSpace: 'pre-wrap' } }, 'Sky Studio failed to start:\n' + (e && e.stack || e)));
});
