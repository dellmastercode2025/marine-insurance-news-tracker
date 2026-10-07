import Foundation
import SwiftUI

enum TaskKind: String, Codable, CaseIterable, Identifiable {
    case task, reminder, event, waiting, note
    var id: String { rawValue }
    var label: String {
        switch self {
        case .task: "Задача"
        case .reminder: "Напоминание"
        case .event: "Событие"
        case .waiting: "Ожидание"
        case .note: "Заметка"
        }
    }
    var symbol: String {
        switch self {
        case .task: "checkmark.circle"
        case .reminder: "bell"
        case .event: "calendar"
        case .waiting: "hourglass"
        case .note: "note.text"
        }
    }
}

enum Priority: Int, Codable, CaseIterable, Identifiable, Comparable {
    case p1 = 1, p2, p3, p4
    var id: Int { rawValue }
    var label: String {
        switch self {
        case .p1: "P1 · критический"
        case .p2: "P2 · высокий"
        case .p3: "P3 · обычный"
        case .p4: "P4 · низкий"
        }
    }
    var short: String { "P\(rawValue)" }
    var color: Color {
        switch self {
        case .p1: .red
        case .p2: .orange
        case .p3: .blue
        case .p4: .gray
        }
    }
    static func < (a: Priority, b: Priority) -> Bool { a.rawValue < b.rawValue }
}

enum StatusKind: String, Codable, CaseIterable {
    case inbox, todo, inProgress = "in_progress", waiting, done, custom
}

enum ProcessingStatus: String, Codable {
    case waitingForProcessing = "waiting_for_processing"
    case transcribed, parsed, committed, failed, discarded
    var label: String {
        switch self {
        case .waitingForProcessing: "Ожидает обработки"
        case .transcribed: "Расшифровано"
        case .parsed: "Разобрано"
        case .committed: "Добавлено"
        case .failed: "Ошибка"
        case .discarded: "Отклонено"
        }
    }
}

enum SyncState: String, Codable {
    case synced, pendingUpsert, pendingDelete
}

enum AppleRemindersSync: String, Codable, CaseIterable, Identifiable {
    case off, important, withReminder = "with_reminder", all
    var id: String { rawValue }
    var label: String {
        switch self {
        case .off: "Выключено"
        case .important: "Только важные (P1–P2)"
        case .withReminder: "Все задачи с напоминанием"
        case .all: "Все задачи"
        }
    }
}
