// WAV encoding (16-bit / 24-bit PCM or 32-bit float) and helpers.
export function encodeWav(channels, sampleRate, bits = 16) {
  const nCh = channels.length, n = channels[0].length;
  const bytes = bits / 8;
  const dataLen = n * nCh * bytes;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); wr(8, 'WAVE'); wr(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, bits === 32 ? 3 : 1, true); v.setUint16(22, nCh, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * nCh * bytes, true); v.setUint16(32, nCh * bytes, true); v.setUint16(34, bits, true);
  wr(36, 'data'); v.setUint32(40, dataLen, true);
  let o = 44;
  // TPDF dither for 16-bit keeps quiet tails smooth
  const dither = bits === 16;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nCh; c++) {
      let s = channels[c][i];
      if (bits === 32) { v.setFloat32(o, s, true); o += 4; continue; }
      if (dither) s += (Math.random() - Math.random()) / 32768;
      s = Math.max(-1, Math.min(1, s));
      if (bits === 16) { v.setInt16(o, Math.round(s * 32767), true); o += 2; }
      else {
        const x = Math.round(s * 8388607);
        v.setUint8(o, x & 255); v.setUint8(o + 1, (x >> 8) & 255); v.setUint8(o + 2, (x >> 16) & 255); o += 3;
      }
    }
  }
  return buf;
}

export function audioBufferToWav(ab, bits = 16) {
  const ch = [];
  for (let c = 0; c < ab.numberOfChannels; c++) ch.push(ab.getChannelData(c));
  return encodeWav(ch, ab.sampleRate, bits);
}

export function peakOf(ab) {
  let p = 0;
  for (let c = 0; c < ab.numberOfChannels; c++) {
    const d = ab.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > p) p = a; }
  }
  return p;
}

export function applyGain(ab, g) {
  for (let c = 0; c < ab.numberOfChannels; c++) {
    const d = ab.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= g;
  }
}
