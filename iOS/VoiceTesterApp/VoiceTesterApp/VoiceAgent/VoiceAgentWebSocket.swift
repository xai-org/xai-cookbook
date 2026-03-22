//
//  VoiceAgentWebSocket.swift
//  VoiceTesterApp
//
//  WebSocket client for the xAI Voice Agent API (wss://api.x.ai/v1/realtime).
//  Handles connection lifecycle, authentication via Sec-WebSocket-Protocol,
//  JSON send/receive, and delegate-based open/close/error callbacks.
//

import Foundation

/// Events emitted by the WebSocket to its owner.
protocol VoiceAgentWebSocketDelegate: AnyObject {
    @MainActor func webSocketDidOpen()
    @MainActor func webSocketDidClose(code: Int, reason: String?)
    @MainActor func webSocketDidFail(error: String, httpStatus: Int?)
    @MainActor func webSocketDidReceive(json: [String: Any], type: String)
}

@MainActor
final class VoiceAgentWebSocket {

    weak var delegate: VoiceAgentWebSocketDelegate?

    private(set) var isConnected = false

    private var task: URLSessionWebSocketTask?
    private var session: URLSession?
    private var sessionDelegate: Delegate?
    private var timeoutTask: Task<Void, Never>?

    // MARK: - Connect

    /// Opens a WebSocket to the xAI Voice Agent endpoint.
    /// Auth is passed via `Sec-WebSocket-Protocol` because `URLSessionWebSocketTask`
    /// strips the `Authorization` header during the HTTP→WS upgrade.
    func connect(apiKey: String, log: @escaping (String) -> Void) {
        let url = URL(string: "wss://api.x.ai/v1/realtime")!
        log("Connecting to \(url.absoluteString)")

        let delegate = Delegate(
            onOpen: { [weak self] proto in
                Task { @MainActor in
                    guard let self else { return }
                    self.isConnected = true
                    self.timeoutTask?.cancel()
                    log("✓ WebSocket opened (protocol: \(proto ?? "none"))")
                    self.delegate?.webSocketDidOpen()
                }
            },
            onClose: { [weak self] code, reason in
                let reasonStr = reason.flatMap { String(data: $0, encoding: .utf8) }
                Task { @MainActor in
                    self?.isConnected = false
                    log("⚠️ WebSocket closed (code: \(code.rawValue), reason: \(reasonStr ?? "none"))")
                    self?.delegate?.webSocketDidClose(code: code.rawValue, reason: reasonStr)
                }
            },
            onComplete: { [weak self] task, error in
                Task { @MainActor in
                    let status = (task.response as? HTTPURLResponse)?.statusCode
                    if let status { log("   HTTP upgrade status: \(status)") }
                    if let error {
                        let ns = error as NSError
                        log("⚠️ WebSocket failed: \(error.localizedDescription) (domain: \(ns.domain), code: \(ns.code))")
                        self?.isConnected = false
                        self?.delegate?.webSocketDidFail(error: error.localizedDescription, httpStatus: status)
                    }
                }
            }
        )
        self.sessionDelegate = delegate

        let urlSession = URLSession(configuration: .default, delegate: delegate, delegateQueue: nil)
        self.session = urlSession

        let wsTask = urlSession.webSocketTask(with: url, protocols: ["xai-client-secret.\(apiKey)"])
        self.task = wsTask
        wsTask.resume()

        // Timeout — if nothing arrives in 10s, the connection likely failed silently.
        timeoutTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(10))
            guard let self, !self.isConnected else { return }
            log("⚠️ WebSocket timeout — no response after 10s")
            self.delegate?.webSocketDidFail(error: "WebSocket timeout", httpStatus: nil)
        }

        receiveLoop(log: log)
    }

    // MARK: - Disconnect

    func disconnect() {
        timeoutTask?.cancel()
        timeoutTask = nil
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        session?.invalidateAndCancel()
        session = nil
        sessionDelegate = nil
        isConnected = false
    }

    // MARK: - Send

    func sendJSON(_ dict: [String: Any], log: ((String) -> Void)? = nil) {
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let string = String(data: data, encoding: .utf8) else { return }
        sendRaw(string, log: log)
    }

    /// Send a pre-serialized JSON string (avoids re-serialization for hot-path audio).
    func sendRaw(_ string: String, log: ((String) -> Void)? = nil) {
        task?.send(.string(string)) { error in
            if let error {
                Task { @MainActor in log?("⚠️ WS send error: \(error.localizedDescription)") }
            }
        }
    }

    // MARK: - Receive

    private func receiveLoop(log: @escaping (String) -> Void) {
        task?.receive { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                self.timeoutTask?.cancel()
                self.timeoutTask = nil

                switch result {
                case .success(let message):
                    var data: Data?
                    switch message {
                    case .string(let text): data = text.data(using: .utf8)
                    case .data(let d): data = d
                    @unknown default: break
                    }
                    if let data,
                       let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                       let type = json["type"] as? String {
                        self.delegate?.webSocketDidReceive(json: json, type: type)
                    } else {
                        let raw = data.flatMap { String(data: $0, encoding: .utf8) } ?? "<binary>"
                        log("⚠️ Unparseable message: \(raw.prefix(200))")
                    }
                    self.receiveLoop(log: log)

                case .failure(let error):
                    log("⚠️ WebSocket receive error: \(error)")
                    self.isConnected = false
                    self.delegate?.webSocketDidFail(error: error.localizedDescription, httpStatus: nil)
                }
            }
        }
    }
}

// MARK: - URLSession Delegate

private final class Delegate: NSObject, URLSessionWebSocketDelegate, URLSessionTaskDelegate {
    let onOpen: (String?) -> Void
    let onClose: (URLSessionWebSocketTask.CloseCode, Data?) -> Void
    let onComplete: (URLSessionTask, Error?) -> Void

    init(
        onOpen: @escaping (String?) -> Void,
        onClose: @escaping (URLSessionWebSocketTask.CloseCode, Data?) -> Void,
        onComplete: @escaping (URLSessionTask, Error?) -> Void
    ) {
        self.onOpen = onOpen
        self.onClose = onClose
        self.onComplete = onComplete
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol proto: String?) {
        onOpen(proto)
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith code: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        onClose(code, reason)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) {
        onComplete(task, error)
    }
}
