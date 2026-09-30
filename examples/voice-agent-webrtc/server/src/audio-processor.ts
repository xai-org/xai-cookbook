/**
 * Audio format conversion utilities
 * 
 * Note: This implementation uses a hybrid approach where PCM16 audio
 * is sent via DataChannel instead of native WebRTC audio tracks.
 * This avoids complex Opus codec dependencies while maintaining quality.
 */

export class AudioProcessor {
  private sampleRate: number;

  constructor(sampleRate: number = 24000) {
    this.sampleRate = sampleRate;
  }

  /**
   * Convert base64 encoded PCM16 to Buffer
   */
  base64ToBuffer(base64Audio: string): Buffer {
    return Buffer.from(base64Audio, "base64");
  }

  /**
   * Convert Buffer to base64 encoded string
   */
  bufferToBase64(buffer: Buffer): string {
    return buffer.toString("base64");
  }

  /**
   * Validate audio buffer format
   */
  validateAudioBuffer(buffer: Buffer): boolean {
    return buffer && buffer.length > 0;
  }

  /**
   * Get sample rate
   */
  getSampleRate(): number {
    return this.sampleRate;
  }
}
