//
//  VoiceID.swift
//  VoiceTesterApp
//
//  Created by ege on 3/3/26.
//

import Foundation

enum VoiceID: String, CaseIterable, Identifiable {
    case eve = "Eve"
    case ara = "Ara"
    case rex = "Rex"
    case sal = "Sal"
    case leo = "Leo"

    var id: String { rawValue }

    var displayName: String { rawValue }

    var gender: String {
        switch self {
        case .eve: "Female"
        case .ara: "Female"
        case .rex: "Male"
        case .sal: "Neutral"
        case .leo: "Male"
        }
    }

    var tone: String {
        switch self {
        case .eve: "Energetic, upbeat"
        case .ara: "Warm, friendly"
        case .rex: "Confident, clear"
        case .sal: "Smooth, balanced"
        case .leo: "Authoritative, strong"
        }
    }

    var description: String {
        switch self {
        case .eve: "Default voice, engaging and enthusiastic"
        case .ara: "Balanced and conversational"
        case .rex: "Professional and articulate, ideal for business applications"
        case .sal: "Versatile voice suitable for various contexts"
        case .leo: "Decisive and commanding, suitable for instructional content"
        }
    }
}
