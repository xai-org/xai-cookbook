//
//  APIKeysView.swift
//  VoiceAPITester
//
//  Created by ege on 3/3/26.
//

import SwiftUI

struct APIKeysView: View {
    private static let userDefaultsKey = "XAI_API_KEY"

    @State private var draft = ""
    @State private var savedKey: String?
    @State private var showKey = false
    @State private var copied = false

    var body: some View {
        Form {
            Section {
                if let savedKey {
                    HStack {
                        Text(showKey ? savedKey : maskedKey(savedKey))
                            .font(.system(.body, design: .monospaced))
                            .lineLimit(1)
                            .truncationMode(.middle)

                        Spacer()

                        Button {
                            UIPasteboard.general.string = savedKey
                            withAnimation { copied = true }
                            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                                withAnimation { copied = false }
                            }
                        } label: {
                            Image(systemName: copied ? "checkmark" : "doc.on.doc")
                                .contentTransition(.symbolEffect(.replace))
                        }
                        .buttonStyle(.borderless)
                        .tint(copied ? .green : .accentColor)

                        Button {
                            showKey.toggle()
                        } label: {
                            Image(systemName: showKey ? "eye.slash" : "eye")
                        }
                        .buttonStyle(.borderless)
                    }

                    Button("Remove Key", role: .destructive) {
                        UserDefaults.standard.removeObject(forKey: Self.userDefaultsKey)
                        self.savedKey = nil
                        draft = ""
                        showKey = false
                    }
                } else {
                    Text("No API key set")
                        .foregroundStyle(.secondary)
                }
            } header: {
                Text("xAI API Key")
            } footer: {
                Text("Used for all API requests. You can also set XAI_API_KEY as an environment variable in the Xcode scheme.")
            }

            Section("Set Key") {
                HStack {
                    SecureField("xai-…", text: $draft)
                        .font(.system(.body, design: .monospaced))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()

                    Button {
                        if let clipboard = UIPasteboard.general.string, !clipboard.isEmpty {
                            draft = clipboard
                        }
                    } label: {
                        Image(systemName: "doc.on.clipboard")
                    }
                    .buttonStyle(.borderless)
                }

                Button("Save") {
                    let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !trimmed.isEmpty else { return }
                    UserDefaults.standard.set(trimmed, forKey: Self.userDefaultsKey)
                    savedKey = trimmed
                    draft = ""
                    showKey = false
                }
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .navigationTitle("API Keys")
        .onAppear {
            savedKey = UserDefaults.standard.string(forKey: Self.userDefaultsKey)
        }
    }

    private func maskedKey(_ key: String) -> String {
        guard key.count > 8 else { return String(repeating: "•", count: key.count) }
        let prefix = key.prefix(4)
        let suffix = key.suffix(4)
        return "\(prefix)••••••••\(suffix)"
    }
}

#Preview {
    NavigationStack {
        APIKeysView()
    }
}