//
//  VoiceAgentModels.swift
//  VoiceTesterApp
//
//  Shared data types for the Voice Agent API feature.
//

import Foundation
import os

// MARK: - Timeline

/// A single item in the conversation timeline — either a debug log or a chat message.
enum TimelineItem: Identifiable {
    case log(id: UUID = UUID(), text: String)
    case message(id: UUID = UUID(), role: MessageRole, text: String)

    enum MessageRole { case user, assistant }

    var id: UUID {
        switch self {
        case .log(let id, _): id
        case .message(let id, _, _): id
        }
    }
}

// MARK: - Audio Level Meter

/// Thread-safe rolling RMS buffer shared between the audio render thread and MainActor.
/// The audio tap calls `push(_:)` at render rate; the UI polls `samples` via `TimelineView`.
final class AudioLevelMeter: @unchecked Sendable {
    private let barCount: Int
    private var _samples: [Float]
    private var _writeIndex = 0
    private let lock = os_unfair_lock_t.allocate(capacity: 1)

    init(barCount: Int = 50) {
        self.barCount = barCount
        self._samples = Array(repeating: 0, count: barCount)
        lock.initialize(to: os_unfair_lock())
    }

    deinit { lock.deallocate() }

    /// Push a new RMS value (called from the audio render thread).
    func push(_ rms: Float) {
        os_unfair_lock_lock(lock)
        _samples[_writeIndex % barCount] = rms
        _writeIndex += 1
        os_unfair_lock_unlock(lock)
    }

    /// Snapshot the rolling buffer as an ordered array (called from MainActor).
    var samples: [Float] {
        os_unfair_lock_lock(lock)
        let start = _writeIndex % barCount
        let result = Array(_samples[start...]) + Array(_samples[..<start])
        os_unfair_lock_unlock(lock)
        return result
    }
}
