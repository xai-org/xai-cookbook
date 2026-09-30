//
//  VoiceAgentView.swift
//  VoiceTesterApp
//

import SwiftUI

struct VoiceAgentView: View {
    @StateObject private var conversation = VoiceAgentConversation()
    @State private var textDraft = ""
    @State private var showSettings = false
    @FocusState private var isTextFieldFocused: Bool

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    ForEach(conversation.timeline) { item in
                        switch item {
                        case .log(_, let text):
                            Text(text)
                                .font(.system(.caption2, design: .monospaced))
                                .foregroundStyle(.tertiary)
                                .id(item.id)

                        case .message(_, let role, let text):
                            MessageBubble(role: role, text: text)
                                .id(item.id)
                                .padding(.vertical, 4)
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.top, 8)
                .padding(.bottom, 140)
            }
            .onChange(of: conversation.timeline.count) {
                if let last = conversation.timeline.last {
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            FloatingToolbar(
                conversation: conversation,
                textDraft: $textDraft,
                isTextFieldFocused: $isTextFieldFocused,
                showSettings: $showSettings,
                onSend: sendText
            )
        }
        .navigationTitle("Voice Agent")
        .navigationBarTitleDisplayMode(.inline)
        .onDisappear { conversation.stop() }
        .sheet(isPresented: $showSettings) {
            SettingsSheet(conversation: conversation)
        }
    }

    private func sendText() {
        let text = textDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        textDraft = ""
        isTextFieldFocused = false
        conversation.sendText(text)
    }
}

// MARK: - Floating Toolbar

private struct FloatingToolbar: View {
    @ObservedObject var conversation: VoiceAgentConversation
    @Binding var textDraft: String
    var isTextFieldFocused: FocusState<Bool>.Binding
    @Binding var showSettings: Bool
    var onSend: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            if conversation.isStarted {
                MicWaveformView(levelMeter: conversation.levelMeter)
                    .frame(height: 28)
            }

            // Status
            HStack(spacing: 6) {
                Circle().fill(statusColor).frame(width: 6, height: 6)
                Text(statusText)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Spacer()
            }

            // Input row
            HStack(spacing: 10) {
                Button { showSettings = true } label: {
                    Image(systemName: "gearshape")
                        .font(.title2)
                        .foregroundStyle(.primary)
                }

                if conversation.isStarted {
                    TextField("Type a message…", text: $textDraft)
                        .textFieldStyle(.roundedBorder)
                        .focused(isTextFieldFocused)
                        .submitLabel(.send)
                        .onSubmit { onSend() }

                    if !textDraft.isEmpty {
                        Button(action: onSend) {
                            Image(systemName: "arrow.up.circle.fill")
                                .font(.title2)
                        }
                    }

                    Button { conversation.stop() } label: {
                        Image(systemName: "stop.circle.fill")
                            .font(.title)
                            .foregroundStyle(.red)
                    }
                } else {
                    Spacer()

                    Button { conversation.start() } label: {
                        Label("Start", systemImage: "mic.fill")
                            .font(.headline)
                    }
                    .buttonStyle(.bordered)
                    .tint(.primary)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(.horizontal, 12)
        .padding(.bottom, 4)
    }

    private var statusColor: Color {
        switch conversation.connectionState {
        case .disconnected: .gray
        case .connecting: .orange
        case .connected: .green
        case .error: .red
        }
    }

    private var statusText: String {
        switch conversation.connectionState {
        case .disconnected: "Ready"
        case .connecting: "Connecting…"
        case .connected: conversation.isAssistantSpeaking ? "Grok is speaking…" : "Connected — listening"
        case .error(let msg): "Error: \(msg)"
        }
    }
}

// MARK: - Settings Sheet

private struct SettingsSheet: View {
    @ObservedObject var conversation: VoiceAgentConversation
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Voice") {
                    Picker("Voice", selection: $conversation.voiceID) {
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
                    .pickerStyle(.inline)
                    .labelsHidden()
                }

            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
    }
}

// MARK: - Mic Waveform

private struct MicWaveformView: View {
    let levelMeter: AudioLevelMeter

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.05)) { _ in
            let samples = levelMeter.samples
            HStack(spacing: 2) {
                ForEach(Array(samples.enumerated()), id: \.offset) { _, value in
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(barColor(for: value))
                        .frame(width: 3, height: max(2, CGFloat(value) * 120))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func barColor(for value: Float) -> Color {
        if value > 0.1 { return .green }
        if value > 0.01 { return .green.opacity(0.6) }
        return .gray.opacity(0.3)
    }
}

// MARK: - Message Bubble

private struct MessageBubble: View {
    let role: TimelineItem.MessageRole
    let text: String

    private var isUser: Bool { role == .user }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 60) }

            VStack(alignment: isUser ? .trailing : .leading, spacing: 4) {
                Text(isUser ? "You" : "Grok")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)

                Text(text.isEmpty ? "…" : text)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(isUser ? Color.accentColor.opacity(0.15) : Color(.secondarySystemBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .textSelection(.enabled)
            }

            if !isUser { Spacer(minLength: 60) }
        }
    }
}

#Preview {
    NavigationStack {
        VoiceAgentView()
    }
}
