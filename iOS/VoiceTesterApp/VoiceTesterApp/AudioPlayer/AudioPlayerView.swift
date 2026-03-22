//
//  AudioPlayerView.swift
//  VoiceTesterApp
//

import SwiftUI

/// A capsule-shaped audio player with play/pause, scrubber, time labels, and speed control.
struct AudioPlayerView: View {
    @ObservedObject var viewModel: AudioPlayerViewModel

    var body: some View {
        let isEnabled = !viewModel.isLoading && !viewModel.hasError

        HStack(spacing: 12) {
            // Play / Pause / Loading / Error
            if viewModel.hasError {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(Color.red, in: Circle())
                    .transition(.opacity.combined(with: .scale(scale: 0)))
            } else if viewModel.isLoading {
                ProgressView()
                    .progressViewStyle(.circular)
                    .frame(width: 40, height: 40)
                    .transition(.opacity.combined(with: .scale))
            } else {
                Button {
                    viewModel.togglePlayPause()
                } label: {
                    Image(systemName: viewModel.isPlaying ? "pause.fill" : "play.fill")
                        .contentTransition(.symbolEffect(.replace.downUp, options: .speed(3)))
                }
                .buttonStyle(PlayerButtonStyle())
                .transition(.opacity.combined(with: .scale))
            }

            // Scrubber
            ScrubberView(viewModel: viewModel, isEnabled: isEnabled)

            // Speed
            SpeedMenu(speed: $viewModel.speed)
                .disabled(!isEnabled)
        }
        .animation(.easeInOut(duration: 0.25), value: viewModel.isLoading)
        .animation(.easeInOut(duration: 0.25), value: viewModel.hasError)
    }
}

// MARK: - Scrubber

private struct ScrubberView: View {
    @ObservedObject var viewModel: AudioPlayerViewModel
    let isEnabled: Bool

    var body: some View {
        // Elapsed time
        Text(formatTime(viewModel.currentTime))
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)

        // Progress bar
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.primary.opacity(0.2))

                Rectangle()
                    .fill(Color.accentColor)
                    .frame(width: geometry.size.width * viewModel.progress)
            }
            .frame(height: 8)
            .clipShape(Capsule())
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        viewModel.scrub(to: value.location.x / geometry.size.width)
                    }
                    .onEnded { value in
                        viewModel.finishScrubbing(at: value.location.x / geometry.size.width)
                    }
            )
            .allowsHitTesting(isEnabled)
        }
        .frame(height: 32)
        .opacity(isEnabled ? 1.0 : 0.4)

        // Remaining time
        Text("-\(formatTime(viewModel.timeRemaining))")
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
    }

    private func formatTime(_ seconds: TimeInterval) -> String {
        guard seconds.isFinite else { return "0:00" }
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%d:%02d", mins, secs)
    }
}

// MARK: - Speed Menu

private struct SpeedMenu: View {
    @Binding var speed: AudioPlayerViewModel.Speed

    var body: some View {
        Menu {
            ForEach(AudioPlayerViewModel.Speed.allCases, id: \.self) { option in
                Button {
                    speed = option
                } label: {
                    if option == speed {
                        Label(option.rawValue, systemImage: "checkmark")
                    } else {
                        Text(option.rawValue)
                    }
                }
            }
        } label: {
            Text(speed.rawValue)
                .font(.system(size: 13, weight: .medium))
                .padding(.horizontal, 4)
                .padding(.vertical, 4)
                .frame(width: 45, height: 35)
                .background {
                    Capsule()
                        .fill(Color.primary.opacity(0.1))
                }
        }
        .tint(.primary)
    }
}

// MARK: - Button Style

private struct PlayerButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 17, weight: .medium))
            .frame(width: 40, height: 40)
            .background(Color.accentColor.opacity(0.15), in: Circle())
            .opacity(isEnabled ? 1.0 : 0.4)
            .opacity(configuration.isPressed ? 0.6 : 1.0)
            .animation(.easeInOut(duration: 0.15), value: configuration.isPressed)
    }
}
