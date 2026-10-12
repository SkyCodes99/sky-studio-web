// Automation: lanes of (beat, value) points that move a parameter over time.
// A lane = { id, track: trackId | 'master', param, pts: [{b, v}], on, mode?: 'linear' | 'step' }
// param: 'vol' | 'pan' | 'send.rev' | 'send.del' | 'params.tone' | 'params.attack' | 'params.release' | 'masterVol' | 'fx:<effectId>:<paramId>'
// Values are stored in the same units as the knob (e.g. cutoff in Hz), so a lane survives edits to other settings.
import { FX } from './fx.js';

const pct = (v) => Math.round(v * 100) + '%';
const FIXED = {
  vol: { label: 'Volume', min: 0, max: 1, def: 0.78, fmt: (v) => Math.round(v * 100) + '', group: 'Mixer' },
  pan: { label: 'Pan', min: -1, max: 1, def: 0, fmt: (v) => (Math.abs(v) < 0.02 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100)), group: 'Mixer' },
  'send.rev': { label: 'Reverb send', min: 0, max: 1, def: 0.12, fmt: pct, group: 'Mixer' },
  'send.del': { label: 'Echo send', min: 0, max: 1, def: 0, fmt: pct, group: 'Mixer' },
  'params.tone': { label: 'Tone / cutoff', min: 0, max: 1, def: 0.5, fmt: pct, group: 'Sound' },
  'params.attack': { label: 'Attack', min: 0, max: 1, def: 0.5, fmt: pct, group: 'Sound' },
  'params.release': { label: 'Release', min: 0, max: 1, def: 0.5, fmt: pct, group: 'Sound' },
  masterVol: { label: 'Master volume', min: 0, max: 1, def: 0.8, fmt: (v) => Math.round(v * 100) + '', group: 'Master' },
};
export const parseFxKey = (param) => { const m = /^fx:([^:]+):(.+)$/.exec(param); return m ? { id: m[1], pid: m[2] } : null; };

/** Describe a lane's target ({label,min,max,log,fmt,def,group}) or null when it no longer exists (track / effect deleted). */
export function targetInfo(project, lane) {
  const fk = parseFxKey(lane.param);
  if (fk) {
    const list = lane.track === 'master' ? project.masterFx : (project.tracks.find((t) => t.id === lane.track) || {}).fx;
    const e = (list || []).find((x) => x.id === fk.id);
    const pd = e && FX[e.type] && FX[e.type].params.find((p) => p.id === fk.pid);
    if (!pd || pd.type) return null;
    return { label: `${FX[e.type].name} · ${pd.label}`, min: pd.min, max: pd.max, log: !!pd.log, def: pd.def, fmt: pd.fmt, group: 'Effects' };
  }
  const f = FIXED[lane.param];
  if (!f) return null;
  if (lane.track === 'master' ? lane.param !== 'masterVol' : !project.tracks.some((t) => t.id === lane.track)) return null;
  return { ...f, log: false };
}

/** Everything that can be automated on a track (or the master): [{param, label, group}] */
export function listTargets(project, trackId) {
  const out = [];
  if (trackId === 'master') {
    out.push({ param: 'masterVol', ...FIXED.masterVol });
    for (const e of project.masterFx || []) for (const pd of FX[e.type].params) if (!pd.type) out.push({ param: `fx:${e.id}:${pd.id}`, label: `${FX[e.type].name} · ${pd.label}`, group: 'Effects' });
    return out;
  }
  const t = project.tracks.find((x) => x.id === trackId);
  if (!t) return out;
  for (const k of ['vol', 'pan', 'send.rev', 'send.del']) out.push({ param: k, ...FIXED[k] });
  if (t.type !== 'audio') for (const k of ['params.tone', 'params.attack', 'params.release']) out.push({ param: k, ...FIXED[k], label: t.type === 'drum' ? (k === 'params.tone' ? 'Tune' : k === 'params.release' ? 'Decay' : 'Attack') : FIXED[k].label });
  for (const e of t.fx || []) for (const pd of FX[e.type].params) if (!pd.type) out.push({ param: `fx:${e.id}:${pd.id}`, label: `${FX[e.type].name} · ${pd.label}`, group: 'Effects' });
  return out;
}

export const normOf = (info, v) => { const n = info.log ? Math.log(Math.max(v, info.min) / info.min) / Math.log(info.max / info.min) : (v - info.min) / (info.max - info.min); return Math.min(1, Math.max(0, n)); };
export const valOf = (info, n) => { n = Math.min(1, Math.max(0, n)); return info.log ? info.min * Math.pow(info.max / info.min, n) : info.min + n * (info.max - info.min); };

export function valueAt(lane, beat) {
  const p = lane.pts;
  if (!p.length) return null;
  if (beat <= p[0].b) return p[0].v;
  const last = p[p.length - 1];
  if (beat >= last.b) return last.v;
  let lo = 0, hi = p.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p[mid].b <= beat) lo = mid; else hi = mid; }
  const a = p[lo], b = p[hi];
  if (lane.mode === 'step') return a.v;
  return a.v + ((b.v - a.v) * (beat - a.b)) / Math.max(1e-9, b.b - a.b);
}

/** Lanes of a track keyed by param (used to decide which settings automation owns). */
export function autoKeys(project, trackId) {
  const s = new Set();
  for (const l of project.auto || []) if (l.on !== false && l.pts.length && l.track === trackId) s.add(l.param);
  return s;
}
export const sortPts = (lane) => { lane.pts.sort((a, b) => a.b - b.b); return lane; };
