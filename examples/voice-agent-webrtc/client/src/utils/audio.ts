/**
 * Audio utilities for WebRTC capture and playback
 */

const SAMPLE_RATE = 24000;
// const CHUNK_DURATION_MS = 100;
// Chunk size calculation (currently unused but may be needed later)
// const CHUNK_SIZE_SAMPLES = (SAMPLE_RATE * CHUNK_DURATION_MS) / 1000;

/**
 * Convert Float32Array to PCM16 and base64 encode
 */
export function float32ToPCM16Base64(float32Array: Float32Array): string {
  const pcm16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return arrayBufferToBase64(pcm16.buffer);
}

/**
 * Convert base64 PCM16 to Float32Array for playback
 */
export function base64PCM16ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const pcm16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    float32[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}

/**
 * Convert ArrayBuffer to base64
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Resample audio from source sample rate to 24kHz
 */
export function resampleTo24kHz(
  audioBuffer: AudioBuffer,
  targetSampleRate: number = SAMPLE_RATE
): Float32Array {
  const sourceRate = audioBuffer.sampleRate;
  const sourceData = audioBuffer.getChannelData(0);

  if (sourceRate === targetSampleRate) {
    return sourceData;
  }

  const ratio = sourceRate / targetSampleRate;
  const targetLength = Math.round(sourceData.length / ratio);
  const resampled = new Float32Array(targetLength);

  for (let i = 0; i < targetLength; i++) {
    const sourceIndex = i * ratio;
    const index = Math.floor(sourceIndex);
    const fraction = sourceIndex - index;

    if (index + 1 < sourceData.length) {
      // Linear interpolation
      resampled[i] = sourceData[index] * (1 - fraction) + sourceData[index + 1] * fraction;
    } else {
      resampled[i] = sourceData[index];
    }
  }

  return resampled;
}

/**
 * Calculate RMS (Root Mean Square) audio level
 */
export function calculateRMS(float32Array: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < float32Array.length; i++) {
    sum += float32Array[i] * float32Array[i];
  }
  return Math.sqrt(sum / float32Array.length);
}

/**
 * Get audio level in decibels
 */
export function getRMSdB(float32Array: Float32Array): number {
  const rms = calculateRMS(float32Array);
  return 20 * Math.log10(rms);
}

