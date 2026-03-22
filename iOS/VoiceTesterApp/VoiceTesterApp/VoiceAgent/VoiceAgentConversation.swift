//
//  VoiceAgentConversation.swift
//  VoiceTesterApp
//
//  Orchestrates a voice conversation with the xAI Voice Agent API.
//  Owns a VoiceAgentWebSocket (connection) and a VoiceAgentAudioEngine (mic + playback),
//  routes server events to the timeline, and exposes state for the UI.
//

import Foundation
import Combine

@MainActor
final class VoiceAgentConversation: ObservableObject {

    // MARK: - Connection State

    enum ConnectionState: Equatable {
        case disconnected, connecting, connected, error(String)
    }

    // MARK: - Published State

    @Published private(set) var connectionState: ConnectionState = .disconnected
    @Published private(set) var timeline: [TimelineItem] = []
    @Published private(set) var isAssistantSpeaking = false
    @Published private(set) var sessionId: UUID?
    @Published var voiceID: VoiceID = .eve

    /// True while the WebSocket is connected or connecting.
    var isActive: Bool { connectionState == .connected || connectionState == .connecting }

    /// True while the session is alive (includes error state — audio engine may still run).
    var isStarted: Bool { connectionState != .disconnected }

    // MARK: - Sub-components

    private let audioEngine = VoiceAgentAudioEngine()
    private let webSocket = VoiceAgentWebSocket()

    /// Exposed for the mic waveform view.
    var levelMeter: AudioLevelMeter { audioEngine.levelMeter }

    // MARK: - Private State

    private var currentResponseId: String?
    private var currentAssistantMessageId: UUID?
    private var audioDeltaCount = 0
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Init

    init() {
        $voiceID
            .dropFirst()
            .removeDuplicates()
            .sink { [weak self] newVoice in self?.handleVoiceChanged(newVoice) }
            .store(in: &cancellables)
    }

    // MARK: - Lifecycle

    func start() {
        guard !isActive else { return }

        let id = UUID()
        sessionId = id
        connectionState = .connecting
        timeline = []
        log("Session \(id.uuidString.prefix(8)) — voice: \(voiceID.rawValue)")

        // 1. Connect WebSocket (must exist before audio engine captures it).
        guard let apiKey = ProcessInfo.processInfo.environment["XAI_API_KEY"]
                ?? UserDefaults.standard.string(forKey: "XAI_API_KEY") else {
            log("⚠️ XAI_API_KEY not found in env or UserDefaults")
            connectionState = .error("XAI_API_KEY not set")
            return
        }
        webSocket.delegate = self
        webSocket.connect(apiKey: apiKey, log: { [weak self] in self?.log($0) })

        // 2. Start audio engine (mic + playback).
        //    The mic callback fires on the audio render thread with base64 PCM.
        //    We send it as a raw JSON string to avoid JSONSerialization overhead.
        let ws = self.webSocket
        let logs = audioEngine.start(echoCancellation: true) { base64 in
            let json = #"{"type":"input_audio_buffer.append","audio":"\#(base64)"}"#
            ws.sendRaw(json)
        }
        logs.forEach { log($0) }
    }

    func stop() {
        log("Session \(sessionId?.uuidString.prefix(8) ?? "?") ended")
        audioEngine.stop()
        webSocket.disconnect()
        connectionState = .disconnected
        isAssistantSpeaking = false
        sessionId = nil
        currentResponseId = nil
        currentAssistantMessageId = nil
        audioDeltaCount = 0
    }

    // MARK: - Send Text

    /// Send a user text message (conversation.item.create + response.create).
    func sendText(_ text: String) {
        guard connectionState == .connected, !text.isEmpty else { return }
        interruptAssistant()
        timeline.append(.message(role: .user, text: text))
        log("→ Sending text: \"\(text.prefix(60))\"")

        webSocket.sendJSON([
            "type": "conversation.item.create",
            "item": [
                "type": "message",
                "role": "user",
                "content": [["type": "input_text", "text": text] as [String: Any]] as [[String: Any]],
            ] as [String: Any],
        ], log: { [weak self] in self?.log($0) })

        webSocket.sendJSON([
            "type": "response.create",
            "response": ["modalities": ["text", "audio"]] as [String: Any],
        ], log: { [weak self] in self?.log($0) })
    }

    // MARK: - Private Helpers

    private func interruptAssistant() {
        guard isAssistantSpeaking || currentResponseId != nil else { return }
        log("⚡ Interrupting assistant (\(audioDeltaCount) audio deltas)")
        isAssistantSpeaking = false
        audioEngine.interruptPlayback()
        currentResponseId = nil
        currentAssistantMessageId = nil
        audioDeltaCount = 0
    }

    private func appendToCurrentAssistant(_ text: String) {
        guard let msgId = currentAssistantMessageId,
              let idx = timeline.lastIndex(where: { $0.id == msgId }),
              case .message(_, let role, let existing) = timeline[idx] else { return }
        timeline[idx] = .message(id: msgId, role: role, text: existing + text)
    }

    // MARK: - Settings Changes

