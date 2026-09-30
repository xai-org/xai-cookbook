//
//  StreamingTTSView.swift
//  VoiceTesterApp
//
//  Streaming TTS over WebSocket.
//
//  Flow:
//    1. Connect  wss://api.x.ai/v1/tts?voice=…&codec=pcm&sample_rate=24000
//    2. Send     {"type":"text.delta","delta":"…"}  (one or more)
//    3. Send     {"type":"text.done"}
//    4. Receive  {"type":"audio.delta","delta":"<base64 PCM>"}  (many)
//    5. Receive  {"type":"audio.done"}
//

import AVFoundation
import SwiftUI
import Combine

// MARK: - View

struct StreamingTTSView: View {
    @State private var inputText = "Hello! This is the streaming text to speech API. Words are sent incrementally and audio streams back in real time."
    @State private var voiceID: VoiceID = .eve
    @State private var language: TTSLanguage = .en
    @StateObject private var streamer = StreamingTTSStreamer()

    var body: some View {
        Form {
            Section("Input") {
                TextEditor(text: $inputText)
                    .frame(minHeight: 100)

                Picker("Voice", selection: $voiceID) {
                    ForEach(VoiceID.allCases) { voice in
                        VStack(alignment: .leading) {
                            Text(voice.displayName)
                            Text("\(voice.gender) · \(voice.tone)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .tag(voice)
                    }
                }

                Picker("Language", selection: $language) {
                    ForEach(TTSLanguage.allCases) { lang in
                        Text(lang.displayName).tag(lang)
                    }
                }
            }

            Section {
                Button {
                    if streamer.isStreaming {
                        streamer.stop()
                    } else {
                        streamer.start(text: inputText, voice: voiceID, language: language)
                    }
                } label: {
                    HStack {
                        if streamer.isStreaming {
                            ProgressView().controlSize(.small)
                        }
                        Text(streamer.isStreaming ? "Stop" : "Stream Speech")
                    }
                    .frame(maxWidth: .infinity)
                }
                .disabled(inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }

            if let error = streamer.errorMessage {
                Section {
                    Text(error).foregroundStyle(.red)
                }
            }

            if !streamer.log.isEmpty {
                Section("Log") {
                    Text(streamer.log.joined(separator: "\n"))
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            }
        }
    }
}

// MARK: - WebSocket Delegate

private class StreamingWSDelegate: NSObject, URLSessionWebSocketDelegate {
    weak var streamer: StreamingTTSStreamer?

    func urlSession(_: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol proto: String?) {
        Task { @MainActor [weak streamer] in
            streamer?.handleWebSocketOpen()
        }
    }

    func urlSession(_: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith code: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        let reasonStr = reason.flatMap { String(data: $0, encoding: .utf8) }
        Task { @MainActor [weak streamer] in
            streamer?.handleConnectionDropped("Connection closed (code: \(code.rawValue)\(reasonStr.map { ", \($0)" } ?? ""))")
        }
    }

    func urlSession(_: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else { return }
        Task { @MainActor [weak streamer] in
            streamer?.handleConnectionDropped("Connection failed: \(error.localizedDescription)")
        }
    }
}

// MARK: - Streamer

@MainActor
final class StreamingTTSStreamer: ObservableObject {
    @Published private(set) var isStreaming = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var log: [String] = []

    private var webSocketTask: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    private let wsDelegate = StreamingWSDelegate()
    private var openContinuation: CheckedContinuation<Void, Error>?
    private var audioEngine: AVAudioEngine?
    private var playerNode: AVAudioPlayerNode?
    private var deltaCount = 0

    private static let sampleRate = 24000
    private static let outputFormat = AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate: Double(sampleRate),
        channels: 1,
        interleaved: false
    )!

    // MARK: - Public API

    func start(text: String, voice: VoiceID, language: TTSLanguage = .en) {
        guard !isStreaming else { return }
        isStreaming = true
        errorMessage = nil
        log = []
        deltaCount = 0

        guard let apiKey = ProcessInfo.processInfo.environment["XAI_API_KEY"]
                ?? UserDefaults.standard.string(forKey: "XAI_API_KEY") else {
            fail("XAI_API_KEY not set")
            return
        }

        appendLog("Starting (voice: \(voice.rawValue), language: \(language.displayName), pcm \(Self.sampleRate) Hz)")
        setupAudioEngine()

        var components = URLComponents(string: "wss://api.x.ai/v1/tts")!
        components.queryItems = [
            URLQueryItem(name: "voice", value: voice.rawValue),
            URLQueryItem(name: "codec", value: "pcm"),
            URLQueryItem(name: "sample_rate", value: "\(Self.sampleRate)"),
        ]
        components.queryItems?.append(URLQueryItem(name: "language", value: language.rawValue))

        wsDelegate.streamer = self
        let session = URLSession(configuration: .default, delegate: wsDelegate, delegateQueue: nil)
        self.urlSession = session

        let task = session.webSocketTask(with: components.url!, protocols: ["xai-client-secret.\(apiKey)"])
        self.webSocketTask = task
        task.resume()
        appendLog("Connecting…")

        // Wait for WebSocket open, then send text.
        Task {
            do {
                try await withCheckedThrowingContinuation { self.openContinuation = $0 }
            } catch { return }
            guard isStreaming else { return }

            let chunks = Self.splitIntoChunks(text)
            appendLog("Sending \(chunks.count) text chunks…")
            for chunk in chunks {
                guard isStreaming else { return }
                sendJSON(["type": "text.delta", "delta": chunk])
                try? await Task.sleep(for: .milliseconds(50))
            }
            sendJSON(["type": "text.done"])
            appendLog("→ text.done sent")
        }
    }

    func stop() {
        appendLog("Stopped")
        openContinuation?.resume(throwing: CancellationError())
        openContinuation = nil
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
        urlSession?.invalidateAndCancel()
        urlSession = nil
        tearDownAudioEngine()
        isStreaming = false
    }

    // MARK: - Audio Engine

    private func setupAudioEngine() {
        let engine = AVAudioEngine()
        let player = AVAudioPlayerNode()
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: Self.outputFormat)

        do {
            try AVAudioSession.sharedInstance().setCategory(.playback)
            try AVAudioSession.sharedInstance().setActive(true)
            engine.prepare()
            try engine.start()
            player.play()
        } catch {
            appendLog("⚠️ Audio engine: \(error)")
        }

        self.audioEngine = engine
        self.playerNode = player
    }

    private func tearDownAudioEngine() {
        playerNode?.stop()
        if let engine = audioEngine, engine.isRunning { engine.stop() }
        audioEngine = nil
        playerNode = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// Decode base64 PCM Int16 → Float32 and schedule for playback.
    private func playPCMDelta(_ base64: String) {
        guard let data = Data(base64Encoded: base64),
              let playerNode, let engine = audioEngine, engine.isRunning else { return }

        let frameCount = data.count / MemoryLayout<Int16>.size
        guard frameCount > 0,
              let buffer = AVAudioPCMBuffer(pcmFormat: Self.outputFormat, frameCapacity: UInt32(frameCount)),
              let floats = buffer.floatChannelData?[0] else { return }

        buffer.frameLength = UInt32(frameCount)
        data.withUnsafeBytes { raw in
            guard let src = raw.baseAddress?.assumingMemoryBound(to: Int16.self) else { return }
            for i in 0..<frameCount { floats[i] = Float(src[i]) / Float(Int16.max) }
        }

        playerNode.scheduleBuffer(buffer)
        if !playerNode.isPlaying { playerNode.play() }
    }

    // MARK: - WebSocket

    private func receiveLoop() {
        webSocketTask?.receive { [weak self] result in
            Task { @MainActor in
                guard let self, self.isStreaming else { return }
                switch result {
                case .success(.string(let text)):
                    if let data = text.data(using: .utf8),
                       let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                       let type = json["type"] as? String {
                        self.handleEvent(type: type, json: json)
                    }
                    self.receiveLoop()
                case .success:
                    self.receiveLoop()
                case .failure(let error):
                    self.fail("WebSocket error: \(error.localizedDescription)")
                }
            }
        }
    }

    private func handleEvent(type: String, json: [String: Any]) {
        switch type {
        case "audio.delta":
            if let delta = json["delta"] as? String {
                deltaCount += 1
                appendLog("← audio.delta (\(delta.count) b64 chars)")
                playPCMDelta(delta)
            }
        case "audio.done":
            appendLog("← audio.done (\(deltaCount) deltas total)")
            isStreaming = false
        case "error":
            let msg = json["message"] as? String ?? "Unknown error"
            appendLog("← error: \(msg)")
            fail("Server: \(msg)")
        default:
            appendLog("← \(type)")
        }
    }

    private func sendJSON(_ dict: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let string = String(data: data, encoding: .utf8) else { return }
        appendLog("→ \(string)")
        webSocketTask?.send(.string(string)) { [weak self] error in
            if let error {
                Task { @MainActor in self?.appendLog("⚠️ send: \(error.localizedDescription)") }
            }
        }
    }

    // MARK: - Connection Lifecycle

    fileprivate func handleWebSocketOpen() {
        appendLog("✅ Connected")
        openContinuation?.resume()
        openContinuation = nil
        receiveLoop()
    }

    fileprivate func handleConnectionDropped(_ msg: String) {
        openContinuation?.resume(throwing: CancellationError())
        openContinuation = nil
        guard isStreaming else { return }
        fail(msg)
    }

    private func fail(_ msg: String) {
        errorMessage = msg
        appendLog("⚠️ \(msg)")
        webSocketTask?.cancel(with: .abnormalClosure, reason: nil)
        webSocketTask = nil
        tearDownAudioEngine()
        isStreaming = false
    }

    fileprivate func appendLog(_ msg: String) {
        print("[TTS] \(msg)")
        log.append(msg)
    }

    /// Split text into sentence-like chunks for realistic streaming.
    private static func splitIntoChunks(_ text: String) -> [String] {
        var chunks: [String] = []
        var current = ""
        for char in text {
            current.append(char)
            if ".!?,;:\n".contains(char) || current.count > 80 {
                chunks.append(current)
                current = ""
            }
        }
        if !current.isEmpty { chunks.append(current) }
        return chunks
    }
}
