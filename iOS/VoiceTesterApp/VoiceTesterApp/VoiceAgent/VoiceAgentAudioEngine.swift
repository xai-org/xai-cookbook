//
//  VoiceAgentAudioEngine.swift
//  VoiceTesterApp
//
//  Manages AVAudioEngine for simultaneous microphone capture and audio playback.
//  Microphone audio is resampled to 24 kHz Int16 PCM and delivered as base64 strings.
//  Incoming audio deltas (base64 Int16 at 24 kHz) are decoded and played through an AVAudioPlayerNode.
//

import AVFoundation

/// Callback delivering base64-encoded 24 kHz Int16 PCM audio from the microphone.
typealias MicAudioHandler = (String) -> Void

@MainActor
final class VoiceAgentAudioEngine {

    // MARK: - Configuration

    static let sampleRate: Double = 24_000
    static let outputFormat = AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate: sampleRate,
        channels: 1,
        interleaved: false
    )!

    // MARK: - Public State

    /// Thread-safe rolling RMS meter, polled by the UI for waveform display.
    let levelMeter = AudioLevelMeter()

    var isRunning: Bool { engine?.isRunning ?? false }

    // MARK: - Private

    private var engine: AVAudioEngine?
    private var playerNode: AVAudioPlayerNode?

    // MARK: - Lifecycle

    /// Configure the audio session, create the engine, install the mic tap, and start.
    ///
    /// - Parameters:
    ///   - echoCancellation: When `true`, enables `.voiceChat` mode and voice processing (AEC + AGC).
    ///   - onMicAudio: Called on the audio render thread with base64-encoded 24 kHz Int16 PCM chunks.
    /// - Returns: A log describing each setup step (for debug display).
    @discardableResult
    func start(echoCancellation: Bool, onMicAudio: @escaping MicAudioHandler) -> [String] {
        var logs: [String] = []

        // 1. Audio session — .voiceChat mode is required for echo cancellation to work.
        do {
            let session = AVAudioSession.sharedInstance()
            let mode: AVAudioSession.Mode = echoCancellation ? .voiceChat : .default
            try session.setCategory(.playAndRecord, mode: mode, options: [.defaultToSpeaker, .allowBluetoothA2DP])
            try session.setActive(true)
            logs.append("Audio session active (mode: \(mode == .voiceChat ? "voiceChat" : "default"))")
        } catch {
            logs.append("⚠️ Audio session error: \(error)")
            return logs
        }

        // 2. Create engine.
        let engine = AVAudioEngine()

        // 3. Attach output nodes BEFORE enabling voice processing (matches GrokApp's VoiceAudioEngine).
        let player = AVAudioPlayerNode()
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: Self.outputFormat)

        // 4. Voice processing — after nodes, before tap. .voiceChat mode makes this synchronous.
        if echoCancellation {
            do {
                try engine.inputNode.setVoiceProcessingEnabled(true)
                engine.inputNode.isVoiceProcessingAGCEnabled = true
                engine.inputNode.isVoiceProcessingBypassed = false
                logs.append("Voice processing enabled (AEC + AGC)")
            } catch {
                logs.append("⚠️ Voice processing failed: \(error) — continuing without AEC")
            }
        }

        // 5. Install mic tap.
        let inputNode = engine.inputNode
        let inputFormat = inputNode.outputFormat(forBus: 0)
        logs.append("Mic format: \(Int(inputFormat.sampleRate)) Hz, \(inputFormat.channelCount) ch")

        guard inputFormat.sampleRate > 0 else {
            logs.append("⚠️ Mic input has zero sample rate")
            return logs
        }

        let meter = self.levelMeter
        inputNode.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { buffer, _ in
            meter.push(Self.computeRMS(buffer))
            guard let data = Self.resampleToInt16(buffer: buffer, inputFormat: inputFormat) else { return }
            onMicAudio(data.base64EncodedString())
        }

        // 6. Start engine.
        do {
            engine.prepare()
            try engine.start()
            player.play()
            logs.append("Audio engine running")
        } catch {
            logs.append("⚠️ Engine start error: \(error)")
            return logs
        }

        self.engine = engine
        self.playerNode = player
        return logs
    }

    func stop() {
        guard let engine else { return }
        engine.inputNode.removeTap(onBus: 0)
        playerNode?.stop()
        if engine.isRunning { engine.stop() }
        self.engine = nil
        self.playerNode = nil

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    // MARK: - Playback

    /// Decode a base64 Int16 audio delta and schedule it for playback.
    func playAudioDelta(base64: String) {
        guard let audioData = Data(base64Encoded: base64),
              let playerNode,
              let engine, engine.isRunning else { return }

        let frameCount = audioData.count / MemoryLayout<Int16>.size
        guard frameCount > 0,
              let buffer = AVAudioPCMBuffer(pcmFormat: Self.outputFormat, frameCapacity: UInt32(frameCount)),
              let floats = buffer.floatChannelData?[0] else { return }

        buffer.frameLength = UInt32(frameCount)
        audioData.withUnsafeBytes { raw in
            guard let src = raw.baseAddress?.assumingMemoryBound(to: Int16.self) else { return }
            for i in 0..<frameCount {
                floats[i] = Float(src[i]) / Float(Int16.max)
            }
        }

        playerNode.scheduleBuffer(buffer)
        if !playerNode.isPlaying { playerNode.play() }
    }

    /// Stop current playback and re-prime the player for new audio.
    func interruptPlayback() {
        playerNode?.stop()
        playerNode?.play()
    }

    // MARK: - Audio Processing (nonisolated — safe for render thread)

    nonisolated static func computeRMS(_ buffer: AVAudioPCMBuffer) -> Float {
        guard let data = buffer.floatChannelData?[0] else { return 0 }
        let count = Int(buffer.frameLength)
        guard count > 0 else { return 0 }
        var sum: Float = 0
        for i in 0..<count { sum += data[i] * data[i] }
        return sqrt(sum / Float(count))
    }

    nonisolated static func resampleToInt16(buffer: AVAudioPCMBuffer, inputFormat: AVAudioFormat) -> Data? {
        let targetRate = sampleRate

        let sourceBuffer: AVAudioPCMBuffer
        if inputFormat.sampleRate != targetRate {
            guard let fmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: targetRate, channels: 1, interleaved: true),
                  let converter = AVAudioConverter(from: inputFormat, to: fmt) else { return nil }
            let newCount = AVAudioFrameCount(Double(buffer.frameLength) * targetRate / inputFormat.sampleRate)
            guard let converted = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: newCount) else { return nil }
            var error: NSError?
            converter.convert(to: converted, error: &error) { _, outStatus in
                outStatus.pointee = .haveData
                return buffer
            }
            if error != nil { return nil }
            sourceBuffer = converted
        } else {
            sourceBuffer = buffer
        }

        guard let floats = sourceBuffer.floatChannelData?[0] else { return nil }
        let count = Int(sourceBuffer.frameLength)
        var int16s = [Int16](repeating: 0, count: count)
        for i in 0..<count {
            int16s[i] = Int16(max(-1, min(1, floats[i])) * Float(Int16.max - 1))
        }
        return Data(bytes: &int16s, count: count * MemoryLayout<Int16>.size)
    }
}
