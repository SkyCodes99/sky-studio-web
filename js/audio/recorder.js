// Microphone / line-in recording straight to PCM (AudioWorklet). Nothing is kept once recording stops; nothing leaves the app.
const WORKLET = `
class Rec extends AudioWorkletProcessor {
  constructor(){ super(); this.buf = []; this.n = 0; this.first = true; this.peak = 0; }
  process(inputs){
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      if (this.first) { this.first = false; this.port.postMessage({ type: 'start', t: currentTime }); }
      this.buf.push(new Float32Array(ch)); this.n += ch.length;
      for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > this.peak) this.peak = a; }
      if (this.n >= 8192) {
        const out = new Float32Array(this.n); let o = 0;
        for (const b of this.buf) { out.set(b, o); o += b.length; }
        this.port.postMessage({ type: 'data', data: out, peak: this.peak }, [out.buffer]);
        this.buf = []; this.n = 0; this.peak = 0;
      }
    }
    return true;
  }
}
registerProcessor('sky-rec', Rec);
`;

export class MicRecorder {
  constructor() { this.chunks = []; this.t0 = 0; this.level = 0; this.active = false; }
  async start(ctx, deviceId) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('No microphone access in this environment');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
    if (!ctx.__recWorklet) {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
      await ctx.audioWorklet.addModule(url);
      ctx.__recWorklet = true;
    }
    this.ctx = ctx;
    this.src = ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(ctx, 'sky-rec', { numberOfInputs: 1, numberOfOutputs: 0 });
    this.node.port.onmessage = (e) => {
      if (e.data.type === 'start') this.t0 = e.data.t;
      else { this.chunks.push(e.data.data); this.level = e.data.peak; }
    };
    this.src.connect(this.node);
    this.active = true;
  }
  /** Stop and return { data: Float32Array, sampleRate, t0 } */
  stop() {
    if (!this.active) return null;
    this.active = false;
    try { this.src.disconnect(); this.node.disconnect(); } catch { /* */ }
    this.stream.getTracks().forEach((t) => t.stop());
    let n = 0;
    for (const c of this.chunks) n += c.length;
    const data = new Float32Array(n);
    let o = 0;
    for (const c of this.chunks) { data.set(c, o); o += c.length; }
    this.chunks = [];
    return { data, sampleRate: this.ctx.sampleRate, t0: this.t0 };
  }
}
