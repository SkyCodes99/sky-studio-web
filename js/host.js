// Bridge to the Python/Qt host (file dialogs, saving, settings). In a plain browser it falls back to downloads/localStorage,
// which is what lets the whole UI be developed and tested in a browser tab.
const isNative = typeof window !== 'undefined' && window.qt && window.qt.webChannelTransport;

function b64url(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

class Host {
  constructor() {
    this.native = !!isNative;
    this.rid = 0; this.pending = new Map(); this.listeners = {};
    this.ready = this.native ? this._init() : Promise.resolve();
    if (!this.native) this._web('version');          // remember which version this page loaded with (for the update check)
  }
  _init() {
    return new Promise((resolve) => {
      const go = () => new window.QWebChannel(window.qt.webChannelTransport, (ch) => {
        this.bridge = ch.objects.bridge;
        this.bridge.reply.connect((rid, json) => {
          const p = this.pending.get(rid);
          if (p) { this.pending.delete(rid); p(JSON.parse(json)); }
        });
        this.bridge.event.connect((name, json) => (this.listeners[name] || []).forEach((f) => f(JSON.parse(json))));
        resolve();
      });
      if (window.QWebChannel) go();
      else { const s = document.createElement('script'); s.src = './qwebchannel.js'; s.onload = go; document.head.append(s); }
    });
  }
  on(name, fn) { (this.listeners[name] ||= []).push(fn); }
  call(method, args = {}) {
    if (!this.native) return this._web(method, args);
    return this.ready.then(() => new Promise((resolve) => {
      const rid = 'r' + ++this.rid;
      this.pending.set(rid, resolve);
      this.bridge.call(rid, method, JSON.stringify(args));
    }));
  }

  // ---- files
  // In the browser: Chrome/Edge get a real "Save as" window (and later saves overwrite the same file); other browsers download the file.
  _canPick() { return typeof window.showSaveFilePicker === 'function' && !window.__noPicker && !navigator.webdriver; }
  async saveDialog({ title, filter, name }) {
    if (this.native) return (await this.call('saveDialog', { title, filter, name })) || '';
    if (this._canPick()) {
      try {
        const h = await window.showSaveFilePicker({ suggestedName: name || 'untitled', types: pickerTypes(filter) });
        (this.handles ||= new Map()).set(h.name, h);
        return h.name;
      } catch (e) { if (e && e.name === 'AbortError') return ''; /* fall through to a download */ }
    }
    return name || 'untitled';
  }
  async openDialog({ title, filter, multiple }) {
    if (this.native) return (await this.call('openDialog', { title, filter, multiple })) || [];
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.multiple = !!multiple;
      const exts = extsOf(filter); if (exts.length) inp.accept = exts.join(',');
      inp.onchange = () => resolve([...inp.files]);
      inp.addEventListener('cancel', () => resolve([]));
      inp.click();
    });
  }
  async _saveBlob(path, blob) {
    const h = this.handles && this.handles.get(path);
    if (h) {
      try { const w = await h.createWritable(); await w.write(blob); await w.close(); return true; } catch (e) { console.warn('direct save failed, downloading instead', e); }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = path.split(/[\/]/).pop();
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return true;
  }
  async writeBinary(path, buf) {
    if (this.native) {
      const u = new Uint8Array(buf); let s = '';
      for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
      const r = await this.call('writeBinary', { path, b64: btoa(s) });
      return r && r.ok;
    }
    return this._saveBlob(path, new Blob([buf]));
  }
  async writeText(path, text) {
    if (this.native) { const r = await this.call('writeText', { path, text }); return r && r.ok; }
    return this._saveBlob(path, new Blob([text], { type: 'application/json' }));
  }
  async readBinary(path) {
    if (this.native) {
      const r = await fetch('/__local/' + b64url(path));
      if (!r.ok) throw new Error('cannot read ' + path);
      return r.arrayBuffer();
    }
    if (path instanceof File) return path.arrayBuffer();
    throw new Error('no file access in browser mode');
  }
  async readText(path) {
    if (this.native) { const r = await this.call('readText', { path }); return r && r.text != null ? r.text : null; }
    if (path instanceof File) return path.text();
    return null;
  }
  async pickFolder(title) { return this.native ? (await this.call('pickFolder', { title })) || '' : ''; }
  async listAudio(folder) { return this.native ? (await this.call('listAudio', { folder })) || [] : []; }
  reveal(path) { return this.call('reveal', { path }); }

  // ---- settings & autosave
  async getSettings() {
    if (this.native) return (await this.call('getSettings')) || {};
    try { return JSON.parse(localStorage.getItem('skystudio.settings') || '{}'); } catch { return {}; }
  }
  async setSettings(obj) {
    if (this.native) return this.call('setSettings', obj);
    try { localStorage.setItem('skystudio.settings', JSON.stringify(obj)); } catch { /* */ }
  }
  async autosave(text) { return this.native ? this.call('autosave', { text }) : idb('put', text); }
  async loadAutosave() { if (this.native) return (await this.call('loadAutosave')) || null; const t = await idb('get'); return t ? { text: t } : null; }
  async clearAutosave() { return this.native ? this.call('clearAutosave') : idb('del'); }
  quit() { return this.call('quit'); }
  setTitle(t) { if (this.native) this.call('setTitle', { title: t }); else document.title = t; }
}

// ---- browser-only helpers
const extsOf = (filter) => [...String(filter || '').matchAll(/\*(\.[A-Za-z0-9]+)/g)].map((m) => m[1].toLowerCase());
function pickerTypes(filter) {
  const exts = extsOf(filter);
  return exts.length ? [{ description: String(filter).replace(/\s*\(.*\)\s*$/, '') || 'File', accept: { 'application/octet-stream': exts } }] : undefined;
}
function idb(op, value) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('skystudio', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result, tx = db.transaction('kv', op === 'get' ? 'readonly' : 'readwrite'), st = tx.objectStore('kv');
        const r = op === 'get' ? st.get('autosave') : op === 'put' ? st.put(value, 'autosave') : st.delete('autosave');
        tx.oncomplete = () => { db.close(); resolve(op === 'get' ? r.result || null : true); };
        tx.onerror = tx.onabort = () => { db.close(); resolve(null); };
      };
    } catch { resolve(null); }
  });
}
const VERSION_URL = new URL('../version.json', import.meta.url).href;
Host.prototype._web = async function (method) {
  if (method === 'version' || method === 'checkUpdate') {
    let v = null;
    try { const r = await fetch(VERSION_URL + '?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) v = await r.json(); } catch { /* offline / dev */ }
    if (!v) return method === 'version' ? null : { available: false };
    if (!this._v0) this._v0 = v;                       // the version this page was loaded with
    if (method === 'version') return { version: this._v0.version, notes: this._v0.notes || [] };
    return { available: v.version !== this._v0.version, canApply: true, version: v.version, current: this._v0.version, notes: v.notes || [] };
  }
  if (method === 'applyUpdate') { setTimeout(() => location.reload(), 150); return { ok: true }; }
  return null;
};

export const host = new Host();
