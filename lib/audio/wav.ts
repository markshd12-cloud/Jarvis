// Codificação de áudio gravado no navegador (webm/opus) para WAV PCM —
// formato que o Gemini aceita para transcrição (ver lib/ai/vertex.ts).

/** Reamostra para 16kHz mono (padrão de fala) — reduz bastante o payload. */
export async function resampleTo16k(buffer: AudioBuffer): Promise<AudioBuffer> {
  const targetRate = 16000;
  if (buffer.sampleRate === targetRate && buffer.numberOfChannels === 1) {
    return buffer;
  }
  const offlineCtx = new OfflineAudioContext(
    1,
    Math.ceil(buffer.duration * targetRate),
    targetRate,
  );
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start();
  return offlineCtx.startRendering();
}

/** Codifica um AudioBuffer como WAV PCM 16-bit mono, já em base64 (sem prefixo data:). */
export function encodeWavBase64(buffer: AudioBuffer): string {
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const channelData = mixToMono(buffer);

  const dataSize = length * 2; // 16-bit mono
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // tamanho do chunk fmt
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits por amostra
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    const sample = Math.max(-1, Math.min(1, channelData[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return bufferToBase64(arrayBuffer);
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const out = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) out[i] += data[i] / buffer.numberOfChannels;
  }
  return out;
}

function writeString(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
