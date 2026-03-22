//
//  TTSLanguage.swift
//  VoiceTesterApp
//

import Foundation

enum TTSLanguage: String, CaseIterable, Identifiable {
    case en
    case arEG = "ar-EG"
    case arSA = "ar-SA"
    case arAE = "ar-AE"
    case bn
    case zh
    case fr
    case de
    case hi
    case id
    case it
    case ja
    case ko
    case ptBR = "pt-BR"
    case ptPT = "pt-PT"
    case ru
    case esMX = "es-MX"
    case esES = "es-ES"
    case tr
    case vi

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .en: "English"
        case .arEG: "Arabic (Egypt)"
        case .arSA: "Arabic (Saudi Arabia)"
        case .arAE: "Arabic (United Arab Emirates)"
        case .bn: "Bengali"
        case .zh: "Chinese (Simplified)"
        case .fr: "French"
        case .de: "German"
        case .hi: "Hindi"
        case .id: "Indonesian"
        case .it: "Italian"
        case .ja: "Japanese"
        case .ko: "Korean"
        case .ptBR: "Portuguese (Brazil)"
        case .ptPT: "Portuguese (Portugal)"
        case .ru: "Russian"
        case .esMX: "Spanish (Mexico)"
        case .esES: "Spanish (Spain)"
        case .tr: "Turkish"
        case .vi: "Vietnamese"
        }
    }
}
