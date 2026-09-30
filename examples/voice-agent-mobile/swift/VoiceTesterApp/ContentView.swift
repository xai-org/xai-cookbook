//
//  ContentView.swift
//  VoiceAPITester
//
//  Created by ege on 3/3/26.
//

import SwiftUI

struct ContentView: View {
    @AppStorage("XAI_API_KEY") private var storedKey: String?

    private var hasAPIKey: Bool {
        if let env = ProcessInfo.processInfo.environment["XAI_API_KEY"], !env.isEmpty { return true }
        if let key = storedKey, !key.isEmpty { return true }
        return false
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    NavigationLink("Text to Speech") {
                        TextToSpeechView()
                    }
                    .disabled(!hasAPIKey)

                    NavigationLink("Voice Agent") {
                        VoiceAgentView()
                    }
                    .disabled(!hasAPIKey)
                } header: {
                    Text("Demos")
                } footer: {
                    if !hasAPIKey {
                        Text("Set an API key below to enable demos.")
                    }
                }

                Section("Authentication") {
                    NavigationLink("API Keys") {
                        APIKeysView()
                    }
                }
            }
            .navigationTitle("xAI Voice API")
        }
    }
}

#Preview {
    ContentView()
}
