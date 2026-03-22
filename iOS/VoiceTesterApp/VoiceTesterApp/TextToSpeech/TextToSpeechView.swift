//
//  TextToSpeechView.swift
//  VoiceAPITester
//
//  Created by ege on 3/3/26.
//

import AVFoundation
import SwiftUI

// MARK: - Tabbed Container

struct TextToSpeechView: View {
    @State private var tab: TTSTab = .standard

    enum TTSTab: String, CaseIterable {
        case standard = "Standard"
        case streaming = "Streaming"
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("Mode", selection: $tab) {
                ForEach(TTSTab.allCases, id: \.self) { Text($0.rawValue) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.vertical, 8)

            switch tab {
            case .standard: StandardTTSView()
            case .streaming: StreamingTTSView()
            }
        }
        .navigationTitle("Text to Speech")
    }
}

// MARK: - Standard (REST) TTS

private struct StandardTTSView: View {
    @State private var inputText = "Hello! Welcome to the xAI Text to Speech API."
    @State private var voiceID: VoiceID = .eve
    @State private var language: TTSLanguage = .en
    @State private var isGenerating = false
    @State private var playerViewModel: AudioPlayerViewModel?
    @State private var savedFileURL: URL?
    @State private var errorMessage: String?
    @State private var statusMessage: String?

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
                    Task { await generate() }
                } label: {
                    HStack {
                        if isGenerating {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Text(isGenerating ? "Generating…" : "Generate Speech")
                    }
                    .frame(maxWidth: .infinity)
                }
                .disabled(inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isGenerating)
            }

            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .foregroundStyle(.red)
                }
            }

            if let playerViewModel {
                Section("Playback") {
                    if let statusMessage {
                        Text(statusMessage)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    AudioPlayerView(viewModel: playerViewModel)

                    if let savedFileURL {
                        ShareLink(item: savedFileURL) {
                            Label("Share MP3", systemImage: "square.and.arrow.up")
                        }
                    }
                }
            }
        }
    }

    private func generate() async {
        isGenerating = true
        errorMessage = nil
        statusMessage = nil
        playerViewModel?.cleanup()
        playerViewModel = nil
        savedFileURL = nil

        defer { isGenerating = false }

        guard let apiKey = ProcessInfo.processInfo.environment["XAI_API_KEY"] ?? UserDefaults.standard.string(forKey: "XAI_API_KEY") else {
            errorMessage = "XAI_API_KEY not set. Add it in API Keys settings or as an environment variable in the Xcode scheme."
            return
        }

        let url = URL(string: "https://api.x.ai/v1/tts")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: [
                "text": inputText,
                "voice_id": voiceID.rawValue,
                "language": language.rawValue,
            ])

            let (data, response) = try await URLSession.shared.data(for: request)

            if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode != 200 {
                let body = String(data: data, encoding: .utf8) ?? "Unknown error"
                errorMessage = "API error (\(httpResponse.statusCode)): \(body)"
                return
            }

            let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent("tts_output.mp3")
            try data.write(to: fileURL)

            savedFileURL = fileURL
            statusMessage = "Saved \(ByteCountFormatter.string(fromByteCount: Int64(data.count), countStyle: .file))"

            let vm = AudioPlayerViewModel(url: fileURL)
            playerViewModel = vm
            await vm.load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
