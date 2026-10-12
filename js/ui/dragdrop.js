// Pointer-based drag & drop for library items (the browser's built-in drag & drop is unreliable inside the desktop window).
import { h } from '../util.js';

let current = null;

/** Make `el` draggable. getPayload() -> {type:'loop'|'sample', ...}. Fires app 'dropitem' on release. */
export function makeDraggable(app, el, getPayload, label) {
  el.addEventListener('click', (e) => { if (el._dragged) { e.stopPropagation(); e.preventDefault(); el._dragged = false; } }, true);
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const x0 = e.clientX, y0 = e.clientY;
    let ghost = null, started = false, lastRow = null;
    const rowAt = (x, y) => { const t = document.elementFromPoint(x, y); return t && t.closest ? t.closest('.t-row') : null; };
    const mv = (m) => {
      if (!started) {
        if (Math.hypot(m.clientX - x0, m.clientY - y0) < 6) return;
        started = true;
        ghost = h('div', { class: 'drag-ghost' }, label());
        document.body.append(ghost);
        document.body.classList.add('dragging');
      }
      ghost.style.transform = `translate(${m.clientX + 14}px, ${m.clientY + 10}px)`;
      const row = rowAt(m.clientX, m.clientY);
      if (row !== lastRow) { if (lastRow) lastRow.classList.remove('drop'); if (row) row.classList.add('drop'); lastRow = row; }
    };
    const up = (m) => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      if (lastRow) lastRow.classList.remove('drop');
      if (!started) return;
      ghost.remove(); document.body.classList.remove('dragging');
      el._dragged = true; setTimeout(() => { el._dragged = false; }, 50);
      const target = document.elementFromPoint(m.clientX, m.clientY);
      app.emit('dropitem', { payload: getPayload(), x: m.clientX, y: m.clientY, target });
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  });
}
