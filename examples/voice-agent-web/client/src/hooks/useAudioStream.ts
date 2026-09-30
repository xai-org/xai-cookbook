/**
 * Audio capture and playback hook using Web Audio API
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { float32ToPCM16Base64, base64PCM16ToFloat32 } from "../utils/audio";

const CHUNK_DURATION_MS = 100;

interface UseAudioStreamReturn {
  isCapturing: boolean;
  startCapture: (onAudioData: (base64Audio: string) => void) => Promise<number>;
  stopCapture: () => void;
  stopPlayback: () => void;
  playAudio: (base64Audio: string) => void;
  audioLevel: number;
  sampleRate: number;
}

export function useAudioStream(): UseAudioStreamReturn {
  const [isCapturing, setIsCapturing] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [sampleRate, setSampleRate] = useState(0);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const playbackQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);
  const currentPlaybackSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Initialize audio context with native sample rate
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      // Let browser choose native sample rate for optimal performance
      audioContextRef.current = new AudioContext();
      const nativeSampleRate = audioContextRef.current.sampleRate;
      setSampleRate(nativeSampleRate);
      console.log(`Audio context initialized with native sample rate: ${nativeSampleRate}Hz`);
    }
    return audioContextRef.current;
  }, []);

  // Start audio capture - returns the detected sample rate
  const startCapture = useCallback(async (onAudioData: (base64Audio: string) => void): Promise<number> => {
    try {
      // Initialize audio context first to get native sample rate
      const audioContext = getAudioContext();
      const nativeSampleRate = audioContext.sampleRate;
      
      // Request microphone access with native sample rate
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: nativeSampleRate,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      mediaStreamRef.current = stream;
      
      // Resume context if suspended
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      // Create source from microphone
      const source = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = source;

      // Create script processor for audio chunks
      const bufferSize = 4096;
      const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
      
      let audioBuffer: Float32Array[] = [];
      let totalSamples = 0;
      const chunkSizeSamples = (audioContext.sampleRate * CHUNK_DURATION_MS) / 1000;

      processor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);
        
        // Calculate audio level
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        setAudioLevel(rms);

        // Buffer audio data
        audioBuffer.push(new Float32Array(inputData));
        totalSamples += inputData.length;

        // Send chunks of ~100ms
        while (totalSamples >= chunkSizeSamples) {
          const chunk = new Float32Array(chunkSizeSamples);
          let offset = 0;

          while (offset < chunkSizeSamples && audioBuffer.length > 0) {
            const buffer = audioBuffer[0];
            const needed = chunkSizeSamples - offset;
            const available = buffer.length;

            if (available <= needed) {
              // Use entire buffer
              chunk.set(buffer, offset);
              offset += available;
              totalSamples -= available;
              audioBuffer.shift();
            } else {
              // Use part of buffer
              chunk.set(buffer.subarray(0, needed), offset);
              audioBuffer[0] = buffer.subarray(needed);
              offset += needed;
              totalSamples -= needed;
            }
          }

          // Convert to PCM16 and send
          const base64Audio = float32ToPCM16Base64(chunk);
          onAudioData(base64Audio);
        }
      };

      processorNodeRef.current = processor;

      // Connect nodes
      source.connect(processor);
      processor.connect(audioContext.destination);

      setIsCapturing(true);
      console.log(`Audio capture started at ${nativeSampleRate}Hz (native)`);
      
      // Return the sample rate for immediate use
      return nativeSampleRate;
    } catch (error) {
      console.error("Failed to start audio capture:", error);
      throw error;
    }
  }, [getAudioContext]);

  // Stop audio capture
  const stopCapture = useCallback(() => {
    if (processorNodeRef.current) {
      processorNodeRef.current.disconnect();
      processorNodeRef.current = null;
    }

    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    setIsCapturing(false);
    setAudioLevel(0);
    console.log("Audio capture stopped");
  }, []);

  // Stop audio playback
  const stopPlayback = useCallback(() => {
    // Stop currently playing audio source
    if (currentPlaybackSourceRef.current) {
      try {
        currentPlaybackSourceRef.current.stop();
        currentPlaybackSourceRef.current.disconnect();
      } catch (error) {
        // Source may already be stopped, ignore error
      }
      currentPlaybackSourceRef.current = null;
    }
    
    // Clear the playback queue
    playbackQueueRef.current = [];
    isPlayingRef.current = false;
    console.log("Audio playback stopped (interrupted)");
  }, []);

  // Play audio
  const playAudio = useCallback((base64Audio: string) => {
    try {
      const audioContext = getAudioContext();
      const float32Data = base64PCM16ToFloat32(base64Audio);
      
      // Add to playback queue
      playbackQueueRef.current.push(float32Data);

      // Start playback if not already playing
      if (!isPlayingRef.current) {
        isPlayingRef.current = true;
        playNextChunk(audioContext);
      }
    } catch (error) {
      console.error("Error playing audio:", error);
    }
  }, [getAudioContext]);

  // Play next chunk from queue
  const playNextChunk = useCallback((audioContext: AudioContext) => {
    if (playbackQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      currentPlaybackSourceRef.current = null;
      return;
    }

    const chunk = playbackQueueRef.current.shift()!;
    // Use native sample rate for playback (no resampling needed)
    const audioBuffer = audioContext.createBuffer(1, chunk.length, audioContext.sampleRate);
    audioBuffer.getChannelData(0).set(chunk);

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);

    // Store reference to current source for interruption handling
    currentPlaybackSourceRef.current = source;

    source.onended = () => {
      // Clear reference when playback ends naturally
      if (currentPlaybackSourceRef.current === source) {
        currentPlaybackSourceRef.current = null;
      }
      playNextChunk(audioContext);
    };

    source.start();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCapture();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [stopCapture]);

  return {
    isCapturing,
    startCapture,
    stopCapture,
    stopPlayback,
    playAudio,
    audioLevel,
    sampleRate,
  };
}