    private func handleVoiceChanged(_ newVoice: VoiceID) {
        guard connectionState == .connected else { return }
        sendSessionUpdate(voice: newVoice)
    }

    // MARK: - Session Update

    private func sendSessionUpdate(voice: VoiceID? = nil) {
        let v = voice ?? voiceID
        log("→ session.update (voice: \(v.rawValue))")
        webSocket.sendJSON([
            "type": "session.update",
            "session": [
                "voice": v.rawValue,
                "instructions": "You are a helpful assistant.",
                "turn_detection": ["type": "server_vad"] as [String: Any],
            ] as [String: Any],
        ], log: { [weak self] in self?.log($0) })
    }

    // MARK: - Logging

    private func log(_ msg: String) {
        let ts = Self.timestampFormatter.string(from: Date())
        let line = "[\(ts)] \(msg)"
        print("[VoiceAgent] \(msg)")
        timeline.append(.log(text: line))
        if timeline.count > 500 { timeline.removeFirst(timeline.count - 500) }
    }

    nonisolated private static let timestampFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f
    }()
}

// MARK: - WebSocket Event Routing

extension VoiceAgentConversation: VoiceAgentWebSocketDelegate {

    func webSocketDidOpen() {
        connectionState = .connected
        sendSessionUpdate()
    }

    func webSocketDidClose(code: Int, reason: String?) {
        if isActive { connectionState = .error("WebSocket closed (\(code))") }
    }

    func webSocketDidFail(error: String, httpStatus: Int?) {
        if isActive { connectionState = .error(error) }
    }

    func webSocketDidReceive(json: [String: Any], type: String) {
        switch type {

        // ── Session lifecycle ──────────────────────────────────────────────
        case "session.created":
            log("✓ session.created")
            if connectionState != .connected { connectionState = .connected; sendSessionUpdate() }

        case "session.updated":
            log("✓ session.updated — ready")
            if connectionState != .connected { connectionState = .connected }

        case "conversation.created":
            let id = (json["conversation"] as? [String: Any])?["id"] as? String ?? "?"
            log("✓ conversation.created (\(id))")

        // ── User speech ────────────────────────────────────────────────────
        case "input_audio_buffer.speech_started":
            log("🎙 Speech started"); interruptAssistant()

        case "input_audio_buffer.speech_stopped":
            log("🎙 Speech stopped")

        case "input_audio_buffer.committed":
            log("🎙 Audio committed")

        case "conversation.item.created", "conversation.item.added":
            let role = (json["item"] as? [String: Any])?["role"] as? String ?? "?"
            log("← item.added (\(role))")

        case "conversation.item.input_audio_transcription.completed":
            let t = json["transcript"] as? String ?? ""
            if !t.isEmpty { timeline.append(.message(role: .user, text: t)); log("🎙 User: \"\(t.prefix(80))\"") }

        // ── Assistant response ─────────────────────────────────────────────
        case "response.created":
            if let r = json["response"] as? [String: Any], let id = r["id"] as? String {
                currentResponseId = id; isAssistantSpeaking = true
                let msgId = UUID(); currentAssistantMessageId = msgId
                timeline.append(.message(id: msgId, role: .assistant, text: ""))
                log("🤖 Response (\(id.prefix(12))…)")
            }

        case "response.output_audio_transcript.delta", "response.audio_transcript.delta":
            guard let d = json["delta"] as? String, json["response_id"] as? String == currentResponseId else { return }
            appendToCurrentAssistant(d)

        case "response.output_audio.delta", "response.audio.delta":
            guard let d = json["delta"] as? String, json["response_id"] as? String == currentResponseId else { return }
            audioEngine.playAudioDelta(base64: d)
            if audioDeltaCount == 0 { log("🔊 First audio delta (\(Data(base64Encoded: d)?.count ?? 0) bytes)") }
            audioDeltaCount += 1

        case "response.output_audio.done", "response.audio.done":
            log("🔊 Audio done (\(audioDeltaCount) deltas)")

        case "response.output_audio_transcript.done", "response.audio_transcript.done":
            log("🤖 Transcript done")

        case "response.content_part.done", "response.content_part.added",
             "response.output_item.done", "response.output_item.added":
            break

        case "response.done":
            isAssistantSpeaking = false; currentAssistantMessageId = nil
            let s = (json["response"] as? [String: Any])?["status"] as? String ?? "?"
            log("✓ Response done (\(s), \(audioDeltaCount) audio deltas)"); audioDeltaCount = 0

        // ── Keepalive ──────────────────────────────────────────────────────
        case "ping":
            if let ts = json["ping_timestamp"] as? Int64 {
                webSocket.sendJSON(["type": "pong", "ping_timestamp": ts])
            }

        // ── Errors ─────────────────────────────────────────────────────────
        case "error":
            let msg = json["message"] as? String ?? "Unknown"
            let code = json["code"] as? String ?? ""
            log("❌ Error [\(code)]: \(msg)")
            if code == "timeout" || code == "max_duration" { stop() }

        default:
            log("← \(type)")
        }
    }
}
