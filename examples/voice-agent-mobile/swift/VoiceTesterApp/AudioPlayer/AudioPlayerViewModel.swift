//
//  AudioPlayerViewModel.swift
//  VoiceTesterApp
//

import AVFoundation
import Combine
import SwiftUI

@MainActor
final class AudioPlayerViewModel: ObservableObject {

    enum Speed: String, CaseIterable {
        case x0_75 = "0.75x"
        case x1 = "1x"
        case x1_25 = "1.25x"
        case x1_5 = "1.5x"
        case x1_75 = "1.75x"
        case x2 = "2x"

        var rate: Float {
            switch self {
            case .x0_75: return 0.75
            case .x1: return 1.0
            case .x1_25: return 1.25
            case .x1_5: return 1.5
            case .x1_75: return 1.75
            case .x2: return 2.0
            }
        }
    }

    // MARK: - Published Properties

    @Published private(set) var isLoading = true
    @Published private(set) var isPlaying = false
    @Published private(set) var hasError = false
    @Published private(set) var currentTime: TimeInterval = 0
    @Published private(set) var duration: TimeInterval = 0
    @Published private(set) var isScrubbing = false
    @Published var speed: Speed = .x1 {
        didSet {
            if oldValue != speed {
                applySpeed()
            }
        }
    }

    var progress: CGFloat {
        guard duration > 0 else { return 0 }
        return CGFloat(currentTime / duration)
    }

    var timeRemaining: TimeInterval {
        max(0, duration - currentTime)
    }

    // MARK: - Private Properties

    private var player: AVPlayer?
    private var timeObserver: Any?
    private var playerItemObservation: NSKeyValueObservation?
    private var playerItemEndObserver: NSObjectProtocol?

    let url: URL

    // MARK: - Init

    init(url: URL) {
        self.url = url
    }

    // MARK: - Public Methods

    func load() async {
        isLoading = true
        hasError = false

        do {
            try AVAudioSession.sharedInstance().setCategory(.playback)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("[AudioPlayer] Audio session error: \(error)")
        }

        let asset = AVAsset(url: url)
        let playerItem = AVPlayerItem(asset: asset)
        player = AVPlayer(playerItem: playerItem)

        do {
            let loadedDuration = try await asset.load(.duration)
            duration = loadedDuration.seconds
        } catch {
            print("[AudioPlayer] Failed to load duration: \(error)")
            hasError = true
            isLoading = false
            return
        }

        // Observe player item status
        playerItemObservation = playerItem.observe(\.status, options: [.new]) { [weak self] item, _ in
            Task { @MainActor in
                guard let self else { return }
                switch item.status {
                case .readyToPlay:
                    self.isLoading = false
                case .failed:
                    self.hasError = true
                    self.isLoading = false
                default:
                    break
                }
            }
        }

        // Observe playback end
        playerItemEndObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: playerItem,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.handlePlaybackEnd()
            }
        }

        // Periodic time observer
        timeObserver = player?.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.1, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            Task { @MainActor in
                guard let self, !self.isScrubbing else { return }
                self.currentTime = time.seconds
            }
        }

        isLoading = false
    }

    func play() {
        guard !hasError else { return }

        // Restart from beginning if at the end
        if currentTime >= duration - 0.1 {
            seek(to: 0)
        }

        player?.rate = speed.rate
        isPlaying = true
    }

    func pause() {
        player?.pause()
        isPlaying = false
    }

    func togglePlayPause() {
        isPlaying ? pause() : play()
    }

    func seek(to seconds: TimeInterval) {
        let clamped = max(0, min(seconds, duration))
        player?.seek(to: CMTime(seconds: clamped, preferredTimescale: 600))
        currentTime = clamped
    }

    func scrub(to fraction: CGFloat) {
        isScrubbing = true
        let clamped = max(0, min(1, fraction))
        let targetTime = clamped * duration
        currentTime = targetTime
        player?.seek(
            to: CMTime(seconds: targetTime, preferredTimescale: 600),
            toleranceBefore: .zero,
            toleranceAfter: .zero
        )
    }

    func finishScrubbing(at fraction: CGFloat) {
        scrub(to: fraction)
        isScrubbing = false
    }

    func cleanup() {
        pause()
        if let timeObserver {
            player?.removeTimeObserver(timeObserver)
            self.timeObserver = nil
        }
        if let observer = playerItemEndObserver {
            NotificationCenter.default.removeObserver(observer)
            playerItemEndObserver = nil
        }
        playerItemObservation?.invalidate()
        playerItemObservation = nil
        player = nil
    }

    // MARK: - Private Methods

    private func applySpeed() {
        if isPlaying {
            player?.rate = speed.rate
        }
    }

    private func handlePlaybackEnd() {
        isPlaying = false
        currentTime = duration
    }

    deinit {
        if let timeObserver {
            player?.removeTimeObserver(timeObserver)
        }
        if let observer = playerItemEndObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        playerItemObservation?.invalidate()
    }
}
