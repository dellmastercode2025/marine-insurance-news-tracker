import AppIntents
import Foundation
import SwiftData

// Siri / Shortcuts (spec §15). Intents work offline through the local store and sync later.

struct AddTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Добавить задачу"
    static var description = IntentDescription("Создаёт задачу. Срок можно сказать словами: «завтра утром», «в пятницу в 15:00».")
    static var openAppWhenRun = false

    @Parameter(title: "Задача") var text: String
    @Parameter(title: "Когда") var when: String?

    static var parameterSummary: some ParameterSummary { Summary("Добавить \(\.$text) \(\.$when)") }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let env = AppEnvironment.shared
        let due = when.flatMap { DateService.resolvePhrase($0, prefs: env.repo.prefs) } ?? DateService.resolvePhrase(text, prefs: env.repo.prefs)
        let task = env.repo.create(title: text, dueAt: due)
        if env.network.isOnline { Task { await env.sync.syncNow() } }
        let suffix = due.map { ", срок \(DateService.absoluteLabel($0))" } ?? ""
        return .result(dialog: "Добавил «\(task.title)»\(suffix). Разложу по проектам при следующей обработке.")
    }
}

struct RemindMeIntent: AppIntent {
    static var title: LocalizedStringResource = "Напомнить"
    static var description = IntentDescription("Создаёт напоминание: «напомни позвонить Денису завтра утром».")

    @Parameter(title: "О чём") var text: String
    @Parameter(title: "Когда") var when: String

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let env = AppEnvironment.shared
        guard let at = DateService.resolvePhrase(when, prefs: env.repo.prefs) else { return .result(dialog: "Не понял время «\(when)». Скажите, например, «завтра в 9».") }
        env.repo.create(title: text, kind: .reminder, reminderAt: at)
        return .result(dialog: "Напомню «\(text)» \(DateService.absoluteLabel(at)).")
    }
}

struct WhatsTodayIntent: AppIntent {
    static var title: LocalizedStringResource = "Что у меня сегодня"
    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let repo = AppEnvironment.shared.repo
        let today = repo.openTasks().filter { ($0.dueAt.map(DateService.isToday) ?? false) || ($0.reminderAt.map(DateService.isToday) ?? false) }
        let overdue = repo.openTasks().filter(\.isOverdue).count
        guard !today.isEmpty else { return .result(dialog: overdue > 0 ? "На сегодня задач нет, но \(overdue) просрочено." : "На сегодня задач нет.") }
        let lines = today.prefix(5).map { "\($0.priority.short) \($0.title)" }.joined(separator: "; ")
        return .result(dialog: "Сегодня \(today.count) задач, просрочено \(overdue). \(lines)")
    }
}

struct UrgentTasksIntent: AppIntent {
    static var title: LocalizedStringResource = "Срочные задачи"
    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let urgent = AppEnvironment.shared.repo.openTasks().filter { $0.priority <= .p2 || $0.isOverdue }.sorted { $0.priority < $1.priority }
        guard !urgent.isEmpty else { return .result(dialog: "Срочных задач нет.") }
        return .result(dialog: "Срочных: \(urgent.count). " + urgent.prefix(5).map { "\($0.priority.short) \($0.title)" }.joined(separator: "; "))
    }
}

struct StartRecordingIntent: AppIntent {
    static var title: LocalizedStringResource = "Начать голосовую запись"
    static var openAppWhenRun = true
    @MainActor
    func perform() async throws -> some IntentResult {
        AppEnvironment.shared.showRecorder = true
        NotificationCenter.default.post(name: .startRecording, object: nil)
        return .result()
    }
}

struct CompleteTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Отметить задачу выполненной"
    @Parameter(title: "Название") var query: String
    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let repo = AppEnvironment.shared.repo
        let hits = repo.openTasks().filter { $0.title.lowercased().contains(query.lowercased()) }
        guard hits.count == 1, let t = hits.first else {
            return .result(dialog: hits.isEmpty ? "Не нашёл задачу «\(query)»." : "Нашёл несколько: \(hits.prefix(3).map(\.title).joined(separator: "; ")). Уточните.")
        }
        repo.complete(t)
        return .result(dialog: "Готово: «\(t.title)» выполнена.")
    }
}

struct VoiceTasksShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AddTaskIntent(), phrases: ["Добавить задачу в \(.applicationName)", "Add a task in \(.applicationName)"], shortTitle: "Добавить задачу", systemImageName: "plus.circle")
        AppShortcut(intent: WhatsTodayIntent(), phrases: ["Что у меня сегодня в \(.applicationName)", "What's on today in \(.applicationName)"], shortTitle: "Сегодня", systemImageName: "sun.max")
        AppShortcut(intent: UrgentTasksIntent(), phrases: ["Показать срочные задачи в \(.applicationName)", "Show urgent tasks in \(.applicationName)"], shortTitle: "Срочные", systemImageName: "exclamationmark.circle")
        AppShortcut(intent: RemindMeIntent(), phrases: ["Напомнить через \(.applicationName)", "Remind me with \(.applicationName)"], shortTitle: "Напомнить", systemImageName: "bell")
        AppShortcut(intent: StartRecordingIntent(), phrases: ["Начать голосовую запись в \(.applicationName)", "Start recording in \(.applicationName)"], shortTitle: "Записать", systemImageName: "mic")
    }
}
