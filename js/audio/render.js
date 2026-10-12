// Offline rendering of a project (export, stems, tests).
import { Engine } from './engine.js';
import { projectEndBeat } from './events.js';
import { applyGain, peakOf } from './wav.js';

export const LIMITER_DELAY = 0.006;
/**
 * Render the project to a stereo AudioBuffer.
 * opts: sr, startBeat, endBeat, tail (seconds of reverb tail), onlyTrack (stem), normalize (peak -1 dBFS), ignoreLoop
 */
export async function renderProject(project, opts = {}) {
  const sr = opts.sr || 44100;
  const b0 = opts.startBeat ?? 0;
  const b1 = opts.endBeat ?? Math.max(projectEndBeat(project), 1);
  const spb = 60 / project.bpm;
  const secs = (b1 - b0) * spb + (opts.tail ?? 2.5);
  const lat = Math.round(sr * LIMITER_DELAY);
  const ctx = new OfflineAudioContext(2, Math.ceil(secs * sr) + lat, sr);
  await Engine.loadFx(ctx);
  const eng = new Engine(ctx, () => project, { offline: true, onlyTrack: opts.onlyTrack });
  await eng.loadAssets(project);
  eng.prepareOffline(project);
  // Build the audio graph a couple of seconds ahead of the render position instead of all at once: thousands of idle
  // nodes make the desktop app's audio engine crawl (a 30 s song took ~95 s to export that way).
  const evs = eng.offlineEvents(project, b0, b1);
  let next = 0;
  const fireUpTo = (limitSec) => { while (next < evs.length && (evs[next].beat - b0) * spb < limitSec) eng.fireOffline(evs[next++], b0, spb); };
  const SLICE = 0.75;
  fireUpTo(SLICE * 2);
  for (let t = SLICE; t < secs; t += SLICE) ctx.suspend(t).then(() => { fireUpTo(t + SLICE * 2); ctx.resume(); });
  const full = await ctx.startRendering();
  // the master limiter has a fixed look-ahead delay; trim it so exported audio starts exactly on the grid
  const buf = new AudioBuffer({ length: full.length - lat, sampleRate: sr, numberOfChannels: 2 });
  for (let c = 0; c < 2; c++) buf.copyToChannel(full.getChannelData(c).subarray(lat), c);
  if (opts.normalize !== false) {
    const pk = peakOf(buf);
    if (pk > 1e-4) applyGain(buf, 0.89 / pk);
  }
  return buf;
}
