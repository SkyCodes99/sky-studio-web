// In-app updates. Desktop: the host looks for a newer build staged next to the exe (purely local, no internet).
// Web version: the page re-reads its own version.json from the site it was loaded from and reloads to update.
// When one is found a card pops up; "Restart & update" closes the app, swaps in the new version and reopens it.
import { h } from '../util.js';
import { host } from '../host.js';
import { icon } from './icons.js';
import { toast } from './widgets.js';

export function mountUpdater(app) {
  let card = null, pill = null, shownFor = null, applying = false;

  async function check() {
    if (applying) return;
    let r = null;
    try { r = await host.call('checkUpdate'); } catch { /* ignore */ }
    if (!r || !r.available || !r.canApply) { if (!r || !r.available) clear(); return; }
    if (shownFor !== r.version) { shownFor = r.version; showCard(r); }
    else if (!card && !pill) showPill(r);
  }

  function clear() { if (card) card.remove(); if (pill) pill.remove(); card = pill = null; shownFor = null; }

  function showPill(r) {
    if (pill) return;
    pill = h('button', { class: 'upd-pill', title: 'A new version is ready', onClick: () => { pill.remove(); pill = null; showCard(r); } }, icon('download', 15), h('span', {}, 'Update ready'));
    document.body.append(pill);
  }

  function showCard(r) {
    if (pill) { pill.remove(); pill = null; }
    if (card) card.remove();
    card = h('div', { class: 'upd-card' },
      h('div', { class: 'upd-h' }, icon('download', 18), h('b', {}, 'Sky Studio ' + r.version + ' is ready'), h('span', { class: 'hint' }, 'you have ' + r.current)),
      r.notes && r.notes.length ? h('ul', { class: 'upd-notes' }, r.notes.slice(0, 6).map((n) => h('li', {}, n))) : null,
      h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '10px' } },
        h('button', { class: 'btn ghost', onClick: () => { card.remove(); card = null; showPill(r); } }, 'Later'),
        h('button', { class: 'btn primary', onClick: () => apply() }, host.native ? 'Restart & update' : 'Reload & update')));
    document.body.append(card);
  }

  async function apply() {
    if (applying) return;
    applying = true;
    app.emit('busy', host.native ? 'Updating Sky Studio — it will reopen in a moment…' : 'Updating Sky Studio — reloading…');
    try {
      app.engine.stop(); app.engine.liveAllOff();
      if (app.dirty && app.project.tracks.length) await app.autosave(); else await host.clearAutosave();   // unsaved work is offered back after restart
      const res = await host.call('applyUpdate');
      if (!res || !res.ok) throw new Error((res && res.error) || 'update failed');
    } catch (e) {
      applying = false;
      app.emit('busy', null);
      toast('Could not start the update: ' + (e.message || e), 'error');
    }
  }

  setTimeout(check, 2500);
  setInterval(check, 45000);
  window.addEventListener('focus', check);
  return { check };
}
